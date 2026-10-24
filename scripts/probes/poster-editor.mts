/**
 * SUPERSEDED by e2e/mcp-poster-app.spec.ts (poster-editor task 3.2), which drives the
 * shared editor of @pi-outpost/posters. Kept as the record of the probe: it targets the
 * probe-era view (element ids such as #save) and no longer runs against the current one.
 *
 * Probe: the poster editor (mcp/src/posters, mcp/viewer/poster.ts) in a host as hostile
 * as the MCP Apps spec allows — a frame sandboxed to allow-scripts allow-same-origin (GrapesJS
 * draws its canvas in a nested frame, unreachable under scripts only) — on the SDK's
 * AppBridge (e2e/mcp-host/host.ts) — driven the way the person would use it:
 *
 *   1. the model creates a poster and shows it;
 *   2. she double-clicks a text, rewrites it longer, and saves;
 *   3. she drags a pictogram, and saves;
 *   4. get_poster returns her version, marked as made by the user;
 *   5. a stale card's save is refused, not written over the newer revision.
 *
 * Needs the view built: `npx vite build --config mcp/viewer/vite.poster.config.ts` (from mcp/).
 * Run: node --import tsx scripts/probes/poster-editor.mts [out-dir]
 * Leaves screenshots in out-dir (default: a temporary folder) to look at.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type FrameLocator, type Page } from "playwright";
import { build } from "esbuild";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createPosterServer, viewUriFor } from "../../mcp/src/posters/server.ts";
import { LocalPosterStore } from "../../mcp/src/posters/store.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? (await fs.mkdtemp(path.join(os.tmpdir(), "poster-probe-"))));
await fs.mkdir(out, { recursive: true });

const POSTER_CSS = `
.poster { width: 100%; height: 100%; padding: 40px; background: #fff8ec; font-family: "Trebuchet MS", Verdana, sans-serif; display: flex; flex-direction: column; gap: 26px; }
.banner { background: #3f51b5; color: #fff; border-radius: 28px; padding: 26px 30px; display: flex; align-items: center; gap: 22px; }
.banner .star { font-size: 64px; }
.banner h1 { margin: 0; font-size: 54px; font-family: "Arial Rounded MT Bold", Arial, sans-serif; flex: 1; text-align: center; }
.rules { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; flex: 1; }
.rule { background: #fff; border: 4px solid var(--c); border-radius: 22px; padding: 18px; display: flex; gap: 18px; align-items: center; }
.rule .icon { width: 110px; height: 110px; border-radius: 50%; background: var(--c); display: flex; align-items: center; justify-content: center; font-size: 62px; flex: none; }
.rule h2 { margin: 0 0 6px; font-size: 30px; color: #263238; font-family: "Arial Rounded MT Bold", Arial, sans-serif; }
.rule p { margin: 0; font-size: 20px; color: #546e7a; }
.motto { align-self: center; background: #ffe082; color: #5d4037; border-radius: 40px; padding: 14px 40px; font-size: 26px; font-family: "Arial Rounded MT Bold", Arial, sans-serif; }
`;
const RULES = [
  ["🙋", "I raise my hand", "to speak", "#ff8a65"],
  ["👂", "I listen", "to whoever is speaking", "#4fc3f7"],
  ["🤝", "I respect", "my classmates and our things", "#81c784"],
  ["🤫", "I whisper", "when we work in groups", "#ba68c8"],
  ["🧹", "I tidy up", "my desk before I leave", "#ffd54f"],
  ["💪", "I keep trying", "even when it is hard", "#f06292"],
];
const POSTER_HTML = `<div class="poster">
<div class="banner"><span class="star">⭐</span><h1>Our class rules</h1><span class="star">⭐</span></div>
<div class="rules">
${RULES.map(([icon, title, line, colour]) => `<div class="rule" style="--c:${colour}"><div class="icon">${icon}</div><div><h2>${title}</h2><p>${line}</p></div></div>`).join("\n")}
</div>
<div class="motto">Together, we learn better!</div>
</div>`;

const folder = await fs.mkdtemp(path.join(os.tmpdir(), "poster-folder-"));
const store = await LocalPosterStore.open(folder);
const viewHtml = await fs.readFile(path.join(repo, "mcp/dist/viewer-poster/poster.html"), "utf8");
const server = createPosterServer({ store, viewHtml, log: (line) => console.log(`[server] ${line}`) });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "probe", version: "1" });
await client.connect(clientSide);

type Result = { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown> };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result;
const json = (result: Result) => JSON.parse(result.content.map((block) => block.text ?? "").join("")) as Record<string, unknown>;

// POSTER_JSON=<a revision file from a real posters folder> only shows that poster, as the model wrote it.
const given = process.env.POSTER_JSON ? (JSON.parse(await fs.readFile(process.env.POSTER_JSON, "utf8")) as { html: string; css: string; format: string }) : undefined;
const created = json(await call("create_poster", given ? { title: "Given poster", html: given.html, css: given.css, format: given.format } : { title: "Our class rules", html: POSTER_HTML, css: POSTER_CSS, format: "A4-portrait" }));
const id = created.id as string;
console.log("created", created);

const hostScript = (await build({ entryPoints: [path.join(repo, "e2e/mcp-host/host.ts")], bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const browser = await chromium.launch();
const errors: string[] = [];

async function show(page: Page): Promise<FrameLocator> {
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => message.type() === "error" && errors.push(`console: ${message.text()}`));
  await page.exposeFunction("relayToolCall", (params: { name: string; arguments?: Record<string, unknown> }) => call(params.name, params.arguments ?? {}));
  await page.setContent(`<!doctype html><body style="margin:0"><script>${hostScript}</script></body>`);
  const { contents } = await client.readResource({ uri: viewUriFor(viewHtml) });
  const html = (contents[0] as { text: string }).text;
  const toolResult = await call("show_poster", { id });
  await page.evaluate(({ html: view, toolResult: result, hostTheme }) => window.startHost({ html: view, toolInput: {}, toolResult: result as never, theme: hostTheme, downloadFile: true, sandbox: "allow-scripts allow-same-origin" }), { html, toolResult, hostTheme: (process.env.THEME === "dark" ? "dark" : "light") as "light" | "dark" });
  // The host harness sizes the frame from the view's size notifications; make it as wide as Claude's column.
  await page.evaluate(() => {
    const frame = document.getElementById("view") as HTMLIFrameElement;
    frame.style.width = "1000px";
  });
  const view = page.frameLocator("#view");
  const canvas = view.frameLocator("iframe.gjs-frame");
  try {
    await canvas.locator(given ? "h1, h2, p" : ".rule h2").first().waitFor({ timeout: 20_000 });
  } catch (error) {
    await page.screenshot({ path: path.join(out, "0-failed.png") });
    console.log("errors:", errors, "status:", await view.locator("#status").textContent().catch(() => "?"));
    console.log("frames:", page.frames().map((frame) => frame.url()));
    throw error;
  }
  return view;
}

const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const view = await show(page);
const canvas = view.frameLocator("iframe.gjs-frame");
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, "1-loaded.png") });
let canvasFrame = page.mainFrame();
for (const frame of page.frames()) if (await frame.evaluate(() => !!document.querySelector(".poster")).catch(() => false)) canvasFrame = frame;
if (!given) console.log(
  "canvas:",
  await canvasFrame.evaluate(() => ({
    body: [document.body.offsetWidth, document.body.offsetHeight],
    poster: (document.querySelector(".poster") as HTMLElement).offsetHeight,
    posterParent: document.querySelector(".poster")!.parentElement!.outerHTML.slice(0, 160),
    posterComputed: getComputedStyle(document.querySelector(".poster")!).height,
    bodyComputed: [getComputedStyle(document.body).height, getComputedStyle(document.body).display, document.body.style.cssText],
    ruleStyle: document.querySelector(".rule")?.getAttribute("style"),
    ruleBorder: getComputedStyle(document.querySelector(".rule")!).borderTopColor,
    rulesCss: [...document.querySelectorAll("style")].map((style) => style.textContent).join("\n").match(/[^}]*(--c|\.rule\b|\.poster\b)[^}]*}/g),
  })),
);
console.log("status:", await view.locator("#status").textContent());
console.log("frame height:", await page.evaluate(() => (document.getElementById("view") as HTMLIFrameElement).offsetHeight));
if (given) {
  await page.screenshot({ path: path.join(out, "given-inline.png") });
  // The reader switches Claude's theme with the card open: the editor follows, the poster does not.
  await page.evaluate((theme) => window.setHostTheme(theme), process.env.THEME === "dark" ? "light" : "dark");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, "given-theme-switched.png") });
  // Two-finger scroll over the page: the bottom must come into view.
  const area = (await view.locator("#canvas-area").boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await view.locator("#zoom-in").click();
  await view.locator("#zoom-in").click();
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, "given-scrolled.png") });
  await view.locator("#zoom-fit").click();
  // Word and PowerPoint: the page drawn as a picture by the view, wrapped by the server.
  for (const button of ["#word", "#powerpoint"]) {
    await view.locator(button).click();
    await view.locator('#status[data-kind="ok"], #status[data-kind="error"]').waitFor({ timeout: 30_000 });
    console.log(`${button}:`, await view.locator("#status").textContent());
    await page.waitForTimeout(200);
  }
  console.log("folder:", await fs.readdir(folder));
  console.log("exported folder:", folder);
  await view.locator("#fullscreen").click();
  await page.evaluate(() => ((document.getElementById("view") as HTMLIFrameElement).style.height = "900px"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, "given-fullscreen.png") });
  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
  process.exit(0);
}

// 2. Correct a text, longer than the original: it should wrap inside its card.
const title = canvas.locator(".rule h2").nth(2);
await title.dblclick();
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("I am kind and I respect everyone");
await canvas.locator(".motto").click(); // leaving the text ends the edit
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, "2-text-edited.png") });
await view.locator("#save").click();
await view.locator('#status[data-kind="ok"]').waitFor({ timeout: 10_000 });
console.log("status:", await view.locator("#status").textContent());
let read = json(await call("get_poster", { id }));
assert.equal(read.revision, 2);
assert.equal(read.last_changed_by, "the user, in the editor");
assert.match(read.html as string, /I am kind and I respect everyone/);
assert.doesNotMatch(read.html as string, />I respect</);
console.log("text edit saved: ok");

// 3. Drag a pictogram: select it, then drag it.
const star = canvas.locator(".banner .star").first();
await star.click();
const box = (await star.boundingBox())!;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, "3-dragged.png") });
await view.locator("#save").click();
await page.waitForFunction(() => true);
await view.locator("#status", { hasText: "revision 3" }).waitFor({ timeout: 10_000 });
read = json(await call("get_poster", { id }));
console.log("after drag css (translate?):", /translate/.test(read.css as string), (read.css as string).match(/[^}]*translate[^}]*}/)?.[0]);

// 4. A colour change through the side panel would go the same way; checked by eye in the screenshots.
// 5. A stale card: the model updates from revision 3, then a card still at 3 saves.
const updated = json(await call("update_poster", { id, base_revision: 3, html: read.html, css: `${read.css}\n.motto { background: #c5e1a5; }`, format: "A4-portrait" }));
assert.equal(updated.revision, 4);
await canvas.locator(".motto").dblclick();
await page.keyboard.press("End");
await page.keyboard.type(" 🎉");
await canvas.locator(".rule h2").first().click();
await view.locator("#save").click();
await view.locator('#status[data-kind="error"]').waitFor({ timeout: 10_000 });
console.log("stale save:", await view.locator("#status").textContent());
assert.equal(json(await call("get_poster", { id })).revision, 4);

// The printable page in the folder.
const files = await fs.readdir(folder);
console.log("folder:", files);
const printable = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await printable.goto(`file://${path.join(folder, files.find((name) => name.endsWith(".poster.html"))!)}`);
await printable.screenshot({ path: path.join(out, "4-printable.png") });
await printable.pdf({ path: path.join(out, "4-printable.pdf"), preferCSSPageSize: true, printBackground: true });

console.log("errors:", errors.length ? errors : "none");
console.log("screenshots in", out);
await browser.close();
await client.close();
