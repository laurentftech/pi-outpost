/**
 * What a poster file will give the person, read from its text (poster-files:
 * TheAgentChecksThePostersItWrites): the model writes a `.poster.html` and cannot see it drawn,
 * so this says what the editor refuses, what it will not draw, what it removes, and what reads
 * badly, each with what to write instead.
 *
 * Checked from the text as `readPage` reads it, with no HTML parser, so it runs on a server.
 * Tags are found by a scanner rather than a pattern: a pattern for a tag and its quoted values
 * is quadratic on markup repeating an unclosed one, and this is text a model sends.
 *
 * The frames naming a diagram or a picture file are listed, not opened: the files are the
 * host's to look up (server/src/posterCheckTool.ts in pi-outpost).
 *
 * Isomorphic: no Node and no DOM.
 */
import { DRAWIO_ATTRIBUTE, DRAWIO_PAGE_ATTRIBUTE, PICTURE_FILE_ATTRIBUTE, pictureFileType } from "./diagrams.ts";
import { FORMATS, PosterRefusal, readPage, type PosterFormat } from "./format.ts";

export interface PosterIssue {
  severity: "error" | "warning";
  message: string;
}

/** A frame the editor fills when the poster opens: a page of a diagram, or a picture file. */
export interface PosterFrame {
  kind: "drawio" | "picture";
  /** The path as the frame names it: from the poster's directory, or from the root when it starts with `/`. */
  path: string;
  /** The diagram's page, by name or number from 1, when the frame names one. */
  page?: string;
  /** The frame's name, else its alternative text. */
  name?: string;
  /** Whether it already holds a picture, which the editor then leaves as it is. */
  filled: boolean;
}

export interface PosterCheck {
  /** The format, when the file is a poster at all. */
  format?: PosterFormat;
  frames: PosterFrame[];
  issues: PosterIssue[];
}

/** A drawing the guide asks to keep under: the model reads all of it on every read of the poster. */
export const MAX_DRAWING_BYTES = 50_000;

/** Elements the editor's sanitiser removes (`sanitizePosterHtml`). `script` is refused before. */
const REMOVED = new Set(["iframe", "frame", "object", "embed", "base", "meta", "link", "form", "portal"]);
/** Attributes holding an address something would be fetched from. `href` only on SVG elements that draw what it points at. */
const SOURCES = new Set(["src", "srcset", "poster", "data", "background"]);
const DRAWING_HREF = new Set(["image", "use", "feimage", "pattern", "textpath"]);

const ATTRIBUTE = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MARKER = /^poster-picture:\d+$/;

function attributesOf(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase();
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/**
 * Each opening tag of the markup, as its name and the text of its attributes. A quoted value
 * runs to its closing quote, `>` included, as a browser reads it; a tag left open ends the scan,
 * since the rest of the markup is inside it.
 */
function* tagsOf(html: string): Generator<{ name: string; attributes: string }> {
  let at = 0;
  for (;;) {
    const start = html.indexOf("<", at);
    if (start === -1) return;
    const name = /^[a-zA-Z][\w:-]*/.exec(html.slice(start + 1, start + 65))?.[0];
    if (name === undefined) {
      at = start + 1;
      continue;
    }
    let index = start + 1 + name.length;
    let quote = "";
    for (; index < html.length; index += 1) {
      const ch = html[index]!;
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    if (index >= html.length) return;
    yield { name, attributes: html.slice(start + 1 + name.length, index) };
    at = index + 1;
  }
}

/** A value shortened for a message: the model needs to recognise it, not to read a data URL back. */
function shown(value: string): string {
  return value.length > 100 ? `${value.slice(0, 97)}…` : value;
}

/** Whether an address draws without fetching anything: none, an embedded picture, a marker, or a fragment of the page. */
function drawsInPlace(value: string): boolean {
  const address = value.trim();
  return address === "" || /^data:image\//i.test(address) || MARKER.test(address) || address.startsWith("#");
}

/** What to write instead of `where`, which fetches `address`. */
function notFetched(where: string, address: string): string {
  const path = address.trim();
  const local = !SCHEME.test(path) && !path.startsWith("//");
  if (local && path.toLowerCase().endsWith(".drawio")) {
    return `${where} is never drawn: a poster fetches nothing. For a draw.io diagram of the project, write an empty frame naming it — <img data-poster-picture="diagram" ${DRAWIO_ATTRIBUTE}="${shown(path)}" alt="…"> with a width and a height, and no src — and the editor draws it there when the poster opens.`;
  }
  if (local && pictureFileType(path) !== undefined) {
    return `${where} is never drawn: a poster fetches nothing. For a picture file of the project, write an empty frame naming it — <img data-poster-picture="picture" ${PICTURE_FILE_ATTRIBUTE}="${shown(path)}" alt="…"> with a width and a height, and no src — and the editor puts it there when the poster opens.`;
  }
  return `${where} is never drawn: a poster fetches nothing, from the web or the project. Use an emoji, an SVG drawing of your own, an empty frame the person fills, or a frame naming a draw.io diagram (${DRAWIO_ATTRIBUTE}) or a picture file (${PICTURE_FILE_ATTRIBUTE}) of the project.`;
}

function checkStylesheet(css: string, where: string, issues: PosterIssue[]): void {
  if (/@import\b/i.test(css)) issues.push({ severity: "error", message: `${where} holds an @import: a poster fetches nothing, so write the rules themselves.` });
  for (const match of css.matchAll(CSS_URL)) {
    const address = match[1] ?? match[2] ?? match[3] ?? "";
    if (!drawsInPlace(address)) issues.push({ severity: "error", message: notFetched(`url(${shown(address)}) in ${where}`, address) });
  }
}

/** Each `<svg>…</svg>` of the markup, outermost only, found by searching rather than by a pattern. */
function drawings(html: string): string[] {
  const lower = html.toLowerCase();
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = lower.indexOf("<svg", from);
    if (start === -1) return found;
    let depth = 0;
    let at = start;
    for (;;) {
      const open = lower.indexOf("<svg", at + 1);
      const close = lower.indexOf("</svg", at + 1);
      if (close === -1) return [...found, html.slice(start)];
      if (open !== -1 && open < close) {
        depth += 1;
        at = open;
      } else if (depth > 0) {
        depth -= 1;
        at = close;
      } else {
        from = close + 5;
        found.push(html.slice(start, from));
        break;
      }
    }
  }
}

/**
 * The declarations of the first `.poster-page { … }` rule, or undefined. Searched, not matched:
 * a pattern from the selector to the closing brace is polynomial on a text repeating the
 * selector with no brace closed (CodeQL js/polynomial-redos).
 */
function pageRule(text: string): string | undefined {
  for (let from = 0; ; ) {
    const at = text.indexOf(".poster-page", from);
    if (at === -1) return undefined;
    let open = at + ".poster-page".length;
    while (open < text.length && /\s/.test(text[open]!)) open += 1;
    if (text[open] === "{") {
      const close = text.indexOf("}", open + 1);
      return close === -1 ? undefined : text.slice(open + 1, close);
    }
    from = at + 1;
  }
}

function checkPageSize(text: string, format: PosterFormat, issues: PosterIssue[]): void {
  const rule = pageRule(text);
  if (rule === undefined) return;
  const { width, height } = FORMATS[format];
  const size = (property: string) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([\\d.]+)px`).exec(rule)?.[1];
  const [w, h] = [size("width"), size("height")];
  if ((w !== undefined && Number(w) !== width) || (h !== undefined && Number(h) !== height)) {
    issues.push({ severity: "warning", message: `the page rule sizes .poster-page at ${w ?? "?"} x ${h ?? "?"} px, but a ${format} poster is ${width} x ${height} px: the page prints at another size than the editor shows. Write .poster-page { width: ${width}px; height: ${height}px; … }.` });
  }
}

/** The poster's defects, and the frames it asks the editor to fill. */
export function checkPosterText(text: string): PosterCheck {
  let page;
  try {
    page = readPage(text);
  } catch (error) {
    if (!(error instanceof PosterRefusal)) throw error;
    return {
      frames: [],
      issues: [{ severity: "error", message: `${error.message}. The editor will not open it: write it from the skeleton in the posters skill, keeping the poster-format meta, the <style data-poster> stylesheet and the <div class="poster-page"> holding the markup.` }],
    };
  }
  const issues: PosterIssue[] = [];
  const frames: PosterFrame[] = [];
  checkStylesheet(page.css, "the stylesheet", issues);

  for (const found of tagsOf(page.html)) {
    const tag = found.name.toLowerCase();
    const attributes = attributesOf(found.attributes);
    if (REMOVED.has(tag)) issues.push({ severity: "error", message: `<${tag}> is removed by the editor: a poster holds no frames, objects, forms or links to other pages.` });
    for (const [name, value] of attributes) {
      if (name.startsWith("on")) {
        issues.push({ severity: "error", message: `the ${name} attribute on <${tag}> is removed by the editor: nothing runs in a poster.` });
      } else if (name === "style") {
        checkStylesheet(value, `the style attribute of <${tag}>`, issues);
      } else if ((SOURCES.has(name) || ((name === "href" || name === "xlink:href") && DRAWING_HREF.has(tag))) && !drawsInPlace(value)) {
        issues.push({ severity: "error", message: notFetched(`<${tag} ${name}="${shown(value)}">`, value) });
      }
    }

    const diagram = attributes.get(DRAWIO_ATTRIBUTE);
    const file = attributes.get(PICTURE_FILE_ATTRIBUTE);
    if (tag !== "img" || (diagram === undefined && file === undefined)) continue;
    const name = attributes.get("data-poster-picture") || attributes.get("alt") || undefined;
    const filled = /^data:image\//i.test(attributes.get("src")?.trim() ?? "");
    const called = name === undefined ? "a frame" : `the frame "${name}"`;
    if (diagram !== undefined && file !== undefined) {
      issues.push({ severity: "error", message: `${called} names both a diagram (${DRAWIO_ATTRIBUTE}) and a picture file (${PICTURE_FILE_ATTRIBUTE}): keep one.` });
    } else if (diagram !== undefined) {
      if (!diagram.trim().toLowerCase().endsWith(".drawio")) {
        issues.push({ severity: "error", message: `${called} names "${shown(diagram)}" as its draw.io diagram, which is not a .drawio file. For a picture file, write ${PICTURE_FILE_ATTRIBUTE} instead.` });
      } else {
        const named = attributes.get(DRAWIO_PAGE_ATTRIBUTE);
        frames.push({ kind: "drawio", path: diagram.trim(), ...(named?.trim() ? { page: named.trim() } : {}), ...(name ? { name } : {}), filled });
      }
    } else if (file !== undefined) {
      if (pictureFileType(file.trim()) === undefined) {
        issues.push({ severity: "error", message: `${called} names "${shown(file)}" as its picture file, which the editor does not take: SVG, PNG, JPEG, GIF and WebP only.${file.trim().toLowerCase().endsWith(".drawio") ? ` For a draw.io diagram, write ${DRAWIO_ATTRIBUTE} instead.` : ""}` });
      } else {
        frames.push({ kind: "picture", path: file.trim(), ...(name ? { name } : {}), filled });
      }
    }
  }

  for (const drawing of drawings(page.html)) {
    if (/<text\b/i.test(drawing)) {
      issues.push({ severity: "warning", message: "an SVG drawing holds <text>: the person cannot correct a text inside a drawing. Put the text in an HTML element (p, span, div) over or beside the drawing." });
    }
    const bytes = new TextEncoder().encode(drawing).length;
    if (bytes > MAX_DRAWING_BYTES) {
      issues.push({ severity: "warning", message: `an SVG drawing is ${Math.round(bytes / 1000)} kB, above the ${MAX_DRAWING_BYTES / 1000} kB a drawing should keep under: you read all of it on every read of the poster. Simplify it, or make it a picture file of the project named by a frame (${PICTURE_FILE_ATTRIBUTE}).` });
    }
  }
  checkPageSize(text, page.format, issues);
  return { format: page.format, frames, issues };
}
