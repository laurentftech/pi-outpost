/**
 * Word (.docx) text, headings and tables, as markdown.
 *
 * The difference from `pdf.ts` is the whole design: a PDF states where ink
 * landed and the reader infers structure from geometry, where a .docx states its
 * structure outright — `<w:tbl>` is a table, a paragraph's style says it is a
 * heading. Nothing here is approximate, so nothing here needs a fallback mode to
 * recover what an approximation lost.
 *
 * SECURITY: a .docx is attacker-controlled *compressed* data, which the PDF path
 * never was. Entry count, decompressed size, wall-clock time and output size are
 * all capped, and the XML scanner refuses a DOCTYPE outright so entity expansion
 * is unreachable rather than merely disabled.
 */
import { escapeCell, renderMarkdownTable } from "./markdownTable.ts";
import { scanXml, XmlError } from "./xml.ts";
import { readZipEntry, ZipError, type ZipLimits } from "./zip.ts";

export type DocxMode = "text" | "tables" | "both";

export type DocxErrorReason =
  /** Not a Word document, or damaged past reading. */
  | "unreadable"
  /** The package is encrypted; its parts are not readable as XML. */
  | "encrypted"
  /** A part expanded past the decompression budget, or the archive is oversized. */
  | "too-large"
  /** Parsing exceeded the time budget. */
  | "budget";

export class DocxError extends Error {
  constructor(
    readonly reason: DocxErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "DocxError";
  }
}

export interface DocxExtractOptions {
  /** `"12"`, `"5-40"`, `"5-40,80"`. Omitted means "from the first block until a cap stops us". */
  blocks?: string;
  mode?: DocxMode;
  /**
   * Return the whole document rather than one call's worth. The per-call caps
   * lift; ABSOLUTE_MAX_CHARS and the deadline still apply, and a document past
   * that ceiling is refused rather than quietly cut.
   */
  full?: boolean;
  maxBlocks?: number;
  maxChars?: number;
  timeoutMs?: number;
}

export interface DocxExtraction {
  markdown: string;
  /** Blocks actually covered, in order. */
  blocks: number[];
  /** First block a cap kept back, when one did. */
  nextBlock?: number;
  blockCount: number;
}

/** Caps chosen so one call cannot spend a session's context on a long specification. */
export const DEFAULT_MAX_BLOCKS = 200;
export const DEFAULT_MAX_CHARS = 40_000;
/**
 * The ceiling `full` cannot lift — roughly 100 000 tokens. Past it the call is
 * refused and pointed at a file, because a truncated "whole document" is the
 * failure this option exists to remove.
 */
export const ABSOLUTE_MAX_CHARS = 400_000;
export const DEFAULT_TIMEOUT_MS = 20_000;
/** A package with more entries than this is refused before anything is inflated. */
export const MAX_ZIP_ENTRIES = 512;
/** Ceiling on one inflated part — `document.xml` of a very long report stays well under. */
export const MAX_PART_BYTES = 64 * 1024 * 1024;
/** A document with more blocks than this is pathological; stop rather than fill memory. */
export const MAX_PARSED_BLOCKS = 50_000;

const DOCUMENT_PART = "word/document.xml";
const CONTENT_TYPES = "[Content_Types].xml";
/** OLE compound files (encrypted OOXML) start with this, not with "PK". */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

/* ── Blocks ─────────────────────────────────────────────────────────────────── */

export type DocxBlock =
  | { kind: "paragraph"; text: string; heading?: number }
  | { kind: "table"; rows: string[][] };

/** A style id or outline level that names a heading, or undefined. */
function headingLevel(styleId: string | undefined, outlineLevel: string | undefined): number | undefined {
  if (styleId !== undefined) {
    // "Heading2", and the localized ids Word writes for some install languages
    const match = /^(?:heading|titre|berschrift|encabezado|titolo)\s*-?(\d)$/i.exec(styleId.replace(/^Ü/i, ""));
    if (match) return Math.min(6, Number(match[1]));
  }
  if (outlineLevel !== undefined) {
    const level = Number(outlineLevel);
    // outlineLvl is 0-based: 0 is Heading 1
    if (Number.isInteger(level) && level >= 0 && level <= 8) return Math.min(6, level + 1);
  }
  return undefined;
}

/**
 * Walk `word/document.xml` into blocks, in document order.
 *
 * Tracked deletions are skipped as the walk passes them (`<w:del>` wraps deleted
 * runs, whose text sits in `<w:delText>`), so deleted text is absent by
 * construction rather than filtered out afterwards — there is no mode or flag
 * that could let it through.
 */
export function parseBody(xml: string, deadline?: () => void): DocxBlock[] {
  const blocks: DocxBlock[] = [];

  let paragraph: string[] = [];
  let paragraphHeading: number | undefined;
  let styleId: string | undefined;
  let outlineLevel: string | undefined;

  let tableDepth = 0;
  let rows: string[][] = [];
  let row: string[] = [];
  let cell: string[] = [];
  let inCell = false;

  let deletionDepth = 0;
  let textTarget: "paragraph" | "cell" | null = null;
  let events = 0;

  const flushParagraph = () => {
    const text = paragraph.join("").replace(/\s+/g, " ").trim();
    paragraph = [];
    const heading = paragraphHeading;
    paragraphHeading = undefined;
    styleId = undefined;
    outlineLevel = undefined;
    if (text === "") return;
    blocks.push(heading === undefined ? { kind: "paragraph", text } : { kind: "paragraph", text, heading });
  };

  scanXml(xml, (event) => {
    if (++events % 2000 === 0) deadline?.();
    if (blocks.length > MAX_PARSED_BLOCKS) return false;

    if (event.kind === "open") {
      switch (event.name) {
        case "w:del":
          deletionDepth++;
          break;
        case "w:tbl":
          if (tableDepth === 0) {
            flushParagraph();
            rows = [];
          }
          tableDepth++;
          break;
        case "w:tr":
          if (tableDepth === 1) row = [];
          break;
        case "w:tc":
          if (tableDepth === 1) {
            cell = [];
            inCell = true;
          }
          break;
        case "w:p":
          if (!inCell) {
            paragraph = [];
            paragraphHeading = undefined;
          }
          break;
        case "w:pStyle":
          styleId = event.attributes["w:val"];
          break;
        case "w:outlineLvl":
          outlineLevel = event.attributes["w:val"];
          break;
        case "w:t":
          if (deletionDepth === 0) textTarget = inCell ? "cell" : "paragraph";
          break;
        case "w:tab":
          (inCell ? cell : paragraph).push(" ");
          break;
        case "w:br":
        case "w:cr":
          (inCell ? cell : paragraph).push(" ");
          break;
        default:
          break;
      }
      // A self-closing tag never reaches the close branch, so close it here
      if (event.selfClosing) closeElement(event.name);
      return;
    }

    if (event.kind === "text") {
      if (textTarget === "paragraph") paragraph.push(event.text);
      else if (textTarget === "cell") cell.push(event.text);
      return;
    }

    closeElement(event.name);
  });

  /**
   * Shared by the close branch and by self-closing tags. `<w:tc/>` is a real
   * empty cell and `<w:p/>` a real empty paragraph: treating them as opens that
   * never close drops a column from the row they belong to.
   */
  function closeElement(name: string): void {
    switch (name) {
      case "w:t":
        textTarget = null;
        break;
      case "w:del":
        if (deletionDepth > 0) deletionDepth--;
        break;
      case "w:p":
        if (inCell) cell.push(" ");
        else {
          paragraphHeading = headingLevel(styleId, outlineLevel);
          flushParagraph();
        }
        break;
      case "w:tc":
        if (tableDepth === 1) {
          row.push(cell.join("").replace(/\s+/g, " ").trim());
          inCell = false;
        }
        break;
      case "w:tr":
        if (tableDepth === 1) rows.push(row);
        break;
      case "w:tbl":
        tableDepth--;
        if (tableDepth === 0 && rows.length > 0) {
          // A table with a single cell is layout, not data — the cover page of a
          // report, a callout box. Rendering it as a table would hand the model an
          // empty header row and a separator around one paragraph of prose.
          const single = rows.length === 1 && rows[0].length === 1;
          if (single) {
            const text = rows[0][0];
            if (text !== "") blocks.push({ kind: "paragraph", text });
          } else {
            blocks.push({ kind: "table", rows });
          }
        }
        break;
      default:
        break;
    }
  }

  flushParagraph();
  return blocks;
}

/* ── Rendering ──────────────────────────────────────────────────────────────── */

/** One block as markdown, or "" when this mode does not show it. */
export function renderBlock(block: DocxBlock, mode: DocxMode): string {
  if (block.kind === "table") {
    if (mode === "text") {
      // The safety valve the PDF path needs for a different reason: a caller
      // asking for text gets the table's content as lines, not as nothing.
      return block.rows.map((row) => row.join(" — ")).join("\n");
    }
    // A first row that fills every column reads as a header; anything else does not
    const header = block.rows.length > 1 && block.rows[0].every((value) => value.trim() !== "");
    return renderMarkdownTable(block.rows, { header });
  }
  if (mode === "tables") return "";
  return block.heading === undefined ? block.text : `${"#".repeat(block.heading)} ${block.text}`;
}

/* ── Block ranges ───────────────────────────────────────────────────────────── */

/**
 * Parse `"3"`, `"5-40"`, `"5-40,80"` into ascending unique block numbers, clamped
 * to the document. A range naming nothing inside it is an error rather than an
 * empty result: silence would read as "this document is empty".
 */
export function parseBlockRange(spec: string, blockCount: number): number[] {
  const wanted = new Set<number>();
  for (const part of spec.split(",")) {
    const piece = part.trim();
    if (piece === "") continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(piece);
    if (match === null) {
      throw new DocxError("unreadable", `"${piece}" is not a block or a block range (use "3", "5-40" or "5-40,80")`);
    }
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) throw new DocxError("unreadable", `"${piece}" is not a usable block range`);
    for (let block = from; block <= Math.min(to, blockCount); block++) wanted.add(block);
  }
  if (wanted.size === 0) {
    throw new DocxError("unreadable", `no block of this ${blockCount}-block document falls in "${spec}"`);
  }
  return [...wanted].sort((a, b) => a - b);
}

/* ── Extraction ─────────────────────────────────────────────────────────────── */

function asDocxError(error: unknown): DocxError {
  if (error instanceof DocxError) return error;
  if (error instanceof ZipError) {
    if (error.reason === "too-large") return new DocxError("too-large", error.message);
    if (error.reason === "too-many-entries") return new DocxError("too-large", error.message);
    return new DocxError("unreadable", `This file could not be read as a Word document: ${error.message}`);
  }
  if (error instanceof XmlError) {
    return new DocxError("unreadable", `This document's XML could not be read: ${error.message}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DocxError("unreadable", `This file could not be read as a Word document: ${message}`);
}

/**
 * Extract a Word document's content as markdown, block by block.
 *
 * Stops at the first cap it meets — blocks, characters, or the deadline — and
 * says so, naming the next block to ask for. Never returns silence: a document
 * whose body holds nothing says that, and names the parts this reader does not
 * look at.
 */
export async function extractDocx(bytes: Uint8Array, options: DocxExtractOptions = {}): Promise<DocxExtraction> {
  const mode = options.mode ?? "both";
  const full = options.full === true;
  const maxBlocks = options.maxBlocks ?? (full ? Number.POSITIVE_INFINITY : DEFAULT_MAX_BLOCKS);
  const maxChars = options.maxChars ?? (full ? ABSOLUTE_MAX_CHARS : DEFAULT_MAX_CHARS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const deadline = () => {
    if (Date.now() - started > timeoutMs) {
      throw new DocxError("budget", `extraction exceeded the ${timeoutMs} ms budget`);
    }
  };

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.subarray(0, 4).equals(OLE_MAGIC)) {
    throw new DocxError("encrypted", "This Word document is password-protected; its content cannot be read.");
  }

  const limits: ZipLimits = { maxEntries: MAX_ZIP_ENTRIES, maxInflatedBytes: MAX_PART_BYTES };
  let documentXml: Buffer | null;
  try {
    if (readZipEntry(buffer, CONTENT_TYPES, limits) === null) {
      throw new DocxError("unreadable", "This file is not an Office package (no [Content_Types].xml).");
    }
    deadline();
    documentXml = readZipEntry(buffer, DOCUMENT_PART, limits);
  } catch (error) {
    throw asDocxError(error);
  }
  if (documentXml === null) {
    throw new DocxError("unreadable", `This package has no ${DOCUMENT_PART}: it is not a Word document.`);
  }

  let blocks: DocxBlock[];
  try {
    blocks = parseBody(documentXml.toString("utf8"), deadline);
  } catch (error) {
    throw asDocxError(error);
  }

  const blockCount = blocks.length;
  if (blockCount === 0) {
    return {
      markdown:
        "_This document has no extractable body content._\n\n" +
        "> Headers, footers, footnotes, comments, text boxes and images are not read by this tool.",
      blocks: [],
      blockCount: 0,
    };
  }

  const requested = options.blocks ? parseBlockRange(options.blocks, blockCount) : rangeTo(blockCount);
  const pieces: string[] = [];
  const covered: number[] = [];
  let characters = 0;
  let nextBlock: number | undefined;

  for (const [index, number] of requested.entries()) {
    if (index >= maxBlocks || characters >= maxChars) {
      // Under `full` the caller asked for everything, so stopping here would
      // hand back a document that looks complete and is not.
      if (full) {
        throw new DocxError(
          "too-large",
          `This document is larger than the ${ABSOLUTE_MAX_CHARS} character ceiling for a single answer. ` +
            `Extract it to a file with output_path, or ask for a block range.`,
        );
      }
      nextBlock = number;
      break;
    }
    deadline();
    const rendered = renderBlock(blocks[number - 1], mode);
    covered.push(number);
    if (rendered === "") continue;
    characters += rendered.length;
    pieces.push(rendered);
  }

  const notes: string[] = [];
  if (pieces.length === 0) {
    notes.push(
      mode === "tables"
        ? "> No table was found in the blocks read."
        : "> The blocks read hold no text.",
    );
  }
  if (nextBlock !== undefined) {
    notes.push(
      `> Truncated: blocks ${describeBlocks(covered)} of ${blockCount} shown. ` +
        `Call again with blocks="${nextBlock}-${blockCount}" for the rest.`,
    );
  }

  return {
    markdown: [...pieces, ...notes].join("\n\n"),
    blocks: covered,
    ...(nextBlock === undefined ? {} : { nextBlock }),
    blockCount,
  };
}

function rangeTo(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** "1-40" for a run, "1, 3, 7" otherwise — a list of blocks should read like one. */
function describeBlocks(blocks: number[]): string {
  if (blocks.length === 0) return "none";
  const contiguous = blocks.every((block, i) => i === 0 || block === blocks[i - 1] + 1);
  if (contiguous && blocks.length > 1) return `${blocks[0]}-${blocks[blocks.length - 1]}`;
  return blocks.join(", ");
}
