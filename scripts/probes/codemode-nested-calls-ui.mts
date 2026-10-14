/** Build web first, then: node --import tsx/esm scripts/probes/codemode-nested-calls-ui.mts */
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";

const root = await makeWorkspace({ "inside.txt": "INSIDE-MARKER" });
const elsewhere = await mkdtemp(path.join(tmpdir(), "codemode-browser-"));
const outside = path.join(elsewhere, "secret.txt");
await writeFile(outside, "OUTSIDE-MARKER");
await mkdir(path.join(root, ".pi-agent"), { recursive: true });
await writeFile(path.join(root, ".pi-agent", "settings.json"), JSON.stringify({ defaultTools: ["+codemode"] }));
const server = await startServer(root, {
  extensionPaths: [fileURLToPath(new URL("../../server/test/fixtures/codemode-provider.mjs", import.meta.url))],
  allowedModels: [{ provider: "codemode-test", id: "codemode-test" }],
}, { env: { CODEMODE_LOG: path.join(elsewhere, "result.txt"), CODEMODE_READ_DELAY_MS: "1800" } });
const browser = await chromium.launch();
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const frames: any[] = [];
page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
  try { frames.push(JSON.parse(String(payload))); } catch {}
}));
try {
  await page.goto(server.base);
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await composer.fill(`RUN CODEMODE ${outside}`);
  await composer.press("Enter");
  const button = page.getByRole("button", { name: "codemode", exact: true });
  await expect(button).toHaveCount(1, { timeout: 30_000 });
  const card = button.locator("../..");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(card).not.toContainText("inside.txt");
  await button.click();
  await expect(card).toContainText("inside.txt");
  await expect.poll(() => frames.some((m) => m.type === "tool_update" && m.outputHtml?.includes(">read<"))).toBe(true);
  expect(frames.some((m) => m.type === "tool_end")).toBe(false);
  // Rapid toggles while partial results replace the content must preserve the card.
  for (let i = 0; i < 6; i++) await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(card).toContainText("secret.txt", { timeout: 30_000 });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => frames.some((m) => m.type === "agent_end")).toBe(true);
  expect(frames.filter((m) => m.type === "tool_start").map((m) => m.toolName)).toEqual(["codemode"]);
  expect(await card.innerText()).not.toContain("OUTSIDE-MARKER");
  // Reload during a second execution, then reload its persisted result too.
  await composer.fill(`RUN CODEMODE ${outside}`);
  await composer.press("Enter");
  await expect(button).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("button", { name: "codemode", exact: true })).toHaveCount(2);
  await expect.poll(() => frames.filter((m) => m.type === "agent_end").length, { timeout: 30_000 }).toBe(2);
  await page.reload();
  const cards = page.getByRole("button", { name: "codemode", exact: true });
  await expect(cards).toHaveCount(2);
  for (const current of await cards.all()) {
    await expect(current).toHaveAttribute("aria-expanded", "false");
    await expect(current.locator("../..")).not.toContainText("inside.txt");
    await current.click();
    await expect(current.locator("../..")).toContainText("secret.txt");
  }
  expect(await page.locator("body").innerText()).not.toContain("OUTSIDE-MARKER");
  expect(errors).toEqual([]);
  console.log("PASS: live nested calls, refused read, rapid toggles, reload during execution, persisted cards; no page errors");
} finally {
  await browser.close();
  await server.stop();
  await rm(elsewhere, { recursive: true, force: true });
}
