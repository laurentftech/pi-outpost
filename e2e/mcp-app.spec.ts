/**
 * The planning view as an MCP Apps host draws it: the real server in this process, its
 * `ui://` resource in a sandboxed frame, and a host page on the SDK's `AppBridge` that
 * relays the view's tool calls to that server and records everything else the view asks.
 *
 * Needs the view built (`npm run build:viewer --workspace @pi-outpost/mcp`).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { build } from "esbuild";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CREATION_EXAMPLE } from "@pi-outpost/apps-core/descriptions";
import { createServer, viewUriFor } from "../mcp/src/server.ts";
import { LocalPlanningStore } from "../mcp/src/store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEW_FILE = path.join(HERE, "..", "mcp", "dist", "viewer", "planning.html");

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

let hostScript: string;
let folder: string;
let client: Client;
let viewHtml: string;

test.beforeAll(async () => {
  const bundled = await build({ entryPoints: [path.join(HERE, "mcp-host", "host.ts")], bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent" });
  hostScript = bundled.outputFiles[0]!.text;
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-mcp-e2e-"));
  const store = await LocalPlanningStore.open(folder);
  viewHtml = await fs.readFile(VIEW_FILE, "utf8");
  const server = createServer({ store, viewHtml });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "e2e", version: "1" });
  await client.connect(clientSide);
});

test.afterAll(async () => {
  await client?.close();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function json(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content.map((block) => block.text ?? "").join("")) as Record<string, unknown>;
}

async function createPlanning(title: string): Promise<string> {
  const planning = { ...structuredClone(CREATION_EXAMPLE), data: { ...structuredClone(CREATION_EXAMPLE.data), title } };
  return json(await callTool("create_planning", { planning })).id as string;
}

/** Shows `id` in a fresh host page, as a host would after the model called show_planning. */
async function show(page: Page, args: { id?: string; compare_to?: number }, theme: "light" | "dark" = "light", downloadFile = false, tool = "show_planning"): Promise<Frame> {
  await page.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => callTool(params.name, params.arguments ?? {}));
  await page.setContent(`<!doctype html><body style="margin:0;background:${theme === "dark" ? "#1f1f1f" : "#fff"}"><script>${hostScript}</script></body>`);
  const { contents } = await client.readResource({ uri: viewUriFor(viewHtml) });
  const html = (contents[0] as { text: string }).text;
  const toolResult = await callTool(tool, args);
  expect(toolResult.isError).toBeFalsy();
  await page.evaluate(({ html: page, toolInput, toolResult: result, theme: hostTheme, download }) => window.startHost({ html: page, toolInput, toolResult: result as never, theme: hostTheme, downloadFile: download }), {
    html,
    toolInput: args,
    toolResult,
    theme,
    download: downloadFile,
  });
  const frame = page.frameLocator("#view");
  await expect(frame.getByTestId(tool === "list_plannings" ? "planning-list" : "timeline")).toBeVisible();
  return page.frames().find((candidate) => candidate !== page.mainFrame())!;
}

const hostLog = (page: Page) => page.evaluate(() => window.hostLog as Array<{ method: string; params: Record<string, unknown> }>);

// openlore: scenario=TheViewDrawsTheShownPlanning spec=mcp-planning-app
test("TheViewDrawsTheShownPlanning: every task and item of the current revision", async ({ page }) => {
  const id = await createPlanning("Drawn planning");
  const frame = await show(page, { id });
  await expect(frame.getByTestId("timeline-task-label")).toHaveText(["Foundations", "Frame and glazing"]);
  expect(await frame.locator("[data-row][data-item]").count()).toBe(3);
  // The title once: the timeline draws it, the view's header does not repeat it.
  expect(((await frame.locator("body").innerText()).match(/Drawn planning/g) ?? []).length).toBe(1);
  await expect(frame.locator("body")).toContainText("revision 1");
  // The frame is sandboxed without same-origin: it can only talk to the host through the bridge.
  expect(await frame.evaluate(() => window.origin)).toBe("null");
});

// openlore: scenario=AComparisonIsDrawn spec=mcp-planning-app
test("AComparisonIsDrawn: the moved milestone's previous and current positions", async ({ page }) => {
  const id = await createPlanning("Compared planning");
  await callTool("update_planning", { id, base_revision: 1, operations: [{ op: "change_item", id: "inspection", changes: { date: "2031-06-18" } }] });
  const frame = await show(page, { id, compare_to: 1 });
  const inspection = frame.locator('[data-row="1"][data-item="1"]');
  await expect(inspection.locator('[data-previous="true"]')).toHaveCount(1);
  await expect(frame.locator("body")).toContainText("compared with revision 1");
  await expect(frame.getByTestId("timeline-comparison-key")).toBeVisible();
  // Unmoved items have no previous position.
  await expect(frame.locator('[data-row="1"][data-item="0"] [data-previous="true"]')).toHaveCount(0);
});

// openlore: scenario=AClickedMilestoneIsReturnedByGetPlanning spec=mcp-planning-app
test("AClickedMilestoneIsReturnedByGetPlanning: the view's tool call reaches the real server", async ({ page }) => {
  const id = await createPlanning("Clicked planning");
  const frame = await show(page, { id });
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await expect.poll(async () => (await hostLog(page)).filter((entry) => entry.method === "tools/call").length).toBe(1);
  expect((await hostLog(page)).find((entry) => entry.method === "tools/call")?.params).toMatchObject({ name: "select_in_planning", arguments: { id, task: "G1", item: "inspection" } });
  const read = json(await callTool("get_planning", { id }));
  expect(read.selected).toMatch(/^Selected in the view: milestone "Soil inspection" \(inspection\) of task "Foundations" \(G1\), on 2031-05-21, /);

  // Unselecting clears it.
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await expect.poll(async () => (await hostLog(page)).filter((entry) => entry.method === "tools/call").length).toBe(2);
  await expect.poll(async () => json(await callTool("get_planning", { id })).selected).toBeUndefined();
});

// openlore: scenario=ClickingSendsNoMessage spec=mcp-planning-app
test("ClickingSendsNoMessage: model context and the selection tool, never a message", async ({ page }) => {
  const id = await createPlanning("Quiet planning");
  const frame = await show(page, { id });
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await frame.locator('[data-testid="timeline-task-label"]', { hasText: "Frame and glazing" }).click();
  await frame.locator('[data-row="1"][data-item="0"] [data-testid="timeline-hit"]').click();
  await expect.poll(async () => (await hostLog(page)).filter((entry) => entry.method === "ui/update-model-context").length).toBe(3);
  const log = await hostLog(page);
  expect(log.filter((entry) => entry.method === "tools/call").length).toBe(3);
  const contexts = log.filter((entry) => entry.method === "ui/update-model-context").map((entry) => (entry.params.content as Array<{ text: string }>)[0]!.text);
  expect(contexts[0]).toBe(`The user selected milestone "Soil inspection" (inspection) of task "Foundations" (G1), on 2031-05-21, in planning "Quiet planning" (${id}).`);
  expect(contexts[1]).toBe(`The user selected task "Frame and glazing" (G2) in planning "Quiet planning" (${id}).`);
  expect(log.some((entry) => entry.method === "ui/message")).toBe(false);
});

test("the reported size follows the content", async ({ page }) => {
  const id = await createPlanning("Sized planning");
  const frame = await show(page, { id });
  const sizes = async () => (await hostLog(page)).filter((entry) => entry.method === "ui/notifications/size-changed").map((entry) => entry.params.height as number);
  const content = () => frame.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
  await expect.poll(async () => (await sizes()).at(-1)).toBe(await content());
  const before = (await sizes()).at(-1)!;
  expect(before).toBeGreaterThan(150);
  // Details open under the timeline: the view grows, and says so.
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await expect(frame.getByTestId("timeline-details")).toContainText("Soil inspection");
  await expect.poll(async () => (await sizes()).at(-1)).toBeGreaterThan(before);
  await expect.poll(async () => (await sizes()).at(-1)).toBe(await content());
});

test("full screen is asked of the host", async ({ page }) => {
  const id = await createPlanning("Full planning");
  const frame = await show(page, { id });
  await frame.getByRole("button", { name: "Full screen" }).click();
  await expect.poll(async () => (await hostLog(page)).filter((entry) => entry.method === "ui/request-display-mode").map((entry) => entry.params.mode)).toEqual(["fullscreen"]);
  await expect(frame.getByRole("button", { name: "Exit full screen" })).toBeVisible();
});

test("a dark host context keeps the timeline readable", async ({ page }) => {
  const id = await createPlanning("Dark planning");
  const frame = await show(page, { id }, "dark");
  expect(await frame.evaluate(() => document.documentElement.dataset.hostTheme)).toBe("dark");
  const card = await frame.evaluate(() => {
    // Tailwind's colours compute as oklch(): paint each one to read it back as RGB.
    const rgb = (color: string) => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const element = document.querySelector(".planning-card")!;
    const label = document.querySelector('[data-testid="timeline-task-label"]')!;
    return { background: rgb(getComputedStyle(element).backgroundColor), text: rgb(getComputedStyle(label).color) };
  });
  expect(card.background).toEqual([255, 255, 255]);
  // Dark text on the light card.
  for (const channel of card.text) expect(channel).toBeLessThan(110);
});

test("Download SVG saves the figure in the plannings folder when the host cannot download", async ({ page }) => {
  const id = await createPlanning("Exported planning");
  const frame = await show(page, { id });
  await frame.getByTestId("timeline-download-svg").click();
  await expect(frame.getByRole("status")).toHaveText('Saved in your plannings folder as "timeline-Exported-planning.svg"');
  const saved = await fs.readFile(path.join(folder, "timeline-Exported-planning.svg"), "utf8");
  expect(saved).toMatch(/^<svg[\s>]/);
  expect(saved).toContain("Foundations");
});

test("Download SVG goes through the host when it can download", async ({ page }) => {
  const id = await createPlanning("Hosted download");
  const frame = await show(page, { id }, "light", true);
  await frame.getByTestId("timeline-download-svg").click();
  await expect(frame.getByRole("status")).toHaveText("SVG downloaded");
  const request = (await hostLog(page)).find((entry) => entry.method === "ui/download-file")?.params as { contents: Array<{ resource: { uri: string; mimeType: string; text: string } }> };
  expect(request.contents[0]!.resource.uri).toBe("file:///timeline-Hosted-download.svg");
  expect(request.contents[0]!.resource.mimeType).toBe("image/svg+xml");
  expect(request.contents[0]!.resource.text).toContain("Foundations");
  expect((await hostLog(page)).some((entry) => entry.method === "tools/call" && (entry.params as { name?: string }).name === "save_figure")).toBe(false);
});

test("Copy SVG markup works in the sandbox, without the clipboard API", async ({ page }) => {
  const id = await createPlanning("Copied planning");
  const frame = await show(page, { id });
  // The frame is not granted clipboard-write: the API refuses, the fallback copies.
  expect(await frame.evaluate(() => (navigator.clipboard ? navigator.clipboard.writeText("x").then(() => "allowed", () => "refused") : "absent"))).not.toBe("allowed");
  await frame.getByTestId("timeline-copy-svg").click();
  await expect(frame.getByRole("status")).toHaveText("SVG markup copied");
});

// openlore: scenario=TheListShowsTheFolder spec=mcp-planning-app
test("TheListShowsTheFolder: every planning, its revision and file, an unreadable one marked", async ({ page }) => {
  const id = await createPlanning("Listed planning");
  const broken = await createPlanning("Broken planning");
  const brokenFile = json(await callTool("get_planning", { id: broken })).file as string;
  await fs.writeFile(path.join(folder, brokenFile), "{ not json");
  const frame = await show(page, {}, "light", false, "list_plannings");
  const list = frame.getByTestId("planning-list");
  await expect(list).toContainText(path.basename(folder));
  const row = list.locator(`[data-planning="${id}"]`);
  await expect(row).toContainText("Listed planning");
  await expect(row).toContainText("revision 1");
  await expect(row).toContainText("Listed planning.planning.json");
  await expect(row).not.toContainText("unreadable");
  await expect(list.locator(`[data-planning="${broken}"]`)).toContainText("unreadable file");
  // Every planning of the folder, as the server lists them.
  const listed = json(await callTool("list_plannings", {})).plannings as Array<{ id: string }>;
  await expect(list.locator("[data-planning]")).toHaveCount(listed.length);
  await fs.rm(path.join(folder, brokenFile));
});

// openlore: scenario=ChoosingAPlanningDrawsIt spec=mcp-planning-app
test("ChoosingAPlanningDrawsIt: the timeline in place through show_planning, back to the list, no message", async ({ page }) => {
  const id = await createPlanning("Chosen planning");
  const frame = await show(page, {}, "light", false, "list_plannings");
  await frame.locator(`[data-planning="${id}"] button`).click();
  await expect(frame.getByTestId("timeline-task-label")).toHaveText(["Foundations", "Frame and glazing"]);
  await expect(frame.locator("body")).toContainText("Chosen planning");
  const calls = (await hostLog(page)).filter((entry) => entry.method === "tools/call");
  expect(calls.map((entry) => entry.params)).toEqual([expect.objectContaining({ name: "show_planning", arguments: { id } })]);

  // The selection still reaches the server from a timeline opened here.
  await frame.locator('[data-row="1"][data-item="1"] [data-testid="timeline-hit"]').click();
  await expect.poll(async () => json(await callTool("get_planning", { id })).selected).toMatch(/Soil inspection/);

  await frame.getByRole("button", { name: "← All plannings" }).click();
  await expect(frame.getByTestId("planning-list")).toBeVisible();
  await expect(frame.locator(`[data-planning="${id}"]`)).toBeVisible();
  expect((await hostLog(page)).some((entry) => entry.method === "ui/message")).toBe(false);
});

test("a result the view does not know says so, rather than leaving an empty frame", async ({ page }) => {
  await page.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => callTool(params.name, params.arguments ?? {}));
  await page.setContent(`<!doctype html><body style="margin:0"><script>${hostScript}</script></body>`);
  await page.evaluate(
    ({ html }) => window.startHost({ html, toolInput: {}, toolResult: { content: [{ type: "text", text: "?" }], structuredContent: { something: "else" } } as never, theme: "light" }),
    { html: viewHtml },
  );
  await expect(page.frameLocator("#view").getByRole("alert")).toContainText("does not know what it was sent");
});
