/**
 * The planning timeline as Open WebUI embeds it: the page the planning server answers
 * show_planning with, framed exactly as Open WebUI v0.11.4 frames a tool's embed —
 * `sandbox="allow-scripts allow-popups allow-downloads"`, no same-origin, content in
 * `srcdoc`. The host page records every message the frame posts, which is all Open
 * WebUI ever receives from it.
 *
 * Needs the viewer built (`npm run build --workspace @pi-outpost/openwebui`).
 */
import { expect, test, type Frame, type Page } from "@playwright/test";
import { embedPage } from "../openwebui/src/embed.ts";

const PLANNING = {
  id: "pl_AAAAAAAAAAAAAAAA",
  title: "Programme X",
  revision: 2,
  data: {
    title: "Programme X",
    time: { start: "2027-01-01", end: "2027-12-31", scale: "month" as const },
    rows: [
      { type: "separator" as const, label: "System A" },
      {
        type: "task" as const,
        id: "T1",
        label: "Study",
        items: [
          { type: "activity" as const, id: "study", start: "2027-01-10", end: "2027-03-31", label: "Study" },
          { type: "milestone" as const, id: "srr", date: "2027-04-15", kind: "SRR", label: "Requirements review" },
        ],
      },
      {
        type: "task" as const,
        id: "T2",
        label: "Build",
        items: [{ type: "activity" as const, id: "build", start: "2027-05-01", end: "2027-09-30", label: "Build & test" }],
      },
    ],
    dependencies: [{ from: "srr", to: "build" }],
  },
};

async function host(page: Page): Promise<Frame> {
  await page.setContent(`<!doctype html><body style="margin:0">
    <iframe id="embed" sandbox="allow-scripts allow-popups allow-downloads" style="width:900px;border:0"></iframe>
    <script>
      window.received = [];
      window.addEventListener("message", (event) => window.received.push(event.data));
    </script></body>`);
  await page.locator("#embed").evaluate((frame, html) => {
    (frame as HTMLIFrameElement).srcdoc = html;
  }, embedPage(PLANNING));
  const frame = page.frameLocator("#embed");
  await expect(frame.getByTestId("timeline")).toBeVisible();
  return page.frames().find((candidate) => candidate !== page.mainFrame())!;
}

const received = (page: Page) => page.evaluate(() => (window as unknown as { received: Array<{ type?: string; text?: string; height?: number }> }).received);

// openlore: scenario=TheEmbedRunsInTheDefaultSandbox spec=openwebui-planning-server
test("TheEmbedRunsInTheDefaultSandbox: draws, changes scale, opens details, reports its height", async ({ page }) => {
  const frame = await host(page);
  const embed = page.frameLocator("#embed");

  // Every task and item of the revision, drawn.
  await expect(embed.getByTestId("timeline-task-label")).toHaveText(["Study", "Build"]);
  expect(await frame.locator("[data-row][data-item]").count()).toBe(3);
  // The frame really is sandboxed without same-origin: its origin is opaque.
  expect(await frame.evaluate(() => window.origin)).toBe("null");

  // A scale change redraws.
  await embed.locator("[data-scale=quarter]").click();
  await expect(embed.locator("[data-scale=quarter]")).toHaveAttribute("aria-pressed", "true");

  // Details open on a click.
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await expect(embed.getByTestId("timeline-details")).toContainText("Requirements review");

  // Its height, measured from the timeline, not the frame's default 150 px.
  const heights = (await received(page)).filter((m) => m.type === "iframe:height").map((m) => m.height!);
  expect(heights.length).toBeGreaterThan(0);
  const drawn = await frame.evaluate(() => Math.ceil(document.getElementById("root")!.getBoundingClientRect().height));
  expect(heights.at(-1)).toBe(drawn);
  expect(drawn).toBeGreaterThan(150);
});

// openlore: scenario=ClickingAMilestoneFillsTheInput spec=openwebui-planning-server
test("ClickingAMilestoneFillsTheInput: asks the chat to fill its input, never to send", async ({ page }) => {
  const frame = await host(page);
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await frame.locator('[data-testid="timeline-task-label"]', { hasText: "Build" }).click();
  // Unselecting asks for nothing.
  await frame.locator('[data-testid="timeline-task-label"]', { hasText: "Build" }).click();

  const prompts = (await received(page)).filter((m) => m.type?.startsWith("input:"));
  expect(prompts).toEqual([
    {
      type: "input:prompt",
      text: 'About milestone "Requirements review" (srr, task T1, on 2027-04-15) in planning "Programme X" (pl_AAAAAAAAAAAAAAAA): ',
    },
    { type: "input:prompt", text: 'About task "Build" (T2) in planning "Programme X" (pl_AAAAAAAAAAAAAAAA): ' },
  ]);
  expect((await received(page)).some((m) => m.type === "input:prompt:submit" || m.type === "action:submit")).toBe(false);
});
