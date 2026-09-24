/**
 * Building a PowerPoint presentation from a template: its masters, layouts, theme
 * and fonts, with new slides written into the layouts' placeholders.
 *
 * Why placeholders rather than free-standing text boxes: a slide whose title sits in
 * the layout's title placeholder *is* styled by the template — font, size, colour,
 * position, bullets, autofit — and stays so when someone later switches the deck to
 * another theme. A text box drawn at the same coordinates only looks like it.
 *
 * The package is rebuilt, not patched in place. Every part of the template is carried
 * over except the slides it happened to contain (a .pptx used as a template usually
 * holds sample slides), and whatever only those slides reached — their notes, charts,
 * media, comments — is swept by walking the relationships from the package root: a
 * part nothing reaches is not part of the presentation.
 *
 * SECURITY: the template is a workspace file, so its bytes are untrusted. The reader
 * caps entry count and expanded size, the XML scanner refuses a DOCTYPE, and a
 * relationship target is only ever used as a name inside the package — it never
 * becomes a filesystem path. Pictures arrive already read and checked by the caller.
 */
import { resolvePart } from "./ooxml.ts";
import { IMAGE_CONTENT_TYPES, type ImageInfo, type ImageKind } from "./imageInfo.ts";
import { scanXml, XmlError } from "./xml.ts";
import { readAllZipEntries, ZipError } from "./zip.ts";
import { writeZip } from "./zipWriter.ts";
import zlib from "node:zlib";

export class PptxBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptxBuildError";
  }
}

/* ── Limits ─────────────────────────────────────────────────────────────────── */

/** Every layout, master and picture is its own entry; a real template stays well under. */
export const MAX_TEMPLATE_ENTRIES = 4096;
export const MAX_TEMPLATE_PART_BYTES = 64 * 1024 * 1024;
export const MAX_TEMPLATE_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_SLIDES = 300;
export const MAX_BULLETS = 100;
export const MAX_TEXT_CHARS = 5_000;
/** Nesting levels a bullet may use — PowerPoint's own ceiling is nine. */
export const MAX_BULLET_LEVEL = 8;

/* ── Namespaces and part types ──────────────────────────────────────────────── */

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_REL_PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_SLIDE = `${NS_R}/slide`;
const REL_SLIDE_LAYOUT = `${NS_R}/slideLayout`;
const REL_SLIDE_MASTER = `${NS_R}/slideMaster`;
const REL_IMAGE = `${NS_R}/image`;
const REL_OFFICE_DOCUMENT = `${NS_R}/officeDocument`;
/** The extension list entry PowerPoint reads an SVG picture from (Office 2016 and later). */
const SVG_BLIP_EXT_URI = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}";
const NS_ASVG = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";

const CT_PRESENTATION = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const CT_TEMPLATE = "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml";
const CT_SLIDESHOW = "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml";
const CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const CONTENT_TYPES = "[Content_Types].xml";
const ROOT_RELS = "_rels/.rels";

/** OLE compound files (encrypted OOXML, legacy .ppt) start with this, not with "PK". */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

/* ── Template model ─────────────────────────────────────────────────────────── */

/** A rectangle in EMU (914 400 to the inch). */
export interface Box {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export interface LayoutPlaceholder {
  /** ST_PlaceholderType; `obj` when the markup states none, as the schema defaults it. */
  type: string;
  /** Index linking a slide's placeholder to this one; absent means 0. */
  idx: string | undefined;
  name: string;
  /** Position, inherited from the master when the layout does not state one. */
  box: Box | undefined;
}

export interface TemplateLayout {
  name: string;
  /** ST_SlideLayoutType (`title`, `obj`, `twoObj`, …); `cust` when the markup states none. */
  type: string;
  part: string;
  placeholders: LayoutPlaceholder[];
}

export interface Template {
  parts: Map<string, Buffer>;
  presentationPart: string;
  slideSize: { cx: number; cy: number };
  layouts: TemplateLayout[];
  /** Slides the template itself contains — dropped from what is built. */
  existingSlides: number;
}

interface Relationship {
  id: string;
  type: string;
  /** Part name inside the package, or the raw target when external. */
  target: string;
  external: boolean;
}

function decode(parts: Map<string, Buffer>, name: string): string | undefined {
  return parts.get(name)?.toString("utf8");
}

function relsPartOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return slash === -1 ? `_rels/${part}.rels` : `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}

function directoryOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return slash === -1 ? "" : part.slice(0, slash);
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

function parseRelationshipList(xml: string | undefined, sourcePart: string): Relationship[] {
  if (xml === undefined) return [];
  const base = directoryOf(sourcePart);
  const list: Relationship[] = [];
  scanXml(xml, (event) => {
    if (event.kind !== "open" || localName(event.name) !== "Relationship") return;
    const { Id: id, Type: type, Target: target, TargetMode: mode } = event.attributes;
    if (id === undefined || type === undefined || target === undefined) return;
    const external = mode === "External";
    list.push({ id, type, target: external ? target : resolvePart(target, base), external });
  });
  return list;
}

/** Attributes of an `r:id`-style attribute, whatever prefix the writer bound. */
function relationshipIdOf(attributes: Record<string, string>): string | undefined {
  if (attributes["r:id"] !== undefined) return attributes["r:id"];
  for (const [name, value] of Object.entries(attributes)) {
    if (name !== "id" && name.endsWith(":id")) return value;
  }
  return undefined;
}

/** The relationship ids of `<…:sldMasterId>` or `<…:sldLayoutId>` entries, in declared order. */
function idListOrder(xml: string, element: string): string[] {
  const ids: string[] = [];
  scanXml(xml, (event) => {
    if (event.kind !== "open" || localName(event.name) !== element) return;
    const id = relationshipIdOf(event.attributes);
    if (id !== undefined) ids.push(id);
  });
  return ids;
}

interface ParsedShapes {
  name: string | undefined;
  type: string | undefined;
  placeholders: LayoutPlaceholder[];
}

/**
 * The placeholders of a layout or master, with the position each states itself.
 *
 * A placeholder is a `p:sp` or `p:pic` whose `p:nvPr` carries a `p:ph`. Its position
 * is the `a:xfrm` directly under its `p:spPr` — an `a:xfrm` deeper in (a group, a
 * table) belongs to something else and is not read.
 */
function parseShapes(xml: string, rootElement: string): ParsedShapes {
  let name: string | undefined;
  let type: string | undefined;
  const placeholders: LayoutPlaceholder[] = [];
  const stack: string[] = [];
  let current: { ph?: { type: string; idx: string | undefined }; name: string; off?: [number, number]; ext?: [number, number]; depth: number } | undefined;

  scanXml(xml, (event) => {
    if (event.kind === "text") return;
    if (event.kind === "close") {
      const closing = localName(event.name);
      stack.pop();
      if (current !== undefined && stack.length === current.depth && (closing === "sp" || closing === "pic")) {
        if (current.ph !== undefined) {
          const box =
            current.off !== undefined && current.ext !== undefined
              ? { x: current.off[0], y: current.off[1], cx: current.ext[0], cy: current.ext[1] }
              : undefined;
          placeholders.push({ type: current.ph.type, idx: current.ph.idx, name: current.name, box });
        }
        current = undefined;
      }
      return;
    }
    const local = localName(event.name);
    const parent = stack[stack.length - 1];
    if (local === rootElement && stack.length === 0) type = event.attributes.type;
    if (local === "cSld" && parent === rootElement) name = event.attributes.name;
    if ((local === "sp" || local === "pic") && current === undefined && parent === "spTree") {
      current = { name: "", depth: stack.length };
    }
    if (current !== undefined) {
      if (local === "cNvPr" && current.name === "") current.name = event.attributes.name ?? "";
      if (local === "ph") current.ph = { type: event.attributes.type ?? "obj", idx: event.attributes.idx };
      // The shape's own transform: spPr is a direct child of the shape, xfrm of spPr.
      const inOwnXfrm = stack.length === current.depth + 3 && stack[current.depth + 1] === "spPr" && stack[current.depth + 2] === "xfrm";
      if (inOwnXfrm && local === "off") current.off = [Number(event.attributes.x), Number(event.attributes.y)];
      if (inOwnXfrm && local === "ext") current.ext = [Number(event.attributes.cx), Number(event.attributes.cy)];
    }
    if (!event.selfClosing) stack.push(local);
  });
  return { name, type, placeholders };
}

/** Which master placeholder a layout placeholder inherits its position from. */
function masterTypeFor(type: string): string {
  if (type === "title" || type === "ctrTitle") return "title";
  if (type === "dt" || type === "ftr" || type === "sldNum" || type === "hdr") return type;
  return "body";
}

function validBox(box: Box | undefined): box is Box {
  return box !== undefined && [box.x, box.y, box.cx, box.cy].every(Number.isFinite) && box.cx > 0 && box.cy > 0;
}

export function readTemplate(bytes: Uint8Array): Template {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.subarray(0, 4).equals(OLE_MAGIC)) {
    throw new PptxBuildError("the template is password-protected or a legacy .ppt/.pot file; save it as .pptx or .potx first");
  }
  let parts: Map<string, Buffer>;
  try {
    parts = readAllZipEntries(buffer, {
      maxEntries: MAX_TEMPLATE_ENTRIES,
      maxInflatedBytes: MAX_TEMPLATE_PART_BYTES,
      maxTotalBytes: MAX_TEMPLATE_TOTAL_BYTES,
    });
  } catch (error) {
    if (error instanceof ZipError) throw new PptxBuildError(`the template cannot be read: ${error.message}`);
    throw error;
  }

  try {
    const contentTypes = decode(parts, CONTENT_TYPES);
    if (contentTypes === undefined) throw new PptxBuildError("the template is not an Office package (no [Content_Types].xml)");
    const presentationPart = parseRelationshipList(decode(parts, ROOT_RELS), "")
      .find((rel) => rel.type === REL_OFFICE_DOCUMENT && !rel.external)?.target;
    if (presentationPart === undefined || !parts.has(presentationPart)) {
      throw new PptxBuildError("the template has no main part; it is not a presentation");
    }
    const mainType = contentTypeOf(contentTypes, presentationPart);
    if (mainType !== CT_PRESENTATION && mainType !== CT_TEMPLATE && mainType !== CT_SLIDESHOW) {
      throw new PptxBuildError(
        mainType !== undefined && /macroEnabled/i.test(mainType)
          ? "the template is macro-enabled (.pptm/.potm); save a copy without macros as .pptx or .potx"
          : "the template is not a PowerPoint presentation or template",
      );
    }
    const presentation = decode(parts, presentationPart)!;
    const presentationRels = parseRelationshipList(decode(parts, relsPartOf(presentationPart)), presentationPart);
    const byId = new Map(presentationRels.map((rel) => [rel.id, rel]));

    const size = /<(?:\w+:)?sldSz\b[^>]*?\bcx="(\d+)"[^>]*?\bcy="(\d+)"/.exec(presentation);
    const slideSize = size ? { cx: Number(size[1]), cy: Number(size[2]) } : { cx: 9_144_000, cy: 6_858_000 };

    const layouts: TemplateLayout[] = [];
    for (const masterId of idListOrder(presentation, "sldMasterId")) {
      const masterRel = byId.get(masterId);
      if (masterRel === undefined || masterRel.type !== REL_SLIDE_MASTER || masterRel.external) continue;
      const masterXml = decode(parts, masterRel.target);
      if (masterXml === undefined) continue;
      const master = parseShapes(masterXml, "sldMaster");
      const masterRels = new Map(
        parseRelationshipList(decode(parts, relsPartOf(masterRel.target)), masterRel.target).map((rel) => [rel.id, rel]),
      );
      for (const layoutId of idListOrder(masterXml, "sldLayoutId")) {
        const layoutRel = masterRels.get(layoutId);
        if (layoutRel === undefined || layoutRel.type !== REL_SLIDE_LAYOUT || layoutRel.external) continue;
        const layoutXml = decode(parts, layoutRel.target);
        if (layoutXml === undefined) continue;
        const layout = parseShapes(layoutXml, "sldLayout");
        const placeholders = layout.placeholders.map((placeholder) => {
          if (validBox(placeholder.box)) return placeholder;
          const inherited = master.placeholders.find((candidate) => candidate.type === masterTypeFor(placeholder.type));
          return { ...placeholder, box: validBox(inherited?.box) ? inherited.box : undefined };
        });
        layouts.push({
          name: layout.name ?? layoutRel.target.split("/").pop()!.replace(/\.xml$/, ""),
          type: layout.type ?? "cust",
          part: layoutRel.target,
          placeholders,
        });
      }
    }
    if (layouts.length === 0) throw new PptxBuildError("the template declares no slide layouts");

    const existingSlides = presentationRels.filter((rel) => rel.type === REL_SLIDE).length;
    return { parts, presentationPart, slideSize, layouts, existingSlides };
  } catch (error) {
    if (error instanceof XmlError) throw new PptxBuildError(`the template is damaged: ${error.message}`);
    throw error;
  }
}

/** The content type the package declares for a part: its override, else its extension's default. */
function contentTypeOf(contentTypes: string, part: string): string | undefined {
  let override: string | undefined;
  const defaults = new Map<string, string>();
  scanXml(contentTypes, (event) => {
    if (event.kind !== "open") return;
    const local = localName(event.name);
    if (local === "Override" && event.attributes.PartName?.replace(/^\//, "") === part) override = event.attributes.ContentType;
    if (local === "Default" && event.attributes.Extension !== undefined) {
      defaults.set(event.attributes.Extension.toLowerCase(), event.attributes.ContentType);
    }
  });
  return override ?? defaults.get(part.split(".").pop()!.toLowerCase());
}

/* ── Describing a template ──────────────────────────────────────────────────── */

const PLACEHOLDER_LABELS: Record<string, string> = {
  title: "title",
  ctrTitle: "title",
  subTitle: "subtitle",
  body: "text",
  obj: "content",
  pic: "picture",
  tbl: "table",
  chart: "chart",
  dgm: "diagram",
  media: "media",
  clipArt: "picture",
};

/** What a layout can hold, as the model should read it: `title, subtitle` or `title, content, content`. */
export function describeLayout(layout: TemplateLayout): string {
  const slots = layout.placeholders
    .filter((placeholder) => PLACEHOLDER_LABELS[placeholder.type] !== undefined)
    .map((placeholder) => PLACEHOLDER_LABELS[placeholder.type]);
  return slots.length > 0 ? slots.join(", ") : "no content placeholders (blank)";
}

export function describeTemplate(template: Template): string {
  const inches = (emu: number) => (emu / 914_400).toFixed(2).replace(/\.?0+$/, "");
  const lines = [
    `Slide size: ${inches(template.slideSize.cx)}" × ${inches(template.slideSize.cy)}"` +
      ` (${template.slideSize.cx * 3 > template.slideSize.cy * 4 + 1 ? "widescreen" : "4:3"}).`,
    `The template holds ${template.existingSlides} slide(s) of its own; pptx_create leaves them out.`,
    "",
    "| # | Layout name | Type | Placeholders |",
    "| --- | --- | --- | --- |",
    ...template.layouts.map(
      (layout, index) => `| ${index + 1} | ${layout.name.replace(/\|/g, "\\|")} | ${layout.type} | ${describeLayout(layout)} |`,
    ),
  ];
  return lines.join("\n");
}

/* ── Slide specification ────────────────────────────────────────────────────── */

export interface SlideImage {
  /** How the caller named the file — used in messages only. */
  name: string;
  bytes: Buffer;
  info: ImageInfo;
  alt?: string;
}

export interface SlideSpec {
  layout?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  image?: SlideImage;
}

export interface BuildOptions {
  /**
   * A PNG of the SVG at the given pixel size, drawn for readers that do not understand
   * the SVG extension; `null` when no rasteriser is available here.
   */
  rasterizeSvg?: (svg: Buffer, width: number, height: number) => Promise<Buffer | null>;
}

export interface BuiltSlide {
  number: number;
  layout: string;
  warnings: string[];
}

export interface BuiltPresentation {
  bytes: Buffer;
  slides: BuiltSlide[];
}

/* ── Choosing a layout ──────────────────────────────────────────────────────── */

function hasTitle(layout: TemplateLayout): boolean {
  return layout.placeholders.some((placeholder) => placeholder.type === "title" || placeholder.type === "ctrTitle");
}

function contentPlaceholders(layout: TemplateLayout): LayoutPlaceholder[] {
  return layout.placeholders.filter((placeholder) => placeholder.type === "obj" || placeholder.type === "body");
}

function byType(layouts: TemplateLayout[], ...types: string[]): TemplateLayout | undefined {
  for (const type of types) {
    const found = layouts.find((layout) => layout.type === type);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The layout a slide gets when the caller names none. Picked by the layout *type*
 * PowerPoint records, since names are the template author's and vary with language.
 */
function defaultLayout(layouts: TemplateLayout[], slide: SlideSpec, index: number): TemplateLayout {
  const bullets = (slide.bullets?.length ?? 0) > 0;
  const image = slide.image !== undefined;
  const withContent = layouts.find((layout) => hasTitle(layout) && contentPlaceholders(layout).length > 0);
  let chosen: TemplateLayout | undefined;
  if (!bullets && !image) {
    chosen = index === 0 ? byType(layouts, "title") : slide.subtitle ? byType(layouts, "secHead", "title") : byType(layouts, "titleOnly", "title");
  } else if (bullets && image) {
    chosen = byType(layouts, "twoObj", "obj");
  } else {
    chosen = byType(layouts, "obj");
  }
  return chosen ?? withContent ?? layouts.find(hasTitle) ?? layouts[0];
}

function findLayout(layouts: TemplateLayout[], name: string): TemplateLayout {
  const wanted = name.trim().toLowerCase();
  const found =
    layouts.find((layout) => layout.name.toLowerCase() === wanted) ??
    // "Layout 3" or "3": the numbering pptx_layouts shows.
    (/^(layout\s*)?\d+$/i.test(wanted) ? layouts[Number(wanted.replace(/\D/g, "")) - 1] : undefined);
  if (found === undefined) {
    throw new PptxBuildError(
      `the template has no layout named "${name}". Its layouts are: ${layouts.map((layout) => `"${layout.name}"`).join(", ")}`,
    );
  }
  return found;
}

/* ── Writing XML ────────────────────────────────────────────────────────────── */

/** Characters XML 1.0 cannot carry at all, and lone surrogates. */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `**bold**` spans become bold runs; everything else is a plain run. */
function runs(text: string): string {
  const pieces = text.split(/(\*\*[^*\n]+\*\*)/);
  return pieces
    .filter((piece) => piece !== "")
    .map((piece) => {
      const bold = piece.startsWith("**") && piece.endsWith("**") && piece.length > 4;
      const content = bold ? piece.slice(2, -2) : piece;
      return `<a:r><a:rPr lang="en-US" dirty="0"${bold ? ' b="1"' : ""}/><a:t>${escapeXml(content)}</a:t></a:r>`;
    })
    .join("");
}

/** A title or subtitle: one paragraph, a line break for each newline. */
function titleParagraph(text: string): string {
  const lines = text.split(/\r?\n/);
  return `<a:p>${lines.map((line) => runs(line)).join("<a:br><a:rPr lang=\"en-US\" dirty=\"0\"/></a:br>")}</a:p>`;
}

/** A bullet's nesting level from its indentation: two spaces or one tab per level. */
export function bulletLevel(raw: string): { level: number; text: string } {
  const indent = /^[ \t]*/.exec(raw)![0];
  const columns = [...indent].reduce((sum, char) => sum + (char === "\t" ? 2 : 1), 0);
  const level = Math.min(MAX_BULLET_LEVEL, Math.floor(columns / 2));
  // A literal bullet glyph would be drawn beside the one the layout already draws.
  const text = raw.slice(indent.length).replace(/^(?:[•▪◦‣∙·*–-])\s+/, "");
  return { level, text };
}

function bulletParagraphs(bullets: string[]): string {
  return bullets
    .map((raw) => {
      const { level, text } = bulletLevel(raw);
      return `<a:p>${level > 0 ? `<a:pPr lvl="${level}"/>` : ""}${runs(text)}</a:p>`;
    })
    .join("");
}

function placeholderRef(placeholder: LayoutPlaceholder): string {
  const type = placeholder.type === "obj" ? "" : ` type="${escapeXml(placeholder.type)}"`;
  const idx = placeholder.idx !== undefined ? ` idx="${escapeXml(placeholder.idx)}"` : "";
  return `<p:ph${type}${idx}/>`;
}

function xfrm(box: Box): string {
  return `<a:xfrm><a:off x="${Math.round(box.x)}" y="${Math.round(box.y)}"/><a:ext cx="${Math.round(box.cx)}" cy="${Math.round(box.cy)}"/></a:xfrm>`;
}

function textShape(id: number, name: string, placeholder: LayoutPlaceholder, paragraphs: string, box?: Box): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${placeholderRef(placeholder)}</p:nvPr></p:nvSpPr>` +
    `<p:spPr>${box ? xfrm(box) : ""}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
  );
}

function pictureShape(id: number, image: SlideImage, box: Box, embed: string, svgEmbed: string | undefined): string {
  const svg = svgEmbed
    ? `<a:extLst><a:ext uri="${SVG_BLIP_EXT_URI}"><asvg:svgBlip xmlns:asvg="${NS_ASVG}" r:embed="${svgEmbed}"/></a:ext></a:extLst>`
    : "";
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id - 1}" descr="${escapeXml(image.alt ?? "")}"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${embed}">${svg}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

/** The largest box of the picture's proportions that fits inside `area`, centred in it. */
export function fitInside(area: Box, width: number, height: number): Box {
  const scale = Math.min(area.cx / width, area.cy / height);
  const cx = width * scale;
  const cy = height * scale;
  return { x: area.x + (area.cx - cx) / 2, y: area.y + (area.cy - cy) / 2, cx, cy };
}

/** A transparent 1×1 PNG: the fallback picture when no rasteriser is available. */
function transparentPixel(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── Building ───────────────────────────────────────────────────────────────── */

interface NewSlide {
  part: string;
  xml: string;
  rels: string;
  media: Array<{ part: string; bytes: Buffer }>;
}

/** Placement of one slide's content in its layout. */
async function composeSlide(
  template: Template,
  layout: TemplateLayout,
  slide: SlideSpec,
  number: number,
  mediaPrefix: string,
  options: BuildOptions,
  warnings: string[],
): Promise<NewSlide> {
  const shapes: string[] = [];
  let nextId = 2;
  const rels = [`<Relationship Id="rId1" Type="${REL_SLIDE_LAYOUT}" Target="${relativeTarget(`ppt/slides/slide${number}.xml`, layout.part)}"/>`];
  const media: NewSlide["media"] = [];

  const title = layout.placeholders.find((placeholder) => placeholder.type === "title" || placeholder.type === "ctrTitle");
  const subtitle = layout.placeholders.find((placeholder) => placeholder.type === "subTitle");
  const contents = contentPlaceholders(layout);
  const picture = layout.placeholders.find((placeholder) => placeholder.type === "pic");
  const bullets = slide.bullets ?? [];

  if (slide.title !== undefined && slide.title.trim() !== "") {
    if (title === undefined) warnings.push(`layout "${layout.name}" has no title placeholder; the title was left out`);
    else shapes.push(textShape(nextId++, "Title", title, titleParagraph(slide.title)));
  }

  let usedContent = 0;
  if (slide.subtitle !== undefined && slide.subtitle.trim() !== "") {
    if (subtitle !== undefined) shapes.push(textShape(nextId++, "Subtitle", subtitle, titleParagraph(slide.subtitle)));
    else if (bullets.length === 0 && contents.length > 0) {
      shapes.push(textShape(nextId++, "Subtitle", contents[0], titleParagraph(slide.subtitle)));
      usedContent = 1;
    } else warnings.push(`layout "${layout.name}" has no subtitle placeholder; the subtitle was left out`);
  }

  // Where the picture goes, decided before the text: sharing one placeholder means
  // the text gets the left part of it.
  let imageArea: Box | undefined;
  let textBox: Box | undefined;
  const textPlaceholder = bullets.length > 0 ? contents[usedContent] : undefined;
  if (slide.image !== undefined) {
    if (validBox(picture?.box)) imageArea = picture.box;
    else if (bullets.length > 0 && validBox(contents[usedContent + 1]?.box)) imageArea = contents[usedContent + 1].box;
    else if (bullets.length === 0 && validBox(contents[usedContent]?.box)) imageArea = contents[usedContent].box;
    else if (bullets.length > 0 && validBox(textPlaceholder?.box)) {
      const whole = textPlaceholder.box;
      const gap = Math.round(whole.cx * 0.04);
      const textWidth = Math.round((whole.cx - gap) * 0.55);
      textBox = { x: whole.x, y: whole.y, cx: textWidth, cy: whole.cy };
      imageArea = { x: whole.x + textWidth + gap, y: whole.y, cx: whole.cx - textWidth - gap, cy: whole.cy };
    } else {
      // No placeholder to lean on: below the title, inside a margin.
      const margin = Math.round(template.slideSize.cx * 0.06);
      const top = validBox(title?.box) ? title.box.y + title.box.cy + margin / 2 : margin;
      imageArea = { x: margin, y: top, cx: template.slideSize.cx - 2 * margin, cy: template.slideSize.cy - top - margin };
      if (imageArea.cy <= 0) imageArea = { x: margin, y: margin, cx: template.slideSize.cx - 2 * margin, cy: template.slideSize.cy - 2 * margin };
    }
  }

  if (bullets.length > 0) {
    if (textPlaceholder === undefined) {
      warnings.push(`layout "${layout.name}" has no text or content placeholder; the bullets were left out — pick a layout with one`);
    } else {
      shapes.push(textShape(nextId++, "Content", textPlaceholder, bulletParagraphs(bullets), textBox));
    }
  }

  if (slide.image !== undefined && imageArea !== undefined) {
    const image = slide.image;
    const box = fitInside(imageArea, image.info.width, image.info.height);
    const extension = image.info.kind === "jpeg" ? "jpeg" : image.info.kind;
    const imagePart = `ppt/media/${mediaPrefix}${number}-1.${extension}`;
    const embed = "rId2";
    let svgEmbed: string | undefined;
    if (image.info.kind === "svg") {
      // PowerPoint 2016+ draws the SVG; everything else draws the PNG beside it.
      const pixels = Math.max(1, Math.min(2400, Math.round((box.cx / 914_400) * 200)));
      const height = Math.max(1, Math.round((pixels * box.cy) / box.cx));
      let fallback = options.rasterizeSvg ? await options.rasterizeSvg(image.bytes, pixels, height) : null;
      if (fallback === null) {
        warnings.push(
          `no SVG rasteriser is available here, so "${image.name}" has an empty fallback picture: ` +
            "PowerPoint 2016 and later show the SVG, older readers show nothing",
        );
        fallback = transparentPixel();
      }
      const fallbackPart = `ppt/media/${mediaPrefix}${number}-1-fallback.png`;
      media.push({ part: fallbackPart, bytes: fallback }, { part: imagePart, bytes: image.bytes });
      rels.push(`<Relationship Id="rId2" Type="${REL_IMAGE}" Target="${relativeTarget(`ppt/slides/slide${number}.xml`, fallbackPart)}"/>`);
      rels.push(`<Relationship Id="rId3" Type="${REL_IMAGE}" Target="${relativeTarget(`ppt/slides/slide${number}.xml`, imagePart)}"/>`);
      svgEmbed = "rId3";
    } else {
      media.push({ part: imagePart, bytes: image.bytes });
      rels.push(`<Relationship Id="${embed}" Type="${REL_IMAGE}" Target="${relativeTarget(`ppt/slides/slide${number}.xml`, imagePart)}"/>`);
    }
    shapes.push(pictureShape(nextId++, image, box, embed, svgEmbed));
  }

  if (shapes.length === 0) warnings.push("the slide is empty");

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    shapes.join("") +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const relsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="${NS_REL_PACKAGE}">${rels.join("")}</Relationships>`;
  return { part: `ppt/slides/slide${number}.xml`, xml, rels: relsXml, media };
}

/** A relationship target from one part to another, relative to the first one's folder. */
function relativeTarget(from: string, to: string): string {
  const fromDir = directoryOf(from).split("/").filter(Boolean);
  const toParts = to.split("/");
  let common = 0;
  while (common < fromDir.length && common < toParts.length - 1 && fromDir[common] === toParts[common]) common++;
  return [...Array(fromDir.length - common).fill(".."), ...toParts.slice(common)].join("/");
}

/**
 * The parts still reached from the package root once the template's slides are cut
 * from the presentation's relationships. Everything else — the slides, and whatever
 * only they used — is dropped.
 */
function reachableParts(parts: Map<string, Buffer>, presentationPart: string): Set<string> {
  const reached = new Set<string>();
  const queue = [""];
  while (queue.length > 0) {
    const source = queue.shift()!;
    const relsPart = source === "" ? ROOT_RELS : relsPartOf(source);
    if (source !== "") reached.add(source);
    for (const rel of parseRelationshipList(decode(parts, relsPart), source)) {
      if (rel.external) continue;
      if (source === presentationPart && rel.type === REL_SLIDE) continue;
      if (!reached.has(rel.target) && parts.has(rel.target) && !queue.includes(rel.target)) queue.push(rel.target);
    }
  }
  return reached;
}

/** Remove every `<prefix:name …>…</prefix:name>` (or self-closed) element with this local name. */
function removeElement(xml: string, name: string): string {
  const open = new RegExp(`<(\\w+:)?${name}\\b[^>]*?/>|<(\\w+:)?${name}\\b[^>]*>[\\s\\S]*?</(\\w+:)?${name}>`, "g");
  return xml.replace(open, "");
}

function rewritePresentation(xml: string, slideRelIds: string[]): string {
  const prefixMatch = /<(\w+:)?presentation\b/.exec(xml);
  if (prefixMatch === null) throw new PptxBuildError("the template's presentation part has no presentation element");
  const p = prefixMatch[1] ?? "";
  // Custom shows and sections name slides by id; with the slides gone they would point
  // at nothing, which PowerPoint reports as damage.
  let result = removeElement(xml, "custShowLst");
  result = result.replace(/<(\w+:)?ext\b[^>]*>(?:(?!<\/(?:\w+:)?ext>)[\s\S])*?sectionLst[\s\S]*?<\/(\w+:)?ext>/g, "");
  result = result.replace(/<(\w+:)?extLst>\s*<\/(\w+:)?extLst>/g, "");
  result = removeElement(result, "sldIdLst");
  const list =
    slideRelIds.length === 0
      ? ""
      : `<${p}sldIdLst>${slideRelIds.map((id, index) => `<${p}sldId id="${256 + index}" r:id="${id}"/>`).join("")}</${p}sldIdLst>`;
  // The schema fixes the order: masters, notes master, handout master, then slides.
  for (const after of ["handoutMasterIdLst", "notesMasterIdLst", "sldMasterIdLst"]) {
    const close = new RegExp(`</${p}${after}>`).exec(result);
    if (close !== null) {
      const at = close.index + close[0].length;
      return ensureRelationshipNamespace(result.slice(0, at) + list + result.slice(at));
    }
  }
  throw new PptxBuildError("the template's presentation part lists no slide master");
}

/** The `r:` prefix our slide list uses must be bound on the root. */
function ensureRelationshipNamespace(xml: string): string {
  const root = /<(\w+:)?presentation\b[^>]*>/.exec(xml)!;
  if (/\sxmlns:r="/.test(root[0])) {
    if (!root[0].includes(`xmlns:r="${NS_R}"`)) throw new PptxBuildError("the template binds the r: prefix to another namespace");
    return xml;
  }
  const tag = root[0].replace(/\/?>$/, (end) => ` xmlns:r="${NS_R}"${end}`);
  return xml.slice(0, root.index) + tag + xml.slice(root.index + root[0].length);
}

function rewritePresentationRels(xml: string | undefined, presentationPart: string, slideParts: string[]): { xml: string; ids: string[] } {
  const kept = parseRelationshipList(xml, presentationPart).filter((rel) => rel.type !== REL_SLIDE);
  let highest = 0;
  for (const rel of kept) {
    const match = /^rId(\d+)$/.exec(rel.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  // Kept relationships are copied as written, not re-serialised, so nothing the
  // template stated — an attribute this code does not know — is lost.
  const keptXml: string[] = [];
  scanRawRelationships(xml ?? "", (raw, type) => {
    if (type !== REL_SLIDE) keptXml.push(raw);
  });
  const ids = slideParts.map((_, index) => `rId${highest + 1 + index}`);
  const added = slideParts.map(
    (part, index) => `<Relationship Id="${ids[index]}" Type="${REL_SLIDE}" Target="${relativeTarget(presentationPart, part)}"/>`,
  );
  return {
    xml:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="${NS_REL_PACKAGE}">${keptXml.join("")}${added.join("")}</Relationships>`,
    ids,
  };
}

function scanRawRelationships(xml: string, visit: (raw: string, type: string) => void): void {
  for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?Relationship>)/g)) {
    const type = /\bType="([^"]*)"/.exec(match[0])?.[1] ?? "";
    visit(match[0], type);
  }
}

function rewriteContentTypes(xml: string, keptParts: Set<string>, presentationPart: string, slideParts: string[], extensions: Set<string>): string {
  let result = xml.replace(/<(?:\w+:)?Override\b[^>]*?\/>/g, (element) => {
    const part = /\bPartName="([^"]*)"/.exec(element)?.[1]?.replace(/^\//, "");
    if (part === undefined || !keptParts.has(part)) return "";
    if (part === presentationPart) return element.replace(/ContentType="[^"]*"/, `ContentType="${CT_PRESENTATION}"`);
    return element;
  });
  const declared = new Set([...result.matchAll(/<(?:\w+:)?Default\b[^>]*\bExtension="([^"]*)"/g)].map((match) => match[1].toLowerCase()));
  const defaults = [...extensions]
    .filter((extension) => !declared.has(extension))
    .map((extension) => `<Default Extension="${extension}" ContentType="${IMAGE_CONTENT_TYPES[extension as ImageKind]}"/>`);
  const overrides = slideParts.map((part) => `<Override PartName="/${part}" ContentType="${CT_SLIDE}"/>`);
  const close = result.lastIndexOf("</");
  result = result.slice(0, close) + defaults.join("") + overrides.join("") + result.slice(close);
  return result;
}

export async function buildPresentation(template: Template, slides: SlideSpec[], options: BuildOptions = {}): Promise<BuiltPresentation> {
  if (slides.length === 0) throw new PptxBuildError("a presentation needs at least one slide");
  if (slides.length > MAX_SLIDES) throw new PptxBuildError(`at most ${MAX_SLIDES} slides can be built in one call (got ${slides.length})`);

  const kept = reachableParts(template.parts, template.presentationPart);
  // Our media names must not collide with anything the template keeps.
  let mediaPrefix = "pptx-create-";
  while ([...kept].some((part) => part.startsWith(`ppt/media/${mediaPrefix}`))) mediaPrefix = `x${mediaPrefix}`;

  const built: BuiltSlide[] = [];
  const newSlides: NewSlide[] = [];
  for (const [index, slide] of slides.entries()) {
    for (const [field, value] of [["title", slide.title], ["subtitle", slide.subtitle]] as const) {
      if (value !== undefined && value.length > MAX_TEXT_CHARS) throw new PptxBuildError(`slide ${index + 1}: the ${field} is longer than ${MAX_TEXT_CHARS} characters`);
    }
    if ((slide.bullets?.length ?? 0) > MAX_BULLETS) throw new PptxBuildError(`slide ${index + 1}: more than ${MAX_BULLETS} bullets`);
    if (slide.bullets?.some((bullet) => bullet.length > MAX_TEXT_CHARS)) {
      throw new PptxBuildError(`slide ${index + 1}: a bullet is longer than ${MAX_TEXT_CHARS} characters`);
    }
    const layout = slide.layout !== undefined && slide.layout.trim() !== "" ? findLayout(template.layouts, slide.layout) : defaultLayout(template.layouts, slide, index);
    const warnings: string[] = [];
    // The template's slides are all dropped, so slide file numbers start again at 1.
    newSlides.push(await composeSlide(template, layout, slide, index + 1, mediaPrefix, options, warnings));
    built.push({ number: index + 1, layout: layout.name, warnings });
  }

  const slideParts = newSlides.map((slide) => slide.part);
  const presentationRelsPart = relsPartOf(template.presentationPart);
  const rels = rewritePresentationRels(decode(template.parts, presentationRelsPart), template.presentationPart, slideParts);
  const presentationXml = rewritePresentation(decode(template.parts, template.presentationPart)!, rels.ids);

  const output = new Map<string, Buffer>();
  const keepWithRels = new Set(kept);
  for (const [name, data] of template.parts) {
    if (name === CONTENT_TYPES || name === ROOT_RELS) continue;
    const isRels = name.endsWith(".rels");
    if (isRels) {
      // A relationship part belongs to the part it describes.
      const owner = name.replace(/_rels\/([^/]+)\.rels$/, "$1");
      if (keepWithRels.has(owner)) output.set(name, data);
      continue;
    }
    if (kept.has(name)) output.set(name, data);
  }
  output.set(template.presentationPart, Buffer.from(presentationXml, "utf8"));
  output.set(presentationRelsPart, Buffer.from(rels.xml, "utf8"));
  const extensions = new Set<string>();
  for (const slide of newSlides) {
    output.set(slide.part, Buffer.from(slide.xml, "utf8"));
    output.set(relsPartOf(slide.part), Buffer.from(slide.rels, "utf8"));
    for (const item of slide.media) {
      output.set(item.part, item.bytes);
      extensions.add(item.part.split(".").pop()!);
    }
  }
  const allParts = new Set([...output.keys()].filter((name) => !name.endsWith(".rels")));
  const contentTypes = rewriteContentTypes(decode(template.parts, CONTENT_TYPES)!, allParts, template.presentationPart, slideParts, extensions);

  const entries = [
    { name: CONTENT_TYPES, data: Buffer.from(contentTypes, "utf8") },
    { name: ROOT_RELS, data: template.parts.get(ROOT_RELS)! },
    ...[...output].map(([name, data]) => ({ name, data })),
  ];
  return { bytes: writeZip(entries), slides: built };
}
