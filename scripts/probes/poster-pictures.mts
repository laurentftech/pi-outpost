/**
 * Probe (poster-pictures): can the person put pictures of her own on a poster, and can a
 * drawing the model wrote in SVG be handled as one block — in the posters extension's view,
 * framed as an MCP Apps host frames it (allow-scripts allow-same-origin, as Claude Desktop)?
 *
 *   1. a click on any part of an SVG drawing selects the whole drawing, with resize handles;
 *   2. dragging it moves it;
 *   3. double-clicking an empty picture slot asks for a file, and the picture lands in it,
 *      scaled down to at most 1200 px;
 *   4. the picture button with nothing selected adds the picture to the page;
 *   5. a picture file dropped on the page is placed;
 *   6. saving keeps the pictures, get_poster returns them, and the Word export draws them.
 *
 * Needs the view built: `npm run build:viewer-poster --workspace @pi-outpost/mcp`.
 * Run: node --import tsx scripts/probes/poster-pictures.mts [out-dir]
 * Leaves screenshots and the Word file in out-dir (default: a temporary folder) to look at.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { chromium, type Frame, type Page } from "playwright";
import { build } from "esbuild";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readAllZipEntries } from "../../office/src/zip.ts";
import { createPosterServer, viewUriFor } from "../../mcp/src/posters/server.ts";
import { LocalPosterStore } from "../../mcp/src/posters/store.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? (await fs.mkdtemp(path.join(os.tmpdir(), "poster-pictures-"))));
await fs.mkdir(out, { recursive: true });

// A door drawn the way the guide would ask: a viewBox, no text, its own element.
const DOOR = `<div class="drawing"><svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg">
<rect x="30" y="20" width="140" height="230" rx="10" fill="#8d5524"/>
<rect x="45" y="35" width="110" height="95" rx="6" fill="#a86b32"/>
<rect x="45" y="140" width="110" height="95" rx="6" fill="#a86b32"/>
<circle cx="140" cy="140" r="9" fill="#ffd54f"/>
</svg></div>`;
const POSTER_CSS = `
.poster { width: 100%; height: 100%; padding: 40px; background: #fff; font-family: Verdana, sans-serif; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr 1fr; gap: 24px; }
.poster h1 { grid-column: 1 / 3; margin: 0; text-align: center; font-size: 48px; color: #2e7d32; }
.cell { border: 4px solid #81c784; border-radius: 20px; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.cell h2 { margin: 0; font-size: 28px; }
.drawing { width: 200px; height: 260px; }
.drawing svg { width: 100%; height: 100%; display: block; }
.slot { width: 260px; height: 260px; object-fit: contain; background: #f1f8e9; border: 3px dashed #9fb3cf; }
`;
const POSTER_HTML = `<div class="poster">
<h1>How many…? How much…?</h1>
<div class="cell"><h2>How many doors?</h2>${DOOR}</div>
<div class="cell"><h2>How much bread?</h2><img class="slot" data-poster-picture="bread" alt="bread"></div>
<div class="cell"><h2>How much love?</h2></div>
<div class="cell"><h2>How much sun?</h2></div>
</div>`;

/** A test picture: a big gradient with a disc, so scaling and drawing are both visible. */
async function testPicture(name: string, width: number, height: number, colour: string, kind: "png" | "jpeg"): Promise<string> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colour);
  gradient.addColorStop(1, "#ffffff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#e65100";
  context.beginPath();
  context.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, Math.PI * 2);
  context.fill();
  const file = path.join(out, `${name}.${kind === "png" ? "png" : "jpg"}`);
  await fs.writeFile(file, kind === "png" ? await canvas.encode("png") : await canvas.encode("jpeg", 90));
  return file;
}

const bread = await testPicture("bread", 2400, 1800, "#fbc02d", "png");
const heart = await testPicture("heart", 1600, 1600, "#e91e63", "jpeg");
const sun = await testPicture("sun", 900, 600, "#ffeb3b", "png");

const viewHtml = await fs.readFile(path.join(repo, "mcp/dist/viewer-poster/poster.html"), "utf8");
const hostScript = (await build({ entryPoints: [path.join(repo, "e2e/mcp-host/host.ts")], bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "poster-pictures-store-"));
const server = createPosterServer({ store: await LocalPosterStore.open(folder), viewHtml });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "probe", version: "1" });
await client.connect(clientSide);
type ToolResult = { isError?: boolean; content: Array<{ text?: string }> };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult;
const json = (result: ToolResult) => JSON.parse(result.content.map((block) => block.text ?? "").join("")) as Record<string, unknown>;

const created = await call("create_poster", { title: "How many how much", html: POSTER_HTML, css: POSTER_CSS, format: "A4-portrait" });
assert.ok(!created.isError, JSON.stringify(created.content));
const id = json(created).id as string;

const browser = await chromium.launch();
const page: Page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
await page.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => call(params.name, params.arguments ?? {}));
await page.setContent(`<!doctype html><body style="margin:0"><script>${hostScript}</script></body>`);
const { contents } = await client.readResource({ uri: viewUriFor(viewHtml) });
await page.evaluate(
  ({ html, toolResult }) => window.startHost({ html, toolInput: {}, toolResult: toolResult as never, theme: "light", downloadFile: true, sandbox: "allow-scripts allow-same-origin" }),
  { html: (contents[0] as { text: string }).text, toolResult: await call("show_poster", { id }) },
);
const view = page.frameLocator("#view");
const canvas = view.frameLocator("iframe.gjs-frame");
await canvas.locator(".cell h2").first().waitFor({ timeout: 20_000 });
await page.evaluate(() => {
  (document.querySelector("#view") as HTMLIFrameElement).style.height = "900px";
});
await page.waitForTimeout(800);

async function canvasFrame(): Promise<Frame> {
  for (const frame of page.frames()) if (await frame.$(".poster")) return frame;
  throw new Error("no canvas frame");
}
const viewFrame = page.frames().find((frame) => frame.name() === "" && frame !== page.mainFrame() && frame.url().startsWith("about:srcdoc"))!;
const findings: string[] = [];
const note = (line: string) => {
  findings.push(line);
  console.log(line);
};

// 1. A click on a path of the drawing selects the drawing.
await canvas.locator(".drawing").click({ position: { x: 100, y: 60 } });
await page.waitForTimeout(300);
const selectedName = await (await canvasFrame()).evaluate(() => document.querySelector(".gjs-selected")?.className ?? "nothing");
const handles = await view.locator(".gjs-resizer-h").evaluateAll((all) => all.filter((h) => (h as HTMLElement).offsetParent !== null).length);
note(`1. click on a path selects: "${selectedName?.trim()}", visible resize handles: ${handles}`);

// 2. Dragging the drawing moves it.
const before = await (await canvasFrame()).evaluate(() => document.querySelector(".drawing")!.getBoundingClientRect().toJSON());
const box = (await canvas.locator(".drawing").boundingBox())!;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const after = await (await canvasFrame()).evaluate(() => document.querySelector(".drawing")!.getBoundingClientRect().toJSON());
const cellMoved = await (await canvasFrame()).evaluate(() => getComputedStyle(document.querySelectorAll(".cell")[0]!).transform);
note(`   the card holding it: transform ${cellMoved}`);
note(`2. drag moves the drawing by (${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)})`);

// 3. Double-clicking the empty slot asks for a file.
const chooser = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => undefined);
await canvas.locator("img.slot").dblclick();
const asked = await chooser;
note(`3. double-click on the slot opens a file chooser: ${Boolean(asked)}`);
if (asked) await asked.setFiles(bread);
await canvas.locator("img.slot[src^='data:image/png']").waitFor({ timeout: 5000 }).catch(() => undefined);
const slot = await (await canvasFrame()).evaluate(() => {
  const image = document.querySelector("img.slot") as HTMLImageElement;
  const look = getComputedStyle(image);
  return { prefix: image.src.slice(0, 22), natural: [image.naturalWidth, image.naturalHeight], kb: Math.round(image.src.length / 1024), border: look.borderTopStyle, background: look.backgroundColor };
});
note(`   filled slot: border ${slot.border}, background ${slot.background}`);
note(`   status: ${(await view.locator(".poster-status").textContent())?.trim()}`);
note(`   the slot now holds ${slot.prefix}… ${slot.natural.join("×")} px, ${slot.kb} kB as data`);

// 4. The picture button with nothing selected adds a picture to the page.
await canvas.locator(".poster h1").click({ position: { x: 4, y: 4 } });
await page.keyboard.press("Escape");
await (await canvasFrame()).evaluate(() => undefined);
const chooser2 = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => undefined);
await view.locator("button[data-action=picture]").click();
const asked2 = await chooser2;
note(`4. the picture button opens a file chooser: ${Boolean(asked2)}`);
if (asked2) await asked2.setFiles(heart);
await page.waitForTimeout(800);
const added = await (await canvasFrame()).evaluate(() => [...document.querySelectorAll("img")].filter((image) => !image.classList.contains("slot")).map((image) => ({ prefix: (image as HTMLImageElement).src.slice(0, 23), natural: [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight] })));
note(`   status: ${(await view.locator(".poster-status").textContent())?.trim()}`);
note(`   pictures added: ${JSON.stringify(added)}`);

// 5. A picture file dropped on the page is placed.
const sunBytes = await fs.readFile(sun);
await (await canvasFrame()).evaluate(async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], "sun.png", { type: "image/png" }));
  const target = document.querySelectorAll(".cell")[3]!;
  const { x, y, width, height } = target.getBoundingClientRect();
  const at = { clientX: x + width / 2, clientY: y + height / 2 };
  target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }));
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }));
}, sunBytes.toString("base64"));
await page.waitForTimeout(800);
const images = await (await canvasFrame()).evaluate(() => document.querySelectorAll("img").length);
note(`   status: ${(await view.locator(".poster-status").textContent())?.trim()}`);
note(`5. after a drop the page holds ${images} pictures (expected 3)`);
await page.screenshot({ path: path.join(out, "editor.png") });

// 5b. A placed picture can be dragged and resized.
const placed = canvas.locator("img:not(.slot)").first();
await placed.click();
const imageBox = (await placed.boundingBox())!;
const imageBefore = await (await canvasFrame()).evaluate(() => (document.querySelector("img:not(.slot)") as HTMLElement).getBoundingClientRect().toJSON());
await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
await page.mouse.down();
await page.mouse.move(imageBox.x + imageBox.width / 2 + 50, imageBox.y + imageBox.height / 2 + 120, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
note(`    after drag only: ${JSON.stringify(await (await canvasFrame()).evaluate(() => (document.querySelector("img:not(.slot)") as HTMLElement).getBoundingClientRect().toJSON()))} before ${JSON.stringify(imageBefore)}`);
const corner = view.locator(".gjs-resizer-h-br");
const cornerBox = (await corner.boundingBox())!;
await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2);
await page.mouse.down();
await page.mouse.move(cornerBox.x - 40, cornerBox.y - 10, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const imageAfter = await (await canvasFrame()).evaluate(() => (document.querySelector("img:not(.slot)") as HTMLElement).getBoundingClientRect().toJSON());
note(`    style after drag: ${await (await canvasFrame()).evaluate(() => (document.querySelector("img:not(.slot)") as HTMLElement).getAttribute("style") + " | " + getComputedStyle(document.querySelector("img:not(.slot)")!).transform + " | left " + getComputedStyle(document.querySelector("img:not(.slot)")!).left)}`);
note(`    zoom: ${await page.evaluate(() => 0)}`);
note(`5b. picture moved by (${Math.round(imageAfter.x - imageBefore.x)}, ${Math.round(imageAfter.y - imageBefore.y)}), size ${Math.round(imageBefore.width)}×${Math.round(imageBefore.height)} → ${Math.round(imageAfter.width)}×${Math.round(imageAfter.height)}`);
await page.screenshot({ path: path.join(out, "editor-after-moves.png") });

// 6. Saved, read back, exported.
await view.locator("button[data-action=save]").click();
await view.locator(".poster-status[data-kind=ok]").waitFor({ timeout: 10_000 }).catch(() => undefined);
note(`6. save: "${(await view.locator(".poster-status").textContent())?.trim()}"`);
const readBack = json(await call("get_poster", { id }));
const html = String(readBack.html ?? "");
note(`   get_poster: ${(html.match(/data:image\//g) ?? []).length} embedded pictures, ${Math.round(html.length / 1024)} kB of markup returned to the model`);
const download = page.waitForEvent("console", { timeout: 1 }).catch(() => undefined);
void download;
await view.locator("button[data-action=word]").click();
await page.waitForFunction(() => (window as unknown as { hostLog: Array<{ method: string }> }).hostLog.some((entry) => entry.method === "ui/download-file"), undefined, { timeout: 30_000 });
const delivered = await page.evaluate(() => (window as unknown as { hostLog: Array<{ method: string; params: unknown }> }).hostLog.find((entry) => entry.method === "ui/download-file")!.params);
const resource = JSON.stringify(delivered);
const blob = /"blob":"([^"]+)"/.exec(resource)?.[1];
if (blob) {
  const docx = Buffer.from(blob, "base64");
  await fs.writeFile(path.join(out, "poster.docx"), docx);
  const media = [...readAllZipEntries(docx, { maxEntries: 200, maxEntryBytes: 50_000_000, maxTotalBytes: 100_000_000 }).entries()].filter(([name]) => name.startsWith("word/media/"));
  for (const [name, bytes] of media) await fs.writeFile(path.join(out, path.basename(name)), bytes);
  note(`   Word export: ${media.map(([name, bytes]) => `${name} ${Math.round(bytes.length / 1024)} kB`).join(", ")}`);
} else {
  note(`   Word export: no blob found in ${resource.slice(0, 200)}`);
}

// 7. Reopened, a placed picture still follows the mouse.
const page2: Page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
await page2.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => call(params.name, params.arguments ?? {}));
await page2.setContent(`<!doctype html><body style="margin:0"><script>${hostScript}</script></body>`);
await page2.evaluate(
  ({ html, toolResult }) => window.startHost({ html, toolInput: {}, toolResult: toolResult as never, theme: "light", downloadFile: true, sandbox: "allow-scripts allow-same-origin" }),
  { html: (contents[0] as { text: string }).text, toolResult: await call("show_poster", { id }) },
);
const view2 = page2.frameLocator("#view");
const canvas2 = view2.frameLocator("iframe.gjs-frame");
await canvas2.locator(".cell h2").first().waitFor({ timeout: 20_000 });
await page2.evaluate(() => {
  (document.querySelector("#view") as HTMLIFrameElement).style.height = "900px";
});
await page2.waitForTimeout(800);
const frame2 = async () => {
  for (const frame of page2.frames()) if (await frame.$(".poster")) return frame;
  throw new Error("no canvas frame");
};
const reopened = canvas2.locator("img:not(.slot)").last();
await reopened.click();
const r1 = await (await frame2()).evaluate(() => [...document.querySelectorAll("img:not(.slot)")].at(-1)!.getBoundingClientRect().toJSON());
const rb = (await reopened.boundingBox())!;
await page2.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await page2.mouse.down();
await page2.mouse.move(rb.x + rb.width / 2 - 50, rb.y + rb.height / 2 - 60, { steps: 8 });
await page2.mouse.up();
await page2.waitForTimeout(300);
const r2 = await (await frame2()).evaluate(() => [...document.querySelectorAll("img:not(.slot)")].at(-1)!.getBoundingClientRect().toJSON());
note(`7. reopened, the picture moved by (${Math.round(r2.x - r1.x)}, ${Math.round(r2.y - r1.y)}) for a mouse move of (-50, -60) on screen`);
await page2.screenshot({ path: path.join(out, "reopened.png") });

void viewFrame;
await fs.writeFile(path.join(out, "findings.txt"), `${findings.join("\n")}\n`);
console.log(`\nscreenshots and files in ${out}`);
await browser.close();
await client.close();
await fs.rm(folder, { recursive: true, force: true });
