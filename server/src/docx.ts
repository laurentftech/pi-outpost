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
import { pictureMarker, type FoundPicture, type PictureMarker } from "./extractedPictures.ts";
import { IMAGE_CONTENT_TYPES, readImageInfo } from "@pi-outpost/office/imageInfo.ts";
import { renderSpans, struckThroughNotice, BOLD, ITALIC, STRIKE, type Span } from "./markdownSpans.ts";
import { escapeCell, renderMarkdownTable } from "@pi-outpost/office/markdownTable.ts";
import { parseRelationshipList, relsPartOf } from "@pi-outpost/office/ooxml.ts";
import { scanXml, XmlError } from "@pi-outpost/office/xml.ts";
import { readZipEntry, ZipError, type ZipLimits } from "@pi-outpost/office/zip.ts";

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
  /**
   * The review reading: tracked insertions, deletions and moves, and comments,
   * marked where they sit and listed at the end with author, date and section.
   * Without it the result is the accepted text, and deleted text cannot reach it.
   */
  review?: boolean;
}

export interface DocxExtraction {
  markdown: string;
  /** Blocks actually covered, in order. */
  blocks: number[];
  /** First block a cap kept back, when one did. */
  nextBlock?: number;
  blockCount: number;
  /**
   * Every picture the body draws, in document order, whether its bytes could be
   * prepared or not. The markdown already names each one; this is what a caller
   * asking for the bytes selects from.
   */
  pictures: FoundPicture[];
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
const COMMENTS_PART = "word/comments.xml";
const COMMENTS_EXTENDED_PART = "word/commentsExtended.xml";
const CONTENT_TYPES = "[Content_Types].xml";
/** OLE compound files (encrypted OOXML) start with this, not with "PK". */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

/* ── Blocks ─────────────────────────────────────────────────────────────────── */

export type DocxBlock =
  | {
      kind: "paragraph";
      text: string;
      heading?: number;
      /** A heading's accepted text, without markers, in the review reading. */
      plain?: string;
    }
  | { kind: "table"; rows: string[][] };

/* ── Run formatting ─────────────────────────────────────────────────────────── */

/**
 * OOXML toggle semantics: the element alone means on, and an explicit false
 * value means off.
 *
 * The off case is not hypothetical. A run that inherits strikethrough from its
 * style switches it off exactly this way, so reading the element's presence
 * alone would mark text the document shows unstruck. Word writes the on case as
 * `<w:strike w:val="1"/>` rather than the bare element, so neither spelling can
 * be treated as the only one.
 */
export function toggleOn(value: string | undefined): boolean {
  if (value === undefined) return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "off";
}

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

/* ── Review layer ───────────────────────────────────────────────────────────── */

/** One comment as `word/comments.xml` holds it, joined to its thread. */
export interface DocxComment {
  id: string;
  author?: string;
  date?: string;
  text: string;
  /** The root of the thread this comment replies to, when the document records threads. */
  parentId?: string;
  /** Resolved or open; undefined when the document does not record it. */
  done?: boolean;
}

/** One thing the review reading can mark: a revision, a move, or a comment. */
export interface ReviewEntry {
  kind: "insertion" | "deletion" | "move" | "comment";
  author?: string;
  date?: string;
  /** First block it shows in; for a move, its origin. */
  block?: number;
  /** A move's destination block. */
  toBlock?: number;
  /** Whether any of it is visible. A revision of whitespace alone is neither marked nor counted. */
  visible: boolean;
  /** A whole table row inserted or deleted, rather than text. */
  row?: boolean;
}

export interface ReviewParse {
  /** Emit the review layer's markers. False is the accepted reading, which still counts what it hides. */
  show: boolean;
  /** Comments that are replies. Word repeats their root's anchor for each, so they are not marked. */
  replies: ReadonlySet<string>;
  /** Filled by the parse, keyed by provisional id: `r:…` a revision, `m:…` a move, `c:…` a comment. */
  entries: Map<string, ReviewEntry>;
}

/**
 * Markers are written as sentinels while the body is walked, and become syntax only
 * once the document's own text has been escaped. Escaping cannot happen earlier:
 * Word splits runs where it likes, so a forged `{++` can arrive one character per
 * run. The two control characters cannot come from a document — XML forbids them,
 * and the walk strips them in case a lenient scanner let one through.
 */
const sentinel = (payload: string) => `\u0001${payload}\u0002`;
export const INSERT_OPEN = sentinel("I");
export const INSERT_CLOSE = sentinel("i");
export const DELETE_OPEN = sentinel("D");
export const DELETE_CLOSE = sentinel("d");
export const ANCHOR_OPEN = sentinel("H");
export const ANCHOR_CLOSE = sentinel("h");
export const referenceSentinel = (id: string) => sentinel(`R${id}`);

/**
 * The record of a formatting change, which holds the formatting it *replaced*. The
 * walk never enters one: its `<w:rPr>` would otherwise be read as the run's own,
 * and since it comes last, the old toggles would win; its `<w:pPr>` would bring
 * back the old paragraph style.
 */
const CHANGE_RECORD = /^w:\w+(?:Pr|PrEx|Grid)Change$/;

type RevisionKind = "ins" | "del" | "moveFrom" | "moveTo";
interface OpenRevision {
  kind: RevisionKind;
  author?: string;
  date?: string;
  /** A move's range name, which links its two ends. */
  name?: string;
  /** A whole table row inserted or deleted: every cell's text is that one change. */
  row?: { id?: string };
  serial: number;
}

/** Innermost first by kind: text inserted and then deleted is deleted. */
const REVISION_PRECEDENCE: RevisionKind[] = ["del", "moveFrom", "moveTo", "ins"];

/**
 * Walk `word/document.xml` into blocks, in document order.
 *
 * Tracked deletions are skipped as the walk passes them (`<w:del>` wraps deleted
 * runs, whose text sits in `<w:delText>`), so deleted text is absent by
 * construction rather than filtered out afterwards. Only the review reading —
 * `review.show`, which a caller asks for by name — lets it through, and then
 * always inside a deletion marker. A move's origin is a deletion for this purpose.
 * A manual strikethrough is a different statement and gets different treatment:
 * the author left that text in the document, crossed out, so it is kept and marked.
 *
 * Text accumulates as spans rather than strings because the markers cannot be
 * decided run by run — see `renderSpans`.
 */
export function parseBody(
  xml: string,
  deadline?: () => void,
  pictureMarkerFor?: PictureMarker,
  review?: ReviewParse,
): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  const show = review?.show === true;

  let paragraph: Span[] = [];
  let paragraphHeading: number | undefined;
  let styleId: string | undefined;
  let outlineLevel: string | undefined;
  let paragraphDepth = 0;

  let tableDepth = 0;
  let rows: string[][] = [];
  let row: string[] = [];
  let cell: Span[] = [];
  let inCell = false;
  let rowPropertiesDepth = 0;
  /** A row whose properties say it was deleted with tracking. */
  let rowDeleted = false;
  /** The revision a row's properties record, around its cells until the row ends. */
  let rowRevision: OpenRevision | undefined;

  /** Where text goes; `count` is removed text the accepted reading leaves out but still counts. */
  let textTarget: "paragraph" | "cell" | "count" | null = null;
  let textRevision: OpenRevision | undefined;
  let events = 0;
  /** Depth inside a formatting change's record, which the walk skips whole. */
  let changeRecordDepth = 0;

  /** Revision elements around the walk, outermost first. */
  const revisions: OpenRevision[] = [];
  let revisionSerial = 0;
  let moveFromName: string | undefined;
  let moveToName: string | undefined;
  /**
   * The revision the last revised text joined. Word gives every run its own
   * `<w:ins>`, so adjacent ones by the same author at the same moment are one
   * change to a reader, and share one reference.
   */
  let group: { key: string; id: string } | undefined;
  let groupSerial = 0;

  /** Root comments whose range the walk is inside. */
  const openComments = new Set<string>();
  /** Comments anchored by a range, as opposed to a point. */
  const rangedComments = new Set<string>();

  /** The formatting of the run being walked, rebuilt at every `<w:r>`. */
  let runFormat = 0;
  /**
   * `<w:rPr>` describes a run — except inside `<w:pPr>`, where it describes the
   * paragraph *mark*, the pilcrow. Word writes one there routinely, and reading
   * it as a run's would mark a paragraph whose text carries no formatting at all.
   */
  let runPropertiesDepth = 0;
  let paragraphPropertiesDepth = 0;

  /**
   * The picture being walked, if any.
   *
   * A `<w:drawing>` is not always a picture: Word wraps a chart, a diagram and a
   * grouped shape in one too, and those have no image part to point at. So a marker
   * is written only once a blip or an image reference has actually been seen —
   * marking a chart as a picture would promise bytes that do not exist.
   */
  let drawingDepth = 0;
  let pictureRel: string | undefined;
  let pictureAlt: string | undefined;
  let pictureName: string | undefined;

  const applyToggle = (flag: number, value: string | undefined) => {
    if (runPropertiesDepth === 0) return;
    if (toggleOn(value)) runFormat |= flag;
    else runFormat &= ~flag;
  };

  const target = () => (inCell ? cell : paragraph);
  const blockNumber = () => blocks.length + 1;

  const effectiveRevision = (): OpenRevision | undefined => {
    // A deleted row takes its cells with it, whatever they say: Office writes their
    // text as ordinary runs.
    if (rowRevision?.kind === "del") return rowRevision;
    let found: OpenRevision | undefined;
    search: for (const kind of REVISION_PRECEDENCE) {
      for (let index = revisions.length - 1; index >= 0; index--) {
        if (revisions[index].kind === kind) {
          found = revisions[index];
          break search;
        }
      }
    }
    // An inserted row is one change, not one per cell.
    return found?.kind === "ins" && rowRevision !== undefined ? rowRevision : found;
  };
  const removes = (revision: OpenRevision | undefined) => revision?.kind === "del" || revision?.kind === "moveFrom";

  /** The provisional id of the reference a piece of revised text belongs to, creating its entry. */
  const referenceFor = (layer: ReviewParse, revision: OpenRevision): string => {
    let id: string;
    if (revision.row !== undefined) {
      revision.row.id ??= `r:${++groupSerial}`;
      id = revision.row.id;
      group = undefined;
    } else if (revision.kind === "moveFrom" || revision.kind === "moveTo") {
      // Both ends name the same range, which is the only thing linking them.
      id = revision.name !== undefined ? `m:${revision.name}` : `m:#${revision.serial}`;
      group = undefined;
    } else {
      const key = `${revision.kind}\u0000${revision.author ?? ""}\u0000${revision.date ?? ""}`;
      if (group === undefined || group.key !== key) group = { key, id: `r:${++groupSerial}` };
      id = group.id;
    }
    if (!layer.entries.has(id)) {
      layer.entries.set(id, {
        kind: revision.kind === "ins" ? "insertion" : revision.kind === "del" ? "deletion" : "move",
        ...(revision.author !== undefined ? { author: revision.author } : {}),
        ...(revision.date !== undefined ? { date: revision.date } : {}),
        visible: false,
        ...(revision.row !== undefined ? { row: true } : {}),
      });
    }
    return id;
  };

  /**
   * Records text against the revision it belongs to, and returns the markers it
   * takes in the review reading. Run for removed text the accepted reading leaves
   * out too, so both readings count the same revisions.
   */
  const note = (text: string, revision: OpenRevision | undefined): Span["revision"] => {
    if (review === undefined) return undefined;
    if (revision === undefined) {
      if (text !== "") group = undefined;
      return undefined;
    }
    const id = referenceFor(review, revision);
    const entry = review.entries.get(id)!;
    if (/\S/.test(text)) {
      entry.visible = true;
      if (revision.kind === "moveTo") entry.toBlock ??= blockNumber();
      else entry.block ??= blockNumber();
    }
    return removes(revision)
      ? { open: DELETE_OPEN, close: DELETE_CLOSE + referenceSentinel(id) }
      : { open: INSERT_OPEN, close: INSERT_CLOSE + referenceSentinel(id) };
  };

  /** Text or whitespace into the current container, tagged with the revision it belongs to. */
  const emit = (raw: string, revision: OpenRevision | undefined) => {
    const text = show ? raw.replace(/[\u0001\u0002]/g, "") : raw;
    const markers = note(text, revision);
    target().push(show && markers !== undefined ? { text, format: runFormat, revision: markers } : { text, format: runFormat });
  };

  const pushRaw = (text: string) => target().push({ text, format: 0, raw: true });

  /** A comment the body anchors, noted where its anchor starts. */
  const noteComment = (layer: ReviewParse, id: string) => {
    const key = `c:${id}`;
    const entry = layer.entries.get(key);
    if (entry === undefined) layer.entries.set(key, { kind: "comment", visible: true, block: blockNumber() });
  };

  /**
   * A reference that lands outside any paragraph — a range Word closed between two
   * of them — goes on the end of the block before it, which is where the range ended.
   */
  const appendToLastBlock = (text: string) => {
    const last = blocks[blocks.length - 1];
    if (last === undefined) return;
    if (last.kind === "paragraph") last.text += text;
    else {
      const lastRow = last.rows[last.rows.length - 1];
      if (lastRow !== undefined && lastRow.length > 0) lastRow[lastRow.length - 1] += text;
    }
  };

  const flushParagraph = () => {
    const text = renderSpans(paragraph).replace(/\s+/g, " ").trim();
    const heading = paragraphHeading;
    // A heading names the section a reference falls under, so it is kept as the
    // accepted text too, without markers.
    const plain = show && heading !== undefined ? acceptedText(paragraph) : undefined;
    paragraph = [];
    paragraphHeading = undefined;
    styleId = undefined;
    outlineLevel = undefined;
    if (text === "") return;
    blocks.push({
      kind: "paragraph",
      text,
      ...(heading !== undefined ? { heading } : {}),
      ...(plain !== undefined ? { plain } : {}),
    });
  };

  scanXml(xml, (event) => {
    if (++events % 2000 === 0) deadline?.();
    if (blocks.length > MAX_PARSED_BLOCKS) return false;

    if (changeRecordDepth > 0) {
      if (event.kind === "open" && !event.selfClosing && CHANGE_RECORD.test(event.name)) changeRecordDepth++;
      else if (event.kind === "close" && CHANGE_RECORD.test(event.name)) changeRecordDepth--;
      return;
    }

    if (event.kind === "open") {
      if (CHANGE_RECORD.test(event.name)) {
        if (!event.selfClosing) changeRecordDepth = 1;
        return;
      }
      switch (event.name) {
        case "w:ins":
        case "w:del":
        case "w:moveFrom":
        case "w:moveTo": {
          // Self-closing, these mark a paragraph mark or a table row rather than
          // wrapping text. Only a deleted row changes what is read.
          if (event.selfClosing) {
            if (rowPropertiesDepth > 0 && (event.name === "w:del" || event.name === "w:ins")) {
              if (event.name === "w:del") rowDeleted = true;
              const author = event.attributes["w:author"];
              const date = event.attributes["w:date"];
              rowRevision = {
                kind: event.name === "w:del" ? "del" : "ins",
                ...(author !== undefined ? { author } : {}),
                ...(date !== undefined ? { date } : {}),
                row: {},
                serial: ++revisionSerial,
              };
              revisions.push(rowRevision);
            }
            return;
          }
          const kind = event.name.slice(2) as RevisionKind;
          const author = event.attributes["w:author"];
          const date = event.attributes["w:date"];
          const name = kind === "moveFrom" ? moveFromName : kind === "moveTo" ? moveToName : undefined;
          revisions.push({
            kind,
            ...(author !== undefined ? { author } : {}),
            ...(date !== undefined ? { date } : {}),
            ...(name !== undefined ? { name } : {}),
            serial: ++revisionSerial,
          });
          break;
        }
        case "w:moveFromRangeStart":
          moveFromName = event.attributes["w:name"];
          break;
        case "w:moveToRangeStart":
          moveToName = event.attributes["w:name"];
          break;
        case "w:moveFromRangeEnd":
          moveFromName = undefined;
          break;
        case "w:moveToRangeEnd":
          moveToName = undefined;
          break;
        case "w:commentRangeStart": {
          const id = event.attributes["w:id"];
          if (review === undefined || id === undefined || review.replies.has(id)) break;
          rangedComments.add(id);
          noteComment(review, id);
          // Outside a paragraph, the next paragraph's opening reopens the anchor.
          if (show && openComments.size === 0 && paragraphDepth > 0) pushRaw(ANCHOR_OPEN);
          openComments.add(id);
          break;
        }
        case "w:commentRangeEnd": {
          const id = event.attributes["w:id"];
          if (id === undefined || !openComments.delete(id)) break;
          if (!show) break;
          if (paragraphDepth > 0) {
            if (openComments.size === 0) pushRaw(ANCHOR_CLOSE);
            pushRaw(referenceSentinel(`c:${id}`));
          } else {
            appendToLastBlock(referenceSentinel(`c:${id}`));
          }
          break;
        }
        case "w:commentReference": {
          // Word writes one for a ranged comment too; only a comment with no range
          // is anchored here, at a point.
          const id = event.attributes["w:id"];
          if (review === undefined || id === undefined || review.replies.has(id) || rangedComments.has(id)) break;
          noteComment(review, id);
          if (show) pushRaw(referenceSentinel(`c:${id}`));
          break;
        }
        case "w:tbl":
          if (tableDepth === 0) {
            flushParagraph();
            rows = [];
          }
          tableDepth++;
          break;
        case "w:tr":
          if (tableDepth === 1) {
            row = [];
            rowDeleted = false;
          }
          break;
        case "w:trPr":
          if (tableDepth === 1) rowPropertiesDepth++;
          break;
        case "w:tc":
          if (tableDepth === 1) {
            cell = [];
            inCell = true;
          }
          break;
        case "w:p":
          paragraphDepth++;
          if (!inCell) {
            paragraph = [];
            paragraphHeading = undefined;
          }
          // A comment range that runs on from the paragraph before
          if (show && openComments.size > 0) pushRaw(ANCHOR_OPEN);
          break;
        case "w:pStyle":
          styleId = event.attributes["w:val"];
          break;
        case "w:outlineLvl":
          outlineLevel = event.attributes["w:val"];
          break;
        case "w:pPr":
          paragraphPropertiesDepth++;
          break;
        case "w:rPr":
          if (paragraphPropertiesDepth === 0) runPropertiesDepth++;
          break;
        case "w:r":
          runFormat = 0;
          break;
        case "w:strike":
        case "w:dstrike":
          applyToggle(STRIKE, event.attributes["w:val"]);
          break;
        case "w:b":
          applyToggle(BOLD, event.attributes["w:val"]);
          break;
        case "w:i":
          applyToggle(ITALIC, event.attributes["w:val"]);
          break;
        case "w:t":
        case "w:delText": {
          // Removed text is reachable only in the review reading; in the accepted
          // one, `w:delText` never is, wherever it sits.
          const revision = effectiveRevision();
          if (removes(revision) ? show : event.name === "w:t") {
            textTarget = inCell ? "cell" : "paragraph";
            textRevision = revision;
          } else if (removes(revision)) {
            textTarget = "count";
            textRevision = revision;
          }
          break;
        }
        case "w:drawing":
        case "w:pict":
          drawingDepth++;
          pictureRel = undefined;
          pictureAlt = undefined;
          pictureName = undefined;
          break;
        case "wp:docPr":
          // Where Word keeps a picture's alternative text and its name.
          if (drawingDepth > 0) {
            pictureAlt = event.attributes["descr"];
            pictureName = event.attributes["name"];
          }
          break;
        case "a:blip":
          if (drawingDepth > 0) pictureRel ??= event.attributes["r:embed"];
          break;
        case "v:imagedata":
          // The pre-2007 shape a `<w:pict>` still uses, and what Word writes for a
          // pasted metafile to this day.
          if (drawingDepth > 0) pictureRel ??= event.attributes["r:id"];
          break;
        case "w:tab":
        case "w:br":
        case "w:cr": {
          const revision = effectiveRevision();
          if (!removes(revision) || show) emit(" ", revision);
          break;
        }
        default:
          break;
      }
      // A self-closing tag never reaches the close branch, so close it here
      if (event.selfClosing) closeElement(event.name);
      return;
    }

    if (event.kind === "text") {
      if (textTarget === "count") note(event.text, textRevision);
      else if (textTarget !== null) emit(event.text, textRevision);
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
      case "w:delText":
        textTarget = null;
        textRevision = undefined;
        break;
      case "w:ins":
      case "w:del":
      case "w:moveFrom":
      case "w:moveTo": {
        const kind = name.slice(2) as RevisionKind;
        for (let index = revisions.length - 1; index >= 0; index--) {
          if (revisions[index].kind === kind) {
            revisions.splice(index, 1);
            break;
          }
        }
        break;
      }
      case "w:pPr":
        if (paragraphPropertiesDepth > 0) paragraphPropertiesDepth--;
        break;
      case "w:rPr":
        // Guarded the same way the open is, so the pair a `<w:pPr>` contains is
        // ignored at both ends rather than decrementing a run's count.
        if (paragraphPropertiesDepth === 0 && runPropertiesDepth > 0) runPropertiesDepth--;
        break;
      case "w:trPr":
        if (rowPropertiesDepth > 0) rowPropertiesDepth--;
        break;
      case "w:drawing":
      case "w:pict":
        if (drawingDepth > 0) drawingDepth--;
        // The marker goes where the drawing was, spaced so it cannot glue itself to
        // the words on either side of an inline picture.
        if (drawingDepth === 0 && pictureRel !== undefined && pictureMarkerFor !== undefined) {
          const marker = pictureMarkerFor({
            relationshipId: pictureRel,
            ...(pictureAlt !== undefined ? { alt: pictureAlt } : {}),
            ...(pictureName !== undefined ? { name: pictureName } : {}),
          });
          if (marker !== "") (inCell ? cell : paragraph).push({ text: ` ${marker} `, format: 0 });
        }
        if (drawingDepth === 0) {
          pictureRel = undefined;
          pictureAlt = undefined;
          pictureName = undefined;
        }
        break;
      case "w:r":
        runFormat = 0;
        break;
      case "w:p":
        if (paragraphDepth > 0) paragraphDepth--;
        // Every block's markers balance: a comment range running on is closed here
        // and reopened by the next paragraph.
        if (show && openComments.size > 0) pushRaw(ANCHOR_CLOSE);
        group = undefined;
        if (inCell) cell.push({ text: " ", format: 0 });
        else {
          paragraphHeading = headingLevel(styleId, outlineLevel);
          flushParagraph();
        }
        break;
      case "w:tc":
        if (tableDepth === 1) {
          row.push(renderSpans(cell).replace(/\s+/g, " ").trim());
          inCell = false;
        }
        break;
      case "w:tr":
        // A row deleted with tracking is gone from the accepted text; a row of
        // empty cells in its place would be a row the document never had.
        if (tableDepth === 1 && !(rowDeleted && !show)) rows.push(row);
        if (tableDepth === 1 && rowRevision !== undefined) {
          revisions.splice(revisions.indexOf(rowRevision), 1);
          rowRevision = undefined;
        }
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

/** A paragraph's text as accepted: no removed text, no markers. */
function acceptedText(spans: Span[]): string {
  return spans
    .filter((span) => span.raw !== true && span.revision?.open !== DELETE_OPEN)
    .map((span) => span.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Comments ───────────────────────────────────────────────────────────────── */

/**
 * The comments a document holds, joined into threads.
 *
 * `word/comments.xml` holds every comment, replies included, flat. Threads and the
 * resolved state live in `word/commentsExtended.xml`, keyed by the `w14:paraId` of
 * each comment's last paragraph: an entry naming a parent makes the comment a reply,
 * and `w15:done` says the thread was resolved. Without that part — older Word, other
 * writers — every comment is a root and its state is unknown, not open.
 */
export function parseComments(commentsXml: string | undefined, extendedXml: string | undefined): Map<string, DocxComment> {
  const comments = new Map<string, DocxComment>();
  if (commentsXml === undefined) return comments;

  const lastParagraphOf = new Map<string, string>();
  let current: { id: string; author?: string; date?: string; paragraphs: string[] } | undefined;
  let text = "";
  let inText = false;
  let deletionDepth = 0;
  scanXml(commentsXml, (event) => {
    if (event.kind === "text") {
      if (inText) text += event.text;
      return;
    }
    const opening = event.kind === "open";
    switch (event.name) {
      case "w:comment":
        if (opening && !event.selfClosing) {
          const { "w:id": id, "w:author": author, "w:date": date } = event.attributes;
          current = id === undefined ? undefined : { id, ...(author ? { author } : {}), ...(date ? { date } : {}), paragraphs: [] };
        } else if (current !== undefined) {
          const { paragraphs, ...rest } = current;
          comments.set(current.id, { ...rest, text: paragraphs.filter((piece) => piece !== "").join(" / ") });
          current = undefined;
        }
        break;
      case "w:p":
        if (opening) {
          text = "";
          const paraId = event.attributes["w14:paraId"];
          if (current !== undefined && paraId !== undefined) lastParagraphOf.set(current.id, paraId);
        }
        if (!opening || event.selfClosing) current?.paragraphs.push(text.replace(/\s+/g, " ").trim());
        break;
      case "w:del":
        if (opening && !event.selfClosing) deletionDepth++;
        else if (!opening && deletionDepth > 0) deletionDepth--;
        break;
      case "w:t":
        inText = opening && !event.selfClosing && deletionDepth === 0;
        break;
      case "w:tab":
      case "w:br":
        if (opening) text += " ";
        break;
      default:
        break;
    }
  });

  if (extendedXml === undefined) return comments;
  const extended = new Map<string, { parent?: string; done: boolean }>();
  scanXml(extendedXml, (event) => {
    if (event.kind !== "open" || event.name !== "w15:commentEx") return;
    const paraId = event.attributes["w15:paraId"];
    if (paraId === undefined) return;
    const parent = event.attributes["w15:paraIdParent"];
    extended.set(paraId, { ...(parent !== undefined ? { parent } : {}), done: event.attributes["w15:done"] === "1" });
  });
  const byParagraph = new Map([...lastParagraphOf].map(([id, paraId]) => [paraId, id]));
  for (const comment of comments.values()) {
    const paraId = lastParagraphOf.get(comment.id);
    const record = paraId === undefined ? undefined : extended.get(paraId);
    if (record === undefined) continue;
    comment.done = record.done;
    if (record.parent !== undefined) {
      const parentId = byParagraph.get(record.parent);
      if (parentId !== undefined && parentId !== comment.id) comment.parentId = parentId;
    }
  }
  // Word flattens threads to their root, but a reply to a reply is legal markup.
  for (const comment of comments.values()) {
    const seen = new Set([comment.id]);
    let parent = comment.parentId === undefined ? undefined : comments.get(comment.parentId);
    while (parent?.parentId !== undefined && !seen.has(parent.parentId)) {
      seen.add(parent.id);
      parent = comments.get(parent.parentId);
    }
    if (parent !== undefined) comment.parentId = parent.id;
  }
  return comments;
}

/* ── Review rendering ───────────────────────────────────────────────────────── */

const SENTINELS = /\u0001([^\u0002]*)\u0002/g;
const SENTINEL_SYNTAX: Record<string, string> = { I: "{++", i: "++}", D: "{--", d: "--}", H: "{==", h: "==}" };

/**
 * Final reference labels, assigned in document order over every block — not over
 * the blocks returned — so a reference keeps its number whichever range or cap
 * produced it. Only references that reached the text are numbered: a revision of
 * whitespace alone leaves no marker, and gets no number.
 */
export function numberReferences(blocks: DocxBlock[]): Map<string, string> {
  const labels = new Map<string, string>();
  const counters: Record<string, number> = { r: 0, m: 0, c: 0 };
  const visit = (text: string) => {
    for (const match of text.matchAll(SENTINELS)) {
      const payload = match[1];
      if (!payload.startsWith("R")) continue;
      const id = payload.slice(1);
      if (labels.has(id)) continue;
      const prefix = id[0];
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      labels.set(id, `${prefix}${counters[prefix]}`);
    }
  };
  for (const block of blocks) {
    if (block.kind === "paragraph") visit(block.text);
    else for (const row of block.rows) for (const value of row) visit(value);
  }
  return labels;
}

/**
 * The document's own text, unable to pass for a marker or a reference. Run on the
 * rendered block while the markers are still sentinels, so only the document's
 * characters can match.
 */
export function escapeForgedMarkers(text: string): string {
  return text
    .replace(/\{(?=\+\+|--|==)/g, "\\{")
    .replace(/(\+\+|--|==)\}/g, "$1\\}")
    .replace(/\[(?=[rmc]\d+\])/g, "\\[");
}

/** Sentinels to syntax, and the provisional ids each reference in the text carries, in order. */
function resolveSentinels(text: string, labels: Map<string, string>): { text: string; references: string[] } {
  const references: string[] = [];
  // An anchor with nothing visible inside it says nothing a reference alone does not.
  const tidied = text.replace(/\u0001H\u0002(\s*)\u0001h\u0002/g, "$1");
  const resolved = escapeForgedMarkers(tidied).replace(SENTINELS, (_, payload: string) => {
    if (!payload.startsWith("R")) return SENTINEL_SYNTAX[payload] ?? "";
    const id = payload.slice(1);
    references.push(id);
    return `[${labels.get(id) ?? "?"}]`;
  });
  return { text: resolved, references };
}

/** The headings each block falls under, outermost first; a heading falls under itself. */
function headingPaths(blocks: DocxBlock[]): string[][] {
  const stack: Array<{ level: number; text: string }> = [];
  return blocks.map((block) => {
    if (block.kind === "paragraph" && block.heading !== undefined) {
      while (stack.length > 0 && stack[stack.length - 1].level >= block.heading) stack.pop();
      stack.push({ level: block.heading, text: block.plain ?? block.text });
    }
    return stack.map((entry) => entry.text);
  });
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A Word timestamp as the day it names; anything else as written. */
function dayOf(date: string | undefined): string | undefined {
  if (date === undefined) return undefined;
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : date;
}

/** Author and date, saying so when the markup records neither rather than inventing either. */
function attribution(author: string | undefined, date: string | undefined): string {
  return `${author ?? "author not recorded"}, ${dayOf(date) ?? "date not recorded"}`;
}

/** Text from the document placed in the list: stripped of sentinels, unable to forge a marker. */
const listed = (text: string) => escapeForgedMarkers(text.replace(/[\u0001\u0002]/g, ""));

function reviewList(
  references: string[],
  layer: ReviewParse,
  labels: Map<string, string>,
  paths: string[][],
  comments: Map<string, DocxComment>,
): string {
  const where = (block: number | undefined) => {
    const path = block === undefined ? undefined : paths[block - 1];
    return path === undefined || path.length === 0 ? "before the first heading" : path.map(listed).join(" > ");
  };
  const lines = ["---", "Review layer, in document order:"];
  for (const id of references) {
    const entry = layer.entries.get(id);
    const label = labels.get(id);
    if (entry === undefined || label === undefined) continue;
    if (entry.kind === "comment") {
      const comment = comments.get(id.slice(2));
      const state = comment?.done === true ? "resolved" : comment?.done === false ? "open" : "resolved state not recorded";
      lines.push(
        `- [${label}] comment, ${state} — ${attribution(comment?.author, comment?.date)} — ${where(entry.block)}: « ${listed(comment?.text ?? "")} »`,
      );
      for (const reply of comments.values()) {
        if (reply.parentId !== id.slice(2)) continue;
        lines.push(`    - reply — ${attribution(reply.author, reply.date)}: « ${listed(reply.text)} »`);
      }
    } else if (entry.kind === "move") {
      lines.push(`- [${label}] moved — ${attribution(entry.author, entry.date)} — from ${where(entry.block)} to ${where(entry.toBlock)}`);
    } else {
      const kind = entry.row === true ? `table row ${entry.kind}` : entry.kind;
      lines.push(`- [${label}] ${kind} — ${attribution(entry.author, entry.date)} — ${where(entry.block ?? entry.toBlock)}`);
    }
  }
  return lines.join("\n");
}

/** Counts of what the review layer holds, over the whole document. */
function reviewCounts(layer: ReviewParse): { revisions: number; comments: number } {
  let revisions = 0;
  let comments = 0;
  for (const entry of layer.entries.values()) {
    if (!entry.visible) continue;
    if (entry.kind === "comment") comments++;
    else revisions++;
  }
  return { revisions, comments };
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

  const show = options.review === true;
  const comments = readComments(buffer, limits, show);
  const layer: ReviewParse = {
    show,
    replies: new Set([...comments.values()].filter((comment) => comment.parentId !== undefined).map((comment) => comment.id)),
    entries: new Map(),
  };

  const pictures: FoundPicture[] = [];
  let blocks: DocxBlock[];
  try {
    const marker = pictureMarkerIn(buffer, limits, pictures, deadline);
    blocks = parseBody(documentXml.toString("utf8"), deadline, marker, layer);
  } catch (error) {
    throw asDocxError(error);
  }

  const blockCount = blocks.length;
  if (blockCount === 0) {
    return {
      markdown:
        "_This document has no extractable body content._\n\n" +
        (show
          ? "> Headers, footers, footnotes and text boxes are not read by this tool."
          : "> Headers, footers, footnotes, comments and text boxes are not read by this tool."),
      blocks: [],
      blockCount: 0,
      pictures,
    };
  }

  const requested = options.blocks ? parseBlockRange(options.blocks, blockCount) : rangeTo(blockCount);
  const labels = show ? numberReferences(blocks) : new Map<string, string>();
  const shown: string[] = [];
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
    let rendered = renderBlock(blocks[number - 1], mode);
    if (show) {
      const resolved = resolveSentinels(rendered, labels);
      rendered = resolved.text;
      for (const id of resolved.references) if (!shown.includes(id)) shown.push(id);
    }
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

  // The notices lead; everything else trails. See `struckThroughNotice` for why
  // those are not trailing notes. The review list closes the content, ahead of the
  // notes, because it belongs to the blocks shown.
  const leads = [struckThroughNotice(pieces.join("\n\n")), reviewNotice(layer, shown, labels)].filter((line) => line !== "");
  const list = show && shown.length > 0 ? [reviewList(shown, layer, labels, headingPaths(blocks), comments)] : [];
  const markdown = [...leads, ...pieces, ...list, ...notes].join("\n\n");
  // The list is not cut by the per-call cap — it is bounded by the blocks it
  // belongs to — but a whole document past the ceiling is still refused.
  if (full && markdown.length > ABSOLUTE_MAX_CHARS) {
    throw new DocxError(
      "too-large",
      `This document is larger than the ${ABSOLUTE_MAX_CHARS} character ceiling for a single answer. ` +
        `Extract it to a file with output_path, or ask for a block range.`,
    );
  }

  return {
    markdown,
    blocks: covered,
    ...(nextBlock === undefined ? {} : { nextBlock }),
    blockCount,
    pictures,
  };
}

/**
 * The comments the package holds. In the accepted reading they are only counted,
 * so a damaged comments part costs the hint, never the document; the review
 * reading exists to show them, and says so when it cannot.
 */
function readComments(buffer: Buffer, limits: ZipLimits, review: boolean): Map<string, DocxComment> {
  try {
    return parseComments(
      readZipEntry(buffer, COMMENTS_PART, limits)?.toString("utf8"),
      readZipEntry(buffer, COMMENTS_EXTENDED_PART, limits)?.toString("utf8"),
    );
  } catch (error) {
    if (!review) return new Map();
    const reason = asDocxError(error);
    throw new DocxError(reason.reason, `This document's comments could not be read: ${reason.message}`);
  }
}

/**
 * The line that opens a reading whose document has a review layer.
 *
 * In the review reading it says what the markers mean, before the text, for the
 * same reason the strikethrough notice leads. In the accepted reading it is the
 * only place the caller can learn that the text it is reading hides changes —
 * said in the answer, where the cost is in front of it, rather than in a tool
 * description read once.
 */
function reviewNotice(layer: ReviewParse, shown: string[], labels: Map<string, string>): string {
  const total = reviewCounts(layer);
  if (!layer.show) {
    if (total.revisions === 0 && total.comments === 0) return "";
    return (
      `> This document holds ${plural(total.revisions, "tracked change")} and ${plural(total.comments, "comment")} that this reading does not show: ` +
      `it is the text with every change accepted, deletions left out and insertions read as ordinary text. ` +
      `Pass review: true to see each change and comment where it sits, with its author, date and section.`
    );
  }
  if (total.revisions === 0 && total.comments === 0) {
    return "> Review reading: this document holds no tracked change or comment; the text below is as written.";
  }
  const revisions = shown.filter((id) => !id.startsWith("c:") && labels.has(id)).length;
  const commentCount = shown.filter((id) => id.startsWith("c:") && labels.has(id)).length;
  if (revisions === 0 && commentCount === 0) {
    return "> Review reading: the blocks shown hold no tracked change or comment; other blocks of this document do.";
  }
  return (
    `> Review reading: ${plural(revisions, "tracked change")} and ${plural(commentCount, "comment")} are marked below. ` +
    "`{++text++}` was inserted and `{--text--}` deleted; a moved passage is deleted at its origin and inserted at its destination, both marked with the same `[mN]`; " +
    "`{==text==}` is the text a comment is about. Each `[rN]`, `[mN]` and `[cN]` is listed at the end with its author, date and section. " +
    "Formatting changes are not shown."
  );
}

/**
 * A marker for each picture the body draws, reading the part behind it.
 *
 * The relationships are read once, on the first picture, so a document with none
 * pays nothing. Each part is inflated because the marker names pixel dimensions and
 * only the bytes state those — the drawing's own `wp:extent` is the size Word prints
 * it at, which is a different number and not what a reader of the extraction wants.
 *
 * Nothing here throws: a package that cannot produce a picture still gets a marker
 * saying so, because the one outcome worse than an unreadable picture is a document
 * that never mentions it.
 */
function pictureMarkerIn(
  buffer: Buffer,
  limits: ZipLimits,
  pictures: FoundPicture[],
  deadline: () => void,
): PictureMarker {
  let targets: Map<string, string> | undefined;
  return (reference) => {
    deadline();
    if (targets === undefined) {
      const rels = readZipEntryQuietly(buffer, relsPartOf(DOCUMENT_PART), limits);
      targets = new Map(
        parseRelationshipList(rels?.toString("utf8"), DOCUMENT_PART)
          .filter((rel) => !rel.external)
          .map((rel) => [rel.id, rel.target]),
      );
    }
    const number = pictures.length + 1;
    const alt = reference.alt !== undefined && reference.alt.trim() !== "" ? { alt: reference.alt } : {};
    const target = targets.get(reference.relationshipId);
    const found = ((): FoundPicture => {
      if (target === undefined) {
        return { number, format: "picture", ...alt, unavailable: "the package does not hold the part it points at" };
      }
      const extension = (target.split(".").pop() ?? "").toUpperCase();
      const bytes = readZipEntryQuietly(buffer, target, limits);
      if (bytes === null) {
        return { number, format: extension || "picture", ...alt, unavailable: "its part is missing from the package" };
      }
      try {
        const info = readImageInfo(bytes, target);
        // An SVG's bytes are not something the model can be shown; a later pass
        // rasterises it. The marker is the same either way — it names SVG and the
        // dimensions the file declares — so nothing here depends on that pass.
        return {
          number,
          format: info.kind.toUpperCase(),
          width: info.width,
          height: info.height,
          ...alt,
          bytes,
          mimeType: IMAGE_CONTENT_TYPES[info.kind],
        };
      } catch {
        // A format this reader does not know. Name it from the part's own extension
        // rather than calling it damaged: EMF and WMF are ordinary in Word documents.
        return { number, format: extension || "picture", ...alt, unavailable: `${extension || "this format"} cannot be shown as an image` };
      }
    })();
    pictures.push(found);
    return pictureMarker(found);
  };
}

/** A part read for a picture: absent or unreadable is an answer, not a failure. */
function readZipEntryQuietly(buffer: Buffer, part: string, limits: ZipLimits): Buffer | null {
  try {
    return readZipEntry(buffer, part, limits);
  } catch {
    return null;
  }
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
