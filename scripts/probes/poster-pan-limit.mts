/**
 * Probe (poster-insert): can the page be scrolled out of the editor's view? Scrolls far in all
 * four directions, zoomed in and fitted, and reports where the page ends up against the visible
 * area. Needs the view built (`npm run build:viewer-poster --workspace @pi-outpost/mcp`).
 * Run: node --import tsx scripts/probes/poster-pan-limit.mts
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "esbuild";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { POSTER_EXAMPLE } from "../../posters/src/guide.ts";
import { createPosterServer, viewUriFor } from "../../mcp/src/posters/server.ts";
import { LocalPosterStore } from "../../mcp/src/posters/store.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const viewHtml = await fs.readFile(path.join(repo, "mcp/dist/viewer-poster/poster.html"), "utf8");
const hostScript = (await build({ entryPoints: [path.join(repo, "e2e/mcp-host/host.ts")], bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "poster-pan-"));
const server = createPosterServer({ store: await LocalPosterStore.open(folder), viewHtml });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "probe", version: "1" });
await client.connect(clientSide);
const call = async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<{ content: Array<{ text?: string }> }>;
const id = (JSON.parse((await call("create_poster", { title: "Pan", html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format })).content[0]!.text!) as { id: string }).id;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
await page.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => call(params.name, params.arguments ?? {}));
await page.setContent(`<!doctype html><body style="margin:0"><script>${hostScript}</script></body>`);
const { contents } = await client.readResource({ uri: viewUriFor(viewHtml) });
await page.evaluate(({ html, toolResult }) => window.startHost({ html, toolInput: {}, toolResult: toolResult as never, theme: "light", downloadFile: true, sandbox: "allow-scripts allow-same-origin" }), { html: (contents[0] as { text: string }).text, toolResult: await call("show_poster", { id }) });
await page.evaluate(() => ((document.querySelector("#view") as HTMLIFrameElement).style.height = "900px"));
const view = page.frameLocator("#view");
await view.frameLocator("iframe.gjs-frame").locator(".rule h2").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
const where = async () => {
  const area = (await view.locator(".poster-canvas").boundingBox())!;
  const frame = (await view.locator("iframe.gjs-frame").boundingBox())!;
  const pageHeight = frame.width * (1123 / 794);
  return { left: Math.round(frame.x - area.x), right: Math.round(area.x + area.width - (frame.x + frame.width)), top: Math.round(frame.y - area.y), bottom: Math.round(area.y + area.height - (frame.y + pageHeight)) };
};
const area = (await view.locator(".poster-canvas").boundingBox())!;
for (const zoomed of [false, true]) {
  if (zoomed) for (let i = 0; i < 3; i++) await view.locator('button[data-action="zoom-in"]').click();
  for (const [name, dx, dy] of [["right", 3000, 0], ["left", -3000, 0], ["down", 0, 3000], ["up", 0, -3000]] as const) {
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    for (let i = 0; i < 15; i++) await page.mouse.wheel(dx / 15, dy / 15);
    await page.waitForTimeout(300);
    console.log(`${zoomed ? "zoomed" : "fitted"}, scrolled ${name}: page edges from the area's (positive = inside)`, JSON.stringify(await where()));
  }
}
await browser.close();
await client.close();
await fs.rm(folder, { recursive: true, force: true });
