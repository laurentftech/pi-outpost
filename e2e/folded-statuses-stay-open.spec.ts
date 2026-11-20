import path from "node:path";
import { rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

// openlore: scenario=FoldedStatusesStayOpenWhileTheyUpdate spec=components
test("FoldedStatusesStayOpenWhileTheyUpdate: the folded list stays open while an extension ticks, sets and clears statuses", async ({ page }) => {
  // A timer the way real extensions keep one: a status rewritten several times a
  // second, and another that comes and goes.
  const root = await makeWorkspace({
    "ticker.ts": `export default pi => {
      pi.registerCommand("tick", { handler: async (_args, ctx) => {
        let n = 0;
        ctx.ui.setStatus("router", "OmniRoute: falling back to the secondary provider");
        setInterval(() => {
          n += 1;
          ctx.ui.setStatus("timer", "tick " + n);
          ctx.ui.setStatus("jobs", n % 4 < 2 ? "2 jobs" : undefined);
        }, 200);
      }});
    };`,
  });
  const server = await startServer(root, { noExtensions: false, extensionPaths: [path.join(root, "ticker.ts")] }, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  try {
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto(`${server.base}/?token=${encodeURIComponent(server.token)}`);
    const composer = page.getByRole("textbox", { name: /message pi/i });
    await expect(composer).toBeEnabled();
    await composer.fill("/tick");
    await composer.press("Escape");
    await composer.press("Enter");

    const folded = page.getByRole("button", { name: /\d statuses/ });
    await expect(folded).toBeVisible();
    await folded.click();
    const list = page.getByRole("list", { name: "Extension statuses" });
    await expect(list).toBeVisible();

    // Sample the list across many ticks: it must be there every time, and moving.
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(150);
      await expect(list).toBeVisible({ timeout: 1 });
      const tick = await list.getByText(/^tick \d+$/).textContent();
      if (tick) seen.add(tick);
    }
    expect(seen.size).toBeGreaterThan(3);
    await expect(page.getByRole("button", { name: /\d statuses/ })).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});
