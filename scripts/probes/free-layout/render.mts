/**
 * Probe: can Claude lay out a poster or a slide freely (placed text, shapes, pictograms)
 * and get back an editable .pptx plus a picture of it to check its own work?
 *
 * Usage: node render.mts scene.json out-dir
 * Writes out-dir/<name>.pptx, then asks Keynote for a PNG of each slide (macOS only),
 * which is the picture the model looks at before it hands the file over.
 *
 * Scene: { name, page: { w, h } (cm), background, font, elements: [...] }, every
 * position and size in cm from the top-left corner. Elements:
 *   rect    { x, y, w, h, fill, radius (cm), line?: { color, width (pt) }, shadow? }
 *   ellipse { x, y, w, h, fill, line? }
 *   text    { x, y, w, h, text, size (pt), color, bold?, italic?, font?, align?, valign?, fill? }
 *           text may be a list of runs { text, bold?, color?, size?, breakLine? }
 *   icon    { set: "emoji" | "lucide", name, x, y, size (cm), color? (lucide only) }
 */
import { readFileSync, mkdirSync, existsSync, rmSync, readdirSync, renameSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");
const { Resvg } = require("@resvg/resvg-js");

const here = dirname(fileURLToPath(import.meta.url));
const inch = (cm: number) => cm / 2.54;
const hex = (c: string) => c.replace(/^#/, "").toUpperCase();

function emojiFile(name: string): string {
  // A name is either a codepoint file ("1f4a7") or the emoji itself ("💧").
  const code = /^[0-9a-f-]+$/i.test(name)
    ? name.toLowerCase()
    : [...name].map((ch) => ch.codePointAt(0)!.toString(16)).filter((c) => c !== "fe0f").join("-");
  const file = join(here, "node_modules/@twemoji/svg", `${code}.svg`);
  if (!existsSync(file)) throw new Error(`no emoji ${name} (${code})`);
  return file;
}

function iconPng(el: any): string {
  let svg: string;
  if (el.set === "lucide") {
    const file = join(here, "node_modules/lucide-static/icons", `${el.name}.svg`);
    if (!existsSync(file)) throw new Error(`no lucide icon ${el.name}`);
    svg = readFileSync(file, "utf8").replaceAll("currentColor", el.color ?? "#000000");
  } else {
    svg = readFileSync(emojiFile(el.name), "utf8");
  }
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 512 } }).render().asPng();
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

function textRuns(el: any) {
  if (typeof el.text === "string") return el.text;
  return el.text.map((r: any) => ({
    text: r.text,
    options: {
      bold: r.bold,
      italic: r.italic,
      color: r.color ? hex(r.color) : undefined,
      fontSize: r.size,
      breakLine: r.breakLine,
    },
  }));
}

export async function render(scenePath: string, outDir: string) {
  const scene = JSON.parse(readFileSync(scenePath, "utf8"));
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "PAGE", width: inch(scene.page.w), height: inch(scene.page.h) });
  pptx.layout = "PAGE";
  const slide = pptx.addSlide();
  slide.background = { color: hex(scene.background ?? "#FFFFFF") };
  const font = scene.font ?? "Arial";

  for (const el of scene.elements) {
    const box = { x: inch(el.x), y: inch(el.y), w: inch(el.w ?? el.size), h: inch(el.h ?? el.size) };
    const line = el.line ? { color: hex(el.line.color), width: el.line.width } : { type: "none" as const };
    const shadow = el.shadow ? { type: "outer", blur: 6, offset: 2, angle: 90, color: "000000", opacity: 0.18 } : undefined;
    switch (el.type) {
      case "rect":
        slide.addShape(el.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
          ...box,
          fill: { color: hex(el.fill), transparency: el.transparency },
          line,
          shadow,
          // pptxgenjs takes the corner radius as a fraction of the shorter side, 0..0.5.
          rectRadius: el.radius ? Math.min(0.5, el.radius / Math.min(el.w, el.h)) : undefined,
        });
        break;
      case "ellipse":
        slide.addShape(pptx.ShapeType.ellipse, { ...box, fill: { color: hex(el.fill), transparency: el.transparency }, line, shadow });
        break;
      case "text":
        slide.addText(textRuns(el), {
          ...box,
          fontFace: el.font ?? font,
          fontSize: el.size,
          color: hex(el.color ?? "#000000"),
          bold: el.bold,
          italic: el.italic,
          align: el.align ?? "left",
          valign: el.valign ?? "top",
          fill: el.fill ? { color: hex(el.fill) } : undefined,
          margin: 0,
          lineSpacingMultiple: el.lineSpacing,
          paraSpaceAfter: el.paraSpaceAfter,
          bullet: el.bullet,
        });
        break;
      case "icon":
        slide.addImage({ data: iconPng(el), ...box });
        break;
      default:
        throw new Error(`unknown element ${el.type}`);
    }
  }

  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, `${scene.name}.pptx`);
  await pptx.writeFile({ fileName: out });
  return out;
}

/** A PNG of the slide as Keynote draws the .pptx: an independent reader, not our own renderer. */
export function keynotePreview(pptxPath: string, outDir: string): string {
  const name = pptxPath.replace(/^.*\//, "").replace(/\.pptx$/, "");
  const tmp = resolve(outDir, `.${name}-png`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const script = `
    tell application "Keynote"
      set doc to open POSIX file "${pptxPath}"
      export doc to POSIX file "${tmp}" as slide images with properties {image format:PNG, skipped slides:false}
      close doc saving no
    end tell`;
  execFileSync("osascript", ["-e", script], { stdio: "pipe" });
  const png = readdirSync(tmp).find((f) => f.endsWith(".png"));
  if (!png) throw new Error("Keynote exported no image");
  const target = resolve(outDir, `${name}.png`);
  renameSync(join(tmp, png), target);
  rmSync(tmp, { recursive: true, force: true });
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [scene, outDir = "out"] = process.argv.slice(2);
  const file = await render(scene, outDir);
  console.log(file);
  console.log(keynotePreview(file, resolve(outDir)));
}
