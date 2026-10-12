/**
 * A message sent while the extensions start, as a user meets it in the real interface:
 * an extension whose `session_start` takes eight seconds (or never ends), a `/probe`
 * command typed the moment the chat shows, the held message read back, then either let
 * through or cancelled. Also: a second message sent while the first is held.
 *
 *   npm run build --workspace web
 *   node --import tsx/esm scripts/probes/prompt-waits-for-extensions-ui.mts
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { startServer } from "../../server/test/harness.mjs";

// The developer's keys removed, and one fake key so the interface is the chat, not the
// setup screen: nothing typed here can reach a real model.
const noCredentials: Record<string, string | undefined> = {
  ...Object.fromEntries(Object.keys(process.env).filter((key) => /API_KEY|AUTH_TOKEN|_TOKEN$/.test(key)).map((key) => [key, undefined])),
  ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
};
const shots = await mkdtemp(path.join(tmpdir(), "pi-outpost-prompt-waits-shots-"));
const browser = await chromium.launch();
const seen: Record<string, unknown> = { shots };

async function run(label: string, startMs: number, drive: (page: import("@playwright/test").Page, markers: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), `pi-outpost-prompt-waits-${label}-`));
  const markers = path.join(root, "markers");
  await mkdir(markers);
  const extension = path.join(root, "slow-start");
  await mkdir(extension);
  const at = (name: string) => JSON.stringify(path.join(markers, name));
  const wait = startMs === Infinity ? "await new Promise(() => {});" : `await new Promise((r) => setTimeout(r, ${startMs}));`;
  await writeFile(
    path.join(extension, "index.ts"),
    `import { appendFileSync, existsSync, writeFileSync } from "node:fs";
export default (pi) => {
  pi.on("session_start", async () => { ${wait} writeFileSync(${at("started")}, "yes"); });
  pi.registerCommand("probe", { description: "probe", handler: async (args) => {
    appendFileSync(${at("probe")}, (existsSync(${at("started")}) ? "after-start" : "before-start") + ":" + (args || "") + "\\n");
  } });
};
`,
  );
  const server = await startServer(root, { extensionPaths: [extension] }, { env: noCredentials });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await drive(page, markers);
    await page.close();
  } finally {
    await server.stop();
  }
}

const probeLines = (markers: string) =>
  existsSync(path.join(markers, "probe")) ? readFileSync(path.join(markers, "probe"), "utf8").trim().split(/\r?\n/) : [];

await run("through", 8000, async (page, markers) => {
  const composer = page.getByRole("textbox").last();
  await composer.waitFor();
  await composer.fill("/probe one");
  await composer.press("Enter");
  const waiting = page.getByTestId("prompt-waiting-for-extensions");
  await waiting.waitFor({ timeout: 5000 });
  await page.screenshot({ path: path.join(shots, "1-waiting.png") });
  // A second message while the first is held.
  await composer.fill("/probe two");
  await composer.press("Enter");
  await page.waitForTimeout(500);
  seen.whileWaiting = {
    waitingText: await waiting.innerText(),
    sendingShown: await page.getByText("sending…").count(),
    ranYet: probeLines(markers),
    composerValue: await composer.inputValue().catch(() => "(not an input)"),
    errors: await page.locator("[role=alert]").allInnerTexts(),
  };
  await waiting.waitFor({ state: "detached", timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, "2-through.png") });
  seen.afterStart = {
    ran: probeLines(markers),
    pendingLeft: await page.locator("[data-pending-prompt]").count(),
    body: (await page.locator("main").innerText()).slice(-400),
  };
});

await run("cancel", Infinity, async (page, markers) => {
  const composer = page.getByRole("textbox").last();
  await composer.waitFor();
  await composer.fill("/probe never");
  await composer.press("Enter");
  const waiting = page.getByTestId("prompt-waiting-for-extensions");
  await waiting.waitFor({ timeout: 5000 });
  // Double click: the second lands after the first released the message.
  await waiting.getByRole("button", { name: "cancel" }).dblclick();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, "3-cancelled.png") });
  seen.afterCancel = {
    waitingLeft: await waiting.count(),
    pendingLeft: await page.locator("[data-pending-prompt]").count(),
    notSentShown: await page.getByText(/waiting for the extensions to finish starting/).count(),
    ran: probeLines(markers),
    composerValue: await composer.inputValue().catch(() => "(not an input)"),
  };
  // Send again: held again, not lost and not run.
  await composer.fill("/probe again");
  await composer.press("Enter");
  await page.waitForTimeout(1000);
  seen.sentAgain = { waiting: await waiting.count(), ran: probeLines(markers) };
});

await browser.close();
console.log(JSON.stringify(seen, null, 2));
