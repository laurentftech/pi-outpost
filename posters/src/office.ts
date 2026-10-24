/**
 * A poster as a Word document (to print) or a PowerPoint deck (to show): the picture of
 * the page the editor drew, on an A4 or A3 page with Word's narrow margins, or centred on
 * one standard widescreen slide.
 *
 * A picture, not editable text: the layout the model wrote in HTML and CSS has no
 * faithful equivalent in Word or PowerPoint shapes, so texts are corrected in the poster
 * editor and the file exported again. The deck keeps PowerPoint's widescreen slide
 * whatever the poster's format, so its slide can join any deck she already has; the page
 * keeps Word's "Narrow" margins, inside what any printer can print. The deck is built on
 * pi-outpost's built-in Office theme.
 *
 * Isomorphic and dependency-free: the zip is written with stored entries (the picture is
 * already compressed, the XML a few kilobytes) and its own CRC-32, so the same code builds
 * the file in a browser — the Open WebUI embed, which cannot reach its server — and in Node.
 */
import { defaultTemplateParts } from "@pi-outpost/office/defaultTemplateParts.ts";
import type { PosterFormat } from "./format.ts";

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const EMU_PER_MM = 36_000;

export const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** The paper each format prints on in Word, in millimetres; a slide goes on A4 landscape. */
const WORD_PAPER: Record<PosterFormat, { w: number; h: number }> = {
  "A4-portrait": { w: 210, h: 297 },
  "A4-landscape": { w: 297, h: 210 },
  "A3-portrait": { w: 297, h: 420 },
  "A3-landscape": { w: 420, h: 297 },
  "slide-16:9": { w: 297, h: 210 },
};
/** PowerPoint's widescreen slide, 13.333 x 7.5 in: every deck, whatever the poster's format. */
const SLIDE_EMU = { cx: 12_192_000, cy: 6_858_000 };
/** Word's "Narrow" margins, 1.27 cm: inside the printable area of any printer. */
export const WORD_MARGIN_MM = 12.7;
/** Kept free under the picture, so a line's height never pushes it onto a second page. */
const WORD_SLACK_MM = 2;

export interface PosterPicture {
  png: Uint8Array;
  width: number;
  height: number;
}

/** The picture as large as fits in the box, its proportions kept, centred: offsets and extent in EMU. */
function fit(box: { cx: number; cy: number }, picture: { width: number; height: number }) {
  const scale = Math.min(box.cx / picture.width, box.cy / picture.height);
  const cx = Math.round(picture.width * scale);
  const cy = Math.round(picture.height * scale);
  return { cx, cy, x: Math.round((box.cx - cx) / 2), y: Math.round((box.cy - cy) / 2) };
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

/* ── A zip with stored entries ─────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Entry {
  name: string;
  data: Uint8Array | string;
}

/** 1980-01-01 00:00, the earliest DOS date: the same input always gives the same bytes. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** A zip of stored entries, names in UTF-8. Office reads stored entries as readily as deflated ones. */
export function storedZip(entries: Entry[]): Uint8Array {
  const encoder = new TextEncoder();
  const files = entries.map(({ name, data }) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    return { name: encoder.encode(name), bytes, crc: crc32(bytes) };
  });
  const localSize = files.reduce((sum, file) => sum + 30 + file.name.length + file.bytes.length, 0);
  const centralSize = files.reduce((sum, file) => sum + 46 + file.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const file of files) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true); // version needed
    view.setUint16(at + 6, 0x0800, true); // UTF-8 names
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, file.crc, true);
    view.setUint32(at + 18, file.bytes.length, true);
    view.setUint32(at + 22, file.bytes.length, true);
    view.setUint16(at + 26, file.name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(file.name, at + 30);
    out.set(file.bytes, at + 30 + file.name.length);
    at += 30 + file.name.length + file.bytes.length;
  }
  const centralStart = at;
  files.forEach((file, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // made by
    view.setUint16(at + 6, 20, true); // needed
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, 0, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, file.crc, true);
    view.setUint32(at + 20, file.bytes.length, true);
    view.setUint32(at + 24, file.bytes.length, true);
    view.setUint16(at + 28, file.name.length, true);
    // extra, comment, disk, internal attributes: zero; external attributes: zero.
    view.setUint32(at + 42, offsets[i]!, true);
    out.set(file.name, at + 46);
    at += 46 + file.name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, files.length, true);
  view.setUint16(at + 10, files.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}

/* ── Word ───────────────────────────────────────────────────────────────────── */

/** One page with narrow margins, the picture as large as fits inside them, inline and centred. */
export function posterDocx(title: string, format: PosterFormat, picture: PosterPicture): Uint8Array {
  const paper = WORD_PAPER[format];
  const box = fit(
    { cx: Math.round((paper.w - 2 * WORD_MARGIN_MM) * EMU_PER_MM), cy: Math.round((paper.h - 2 * WORD_MARGIN_MM - WORD_SLACK_MM) * EMU_PER_MM) },
    picture,
  );
  const twips = (mm: number) => Math.round((mm / 25.4) * 1440);
  const margin = twips(WORD_MARGIN_MM);
  const landscape = paper.w > paper.h ? ' w:orient="landscape"' : "";
  const name = escape(title);
  // Inline and centred: the most portable placement (an anchored picture moved in some
  // readers, one behind the text came out washed out).
  const document =
    `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${R}" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="${A}" xmlns:pic="${PIC}">` +
    `<w:body><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${box.cx}" cy="${box.cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="1" name="${name}" descr="${name}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="1" name="poster.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdPoster"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
    `<w:sectPr><w:pgSz w:w="${twips(paper.w)}" w:h="${twips(paper.h)}"${landscape}/>` +
    `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`;
  return storedZip([
    {
      name: "[Content_Types].xml",
      data:
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
    },
    { name: "_rels/.rels", data: `${XML}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", data: document },
    { name: "word/_rels/document.xml.rels", data: `${XML}<Relationships xmlns="${REL}"><Relationship Id="rIdPoster" Type="${R}/image" Target="media/poster.png"/></Relationships>` },
    { name: "word/media/poster.png", data: picture.png },
  ]);
}

/* ── PowerPoint ─────────────────────────────────────────────────────────────── */

/** One widescreen slide, the poster as large as fits and centred, on the built-in theme's blank layout. */
export function posterPptx(title: string, picture: PosterPicture): Uint8Array {
  const parts = new Map(defaultTemplateParts().map(({ name, text }) => [name, text] as const));
  const blank = [...parts].find(([name, text]) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name) && text.includes('type="blank"'))?.[0];
  if (!blank) throw new Error("the built-in theme has no blank layout");
  const box = fit(SLIDE_EMU, picture);
  const name = escape(title);
  const part = (key: string) => parts.get(key)!;

  parts.set(
    "[Content_Types].xml",
    part("[Content_Types].xml")
      .replace("presentationml.template.main+xml", "presentationml.presentation.main+xml")
      .replace(
        "</Types>",
        `<Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
      ),
  );
  parts.set(
    "ppt/presentation.xml",
    part("ppt/presentation.xml")
      .replace(/<p:sldIdLst\s*\/>|<p:sldIdLst>.*?<\/p:sldIdLst>/, `<p:sldIdLst><p:sldId id="256" r:id="rIdSlide1"/></p:sldIdLst>`)
      .replace(/<p:sldSz [^>]*\/>/, `<p:sldSz cx="${SLIDE_EMU.cx}" cy="${SLIDE_EMU.cy}"/>`),
  );
  parts.set(
    "ppt/_rels/presentation.xml.rels",
    part("ppt/_rels/presentation.xml.rels").replace("</Relationships>", `<Relationship Id="rIdSlide1" Type="${R}/slide" Target="slides/slide1.xml"/></Relationships>`),
  );
  parts.set(
    "ppt/slides/slide1.xml",
    `${XML}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
      `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${name}" descr="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdPoster"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
      `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  );
  parts.set(
    "ppt/slides/_rels/slide1.xml.rels",
    `${XML}<Relationships xmlns="${REL}"><Relationship Id="rIdLayout" Type="${R}/slideLayout" Target="../slideLayouts/${blank.split("/").pop()}"/>` +
      `<Relationship Id="rIdPoster" Type="${R}/image" Target="../media/poster.png"/></Relationships>`,
  );
  return storedZip([...[...parts].map(([entry, data]) => ({ name: entry, data })), { name: "ppt/media/poster.png", data: picture.png }]);
}

/** The file name an export takes: the poster's title, spaces kept, the extension added. */
export function exportFileName(title: string, kind: "docx" | "pptx"): string {
  // eslint-disable-next-line no-control-regex -- control characters cannot be in a file name
  const stem = title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "Poster";
  return `${stem}.${kind}`;
}
