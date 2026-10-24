/**
 * Probe for poster-editor task 1.1: can GrapesJS run in a frame on pi-outpost's own
 * origin, under a strict Content-Security-Policy, without a hostile poster reaching the
 * application? (design.md, decision 4)
 *
 * A real HTTP server serves, on one origin:
 *   /             the "application": a token in localStorage and in a global
 *   /editor.html  the editor frame page, with the planned CSP as a response header
 *   /editor.js    GrapesJS and the probe's editor (scripts/probes/poster-isolation/editor.ts)
 *   /leak*        counts any request a poster manages to make
 * The parent posts a poster full of traps — event handlers, a javascript: link, an SVG
 * script, an iframe with a script, an @import and remote images — and Playwright clicks
 * and double-clicks through it. The CSP only, no sanitiser: the policy must hold alone.
 *
 * Run: node --import tsx scripts/probes/poster-isolation.mts
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = await build({ entryPoints: [path.join(here, "poster-isolation", "editor.ts")], bundle: true, format: "esm", write: false, outdir: "out", logLevel: "silent" });
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";

export const POSTER_EDITOR_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const leaks: string[] = [];
let port = 0;
const server = http.createServer((request, response) => {
  const url = request.url ?? "/";
  if (url.startsWith("/leak")) {
    leaks.push(url);
    response.end();
  } else if (url === "/editor.html") {
    // NOCSP=1: the same page without the policy, to tell what the policy breaks.
    if (!process.env.NOCSP) response.setHeader("Content-Security-Policy", POSTER_EDITOR_CSP);
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="/editor.css"><style>html,body{height:100%;margin:0}.gjs-cv-canvas{width:100%;height:100%;top:0}</style></head><body style="margin:0"><div id="gjs" style="height:900px"></div><script type="module" src="/editor.js"></script></body></html>`);
  } else if (url === "/editor.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(js);
  } else if (url === "/editor.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(css);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><body style="margin:0">
<script>localStorage.setItem("token", "SECRET-TOKEN"); window.appToken = "SECRET-TOKEN"; window.pwned = []; window.messages = [];
addEventListener("message", (e) => window.messages.push(e.data));</script>
<iframe id="editor" src="/editor.html" style="width:1000px;height:900px;border:0"></iframe></body></html>`);
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
port = (server.address() as { port: number }).port;
const origin = `http://127.0.0.1:${port}`;

const steal = (n: string) => `parent.pwned.push('${n}:' + localStorage.getItem('token'))`;
// PLAIN=1: the same page without traps, to tell the policy from the traps when editing fails.
const POSTER = process.env.PLAIN ? `<div class="poster"><h1 id="title">Hello class</h1><p>text</p></div>` : `<div class="poster">
<h1 id="title">Hello class</h1>
<img id="trap-img" src="x" onerror="${steal("img-onerror")}">
<div id="trap-click" onclick="${steal("div-onclick")}" onmouseover="${steal("div-mouseover")}">Click me</div>
<a id="trap-link" href="javascript:${steal("javascript-url")}">a link</a>
<svg width="20" height="20"><script>${steal("svg-script")}</script><rect width="20" height="20" onload="${steal("svg-onload")}"/></svg>
<iframe srcdoc="<script>parent.parent.pwned.push('iframe-srcdoc')</script>"></iframe>
<object data="${origin}/leak-object"></object>
<img src="${origin}/leak-img">
<div style="background:url(${origin}/leak-background)">bg</div>
<form action="${origin}/leak-form"><button id="trap-submit">send</button></form>
<script>${steal("inline-script")}</script>
</div>`;
const POSTER_CSS = `@import url("${origin}/leak-import.css"); .poster{padding:20px} h1{color:#c00; background-image:url("${origin}/leak-css-bg")}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleLines: string[] = [];
page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
await page.goto(origin);
await page.waitForFunction(() => (window as unknown as { messages: Array<{ type: string }> }).messages.some((m) => m.type === "ready"));
await page.evaluate(({ html, css: style }) => (document.getElementById("editor") as HTMLIFrameElement).contentWindow!.postMessage({ type: "load", html, css: style }, "*"), { html: POSTER, css: POSTER_CSS });
await page.waitForFunction(() => (window as unknown as { messages: Array<{ type: string }> }).messages.some((m) => m.type === "loaded"), null, { timeout: 20_000 });

const canvas = page.frameLocator("#editor").frameLocator("iframe.gjs-frame");
await canvas.locator("#title").waitFor();
await page.waitForTimeout(500);
for (const target of process.env.PLAIN ? [] : ["#trap-click", "#trap-link", "#trap-img", "#trap-submit"]) {
  await canvas.locator(target).hover().catch(() => undefined);
  await canvas.locator(target).click({ force: true }).catch(() => undefined);
  await canvas.locator(target).dblclick({ force: true }).catch(() => undefined);
}
// The editor still edits: a text double-clicked can be rewritten.
await canvas.locator("#title").click();
await canvas.locator("#title").dblclick();
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
console.log("title editable:", await canvas.locator("#title").getAttribute("contenteditable"));
const editorFrame = page.frames().find((frame) => frame.url().endsWith("/editor.html"))!;
console.log("selected:", await editorFrame.evaluate(() => {
  const editor = (window as unknown as { editor: { getSelected: () => { get: (k: string) => string } | undefined } }).editor;
  const selected = editor.getSelected();
  return selected ? `${selected.get("type")} ${selected.get("tagName")}` : "none";
}));
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("Edited under the policy");
await page.waitForTimeout(1500);

const state = await page.evaluate(() => {
  const w = window as unknown as { pwned: string[]; messages: Array<{ type: string; directive?: string; blocked?: string }> };
  return { pwned: w.pwned, violations: w.messages.filter((m) => m.type === "violation").map((m) => `${m.directive} ${m.blocked}`) };
});
const edited = await canvas.locator("#title").textContent();
const frameReadsToken = await page.frames().find((frame) => frame.url().endsWith("/editor.html"))!.evaluate(() => {
  try {
    return { same: true, token: window.parent.localStorage.getItem("token") };
  } catch (error) {
    return { same: false, token: String(error) };
  }
});
console.log(JSON.stringify({ pwned: state.pwned, leaks, edited, violations: [...new Set(state.violations)], editorFrameCanReachParent: frameReadsToken.same }, null, 1));
console.log(consoleLines.filter((line) => !line.includes("Content Security Policy")).slice(0, 10));
await browser.close();
server.close();
