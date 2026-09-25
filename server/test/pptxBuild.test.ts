/**
 * Building a deck from a template: the package it produces, and where the content
 * lands in it.
 *
 * The template is `fixtures/pptx-template.potx`, written by `make-pptx-template.mjs`:
 * seven layouts (one whose placeholders state no position of their own), and one
 * sample slide that alone reaches a notes slide and a picture, named by a custom show
 * and a section. Those are the things the builder must carry over or sweep away.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { readImageInfo } from "../src/imageInfo.ts";
import { extractPptx } from "../src/pptx.ts";
import {
  buildPresentation,
  bulletLevel,
  describeTemplate,
  escapeXml,
  fitInside,
  MAX_SLIDES,
  PptxBuildError,
  readTemplate,
  type SlideSpec,
  type Template,
} from "../src/pptxBuild.ts";
import { readAllZipEntries } from "../src/zip.ts";
import { writeZip } from "../src/zipWriter.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const LIMITS = { maxEntries: 4096, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 };
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#2563EB"/></svg>');
const svgImage = { name: "diagram.svg", bytes: SVG, info: readImageInfo(SVG, "diagram.svg"), alt: "A diagram" };

let templateBytes: Buffer;
let template: Template;

before(async () => {
  templateBytes = await readFile(path.join(FIXTURES, "pptx-template.potx"));
  template = readTemplate(templateBytes);
});

async function build(slides: SlideSpec[], rasterize: (svg: Buffer, w: number, h: number) => Promise<Buffer | null> = async () => null) {
  const built = await buildPresentation(template, slides, { rasterizeSvg: rasterize });
  return { built, parts: readAllZipEntries(built.bytes, LIMITS) };
}

const text = (parts: Map<string, Buffer>, name: string) => parts.get(name)?.toString("utf8") ?? "";

/**
 * The package-level promises a reader like PowerPoint enforces: every relationship
 * resolves to a part that exists, every part has a content type, and no part or
 * extension is declared twice — part names compare without case, and a duplicate is a
 * package PowerPoint only opens after offering to repair it.
 */
function assertIntact(parts: Map<string, Buffer>): void {
  const types = text(parts, "[Content_Types].xml");
  for (const declared of [/PartName="([^"]+)"/g, /Extension="([^"]+)"/g]) {
    const names = [...types.matchAll(declared)].map((match) => match[1].toLowerCase());
    assert.deepEqual(names.filter((name, index) => names.indexOf(name) !== index), [], "declared twice in [Content_Types].xml");
  }
  const overrides = new Set([...types.matchAll(/PartName="\/([^"]+)"/g)].map((match) => match[1]));
  const defaults = new Set([...types.matchAll(/Extension="([^"]+)"/g)].map((match) => match[1].toLowerCase()));
  for (const name of parts.keys()) {
    if (name === "[Content_Types].xml") continue;
    assert.ok(overrides.has(name) || defaults.has(name.split(".").pop()!.toLowerCase()), `no content type for ${name}`);
  }
  for (const override of overrides) assert.ok(parts.has(override), `content type for a missing part: ${override}`);
  for (const [name, data] of parts) {
    if (!name.endsWith(".rels")) continue;
    // `_rels/.rels` belongs to the package root; `dir/_rels/part.rels` to `dir/part`.
    const owner = name === "_rels/.rels" ? "" : name.replace(/_rels\/([^/]+)\.rels$/, "$1");
    const base = owner.includes("/") ? owner.slice(0, owner.lastIndexOf("/")) : "";
    for (const match of data.toString("utf8").matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*\/>/g)) {
      if (/TargetMode="External"/.test(match[0])) continue;
      const segments: string[] = [];
      for (const segment of `${base}/${match[1]}`.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") segments.pop();
        else segments.push(segment);
      }
      assert.ok(parts.has(segments.join("/")), `${name} points at missing ${segments.join("/")}`);
    }
  }
}

describe("readTemplate", () => {
  test("lists the layouts in the master's order, with their names, types and placeholders", () => {
    assert.deepEqual(
      template.layouts.map((layout) => [layout.name, layout.type]),
      [
        ["Title Slide", "title"],
        ["Title and Content", "obj"],
        ["Two Content", "twoObj"],
        ["Picture with Caption", "picTx"],
        ["Section Header", "secHead"],
        ["Title Only", "titleOnly"],
        ["Blank", "blank"],
      ],
    );
    assert.deepEqual(template.slideSize, { cx: 12192000, cy: 6858000 });
    assert.equal(template.existingSlides, 1);
  });

  test("gives a placeholder that states no position its master's", () => {
    const content = template.layouts[1].placeholders;
    // The layout's title and content carry an empty spPr; the master's title and body do not.
    assert.deepEqual(content.find((placeholder) => placeholder.type === "title")?.box, { x: 838200, y: 365125, cx: 10515600, cy: 1325563 });
    assert.deepEqual(content.find((placeholder) => placeholder.type === "obj")?.box, { x: 838200, y: 1825625, cx: 10515600, cy: 4351338 });
    // One that does state its own keeps it.
    assert.equal(template.layouts[2].placeholders.find((placeholder) => placeholder.idx === "2")?.box?.x, 6172200);
  });

  test("describes the template for the model as a table of layouts", () => {
    const description = describeTemplate(template);
    assert.match(description, /13\.33" × 7\.5" \(widescreen\)/);
    assert.match(description, /holds 1 slide\(s\) of its own; pptx_create leaves them out/);
    assert.match(description, /\| 3 \| Two Content \| twoObj \| title, content, content \|/);
    assert.match(description, /\| 4 \| Picture with Caption \| picTx \| title, picture, text \|/);
    assert.match(description, /\| 7 \| Blank \| blank \| no content placeholders \(blank\) \|/);
  });

  test("escapes a layout name in the table, backslashes first", () => {
    const named = { ...template, layouts: [{ ...template.layouts[0], name: "Split | half \\ path" }] };
    assert.match(describeTemplate(named), /\| 1 \| Split \\\| half \\\\ path \| title \|/);
  });

  test("refuses what is not a usable template, saying why", async () => {
    assert.throws(() => readTemplate(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), /password-protected or a legacy \.ppt/);
    assert.throws(() => readTemplate(Buffer.from("not a zip at all, just some text")), /cannot be read/);
    const wordDocument = await readFile(path.join(FIXTURES, "docx-text.docx"));
    assert.throws(() => readTemplate(wordDocument), /not a PowerPoint presentation or template|no main part/);

    const parts = readAllZipEntries(templateBytes, LIMITS);
    const macro = new Map(parts);
    macro.set("[Content_Types].xml", Buffer.from(text(parts, "[Content_Types].xml").replace("presentationml.template.main+xml", "x").replace(
      'ContentType="application/vnd.openxmlformats-officedocument.x"',
      'ContentType="application/vnd.ms-powerpoint.template.macroEnabled.main+xml"',
    )));
    const pack = (map: Map<string, Buffer>) => writeZip([...map].map(([name, data]) => ({ name, data })));
    assert.throws(() => readTemplate(pack(macro)), /macro-enabled/);

    const doctype = new Map(parts);
    doctype.set("ppt/presentation.xml", Buffer.from(`<!DOCTYPE x [<!ENTITY a "b">]>${text(parts, "ppt/presentation.xml")}`));
    assert.throws(() => readTemplate(pack(doctype)), /damaged: .*DOCTYPE/);
  });
});

describe("buildPresentation — the package", () => {
  test("is a presentation, not a template, and every relationship resolves", async () => {
    const { parts } = await build([{ title: "One" }, { title: "Two", bullets: ["a"] }]);
    assertIntact(parts);
    const types = text(parts, "[Content_Types].xml");
    assert.match(types, /PartName="\/ppt\/presentation.xml" ContentType="application\/vnd.openxmlformats-officedocument.presentationml.presentation.main\+xml"/);
    assert.doesNotMatch(types, /template\.main/);
  });

  test("declares once a part whose name the template's sample already used", async () => {
    // Built on a deck that already holds slides, charts and workbooks: the new parts
    // take the same names as the sample ones they replace.
    const { built: first } = await build([
      { title: "Chart", chart: { type: "column", categories: ["a"], series: [{ name: "S", values: [1] }] } },
      { title: "Table", table: { rows: [["x"]] } },
    ]);
    const built = await buildPresentation(readTemplate(first.bytes), [
      { title: "Again", chart: { type: "pie", categories: ["a"], series: [{ name: "S", values: [1] }] } },
      { title: "Two" },
    ]);
    const parts = readAllZipEntries(built.bytes, LIMITS);
    assertIntact(parts);
    const types = text(parts, "[Content_Types].xml");
    assert.equal(types.match(/PartName="\/ppt\/slides\/slide1\.xml"/g)?.length, 1);
    assert.equal(types.match(/PartName="\/ppt\/charts\/chart1\.xml"/g)?.length, 1);
  });

  test("holds exactly the new slides, in order, with fresh ids", async () => {
    const { parts } = await build([{ title: "First" }, { title: "Second", bullets: ["b"] }, { title: "Third", bullets: ["c"] }]);
    const presentation = text(parts, "ppt/presentation.xml");
    const ids = [...presentation.matchAll(/<p:sldId id="(\d+)" r:id="(rId\d+)"\/>/g)];
    assert.deepEqual(ids.map((match) => match[1]), ["256", "257", "258"]);
    const rels = text(parts, "ppt/_rels/presentation.xml.rels");
    const targets = ids.map((match) => new RegExp(`Id="${match[2]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]);
    assert.deepEqual(targets, ["slides/slide1.xml", "slides/slide2.xml", "slides/slide3.xml"]);
    // Slide list sits between the masters and the slide size, as the schema orders it.
    assert.ok(presentation.indexOf("</p:sldMasterIdLst>") < presentation.indexOf("<p:sldIdLst>"));
    assert.ok(presentation.indexOf("</p:sldIdLst>") < presentation.indexOf("<p:sldSz"));
  });

  test("sweeps the template's sample slide and everything only it reached", async () => {
    const { parts } = await build([{ title: "Only slide" }]);
    // The new slide1 replaces the sample; its notes and picture have no one left.
    assert.doesNotMatch(text(parts, "ppt/slides/slide1.xml"), /Sample slide the template ships with/);
    assert.ok(!parts.has("ppt/notesSlides/notesSlide1.xml"));
    assert.ok(!parts.has("ppt/notesSlides/_rels/notesSlide1.xml.rels"));
    assert.ok(!parts.has("ppt/media/sample-logo.png"));
    assert.doesNotMatch(text(parts, "[Content_Types].xml"), /notesSlide1/);
    // What the design needs stays: masters, every layout, the theme, the document properties.
    for (const part of ["ppt/slideMasters/slideMaster1.xml", "ppt/theme/theme1.xml", "docProps/core.xml"]) assert.ok(parts.has(part), part);
    for (let i = 1; i <= 7; i++) assert.ok(parts.has(`ppt/slideLayouts/slideLayout${i}.xml`));
  });

  test("drops the custom show and section list that named the sample, and keeps other extensions", async () => {
    const { parts } = await build([{ title: "x" }]);
    const presentation = text(parts, "ppt/presentation.xml");
    assert.doesNotMatch(presentation, /custShow/);
    assert.doesNotMatch(presentation, /sectionLst/);
    assert.match(presentation, /sldGuideLst/);
  });

  test("the result reads back through the extractor, slide by slide", async () => {
    const { built } = await build([
      { title: "Cover", subtitle: "Sub" },
      { title: "Agenda", bullets: ["Why", "  Detail", "How"] },
    ]);
    const extraction = await extractPptx(built.bytes, { full: true });
    assert.equal(extraction.slideCount, 2);
    assert.match(extraction.markdown, /## Slide 1 — Cover[\s\S]*Sub/);
    assert.match(extraction.markdown, /## Slide 2 — Agenda[\s\S]*Why\nDetail\nHow/);
  });
});

describe("buildPresentation — placeholders", () => {
  test("writes into the layout's placeholders by type and index, so the template styles them", async () => {
    const { parts } = await build([{ layout: "Title and Content", title: "Agenda", bullets: ["One"] }]);
    const slide = text(parts, "ppt/slides/slide1.xml");
    assert.match(slide, /<p:ph type="title"\/>[\s\S]*Agenda/);
    // The layout's content placeholder states no type (obj) and idx 1: so must the slide's.
    assert.match(slide, /<p:ph idx="1"\/>[\s\S]*One/);
    // No position of its own: it inherits the layout's.
    assert.match(slide, /<p:ph idx="1"\/><\/p:nvPr><\/p:nvSpPr><p:spPr><\/p:spPr>/);
    assert.match(text(parts, "ppt/slides/_rels/slide1.xml.rels"), /slideLayout" Target="..\/slideLayouts\/slideLayout2.xml"/);
  });

  test("nests bullets by indentation and never doubles a bullet glyph", async () => {
    const { parts } = await build([{ title: "t", bullets: ["Top", "  Second", "    Third", "\tTabbed", "• Typed glyph", "- Dashed"] }]);
    const paragraphs = [...text(parts, "ppt/slides/slide1.xml").matchAll(/<a:p>(<a:pPr lvl="(\d)"\/>)?<a:r>[^]*?<a:t>([^<]*)<\/a:t>/g)];
    assert.deepEqual(
      paragraphs.slice(1).map((match) => [match[2] ?? "0", match[3]]),
      [["0", "Top"], ["1", "Second"], ["2", "Third"], ["1", "Tabbed"], ["0", "Typed glyph"], ["0", "Dashed"]],
    );
    assert.deepEqual(bulletLevel("-5% margin"), { level: 0, text: "-5% margin" });
  });

  test("makes **text** bold and escapes everything else", async () => {
    const { parts } = await build([{ title: "A < B & C", bullets: ["**Owner:** Ana \"R\" & co"] }]);
    const slide = text(parts, "ppt/slides/slide1.xml");
    assert.match(slide, /<a:t>A &lt; B &amp; C<\/a:t>/);
    assert.match(slide, /<a:rPr lang="en-US" dirty="0" b="1"\/><a:t>Owner:<\/a:t><\/a:r><a:r><a:rPr lang="en-US" dirty="0"\/><a:t> Ana &quot;R&quot; &amp; co<\/a:t>/);
    assert.equal(escapeXml("bell\u0007 and \uD800 lone"), "bell and  lone");
  });

  test("breaks a title across lines at its newlines", async () => {
    const { parts } = await build([{ title: "Line one\nLine two" }]);
    assert.match(text(parts, "ppt/slides/slide1.xml"), /Line one<\/a:t><\/a:r><a:br>.*?<\/a:br><a:r>.*?Line two/);
  });

  test("says what a layout could not hold instead of dropping it silently", async () => {
    const { built } = await build([
      { layout: "Blank", title: "Lost title", bullets: ["Lost"] },
      { layout: "Title Only", title: "Kept", subtitle: "Lost sub" },
    ]);
    assert.match(built.slides[0].warnings.join(" "), /no title placeholder; the title was left out/);
    assert.match(built.slides[0].warnings.join(" "), /no text or content placeholder; the bullets were left out/);
    assert.match(built.slides[1].warnings.join(" "), /no subtitle placeholder/);
  });
});

describe("buildPresentation — choosing layouts", () => {
  test("picks by what the slide holds when no layout is named", async () => {
    const png = { name: "p.png", bytes: SVG, info: { kind: "png" as const, width: 4, height: 3 } };
    const { built } = await build([
      { title: "Cover", subtitle: "Sub" },
      { title: "Bullets", bullets: ["a"] },
      { title: "Both", bullets: ["a"], image: png },
      { title: "Section", subtitle: "Part two" },
      { title: "Just a title" },
      { title: "Picture", image: png },
    ]);
    assert.deepEqual(
      built.slides.map((slide) => slide.layout),
      ["Title Slide", "Title and Content", "Two Content", "Section Header", "Title Only", "Title and Content"],
    );
  });

  test("takes a named layout, case-insensitively or by its number", async () => {
    const { built } = await build([{ layout: "section header", title: "a" }, { layout: "3", title: "b" }, { layout: "Layout 7" }]);
    assert.deepEqual(built.slides.map((slide) => slide.layout), ["Section Header", "Two Content", "Blank"]);
  });

  test("refuses an unknown layout and lists the ones there are", async () => {
    await assert.rejects(
      () => build([{ layout: "Agenda", title: "x" }]),
      (error: unknown) =>
        error instanceof PptxBuildError && /no layout named "Agenda"/.test(error.message) && /"Title Slide", "Title and Content"/.test(error.message),
    );
  });

  test("refuses an empty deck and one past the slide limit", async () => {
    await assert.rejects(() => build([]), /at least one slide/);
    await assert.rejects(() => build(Array.from({ length: MAX_SLIDES + 1 }, () => ({ title: "x" }))), /at most 300 slides/);
  });
});

describe("buildPresentation — pictures", () => {
  test("fits a picture inside its box without stretching it, centred", () => {
    const box = fitInside({ x: 0, y: 0, cx: 1000, cy: 1000 }, 400, 200);
    assert.deepEqual(box, { x: 0, y: 250, cx: 1000, cy: 500 });
  });

  test("puts a picture in the layout's picture placeholder when it has one", async () => {
    const { parts } = await build([{ layout: "Picture with Caption", title: "Pic", image: svgImage }]);
    const slide = text(parts, "ppt/slides/slide1.xml");
    // The placeholder is 6172200 × 4873625 at (5183188, 987425); a 2:1 picture fills its
    // width and is centred in its height: 987425 + (4873625 − 3086100) / 2.
    assert.match(slide, /<a:off x="5183188" y="1881188"\/><a:ext cx="6172200" cy="3086100"\/>/);
    assert.match(slide, /descr="A diagram"/);
  });

  test("gives text and picture a side each when they share one content placeholder", async () => {
    const png = { name: "p.png", bytes: SVG, info: { kind: "png" as const, width: 1, height: 1 } };
    const { parts } = await build([{ layout: "Title and Content", title: "Both", bullets: ["Left"], image: png }]);
    const slide = text(parts, "ppt/slides/slide1.xml");
    // The first transform on a slide is its shape tree's own; the text's and the picture's follow.
    const [, textOff, pictureOff] = [...slide.matchAll(/<a:off x="(\d+)"/g)].map((match) => Number(match[1]));
    assert.equal(textOff, 838200);
    assert.ok(pictureOff > textOff + 10515600 / 2, "the picture is on the right half");
  });

  test("embeds an SVG for PowerPoint with a raster fallback beside it", async () => {
    const fallback = Buffer.from("fallback-png");
    const { parts, built } = await build([{ title: "Vector", image: svgImage }], async (_svg, width, height) => {
      assert.ok(width > 0 && height > 0 && Math.abs(width / height - 2) < 0.02, "rasterised at the picture's proportions");
      return fallback;
    });
    const slide = text(parts, "ppt/slides/slide1.xml");
    assert.match(slide, /<a:blip r:embed="rId2"><a:extLst><a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}"><asvg:svgBlip xmlns:asvg="http:\/\/schemas.microsoft.com\/office\/drawing\/2016\/SVG\/main" r:embed="rId3"\/>/);
    const rels = text(parts, "ppt/slides/_rels/slide1.xml.rels");
    const target = (id: string) => new RegExp(`Id="${id}"[^>]*Target="\\.\\./([^"]+)"`).exec(rels)![1];
    assert.ok(parts.get(`ppt/${target("rId2")}`)!.equals(fallback));
    assert.ok(parts.get(`ppt/${target("rId3")}`)!.equals(SVG));
    assert.match(text(parts, "[Content_Types].xml"), /Extension="svg" ContentType="image\/svg\+xml"/);
    assert.deepEqual(built.slides[0].warnings, []);
    assertIntact(parts);
  });

  test("says so when no rasteriser can draw the SVG's fallback", async () => {
    const { parts, built } = await build([{ title: "Vector", image: svgImage }], async () => null);
    assert.match(built.slides[0].warnings.join(" "), /empty fallback picture: PowerPoint 2016 and later show the SVG/);
    const png = [...parts].find(([name]) => name.endsWith("-fallback.png"))![1];
    assert.ok(png.subarray(1, 4).toString() === "PNG");
  });
});

describe("buildPresentation — tables and charts", () => {
  const chart = {
    type: "column" as const,
    title: "Revenue",
    categories: ["Q1", "Q2"],
    series: [{ name: "2026", values: [2, 2.4] }],
  };

  test("a table goes where a picture would, as a native table the extractor reads back", async () => {
    const { parts, built } = await build([{ title: "Results", table: { rows: [["Region", "Revenue"], ["EMEA", "4.2"]] } }]);
    assert.equal(built.slides[0].layout, "Title and Content");
    const slide = text(parts, "ppt/slides/slide1.xml");
    // Inside the content placeholder's box: its left edge and its width.
    assert.match(slide, /<p:xfrm><a:off x="838200" y="1825625"\/><a:ext cx="10515600" cy="\d+"\/><\/p:xfrm><a:graphic><a:graphicData uri="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/table">/);
    assertIntact(parts);
    const markdown = (await extractPptx(built.bytes)).markdown;
    assert.match(markdown, /\| Region \| Revenue \|/);
    assert.match(markdown, /\| EMEA \| 4\.2 \|/);
  });

  test("a chart is a chart part with its workbook, related from the slide and declared in the package", async () => {
    const { parts } = await build([{ title: "Revenue", chart }, { title: "Again", chart: { ...chart, type: "pie" as const } }]);
    assertIntact(parts);
    const types = text(parts, "[Content_Types].xml");
    for (const n of [1, 2]) {
      assert.ok(parts.has(`ppt/charts/chart${n}.xml`), `chart ${n}`);
      assert.match(types, new RegExp(`PartName="/ppt/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart\\+xml"`));
      assert.match(
        text(parts, `ppt/charts/_rels/chart${n}.xml.rels`),
        new RegExp(`Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/Microsoft_Excel_Sheet${n}.xlsx"`),
      );
      assert.equal(parts.get(`ppt/embeddings/Microsoft_Excel_Sheet${n}.xlsx`)!.subarray(0, 2).toString("latin1"), "PK");
    }
    assert.match(types, /Extension="xlsx" ContentType="application\/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/);
    const rels = text(parts, "ppt/slides/_rels/slide1.xml.rels");
    const id = /Id="(rId\d+)" Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/chart" Target="..\/charts\/chart1.xml"/.exec(rels)![1];
    assert.match(text(parts, "ppt/slides/slide1.xml"), new RegExp(`<c:chart xmlns:c="[^"]+" r:id="${id}"/>`));
  });

  test("a chart never takes the name of one the template keeps", async () => {
    // A layout that carries a chart of its own: it survives the sweep, so its name is taken.
    const parts = readAllZipEntries(templateBytes, LIMITS);
    parts.set("ppt/charts/chart1.xml", Buffer.from("<c:chartSpace/>"));
    parts.set("ppt/embeddings/Microsoft_Excel_Sheet2.xlsx", Buffer.from("PK"));
    parts.set(
      "ppt/slideLayouts/_rels/slideLayout7.xml.rels",
      Buffer.from(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>` +
          `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/Microsoft_Excel_Sheet2.xlsx"/></Relationships>`,
      ),
    );
    const withChart = readTemplate(writeZip([...parts].map(([name, data]) => ({ name, data }))));
    const built = await buildPresentation(withChart, [{ title: "x", chart }]);
    const out = readAllZipEntries(built.bytes, LIMITS);
    assert.equal(out.get("ppt/charts/chart1.xml")!.toString(), "<c:chartSpace/>", "the template's chart is untouched");
    assert.ok(out.has("ppt/charts/chart3.xml"), "the new chart skips both numbers in use");
    assert.ok(out.has("ppt/embeddings/Microsoft_Excel_Sheet3.xlsx"));
  });

  test("bullets and a chart share a slide, each in its own content placeholder", async () => {
    const { built, parts } = await build([{ title: "Both", bullets: ["Point"], chart }]);
    assert.equal(built.slides[0].layout, "Two Content");
    assert.match(text(parts, "ppt/slides/slide1.xml"), /<a:off x="6172200" y="1825625"\/><a:ext cx="5181600" cy="4351338"\/><\/p:xfrm><a:graphic><a:graphicData uri="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/chart">/);
  });

  test("a chart or table never goes into a picture placeholder", async () => {
    const { parts } = await build([{ layout: "Picture with Caption", title: "x", table: { rows: [["a"]] } }]);
    assert.doesNotMatch(text(parts, "ppt/slides/slide1.xml"), /<a:off x="5183188" y="987425"\/>/);
  });

  test("one picture, table or chart per slide", async () => {
    await assert.rejects(
      () => build([{ title: "x", table: { rows: [["a"]] }, chart }]),
      /slide 1: a slide holds one picture, table or chart — put the others on slides of their own/,
    );
    await assert.rejects(() => build([{ title: "x" }, { title: "y", chart: { ...chart, categories: [] } }]), /slide 2: the chart has no categories/);
    await assert.rejects(() => build([{ title: "x", table: { rows: [["a", "b"], ["c"]] } }]), /slide 1: table row 2 has 1 cells/);
  });
});
