import path from "node:path";
import { rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";
// @ts-expect-error -- shared integration harness is JavaScript
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

test("extension status ANSI styles survive folding, resizing and a fresh update after reload", async ({ page }, testInfo) => {
  const root = await makeWorkspace({
    "status.ts": `export default pi => {
      pi.registerCommand("status-colours", { handler: async (_args, ctx) => {
        ctx.ui.setStatus("colour", "\\x1b[32;1mReady\\x1b[0m plain");
        const t = ctx.ui.theme;
        ctx.ui.setStatus("blackhole", t.fg("success", "bh") + " " + t.fg("warning", "warning-gauge") + " " + t.fg("error", "error-gauge"));
      }});
    };`,
  });
  const server = await startServer(root, { noExtensions: false, extensionPaths: [path.join(root, "status.ts")] }, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(server.base);
    const composer = page.getByRole("textbox", { name: /message pi/i });
    await expect(composer).toBeEnabled();
    await composer.fill("/status-colours");
    await composer.press("Escape");
    await composer.press("Enter");
    const ready = page.getByText("Ready", { exact: true });
    const warning = page.getByText("warning-gauge", { exact: true });
    const error = page.getByText("error-gauge", { exact: true });
    const assertThemedGauges = async () => {
      await expect(warning).toHaveAttribute("style", /color:/);
      await expect(error).toHaveAttribute("style", /color:/);
      expect(await warning.evaluate((el) => getComputedStyle(el).color)).not.toBe(await error.evaluate((el) => getComputedStyle(el).color));
    };
    await expect(ready).toBeVisible();
    await expect(ready).toHaveCSS("color", "rgb(22, 163, 74)");
    await expect(ready).toHaveCSS("font-weight", "600");
    await expect(page.getByTitle("Ready plain")).toBeVisible();
    await assertThemedGauges();
    await page.screenshot({ path: testInfo.outputPath("status-header.png") });
    await page.setViewportSize({ width: 420, height: 800 });
    const folded = page.getByRole("button", { name: /2 status/ });
    await expect(folded).toBeVisible();
    await folded.click();
    await assertThemedGauges();
    await page.screenshot({ path: testInfo.outputPath("status-overflow.png") });
    await expect(ready).toHaveCSS("color", "rgb(22, 163, 74)");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("list", { name: "Extension statuses" })).toHaveCount(0);
    await folded.click();
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(folded).toHaveCount(0);
    await expect(ready).toHaveCSS("color", "rgb(22, 163, 74)");
    await page.reload();
    await expect(composer).toBeEnabled();
    await composer.fill("/status-colours");
    await composer.press("Escape");
    await composer.press("Enter");
    await expect(ready).toHaveCSS("color", "rgb(22, 163, 74)");
    await assertThemedGauges();
    expect(await page.locator("header").textContent()).not.toContain("\u001b");
  } catch (error) {
    console.log(server.log());
    throw error;
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});

