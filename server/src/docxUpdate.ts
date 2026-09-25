/**
 * `docx_update`: changing an existing Word document by sections.
 *
 * A section is named by its heading path (`Périmètre > Exclus`) — how people refer to
 * the parts of a document, and what `docx_extract` shows — and runs from its heading
 * to the next heading of the same or a higher level. The document is its own
 * template: new content wears its styles and joins its numbering.
 *
 * Two properties are what the owner of the document relies on:
 *
 * - **What is not edited is not rewritten.** The body is spliced at element
 *   boundaries; every paragraph outside the edited sections is the same bytes before
 *   and after, and every part the edits do not need is copied as it was.
 * - **Edits are tracked changes by default** (`w:ins` / `w:del`, attributed to
 *   pi-outpost), so the owner reviews them in Word as they would a colleague's. A
 *   section that already holds changes nobody accepted is refused: editing someone's
 *   pending change would leave its meaning to chance.
 */
import type { PictureSource } from "@pi-outpost/shared/docx";
import { contentWarnings, countingPictures, MAX_MARKDOWN_CHARS } from "./docxBuild.ts";
import { generateContent, WordComposer } from "./docxGraft.ts";
import { WordTemplateError, type WordPackage } from "./docxTemplate.ts";
import { bodyLayout, childElements, headingLevelOf, paragraphText, type XmlElement } from "./wordml.ts";

export const MAX_EDITS = 50;
export const REVISION_AUTHOR = "pi-outpost";

/** `pictures`, when given, is how this edit's content finds its pictures (its own folder). */
export type DocxEdit =
  | { action: "replace"; section: string; markdown: string; pictures?: PictureSource }
  | { action: "insert_after"; section: string; markdown: string; pictures?: PictureSource }
  | { action: "append"; markdown: string; pictures?: PictureSource }
  | { action: "delete"; section: string };

export interface UpdateOptions {
  trackChanges?: boolean;
  pictures?: PictureSource;
  /** The revision time; defaults to now. */
  date?: Date;
}

export interface UpdatedDocument {
  bytes: Buffer;
  /** One line per edit, in the order given. */
  report: string[];
  removed: { controls: number; fields: number; comments: number };
  warnings: string[];
}

interface Heading {
  index: number;
  level: number;
  text: string;
}

interface Section {
  heading: Heading;
  /** Index of the first element after the section. */
  end: number;
}

function normalise(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** A heading's text without the number a user may have copied from the rendered page. */
function withoutNumber(text: string): string {
  return text.replace(/^\s*(?:\d+[.)]?)+(?:\.\d+)*\.?\s+/, "");
}

function headingsOf(children: XmlElement[], pkg: WordPackage): Heading[] {
  const headings: Heading[] = [];
  children.forEach((child, index) => {
    if (child.local !== "p") return;
    const level = headingLevelOf(child.xml, pkg.styles);
    if (level === undefined) return;
    const text = paragraphText(child.xml).trim();
    if (text !== "") headings.push({ index, level, text });
  });
  return headings;
}

/** The outline, as the refusal messages show it. */
function outline(headings: Heading[]): string {
  if (headings.length === 0) return "The document has no headings.";
  return ["The document's headings:", ...headings.map((heading) => `${"  ".repeat(heading.level - 1)}- ${heading.text}`)].join("\n");
}

function sectionEnd(headings: Heading[], heading: Heading, bodyEnd: number): number {
  const next = headings.find((candidate) => candidate.index > heading.index && candidate.level <= heading.level);
  return next === undefined ? bodyEnd : next.index;
}

/** Resolve `A > B > C` to one section, or refuse with the outline. */
function findSection(path: string, headings: Heading[], bodyEnd: number): Section {
  const segments = path.split(">").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) throw new WordTemplateError(`the section path is empty.\n${outline(headings)}`);
  const matches = (heading: Heading, segment: string) =>
    normalise(heading.text) === normalise(segment) || normalise(heading.text) === normalise(withoutNumber(segment));
  const sections: Section[] = headings.map((heading) => ({ heading, end: sectionEnd(headings, heading, bodyEnd) }));
  let scope: Section[] | undefined;
  for (const [position, segment] of segments.entries()) {
    const inScope = scope === undefined ? sections : sections.filter((c) => scope!.some((s) => c.heading.index > s.heading.index && c.heading.index < s.end));
    const found = inScope.filter((candidate) => matches(candidate.heading, segment));
    if (found.length === 0) {
      const under = position === 0 ? "" : ` under "${segments.slice(0, position).join(" > ")}"`;
      throw new WordTemplateError(`no section "${segment}"${under}.\n${outline(headings)}`);
    }
    scope = found;
  }
  if (scope!.length > 1) {
    throw new WordTemplateError(`"${path}" names ${scope!.length} sections; add the heading above it, as in "Parent > ${segments[segments.length - 1]}".\n${outline(headings)}`);
  }
  return scope![0];
}

const PENDING = /<(?:\w+:)?(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange)\b/;

/* ── Tracked changes ────────────────────────────────────────────────────────── */

class Revisions {
  private next: number;
  private readonly date: string;

  constructor(documentXml: string, date: Date) {
    let highest = 0;
    for (const match of documentXml.matchAll(/\bw:id="(\d+)"/g)) highest = Math.max(highest, Number(match[1]));
    this.next = highest + 1;
    this.date = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  mark(kind: "ins" | "del"): string {
    return `w:id="${this.next++}" w:author="${REVISION_AUTHOR}" w:date="${this.date}"`;
  }

  /** A paragraph, table or content control with every run and paragraph mark marked `kind`. */
  markBlock(element: XmlElement, kind: "ins" | "del"): string {
    switch (element.local) {
      case "p":
        return this.markParagraph(element, kind);
      case "tbl":
        return this.markInner(element, kind, (child) => (child.local === "tr" ? this.markRow(child, kind) : child.xml));
      case "sdt":
        return this.markInner(element, kind, (child) =>
          child.local === "sdtContent" ? this.markInner(child, kind, (inner) => this.markBlock(inner, kind)) : child.xml,
        );
      default:
        return element.xml;
    }
  }

  /** Rebuild an element from its open tag, its children as `each` maps them, and its close tag. */
  private markInner(element: XmlElement, kind: "ins" | "del", each: (child: XmlElement) => string): string {
    const openEnd = element.xml.indexOf(">") + 1;
    if (element.xml[openEnd - 2] === "/") return element.xml;
    const closeStart = element.xml.lastIndexOf("</");
    const children = childElements(element.xml, openEnd, closeStart);
    return element.xml.slice(0, openEnd) + children.map(each).join("") + element.xml.slice(closeStart);
  }

  private markRow(row: XmlElement, kind: "ins" | "del"): string {
    const openEnd = row.xml.indexOf(">") + 1;
    const closeStart = row.xml.lastIndexOf("</");
    const children = childElements(row.xml, openEnd, closeStart);
    const mark = `<w:${kind} ${this.mark(kind)}/>`;
    const out: string[] = [];
    let hasTrPr = false;
    for (const child of children) {
      if (child.local === "trPr") {
        hasTrPr = true;
        const close = child.xml.lastIndexOf("</");
        out.push(close === -1 || child.xml.endsWith("/>") ? child.xml.replace(/\/>$/, `>${mark}</w:trPr>`) : child.xml.slice(0, close) + mark + child.xml.slice(close));
      } else if (child.local === "tc") {
        if (!hasTrPr) {
          out.push(`<w:trPr>${mark}</w:trPr>`);
          hasTrPr = true;
        }
        out.push(this.markInner(child, kind, (cellChild) => this.markBlock(cellChild, kind)));
      } else {
        out.push(child.xml);
      }
    }
    return row.xml.slice(0, openEnd) + out.join("") + row.xml.slice(closeStart);
  }

  private markParagraph(paragraph: XmlElement, kind: "ins" | "del"): string {
    const selfClosing = paragraph.xml.endsWith("/>");
    const openTag = selfClosing ? paragraph.xml.slice(0, -2) + ">" : paragraph.xml.slice(0, paragraph.xml.indexOf(">") + 1);
    const children = selfClosing ? [] : childElements(paragraph.xml, openTag.length, paragraph.xml.lastIndexOf("</"));
    const paragraphMark = `<w:${kind} ${this.mark(kind)}/>`;
    const out: string[] = [];
    let hasPPr = false;
    for (const child of children) {
      if (child.local === "pPr") {
        hasPPr = true;
        out.push(withParagraphMark(child.xml, paragraphMark));
      } else {
        out.push(this.markRunLevel(child, kind));
      }
    }
    if (!hasPPr) out.unshift(`<w:pPr><w:rPr>${paragraphMark}</w:rPr></w:pPr>`);
    return `${openTag}${out.join("")}</${paragraph.name}>`;
  }

  /** Runs and equations wrapped; containers of runs (links, simple fields, controls) entered. */
  private markRunLevel(element: XmlElement, kind: "ins" | "del"): string {
    switch (element.local) {
      case "r":
      case "oMath":
      case "oMathPara": {
        const xml = kind === "del" ? toDeletedText(element.xml) : element.xml;
        return `<w:${kind} ${this.mark(kind)}>${xml}</w:${kind}>`;
      }
      case "hyperlink":
      case "fldSimple":
      case "smartTag":
      case "customXml":
        return this.markInner(element, kind, (child) => this.markRunLevel(child, kind));
      case "sdt":
        return this.markInner(element, kind, (child) =>
          child.local === "sdtContent" ? this.markInner(child, kind, (inner) => this.markRunLevel(inner, kind)) : child.xml,
        );
      default:
        return element.xml;
    }
  }
}

/** Deleted runs carry their text in `w:delText` (and field codes in `w:delInstrText`). */
function toDeletedText(runXml: string): string {
  return runXml
    .replace(/<(\/?)(\w+:)?t(\s[^>]*)?>/g, (_, slash: string, prefix = "", attributes = "") => `<${slash}${prefix}delText${slash ? "" : attributes}>`)
    .replace(/<(\/?)(\w+:)?instrText(\s[^>]*)?>/g, (_, slash: string, prefix = "", attributes = "") => `<${slash}${prefix}delInstrText${slash ? "" : attributes}>`);
}

/** Put the paragraph-mark revision first in `pPr`'s run properties, adding them if needed. */
function withParagraphMark(pPr: string, mark: string): string {
  const rPr = /<(\w+:)?rPr\b[^>]*?(\/>|>)/.exec(pPr);
  if (rPr !== null) {
    const at = rPr.index + rPr[0].length;
    if (rPr[2] === "/>") return pPr.slice(0, rPr.index) + `<${rPr[1] ?? ""}rPr>${mark}</${rPr[1] ?? ""}rPr>` + pPr.slice(at);
    return pPr.slice(0, at) + mark + pPr.slice(at);
  }
  if (pPr.endsWith("/>")) return pPr.replace(/\/>$/, `><w:rPr>${mark}</w:rPr></w:pPr>`);
  // The schema puts rPr after the paragraph properties and before sectPr / pPrChange.
  const tail = /<(?:\w+:)?(?:sectPr|pPrChange)\b/.exec(pPr);
  const at = tail !== null ? tail.index : pPr.lastIndexOf("</");
  return pPr.slice(0, at) + `<w:rPr>${mark}</w:rPr>` + pPr.slice(at);
}

/* ── Applying edits ─────────────────────────────────────────────────────────── */

function countRemoved(xml: string): { controls: number; fields: number; comments: number } {
  return {
    controls: (xml.match(/<(?:\w+:)?sdt\b/g) ?? []).length,
    fields: (xml.match(/<(?:\w+:)?fldChar\b[^>]*fldCharType="begin"/g) ?? []).length + (xml.match(/<(?:\w+:)?fldSimple\b/g) ?? []).length,
    comments: new Set([...xml.matchAll(/<(?:\w+:)?commentReference\b[^>]*\bw:id="(\d+)"/g)].map((match) => match[1])).size,
  };
}

interface Planned {
  edit: DocxEdit;
  order: number;
  /** Elements `[from, to)` taken out, and where new content goes. */
  from: number;
  to: number;
  label: string;
}

export async function updateDocument(pkg: WordPackage, edits: DocxEdit[], options: UpdateOptions = {}): Promise<UpdatedDocument> {
  if (edits.length === 0) throw new WordTemplateError("no edits were given");
  if (edits.length > MAX_EDITS) throw new WordTemplateError(`at most ${MAX_EDITS} edits in one call (got ${edits.length})`);
  const track = options.trackChanges !== false;
  const layout = bodyLayout(pkg.documentXml);
  const children = layout.children;
  const bodyEnd = layout.sectPr !== undefined ? children.length - 1 : children.length;
  const headings = headingsOf(children, pkg);

  // Resolve every edit against the document as it is, before changing anything.
  const planned: Planned[] = edits.map((edit, order) => {
    if ("markdown" in edit) {
      if (edit.markdown.trim() === "") throw new WordTemplateError(`edit ${order + 1}: there is no content to write`);
      if (edit.markdown.length > MAX_MARKDOWN_CHARS) throw new WordTemplateError(`edit ${order + 1}: the content is longer than ${MAX_MARKDOWN_CHARS} characters`);
    }
    if (edit.action === "append") return { edit, order, from: bodyEnd, to: bodyEnd, label: "appended at the end" };
    const section = findSection(edit.section, headings, bodyEnd);
    const name = `"${section.heading.text}"`;
    switch (edit.action) {
      case "replace":
        return { edit, order, from: section.heading.index + 1, to: section.end, label: `replaced the content of ${name}` };
      case "insert_after":
        return { edit, order, from: section.end, to: section.end, label: `inserted after ${name}` };
      case "delete":
        return { edit, order, from: section.heading.index, to: section.end, label: `deleted ${name}` };
      default:
        throw new WordTemplateError(`edit ${order + 1}: unknown action`);
    }
  });
  for (const a of planned) {
    for (const b of planned) {
      if (a === b) continue;
      const overlaps = a.from < b.to && b.from < a.to;
      const insideRemoved = b.from === b.to && b.from > a.from && b.from < a.to;
      if (overlaps || insideRemoved) throw new WordTemplateError(`edits ${a.order + 1} and ${b.order + 1} touch the same part of the document; combine them into one`);
    }
    if (a.to > a.from) {
      const touched = children.slice(a.from, a.to).map((child) => child.xml).join("");
      if (PENDING.test(touched)) {
        throw new WordTemplateError(`edit ${a.order + 1}: that section holds tracked changes nobody has accepted or rejected yet; resolve them in Word first`);
      }
    }
  }

  const composer = new WordComposer(pkg);
  const revisions = new Revisions(pkg.documentXml, options.date ?? new Date());
  const warnings: string[] = [];
  const removed = { controls: 0, fields: 0, comments: 0 };
  const pieces = children.map((child) => child.xml);

  // Content first, in the order the edits were given, so numbering and pictures are
  // issued in reading order; then splice from the end so indices hold.
  const contentFor = new Map<Planned, string[]>();
  for (const plan of planned) {
    if (!("markdown" in plan.edit)) continue;
    const counting = countingPictures(plan.edit.pictures ?? options.pictures ?? {});
    const generated = await generateContent(plan.edit.markdown, counting.source);
    let content = composer.adopt(generated);
    if (track) {
      const elements = childElements(content.join(""), 0, content.join("").length);
      content = elements.map((element) => revisions.markBlock(element, "ins"));
    }
    contentFor.set(plan, content);
    warnings.push(...contentWarnings(plan.edit.markdown, counting.source, counting.missed));
  }
  for (const plan of [...planned].sort((a, b) => b.from - a.from || b.order - a.order)) {
    const taken = children.slice(plan.from, plan.to);
    const counted = countRemoved(taken.map((child) => child.xml).join(""));
    removed.controls += counted.controls;
    removed.fields += counted.fields;
    removed.comments += counted.comments;
    const kept = track ? taken.map((child) => revisions.markBlock(child, "del")) : [];
    const content = contentFor.get(plan) ?? [];
    pieces.splice(plan.from, plan.to - plan.from, ...kept, ...content);
  }

  const documentXml = pkg.documentXml.slice(0, layout.innerStart) + pieces.join("") + pkg.documentXml.slice(layout.innerEnd);
  const bytes = composer.compose(documentXml, { sweep: "changed" });
  const report = planned.map((plan) => `${plan.order + 1}. ${plan.label}${track ? " (tracked)" : ""}`);
  return { bytes, report, removed, warnings };
}
