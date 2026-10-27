/**
 * Probe: the poster editor's whole Format panel, explored on the guide's example poster (styles
 * on classes, as models write them). For each element selected, every field's shown value next to
 * what is drawn; then each kind of field used — select, colour, radio, number with a unit, the
 * composite border radius and border, clearing — and a pass meant to break it.
 *
 * Run: node --import tsx scripts/probes/poster-format-explore.mts [out-dir] [light|dark]
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? (await fs.mkdtemp(path.join(os.tmpdir(), "poster-explore-"))));
const theme = process.argv[3] === "dark" ? "dark" : "light";
await fs.mkdir(out, { recursive: true });

const entry = `
import { mountEditor } from "@pi-outpost/posters/editor";
import { POSTER_EXAMPLE } from "@pi-outpost/posters/guide";
import "@pi-outpost/posters/editor.css";
const editor = mountEditor(document.getElementById("root"), { save: async () => ({ saved: true, revision: 1 }), deliver: async () => "ok" });
editor.setDisplayMode("fill");
editor.setTheme(${JSON.stringify(theme)});
editor.open({ title: "Explore", revision: 0, format: POSTER_EXAMPLE.format, html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css });
window.posterEditor = editor;
`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: path.join(repo, "web"), loader: "ts" },
  bundle: true, format: "iife", write: false, logLevel: "silent", outdir: "out",
  loader: { ".svg": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".eot": "dataurl" },
});
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
const css = bundled.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (error) => console.log("[pageerror]", error.message));
page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") console.log(`[console.${message.type()}]`, message.text()); });
await page.setContent(`<!doctype html><style>${css}</style><body><div id="root"></div><script>${js}</script></body>`);
const canvas = page.frameLocator("iframe.gjs-frame");
await canvas.locator(".motto").waitFor();
await page.waitForTimeout(600);
await page.locator('button[data-action="style"]').click();

const PROPS = ["font-family", "font-size", "font-weight", "color", "text-align", "line-height", "background-color", "border-radius", "border", "width", "height", "padding", "margin"];
const prop = (name: string) => page.locator(`.gjs-sm-property__${name}`).first();

async function select(selector: string) {
  await canvas.locator(selector).first().click(/^\.(rule\.c1|poster)$/.test(selector) ? { position: { x: 8, y: 8 } } : undefined);
  await page.waitForTimeout(200);
}
async function computed(selector: string, names: string[]) {
  return canvas.locator(selector).first().evaluate((element, names) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
  }, names);
}
/** What a field shows: its label's colour class, each input's value or placeholder, each select's choice. */
async function shown(name: string) {
  const field = prop(name);
  if (!(await field.isVisible().catch(() => false))) return "(hidden)";
  return field.evaluate((element) => {
    const label = element.querySelector(".gjs-sm-label, .gjs-label-wrp, [data-sm-label]");
    const mark = [...(label?.querySelectorAll("*") ?? []), label].filter(Boolean).map((node) => (node as Element).className).join(" ").match(/gjs-four-color|gjs-color-warn|gjs-sm-clear/g)?.join("+") ?? "";
    const inputs = [...element.querySelectorAll("input:not([type=radio]), select")].map((input) => {
      const control = input as HTMLInputElement;
      return control.tagName === "SELECT" ? `[${control.value}]` : control.value !== "" ? control.value : `(${control.placeholder})`;
    });
    const radio = (element.querySelector("input[type=radio]:checked") as HTMLInputElement | null)?.value;
    return `${mark ? mark + " " : ""}${inputs.join(" ")}${radio ? ` radio=${radio}` : ""}`;
  });
}
async function dump(selector: string) {
  await select(selector);
  const drawn = await computed(selector, ["font-family", "font-size", "font-weight", "color", "text-align", "line-height", "background-color", "border-top-left-radius", "border-top-width", "border-top-style", "border-top-color", "width", "height", "padding-top", "margin-top"]);
  const picked = await canvas.locator(".gjs-selected").first().evaluate((element) => `${element.tagName.toLowerCase()}.${element.className.replace(/ ?gjs-\S+/g, "").trim().replace(/ /g, ".")}`).catch(() => "nothing");
  console.log(`\n=== ${selector} (selected: ${picked})`);
  for (const name of PROPS) console.log(`  ${name.padEnd(17)} ${await shown(name)}`);
  console.log("  drawn:", JSON.stringify(drawn));
}
const savedCss = () => page.evaluate(() => (window as unknown as { posterEditor: { current(): { css: string } } }).posterEditor.current()!.css);

// 1. What the fields show, element by element
for (const selector of [".banner h1", ".rule.c1 h2", ".rule.c1 p", ".rule.c1", ".motto", ".photo", ".poster"]) await dump(selector);
await page.screenshot({ path: path.join(out, "1-motto.png") });

// 1b. The + of a field showing a default, not the drawn value
await select(".banner h1");
await prop("font-size").locator(".gjs-field-arrow-u").click();
await page.waitForTimeout(200);
console.log("\n=== + on h1 (drawn 56px, field shows medium) →", JSON.stringify(await computed(".banner h1", ["font-size"])), "field", await shown("font-size"));
await page.locator('button[data-action="undo"]').click();
await page.waitForTimeout(200);
console.log("    undo →", JSON.stringify(await computed(".banner h1", ["font-size"])));
// 2. Each kind of field, on the motto
console.log("\n=== using each field on .motto");
await select(".motto");
const step = async (label: string, act: () => Promise<void>, names: string[]) => {
  await act();
  await page.waitForTimeout(200);
  console.log(`  ${label.padEnd(40)} drawn=${JSON.stringify(await computed(".motto", names))}`);
};
await step("font-family → Georgia", () => prop("font-family").locator("select").selectOption({ label: "Georgia" }).then(() => undefined), ["font-family"]);
console.log("  font-family options:", (await prop("font-family").locator("option").allTextContents()).join(" | "));
await step("font-weight → Bold", () => prop("font-weight").locator("select").selectOption({ label: "Bold" }).then(() => undefined), ["font-weight"]);
console.log("  font-weight options:", (await prop("font-weight").locator("option").allTextContents()).join(" | "));
await step("text-align → right", () => prop("text-align").locator("label").filter({ hasText: /right/i }).first().click(), ["text-align"]);
const colourInput = prop("color").locator("input").first();
await step("color typed red + Enter", async () => { await colourInput.fill("red"); await colourInput.press("Enter"); }, ["color"]);
await step("color typed #12 (invalid) + Enter", async () => { await colourInput.fill("#12"); await colourInput.press("Enter"); }, ["color"]);
console.log("  color field now:", await shown("color"));
// The swatch: does a picker open, and where?
await prop("color").locator(".gjs-field-colorp, .gjs-field-color-picker").first().click();
await page.waitForTimeout(300);
const picker = page.locator(".sp-container:not(.sp-hidden)");
console.log("  colour picker open:", await picker.count(), (await picker.count()) ? JSON.stringify(await picker.first().boundingBox()) : "");
await page.screenshot({ path: path.join(out, "2-picker.png") });
await page.keyboard.press("Escape");
await page.mouse.click(300, 600);
await page.waitForTimeout(200);
await select(".motto");
// Units: what changing the unit does to the value
const sizeUnit = prop("font-size").locator("select").first();
console.log("  font-size units:", (await sizeUnit.locator("option").allTextContents()).join(" | "));
console.log("  font-size field now:", await shown("font-size"));
await step("font-size typed -5 + Enter", async () => { const input = prop("font-size").locator("input").first(); await input.fill("-5"); await input.press("Enter"); }, ["font-size"]);
await step("font-size typed 'abc' + Enter", async () => { const input = prop("font-size").locator("input").first(); await input.fill("abc"); await input.press("Enter"); }, ["font-size"]);
await step("font-size typed 40 then Tab (no Enter)", async () => { const input = prop("font-size").locator("input").first(); await input.fill("40"); await input.press("Tab"); }, ["font-size"]);
// Line height: "normal" with a "-" unit
console.log("  line-height units:", (await prop("line-height").locator("select").first().locator("option").allTextContents()).join(" | "));
await step("line-height arrow up from normal", () => prop("line-height").locator(".gjs-field-arrow-u").click(), ["line-height", "font-size"]);
console.log("  line-height field now:", await shown("line-height"));
await step("line-height typed 1.5 + Enter", async () => { const input = prop("line-height").locator("input").first(); await input.fill("1.5"); await input.press("Enter"); }, ["line-height"]);
await step("line-height arrow up from 1.5", () => prop("line-height").locator(".gjs-field-arrow-u").click(), ["line-height"]);
console.log("  line-height field now:", await shown("line-height"));
// Background
const bg = prop("background-color").locator("input").first();
await step("background-color typed #c8e6c9", async () => { await bg.fill("#c8e6c9"); await bg.press("Enter"); }, ["background-color"]);
// Border radius: composite of four
const radius = prop("border-radius");
console.log("  border-radius sub-fields:", (await radius.locator("input").count()), "labels:", (await radius.locator(".gjs-sm-label, .gjs-label-wrp").allTextContents()).map((text) => text.trim()).filter(Boolean).join(" | "));
await step("border-radius top-left typed 0", async () => { const input = radius.locator("input").first(); await input.fill("0"); await input.press("Enter"); }, ["border-top-left-radius", "border-top-right-radius"]);
// Border composite
const border = prop("border");
console.log("  border sub-fields:", await border.locator("input, select").count());
await step("border width typed 6", async () => { const input = border.locator("input").first(); await input.fill("6"); await input.press("Enter"); }, ["border-top-width", "border-top-style", "border-top-color"]);
await step("border style → dashed", () => border.locator("select").last().selectOption("dashed").then(() => undefined), ["border-top-width", "border-top-style", "border-top-color"]);
// Clearing
const clear = prop("font-family").locator(".gjs-sm-clear, [data-clear-style]").first();
console.log("  font-family clear button visible:", await clear.isVisible().catch(() => false));
if (await clear.isVisible().catch(() => false)) await step("font-family cleared", () => clear.click(), ["font-family"]);
console.log("  css now (motto rules):\n   ", (await savedCss()).split("}").filter((rule) => /motto|#i/.test(rule)).map((rule) => rule.trim() + "}").join("\n    "));
await page.screenshot({ path: path.join(out, "3-after-fields.png") });

// 3. Undo: one step per change?
const undoButton = page.locator('button[data-action="undo"]');
for (let i = 1; i <= 3; i++) {
  await undoButton.click();
  await page.waitForTimeout(150);
  console.log(`  undo ×${i}`, JSON.stringify(await computed(".motto", ["font-family", "border-top-style", "border-top-width", "border-top-left-radius"])));
}

// 4. Size sector
await page.locator(".gjs-sm-sector__size > .gjs-sm-sector-title").click();
await select(".rule.c1 p");
console.log("\n=== Size on .rule.c1 p:", "width", await shown("width"), "| height", await shown("height"), "| padding", await shown("padding"), "| margin", await shown("margin"));
await page.locator(".poster-side").screenshot({ path: path.join(out, "4-size.png") });

// 5. Breaking it
console.log("\n=== monkey");
await select(".motto");
const size = prop("font-size").locator("input").first();
await size.fill("90");
// Typed, not committed, then another element selected
await select(".banner h1");
console.log("  typed 90 on motto, selected h1 without Enter → motto", JSON.stringify(await computed(".motto", ["font-size"])), "h1", JSON.stringify(await computed(".banner h1", ["font-size"])), "field", await shown("font-size"));
// Double-clicked text being edited, then font size changed
await canvas.locator(".rule.c2 p").dblclick();
await page.waitForTimeout(300);
const editing = await canvas.locator(".rule.c2 p").getAttribute("contenteditable");
await prop("font-size").locator(".gjs-field-arrow-u").click();
await page.waitForTimeout(150);
console.log("  while editing text (contenteditable", editing + "): up →", JSON.stringify(await computed(".rule.c2 p", ["font-size"])), "still editing", await canvas.locator(".rule.c2 p").getAttribute("contenteditable"));
// Spam the arrows
await select(".rule.c3 h2");
for (let i = 0; i < 20; i++) await prop("font-size").locator(".gjs-field-arrow-d").click({ delay: 0 });
await page.waitForTimeout(200);
console.log("  20 fast down clicks on 32px h2 →", JSON.stringify(await computed(".rule.c3 h2", ["font-size"])), "field", await shown("font-size"));
for (let i = 0; i < 20; i++) await prop("font-size").locator(".gjs-field-arrow-d").click({ delay: 0 });
await page.waitForTimeout(200);
console.log("  20 more (below zero?) →", JSON.stringify(await computed(".rule.c3 h2", ["font-size"])), "field", await shown("font-size"));
// Nothing selected
await page.locator('button[data-action="zoom-fit"]').click();
await canvas.locator("body").press("Escape").catch(() => undefined);
await page.evaluate(() => (window as unknown as { posterEditor: unknown }).posterEditor);
await page.screenshot({ path: path.join(out, "5-monkey.png") });
// Toggle the panel shut and open with a field focused
await prop("font-size").locator("input").first().focus();
await page.locator('button[data-action="style"]').click();
await page.locator('button[data-action="style"]').click();
console.log("  panel toggled with a focused field: visible", await prop("font-size").isVisible());
console.log("\nscreenshots in", out);
await browser.close();
