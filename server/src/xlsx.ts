/**
 * Spreadsheet (.xlsx) sheets and cells, as markdown.
 *
 * The container is the one the Word reader already opened: the same OOXML zip,
 * read by `zip.ts` one entry at a time, scanned by `xml.ts` which refuses a
 * DOCTYPE. What is new is the content model, and every part of it is a way to be
 * quietly wrong:
 *
 * - **Text is not in the sheet.** It lives in `xl/sharedStrings.xml`, and the
 *   cell holds an index into it.
 * - **The grid is sparse and addressed.** Empty cells are absent from the file
 *   entirely, so `A1, D1` is a row of four columns and reading cells positionally
 *   puts every value one column too far left.
 * - **A number does not say what it is.** `45292` is a date, `0.15` a percentage,
 *   and only `xl/styles.xml` separates them (see `xlsxFormats.ts`).
 *
 * Each of those produces a table that *looks* right. That is this reader's
 * characteristic failure and the reason the tests lean where they do.
 *
 * SECURITY: attacker-controlled compressed data. Entry count, decompressed size,
 * wall-clock time, parsed rows and output size are all capped; entry names are
 * never used as filesystem paths.
 */
import { renderMarkdownTable } from "./markdownTable.ts";
import { scanXml, XmlError } from "./xml.ts";
import {
  formatForStyle,
  renderNumericValue,
  type WorkbookStyles,
} from "./xlsxFormats.ts";
import { readZipEntry, ZipError, type ZipLimits } from "./zip.ts";

export type XlsxErrorReason =
  /** Not a workbook, or damaged past reading. */
  | "unreadable"
  /** The package is encrypted; its parts are not readable as XML. */
  | "encrypted"
  /** A part expanded past the decompression budget, or the archive is oversized. */
  | "too-large"
  /** Parsing exceeded the time budget. */
  | "budget";

export class XlsxError extends Error {
  constructor(
    readonly reason: XlsxErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "XlsxError";
  }
}

export interface XlsxExtractOptions {
  /** One sheet by name. Omitted means every visible sheet, in workbook order. */
  sheet?: string;
  /** `"12"`, `"5-40"`, `"5-40,80"`, `"501-"`. Omitted means "from the first row until a cap stops us". */
  rows?: string;
  /**
   * Return the whole workbook rather than one call's worth. The per-call caps
   * lift; ABSOLUTE_MAX_CHARS and the deadline still apply, and a workbook past
   * that ceiling is refused rather than quietly cut.
   */
  full?: boolean;
  maxRows?: number;
  maxChars?: number;
  timeoutMs?: number;
}

export interface XlsxExtraction {
  markdown: string;
  /** Sheets that produced content, in order. */
  sheets: string[];
  /** Rows rendered across all of them. */
  rowsCovered: number;
  /** Visible sheets in the workbook. */
  sheetCount: number;
}

/** Caps chosen so one call cannot spend a session's context on a large workbook. */
export const DEFAULT_MAX_ROWS = 500;
export const DEFAULT_MAX_CHARS = 40_000;
/**
 * The ceiling `full` cannot lift — roughly 100 000 tokens. Past it the call is
 * refused and pointed at a file, because a truncated "whole workbook" is the
 * failure this option exists to remove.
 */
export const ABSOLUTE_MAX_CHARS = 400_000;
export const DEFAULT_TIMEOUT_MS = 20_000;
/** A package with more entries than this is refused before anything is inflated. */
export const MAX_ZIP_ENTRIES = 1024;
/** Ceiling on one inflated part. A sheet is the largest, and a big one stays well under. */
export const MAX_PART_BYTES = 64 * 1024 * 1024;
/** A sheet may declare a million rows; stop rather than fill memory with them. */
export const MAX_PARSED_ROWS = 200_000;

const CONTENT_TYPES = "[Content_Types].xml";
const WORKBOOK_PART = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS = "xl/sharedStrings.xml";
const STYLES_PART = "xl/styles.xml";
/** OLE compound files (encrypted OOXML) start with this, not with "PK". */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

/** Appended to a cell whose number format could not be resolved. */
const RAW_MARK = "*";
/** A formula that has never been computed — different from an empty cell. */
const UNCOMPUTED = "(uncomputed)";

/* ── Cell references ────────────────────────────────────────────────────────── */

/**
 * The column a reference names, 1-based. `A`=1, `Z`=26, `AA`=27 — base 26 with
 * no zero digit, which is why `Z`+1 rolls to `AA` rather than to `BA`.
 */
export function columnFromRef(ref: string): number {
  let column = 0;
  for (const char of ref) {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) column = column * 26 + (code - 64);
    else if (code >= 97 && code <= 122) column = column * 26 + (code - 96);
    else break;
  }
  return column;
}

/** The letters for a 1-based column index — the inverse of the above. */
export function columnLetters(column: number): string {
  let letters = "";
  let left = column;
  while (left > 0) {
    const remainder = (left - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    left = Math.floor((left - 1) / 26);
  }
  return letters;
}

/** The row a reference names, or 0 when it names none. */
export function rowFromRef(ref: string): number {
  const match = /(\d+)$/.exec(ref);
  return match ? Number(match[1]) : 0;
}

/* ── Row ranges ─────────────────────────────────────────────────────────────── */

export interface RowInterval {
  from: number;
  /** `Infinity` for an open range like `"501-"`. */
  to: number;
}

/**
 * Parse `"12"`, `"5-40"`, `"5-40,80"` or `"501-"` into intervals.
 *
 * Intervals rather than a set of row numbers: a sheet holds up to a million
 * rows, and `"1-1000000"` must not become a million-entry set before the first
 * row is read.
 */
export function parseRowRange(spec: string): RowInterval[] {
  const intervals: RowInterval[] = [];
  for (const part of spec.split(",")) {
    const piece = part.trim();
    if (piece === "") continue;
    const match = /^(\d+)(?:\s*-\s*(\d+)?)?$/.exec(piece);
    if (match === null) {
      throw new XlsxError("unreadable", `"${piece}" is not a row or a row range (use "12", "5-40", "5-40,80" or "501-")`);
    }
    const from = Number(match[1]);
    const open = piece.includes("-") && match[2] === undefined;
    const to = open ? Number.POSITIVE_INFINITY : match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) throw new XlsxError("unreadable", `"${piece}" is not a usable row range`);
    intervals.push({ from, to });
  }
  if (intervals.length === 0) throw new XlsxError("unreadable", `"${spec}" names no rows`);
  return intervals;
}

function inIntervals(intervals: RowInterval[] | undefined, row: number): boolean {
  if (intervals === undefined) return true;
  return intervals.some((interval) => row >= interval.from && row <= interval.to);
}

/** The last row any interval can reach, so a walk can stop instead of running to the end. */
function lastWantedRow(intervals: RowInterval[] | undefined): number {
  if (intervals === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(...intervals.map((interval) => interval.to));
}

/* ── Workbook structure ─────────────────────────────────────────────────────── */

export interface SheetEntry {
  name: string;
  /** `"visible"`, `"hidden"` or `"veryHidden"`, as the workbook declares it. */
  state: string;
  relationshipId: string;
}

export interface WorkbookInfo {
  sheets: SheetEntry[];
  /** The 1904 date system, which shifts every serial by four years when missed. */
  epoch1904: boolean;
}

export function parseWorkbook(xml: string): WorkbookInfo {
  const sheets: SheetEntry[] = [];
  let epoch1904 = false;
  scanXml(xml, (event) => {
    if (event.kind !== "open") return;
    if (event.name === "sheet" || event.name.endsWith(":sheet")) {
      sheets.push({
        name: event.attributes.name ?? "",
        state: event.attributes.state ?? "visible",
        relationshipId: event.attributes["r:id"] ?? event.attributes.id ?? "",
      });
      return;
    }
    if (event.name === "workbookPr" || event.name.endsWith(":workbookPr")) {
      const flag = event.attributes.date1904 ?? event.attributes.dateCompatibility;
      epoch1904 = flag === "1" || flag === "true";
    }
  });
  return { sheets, epoch1904 };
}

/**
 * Relationship id → part name, from `xl/_rels/workbook.xml.rels`.
 *
 * The indirection matters: `<sheet r:id="rId3">` says nothing about which file
 * holds the sheet, and assuming `sheetN.xml` matches the Nth `<sheet>` element
 * is wrong on any workbook whose sheets have been reordered or deleted. It is
 * the kind of assumption that holds on every fixture one would write by hand.
 */
export function parseRelationships(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  scanXml(xml, (event) => {
    if (event.kind !== "open") return;
    if (event.name !== "Relationship" && !event.name.endsWith(":Relationship")) return;
    const id = event.attributes.Id;
    const target = event.attributes.Target;
    if (id !== undefined && target !== undefined) targets.set(id, resolvePart(target));
  });
  return targets;
}

/**
 * A relationship target as a package part name. Targets are relative to the part
 * that declares them — `xl/` here — and never touch the filesystem, so this is
 * name arithmetic rather than path resolution.
 */
function resolvePart(target: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

/**
 * The shared string table, in order.
 *
 * One string may be split across several `<r>` runs — that is what formatting
 * part of a cell's text does to the file — so the runs are joined rather than
 * treated as separate strings. `<rPh>` holds phonetic guides for Japanese text
 * and is skipped: it is an annotation, not the cell's content.
 */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let current: string[] = [];
  let inItem = false;
  let phoneticDepth = 0;
  let capture = false;

  scanXml(xml, (event) => {
    if (event.kind === "open") {
      const name = localName(event.name);
      if (name === "si") {
        inItem = true;
        current = [];
      } else if (name === "rPh") phoneticDepth++;
      else if (name === "t" && inItem && phoneticDepth === 0) capture = true;
      if (event.selfClosing) {
        if (name === "si") {
          strings.push("");
          inItem = false;
        } else if (name === "rPh" && phoneticDepth > 0) phoneticDepth--;
        else if (name === "t") capture = false;
      }
      return;
    }
    if (event.kind === "text") {
      if (capture) current.push(event.text);
      return;
    }
    const name = localName(event.name);
    if (name === "t") capture = false;
    else if (name === "rPh" && phoneticDepth > 0) phoneticDepth--;
    else if (name === "si") {
      strings.push(current.join(""));
      inItem = false;
    }
  });
  return strings;
}

/** `xl/styles.xml`: the style table a cell's `s=` attribute indexes into. */
export function parseStyles(xml: string): WorkbookStyles {
  const numberFormatByStyle: number[] = [];
  const formatCodes = new Map<number, string>();
  let inCellXfs = false;

  scanXml(xml, (event) => {
    if (event.kind === "open") {
      const name = localName(event.name);
      if (name === "cellXfs") inCellXfs = true;
      else if (name === "numFmt") {
        const id = Number(event.attributes.numFmtId);
        const code = event.attributes.formatCode;
        if (Number.isInteger(id) && code !== undefined) formatCodes.set(id, code);
      } else if (name === "xf" && inCellXfs) {
        // `numFmtId` absent means "General", which is id 0 — not "unresolved"
        const id = Number(event.attributes.numFmtId ?? 0);
        numberFormatByStyle.push(Number.isInteger(id) ? id : 0);
      }
      if (event.selfClosing && name === "cellXfs") inCellXfs = false;
      return;
    }
    if (event.kind === "close" && localName(event.name) === "cellXfs") inCellXfs = false;
  });

  return { numberFormatByStyle, formatCodes };
}

/** An element's name without its namespace prefix. */
function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/* ── Sheets ─────────────────────────────────────────────────────────────────── */

export interface SheetRow {
  number: number;
  /** Column index (1-based) → rendered text. Absent columns are absent cells. */
  cells: Map<number, string>;
}

export interface SheetContent {
  rows: SheetRow[];
  /** Widest column index seen in the rows returned. */
  maxColumn: number;
  /** Columns the sheet hides, as 1-based indices. */
  hiddenColumns: Set<number>;
  /** First row a cap kept back, when one did. */
  nextRow?: number;
  /** The last row the sheet's `<dimension>` declares, when it declares one. */
  declaredLastRow?: number;
  /** Cells whose number format could not be resolved, and so carry the raw value. */
  unresolvedCells: number;
}

export interface SheetParseContext {
  sharedStrings: string[];
  styles: WorkbookStyles;
  epoch1904: boolean;
  rows?: RowInterval[];
  maxRows: number;
  deadline?: () => void;
}

/**
 * Walk one sheet into rows of positioned cells.
 *
 * The walk stops at the row cap rather than filtering afterwards, so a sheet of
 * 500 000 rows costs what was asked for and not what it contains.
 */
export function parseSheet(xml: string, context: SheetParseContext): SheetContent {
  const rows: SheetRow[] = [];
  const hiddenColumns = new Set<number>();
  let maxColumn = 0;
  let nextRow: number | undefined;
  let declaredLastRow: number | undefined;
  let unresolvedCells = 0;

  const stopAfter = lastWantedRow(context.rows);
  let events = 0;

  let inSheetData = false;
  let rowNumber = 0;
  let cells = new Map<number, string>();
  let wantedRow = false;

  let column = 0;
  let cellType = "";
  let cellStyle: number | undefined;
  let hasFormula = false;
  let value = "";
  let inline: string[] = [];
  let capture: "value" | "inline" | null = null;

  scanXml(xml, (event) => {
    if (++events % 2000 === 0) context.deadline?.();

    if (event.kind === "text") {
      if (capture === "value") value += event.text;
      else if (capture === "inline") inline.push(event.text);
      return;
    }

    if (event.kind === "open") {
      const name = localName(event.name);
      switch (name) {
        case "dimension": {
          const ref = event.attributes.ref ?? "";
          const last = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
          const row = rowFromRef(last);
          if (row > 0) declaredLastRow = row;
          break;
        }
        case "col": {
          const hidden = event.attributes.hidden;
          if (hidden === "1" || hidden === "true") {
            const min = Number(event.attributes.min ?? 0);
            const max = Number(event.attributes.max ?? min);
            // A `<col>` may span the whole sheet; the bound keeps a hostile file
            // from making us allocate 16 384 entries per column element.
            for (let at = min; at <= Math.min(max, 16_384); at++) {
              if (at > 0) hiddenColumns.add(at);
            }
          }
          break;
        }
        case "sheetData":
          inSheetData = true;
          break;
        case "row": {
          if (!inSheetData) break;
          const declared = Number(event.attributes.r);
          rowNumber = Number.isInteger(declared) && declared > 0 ? declared : rowNumber + 1;
          cells = new Map();
          column = 0;
          if (rowNumber > stopAfter) {
            // Past every interval asked for: nothing later can be wanted.
            return false;
          }
          wantedRow = inIntervals(context.rows, rowNumber);
          if (wantedRow && rows.length >= context.maxRows) {
            nextRow = rowNumber;
            return false;
          }
          break;
        }
        case "c": {
          if (!inSheetData) break;
          const ref = event.attributes.r;
          column = ref === undefined ? column + 1 : columnFromRef(ref);
          cellType = event.attributes.t ?? "n";
          const style = event.attributes.s;
          cellStyle = style === undefined ? undefined : Number(style);
          hasFormula = false;
          value = "";
          inline = [];
          break;
        }
        case "f":
          hasFormula = true;
          break;
        case "v":
          capture = "value";
          break;
        case "t":
          if (inSheetData) capture = "inline";
          break;
        default:
          break;
      }
      if (event.selfClosing) return closeElement(name);
      return;
    }

    return closeElement(localName(event.name));
  });

  function closeElement(name: string): boolean | void {
    switch (name) {
      case "v":
      case "t":
        capture = null;
        break;
      case "c": {
        if (!inSheetData || !wantedRow || column <= 0) break;
        const rendered = renderCell({
          type: cellType,
          value,
          inline: inline.join(""),
          style: cellStyle,
          hasFormula,
          context,
        });
        if (rendered.text !== "") {
          cells.set(column, rendered.text);
          if (column > maxColumn) maxColumn = column;
          // A hidden column is not rendered, so its mark never appears; counting
          // it would announce a `*` the reader cannot find.
          if (rendered.unresolved && !hiddenColumns.has(column)) unresolvedCells++;
        }
        break;
      }
      case "row": {
        if (!inSheetData || !wantedRow) break;
        // An entirely empty row carries nothing; keeping it would pad the table
        // with rows the file only mentions because it once held formatting.
        if (cells.size > 0) rows.push({ number: rowNumber, cells });
        if (rows.length >= MAX_PARSED_ROWS) {
          nextRow = rowNumber + 1;
          return false;
        }
        break;
      }
      case "sheetData":
        inSheetData = false;
        break;
      default:
        break;
    }
  }

  return {
    rows,
    maxColumn,
    hiddenColumns,
    ...(nextRow === undefined ? {} : { nextRow }),
    ...(declaredLastRow === undefined ? {} : { declaredLastRow }),
    unresolvedCells,
  };
}

interface CellInput {
  type: string;
  value: string;
  inline: string;
  style: number | undefined;
  hasFormula: boolean;
  context: SheetParseContext;
}

/**
 * One cell as text.
 *
 * Only numeric cells go through the format chain — a string is already what it
 * shows, so an unresolvable format on one is not misleading and is not marked.
 * Keeping the mark to the cells where it means something is what keeps it worth
 * reading.
 */
function renderCell(input: CellInput): { text: string; unresolved: boolean } {
  const { type, value, inline, context } = input;

  if (type === "s") {
    const index = Number(value);
    const text = Number.isInteger(index) ? (context.sharedStrings[index] ?? "") : "";
    return { text, unresolved: false };
  }
  if (type === "inlineStr") return { text: inline, unresolved: false };
  if (type === "str") return { text: value, unresolved: false };
  if (type === "e") return { text: value, unresolved: false };
  if (type === "b") return { text: value === "1" || value === "true" ? "TRUE" : "FALSE", unresolved: false };
  if (type === "d") return { text: value.replace("T", " "), unresolved: false };

  if (value === "") {
    // A formula with no cached value has never been computed. Returning an empty
    // cell would say the sheet holds nothing there, which is a different fact.
    return { text: input.hasFormula ? UNCOMPUTED : "", unresolved: false };
  }

  const number = Number(value);
  if (!Number.isFinite(number)) return { text: value, unresolved: false };

  const format = formatForStyle(input.style, context.styles, number);
  if (format.kind === "unresolved") return { text: `${value}${RAW_MARK}`, unresolved: true };
  return { text: renderNumericValue(number, format, context.epoch1904), unresolved: false };
}

/* ── Rendering ──────────────────────────────────────────────────────────────── */

/**
 * A sheet's rows as a markdown table.
 *
 * The header row carries the workbook's own column letters and the first column
 * its row numbers. That is what keeps the table addressable — a follow-up
 * question about `D12` maps onto the output, a truncation note naming rows can
 * be checked against it, and a removed hidden column shows as a gap in the
 * letters (`A | B | E`) instead of as data silently sliding left.
 */
export function renderSheetTable(content: SheetContent): string {
  const columns: number[] = [];
  for (let column = 1; column <= content.maxColumn; column++) {
    if (!content.hiddenColumns.has(column)) columns.push(column);
  }
  if (columns.length === 0 || content.rows.length === 0) return "";

  const header = ["", ...columns.map(columnLetters)];
  const body = content.rows.map((row) => [
    String(row.number),
    ...columns.map((column) => row.cells.get(column) ?? ""),
  ]);
  return renderMarkdownTable([header, ...body], { header: true });
}

/** Hidden columns that would have appeared inside the returned width. */
function hiddenColumnsInView(content: SheetContent): number {
  let count = 0;
  for (let column = 1; column <= content.maxColumn; column++) {
    if (content.hiddenColumns.has(column)) count++;
  }
  return count;
}

/* ── Extraction ─────────────────────────────────────────────────────────────── */

function asXlsxError(error: unknown): XlsxError {
  if (error instanceof XlsxError) return error;
  if (error instanceof ZipError) {
    if (error.reason === "too-large" || error.reason === "too-many-entries") {
      return new XlsxError("too-large", error.message);
    }
    return new XlsxError("unreadable", `This file could not be read as a spreadsheet: ${error.message}`);
  }
  if (error instanceof XmlError) {
    return new XlsxError("unreadable", `This workbook's XML could not be read: ${error.message}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new XlsxError("unreadable", `This file could not be read as a spreadsheet: ${message}`);
}

const NOT_READ_NOTE =
  "> Charts, pivot tables, images, conditional formatting, cell comments and defined names are not read by this tool.";

/**
 * Extract a workbook's sheets as markdown, sheet by sheet and then row by row.
 *
 * Without `sheet`, every visible sheet is covered in workbook order. Stops at the
 * first cap it meets — rows, characters, or the deadline — and says so, naming
 * the sheet and the range to ask for next. Never returns silence: a workbook
 * with no cells says that, and names the parts this reader does not look at.
 */
export async function extractXlsx(bytes: Uint8Array, options: XlsxExtractOptions = {}): Promise<XlsxExtraction> {
  const full = options.full === true;
  const maxRows = options.maxRows ?? (full ? Number.POSITIVE_INFINITY : DEFAULT_MAX_ROWS);
  const maxChars = options.maxChars ?? (full ? ABSOLUTE_MAX_CHARS : DEFAULT_MAX_CHARS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const deadline = () => {
    if (Date.now() - started > timeoutMs) {
      throw new XlsxError("budget", `extraction exceeded the ${timeoutMs} ms budget`);
    }
  };

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.subarray(0, 4).equals(OLE_MAGIC)) {
    throw new XlsxError("encrypted", "This workbook is password-protected; its content cannot be read.");
  }

  const limits: ZipLimits = { maxEntries: MAX_ZIP_ENTRIES, maxInflatedBytes: MAX_PART_BYTES };
  const read = (name: string): Buffer | null => readZipEntry(buffer, name, limits);

  let workbook: WorkbookInfo;
  let relationships: Map<string, string>;
  let sharedStrings: string[];
  let styles: WorkbookStyles;
  try {
    if (read(CONTENT_TYPES) === null) {
      throw new XlsxError("unreadable", "This file is not an Office package (no [Content_Types].xml).");
    }
    deadline();
    const workbookXml = read(WORKBOOK_PART);
    if (workbookXml === null) {
      throw new XlsxError("unreadable", `This package has no ${WORKBOOK_PART}: it is not a spreadsheet.`);
    }
    workbook = parseWorkbook(workbookXml.toString("utf8"));
    const relsXml = read(WORKBOOK_RELS);
    relationships = relsXml === null ? new Map() : parseRelationships(relsXml.toString("utf8"));
    deadline();
    const sharedXml = read(SHARED_STRINGS);
    sharedStrings = sharedXml === null ? [] : parseSharedStrings(sharedXml.toString("utf8"));
    const stylesXml = read(STYLES_PART);
    styles = stylesXml === null
      ? { numberFormatByStyle: [], formatCodes: new Map() }
      : parseStyles(stylesXml.toString("utf8"));
  } catch (error) {
    throw asXlsxError(error);
  }

  const visible = workbook.sheets.filter((sheet) => sheet.state === "visible");
  const hidden = workbook.sheets.filter((sheet) => sheet.state !== "visible");

  let targets: SheetEntry[];
  if (options.sheet === undefined) {
    targets = visible;
  } else {
    const named = workbook.sheets.find((sheet) => sheet.name === options.sheet);
    if (named === undefined) {
      const available = visible.map((sheet) => `"${sheet.name}"`).join(", ");
      throw new XlsxError(
        "unreadable",
        `This workbook has no sheet named "${options.sheet}".` +
          (available === "" ? "" : ` Visible sheets: ${available}.`),
      );
    }
    if (named.state !== "visible") {
      throw new XlsxError(
        "unreadable",
        `Sheet "${named.name}" is hidden in this workbook and is not extracted.`,
      );
    }
    targets = [named];
  }

  const rowIntervals = options.rows === undefined ? undefined : parseRowRange(options.rows);
  const pieces: string[] = [];
  const covered: string[] = [];
  let rowsCovered = 0;
  let characters = 0;
  let truncated: { sheet: string; nextRow: number; lastRow?: number } | undefined;
  const unreached: string[] = [];

  for (const sheet of targets) {
    if (truncated !== undefined) {
      unreached.push(sheet.name);
      continue;
    }
    deadline();

    const part = relationships.get(sheet.relationshipId);
    let sheetXml: Buffer | null;
    try {
      // Inside the guard: a sheet is the part an attacker sizes, so its
      // inflation is where a ZipError comes from and it must not escape raw.
      sheetXml = part === undefined ? null : read(part);
    } catch (error) {
      throw asXlsxError(error);
    }
    if (sheetXml === null) {
      pieces.push(`## ${sheet.name}\n\n_This sheet's content is missing from the package._`);
      continue;
    }

    const partXml = sheetXml;
    let content: SheetContent;
    try {
      content = parseSheet(partXml.toString("utf8"), {
        sharedStrings,
        styles,
        epoch1904: workbook.epoch1904,
        ...(rowIntervals === undefined ? {} : { rows: rowIntervals }),
        maxRows: maxRows === Number.POSITIVE_INFINITY ? MAX_PARSED_ROWS : maxRows - rowsCovered,
        deadline,
      });
    } catch (error) {
      throw asXlsxError(error);
    }

    const table = renderSheetTable(content);
    const notes: string[] = [];
    const hiddenHere = hiddenColumnsInView(content);
    if (hiddenHere > 0) {
      notes.push(`> ${hiddenHere} hidden column${hiddenHere === 1 ? "" : "s"} not read.`);
    }
    if (content.unresolvedCells > 0) {
      notes.push(
        `> ${RAW_MARK} ${content.unresolvedCells} cell${content.unresolvedCells === 1 ? "" : "s"}: ` +
          `the number format could not be resolved, so the stored value is shown as it is.`,
      );
    }

    const block = [
      `## ${sheet.name}`,
      table === "" ? "_This sheet holds no cell content._" : table,
      ...notes,
    ].join("\n\n");

    if (characters + block.length > maxChars && pieces.length > 0) {
      // The budget ran out between sheets: this one is not started rather than
      // half-shown, which would look like a sheet that ends where it does not.
      if (full) throw tooLargeForOneAnswer();
      unreached.push(sheet.name);
      truncated = { sheet: sheet.name, nextRow: 1 };
      continue;
    }

    pieces.push(block);
    characters += block.length;
    rowsCovered += content.rows.length;
    covered.push(sheet.name);

    if (content.nextRow !== undefined) {
      if (full) throw tooLargeForOneAnswer();
      truncated = {
        sheet: sheet.name,
        nextRow: content.nextRow,
        ...(content.declaredLastRow === undefined ? {} : { lastRow: content.declaredLastRow }),
      };
    } else if (characters >= maxChars && full) {
      throw tooLargeForOneAnswer();
    }
  }

  const notes: string[] = [];
  if (hidden.length > 0) {
    const names = hidden.map((sheet) => `"${sheet.name}"`).join(", ");
    notes.push(`> ${hidden.length} hidden sheet${hidden.length === 1 ? "" : "s"} not read: ${names}.`);
  }
  if (truncated !== undefined) {
    const upper = truncated.lastRow === undefined ? "" : String(truncated.lastRow);
    notes.push(
      `> Truncated at sheet "${truncated.sheet}", row ${truncated.nextRow}. ` +
        `Call again with sheet="${truncated.sheet}" rows="${truncated.nextRow}-${upper}" for the rest.`,
    );
  }
  if (unreached.length > 0) {
    notes.push(`> Sheets not reached in this call: ${unreached.map((name) => `"${name}"`).join(", ")}.`);
  }

  if (pieces.length === 0) {
    const reason =
      visible.length === 0
        ? "_This workbook has no visible sheet._"
        : "_This workbook has no extractable cell content._";
    return {
      markdown: [reason, ...notes, NOT_READ_NOTE].join("\n\n"),
      sheets: [],
      rowsCovered: 0,
      sheetCount: visible.length,
    };
  }

  if (rowsCovered === 0) notes.push(NOT_READ_NOTE);

  return {
    markdown: [...pieces, ...notes].join("\n\n"),
    sheets: covered,
    rowsCovered,
    sheetCount: visible.length,
  };
}

function tooLargeForOneAnswer(): XlsxError {
  return new XlsxError(
    "too-large",
    `This workbook is larger than the ${ABSOLUTE_MAX_CHARS} character ceiling for a single answer. ` +
      `Extract it to a file with output_path, or ask for one sheet and a row range.`,
  );
}
