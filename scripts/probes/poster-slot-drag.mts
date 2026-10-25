/**
 * Probe (poster-pictures): a picture placed in a slot the model laid out (a static <img> in
 * a card) disappeared when dragged in Claude Desktop. Reproduces that drag in the MCP host
 * frame and reports where the picture went and what GrapesJS wrote.
 *
 * Needs the view built: `npm run build:viewer-poster --workspace @pi-outpost/mcp`.
 * Run: node --import tsx scripts/probes/poster-slot-drag.mts [out-dir] [poster.html]
 * With a poster file, drags the first slot of that poster instead of the built-in one.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { chromium, type Frame } from "playwright";
import { build } from "esbuild";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readPage } from "../../posters/src/format.ts";
import { createPosterServer, viewUriFor } from "../../mcp/src/posters/server.ts";
import { LocalPosterStore } from "../../mcp/src/posters/store.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? (await fs.mkdtemp(path.join(os.tmpdir(), "poster-slot-drag-"))));
await fs.mkdir(out, { recursive: true });

const CSS = `.poster { width: 100%; height: 100%; padding: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.cell { border: 4px solid #81c784; border-radius: 20px; padding: 16px; display: flex; flex-direction: column; align-items: center; }
.slot { width: 260px; height: 260px; object-fit: contain; background: #f1f8e9; }`;
const HTML = `<div class="poster"><div class="cell"><h2>Bread</h2><img class="slot" alt="bread"></div><div class="cell"><h2>Sun</h2></div></div>`;
const given = process.argv[3] ? readPage(await fs.readFile(process.argv[3], "utf8")) : undefined;

const canvas = createCanvas(800, 600);
const context = canvas.getContext("2d");
context.fillStyle = "#fbc02d";
context.fillRect(0, 0, 800, 600);
const file = path.join(out, "bread.png");
await fs.writeFile(file, await canvas.encode("png"));

const viewHtml = await fs.readFile(path.join(repo, "mcp/dist/viewer-poster/poster.html"), "utf8");
const hostScript = (await build({ entryPoints: [path.join(repo, "e2e/mcp-host/host.ts")], bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "poster-slot-store-"));
const server = createPosterServer({ store: await LocalPosterStore.open(folder), viewHtml });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "probe", version: "1" });
await client.connect(clientSide);
const call = async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<{ content: Array<{ text?: string }> }>;
const id = (JSON.parse((await call("create_poster", { title: "Slot drag", html: given?.html ?? HTML, css: given?.css ?? CSS, format: given?.format ?? "A4-portrait" })).content[0]!.text!) as { id: string }).id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
await page.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => call(params.name, params.arguments ?? {}));
await page.setContent(`<!doctype html><body style="margin:0"><script>${hostScript}</script></body>`);
const { contents } = await client.readResource({ uri: viewUriFor(viewHtml) });
await page.evaluate(
  ({ html, toolResult }) => window.startHost({ html, toolInput: {}, toolResult: toolResult as never, theme: "light", downloadFile: true, sandbox: "allow-scripts allow-same-origin" }),
  { html: (contents[0] as { text: string }).text, toolResult: await call("show_poster", { id }) },
);
await page.evaluate(() => {
  (document.querySelector("#view") as HTMLIFrameElement).style.height = "900px";
});
const view = page.frameLocator("#view");
const gjs = view.frameLocator("iframe.gjs-frame");
await gjs.locator("img.slot").first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(800);
const frame = async (): Promise<Frame> => {
  for (const candidate of page.frames()) if (await candidate.$("img.slot")) return candidate;
  throw new Error("no canvas frame");
};
const chooser = page.waitForEvent("filechooser");
await gjs.locator("img.slot").first().dblclick();
await (await chooser).setFiles(file);
await gjs.locator("img.slot[src^='data:']").first().waitFor();
const state = async () => (await frame()).evaluate(() => {
  const image = document.querySelector("img.slot") as HTMLElement | null;
  if (!image) return "gone from the page";
  const { x, y, width, height } = image.getBoundingClientRect();
  return `at (${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}×${Math.round(height)}, transform ${getComputedStyle(image).transform}, parent ${image.parentElement?.className}`;
});
console.log("before:", await state());
await gjs.locator("img.slot").first().click();
const box = (await gjs.locator("img.slot").first().boundingBox())!;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
console.log("after: ", await state());
await page.screenshot({ path: path.join(out, "after-drag.png") });
console.log(`screenshot in ${out}`);
await browser.close();
await client.close();
await fs.rm(folder, { recursive: true, force: true });
