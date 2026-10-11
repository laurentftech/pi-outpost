/**
 * Mermaid, drawn without a browser: the worker side of `mermaidRender.ts`.
 *
 * Mermaid needs a DOM and the size of the text it lays out. jsdom gives it the DOM
 * but no layout, so `getBBox` is supplied here: text is measured with a canvas, in
 * the font family the raster is drawn with, a shape from its own geometry, and a
 * group as the union of its children moved by their `translate`. That is enough for
 * the classic look with SVG labels; HTML labels (`foreignObject`) and the neo look
 * need real layout, and are turned off — as the viewer's export turns them off.
 *
 * This runs in a worker thread because it installs `window`, `document` and the DOM
 * classes as globals: in the server's own thread they would make every library that
 * checks `typeof window` believe it is in a browser.
 */
import { parentPort } from "node:worker_threads";
import { createRequire } from "node:module";
import { viewBoxSize, withExplicitSize } from "@pi-outpost/shared/docx";

export interface MermaidRequest {
  id: number;
  source: string;
  font: string;
}

/**
 * `styled` keeps Mermaid's stylesheet, for a rasteriser that applies CSS; `svg` has
 * its appearance written onto each element, for the file (see `inlineStyles`).
 */
export type MermaidReply =
  | { id: number; svg: string; styled: string; width: number; height: number }
  | { id: number; error: string };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A line of text's advance width, and how far its font reaches above and below the baseline. */
type MeasureText = (text: string, size: number) => { width: number; ascent: number; descent: number };

const EMPTY: Box = { x: 0, y: 0, width: 0, height: 0 };

const GLOBALS = [
  "window",
  "document",
  "navigator",
  "DOMParser",
  "XMLSerializer",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "SVGGraphicsElement",
  "getComputedStyle",
  "MutationObserver",
  "CSSStyleSheet",
  "CSSStyleDeclaration",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;

function translateOf(element: Element): [number, number] {
  const match = /translate\(\s*([-\d.e]+)(?:[ ,]+([-\d.e]+))?\s*\)/.exec(element.getAttribute("transform") ?? "");
  return match ? [parseFloat(match[1]), parseFloat(match[2] ?? "0")] : [0, 0];
}

function attribute(element: Element, name: string): number {
  return parseFloat(element.getAttribute(name) ?? "0") || 0;
}

/** The box around a list of points, or empty without any. */
function boxOfPoints(values: number[]): Box {
  if (values.length < 2) return EMPTY;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (let at = 0; at + 1 < values.length; at += 2) {
    x1 = Math.min(x1, values[at]);
    y1 = Math.min(y1, values[at + 1]);
    x2 = Math.max(x2, values[at]);
    y2 = Math.max(y2, values[at + 1]);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function numbersIn(text: string): number[] {
  return (text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

/**
 * A path's box, from the points of its absolute commands.
 *
 * Mermaid writes its node outlines and edges with absolute commands (`M`, `L`, `C`,
 * `Q`); a relative path is measured from its first point only, which errs small
 * rather than throwing a diagram's frame off.
 */
function boxOfPath(d: string): Box {
  const values: number[] = [];
  for (const [, command, args] of d.matchAll(/([MLCQSTHVAZmlcqsthvaz])([^MLCQSTHVAZmlcqsthvaz]*)/g)) {
    const numbers = numbersIn(args);
    if (command === "M" || command === "L" || command === "C" || command === "Q" || command === "S" || command === "T") values.push(...numbers);
    else if (command === "m" && values.length === 0) values.push(...numbers.slice(0, 2));
  }
  return boxOfPoints(values);
}

/** The font size an element draws at: its own or an ancestor's `font-size`, else Mermaid's 16. */
function fontSizeOf(element: Element): number {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const size = parseFloat(at.getAttribute("font-size") ?? "");
    if (Number.isFinite(size) && size > 0) return size;
  }
  return 16;
}

function inherited(element: Element, name: string): string | null {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const value = at.getAttribute(name);
    if (value !== null) return value;
  }
  return null;
}

/** A length in user units, with `em` taken against the font size; `null` when absent or unreadable. */
function length(value: string | null, size: number): number | null {
  if (value === null || value.trim() === "") return null;
  const number = parseFloat(value);
  if (!Number.isFinite(number)) return null;
  return value.trim().endsWith("em") ? number * size : number;
}

/**
 * A text element's box, line by line.
 *
 * Mermaid writes each line of a label as a `tspan` child placing itself with `y` (in
 * `em`) and `dy`, and centres the whole with `text-anchor="middle"`. Measuring the
 * text as one line at the element's own `y` put every label box a line too high and
 * a line too short: edge labels sat below their background, and a two-line node
 * label ran out of its node.
 */
function textBox(element: Element, measure: MeasureText): Box {
  const size = fontSizeOf(element);
  const anchor = inherited(element, "text-anchor") ?? "start";
  const originX = length(element.getAttribute("x"), size) ?? 0;
  let baseline = (length(element.getAttribute("y"), size) ?? 0) + (length(element.getAttribute("dy"), size) ?? 0);
  const lines = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "tspan");
  const placed = lines.length === 0 ? [{ text: element.textContent ?? "", x: originX, y: baseline }] : [];
  for (const line of lines) {
    const y = length(line.getAttribute("y"), size);
    if (y !== null) baseline = y;
    baseline += length(line.getAttribute("dy"), size) ?? 0;
    placed.push({ text: line.textContent ?? "", x: length(line.getAttribute("x"), size) ?? originX, y: baseline });
  }
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const line of placed) {
    const metrics = measure(line.text, size);
    const left = anchor === "middle" ? line.x - metrics.width / 2 : anchor === "end" ? line.x - metrics.width : line.x;
    x1 = Math.min(x1, left);
    x2 = Math.max(x2, left + metrics.width);
    y1 = Math.min(y1, line.y - metrics.ascent);
    y2 = Math.max(y2, line.y + metrics.descent);
  }
  return x1 === Infinity ? EMPTY : { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function boxOf(element: Element, measure: MeasureText): Box {
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case "text":
      return textBox(element, measure);
    case "tspan": {
      // Asked of a line on its own: one line at its own place.
      const size = fontSizeOf(element);
      const metrics = measure(element.textContent ?? "", size);
      const y = length(element.getAttribute("y"), size) ?? 0;
      return { x: length(element.getAttribute("x"), size) ?? 0, y: y - metrics.ascent, width: metrics.width, height: metrics.ascent + metrics.descent };
    }
    case "polygon":
    case "polyline":
      return boxOfPoints(numbersIn(element.getAttribute("points") ?? ""));
    case "path":
      return boxOfPath(element.getAttribute("d") ?? "");
    case "circle": {
      const r = attribute(element, "r");
      return { x: attribute(element, "cx") - r, y: attribute(element, "cy") - r, width: 2 * r, height: 2 * r };
    }
    case "ellipse": {
      const rx = attribute(element, "rx");
      const ry = attribute(element, "ry");
      return { x: attribute(element, "cx") - rx, y: attribute(element, "cy") - ry, width: 2 * rx, height: 2 * ry };
    }
    case "line":
      return boxOfPoints([attribute(element, "x1"), attribute(element, "y1"), attribute(element, "x2"), attribute(element, "y2")]);
    case "style":
    case "defs":
    case "marker":
    case "title":
    case "desc":
      return EMPTY;
  }
  if (element.children.length === 0) {
    return { x: attribute(element, "x"), y: attribute(element, "y"), width: attribute(element, "width"), height: attribute(element, "height") };
  }
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const child of Array.from(element.children)) {
    const box = boxOf(child, measure);
    if (box.width === 0 && box.height === 0) continue;
    const [dx, dy] = translateOf(child);
    x1 = Math.min(x1, box.x + dx);
    y1 = Math.min(y1, box.y + dy);
    x2 = Math.max(x2, box.x + dx + box.width);
    y2 = Math.max(y2, box.y + dy + box.height);
  }
  return x1 === Infinity ? EMPTY : { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * The properties that decide what a shape looks like: the viewer's export writes the
 * same ones (`ui/src/export/mermaidToImage.ts`), for the same reason.
 */
const PAINTED = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
] as const;

/** A selector's specificity: ids, then classes, attributes and pseudo-classes, then types. */
function specificity(selector: string): [number, number, number] {
  const plain = selector.replace(/::?[a-z-]+(\([^)]*\))?/gi, (pseudo) => (pseudo.startsWith("::") ? " x" : " .p"));
  return [
    (plain.match(/#[\w-]+/g) ?? []).length,
    (plain.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length,
    (plain.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length,
  ];
}

function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * The diagram with its appearance written onto each element.
 *
 * Mermaid styles a diagram with a `<style>` block and class selectors. LibreOffice
 * reads the SVG extension and not that CSS, so an unstyled vector arrives as a black
 * block; the viewer's export resolves the styles with the browser's computed style
 * for that reason. jsdom computes no cascade, so the rules are applied here: each
 * rule's declarations go to the elements its selector matches, weakest selector
 * first and in source order, then the element's own `style` attribute.
 *
 * Read everything first, change nothing — as in the viewer's export: Mermaid's rules
 * are descendant selectors, so stripping a parent's class in the same walk would
 * change what its children match.
 */
function inlineStyles(svg: string, document: Document): string {
  const holder = document.createElement("div");
  holder.innerHTML = svg;
  const root = holder.querySelector("svg");
  if (root === null) return svg;
  document.body.append(holder);
  try {
    const applied: { element: Element; weight: [number, number, number]; order: number; style: CSSStyleDeclaration }[] = [];
    let order = 0;
    for (const style of Array.from(root.querySelectorAll("style"))) {
      // jsdom builds no stylesheet for a `<style>` inside an SVG; an HTML one parses it.
      const sheet = document.createElement("style");
      sheet.textContent = style.textContent;
      document.head.append(sheet);
      for (const rule of Array.from(sheet.sheet?.cssRules ?? [])) {
        if (!("selectorText" in rule) || !("style" in rule)) continue;
        const styleRule = rule as CSSStyleRule;
        for (const part of styleRule.selectorText.split(",")) {
          const selector = part.trim();
          let matched: Element[];
          try {
            // Matched from the document: jsdom does not count the scoping root itself
            // as an ancestor, and every Mermaid rule starts with the root's id.
            matched = Array.from(document.querySelectorAll(selector));
          } catch {
            continue;
          }
          for (const element of matched) if (root.contains(element)) applied.push({ element, weight: specificity(selector), order, style: styleRule.style });
          order++;
        }
      }
      sheet.remove();
    }
    applied.sort((a, b) => compareSpecificity(a.weight, b.weight) || a.order - b.order);

    const resolved = new Map<Element, Map<string, string>>();
    for (const { element, style } of applied) {
      const painted = resolved.get(element) ?? new Map<string, string>();
      for (const property of PAINTED) {
        const value = style.getPropertyValue(property);
        if (value !== "") painted.set(property, value.replace(/\s*!important\s*$/, ""));
      }
      resolved.set(element, painted);
    }
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
      const own = (element as SVGElement).style;
      if (own === undefined) continue;
      for (const property of PAINTED) {
        const value = own.getPropertyValue(property);
        if (value === "") continue;
        const painted = resolved.get(element) ?? new Map<string, string>();
        painted.set(property, value);
        resolved.set(element, painted);
      }
    }

    for (const [element, painted] of resolved) for (const [property, value] of painted) element.setAttribute(property, value);
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
      element.removeAttribute("style");
      element.removeAttribute("class");
    }
    for (const style of Array.from(root.querySelectorAll("style"))) style.remove();
    return root.outerHTML;
  } finally {
    holder.remove();
  }
}

/**
 * Text placed in absolute terms, for readers that place it otherwise.
 *
 * Mermaid places a label's lines with `y` and `dy` in `em`, and centres a sequence
 * diagram's labels with `dominant-baseline: central`. A browser and Word follow both;
 * ONLYOFFICE ignores both, and drew every label a line too high, at the top of its box.
 * Each `em` becomes pixels at the element's font size, and a central baseline becomes
 * the shift it stands for, so every reader puts the text where a browser does.
 */
function explicitBaselines(svg: string, document: Document): string {
  const holder = document.createElement("div");
  holder.innerHTML = svg;
  const root = holder.querySelector("svg");
  if (root === null) return svg;
  const pixels = (value: string, size: number) => {
    const number = parseFloat(value);
    return Number.isFinite(number) && value.trim().endsWith("em") ? String(Math.round(number * size * 100) / 100) : value;
  };
  for (const text of Array.from(root.querySelectorAll("text, tspan"))) {
    const size = fontSizeOf(text);
    for (const name of ["x", "y", "dx", "dy"]) {
      const value = text.getAttribute(name);
      if (value !== null) text.setAttribute(name, pixels(value, size));
    }
  }
  for (const line of Array.from(root.querySelectorAll("tspan"))) {
    // A line placed by both `y` and `dy`: ONLYOFFICE drops the `dy`, so it is folded in.
    const y = parseFloat(line.getAttribute("y") ?? "");
    const dy = parseFloat(line.getAttribute("dy") ?? "");
    if (Number.isFinite(y) && Number.isFinite(dy)) {
      line.setAttribute("y", String(Math.round((y + dy) * 100) / 100));
      line.removeAttribute("dy");
    }
    // Mermaid writes each word in a tspan of its own; ONLYOFFICE starts each one at the
    // line's own position, so the words of a line were drawn over one another. Words
    // that all look alike are joined into the line; mixed bold and italic stay as they are.
    const words = Array.from(line.children);
    if (words.length === 0 || words.some((word) => word.tagName.toLowerCase() !== "tspan" || word.children.length > 0)) continue;
    const look = (word: Element) => Array.from(word.attributes).map((attribute) => `${attribute.name}=${attribute.value}`).sort().join(";");
    if (new Set(words.map(look)).size !== 1) continue;
    for (const attribute of Array.from(words[0]!.attributes)) if (!line.hasAttribute(attribute.name)) line.setAttribute(attribute.name, attribute.value);
    line.textContent = words.map((word) => word.textContent ?? "").join("");
  }
  for (const text of Array.from(root.querySelectorAll("text"))) {
    const baseline = text.getAttribute("dominant-baseline") ?? text.getAttribute("alignment-baseline");
    if (baseline !== "central" && baseline !== "middle") continue;
    // The central baseline sits about 0.35 em above the alphabetic one.
    const shift = 0.35 * fontSizeOf(text);
    text.removeAttribute("dominant-baseline");
    text.removeAttribute("alignment-baseline");
    const move = (element: Element) => {
      const y = parseFloat(element.getAttribute("y") ?? "");
      if (Number.isFinite(y)) element.setAttribute("y", String(Math.round((y + shift) * 100) / 100));
    };
    move(text);
    for (const line of Array.from(text.querySelectorAll("tspan"))) if (line.hasAttribute("y")) move(line);
    if (!text.hasAttribute("y")) text.setAttribute("y", String(Math.round(shift * 100) / 100));
  }
  return root.outerHTML;
}

interface Mermaid {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

let ready: Promise<{ mermaid: Mermaid; document: Document }> | undefined;

async function prepare(font: string): Promise<{ mermaid: Mermaid; document: Document }> {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require("jsdom") as typeof import("jsdom");
  const canvas = require("@napi-rs/canvas") as {
    createCanvas(w: number, h: number): {
      getContext(kind: "2d"): { font: string; measureText(text: string): { width: number; fontBoundingBoxAscent: number; fontBoundingBoxDescent: number } };
    };
  };
  const context = canvas.createCanvas(1, 1).getContext("2d");
  const measure: MeasureText = (text, size) => {
    context.font = `${size}px ${font}`;
    const metrics = context.measureText(text);
    return { width: metrics.width, ascent: metrics.fontBoundingBoxAscent, descent: metrics.fontBoundingBoxDescent };
  };

  const { window } = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true });
  const scope = globalThis as Record<string, unknown>;
  const source = window as unknown as Record<string, unknown>;
  for (const key of GLOBALS) if (scope[key] === undefined && source[key] !== undefined) scope[key] = source[key];
  const svgElement = window.SVGElement.prototype as unknown as {
    getBBox(): Box;
    getComputedTextLength(): number;
    getBoundingClientRect(): Box & { top: number; left: number; right: number; bottom: number };
  };
  svgElement.getBBox = function (this: Element) {
    return boxOf(this, measure);
  };
  // The pie chart sizes its legend from the client rect, which jsdom reports as 0 wide:
  // its legend was cut off at the picture's edge. The element's own box stands in.
  svgElement.getBoundingClientRect = function (this: Element) {
    const box = boxOf(this, measure);
    return { ...box, top: box.y, left: box.x, right: box.x + box.width, bottom: box.y + box.height };
  };
  svgElement.getComputedTextLength = function (this: Element) {
    return measure(this.textContent ?? "", fontSizeOf(this)).width;
  };

  const { default: mermaid } = (await import("mermaid")) as unknown as { default: Mermaid };
  // The viewer's export settings (`ui/src/export/mermaidToImage.ts`), so a diagram
  // drawn here looks like the one the viewer exports.
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    look: "classic",
    securityLevel: "strict",
    suppressErrorRendering: true,
    fontFamily: font,
    flowchart: { htmlLabels: false },
    htmlLabels: false,
    // A gantt chart is as wide as its container, and a jsdom container is 0 wide.
    // The width of a page's text (`TEXT_WIDTH_PX` in the Word mapping), drawn larger
    // so its bars and dates stay legible once fitted to the page.
    gantt: { useWidth: 960 },
  });
  return { mermaid, document: window.document };
}

parentPort?.on("message", async (request: MermaidRequest) => {
  try {
    ready ??= prepare(request.font);
    const { mermaid, document } = await ready;
    const { svg } = await mermaid.render(`mermaid-${request.id}`, request.source);
    const size = viewBoxSize(svg);
    if (size === null) throw new Error("Mermaid drew a diagram with no usable size");
    const styled = withExplicitSize(svg, size.width, size.height);
    parentPort!.postMessage({ id: request.id, svg: explicitBaselines(inlineStyles(styled, document), document), styled, ...size } satisfies MermaidReply);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort!.postMessage({ id: request.id, error: message } satisfies MermaidReply);
  }
});
