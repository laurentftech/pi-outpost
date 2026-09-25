/**
 * The pieces of WordprocessingML the Word writers work with: a document's body as a
 * list of top-level elements, its styles, and which paragraphs are headings.
 *
 * The writers splice XML rather than re-serialise it. A document is changed where it
 * is changed and nowhere else — an element this code does not understand (a content
 * control, a field, a vendor extension) is carried as the bytes it arrived as. So
 * what this module returns are positions and raw slices of the source, alongside the
 * little that is read out of them.
 *
 * SECURITY: the input is a workspace file. A DOCTYPE is refused (entity expansion
 * is how an XML file becomes a memory bomb), and nothing here touches the disk.
 */
import { decodeEntities, XmlError } from "./xml.ts";
import { localName } from "./ooxml.ts";

/** One element among its siblings, with where it sits in the source. */
export interface XmlElement {
  /** The qualified name as written, e.g. `w:p`. */
  name: string;
  /** Its local name, e.g. `p`. */
  local: string;
  start: number;
  end: number;
  xml: string;
}

/** The `>` that ends the tag opened at `open`, skipping quoted attribute values. */
function tagEnd(source: string, open: number): number {
  let quote: string | undefined;
  for (let at = open + 1; at < source.length; at++) {
    const char = source[at];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return at;
    }
  }
  return -1;
}

/**
 * The element children of the region `[from, to)` of `source`, in order.
 *
 * Text between them is ignored (a body or a paragraph holds none that matters), as
 * are comments and processing instructions. Depth is counted by name, so an element
 * nested inside a same-named one (a table in a table cell) is not mistaken for its
 * parent's end.
 */
export function childElements(source: string, from: number, to: number): XmlElement[] {
  const children: XmlElement[] = [];
  let depth = 0;
  let current: { name: string; start: number } | undefined;
  let at = from;
  while (at < to) {
    const open = source.indexOf("<", at);
    if (open === -1 || open >= to) break;
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      if (end === -1) throw new XmlError("unterminated comment");
      at = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      if (end === -1) throw new XmlError("unterminated CDATA section");
      at = end + 3;
      continue;
    }
    if (/^<!doctype/i.test(source.slice(open, open + 9))) throw new XmlError("this document declares a DOCTYPE, which is refused");
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      if (end === -1) throw new XmlError("unterminated processing instruction");
      at = end + 2;
      continue;
    }
    const close = tagEnd(source, open);
    if (close === -1 || close >= to) throw new XmlError("unterminated tag");
    const raw = source.slice(open + 1, close);
    at = close + 1;
    if (raw.startsWith("/")) {
      depth--;
      if (depth < 0) throw new XmlError(`unexpected </${raw.slice(1).trim()}>`);
      if (depth === 0 && current !== undefined) {
        const xml = source.slice(current.start, at);
        children.push({ name: current.name, local: localName(current.name), start: current.start, end: at, xml });
        current = undefined;
      }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const name = raw.replace(/\/$/, "").trim().split(/\s/)[0];
    if (depth === 0) {
      if (selfClosing) {
        children.push({ name, local: localName(name), start: open, end: at, xml: source.slice(open, at) });
        continue;
      }
      current = { name, start: open };
    }
    if (!selfClosing) depth++;
  }
  if (depth !== 0) throw new XmlError("an element is not closed");
  return children;
}

/** Where the body is, and what it holds. */
export interface BodyLayout {
  /** Offset just after `<w:body …>`. */
  innerStart: number;
  /** Offset of `</w:body>`. */
  innerEnd: number;
  /** The body's children, the final `w:sectPr` included when there is one. */
  children: XmlElement[];
  /** The final section properties — page size, margins, headers, footers — if any. */
  sectPr: XmlElement | undefined;
}

export function bodyLayout(documentXml: string): BodyLayout {
  const open = /<(\w+:)?body\b[^>]*>/.exec(documentXml);
  if (open === null) throw new XmlError("the document has no body");
  const prefix = open[1] ?? "";
  const innerStart = open.index + open[0].length;
  const innerEnd = documentXml.lastIndexOf(`</${prefix}body>`);
  if (innerEnd < innerStart) throw new XmlError("the document's body is not closed");
  const children = childElements(documentXml, innerStart, innerEnd);
  const last = children[children.length - 1];
  return { innerStart, innerEnd, children, sectPr: last?.local === "sectPr" ? last : undefined };
}

/** The attributes of the first tag in `xml`. */
export function rootAttributes(xml: string): Record<string, string> {
  const end = tagEnd(xml, 0);
  const tag = xml.slice(0, end + 1);
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

/** The value of the first `<…:name …:val="…">` in `xml`, if it has one. */
export function firstVal(xml: string, name: string): string | undefined {
  const match = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*?\\b(?:\\w+:)?val="([^"]*)"`).exec(xml);
  return match === null ? undefined : decodeEntities(match[1]);
}

/** The text a reader sees in a paragraph: its `w:t` runs, not deleted text, tabs as spaces. */
export function paragraphText(xml: string): string {
  let text = "";
  for (const match of xml.matchAll(/<(?:\w+:)?(t|tab|br)\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) {
    if (match[1] === "t") text += decodeEntities(match[2] ?? "");
    else text += " ";
  }
  return text;
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

export interface WordStyle {
  id: string;
  /** The name as the file states it — built-in ones in English whatever the UI language. */
  name: string;
  type: string;
  basedOn: string | undefined;
  /** 0-based outline level the style itself declares. */
  outlineLevel: number | undefined;
  /** Whether the style numbers its paragraphs (a `w:numPr` in its paragraph properties). */
  numbered: boolean;
  isDefault: boolean;
  xml: string;
}

/** The styles of a `styles.xml`, by id. */
export function parseStyles(stylesXml: string | undefined): Map<string, WordStyle> {
  const styles = new Map<string, WordStyle>();
  if (stylesXml === undefined) return styles;
  const root = /<(\w+:)?styles\b[^>]*>/.exec(stylesXml);
  if (root === null) return styles;
  const end = stylesXml.lastIndexOf(`</${root[1] ?? ""}styles>`);
  for (const element of childElements(stylesXml, root.index + root[0].length, end)) {
    if (element.local !== "style") continue;
    const attributes = rootAttributes(element.xml);
    const id = attributes["w:styleId"];
    if (id === undefined) continue;
    const level = firstVal(element.xml, "outlineLvl");
    styles.set(id, {
      id,
      name: firstVal(element.xml, "name") ?? id,
      type: attributes["w:type"] ?? "paragraph",
      basedOn: firstVal(element.xml, "basedOn"),
      outlineLevel: level === undefined ? undefined : Number(level),
      numbered: /<(?:\w+:)?numPr\b/.test(element.xml),
      isDefault: attributes["w:default"] === "1" || attributes["w:default"] === "true",
      xml: element.xml,
    });
  }
  return styles;
}

/** A style's name, normalised the way Word compares built-in names. */
export function styleKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The style with this name, of this type. */
export function styleByName(styles: Map<string, WordStyle>, name: string, type = "paragraph"): WordStyle | undefined {
  const key = styleKey(name);
  for (const style of styles.values()) if (style.type === type && styleKey(style.name) === key) return style;
  return undefined;
}

/** The outline level a style gives its paragraphs, following `basedOn`. */
export function styleOutlineLevel(styles: Map<string, WordStyle>, id: string | undefined): number | undefined {
  const seen = new Set<string>();
  let current = id === undefined ? undefined : styles.get(id);
  while (current !== undefined && !seen.has(current.id)) {
    if (current.outlineLevel !== undefined) return current.outlineLevel;
    seen.add(current.id);
    current = current.basedOn === undefined ? undefined : styles.get(current.basedOn);
  }
  return undefined;
}

/**
 * The heading level (1–9) of a paragraph, or undefined for body text.
 *
 * Word's own rule: the paragraph's direct outline level if it states one, else its
 * style's (through `basedOn`). Level 9 is body text. Built-in heading names are the
 * fallback for a style that declares no level — a template whose "heading 2" relies
 * on Word's built-in definition.
 */
export function headingLevelOf(paragraphXml: string, styles: Map<string, WordStyle>): number | undefined {
  const pPr = /<(?:\w+:)?pPr\b[\s\S]*?<\/(?:\w+:)?pPr>/.exec(paragraphXml)?.[0] ?? "";
  const direct = firstVal(pPr.replace(/<(?:\w+:)?rPr\b[\s\S]*?<\/(?:\w+:)?rPr>/g, ""), "outlineLvl");
  const styleId = firstVal(pPr, "pStyle");
  const level = direct !== undefined ? Number(direct) : styleOutlineLevel(styles, styleId);
  if (level !== undefined) return Number.isInteger(level) && level >= 0 && level <= 8 ? level + 1 : undefined;
  const style = styleId === undefined ? undefined : styles.get(styleId);
  const builtIn = style === undefined ? undefined : /^heading ([1-9])$/.exec(styleKey(style.name));
  return builtIn === null || builtIn === undefined ? undefined : Number(builtIn[1]);
}
