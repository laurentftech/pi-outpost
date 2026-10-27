/**
 * Probe: the poster editor's Format panel (GrapesJS 0.23.8 style manager), driven as the person
 * would — select a text, then use the font-size field's up and down arrows, type a size, and
 * read back what the field shows and what the text is drawn at.
 *
 * Mounts the real shared editor (@pi-outpost/posters/editor, its CSS) in Chromium, light theme.
 *
 * Run: node --import tsx scripts/probes/poster-format-panel.mts [out-dir]
 * Leaves screenshots of the panel in out-dir (default: a temporary folder).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? (await fs.mkdtemp(path.join(os.tmpdir(), "poster-format-"))));
await fs.mkdir(out, { recursive: true });

const entry = `
import { mountEditor } from "@pi-outpost/posters/editor";
import "@pi-outpost/posters/editor.css";
const editor = mountEditor(document.getElementById("root"), { save: async () => ({ saved: true, revision: 1 }), deliver: async () => "ok" });
editor.setDisplayMode("fill");
editor.setTheme(new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light");
editor.open({
  title: "Probe", revision: 0, format: "A4-portrait",
  html: '<div class="poster"><h1 class="title">Our class rules</h1><p class="line">I raise my hand to speak</p></div>',
  css: ".poster { padding: 40px; font-family: Arial; } .title { font-size: 54px; } .line { font-size: 20px; }",
});
`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: path.join(repo, "web"), loader: "ts" },
  bundle: true, format: "iife", write: false, logLevel: "silent", outdir: "out",
  loader: { ".svg": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".eot": "dataurl" },
});
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
const css = bundled.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on("pageerror", (error) => console.log("[pageerror]", error.message));
await page.setContent(`<!doctype html><style>${css}</style><body><div id="root"></div><script>${js}</script></body>`);
const canvas = page.frameLocator("iframe.gjs-frame");
await canvas.locator("p.line").waitFor();
await page.waitForTimeout(500);

await page.locator('button[data-action="style"]').click();
await canvas.locator("p.line").click();
await page.waitForTimeout(300);

const field = page.locator(".gjs-sm-property__font-size");
const input = field.locator("input").first();
const drawn = () => canvas.locator("p.line").evaluate((element) => getComputedStyle(element).fontSize);
const report = async (step: string) => console.log(`${step.padEnd(28)} field=${JSON.stringify(await input.inputValue())} unit=${JSON.stringify(await field.locator("select").first().inputValue().catch(() => "-"))} drawn=${await drawn()}`);

await report("selected");
// A click whose pointer wanders a pixel or two between press and release, as on a trackpad
for (const [label, dy] of [["up, pointer moves 1px up", -1], ["up, pointer moves 2px down", 2]] as const) {
  const arrow = (await field.locator(".gjs-field-arrow-u").boundingBox())!;
  await page.mouse.move(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2);
  await page.mouse.down();
  await page.mouse.move(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2 + dy);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await report(label);
}
await page.screenshot({ path: path.join(out, "1-selected.png") });
await field.screenshot({ path: path.join(out, "1-field.png") });

const up = field.locator(".gjs-field-arrow-u");
// What a click lands on across the arrows' column: the up arrow on its top half, the down on its bottom
const column = (await field.locator(".gjs-field-arrows").boundingBox())!;
const hits: string[] = [];
for (const [dx, dy] of [[1, 1], [column.width - 1, 1], [column.width / 2, column.height / 2 - 1], [column.width / 2, column.height / 2 + 1], [1, column.height - 1], [column.width - 1, column.height - 1]]) {
  const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as Element | null)?.className ?? "none", [column.x + dx, column.y + dy]);
  hits.push(`${dx.toFixed(0)},${dy.toFixed(0)}=${hit}`);
}
console.log("arrow column", JSON.stringify(column), hits.join(" "));
const down = field.locator(".gjs-field-arrow-d");
console.log("arrows:", await up.count(), await down.count(), "box", JSON.stringify(await up.boundingBox()), JSON.stringify(await down.boundingBox()));
await up.click();
await page.waitForTimeout(150);
await report("up ×1 (click)");
await up.click();
await up.click();
await page.waitForTimeout(150);
await report("up ×3 (click)");
await down.click();
await page.waitForTimeout(150);
await report("down ×1 (click)");

// A press held a moment, as a hand does
const box = (await up.boundingBox())!;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(400);
await page.mouse.up();
await page.waitForTimeout(150);
await report("up held 400ms");

await input.fill("30");
await input.press("Enter");
await page.waitForTimeout(150);
await report("typed 30 + Enter");
await input.press("ArrowUp");
await page.waitForTimeout(150);
await report("ArrowUp key");

// Another element: does the field follow?
await canvas.locator("h1.title").click();
await page.waitForTimeout(200);
console.log(`${"select title".padEnd(28)} field=${JSON.stringify(await input.inputValue())} drawn=${await canvas.locator("h1.title").evaluate((element) => getComputedStyle(element).fontSize)}`);
await up.click();
await page.waitForTimeout(150);
console.log(`${"title up ×1".padEnd(28)} field=${JSON.stringify(await input.inputValue())} drawn=${await canvas.locator("h1.title").evaluate((element) => getComputedStyle(element).fontSize)}`);

await page.locator(".poster-side").screenshot({ path: path.join(out, "2-panel.png") });
console.log("screenshots in", out);
await browser.close();
