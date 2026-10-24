/**
 * What a poster is, in every host: one printable page the model writes in HTML and CSS,
 * in a known paper format, kept as `<title>.poster.html`.
 *
 *     <!doctype html>
 *     <html>
 *     <head>
 *     <meta charset="utf-8">
 *     <meta name="poster-format" content="A4-portrait">
 *     <title>Class rules</title>
 *     <style>…the page's own rules: paper size, no margin…</style>
 *     <style data-poster>…the poster's stylesheet…</style>
 *     </head>
 *     <body><div class="poster-page">…the poster's markup…</div></body>
 *     </html>
 *
 * The page opens and prints in any browser as it is; `readPage` takes it back apart into
 * the markup, stylesheet and format the editor and the model work with. The markers are
 * ours, so reading is a matter of finding them — no HTML parser, which keeps this usable
 * on a server as well as in a page.
 *
 * Isomorphic: no Node and no DOM.
 */

/** Page sizes in CSS pixels at 96 per inch, so the page is its paper's size when printed. */
export const FORMATS = {
  "A4-portrait": { width: 794, height: 1123, paper: "210mm 297mm" },
  "A4-landscape": { width: 1123, height: 794, paper: "297mm 210mm" },
  "A3-portrait": { width: 1123, height: 1587, paper: "297mm 420mm" },
  "A3-landscape": { width: 1587, height: 1123, paper: "420mm 297mm" },
  // A widescreen slide, to project: PowerPoint's 13.333 x 7.5 in.
  "slide-16:9": { width: 1280, height: 720, paper: "338.667mm 190.5mm" },
} as const;

export type PosterFormat = keyof typeof FORMATS;
export const FORMAT_NAMES = Object.keys(FORMATS) as [PosterFormat, ...PosterFormat[]];

/** A ceiling on one poster's markup and stylesheet together: a guard, not a quota. */
export const MAX_POSTER_BYTES = 2_000_000;

export const POSTER_SUFFIX = ".poster.html";

export interface PosterContent {
  html: string;
  css: string;
  format: PosterFormat;
}

export interface PosterPage extends PosterContent {
  title: string;
}

/** A refusal written for whoever gave the poster — the model, mostly: what is wrong and what to do. */
export class PosterRefusal extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.details = details;
  }
}

export function isPosterFormat(value: unknown): value is PosterFormat {
  return typeof value === "string" && Object.hasOwn(FORMATS, value);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Refuses a poster no host should store or show; returns it unchanged otherwise. */
export function checkPoster(content: PosterContent): PosterContent {
  if (!isPosterFormat(content.format)) throw new PosterRefusal(`unknown format "${String(content.format)}"`, { formats: FORMAT_NAMES });
  if (byteLength(content.html) + byteLength(content.css) > MAX_POSTER_BYTES) {
    throw new PosterRefusal("this poster is too large: embed no pictures as data, use emoji or a few small inline SVG pictograms");
  }
  if (/<script\b/i.test(content.html)) throw new PosterRefusal("a poster holds no script: give markup and a stylesheet only");
  return content;
}

function escapeText(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

function unescapeText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot);/g, (_match, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"' })[name]!);
}

// `</style` inside the stylesheet would end its element early; written as `<\/style`, which
// CSS reads the same (a backslash before `/` is that character), and turned back on reading.
const STYLE_END = /<\/style/gi;
const ESCAPED_STYLE_END = /<\\\/style/gi;

/** The page written for a poster: printable at its paper size with no margin, colours kept. */
export function pageOf(title: string, content: PosterContent): string {
  const { html, css, format } = checkPoster(content);
  const { width, height, paper } = FORMATS[format];
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="poster-format" content="${format}">
<title>${escapeText(title)}</title>
<style>
@page { size: ${paper}; margin: 0; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.poster-page { width: ${width}px; height: ${height}px; overflow: hidden; position: relative; }
</style>
<style data-poster>
${css.replace(STYLE_END, "<\\/style")}
</style>
</head>
<body><div class="poster-page">${html}</div></body>
</html>
`;
}

const FORMAT_MARKER = /<meta\s+name="poster-format"\s+content="([^"]*)"\s*\/?>/i;
const TITLE = /<title>([\s\S]*?)<\/title>/i;
const STYLESHEET = /<style\s+data-poster\s*>(?:\r?\n)?([\s\S]*?)(?:\r?\n)?<\/style>/i;
const PAGE_OPEN = /<div\s+class="poster-page"\s*>/i;
const PAGE_CLOSE = /<\/div>\s*<\/body>/i;

/**
 * The markup, stylesheet, format and title of a poster file, as `pageOf` wrote them —
 * or a refusal naming what is missing. A file edited by hand stays readable as long as
 * its markers are there.
 */
export function readPage(text: string): PosterPage {
  const format = FORMAT_MARKER.exec(text)?.[1];
  if (format === undefined) throw new PosterRefusal('this is not a poster: it has no <meta name="poster-format"> naming its format');
  if (!isPosterFormat(format)) throw new PosterRefusal(`unknown format "${format}"`, { formats: FORMAT_NAMES });
  const stylesheet = STYLESHEET.exec(text);
  if (!stylesheet) throw new PosterRefusal("this is not a poster: it has no <style data-poster> holding its stylesheet");
  const open = PAGE_OPEN.exec(text);
  if (!open) throw new PosterRefusal('this is not a poster: it has no <div class="poster-page"> holding its markup');
  const rest = text.slice(open.index + open[0].length);
  const close = [...rest.matchAll(new RegExp(PAGE_CLOSE.source, "gi"))].at(-1);
  if (!close || close.index === undefined) throw new PosterRefusal('this is not a poster: its <div class="poster-page"> is not closed before </body>');
  const content: PosterContent = { html: rest.slice(0, close.index), css: stylesheet[1]!.replace(ESCAPED_STYLE_END, "</style"), format };
  checkPoster(content);
  return { ...content, title: unescapeText(TITLE.exec(text)?.[1]?.trim() ?? "") };
}

/** `Class rules` → `class-rules`: lower case, no accents, words joined by dashes; "poster" when nothing is left. */
export function slugOf(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || "poster";
}
