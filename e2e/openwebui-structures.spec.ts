/**
 * show_structure's embed, in Open WebUI's sandbox: the page the server answers
 * with, framed as Open WebUI v0.11.4 frames a tool's embed — scripts and downloads
 * allowed, no same-origin, content in `srcdoc`. Each kind is drawn by pi-outpost's own
 * rendering; a proposal shows what it would change and offers nothing to apply it.
 *
 * Needs the viewer built (`npm run build:viewer --workspace @pi-outpost/openwebui`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Frame, type FrameLocator, type Page } from "@playwright/test";
import { describeStructure } from "@pi-outpost/shared/structured-exchange/model";
import { tableMarkdown } from "@pi-outpost/shared/structured-exchange/table-export";
import type { StructuredTableData, ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";
import { embedPage } from "../openwebui/src/embed.ts";
import { judgeStructure } from "../openwebui/src/structure.ts";

const conformance = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../shared/conformance/valid/${name}`, import.meta.url)), "utf8"));

function validated(document: unknown): ValidatedStructuredExchange {
  const verdict = judgeStructure(document);
  if (!verdict.valid) throw new Error(`fixture refused: ${JSON.stringify(verdict.issues)}`);
  return verdict.envelope;
}

/** A proposal holding one of each: an addition, a change, a removal — and some context. */
const PROPOSAL = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  target: "billing-architecture",
  removals: [{ type: "element", ref: "EL-9", label: "Fax gateway" }],
  data: {
    nodes: [
      { id: "invoice", ref: "EL-1", label: "Invoice service", set: { label: "Invoicing service" } },
      { id: "ledger", ref: "EL-2", label: "Ledger" },
      { id: "gateway", label: "Payment gateway" },
    ],
    edges: [{ from: "gateway", to: "invoice", kind: "flow" }],
  },
};

async function show(page: Page, envelope: ValidatedStructuredExchange): Promise<{ frame: Frame; embed: FrameLocator }> {
  await page.setContent(`<!doctype html><body style="margin:0">
    <iframe id="embed" sandbox="allow-scripts allow-popups allow-downloads" style="width:1000px;border:0"></iframe>
    <script>
      window.received = [];
      window.addEventListener("message", (event) => window.received.push(event.data));
    </script></body>`);
  await page.locator("#embed").evaluate((frame, html) => {
    (frame as HTMLIFrameElement).srcdoc = html;
  }, embedPage({ mode: "structure", envelope }));
  const embed = page.frameLocator("#embed");
  await expect(embed.getByTestId("structured-document")).toBeVisible();
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
  expect(await frame.evaluate(() => window.origin)).toBe("null");
  return { frame, embed };
}

const received = (page: Page) => page.evaluate(() => (window as unknown as { received: Array<{ type?: string; height?: number }> }).received);

// openlore: scenario=AGraphIsShown spec=openwebui-structured-exchange
test("AGraphIsShown: every element and relationship drawn; a viewpoint can be selected", async ({ page }) => {
  const document = conformance("v2-graph-with-viewpoints.json");
  const { frame, embed } = await show(page, validated(document));
  const ids = await frame.locator("[data-element-id]").evaluateAll((elements) => elements.map((e) => e.getAttribute("data-element-id")));
  for (const node of document.data.nodes as Array<{ id: string }>) expect(ids, node.id).toContain(node.id);
  // One hit path per relationship drawn.
  expect(await frame.locator('[data-edge="hit"]').count()).toBe((document.data.edges as unknown[]).length);
  // Viewpoints are offered and narrow the drawing.
  const select = embed.getByTestId("viewpoint-select");
  await expect(select).toBeVisible();
  const options = await select.locator("option").count();
  expect(options).toBeGreaterThan(1);
  const before = await frame.locator("[data-element-id]").count();
  await select.selectOption({ index: 1 });
  await expect(embed.getByTestId("structured-viewpoint")).toBeVisible();
  expect(await frame.locator("[data-element-id]").count()).toBeLessThanOrEqual(before);

  // The height reported is the content's, not the frame's default.
  const heights = (await received(page)).filter((m) => m.type === "iframe:height").map((m) => m.height!);
  expect(heights.at(-1)).toBeGreaterThan(150);
});

// openlore: scenario=EveryKindIsShown spec=openwebui-structured-exchange
test("EveryKindIsShown: sequence, table and timeline each drawn whole", async ({ page }) => {
  const sequence = conformance("sequence-ordered.json");
  let { frame } = await show(page, validated(sequence));
  expect(await frame.locator("[data-message-index]").count()).toBe((sequence.data.messages as unknown[]).length);
  for (const participant of sequence.data.participants as Array<{ label?: string; id: string }>) {
    expect(await frame.locator("svg text").filter({ hasText: participant.label ?? participant.id }).count(), participant.id).toBeGreaterThan(0);
  }

  const table = conformance("table-rows-with-roles.json");
  ({ frame } = await show(page, validated(table)));
  expect(await frame.locator("tbody tr[data-row-role], tbody tr").count()).toBeGreaterThanOrEqual((table.data.rows as unknown[]).length);

  const timeline = conformance("v3-timeline-programme.json");
  ({ frame } = await show(page, validated(timeline)));
  const tasks = (timeline.data.rows as Array<{ type: string; items?: unknown[] }>).filter((row) => row.type === "task");
  expect(await frame.getByTestId("timeline-task-label").count()).toBe(tasks.length);
  expect(await frame.locator("[data-row][data-item]").count()).toBe(tasks.reduce((n, task) => n + (task.items?.length ?? 0), 0));
});

// openlore: scenario=AdditionsChangesAndRemovalsAreDistinguishable spec=openwebui-structured-exchange
test("AdditionsChangesAndRemovalsAreDistinguishable: three marks, every element, nothing to apply", async ({ page }) => {
  const { frame, embed } = await show(page, validated(PROPOSAL));
  await expect(frame.locator('[data-element-role="added"]')).toHaveCount(1);
  await expect(frame.locator('[data-element-role="changed"]')).toHaveCount(1);
  await expect(embed.getByTestId("structured-removals")).toContainText("Fax gateway");
  // The change is shown as a transition, from what it is to what it would be.
  await expect(frame.locator('[data-element-role="changed"]')).toContainText("Invoicing service");
  // Every element the proposal carries, context included.
  for (const id of ["invoice", "ledger", "gateway"]) await expect(frame.locator(`[data-element-id="${id}"]`)).toHaveCount(1);
  // Nothing on the page applies it, and nothing asks the chat to send anything.
  await expect(embed.getByRole("button", { name: /apply|approve|accept|merge/i })).toHaveCount(0);
  expect((await received(page)).some((m) => m.type?.startsWith("input:") || m.type === "action:submit")).toBe(false);
});

// openlore: scenario=AFigureIsDownloadedFromTheEmbed spec=openwebui-structured-exchange
test("AFigureIsDownloadedFromTheEmbed: a standalone SVG with every element, from the sandbox", async ({ page }) => {
  const document = conformance("v2-graph-with-viewpoints.json");
  const { embed } = await show(page, validated(document));
  const [download] = await Promise.all([page.waitForEvent("download"), embed.getByRole("button", { name: "⤓ download SVG" }).first().click()]);
  const svg = readFileSync(await download.path(), "utf8");
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  for (const node of document.data.nodes as Array<{ id: string }>) expect(svg, node.id).toContain(`data-element-id="${node.id}"`);
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
});

// openlore: scenario=ATableIsDownloadedFromTheEmbed spec=openwebui-structured-exchange
test("ATableIsDownloadedFromTheEmbed: the shared Markdown export, from the sandbox", async ({ page }) => {
  const document = conformance("table-rows-with-roles.json");
  const envelope = validated(document);
  const { embed } = await show(page, envelope);
  const [download] = await Promise.all([page.waitForEvent("download"), embed.getByRole("button", { name: "⤓ download Markdown" }).click()]);
  const markdown = readFileSync(await download.path(), "utf8");
  const expected = tableMarkdown(envelope.data as StructuredTableData, new Set(), describeStructure(envelope, false).rows);
  expect(markdown).toBe(expected);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
});
