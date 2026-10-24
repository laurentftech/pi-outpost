/**
 * Probe for poster-editor task 1.2: does the poster editor run in an Open WebUI tool embed?
 *
 * Open WebUI 0.12.3 draws a tool's embed in a srcdoc frame (ToolCallDisplay →
 * FullHeightIframe) sandboxed `allow-scripts allow-popups allow-downloads`, plus
 * `allow-same-origin` only when the user turned on "iframe sandbox allow same origin"
 * (off by default), plus `allow-forms` when that setting is on (off for tool calls).
 * This reproduces both frames exactly, with a page as large as the real embed (GrapesJS
 * inlined, about 2.4 MB), and reports whether GrapesJS can reach its canvas and edit, and
 * whether the page can tell beforehand (the check the read-only fallback needs).
 *
 * Run: node --import tsx scripts/probes/poster-owui-sandbox.mts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = await build({ entryPoints: [path.join(here, "poster-isolation", "editor.ts")], bundle: true, format: "iife", write: false, outdir: "out", logLevel: "silent" });
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text.replace(/<\/script/gi, "<\\/script");
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
// The check the embed makes before choosing editor or read-only: can this page reach a frame it creates?
const canNest = `(() => { const f = document.createElement("iframe"); document.body.append(f); const ok = !!f.contentDocument; f.remove(); return ok; })()`;
const page = `<!doctype html><html><head><style>html,body{height:100%;margin:0}.gjs-cv-canvas{width:100%;height:100%;top:0}${css}</style></head><body><div id="gjs"></div>
<script>window.addEventListener("load", () => parent.postMessage({ type: "can-nest", value: ${canNest} }, "*"));</script>
<script>${js}</script></body></html>`;

const browser = await chromium.launch();
for (const sandbox of ["allow-scripts allow-popups allow-downloads", "allow-scripts allow-same-origin allow-popups allow-downloads"]) {
  const tab = await browser.newPage();
  const errors: string[] = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.setContent(`<!doctype html><body style="margin:0"><script>window.messages=[];addEventListener("message",(e)=>window.messages.push(e.data));</script><iframe id="embed" sandbox="${sandbox}" style="width:900px;height:800px;border:0"></iframe></body>`);
  await tab.evaluate((html) => ((document.getElementById("embed") as HTMLIFrameElement).srcdoc = html), page);
  await tab.waitForFunction(() => (window as unknown as { messages: Array<{ type: string }> }).messages.some((m) => m.type === "ready"), null, { timeout: 30_000 });
  await tab.evaluate(() => (document.getElementById("embed") as HTMLIFrameElement).contentWindow!.postMessage({ type: "load", html: '<div class="poster"><h1 id="title">Hello class</h1></div>', css: "h1{color:#c00}" }, "*"));
  const loaded = await tab.waitForFunction(() => (window as unknown as { messages: Array<{ type: string }> }).messages.some((m) => m.type === "loaded"), null, { timeout: 10_000 }).then(() => true, () => false);
  let edited = "-";
  if (loaded) {
    const canvas = tab.frameLocator("#embed").frameLocator("iframe.gjs-frame");
    await tab.waitForTimeout(500);
    await canvas.locator("#title").click();
    await canvas.locator("#title").dblclick();
    await tab.keyboard.press("ControlOrMeta+A");
    await tab.keyboard.type("Edited in the embed");
    edited = (await canvas.locator("#title").textContent()) ?? "?";
  }
  const canNestValue = await tab.evaluate(() => (window as unknown as { messages: Array<{ type: string; value?: boolean }> }).messages.find((m) => m.type === "can-nest")?.value);
  console.log(JSON.stringify({ sandbox, pageBytes: page.length, canNest: canNestValue, editorLoaded: loaded, edited, errors: errors.slice(0, 2) }));
  await tab.close();
}
await browser.close();
