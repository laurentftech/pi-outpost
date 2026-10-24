/**
 * The Word and PowerPoint packages, reread with the repository's own zip reader: page
 * size, margins, slide size and where the picture sits, for every format.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import zlib from "node:zlib";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";
import { FORMAT_NAMES, FORMATS } from "../src/format.ts";
import { crc32, exportFileName, posterDocx, posterPptx, storedZip } from "../src/office.ts";

const LIMITS = { maxEntries: 100, maxInflatedBytes: 50_000_000, maxTotalBytes: 100_000_000 };
const EMU_PER_MM = 36_000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function read(bytes: Uint8Array) {
  return readAllZipEntries(Buffer.from(bytes), LIMITS);
}

function attr(xml: string, element: string, name: string): number {
  const found = new RegExp(`<${element}\\b[^>]*\\b${name}="(\\d+)"`).exec(xml);
  assert.ok(found, `${element} ${name} in ${xml.slice(0, 200)}`);
  return Number(found[1]);
}

test("crc32 agrees with zlib's", () => {
  for (const sample of ["", "a", "The ball is on the box. 🎉", "x".repeat(100_000)]) {
    const bytes = new TextEncoder().encode(sample);
    assert.equal(crc32(bytes), zlib.crc32(bytes));
  }
});

test("storedZip writes entries the repository's zip reader gives back byte for byte", () => {
  const entries = read(storedZip([{ name: "a.txt", data: "hello" }, { name: "dossier/é.bin", data: PNG }]));
  assert.equal(entries.get("a.txt")!.toString("utf8"), "hello");
  assert.deepEqual(new Uint8Array(entries.get("dossier/é.bin")!), PNG);
});

/** The page's text area in EMU: the paper less the narrow margins and the slack under the picture. */
function textArea(paper: { w: number; h: number }) {
  return { cx: (paper.w - 2 * 12.7) * EMU_PER_MM, cy: (paper.h - 2 * 12.7 - 2) * EMU_PER_MM };
}

const PAPER: Record<string, { w: number; h: number; landscape: boolean }> = {
  "A4-portrait": { w: 210, h: 297, landscape: false },
  "A4-landscape": { w: 297, h: 210, landscape: true },
  "A3-portrait": { w: 297, h: 420, landscape: false },
  "A3-landscape": { w: 420, h: 297, landscape: true },
  "slide-16:9": { w: 297, h: 210, landscape: true },
};

// openlore: scenario=AnA4PosterPrintsOnOneA4Page spec=poster-documents
// openlore: scenario=ASlideGoesOnALandscapePage spec=poster-documents
test("ExportToWord: one page of the format's paper, narrow margins, the picture fitted inside them and centred", () => {
  for (const format of FORMAT_NAMES) {
    const { width, height } = FORMATS[format];
    const picture = { png: PNG, width: width * 3, height: height * 3 };
    const entries = read(posterDocx("Class rules", format, picture));
    const document = entries.get("word/document.xml")!.toString("utf8");
    const paper = PAPER[format]!;
    const twips = (mm: number) => Math.round((mm / 25.4) * 1440);
    assert.equal(attr(document, "w:pgSz", "w:w"), twips(paper.w), format);
    assert.equal(attr(document, "w:pgSz", "w:h"), twips(paper.h), format);
    assert.equal(/w:orient="landscape"/.test(document), paper.landscape, format);
    for (const side of ["top", "right", "bottom", "left"]) assert.equal(attr(document, "w:pgMar", `w:${side}`), twips(12.7), `${format} ${side}`);
    // One picture, inline (it flows with the text, so it cannot leave the page), centred.
    assert.match(document, /<wp:inline\b/);
    assert.doesNotMatch(document, /<wp:anchor\b/);
    assert.match(document, /<w:jc w:val="center"\/>/);
    const cx = attr(document, "wp:extent", "cx");
    const cy = attr(document, "wp:extent", "cy");
    const area = textArea(paper);
    assert.ok(cx <= area.cx + 1 && cy <= area.cy + 1, `${format}: ${cx}x${cy} within ${area.cx}x${area.cy}`);
    assert.ok(Math.abs(cx / cy - width / height) < 0.002, `${format}: proportions kept`);
    assert.ok(Math.abs(cx - area.cx) < 2 || Math.abs(cy - area.cy) < 2, `${format}: as large as fits`);
    assert.deepEqual(new Uint8Array(entries.get("word/media/poster.png")!), PNG);
    assert.match(entries.get("[Content_Types].xml")!.toString("utf8"), /wordprocessingml\.document\.main\+xml/);
  }
});

// openlore: scenario=APortraitPosterOnAWidescreenSlide spec=poster-documents
test("ExportToPowerPoint: one standard 16:9 slide whatever the format, the picture as large as fits and centred", () => {
  for (const format of FORMAT_NAMES) {
    const { width, height } = FORMATS[format];
    const entries = read(posterPptx("Class rules", { png: PNG, width: width * 3, height: height * 3 }));
    const presentation = entries.get("ppt/presentation.xml")!.toString("utf8");
    assert.equal(attr(presentation, "p:sldSz", "cx"), 12_192_000, format);
    assert.equal(attr(presentation, "p:sldSz", "cy"), 6_858_000, format);
    assert.equal([...presentation.matchAll(/<p:sldId\b/g)].length, 1);
    const slide = entries.get("ppt/slides/slide1.xml")!.toString("utf8");
    const x = attr(slide, "a:off", "x");
    const y = attr(slide, "a:off", "y");
    const cx = attr(slide, "a:ext", "cx");
    const cy = attr(slide, "a:ext", "cy");
    assert.ok(Math.abs(x * 2 + cx - 12_192_000) <= 2 && Math.abs(y * 2 + cy - 6_858_000) <= 2, `${format}: centred`);
    assert.ok(cx <= 12_192_000 && cy <= 6_858_000, `${format}: inside the slide`);
    assert.ok(cx === 12_192_000 || cy === 6_858_000 || Math.abs(cy - 6_858_000) <= 1 || Math.abs(cx - 12_192_000) <= 1, `${format}: as large as fits`);
    assert.ok(Math.abs(cx / cy - width / height) < 0.002, `${format}: proportions kept`);
    const types = entries.get("[Content_Types].xml")!.toString("utf8");
    assert.match(types, /presentationml\.presentation\.main\+xml/);
    assert.doesNotMatch(types, /template\.main/);
    assert.match(entries.get("ppt/slides/_rels/slide1.xml.rels")!.toString("utf8"), /slideLayouts\/slideLayout\d+\.xml/);
  }
});

test("A portrait poster fills the slide's height; a slide-format poster fills the whole slide", () => {
  const portrait = read(posterPptx("T", { png: PNG, width: 2481, height: 3509 })).get("ppt/slides/slide1.xml")!.toString("utf8");
  assert.equal(attr(portrait, "a:ext", "cy"), 6_858_000);
  const wide = read(posterPptx("T", { png: PNG, width: 2560, height: 1440 })).get("ppt/slides/slide1.xml")!.toString("utf8");
  assert.equal(attr(wide, "a:ext", "cx"), 12_192_000);
  assert.equal(attr(wide, "a:off", "x"), 0);
});

test("Titles are escaped in the packages", () => {
  const slide = read(posterPptx('Rules & "tips" <1>', { png: PNG, width: 10, height: 10 })).get("ppt/slides/slide1.xml")!.toString("utf8");
  assert.match(slide, /name="Rules &amp; &quot;tips&quot; &lt;1&gt;"/);
});

test("exportFileName keeps spaces and drops what no file name may hold", () => {
  assert.equal(exportFileName("Prepositions of Place", "docx"), "Prepositions of Place.docx");
  assert.equal(exportFileName('a/b:c*"d"', "pptx"), "a b c d.pptx");
  assert.equal(exportFileName("   ", "docx"), "Poster.docx");
});
