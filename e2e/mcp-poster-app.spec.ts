/**
 * The posters extension's editor as an MCP Apps host draws it: the real server in this
 * process, its `ui://` view in a frame sandboxed as the MCP Apps specification says
 * (`allow-scripts allow-same-origin`; GrapesJS draws in a nested frame it must reach), and
 * the SDK's AppBridge relaying the view's tool calls and recording what it asks the host.
 *
 * Needs the view built (`npm run build:viewer-poster --workspace @pi-outpost/mcp`).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";
import { POSTER_EXAMPLE } from "@pi-outpost/posters/guide";
import { createPosterServer, viewUriFor } from "../mcp/src/posters/server.ts";
import { LocalPosterStore } from "../mcp/src/posters/store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEW_FILE = path.join(HERE, "..", "mcp", "dist", "viewer-poster", "poster.html");
const SAME_ORIGIN = "allow-scripts allow-same-origin";

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
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-posters-e2e-"));
  viewHtml = await fs.readFile(VIEW_FILE, "utf8");
  const server = createPosterServer({ store: await LocalPosterStore.open(folder), viewHtml });
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

async function createPoster(title: string): Promise<string> {
  return json(await callTool("create_poster", { title, html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format })).id as string;
}

interface Shown {
  view: FrameLocator;
  canvas: FrameLocator;
}

/** Shows `id` in a fresh host page, as Claude Desktop would after the model called show_poster. */
async function show(page: Page, id: string, theme: "light" | "dark" = "light"): Promise<Shown> {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => callTool(params.name, params.arguments ?? {}));
  await page.setContent(`<!doctype html><body style="margin:0;background:${theme === "dark" ? "#1f1f1f" : "#fff"}"><script>${hostScript}</script></body>`);
  const { contents } = await client.readResource({ uri: viewUriFor(viewHtml) });
  const html = (contents[0] as { text: string }).text;
  const toolResult = await callTool("show_poster", { id });
  expect(toolResult.isError).toBeFalsy();
  await page.evaluate(
    ({ html: view, toolResult: result, theme: hostTheme, sandbox }) => window.startHost({ html: view, toolInput: {}, toolResult: result as never, theme: hostTheme, downloadFile: true, sandbox }),
    { html, toolResult, theme, sandbox: SAME_ORIGIN },
  );
  // Claude's conversation column is about this wide.
  await page.evaluate(() => ((document.getElementById("view") as HTMLIFrameElement).style.width = "1000px"));
  const view = page.frameLocator("#view");
  const canvas = view.frameLocator("iframe.gjs-frame");
  await expect(canvas.locator(".rule h2").first()).toBeVisible({ timeout: 20_000 });
  await expect(view.locator(".poster-status")).toContainText("Double-click a text");
  return { view, canvas };
}

const hostLog = (page: Page) => page.evaluate(() => window.hostLog as Array<{ method: string; params: Record<string, unknown> }>);

/** The canvas frame itself, to evaluate in: the one frame holding the poster's page. */
async function canvasFrame(page: Page) {
  for (const frame of page.frames()) {
    if (await frame.evaluate(() => document.querySelector('[data-gjs-type="wrapper"] .poster') !== null).catch(() => false)) return frame;
  }
  throw new Error("no canvas frame holds the poster");
}

async function rewrite(page: Page, canvas: FrameLocator, selector: string, text: string) {
  const target = canvas.locator(selector);
  await target.click();
  await target.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
  // Leaving the text ends the edit.
  await canvas.locator(".motto").click();
}

// openlore: scenario=ThePageFitsWhenOpened spec=poster-editor
test("ThePageFitsWhenOpened: the whole page is in view, its CSS-variable colours drawn", async ({ page }) => {
  const id = await createPoster("Fits when opened");
  const { view } = await show(page, id);
  const area = (await view.locator(".poster-canvas").boundingBox())!;
  const frame = (await view.locator("iframe.gjs-frame").boundingBox())!;
  const pageBox = await (await canvasFrame(page)).evaluate(() => {
    const wrapper = document.querySelector('[data-gjs-type="wrapper"]')!.getBoundingClientRect();
    return { width: wrapper.width, height: wrapper.height };
  });
  // The page, at the zoom fit chose, lies inside the visible canvas area.
  const zoom = frame.width / 794;
  expect(frame.y).toBeGreaterThanOrEqual(area.y - 1);
  expect(frame.y + pageBox.height * zoom).toBeLessThanOrEqual(area.y + area.height + 1);
  expect(frame.x).toBeGreaterThanOrEqual(area.x - 1);
  expect(frame.x + frame.width).toBeLessThanOrEqual(area.x + area.width + 1);
  // Colours given through var(--c) are drawn, not dropped by the parser.
  const border = await (await canvasFrame(page)).evaluate(() => getComputedStyle(document.querySelector(".rule.c2")!).borderTopColor);
  expect(border).toBe("rgb(79, 195, 247)");
});

// openlore: scenario=ALongerTextRewraps spec=poster-editor
// openlore: scenario=TheModelReadsTheTouchUps spec=poster-editor
test("ALongerTextRewraps and TheModelReadsTheTouchUps: the text wraps in its card, and saving reaches the model", async ({ page }) => {
  const id = await createPoster("Rewraps");
  const { view, canvas } = await show(page, id);
  await rewrite(page, canvas, ".rule.c3 h2", "I am kind and I respect everyone in our class");
  const fit = await (await canvasFrame(page)).evaluate(() => {
    const card = document.querySelector(".rule.c3")!;
    const title = card.querySelector("h2")!;
    const cardBox = card.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    // More than one line: a single line of 32 px type is under 1.5 times its size.
    return { wrapped: titleBox.height > parseFloat(getComputedStyle(title).fontSize) * 1.5, inside: titleBox.right <= cardBox.right + 0.5, overflow: card.scrollWidth > card.clientWidth };
  });
  expect(fit.inside).toBe(true);
  expect(fit.overflow).toBe(false);
  expect(fit.wrapped).toBe(true);
  await view.locator('button[data-action="save"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Saved \(revision 2\)\. Claude will start from this version\./);
  const read = json(await callTool("get_poster", { id }));
  expect(read.revision).toBe(2);
  expect(read.last_changed_by).toBe("the user, in the editor");
  expect(read.html).toContain("I am kind and I respect everyone in our class");
});

// openlore: scenario=APictogramIsMoved spec=poster-editor
test("APictogramIsMoved: a dragged pictogram moves by the distance dragged, the others stay", async ({ page }) => {
  const id = await createPoster("Moves");
  const { view, canvas } = await show(page, id);
  const positions = async () => (await canvasFrame(page)).evaluate(() => [...document.querySelectorAll(".star, .icon")].map((element) => element.getBoundingClientRect()).map(({ x, y }) => [Math.round(x), Math.round(y)]));
  const before = await positions();
  const star = canvas.locator(".star").first();
  await star.click();
  const box = (await star.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const after = await positions();
  const zoom = ((await view.locator("iframe.gjs-frame").boundingBox())!.width) / 794;
  // In page pixels, the star moved by the screen distance over the zoom.
  expect(after[0]![0]! - before[0]![0]!).toBeCloseTo(60 / zoom, -1);
  expect(after[0]![1]! - before[0]![1]!).toBeCloseTo(40 / zoom, -1);
  expect(after.slice(1)).toEqual(before.slice(1));
  await view.locator('button[data-action="save"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Saved/);
  expect(json(await callTool("get_poster", { id })).css).toMatch(/translate/);
});

// openlore: scenario=AColourChangeTouchesOneElement spec=poster-editor
test("AColourChangeTouchesOneElement: a background set in the style panel changes that card only", async ({ page }) => {
  const id = await createPoster("One colour");
  const { view, canvas } = await show(page, id);
  await canvas.locator(".rule.c2").click({ position: { x: 6, y: 6 } });
  await view.locator('button[data-action="style"]').click();
  const input = view.locator(".gjs-sm-property__background-color input").first();
  await input.fill("#ff0000");
  await input.press("Enter");
  // The style manager applies the value asynchronously: read it once it has landed, not right after Enter.
  const backgrounds = async () => (await canvasFrame(page)).evaluate(() => [...document.querySelectorAll(".rule")].map((card) => getComputedStyle(card).backgroundColor));
  await expect.poll(backgrounds).toEqual(["rgb(255, 255, 255)", "rgb(255, 0, 0)", "rgb(255, 255, 255)", "rgb(255, 255, 255)"]);
});

// openlore: scenario=AnEditIsUndone spec=poster-editor
test("AnEditIsUndone: undo puts the text back", async ({ page }) => {
  const id = await createPoster("Undo");
  const { view, canvas } = await show(page, id);
  await rewrite(page, canvas, ".rule.c1 h2", "Changed");
  await expect(canvas.locator(".rule.c1 h2")).toHaveText("Changed");
  await view.locator('button[data-action="undo"]').click();
  await expect(canvas.locator(".rule.c1 h2")).toHaveText("I raise my hand");
  await view.locator('button[data-action="redo"]').click();
  await expect(canvas.locator(".rule.c1 h2")).toHaveText("Changed");
});

// openlore: scenario=TheModelChangedThePosterMeanwhile spec=poster-editor
test("TheModelChangedThePosterMeanwhile: a stale save is refused, naming the newer revision, which is kept", async ({ page }) => {
  const id = await createPoster("Stale");
  const { view, canvas } = await show(page, id);
  const read = json(await callTool("get_poster", { id }));
  await callTool("update_poster", { id, base_revision: 1, html: (read.html as string).replace("Together", "Model's motto"), css: read.css, format: "A4-portrait" });
  await rewrite(page, canvas, ".rule.c1 h2", "My edit");
  await view.locator('button[data-action="save"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Not saved: .*revision 2.*made by the model/);
  const now = json(await callTool("get_poster", { id }));
  expect(now.revision).toBe(2);
  expect(now.html).toContain("Model's motto");
  expect(now.html).not.toContain("My edit");
});

// openlore: scenario=InlineThePageHasTheRoom spec=poster-editor
// openlore: scenario=InlineTheEditorIsSeen spec=poster-editor
test("InlineThePageHasTheRoom and InlineTheEditorIsSeen: inline, the panel is closed and the editor keeps its own height", async ({ page }) => {
  const id = await createPoster("Inline");
  const { view } = await show(page, id);
  await expect(view.locator(".poster-side")).toBeHidden();
  // Claude reads the frame's height from the page itself.
  const ownHeight = await page.frames().find((frame) => frame.parentFrame() === page.mainFrame())!.evaluate(() => document.documentElement.scrollHeight);
  expect(ownHeight).toBeGreaterThanOrEqual(760);
  await view.locator('button[data-action="style"]').click();
  await expect(view.locator(".poster-side")).toBeVisible();
  await view.locator('button[data-action="style"]').click();
  await expect(view.locator(".poster-side")).toBeHidden();
  // Full screen opens it, and leaves room above Claude's reply bar.
  await view.locator('button[data-action="fullscreen"]').click();
  await expect.poll(async () => (await hostLog(page)).filter((entry) => entry.method === "ui/request-display-mode").map((entry) => entry.params.mode)).toEqual(["fullscreen"]);
  await expect(view.locator(".poster-side")).toBeVisible();
  const padding = await page.frames().find((frame) => frame.parentFrame() === page.mainFrame())!.evaluate(() => getComputedStyle(document.querySelector(".poster-shell")!).paddingBottom);
  expect(padding).toBe("96px");
});

// openlore: scenario=FullScreenLeavesTheReplyBarClear spec=poster-editor
test("FullScreenLeavesTheReplyBarClear: in full screen the editor ends 96 px above the window's bottom", async ({ page }) => {
  const id = await createPoster("Full screen");
  const { view } = await show(page, id);
  await view.locator('button[data-action="fullscreen"]').click();
  await page.evaluate(() => ((document.getElementById("view") as HTMLIFrameElement).style.height = "900px"));
  const viewFrame = page.frames().find((frame) => frame.parentFrame() === page.mainFrame())!;
  await expect.poll(() => viewFrame.evaluate(() => document.documentElement.dataset.display)).toBe("fullscreen");
  const bottom = await viewFrame.evaluate(() => ({ status: document.querySelector(".poster-status")!.getBoundingClientRect().bottom, window: innerHeight }));
  expect(bottom.window - bottom.status).toBeGreaterThanOrEqual(95);
});

// openlore: scenario=TheThemeChangesWhileOpen spec=poster-editor
test("TheThemeChangesWhileOpen: the editor turns dark, the poster keeps its colours", async ({ page }) => {
  const id = await createPoster("Theme");
  const { view } = await show(page, id);
  const barBefore = await view.locator(".poster-bar").evaluate((bar) => getComputedStyle(bar.closest("body")!).backgroundColor);
  const posterBefore = await (await canvasFrame(page)).evaluate(() => getComputedStyle(document.querySelector(".poster")!).backgroundColor);
  await page.evaluate(() => window.setHostTheme("dark"));
  await expect.poll(() => view.locator(".poster-bar").evaluate((bar) => getComputedStyle(bar.closest("body")!).backgroundColor)).not.toBe(barBefore);
  expect(await (await canvasFrame(page)).evaluate(() => getComputedStyle(document.querySelector(".poster")!).backgroundColor)).toBe(posterBefore);
});

// openlore: scenario=TheBottomOfAZoomedPageIsReachable spec=poster-editor
test("TheBottomOfAZoomedPageIsReachable: scrolling over a zoomed page brings its bottom into view", async ({ page }) => {
  const id = await createPoster("Scroll");
  const { view, canvas } = await show(page, id);
  await view.locator('button[data-action="zoom-in"]').click();
  await view.locator('button[data-action="zoom-in"]').click();
  await view.locator('button[data-action="zoom-in"]').click();
  const area = (await view.locator(".poster-canvas").boundingBox())!;
  const motto = canvas.locator(".motto");
  const below = async () => (await motto.boundingBox())!.y > area.y + area.height;
  expect(await below()).toBe(true);
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  for (let i = 0; i < 30 && (await below()); i++) await page.mouse.wheel(0, 200);
  const box = (await motto.boundingBox())!;
  expect(box.y).toBeLessThan(area.y + area.height);
  expect(box.y).toBeGreaterThan(area.y);
});

// openlore: scenario=AWordExportIsDownloaded spec=mcp-poster-app
// openlore: scenario=TheExportMatchesTheEditor spec=poster-documents
test("AWordExportIsDownloaded and TheExportMatchesTheEditor: kept in the folder, downloaded under the poster's name, unsaved edits included", async ({ page }) => {
  const id = await createPoster("Prepositions of Place");
  const { view, canvas } = await show(page, id);
  await view.locator('button[data-action="word"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Downloaded, and kept in your posters folder as "Prepositions of Place\.docx"\./, { timeout: 30_000 });
  await rewrite(page, canvas, ".rule.c1 h2", "An edit that was never saved");
  await view.locator('button[data-action="word"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/as "Prepositions of Place \(2\)\.docx"/, { timeout: 30_000 });
  const downloads = (await hostLog(page)).filter((entry) => entry.method === "ui/download-file");
  const resources = downloads.map((entry) => (entry.params.contents as Array<{ resource: { uri: string; mimeType: string; blob: string } }>)[0]!.resource);
  expect(resources.map((resource) => resource.uri)).toEqual(["file:///Prepositions of Place.docx", "file:///Prepositions of Place.docx"]);
  expect(resources[0]!.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const limits = { maxEntries: 50, maxInflatedBytes: 60_000_000, maxTotalBytes: 100_000_000 };
  const picture = (bytes: Buffer) => readAllZipEntries(bytes, limits).get("word/media/poster.png")!;
  const first = picture(await fs.readFile(path.join(folder, "Prepositions of Place.docx")));
  const second = picture(await fs.readFile(path.join(folder, "Prepositions of Place (2).docx")));
  expect(first.readUInt32BE(16)).toBe(2481);
  expect(first.readUInt32BE(20)).toBe(3509);
  // The unsaved edit is in the second picture: the two differ, and the poster was never saved.
  expect(first.equals(second)).toBe(false);
  expect(json(await callTool("get_poster", { id })).revision).toBe(1);
  // The HTML export holds the edited text itself.
  await view.locator('button[data-action="html"]').click();
  await expect.poll(async () => (await hostLog(page)).filter((entry) => entry.method === "ui/download-file").length).toBe(3);
  const html = ((await hostLog(page)).filter((entry) => entry.method === "ui/download-file")[2]!.params.contents as Array<{ resource: { blob: string } }>)[0]!.resource.blob;
  expect(Buffer.from(html, "base64").toString("utf8")).toContain("An edit that was never saved");
});

test("Monkey: double-clicking Save adds one revision; theme, full screen and export during a save change nothing saved", async ({ page }) => {
  const id = await createPoster("Monkey");
  const { view, canvas } = await show(page, id);
  await rewrite(page, canvas, ".rule.c4 h2", "Double save");
  await view.locator('button[data-action="save"]').dblclick();
  await page.evaluate(() => window.setHostTheme("dark"));
  await view.locator('button[data-action="fullscreen"]').click();
  await view.locator('button[data-action="powerpoint"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Downloaded|kept/, { timeout: 30_000 });
  const read = json(await callTool("get_poster", { id }));
  expect(read.revision).toBe(2);
  expect(read.html).toContain("Double save");
  const saves = (await hostLog(page)).filter((entry) => entry.method === "tools/call" && (entry.params as { name: string }).name === "save_poster");
  expect(saves.length).toBe(1);
  // A second save from the same card goes from the revision it saved, not the one it opened.
  await rewrite(page, canvas, ".rule.c4 h2", "Saved twice in a row");
  await view.locator('button[data-action="save"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Saved \(revision 3\)/);
});
