/**
 * The operator command policy as a user meets it, in the real interface: a server with a
 * real extension and `blockedCommands`, the composer's "/" list read back, the blocked
 * command typed anyway, and an allowed one run.
 *
 *   npm run build --workspace web
 *   node --import tsx/esm scripts/probes/command-policy-ui.mts
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { startServer } from "../../server/test/harness.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-command-policy-ui-"));
const markers = path.join(root, "markers");
await mkdir(markers);
const extension = path.join(root, "operator-extension");
await mkdir(extension);
const mark = (name: string) => JSON.stringify(path.join(markers, name));
await writeFile(
  path.join(extension, "index.ts"),
  `import { writeFileSync } from "node:fs";
export default (pi) => {
  pi.registerCommand("setup-creds", { description: "reconfigure credentials", handler: async () => { writeFileSync(${mark("setup-ran")}, "yes"); } });
  pi.registerCommand("status", { description: "show status", handler: async () => { writeFileSync(${mark("status-ran")}, "yes"); } });
};
`,
);
// The developer's keys removed, and one fake key so the interface is the chat, not the
// setup screen (as the e2e does): nothing typed here can reach a real model.
const noCredentials: Record<string, string | undefined> = {
  ...Object.fromEntries(Object.keys(process.env).filter((key) => /API_KEY|AUTH_TOKEN|_TOKEN$/.test(key)).map((key) => [key, undefined])),
  ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
};
const server = await startServer(root, { extensionPaths: [extension], blockedCommands: ["setup*"] }, { env: noCredentials });
const shots = await mkdtemp(path.join(tmpdir(), "pi-outpost-command-policy-shots-"));
const browser = await chromium.launch();
const seen: Record<string, unknown> = {};
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.port}/`);
  const composer = page.getByRole("textbox").last();
  await composer.waitFor();
  await composer.fill("/");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, "1-palette.png") });
  seen.palette = (await page.locator("body").innerText()).match(/\/(setup-creds|status)\b/g) ?? [];
  await composer.fill("/setup-creds key=abc");
  await composer.press("Escape").catch(() => {});
  await composer.press("Enter");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, "2-blocked.png") });
  seen.afterBlocked = {
    errorShown: await page.getByText("This command is not available.").count(),
    userBubble: await page.getByText("/setup-creds key=abc").count(),
    ran: existsSync(path.join(markers, "setup-ran")),
  };
  await composer.fill("/status");
  await composer.press("Escape").catch(() => {});
  await composer.press("Enter");
  await page.waitForTimeout(2000);
  seen.allowedRan = existsSync(path.join(markers, "status-ran"));
  await page.screenshot({ path: path.join(shots, "3-allowed.png") });
  seen.shots = shots;
} finally {
  console.log(JSON.stringify(seen, null, 2));
  await browser.close();
  await server.stop();
}
