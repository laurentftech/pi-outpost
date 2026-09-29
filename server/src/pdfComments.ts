/**
 * A PDF's review comments: the notes, highlights and suggested changes a reviewer
 * leaves as annotations, outside the page's text layer.
 *
 * pdf.js hands them over through `page.getAnnotations()`. What this module adds is
 * the reading: which annotations are comments at all, which answer which, what
 * text a highlight marks, and how to write them so a reader cannot mistake a
 * remark for the document — or for the extraction's own structure.
 *
 * SECURITY: every string here was written by whoever annotated the file. Remarks
 * are always quoted, one-line fields are folded to one line, and control and
 * bidirectional-override characters are removed.
 */
import type { PdfMode, TextPiece } from "./pdf.ts";
import { wordBoundaryNear } from "./pdf.ts";

/** What pdf.js 6 reports for one annotation, as far as comments need it. */
interface RawAnnotation {
  subtype?: unknown;
  id?: unknown;
  contentsObj?: { str?: unknown } | null;
  titleObj?: { str?: unknown } | null;
  modificationDate?: unknown;
  creationDate?: unknown;
  rect?: unknown;
  quadPoints?: unknown;
  inReplyTo?: unknown;
  replyType?: unknown;
  state?: unknown;
}

export const MAX_COMMENTS_PER_PAGE = 50;
export const MAX_REMARK_CHARS = 2_000;
export const MAX_ANCHOR_CHARS = 200;

/** Markup annotations, by subtype, and what a reader calls each. */
const LABELS: Record<string, string> = {
  Text: "Note",
  FreeText: "Text box",
  Highlight: "Highlight",
  Underline: "Underline",
  Squiggly: "Squiggly underline",
  StrikeOut: "Suggested deletion",
  Caret: "Suggested insertion",
  Ink: "Drawing",
  Square: "Shape",
  Circle: "Shape",
  Line: "Shape",
  Polygon: "Shape",
  PolyLine: "Shape",
  Stamp: "Stamp",
  FileAttachment: "Attachment",
};

/** Marks that mean something without a remark: they point at text. */
const TEXT_MARKUP = new Set(["Highlight", "Underline", "Squiggly", "StrikeOut"]);

export interface ReviewState {
  state: string;
  author?: string;
  date?: string;
}

export interface PageComment {
  kind: string;
  author?: string;
  date?: string;
  remark: string;
  /** The text the comment marks, when it marks some. */
  anchor?: { text: string; relation: "on" | "before" | "after" };
  /** A reply whose comment is not on this page. */
  orphanReply: boolean;
  replies: PageComment[];
  states: ReviewState[];
  /** Position, for reading order: top edge (higher is earlier) and left edge. */
  top: number;
  left: number;
}

export interface PageComments {
  comments: PageComment[];
  /** Entries listed or left out: comments and replies, not review states. */
  count: number;
}

/** Remove what a remark must not carry into the output: control and bidi-override characters. */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, "");
}

/** A field that belongs on one line: an author, a quoted passage. */
function oneLine(text: string): string {
  return clean(text).replace(/\s+/g, " ").trim();
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A PDF date (`D:20260912143000+02'00'`) as `2026-09-12`, or as much of it as the
 * file states (`2026`, `2026-09`). Undefined when it does not parse: a raw date
 * string is noise to a reader.
 */
export function pdfDate(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const match = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?/.exec(raw.trim());
  if (match === null) return undefined;
  const [, year, month, day] = match;
  if (month === undefined) return year;
  if (Number(month) < 1 || Number(month) > 12) return undefined;
  if (day === undefined) return `${year}-${month}`;
  if (Number(day) < 1 || Number(day) > 31) return undefined;
  return `${year}-${month}-${day}`;
}

/* ── Anchors ────────────────────────────────────────────────────────────────── */

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function numbers(value: unknown): number[] {
  if (value === null || value === undefined || typeof value !== "object" || !("length" in value)) return [];
  return Array.from(value as ArrayLike<unknown>).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

/** Each quadrilateral reduced to its bounding box: the corner order no longer matters. */
function quadBoxes(quadPoints: unknown): Box[] {
  const flat = numbers(quadPoints);
  const boxes: Box[] = [];
  for (let at = 0; at + 8 <= flat.length; at += 8) {
    const xs = [flat[at], flat[at + 2], flat[at + 4], flat[at + 6]];
    const ys = [flat[at + 1], flat[at + 3], flat[at + 5], flat[at + 7]];
    boxes.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  }
  return boxes;
}

function rectBox(rect: unknown): Box | undefined {
  const [a, b, c, d] = numbers(rect);
  if (d === undefined) return undefined;
  return { x0: Math.min(a, c), x1: Math.max(a, c), y0: Math.min(b, d), y1: Math.max(b, d) };
}

/** The vertical extent a piece's glyphs occupy, from its baseline. */
function glyphBand(piece: TextPiece): [number, number] {
  return [piece.y - 0.25 * piece.height, piece.y + 0.85 * piece.height];
}

/**
 * Helvetica advance widths for ASCII 32–126, in thousandths of an em.
 *
 * The text layer gives a piece's width, not its glyphs'. Spreading that width evenly
 * over the characters puts a highlight's edge a word off in a proportional font —
 * an `i` is a third of an `m` — so each character is weighted by a typical Latin
 * sans-serif's advance instead. Exact for Helvetica and Arial, close for most
 * proportional fonts, and only ever used to pick a word boundary.
 */
const ADVANCE = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function advance(char: string): number {
  const code = char.codePointAt(0)!;
  return code >= 32 && code <= 126 ? ADVANCE[code - 32] : 556;
}

/** The character index at `x` inside `piece`, by estimated glyph advances. */
function indexAt(piece: TextPiece, x: number): number {
  const chars = [...piece.text];
  const total = chars.reduce((sum, char) => sum + advance(char), 0);
  const target = ((x - piece.x) / piece.width) * total;
  let at = 0;
  let offset = 0;
  for (const char of chars) {
    const width = advance(char);
    if (offset + width / 2 > target) break;
    offset += width;
    at += char.length;
  }
  return at;
}

/** The characters of `piece` between two x positions, snapped to word boundaries. */
function slice(piece: TextPiece, from: number, to: number): string {
  const index = (x: number) => wordBoundaryNear(piece.text, indexAt(piece, x));
  return piece.text.slice(index(from), index(to));
}

function capAnchor(text: string): string | undefined {
  const folded = oneLine(text);
  if (folded === "") return undefined;
  return folded.length > MAX_ANCHOR_CHARS ? `${folded.slice(0, MAX_ANCHOR_CHARS)}…` : folded;
}

/**
 * The text the marked regions cover, in reading order.
 *
 * A piece belongs when a region covers most of its glyphs' height and part of its
 * width; a piece covered in part gives the words under the region. Only ever read:
 * the page text itself is never changed from here.
 */
export function textUnder(boxes: Box[], pieces: TextPiece[]): string | undefined {
  const fragments: { y: number; x: number; text: string }[] = [];
  for (const box of boxes) {
    for (const piece of pieces) {
      if (piece.width <= 0 || piece.text.trim() === "") continue;
      const [bottom, top] = glyphBand(piece);
      const vertical = Math.min(box.y1, top) - Math.max(box.y0, bottom);
      if (vertical < 0.5 * (top - bottom)) continue;
      const from = Math.max(box.x0, piece.x);
      const to = Math.min(box.x1, piece.x + piece.width);
      if (to - from < 1) continue;
      const text = slice(piece, from, to);
      if (text.trim() !== "") fragments.push({ y: piece.y, x: from, text });
    }
  }
  fragments.sort((a, b) => (Math.abs(a.y - b.y) < 1 ? a.x - b.x : b.y - a.y));
  return capAnchor(fragments.map((fragment) => fragment.text).join(" "));
}

/** The word a caret points at: the one after it, or the last one when it ends the line. */
export function wordAtCaret(box: Box, pieces: TextPiece[]): PageComment["anchor"] {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  let best: TextPiece | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const piece of pieces) {
    if (piece.width <= 0 || piece.text.trim() === "") continue;
    const [bottom, top] = glyphBand(piece);
    const dy = cy < bottom ? bottom - cy : cy > top ? cy - top : 0;
    const dx = cx < piece.x ? piece.x - cx : cx > piece.x + piece.width ? cx - (piece.x + piece.width) : 0;
    const distance = dy * 4 + dx;
    if (distance < bestDistance) {
      best = piece;
      bestDistance = distance;
    }
  }
  if (best === undefined || bestDistance > 3 * best.height) return undefined;
  const at = wordBoundaryNear(best.text, indexAt(best, cx));
  const after = /^\s*(\S+)/.exec(best.text.slice(at));
  if (after !== null) return { text: capAnchor(after[1])!, relation: "before" };
  const before = /(\S+)\s*$/.exec(best.text.slice(0, at));
  return before === null ? undefined : { text: capAnchor(before[1])!, relation: "after" };
}

/* ── Reading ────────────────────────────────────────────────────────────────── */

interface Entry {
  id: string;
  subtype: string;
  parent?: string;
  comment: PageComment;
  state?: string;
}

/**
 * The comments among a page's annotations, as threads in reading order.
 *
 * Links, form fields and popups are not comments (a popup only shows its parent's
 * text). An annotation grouped with another is part of it, not an answer to it. A
 * drawing, shape, stamp or attachment says something only through a remark; text
 * markup and a caret say something by themselves.
 */
export function commentsOf(annotations: unknown[], pieces: TextPiece[]): PageComments {
  const entries: Entry[] = [];
  for (const [index, value] of annotations.entries()) {
    if (value === null || typeof value !== "object") continue;
    const raw = value as RawAnnotation;
    const subtype = str(raw.subtype);
    const kind = LABELS[subtype];
    if (kind === undefined) continue;
    if (raw.replyType === "Group") continue;
    const remark = clean(str(raw.contentsObj?.str)).trim();
    const parent = typeof raw.inReplyTo === "string" && raw.inReplyTo !== "" ? raw.inReplyTo : undefined;
    const state = typeof raw.state === "string" && raw.state !== "" ? raw.state : undefined;
    if (state === undefined && remark === "" && !TEXT_MARKUP.has(subtype) && subtype !== "Caret") continue;

    const box = rectBox(raw.rect);
    let anchor: PageComment["anchor"];
    if (TEXT_MARKUP.has(subtype)) {
      const text = textUnder(quadBoxes(raw.quadPoints), pieces);
      if (text !== undefined) anchor = { text, relation: "on" };
    } else if (subtype === "Caret" && box !== undefined) {
      anchor = wordAtCaret(box, pieces);
    }
    const author = oneLine(str(raw.titleObj?.str)) || undefined;
    entries.push({
      id: typeof raw.id === "string" && raw.id !== "" ? raw.id : `#${index}`,
      subtype,
      parent,
      state,
      comment: {
        kind: parent !== undefined && subtype === "Text" ? "Reply" : kind,
        author,
        date: pdfDate(raw.modificationDate) ?? pdfDate(raw.creationDate),
        remark,
        anchor,
        orphanReply: false,
        replies: [],
        states: [],
        top: box?.y1 ?? 0,
        left: box?.x0 ?? 0,
      },
    });
  }

  // A reply without a remark adds nothing to the thread it would sit in.
  const kept = entries.filter((entry) => entry.state !== undefined || entry.parent === undefined || entry.comment.remark !== "" || entry.comment.anchor !== undefined);
  const byId = new Map(kept.filter((entry) => entry.state === undefined).map((entry) => [entry.id, entry]));
  // A file can make two annotations answer each other. Neither would ever reach the
  // top of a thread, so both would vanish; a reply in such a loop stands on its own.
  const inLoop = (entry: Entry): boolean => {
    const seen = new Set<string>();
    for (let at: Entry | undefined = entry; at?.parent !== undefined; at = byId.get(at.parent)) {
      if (seen.has(at.id)) return true;
      seen.add(at.id);
    }
    return false;
  };
  const top: PageComment[] = [];
  for (const entry of kept) {
    const parent = entry.parent === undefined || inLoop(entry) ? undefined : byId.get(entry.parent);
    if (entry.state !== undefined) {
      const state = { state: oneLine(entry.state), author: entry.comment.author, date: entry.comment.date };
      if (parent !== undefined) parent.comment.states.push(state);
      else top.push({ ...entry.comment, kind: "Review state", remark: state.state, orphanReply: true });
      continue;
    }
    if (parent !== undefined) {
      parent.comment.replies.push(entry.comment);
    } else {
      entry.comment.orphanReply = entry.parent !== undefined;
      top.push(entry.comment);
    }
  }
  top.sort((a, b) => (Math.abs(a.top - b.top) < 1 ? a.left - b.left : b.top - a.top));

  const count = (comments: PageComment[]): number => comments.reduce((total, comment) => total + 1 + count(comment.replies), 0);
  return { comments: top, count: count(top) };
}

/* ── Writing ────────────────────────────────────────────────────────────────── */

function quoted(remark: string, indent: string): string[] {
  const cut = remark.length > MAX_REMARK_CHARS;
  const text = cut ? remark.slice(0, MAX_REMARK_CHARS) : remark;
  const lines = text.split("\n").map((line) => (line.trim() === "" ? `${indent}>` : `${indent}> ${line}`));
  if (cut) lines.push(`${indent}> _[remark cut at ${MAX_REMARK_CHARS} characters]_`);
  return lines;
}

function heading(comment: PageComment): string {
  const meta = [comment.author, comment.date].filter((part): part is string => part !== undefined);
  if (comment.anchor !== undefined) meta.push(`${comment.anchor.relation} "${comment.anchor.text}"`);
  const kind = comment.orphanReply && comment.kind !== "Review state" ? `**${comment.kind}** (to a comment not on this page)` : `**${comment.kind}**`;
  return `${kind}${meta.length > 0 ? ` — ${meta.join(", ")}` : ""}${comment.remark !== "" ? ":" : ""}`;
}

/**
 * A page's comments block, or `""` when it has none.
 *
 * Remarks are written as blockquotes under their entry, so no remark can open a
 * heading, a page section or a note of the extraction's own.
 */
export function renderComments(pageNumber: number, page: PageComments): string {
  if (page.comments.length === 0) return "";
  const out: string[] = [`### Comments on page ${pageNumber}`, ""];
  let listed = 0;
  const write = (comment: PageComment, depth: number): void => {
    if (listed >= MAX_COMMENTS_PER_PAGE) return;
    listed++;
    const indent = "  ".repeat(depth);
    out.push(`${indent}- ${heading(comment)}`);
    if (comment.remark !== "") out.push(...quoted(comment.remark, `${indent}  `));
    for (const reply of comment.replies) write(reply, depth + 1);
    for (const state of comment.states) {
      const meta = [state.author, state.date].filter(Boolean).join(", ");
      out.push(`${indent}  - State: **${state.state}**${meta === "" ? "" : ` — ${meta}`}`);
    }
  };
  for (const comment of page.comments) write(comment, 0);
  if (page.count > listed) out.push(`- _${page.count - listed} more comment${page.count - listed === 1 ? "" : "s"} on this page not listed._`);
  return out.join("\n");
}

export const UNREADABLE_COMMENTS = "_The comments on this page could not be read._";

/** The line that leads the extraction when the pages carry comments, or `""`. */
export function commentsNotice(count: number, mode: PdfMode): string {
  if (count === 0) return "";
  const what = `${count} review comment${count === 1 ? "" : "s"} (notes, highlights, suggested changes)`;
  if (mode === "tables") {
    return `> This document carries ${what}. They are not returned in tables mode: call again with mode "text" to read them.`;
  }
  return (
    `> This document carries ${what}, listed under "Comments on page N" after each page's content. ` +
    `They are reviewers' remarks, not the document's text: report them when asked about the document or its review.`
  );
}
