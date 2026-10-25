/**
 * Probe (poster-insert 2.5/2.6): the Insert menu, a text box and the shapes in the posters
 * extension's view, framed as Claude Desktop frames it. Leaves screenshots in out-dir.
 *
 * Needs the view built: `npm run build:viewer-poster --workspace @pi-outpost/mcp`.
 * Run: node --import tsx scripts/probes/poster-insert-menu.mts [out-dir]
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Frame } from "playwright";
import { build } from "esbuild";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { POSTER_EXAMPLE } from "../../posters/src/guide.ts";
import { createPosterServer, viewUriFor } from "../../mcp/src/posters/server.ts";
import { LocalPosterStore } from "../../mcp/src/posters/store.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? (await fs.mkdtemp(path.join(os.tmpdir(), "poster-insert-menu-"))));
await fs.mkdir(out, { recursive: true });
const viewHtml = await fs.readFile(path.join(repo, "mcp/dist/viewer-poster/poster.html"), "utf8");
const hostScript = (await build({ entryPoints: [path.join(repo, "e2e/mcp-host/host.ts")], bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "poster-insert-store-"));
const server = createPosterServer({ store: await LocalPosterStore.open(folder), viewHtml });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "probe", version: "1" });
await client.connect(clientSide);
const call = async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<{ content: Array<{ text?: string }> }>;
const id = (JSON.parse((await call("create_poster", { title: "Insert", html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format })).content[0]!.text!) as { id: string }).id;

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
await gjs.locator(".rule h2").first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(800);
const frame = async (): Promise<Frame> => {
  for (const candidate of page.frames()) if (await candidate.$(".poster")) return candidate;
  throw new Error("no canvas frame");
};
await view.locator("button[data-action=insert]").click();
console.log("menu:", (await view.locator(".poster-menu [role=menuitem]").allTextContents()).join(" | "));
await page.screenshot({ path: path.join(out, "menu.png") });
await view.locator("[data-insert=text]").click();
await page.keyboard.type("Bon appétit !");
await page.waitForTimeout(300);
console.log("text box:", await (await frame()).evaluate(() => {
  const box = document.querySelector(".poster-text") as HTMLElement | null;
  return box ? `${box.textContent} at ${JSON.stringify(box.getBoundingClientRect().toJSON())} font ${getComputedStyle(box).fontSize} ${getComputedStyle(box).fontFamily}` : "none";
}));
for (const shape of ["ellipse", "star", "arrow", "line"]) {
  await view.locator("button[data-action=insert]").click();
  await view.locator(`[data-insert="shape:${shape}"]`).click();
  await page.waitForTimeout(150);
}
console.log("placed boxes:", await (await frame()).evaluate(() => [...document.querySelectorAll(".poster-text, .poster-shape")].map((element) => `${(element as HTMLElement).offsetLeft},${(element as HTMLElement).offsetTop}`).join(" ")));
console.log("shapes:", await (await frame()).evaluate(() => [...document.querySelectorAll(".poster-shape")].map((shape) => `${shape.className} ${Math.round(shape.getBoundingClientRect().width)}x${Math.round(shape.getBoundingClientRect().height)} fill ${getComputedStyle(shape.querySelector("svg > *")!).fill}`)));
await view.locator("button[data-action=style]").click();
await page.waitForTimeout(300);
console.log("format fields:", (await view.locator(".gjs-sm-property .gjs-sm-label").allTextContents()).map((label) => label.trim()).filter(Boolean).join(", "));
const fill = view.locator(".gjs-sm-property").filter({ hasText: "Fill" }).locator("input").first();
await fill.fill("#e91e63");
await fill.press("Enter");
await page.waitForTimeout(300);
console.log("recoloured (fill, stroke):", await (await frame()).evaluate(() => [...document.querySelectorAll(".poster-shape")].map((shape) => `${getComputedStyle(shape.querySelector("svg > *")!).fill} ${getComputedStyle(shape.querySelector("svg > *")!).stroke}`)));
await page.screenshot({ path: path.join(out, "inserted.png") });
await view.locator("button[data-action=save]").click();
await page.waitForTimeout(1500);
const saved = JSON.parse((await call("get_poster", { id })).content[0]!.text!) as { html: string; css: string };
console.log("photo tag:", /<img[^>]*class="photo"[^>]*>/.exec(saved.html)?.[0].slice(0, 200));
console.log("saved:", (saved.html.match(/poster-shape [a-z-]+/g) ?? []).join(", "), "| text:", /Bon appétit/.test(saved.html), "| empty slot without src:", /<img class="photo"[^>]*data-poster-picture="class photo"(?![^>]*src=)[^>]*>/.test(saved.html), "| shape rules:", /\.poster-shape svg > \*/.test(saved.css));
console.log(`screenshots in ${out}`);
await browser.close();
await client.close();
await fs.rm(folder, { recursive: true, force: true });
