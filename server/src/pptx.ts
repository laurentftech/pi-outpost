/**
 * PowerPoint (.pptx) slide text and declared tables, as markdown.
 *
 * The difference from `docx.ts` is where reading order comes from. A Word
 * document is one part read top to bottom; a presentation is a set of parts whose
 * order is stated in `ppt/presentation.xml` and resolved through the relationship
 * table. Slide file names are an authoring convention — `slide1.xml` is often not
 * the first slide once a deck has been reordered — so the numbering the presenter
 * sees comes from `p:sldIdLst`, never from the archive.
 *
 * SECURITY: a .pptx is attacker-controlled *compressed* data. Entry count,
 * decompressed size, wall-clock time and output size are all capped, the XML
 * scanner refuses a DOCTYPE outright, and a relationship target that normalises
 * outside `ppt/` is refused rather than read — a slide is never fetched by a name
 * the package did not legitimately state.
 */
import { escapeCell, renderMarkdownTable } from "./markdownTable.ts";
import { parseRelationships } from "./ooxml.ts";
import { scanXml, XmlError } from "./xml.ts";
import { readZipEntry, ZipError, type ZipLimits } from "./zip.ts";

export type PptxErrorReason =
  /** Not a PowerPoint presentation, or damaged past reading. */
  | "unreadable"
  /** The package is encrypted; its parts are not readable as XML. */
  | "encrypted"
  /** A part expanded past the decompression budget, or the archive is oversized. */
  | "too-large"
  /** Parsing exceeded the time budget. */
  | "budget";

export class PptxError extends Error {
  constructor(
    readonly reason: PptxErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "PptxError";
  }
}

export interface PptxExtractOptions {
  /** `"12"`, `"5-40"`, `"5-40,80"`. Omitted means "from the first slide until a cap stops us". */
  slides?: string;
  /**
   * Return the whole presentation rather than one call's worth. The per-call caps
   * lift; ABSOLUTE_MAX_CHARS and the deadline still apply, and a deck past that
   * ceiling is refused rather than quietly cut.
   */
  full?: boolean;
  maxSlides?: number;
  maxChars?: number;
  timeoutMs?: number;
}

export interface PptxExtraction {
  markdown: string;
  /** Slides actually covered, in presentation order. */
  slides: number[];
  /** First slide a cap kept back, when one did. */
  nextSlide?: number;
  slideCount: number;
}

/** Caps chosen so one call cannot spend a session's context on a long deck. */
export const DEFAULT_MAX_SLIDES = 60;
export const DEFAULT_MAX_CHARS = 40_000;
/**
 * The ceiling `full` cannot lift — roughly 100 000 tokens. Past it the call is
 * refused and pointed at a file, because a truncated "whole presentation" is the
 * failure this option exists to remove.
 */
export const ABSOLUTE_MAX_CHARS = 400_000;
export const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * A package with more entries than this is refused before anything is inflated.
 * Higher than the Word ceiling: every picture, layout and master in a deck is its
 * own entry, so an ordinary presentation carries far more parts than a document.
 */
export const MAX_ZIP_ENTRIES = 2048;
/** Ceiling on one inflated part — a slide of a very dense deck stays well under. */
export const MAX_PART_BYTES = 64 * 1024 * 1024;
/** A deck declaring more slides than this is pathological; stop rather than fill memory. */
export const MAX_PARSED_SLIDES = 10_000;
/** Shapes and tables kept from one slide. A slide past this is generated, not authored. */
export const MAX_SLIDE_BLOCKS = 2_000;

const CONTENT_TYPES = "[Content_Types].xml";
const PRESENTATION_PART = "ppt/presentation.xml";
const PRESENTATION_RELS = "ppt/_rels/presentation.xml.rels";
/** The only prefix a slide part may live under, once its target is normalised. */
const PACKAGE_PREFIX = "ppt/";
/** OLE compound files (encrypted OOXML) start with this, not with "PK". */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

/* ── Presentation order ─────────────────────────────────────────────────────── */

export interface SlideEntry {
  /** Presentation-wide slide id, as declared. Kept for diagnosis, not for order. */
  id: string;
  relationshipId: string;
}

/**
 * The relationship id of a `<p:sldId>`, whatever prefix the writer bound the
 * relationships namespace to. Unlike a sheet in a workbook, a slide also carries a
 * bare `id` attribute — its presentation-wide slide id — so falling back to `id`
 * would hand the relationship table a number it cannot resolve.
 */
function relationshipIdOf(attributes: Record<string, string>): string {
  if (attributes["r:id"] !== undefined) return attributes["r:id"];
  for (const [name, value] of Object.entries(attributes)) {
    if (name.endsWith(":id")) return value;
  }
  return "";
}

/**
 * The slide list, in the order the presentation declares.
 *
 * `p:sldIdLst` is the presenter's running order. Slides reachable only as layouts
 * or masters are not in it, which is exactly right: they are templates, not
 * content anyone presents.
 */
export function parsePresentation(xml: string): SlideEntry[] {
  const slides: SlideEntry[] = [];
  let inList = false;
  scanXml(xml, (event) => {
    if (slides.length > MAX_PARSED_SLIDES) return false;
    const name = event.kind === "text" ? "" : event.name;
    const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
    if (event.kind === "open") {
      if (local === "sldIdLst") {
        inList = true;
        if (event.selfClosing) inList = false;
        return;
      }
      if (inList && local === "sldId") {
        slides.push({ id: event.attributes.id ?? "", relationshipId: relationshipIdOf(event.attributes) });
      }
      return;
    }
    if (event.kind === "close" && local === "sldIdLst") inList = false;
  });
  return slides;
}

/* ── Slide content ──────────────────────────────────────────────────────────── */

export type SlideBlock =
  | { kind: "text"; text: string }
  | { kind: "table"; rows: string[][] };

/** What a slide holds that this reader does not turn into text. */
export interface SlideVisuals {
  images: number;
  charts: number;
  diagrams: number;
  media: number;
}

export interface SlideContent {
  blocks: SlideBlock[];
  /** The declared title placeholder's text, when the slide declares one. */
  title?: string;
  visuals: SlideVisuals;
}

function isVisualEmpty(visuals: SlideVisuals): boolean {
  return visuals.images === 0 && visuals.charts === 0 && visuals.diagrams === 0 && visuals.media === 0;
}

/** "2 images and 1 chart" — the unread content, named rather than implied. */
export function describeVisuals(visuals: SlideVisuals): string {
  const parts: string[] = [];
  const add = (count: number, singular: string, plural: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  };
  add(visuals.images, "image", "images");
  add(visuals.charts, "chart", "charts");
  add(visuals.diagrams, "diagram", "diagrams");
  add(visuals.media, "media object", "media objects");
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Walk one slide into blocks, in the order its shape tree declares them.
 *
 * Text and tables are interleaved on a slide far more often than in a document —
 * a bullet list beside a table is the ordinary case — so emitting in scan order is
 * what preserves the layout's reading order. Text is taken only from inside an
 * `a:txBody`, which is what keeps shape names, placeholder metadata and relationship
 * ids out of the output.
 */
export function parseSlide(xml: string, deadline?: () => void): SlideContent {
  const blocks: SlideBlock[] = [];
  const visuals: SlideVisuals = { images: 0, charts: 0, diagrams: 0, media: 0 };
  let title: string | undefined;

  // A shape's own paragraphs, flushed when the shape's text body closes.
  let shapeParagraphs: string[] = [];
  let paragraph: string[] = [];
  let textBodyDepth = 0;
  let capturing = false;

  let tableDepth = 0;
  let rows: string[][] = [];
  let row: string[] = [];
  let cellParagraphs: string[] = [];

  /** Placeholder type of the shape being read, from `p:ph type="…"`. */
  let placeholder: string | undefined;
  let shapeDepth = 0;
  let events = 0;

  const flushParagraph = () => {
    const text = paragraph.join("").replace(/\s+/g, " ").trim();
    paragraph = [];
    if (text === "") return;
    if (tableDepth > 0) cellParagraphs.push(text);
    else shapeParagraphs.push(text);
  };

  const flushShape = () => {
    flushParagraph();
    const text = shapeParagraphs.join("\n").trim();
    shapeParagraphs = [];
    if (text === "") return;
    // The title is named for the slide heading and kept in the body as well:
    // identifying it must never be a reason for content to go missing.
    if (title === undefined && (placeholder === "title" || placeholder === "ctrTitle")) {
      title = text.replace(/\s+/g, " ");
    }
    blocks.push({ kind: "text", text });
  };

  scanXml(xml, (event) => {
    if (++events % 2000 === 0) deadline?.();
    if (blocks.length > MAX_SLIDE_BLOCKS) return false;

    if (event.kind === "text") {
      if (capturing) paragraph.push(event.text);
      return;
    }

    const name = event.name;
    const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;

    if (event.kind === "open") {
      switch (local) {
        case "sp":
          shapeDepth++;
          if (shapeDepth === 1) placeholder = undefined;
          break;
        case "ph":
          if (shapeDepth > 0 && placeholder === undefined) placeholder = event.attributes.type ?? "body";
          break;
        case "pic":
          visuals.images++;
          break;
        case "graphicData":
          // The uri names the kind of graphic: a chart and a SmartArt diagram are
          // both graphic frames, and neither yields text this reader can read.
          if (/chart/i.test(event.attributes.uri ?? "")) visuals.charts++;
          else if (/diagram/i.test(event.attributes.uri ?? "")) visuals.diagrams++;
          break;
        case "videoFile":
        case "audioFile":
          visuals.media++;
          break;
        case "tbl":
          if (tableDepth === 0) {
            // A table interrupts the shape being read only if one is open; the
            // graphic frame that holds it is not a shape, so nothing is lost.
            rows = [];
          }
          tableDepth++;
          break;
        case "tr":
          if (tableDepth === 1) row = [];
          break;
        case "tc":
          if (tableDepth === 1) cellParagraphs = [];
          break;
        case "txBody":
          textBodyDepth++;
          break;
        case "p":
          paragraph = [];
          break;
        case "t":
          if (textBodyDepth > 0) capturing = true;
          break;
        case "br":
          if (capturing || textBodyDepth > 0) paragraph.push(" ");
          break;
        default:
          break;
      }
      // A self-closing tag never reaches the close branch, so close it here:
      // `<a:tc/>` is a real empty cell and dropping it shifts every column after it.
      if (event.selfClosing) closeElement(local);
      return;
    }

    closeElement(local);
  });

  function closeElement(local: string): void {
    switch (local) {
      case "t":
        capturing = false;
        break;
      case "p":
        flushParagraph();
        break;
      case "tc":
        if (tableDepth === 1) {
          row.push(cellParagraphs.join(" ").replace(/\s+/g, " ").trim());
          cellParagraphs = [];
        }
        break;
      case "tr":
        if (tableDepth === 1) rows.push(row);
        break;
      case "tbl":
        tableDepth--;
        if (tableDepth === 0 && rows.length > 0) blocks.push({ kind: "table", rows });
        break;
      case "txBody":
        if (textBodyDepth > 0) textBodyDepth--;
        // A cell's text body belongs to its cell, not to a shape of its own.
        if (textBodyDepth === 0 && tableDepth === 0) flushShape();
        break;
      case "sp":
        if (shapeDepth > 0) shapeDepth--;
        if (shapeDepth === 0) placeholder = undefined;
        break;
      default:
        break;
    }
  }

  flushParagraph();
  return { blocks, ...(title === undefined ? {} : { title }), visuals };
}

/* ── Rendering ──────────────────────────────────────────────────────────────── */

/** One slide as markdown, heading included. */
export function renderSlide(number: number, content: SlideContent): string {
  const heading = content.title === undefined ? `## Slide ${number}` : `## Slide ${number} — ${content.title}`;
  const pieces: string[] = [];
  for (const block of content.blocks) {
    if (block.kind === "text") {
      pieces.push(block.text);
      continue;
    }
    // A first row that fills every column reads as a header; anything else does not.
    const header = block.rows.length > 1 && block.rows[0].every((value) => escapeCell(value) !== "");
    pieces.push(renderMarkdownTable(block.rows, { header }));
  }

  const unread = describeVisuals(content.visuals);
  if (pieces.length === 0) {
    pieces.push(
      unread === ""
        ? "_This slide has no extractable text._"
        : `_This slide has no extractable text._\n\n> Not read: ${unread}.`,
    );
  } else if (unread !== "") {
    pieces.push(`> Not read: ${unread}.`);
  }
  return [heading, ...pieces].join("\n\n");
}

/* ── Slide ranges ───────────────────────────────────────────────────────────── */

/**
 * Parse `"3"`, `"5-40"`, `"5-40,80"` into ascending unique slide numbers, clamped
 * to the presentation. A range naming nothing inside it is an error rather than an
 * empty result: silence would read as "this presentation is empty".
 */
export function parseSlideRange(spec: string, slideCount: number): number[] {
  const wanted = new Set<number>();
  for (const part of spec.split(",")) {
    const piece = part.trim();
    if (piece === "") continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(piece);
    if (match === null) {
      throw new PptxError("unreadable", `"${piece}" is not a slide or a slide range (use "3", "5-40" or "5-40,80")`);
    }
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) throw new PptxError("unreadable", `"${piece}" is not a usable slide range`);
    for (let slide = from; slide <= Math.min(to, slideCount); slide++) wanted.add(slide);
  }
  if (wanted.size === 0) {
    throw new PptxError("unreadable", `no slide of this ${slideCount}-slide presentation falls in "${spec}"`);
  }
  return [...wanted].sort((a, b) => a - b);
}

/* ── Extraction ─────────────────────────────────────────────────────────────── */

function asPptxError(error: unknown): PptxError {
  if (error instanceof PptxError) return error;
  if (error instanceof ZipError) {
    if (error.reason === "too-large" || error.reason === "too-many-entries") {
      return new PptxError("too-large", error.message);
    }
    return new PptxError("unreadable", `This file could not be read as a PowerPoint presentation: ${error.message}`);
  }
  if (error instanceof XmlError) {
    return new PptxError("unreadable", `This presentation's XML could not be read: ${error.message}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new PptxError("unreadable", `This file could not be read as a PowerPoint presentation: ${message}`);
}

/**
 * Extract a presentation's slides as markdown, in presentation order.
 *
 * Stops at the first cap it meets — slides, characters, or the deadline — and says
 * so, naming the next slide to ask for. Never returns silence: a deck whose slides
 * hold no text says that, and names the visual content this reader does not read.
 */
export async function extractPptx(bytes: Uint8Array, options: PptxExtractOptions = {}): Promise<PptxExtraction> {
  const full = options.full === true;
  const maxSlides = options.maxSlides ?? (full ? Number.POSITIVE_INFINITY : DEFAULT_MAX_SLIDES);
  const maxChars = options.maxChars ?? (full ? ABSOLUTE_MAX_CHARS : DEFAULT_MAX_CHARS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const deadline = () => {
    if (Date.now() - started > timeoutMs) {
      throw new PptxError("budget", `extraction exceeded the ${timeoutMs} ms budget`);
    }
  };

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.subarray(0, 4).equals(OLE_MAGIC)) {
    throw new PptxError("encrypted", "This presentation is password-protected; its content cannot be read.");
  }

  const limits: ZipLimits = { maxEntries: MAX_ZIP_ENTRIES, maxInflatedBytes: MAX_PART_BYTES };
  const read = (name: string): Buffer | null => readZipEntry(buffer, name, limits);

  let entries: SlideEntry[];
  let relationships: Map<string, string>;
  try {
    if (read(CONTENT_TYPES) === null) {
      throw new PptxError("unreadable", "This file is not an Office package (no [Content_Types].xml).");
    }
    deadline();
    const presentationXml = read(PRESENTATION_PART);
    if (presentationXml === null) {
      throw new PptxError("unreadable", `This package has no ${PRESENTATION_PART}: it is not a PowerPoint presentation.`);
    }
    entries = parsePresentation(presentationXml.toString("utf8"));
    const relsXml = read(PRESENTATION_RELS);
    relationships = relsXml === null ? new Map() : parseRelationships(relsXml.toString("utf8"), "ppt");
  } catch (error) {
    throw asPptxError(error);
  }

  const slideCount = entries.length;
  if (slideCount === 0) {
    return {
      markdown:
        "_This presentation declares no slides._\n\n" +
        "> Slide layouts and masters are templates, not slides, and are not read by this tool.",
      slides: [],
      slideCount: 0,
    };
  }

  const requested = options.slides ? parseSlideRange(options.slides, slideCount) : rangeTo(slideCount);
  const pieces: string[] = [];
  const covered: number[] = [];
  let characters = 0;
  let nextSlide: number | undefined;

  for (const [index, number] of requested.entries()) {
    if (index >= maxSlides || characters >= maxChars) {
      // Under `full` the caller asked for everything, so stopping here would hand
      // back a presentation that looks complete and is not.
      if (full) {
        throw new PptxError(
          "too-large",
          `This presentation is larger than the ${ABSOLUTE_MAX_CHARS} character ceiling for a single answer. ` +
            `Extract it to a file with output_path, or ask for a slide range.`,
        );
      }
      nextSlide = number;
      break;
    }
    deadline();

    const entry = entries[number - 1];
    const part = relationships.get(entry.relationshipId);
    if (part !== undefined && !part.startsWith(PACKAGE_PREFIX)) {
      // SECURITY: a target that normalises out of `ppt/` is not a slide this
      // package may name. Refused before the entry is read, not sanitised after.
      throw new PptxError(
        "unreadable",
        `Slide ${number} points at "${part}", which is outside the presentation's own parts.`,
      );
    }

    let slideXml: Buffer | null;
    try {
      // Inside the guard: a slide is the part an attacker sizes, so its inflation
      // is where a ZipError comes from and it must not escape raw.
      slideXml = part === undefined ? null : read(part);
    } catch (error) {
      throw asPptxError(error);
    }
    if (slideXml === null) {
      covered.push(number);
      const missing = `## Slide ${number}\n\n_This slide's content is missing from the package._`;
      characters += missing.length;
      pieces.push(missing);
      continue;
    }

    let content: SlideContent;
    try {
      content = parseSlide(slideXml.toString("utf8"), deadline);
    } catch (error) {
      throw asPptxError(error);
    }

    const rendered = renderSlide(number, content);
    covered.push(number);
    characters += rendered.length;
    pieces.push(rendered);
  }

  const notes: string[] = [];
  if (nextSlide !== undefined) {
    notes.push(
      `> Truncated: slides ${describeSlides(covered)} of ${slideCount} shown. ` +
        `Call again with slides="${nextSlide}-${slideCount}" for the rest.`,
    );
  }

  return {
    markdown: [...pieces, ...notes].join("\n\n"),
    slides: covered,
    ...(nextSlide === undefined ? {} : { nextSlide }),
    slideCount,
  };
}

function rangeTo(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** "1-40" for a run, "1, 3, 7" otherwise — a list of slides should read like one. */
function describeSlides(slides: number[]): string {
  if (slides.length === 0) return "none";
  const contiguous = slides.every((slide, i) => i === 0 || slide === slides[i - 1] + 1);
  if (contiguous && slides.length > 1) return `${slides[0]}-${slides[slides.length - 1]}`;
  return slides.join(", ");
}

/**
 * Every slide's paragraphs, in presentation order: what each slide is meant to show.
 *
 * The rendering check compares this with the text an office application actually
 * drew on each page — a paragraph present here and absent there ran off the slide.
 * Tables are included cell by cell, since a cell can overflow as well as a text box.
 */
export function readSlideParagraphs(bytes: Uint8Array): string[][] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.subarray(0, 4).equals(OLE_MAGIC)) {
    throw new PptxError("encrypted", "This presentation is password-protected; its content cannot be read.");
  }
  const limits: ZipLimits = { maxEntries: MAX_ZIP_ENTRIES, maxInflatedBytes: MAX_PART_BYTES };
  try {
    const presentationXml = readZipEntry(buffer, PRESENTATION_PART, limits);
    if (presentationXml === null) {
      throw new PptxError("unreadable", `This package has no ${PRESENTATION_PART}: it is not a PowerPoint presentation.`);
    }
    const relsXml = readZipEntry(buffer, PRESENTATION_RELS, limits);
    const relationships = relsXml === null ? new Map<string, string>() : parseRelationships(relsXml.toString("utf8"), "ppt");
    return parsePresentation(presentationXml.toString("utf8")).map((entry) => {
      const part = relationships.get(entry.relationshipId);
      // SECURITY: the same confinement as extraction — only parts under `ppt/`.
      if (part === undefined || !part.startsWith(PACKAGE_PREFIX)) return [];
      const slideXml = readZipEntry(buffer, part, limits);
      if (slideXml === null) return [];
      return parseSlide(slideXml.toString("utf8")).blocks.flatMap((block) =>
        block.kind === "text" ? block.text.split("\n") : block.rows.flat().flatMap((cell) => cell.split("\n")),
      );
    });
  } catch (error) {
    throw asPptxError(error);
  }
}
