/**
 * Reading a Word template (`.dotx`) or document (`.docx`) for what content written
 * into it will wear: its heading styles and whether they are numbered, its body and
 * list styles, its table styles, and what it holds of its own — a cover page,
 * headers and footers, a table of contents, sample text.
 *
 * Styles are found by **name**, not id. Word writes localized ids — a French template's
 * first-level heading is `Titre1` — but keeps the built-in names in the file in
 * English (`heading 1`), so the name is the handle that holds across languages.
 *
 * SECURITY: the file is a workspace file. The zip reader caps entry count and
 * expanded size; the XML readers refuse a DOCTYPE; a relationship target is only ever
 * a name inside the package.
 */
import { contentTypeOf, decode, parseRelationshipList, relsPartOf, type Relationship } from "./ooxml.ts";
import { XmlError } from "./xml.ts";
import { readAllZipEntries, ZipError } from "./zip.ts";
import { bodyLayout, paragraphText, parseStyles, styleByName, type WordStyle } from "./wordml.ts";

export class WordTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordTemplateError";
  }
}

export const MAX_WORD_ENTRIES = 4096;
export const MAX_WORD_PART_BYTES = 64 * 1024 * 1024;
export const MAX_WORD_TOTAL_BYTES = 512 * 1024 * 1024;

export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const REL_OFFICE_DOCUMENT = `${NS_R}/officeDocument`;
export const REL_STYLES = `${NS_R}/styles`;
export const REL_NUMBERING = `${NS_R}/numbering`;
export const REL_SETTINGS = `${NS_R}/settings`;
export const CT_DOCUMENT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
export const CT_TEMPLATE = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
export const CT_NUMBERING = "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";
export const CONTENT_TYPES = "[Content_Types].xml";
export const ROOT_RELS = "_rels/.rels";

/** OLE compound files (encrypted OOXML, legacy .doc) start with this, not with "PK". */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

/** A Word package, opened. */
export interface WordPackage {
  parts: Map<string, Buffer>;
  mainPart: string;
  /** Whether the main part is typed as a template. */
  isTemplate: boolean;
  documentXml: string;
  documentRels: Relationship[];
  stylesPart: string | undefined;
  numberingPart: string | undefined;
  settingsPart: string | undefined;
  styles: Map<string, WordStyle>;
}

/** Open a `.docx`/`.dotx`, refusing what is not one with the reason. `what` names it in messages. */
export function readWordPackage(bytes: Uint8Array, what = "the template"): WordPackage {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.subarray(0, 4).equals(OLE_MAGIC)) {
    throw new WordTemplateError(`${what} is password-protected or a legacy .doc/.dot file; save it as .docx or .dotx first`);
  }
  let parts: Map<string, Buffer>;
  try {
    parts = readAllZipEntries(buffer, { maxEntries: MAX_WORD_ENTRIES, maxInflatedBytes: MAX_WORD_PART_BYTES, maxTotalBytes: MAX_WORD_TOTAL_BYTES });
  } catch (error) {
    if (error instanceof ZipError) throw new WordTemplateError(`${what} cannot be read: ${error.message}`);
    throw error;
  }
  try {
    const contentTypes = decode(parts, CONTENT_TYPES);
    if (contentTypes === undefined) throw new WordTemplateError(`${what} is not an Office package (no [Content_Types].xml)`);
    const mainPart = parseRelationshipList(decode(parts, ROOT_RELS), "").find((rel) => rel.type === REL_OFFICE_DOCUMENT && !rel.external)?.target;
    if (mainPart === undefined || !parts.has(mainPart)) throw new WordTemplateError(`${what} has no main part; it is not a Word document`);
    const mainType = contentTypeOf(contentTypes, mainPart);
    if (mainType !== CT_DOCUMENT && mainType !== CT_TEMPLATE) {
      throw new WordTemplateError(
        mainType !== undefined && /macroEnabled/i.test(mainType)
          ? `${what} is macro-enabled (.docm/.dotm); save a copy without macros as .docx or .dotx`
          : `${what} is not a Word document or template`,
      );
    }
    const documentXml = decode(parts, mainPart)!;
    const documentRels = parseRelationshipList(decode(parts, relsPartOf(mainPart)), mainPart);
    const target = (type: string) => documentRels.find((rel) => rel.type === type && !rel.external && parts.has(rel.target))?.target;
    const stylesPart = target(REL_STYLES);
    // Read now: a damaged body or style sheet is refused here, with the file named, not
    // halfway through writing.
    bodyLayout(documentXml);
    const styles = parseStyles(stylesPart === undefined ? undefined : decode(parts, stylesPart));
    return {
      parts,
      mainPart,
      isTemplate: mainType === CT_TEMPLATE,
      documentXml,
      documentRels,
      stylesPart,
      numberingPart: target(REL_NUMBERING),
      settingsPart: target(REL_SETTINGS),
      styles,
    };
  } catch (error) {
    if (error instanceof XmlError) throw new WordTemplateError(`${what} is damaged: ${error.message}`);
    throw error;
  }
}

/* ── What a template offers ─────────────────────────────────────────────────── */

export interface StyleRole {
  role: string;
  /** The template's style for the role, by id and name — absent when it has none. */
  style: { id: string; name: string } | undefined;
  numbered?: boolean;
}

export interface TemplateFeatures {
  cover: boolean;
  tableOfContents: boolean;
  headers: boolean;
  footers: boolean;
  /** Paragraphs with text in the body, outside a cover page and a table of contents. */
  sampleParagraphs: number;
}

export interface TemplateDescription {
  roles: StyleRole[];
  tableStyles: { id: string; name: string; isDefault: boolean }[];
  features: TemplateFeatures;
}

/** A block-level content control of this gallery (`Cover Pages`, `Table of Contents`). */
export function isGallery(elementXml: string, gallery: string): boolean {
  return new RegExp(`<(?:\\w+:)?docPartGallery\\b[^>]*?val="${gallery}"`).test(elementXml);
}

/** A table of contents: the gallery Word inserts it as, or a bare `TOC` field. */
export function isTableOfContents(elementXml: string): boolean {
  return isGallery(elementXml, "Table of Contents") || /<(?:\w+:)?instrText\b[^>]*>\s*TOC\b/.test(elementXml) || /\binstr="\s*TOC\b/.test(elementXml);
}

export function describeWordTemplate(pkg: WordPackage): TemplateDescription {
  const role = (name: string, label: string): StyleRole => {
    const style = styleByName(pkg.styles, name);
    return { role: label, style: style === undefined ? undefined : { id: style.id, name: style.name } };
  };
  const roles: StyleRole[] = [];
  for (let level = 1; level <= 6; level++) {
    const style = styleByName(pkg.styles, `heading ${level}`);
    roles.push({
      role: `heading ${level}`,
      style: style === undefined ? undefined : { id: style.id, name: style.name },
      numbered: style === undefined ? undefined : style.numbered,
    });
  }
  roles.push(role("Normal", "body text"), role("List Paragraph", "list"));
  const tableStyles = [...pkg.styles.values()]
    .filter((style) => style.type === "table")
    .map((style) => ({ id: style.id, name: style.name, isDefault: style.isDefault }));

  const body = bodyLayout(pkg.documentXml);
  let cover = false;
  let tableOfContents = false;
  let sampleParagraphs = 0;
  for (const child of body.children) {
    if (child.local === "sdt" && isGallery(child.xml, "Cover Pages")) {
      cover = true;
      continue;
    }
    if (child.local === "sdt" && isTableOfContents(child.xml)) {
      tableOfContents = true;
      continue;
    }
    if (child.local === "p" && isTableOfContents(child.xml)) {
      tableOfContents = true;
      continue;
    }
    if (child.local === "sectPr") continue;
    for (const paragraph of paragraphsIn(child)) if (paragraphText(paragraph).trim() !== "") sampleParagraphs++;
  }
  const sectPr = body.sectPr?.xml ?? "";
  return {
    roles,
    tableStyles,
    features: {
      cover,
      tableOfContents,
      headers: /<(?:\w+:)?headerReference\b/.test(sectPr),
      footers: /<(?:\w+:)?footerReference\b/.test(sectPr),
      sampleParagraphs,
    },
  };
}

/** Every paragraph in a block, a table's included. */
function paragraphsIn(element: { xml: string; local: string }): string[] {
  if (element.local === "p") return [element.xml];
  return [...element.xml.matchAll(/<(?:\w+:)?p\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?p>)/g)].map((match) => match[0]);
}

/** The template as the model reads it. */
export function formatTemplateDescription(description: TemplateDescription): string {
  const lines: string[] = ["Styles the content will use:"];
  for (const role of description.roles) {
    const name = role.style === undefined ? "(none — the writer's own will be added)" : `"${role.style.name}" (id ${role.style.id})`;
    lines.push(`- ${role.role}: ${name}${role.numbered ? ", numbered by the template" : ""}`);
  }
  const tables = description.tableStyles;
  lines.push(
    tables.length === 0
      ? "Table styles: none declared."
      : `Table styles: ${tables.map((style) => `"${style.name}"${style.isDefault ? " (default)" : ""}`).join(", ")}.`,
  );
  const f = description.features;
  const has = (flag: boolean) => (flag ? "yes" : "no");
  lines.push(
    `Cover page: ${has(f.cover)}. Table of contents: ${has(f.tableOfContents)}. Header: ${has(f.headers)}. Footer: ${has(f.footers)}.`,
    `Sample text in the body: ${f.sampleParagraphs} paragraph(s) — dropped from what is written.`,
  );
  if (f.cover || f.tableOfContents) {
    const keep = [f.cover ? '"cover"' : "", f.tableOfContents ? '"toc"' : ""].filter(Boolean).join(", ");
    lines.push(`To keep them in front of the content, pass keep: [${keep}].`);
  }
  return lines.join("\n");
}

