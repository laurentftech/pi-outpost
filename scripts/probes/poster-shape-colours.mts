/**
 * Probe (poster-insert task 1.2): can GrapesJS 0.23.8's style manager offer the custom
 * properties a shape paints with (--shape-fill, --shape-line, --shape-line-width) as fields,
 * in a sector shown only for a shape, so that a colour typed there lands on that shape alone
 * and repaints its SVG?
 *
 * Builds a page with GrapesJS and two shapes, selects one, types a colour into the Fill field
 * of the panel, and reads back both shapes' painted fill and what getCss() would save.
 *
 * Run: node --import tsx scripts/probes/poster-shape-colours.mts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const entry = `
import { grapesjs } from "grapesjs";
import parser from "grapesjs-parser-postcss";
const shape = (id) => '<div class="poster-shape" id="' + id + '" style="position:absolute;left:' + (id === "a" ? 40 : 300) + 'px;top:40px;width:200px;height:200px"><svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;display:block"><rect x="2" y="2" width="96" height="96" style="fill:var(--shape-fill,#4fc3f7);stroke:var(--shape-line,none);stroke-width:var(--shape-line-width,0);vector-effect:non-scaling-stroke"/></svg></div>';
const onShape = ({ component, target }) => Boolean((component ?? target)?.getClasses?.().includes("poster-shape"));
const editor = grapesjs.init({
  container: "#gjs", height: "600px", fromElement: false, storageManager: false, telemetry: false, cssIcons: "",
  plugins: [parser.default ?? parser],
  selectorManager: { componentFirst: true },
  canvas: { styles: [], scripts: [] },
  protectedCss: "svg, svg * { pointer-events: none; }",
  styleManager: {
    appendTo: "#styles",
    sectors: [
      { id: "shape", name: "Shape", open: true, properties: [
        { property: "--shape-fill", label: "Fill", type: "color", default: "#4fc3f7", isVisible: onShape },
        { property: "--shape-line", label: "Line", type: "color", default: "none", isVisible: onShape },
        { property: "--shape-line-width", label: "Line width", type: "number", units: ["px"], default: "0", min: 0, isVisible: onShape },
      ] },
      { id: "text", name: "Text", open: true, properties: ["color"] },
    ],
  },
  components: shape("a") + shape("b"),
});
window.editor = editor;
`;
const bundled = await build({ stdin: { contents: entry, resolveDir: path.join(repo, "posters"), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
const css = await build({ entryPoints: [path.join(repo, "node_modules/grapesjs/dist/css/grapes.min.css")], bundle: true, write: false, logLevel: "silent", loader: { ".svg": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".eot": "dataurl" } });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.setContent(`<!doctype html><style>${css.outputFiles[0]!.text}</style><body style="margin:0;display:flex"><div id="gjs" style="flex:1"></div><div id="styles" style="width:300px"></div><script>${bundled.outputFiles[0]!.text}</script></body>`);
await page.waitForFunction(() => (window as unknown as { editor?: { Canvas: { getDocument(): Document | null } } }).editor?.Canvas.getDocument()?.querySelector("#a"));
await page.waitForTimeout(500);

const shownWhen = async () => page.evaluate(() => {
  const sector = [...document.querySelectorAll("#styles .gjs-sm-sector")].find((element) => /Shape/.test(element.textContent ?? "")) as HTMLElement | undefined;
  return sector ? getComputedStyle(sector).display !== "none" : false;
});
console.log("shape sector shown with nothing selected:", await shownWhen());
const frame = page.frameLocator("iframe.gjs-frame");
await frame.locator("#a").click({ position: { x: 100, y: 100 } });
await page.waitForTimeout(300);
console.log("shape sector shown with shape a selected:", await shownWhen());
await frame.locator("body").click({ position: { x: 700, y: 500 } });
await page.waitForTimeout(300);
console.log("shape sector shown with the page selected:", await shownWhen());
await frame.locator("#a").click({ position: { x: 100, y: 100 } });
await page.waitForTimeout(300);
const fields = await page.evaluate(() => [...document.querySelectorAll("#styles .gjs-sm-property")].map((property) => `${property.querySelector(".gjs-sm-label")?.textContent?.trim()} [${[...property.querySelectorAll("input")].map((input) => input.type).join(",")}]`));
console.log("fields:", fields.join(" | "));

const fill = page.locator("#styles .gjs-sm-property").filter({ hasText: "Fill" }).locator("input[type=text], input:not([type])").first();
await fill.fill("#2e7d32");
await fill.press("Enter");
await page.waitForTimeout(300);
const painted = await page.evaluate(() => {
  const doc = (window as unknown as { editor: { Canvas: { getDocument(): Document } } }).editor.Canvas.getDocument();
  return ["a", "b"].map((id) => getComputedStyle(doc.querySelector(`#${id} rect`)!).fill);
});
const saved = await page.evaluate(() => (window as unknown as { editor: { getCss(): string } }).editor.getCss());
console.log("painted fills a, b:", painted.join(" , "));
console.log("saved css:", saved.replace(/\s+/g, " ").slice(0, 300));
assert.equal(painted[0], "rgb(46, 125, 50)");
assert.notEqual(painted[1], "rgb(46, 125, 50)");
assert.match(saved, /#a\s*\{[^}]*--shape-fill:\s*#2e7d32/);
console.log("probe: custom properties work as Format fields, on the selected shape only");
await browser.close();
