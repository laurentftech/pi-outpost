/**
 * PDF text and table extraction.
 *
 * Reads a PDF's own text layer and returns markdown: text per page, and tabular
 * regions reconstructed as GFM tables from where the text sits on the page.
 * There is no OCR here — a page with no text layer is reported as such rather
 * than guessed at.
 *
 * SECURITY: a PDF is attacker-controlled data parsed in this process. Parsing
 * runs with no network fetching and bounded pages, output size, and wall-clock
 * time — a malformed or hostile document fails as a tool error, it does not hang
 * the session. pdf.js 6 contains no `eval`/`new Function` and does not execute a
 * PDF's own JavaScript through this API.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { renderSpans, struckThroughNotice, STRIKE, type Span } from "./markdownSpans.ts";
import { escapeCell } from "./markdownTable.ts";

export type PdfMode = "text" | "tables" | "both";

export type PdfErrorReason =
  /** The document needs a password we do not have. */
  | "encrypted"
  /** Not a PDF, or damaged past reading. */
  | "unreadable"
  /** Parsing exceeded the time budget. */
  | "budget"
  /** The whole document does not fit in one answer (see `full`). */
  | "too-large";

export class PdfError extends Error {
  constructor(
    readonly reason: PdfErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "PdfError";
  }
}

export interface PdfExtractOptions {
  /** `"3"`, `"2-8"`, `"2-8,12"`. Omitted means "from page 1 until a cap stops us". */
  pages?: string;
  mode?: PdfMode;
  /**
   * Return the whole document rather than one call's worth. The per-call caps
   * lift; ABSOLUTE_MAX_CHARS and the deadline still apply, and a document past
   * that ceiling is refused rather than quietly cut.
   */
  full?: boolean;
  maxPages?: number;
  maxChars?: number;
  timeoutMs?: number;
}

export interface PdfExtraction {
  markdown: string;
  /** Pages actually covered, in order. */
  pages: number[];
  /** First page a cap kept back, when one did. */
  nextPage?: number;
  pageCount: number;
}

/** Caps chosen so one call cannot spend a session's context on a long report. */
export const DEFAULT_MAX_PAGES = 20;
export const DEFAULT_MAX_CHARS = 40_000;
/**
 * The ceiling `full` cannot lift — roughly 100 000 tokens. Past it the call is
 * refused and pointed at a file, because a truncated "whole document" is the
 * failure this option exists to remove.
 */
export const ABSOLUTE_MAX_CHARS = 400_000;

/** What one document may spend being parsed. Loading pdf.js is not charged to it. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/* ── Geometry ───────────────────────────────────────────────────────────────── */

export interface TextPiece {
  text: string;
  /** Left edge, in PDF user units (points), origin bottom-left. */
  x: number;
  /** Baseline. Larger is higher on the page. */
  y: number;
  width: number;
  height: number;
  /**
   * The piece's text broken into formatted runs, when a strike covers part of it
   * or all of it. Absent means the whole text is unformatted.
   *
   * Kept *inside* the piece rather than split across several: the piece's x and
   * width are what line building and column detection read, and a strike is no
   * reason to hand them a different geometry than the producer drew.
   */
  spans?: Span[];
}

/** A shape the page drew, in page space, with the paint that finished it. */
export interface DrawnShape {
  x: number;
  xEnd: number;
  /** Vertical centre. A strike and an underline differ by where this sits. */
  y: number;
  height: number;
  /** Filled shapes can be strikes; a stroked line is a rule or a border. */
  filled: boolean;
}

export interface Line {
  y: number;
  height: number;
  pieces: TextPiece[];
}

/** A run of pieces with no wide gap between them — one table cell, or one word group. */
export interface Cell {
  x: number;
  text: string;
}

export interface TableBlock {
  /** Indices into the line list, inclusive. */
  start: number;
  end: number;
  /** Column anchors (x positions), ascending. */
  columns: number[];
}

/** Two pieces further apart than this read as separate cells, not as spaced words. */
function gapThreshold(height: number): number {
  return Math.max(6, height * 0.6);
}

/**
 * Group text pieces into lines by baseline, tolerating the sub-point jitter a
 * PDF's text matrix leaves on characters that belong to the same line.
 */
export function buildLines(pieces: TextPiece[]): Line[] {
  const lines: Line[] = [];
  const sorted = [...pieces]
    .filter((piece) => piece.text.trim() !== "")
    .sort((a, b) => (b.y === a.y ? a.x - b.x : b.y - a.y));

  for (const piece of sorted) {
    const tolerance = Math.max(2, piece.height * 0.5);
    const line = lines.find((candidate) => Math.abs(candidate.y - piece.y) <= tolerance);
    if (line === undefined) {
      lines.push({ y: piece.y, height: piece.height, pieces: [piece] });
    } else {
      line.pieces.push(piece);
      line.height = Math.max(line.height, piece.height);
    }
  }

  for (const line of lines) line.pieces.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/**
 * One piece's runs, with the whitespace at its outer edges removed.
 *
 * The trim is the old per-piece `.trim()`, kept because pdf.js hands out items
 * with stray edge spaces and cells put their own separators between them. It
 * applies to the piece's two ends, never between its runs.
 */
function pieceSpans(piece: TextPiece): Span[] {
  const spans = (piece.spans ?? [{ text: piece.text, format: 0 }]).map((span) => ({ ...span }));
  if (spans.length === 0) return spans;
  spans[0].text = spans[0].text.replace(/^\s+/, "");
  spans[spans.length - 1].text = spans[spans.length - 1].text.replace(/\s+$/, "");
  return spans.filter((span) => span.text !== "");
}

/** Split a line at its wide gaps. One cell for a paragraph; several for a table row. */
export function lineCells(line: Line): Cell[] {
  const cells: { x: number; spans: Span[] }[] = [];
  let current: { x: number; spans: Span[] } | null = null;
  let previousEnd = 0;

  for (const piece of line.pieces) {
    const gap = current === null ? 0 : piece.x - previousEnd;
    // The piece's own runs, trimmed at its two outer edges only. Whitespace
    // *inside* a piece is the producer's and stays exactly as it was: stripping
    // the markers back out has to give the text this tool returned before.
    const spans = pieceSpans(piece);
    if (current === null || gap > gapThreshold(line.height)) {
      current = { x: piece.x, spans };
      cells.push(current);
    } else {
      // Sub-point gaps are glyph positioning inside one word, not a space.
      if (gap > 1) {
        // A gap between two struck pieces was struck too — the producer drew one
        // rectangle across both — so it must not break the span in half.
        const before = current.spans[current.spans.length - 1]?.format ?? 0;
        const after = spans[0]?.format ?? 0;
        current.spans.push({ text: " ", format: before === after ? before : 0 });
      }
      current.spans.push(...spans);
    }
    previousEnd = piece.x + piece.width;
  }
  return cells
    .map((cell) => ({ x: cell.x, text: renderSpans(cell.spans) }))
    .filter((cell) => cell.text !== "");
}

/** The whole line as text, wide gaps collapsed to single spaces. */
export function lineText(line: Line): string {
  return lineCells(line)
    .map((cell) => cell.text)
    .join(" ");
}

/* ── Struck text ────────────────────────────────────────────────────────────── */

/**
 * A PDF has no struck-through text. A producer draws the strike as a thin filled
 * shape over the glyphs and the text layer records only the glyphs, so the
 * document's "this no longer applies" is invisible to anything reading text
 * alone. What follows reads the page's drawing operations and puts it back.
 *
 * The thresholds are measured, not guessed. On a Word-produced PDF the strikes
 * sit at +0.31 × the font size above the baseline and the hyperlink underlines at
 * −0.07 to −0.13, so the two are separated by a wide empty band; the page rules
 * are stroked where the strikes are filled. Every number below sits inside that
 * band or on the safe side of that distinction.
 */

/** Below this, the shape is under the text: an underline, not a strike. */
export const STRIKE_MIN_OFFSET = 0.1;
/** Above this, the shape is too high to be crossing this line out. */
export const STRIKE_MAX_OFFSET = 0.55;
/** A strike is a hairline. Anything thicker is a highlight, a box or a bar. */
export const STRIKE_MAX_THICKNESS = 0.25;
/** Cover this much of a piece and the whole piece is struck; below it, split. */
export const STRIKE_FULL_COVERAGE = 0.9;

/** The paint operators that leave a filled shape. A stroked path is a rule or a border. */
const FILLING_PAINTS = ["fill", "eoFill", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"];

interface OperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

/**
 * The shapes a page draws, in page space.
 *
 * Path bounding boxes arrive in the current path space while text arrives in page
 * space, so nothing can be compared until the CTM has been composed — hence the
 * save/restore stack. Only the six components and post-multiplication are needed,
 * the same slice of a matrix `FallbackDOMMatrix` covers.
 *
 * `constructPath` carries its paint operator as its first argument in pdf.js 6,
 * which is what says whether a shape was filled or merely stroked.
 */
export function collectShapes(operators: OperatorList, ops: Record<string, number>): DrawnShape[] {
  const filling = new Set(FILLING_PAINTS.map((name) => ops[name]).filter((op) => op !== undefined));
  const shapes: DrawnShape[] = [];

  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const multiply = (m: number[], n: number[]): number[] => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const apply = (m: number[], x: number, y: number): [number, number] => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];

  for (const [index, op] of operators.fnArray.entries()) {
    if (op === ops.save) {
      stack.push(ctm);
    } else if (op === ops.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (op === ops.transform) {
      const args = operators.argsArray[index];
      if (Array.isArray(args) && args.length >= 6) ctm = multiply(ctm, args as number[]);
    } else if (op === ops.constructPath) {
      const args = operators.argsArray[index] as [number, unknown, ArrayLike<number>] | undefined;
      if (args === undefined) continue;
      const box = args[2];
      if (box === undefined || box.length < 4) continue;
      const [x0, y0] = apply(ctm, box[0], box[1]);
      const [x1, y1] = apply(ctm, box[2], box[3]);
      shapes.push({
        x: Math.min(x0, x1),
        xEnd: Math.max(x0, x1),
        y: (y0 + y1) / 2,
        height: Math.abs(y1 - y0),
        filled: filling.has(args[0]),
      });
    }
  }
  return shapes;
}

/** How much of `[x, xEnd)` a shape covers, clipped to it. */
function overlapWidth(shape: DrawnShape, x: number, xEnd: number): number {
  return Math.max(0, Math.min(shape.xEnd, xEnd) - Math.max(shape.x, x));
}

/**
 * The index nearest `target` at which the text can be cut without cutting a word.
 *
 * A producer that emits a whole line as one string — every browser does — gives
 * no per-glyph positions, so where a strike stops inside that string is known
 * only in proportion. A word boundary is the most precise honest answer: rounding
 * to it can move the marker by part of a word, never into the middle of one.
 */
export function wordBoundaryNear(text: string, target: number): number {
  const boundaries = [0, text.length];
  for (let i = 1; i < text.length; i++) {
    if (/\s/.test(text[i - 1]) !== /\s/.test(text[i])) boundaries.push(i);
  }
  let best = boundaries[0];
  for (const boundary of boundaries) {
    if (Math.abs(boundary - target) < Math.abs(best - target)) best = boundary;
  }
  return best;
}

/**
 * Mark the pieces a strike was drawn across, splitting one only when the producer
 * gave us no finer unit to mark.
 *
 * Nothing here changes what text comes back: a piece is marked, or it is cut into
 * pieces whose texts still concatenate to the original. A missed or spurious
 * strike therefore costs a marker, never content.
 */
export function markStruckPieces(pieces: TextPiece[], shapes: DrawnShape[]): TextPiece[] {
  if (shapes.length === 0) return pieces;

  return pieces.map((piece) => {
    const size = piece.height;
    const end = piece.x + piece.width;
    if (piece.width <= 0 || size <= 0 || piece.text.trim() === "") return piece;

    const covering: [number, number][] = [];
    for (const shape of shapes) {
      if (!shape.filled) continue;
      if (shape.height > STRIKE_MAX_THICKNESS * size) continue;
      const offset = (shape.y - piece.y) / size;
      if (offset < STRIKE_MIN_OFFSET || offset > STRIKE_MAX_OFFSET) continue;
      if (overlapWidth(shape, piece.x, end) <= 0) continue;
      covering.push([Math.max(shape.x, piece.x), Math.min(shape.xEnd, end)]);
    }

    // Merged, not summed: two rectangles over the same words are one strike, and
    // adding their widths would report more coverage than the piece even has.
    const intervals = mergeIntervals(covering);
    if (intervals.length === 0) return piece;

    const covered = intervals.reduce((total, [from, to]) => total + (to - from), 0);
    if (covered / piece.width >= STRIKE_FULL_COVERAGE) {
      return { ...piece, spans: [{ text: piece.text, format: STRIKE }] };
    }

    // Each interval is marked on its own. Collapsing them into one envelope would
    // strike the live words sitting between two struck phrases.
    const length = piece.text.length;
    const index = (x: number) => wordBoundaryNear(piece.text, ((x - piece.x) / piece.width) * length);
    const spans: Span[] = [];
    let at = 0;
    for (const [from, to] of intervals) {
      const start = Math.max(at, index(from));
      const stop = Math.max(start, index(to));
      if (stop <= start) continue;
      if (start > at) spans.push({ text: piece.text.slice(at, start), format: 0 });
      spans.push({ text: piece.text.slice(start, stop), format: STRIKE });
      at = stop;
    }
    if (spans.length === 0) return piece;
    if (at < length) spans.push({ text: piece.text.slice(at), format: 0 });
    return { ...piece, spans };
  });
}

/** Overlapping and touching ranges joined into one, in ascending order. */
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/**
 * Find tabular regions: runs of at least three consecutive multi-cell lines whose
 * cells start at *recurring* x positions. One line with wide gaps is not a table —
 * it is a heading with trailing content, or a figure caption beside a number.
 */
export function detectTableBlocks(lines: Line[]): TableBlock[] {
  const blocks: TableBlock[] = [];
  const cellsPerLine = lines.map(lineCells);

  let runStart: number | null = null;
  for (let i = 0; i <= lines.length; i++) {
    const isRow = i < lines.length && cellsPerLine[i].length >= 2;
    if (isRow) {
      if (runStart === null) runStart = i;
      continue;
    }
    if (runStart !== null) {
      const block = columnsOf(lines, cellsPerLine, runStart, i - 1);
      if (block !== null) blocks.push(block);
      runStart = null;
    }
  }
  return blocks;
}

/** Cluster the run's cell x-starts; a cluster present in most rows is a column. */
function columnsOf(lines: Line[], cellsPerLine: Cell[][], start: number, end: number): TableBlock | null {
  const rowCount = end - start + 1;
  if (rowCount < 3) return null;

  const tolerance = Math.max(12, lines[start].height);
  const clusters: { center: number; rows: Set<number> }[] = [];
  for (let i = start; i <= end; i++) {
    for (const cell of cellsPerLine[i]) {
      const cluster = clusters.find((candidate) => Math.abs(candidate.center - cell.x) <= tolerance);
      if (cluster === undefined) {
        clusters.push({ center: cell.x, rows: new Set([i]) });
      } else {
        // Keep the leftmost anchor: a column's cells align left, and a wider
        // value must not drag the anchor past a narrower one's start.
        cluster.center = Math.min(cluster.center, cell.x);
        cluster.rows.add(i);
      }
    }
  }

  const needed = Math.max(2, Math.ceil(rowCount * 0.6));
  const columns = clusters
    .filter((cluster) => cluster.rows.size >= needed)
    .map((cluster) => cluster.center)
    .sort((a, b) => a - b);

  return columns.length >= 2 ? { start, end, columns } : null;
}

/**
 * Render a detected block as a GFM table. Cells are assigned to the nearest
 * column anchor at or before them, so a value that starts slightly right of its
 * header still lands in its own column.
 *
 * The first row becomes the header only when it fills every column; otherwise the
 * table is emitted with an empty header, because GFM has no headerless form and
 * promoting a partial row would invent a heading the document never had.
 */
export function linesToMarkdownTable(lines: Line[], block: TableBlock): string {
  const rows: string[][] = [];
  for (let i = block.start; i <= block.end; i++) {
    const row = new Array<string>(block.columns.length).fill("");
    for (const cell of lineCells(lines[i])) {
      let index = 0;
      for (let c = 0; c < block.columns.length; c++) {
        if (cell.x >= block.columns[c] - 2) index = c;
      }
      row[index] = row[index] === "" ? escapeCell(cell.text) : `${row[index]} ${escapeCell(cell.text)}`;
    }
    rows.push(row);
  }

  const complete = rows.length > 0 && rows[0].every((value) => value !== "");
  const header = complete ? rows[0] : new Array<string>(block.columns.length).fill("");
  const body = complete ? rows.slice(1) : rows;

  const render = (row: string[]) => `| ${row.join(" | ")} |`;
  return [
    render(header),
    `| ${block.columns.map(() => "---").join(" | ")} |`,
    ...body.map(render),
  ].join("\n");
}

/* ── Page rendering ─────────────────────────────────────────────────────────── */

/** Lines that fall outside every table block, rendered as paragraphs. */
function renderText(lines: Line[], skip: Set<number>): string {
  const out: string[] = [];
  let previous: Line | null = null;
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) out.push(paragraph.join("\n"));
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) {
      flush();
      previous = null;
      continue;
    }
    const line = lines[i];
    if (previous !== null && previous.y - line.y > previous.height * 1.6) flush();
    paragraph.push(lineText(line));
    previous = line;
  }
  flush();
  return out.join("\n\n");
}

/** One page's markdown, in reading order, for the requested mode. */
export function renderPage(lines: Line[], mode: PdfMode): string {
  if (lines.length === 0) return "";
  if (mode === "text") return renderText(lines, new Set());

  const blocks = detectTableBlocks(lines);
  if (mode === "tables") {
    if (blocks.length === 0) return "";
    return blocks.map((block) => linesToMarkdownTable(lines, block)).join("\n\n");
  }

  // "both": tables where they were found, text everywhere else, page order kept.
  const inTable = new Set<number>();
  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) inTable.add(i);
  }

  const chunks: string[] = [];
  let paragraphStart = 0;
  for (const block of blocks) {
    const before = lines.slice(paragraphStart, block.start);
    if (before.length > 0) {
      const text = renderText(before, new Set());
      if (text !== "") chunks.push(text);
    }
    chunks.push(linesToMarkdownTable(lines, block));
    paragraphStart = block.end + 1;
  }
  const tail = lines.slice(paragraphStart);
  if (tail.length > 0) {
    const text = renderText(tail, new Set());
    if (text !== "") chunks.push(text);
  }
  return chunks.join("\n\n");
}

/* ── Page ranges ────────────────────────────────────────────────────────────── */

/**
 * Parse `"3"`, `"2-8"`, `"2-8,12"` into ascending unique page numbers, clamped to
 * the document. A range naming nothing inside the document is an error, not an
 * empty result: silently returning nothing would read as "this PDF is empty".
 */
export function parsePageRange(spec: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const piece = part.trim();
    if (piece === "") continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(piece);
    if (match === null) {
      throw new PdfError("unreadable", `"${piece}" is not a page or a page range (use "3", "2-8" or "2-8,12")`);
    }
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) {
      throw new PdfError("unreadable", `"${piece}" is not a usable page range`);
    }
    for (let page = from; page <= Math.min(to, pageCount); page++) pages.add(page);
  }
  if (pages.size === 0) {
    throw new PdfError("unreadable", `no page of this ${pageCount}-page document falls in "${spec}"`);
  }
  return [...pages].sort((a, b) => a - b);
}

/* ── pdf.js ─────────────────────────────────────────────────────────────────── */

/**
 * Font and cMap data ship as files inside the installed package. They are
 * resolved when the package is on disk (npm install, npx) and simply absent in
 * the single-file build, where a document that needs them reports unextractable
 * text rather than emitting mojibake.
 *
 * pdf.js treats these as URLs and rejects any value that does not end in `/` —
 * `path.sep` therefore breaks every call on Windows, where it is a backslash.
 * The rest of the path may keep its native separators: Node's fs accepts both
 * there, and only the ending is checked. Exported for that reason.
 */
export function pdfjsAssetDirs(): { standardFontDataUrl?: string; cMapUrl?: string } {
  try {
    const require = createRequire(import.meta.url);
    const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
    return {
      standardFontDataUrl: `${path.join(root, "standard_fonts")}/`,
      cMapUrl: `${path.join(root, "cmaps")}/`,
    };
  } catch {
    return {};
  }
}

/**
 * The slice of `DOMMatrix` that headless text extraction uses.
 *
 * pdf.js constructs one at module scope, so without the global no document is
 * readable at all: the `import` throws before any page is touched. It builds one
 * more per glyph when it compiles a Type3 char proc whose body is an image mask,
 * which `getTextContent()` reaches because a Type3 font's char procs are parsed
 * when the font loads.
 *
 * Only a scale followed by a translate is ever asked for, and nothing here
 * renders, so the six components and those two operations are the whole
 * requirement. Semantics are `DOMMatrix`'s: both post-multiply, and `scaleSelf`
 * with one argument scales both axes.
 *
 * Anything beyond that throws rather than answering wrongly. Should rendering
 * ever be added here, an unimplemented method is a loud failure, where a matrix
 * that quietly ignored its initial value would be crooked output.
 */
export class FallbackDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: unknown) {
    if (init !== undefined) {
      throw new Error("FallbackDOMMatrix covers text extraction only, which builds no matrix from a value");
    }
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    this.a *= scaleX;
    this.b *= scaleX;
    this.c *= scaleY;
    this.d *= scaleY;
    return this;
  }

  translateSelf(tx = 0, ty = 0): this {
    this.e += this.a * tx + this.c * ty;
    this.f += this.b * tx + this.d * ty;
    return this;
  }
}

/**
 * Give pdf.js the `DOMMatrix` it expects to find on the global object.
 *
 * pdf.js polyfills it from `@napi-rs/canvas`, an optional native package that is
 * absent from the single-file build and from any install that skipped optional
 * dependencies. Where it is missing, upstream only warns — and then every
 * extraction, of every document, dies with `DOMMatrix is not defined`, returning
 * no text at all rather than degraded text.
 *
 * The real implementation is preferred when it is installed, so rendering
 * elsewhere in the process keeps a complete matrix; the fallback covers the case
 * upstream leaves broken. Exported for the tests.
 */
export function ensureDomMatrix(): void {
  const globals = globalThis as { DOMMatrix?: unknown };
  if (globals.DOMMatrix) return;
  try {
    const require = createRequire(import.meta.url);
    const canvas = require("@napi-rs/canvas") as { DOMMatrix?: unknown };
    if (canvas.DOMMatrix) {
      globals.DOMMatrix = canvas.DOMMatrix;
      return;
    }
  } catch {
    // No native canvas here — the fallback below is what text extraction needs.
  }
  globals.DOMMatrix = FallbackDOMMatrix;
}

interface PdfJsTextItem {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
}

interface PdfJsPage {
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<OperatorList>;
}

interface PdfJsDocument {
  numPages: number;
  getPage(page: number): Promise<PdfJsPage>;
}

/** Deadline that rejects instead of letting a hostile document run forever. */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfError("budget", `${what} exceeded the ${ms} ms budget`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * The parser, loaded at most once per process.
 *
 * Held here so no document's deadline pays for it. Loading pdf.js is a fixed
 * process cost — megabytes of module through the loader, and a native canvas
 * package behind it — and on a cold Windows runner it can run to tens of
 * seconds, which the first extraction was spending out of the budget meant to
 * bound the document. A failed load is not cached: it is a broken install or a
 * missing file, and the next call should be free to see it fail again.
 */
let parser: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | undefined;

export function loadPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  parser ??= (async () => {
    // Before the import: pdf.js reads `DOMMatrix` while the module evaluates.
    ensureDomMatrix();
    // Node has no Worker to hand pdf.js, so `getDocument()` runs the "fake
    // worker" path: the same worker code, in-process, instead of a real thread.
    // Left to find that code itself, pdf.js defaults `workerSrc` to
    // "./pdf.worker.mjs" and reaches it with a *dynamic* `import()` resolved next
    // to the installed package — fine with `node_modules` on disk, but there is
    // no such file "next to" a single-file SEA executable, and Node's SEA loader
    // only resolves dynamic `import()` to built-in modules. There it fails with
    // "No such built-in module: ./pdf.worker.mjs" and every extraction dies.
    //
    // pdf.js checks `globalThis.pdfjsWorker` before ever taking that dynamic
    // path (its own documented Node.js pattern), so importing the worker
    // ourselves — statically, so esbuild bundles it into the same output file —
    // and publishing it there short-circuits the lookup entirely.
    const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })().catch((error: unknown) => {
    parser = undefined;
    throw error;
  });
  return parser;
}

async function openDocument(bytes: Uint8Array, timeoutMs: number): Promise<{ doc: PdfJsDocument; destroy: () => Promise<void> }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    // A copy, because pdf.js transfers the buffer to its worker and detaches it.
    // Without this the caller's array is emptied behind their back, and a second
    // call on the same bytes fails with "Cannot transfer object of unsupported type".
    data: new Uint8Array(bytes),
    // SECURITY: untrusted input. No fetching and no system font probing. There is
    // no `isEvalSupported` to turn off any more — pdf.js 6 dropped eval entirely,
    // and the core API exposes no PDF-scripting switch because it never runs it.
    useWorkerFetch: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    ...pdfjsAssetDirs(),
    cMapPacked: true,
  });

  try {
    const doc = (await withDeadline(task.promise, timeoutMs, "opening the document")) as unknown as PdfJsDocument;
    return { doc, destroy: () => task.destroy() };
  } catch (error) {
    await task.destroy().catch(() => {});
    throw asPdfError(error);
  }
}

function asPdfError(error: unknown): PdfError {
  if (error instanceof PdfError) return error;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException") {
    return new PdfError("encrypted", "This PDF is password-protected; its content cannot be read.");
  }
  if (name === "InvalidPDFException" || name === "MissingPDFException" || name === "UnexpectedResponseException") {
    return new PdfError("unreadable", `This file could not be read as a PDF: ${message}`);
  }
  return new PdfError("unreadable", `This PDF could not be parsed: ${message}`);
}

function toPieces(items: unknown[]): TextPiece[] {
  const pieces: TextPiece[] = [];
  for (const raw of items) {
    const item = raw as PdfJsTextItem;
    const transform = item.transform;
    if (typeof item.str !== "string" || !Array.isArray(transform) || transform.length < 6) continue;
    pieces.push({
      text: item.str,
      x: transform[4],
      y: transform[5],
      width: typeof item.width === "number" ? item.width : 0,
      // pdf.js reports height 0 for the synthetic spaces it inserts across gaps;
      // fall back to the text matrix's vertical scale so the line tolerance holds.
      height: typeof item.height === "number" && item.height > 0 ? item.height : Math.abs(transform[3]) || 10,
    });
  }
  return pieces;
}

/**
 * The shapes drawn on one page, or none.
 *
 * A page whose drawing operations cannot be walked still has text, and text is
 * what this tool is for: a broken operator list costs the markers, not the page.
 * The budget is the one failure that still propagates — it bounds the document,
 * and swallowing it here would let a hostile file spend the whole deadline
 * failing quietly, once per page.
 *
 * Exported for the tests: a page whose operator list rejects is not a state any
 * fixture can produce, and it is exactly the state that must not lose the text.
 */
export async function pageShapes(
  page: PdfJsPage,
  ops: Record<string, number>,
  timeoutMs: number,
  pageNumber: number,
): Promise<DrawnShape[]> {
  try {
    const operators = await withDeadline(
      page.getOperatorList(),
      timeoutMs,
      `reading the drawing on page ${pageNumber}`,
    );
    return collectShapes(operators, ops);
  } catch (error) {
    if (error instanceof PdfError && error.reason === "budget") throw error;
    return [];
  }
}

/* ── Extraction ─────────────────────────────────────────────────────────────── */

/**
 * Extract a PDF's content as markdown, page by page.
 *
 * Stops at the first cap it meets — pages, characters, or the deadline — and says
 * so in the output, naming the next page to ask for. Never returns silence: a
 * document with no text layer says that instead.
 */
export async function extractPdf(bytes: Uint8Array, options: PdfExtractOptions = {}): Promise<PdfExtraction> {
  const mode = options.mode ?? "both";
  const full = options.full === true;
  const maxPages = options.maxPages ?? (full ? Number.POSITIVE_INFINITY : DEFAULT_MAX_PAGES);
  const maxChars = options.maxChars ?? (full ? ABSOLUTE_MAX_CHARS : DEFAULT_MAX_CHARS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The clock starts once the parser is in hand: the budget bounds this
  // document, not the one-time cost of loading pdf.js.
  const pdfjs = await loadPdfjs();
  const started = Date.now();

  const { doc, destroy } = await openDocument(bytes, timeoutMs);
  try {
    const pageCount = doc.numPages;
    const requested = options.pages ? parsePageRange(options.pages, pageCount) : rangeTo(pageCount);

    const sections: string[] = [];
    const covered: number[] = [];
    const withoutText: number[] = [];
    let characters = 0;
    let nextPage: number | undefined;

    for (const [index, pageNumber] of requested.entries()) {
      if (index >= maxPages || characters >= maxChars) {
        // Under `full` the caller asked for everything, so stopping here would
        // hand back a document that looks complete and is not.
        if (full) {
          throw new PdfError(
            "too-large",
            `This document is larger than the ${ABSOLUTE_MAX_CHARS} character ceiling for a single answer. ` +
              `Extract it to a file with output_path, or ask for a page range.`,
          );
        }
        nextPage = pageNumber;
        break;
      }
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) throw new PdfError("budget", `extraction exceeded the ${timeoutMs} ms budget`);

      const page = await withDeadline(doc.getPage(pageNumber), remaining, `reading page ${pageNumber}`);
      const content = await withDeadline(page.getTextContent(), remaining, `reading page ${pageNumber}`);
      // Recomputed, not reused: the two reads share one page's budget rather than
      // getting one each, or a single page could spend twice what it is allowed.
      const left = timeoutMs - (Date.now() - started);
      if (left <= 0) throw new PdfError("budget", `extraction exceeded the ${timeoutMs} ms budget`);
      const shapes = await pageShapes(page, pdfjs.OPS as unknown as Record<string, number>, left, pageNumber);
      const lines = buildLines(markStruckPieces(toPieces(content.items), shapes));

      covered.push(pageNumber);
      if (lines.length === 0) {
        withoutText.push(pageNumber);
        sections.push(`## Page ${pageNumber}\n\n_No text layer on this page — it is an image (a scan). OCR is not available._`);
        continue;
      }
      const body = renderPage(lines, mode);
      const section =
        body === ""
          ? `## Page ${pageNumber}\n\n_No table found on this page._`
          : `## Page ${pageNumber}\n\n${body}`;
      characters += section.length;
      sections.push(section);
    }

    const notes: string[] = [];
    if (withoutText.length === covered.length && covered.length > 0) {
      notes.push(
        `> This document has no extractable text layer (pages ${describePages(withoutText)}); reading it would require OCR, which is not available.`,
      );
    } else if (withoutText.length > 0) {
      notes.push(`> No text layer on page${withoutText.length === 1 ? "" : "s"} ${describePages(withoutText)}.`);
    }
    if (nextPage !== undefined) {
      notes.push(
        `> Truncated: pages ${describePages(covered)} of ${pageCount} shown. Call again with pages="${nextPage}-${pageCount}" for the rest.`,
      );
    }

    // The strikethrough notice leads; everything else trails. See
    // `struckThroughNotice` for why that one is not a trailing note.
    const lead = struckThroughNotice(sections.join("\n\n"));

    return {
      markdown: [...(lead ? [lead] : []), ...sections, ...notes].join("\n\n"),
      pages: covered,
      ...(nextPage === undefined ? {} : { nextPage }),
      pageCount,
    };
  } catch (error) {
    throw asPdfError(error);
  } finally {
    await destroy().catch(() => {});
  }
}

function rangeTo(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** "1-4" for a run, "1, 3, 7" otherwise — a page list should read like one. */
function describePages(pages: number[]): string {
  if (pages.length === 0) return "none";
  const contiguous = pages.every((page, i) => i === 0 || page === pages[i - 1] + 1);
  if (contiguous && pages.length > 1) return `${pages[0]}-${pages[pages.length - 1]}`;
  return pages.join(", ");
}
