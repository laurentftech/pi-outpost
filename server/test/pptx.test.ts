/**
 * PowerPoint extraction: what comes out of a presentation's own markup.
 *
 * The fixtures are built by `test/fixtures/make-pptx.mjs`, which writes the markup
 * by hand — a deck whose running order really disagrees with its file numbering, a
 * relationship target that really points out of the package, a table that really
 * declares three columns. Those are the things being asserted, so they have to be
 * the input under our control.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  PptxError,
  describeVisuals,
  extractPptx,
  parsePresentation,
  parseSlide,
  parseSlideRange,
  renderSlide,
} from "../src/pptx.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, `${name}.pptx`)));
}

/** The failure the call produced, or a message saying it produced none. */
async function failureOf(bytes: Uint8Array, options = {}): Promise<PptxError> {
  try {
    const result = await extractPptx(bytes, options);
    assert.fail(`expected a failure, got: ${result.markdown.slice(0, 120)}`);
  } catch (error) {
    assert.ok(error instanceof PptxError, `expected a PptxError, got ${String(error)}`);
    return error;
  }
}

describe("parsePresentation", () => {
  test("reads the slide list in declared order, not attribute order", () => {
    const slides = parsePresentation(
      `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>` +
        `<p:sldId id="258" r:id="rId7"/><p:sldId id="256" r:id="rId2"/>` +
        `</p:sldIdLst></p:presentation>`,
    );

    assert.deepEqual(
      slides.map((slide) => slide.relationshipId),
      ["rId7", "rId2"],
    );
  });

  test("never mistakes a slide id for a relationship id", () => {
    const slides = parsePresentation(
      `<p:presentation xmlns:p="p"><p:sldIdLst><p:sldId id="256"/></p:sldIdLst></p:presentation>`,
    );

    // "256" is the presentation-wide slide id; the relationship table cannot resolve it.
    assert.equal(slides[0].relationshipId, "");
    assert.equal(slides[0].id, "256");
  });

  test("ignores sldId elements outside the slide list", () => {
    const slides = parsePresentation(
      `<p:presentation xmlns:p="p" xmlns:r="r">` +
        `<p:sldMasterIdLst><p:sldMasterId r:id="rId1"/></p:sldMasterIdLst>` +
        `<p:sldIdLst><p:sldId id="256" r:id="rId4"/></p:sldIdLst></p:presentation>`,
    );

    assert.deepEqual(
      slides.map((slide) => slide.relationshipId),
      ["rId4"],
    );
  });
});

describe("parseSlide", () => {
  const wrap = (shapes: string) => `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;

  test("takes text only from a text body, not from shape metadata", () => {
    const content = parseSlide(
      wrap(
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Rectangle 4"/><p:nvPr/></p:nvSpPr>` +
          `<p:txBody><a:p><a:r><a:t>Real content</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
    );

    assert.deepEqual(content.blocks, [{ kind: "text", text: "Real content" }]);
  });

  test("names the declared title and keeps it in the body", () => {
    const content = parseSlide(
      wrap(
        `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
          `<p:txBody><a:p><a:r><a:t>Quarterly Report</a:t></a:r></a:p></p:txBody></p:sp>` +
          `<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>` +
          `<p:txBody><a:p><a:r><a:t>Revenue grew.</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
    );

    assert.equal(content.title, "Quarterly Report");
    assert.deepEqual(content.blocks, [
      { kind: "text", text: "Quarterly Report" },
      { kind: "text", text: "Revenue grew." },
    ]);
  });

  test("keeps an empty table cell so the row keeps its columns", () => {
    const content = parseSlide(
      wrap(
        `<p:graphicFrame><a:graphic><a:graphicData uri="table"><a:tbl>` +
          `<a:tr><a:tc><a:txBody><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc>` +
          `<a:tc/>` +
          `<a:tc><a:txBody><a:p><a:r><a:t>C</a:t></a:r></a:p></a:txBody></a:tc></a:tr>` +
          `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
      ),
    );

    assert.deepEqual(content.blocks, [{ kind: "table", rows: [["A", "", "C"]] }]);
  });

  test("counts the visual content it does not read", () => {
    const content = parseSlide(
      wrap(
        `<p:pic/><p:pic/>` +
          `<p:graphicFrame><a:graphic><a:graphicData uri="http://x/drawingml/2006/chart"/></a:graphic></p:graphicFrame>` +
          `<p:graphicFrame><a:graphic><a:graphicData uri="http://x/drawingml/2006/diagram"/></a:graphic></p:graphicFrame>`,
      ),
    );

    assert.deepEqual(content.blocks, []);
    assert.deepEqual(content.visuals, { images: 2, charts: 1, diagrams: 1, media: 0 });
    assert.equal(describeVisuals(content.visuals), "2 images, 1 chart and 1 diagram");
  });

  test("reads shapes nested inside a group", () => {
    const content = parseSlide(
      wrap(
        `<p:grpSp><p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr>` +
          `<p:txBody><a:p><a:r><a:t>Inside a group</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>`,
      ),
    );

    assert.deepEqual(content.blocks, [{ kind: "text", text: "Inside a group" }]);
  });
});

describe("renderSlide", () => {
  test("labels a slide with its number and declared title", () => {
    const markdown = renderSlide(7, {
      blocks: [{ kind: "text", text: "Body" }],
      title: "Outlook",
      visuals: { images: 0, charts: 0, diagrams: 0, media: 0 },
    });

    assert.match(markdown, /^## Slide 7 — Outlook$/m);
  });

  test("states that a visual-only slide has no text and names what it holds", () => {
    const markdown = renderSlide(2, {
      blocks: [],
      visuals: { images: 1, charts: 1, diagrams: 0, media: 0 },
    });

    assert.match(markdown, /no extractable text/);
    assert.match(markdown, /Not read: 1 image and 1 chart\./);
  });
});

describe("parseSlideRange", () => {
  test("parses single slides, ranges and lists, clamped to the deck", () => {
    assert.deepEqual(parseSlideRange("3", 10), [3]);
    assert.deepEqual(parseSlideRange("2-4", 10), [2, 3, 4]);
    assert.deepEqual(parseSlideRange("1,3-4", 10), [1, 3, 4]);
    assert.deepEqual(parseSlideRange("8-99", 10), [8, 9, 10]);
  });

  test("refuses a range that names no slide of this deck", () => {
    assert.throws(() => parseSlideRange("40-50", 10), /no slide of this 10-slide presentation/);
    assert.throws(() => parseSlideRange("last", 10), /is not a slide or a slide range/);
    assert.throws(() => parseSlideRange("4-2", 10), /is not a usable slide range/);
  });
});

describe("extractPptx", () => {
  test("returns slides in presentation order, not file order", async () => {
    const { markdown, slideCount, slides } = await extractPptx(await fixture("pptx-order"));

    assert.equal(slideCount, 3);
    assert.deepEqual(slides, [1, 2, 3]);
    const first = markdown.indexOf("Third in the file");
    const second = markdown.indexOf("First in the file");
    const third = markdown.indexOf("Second in the file");
    assert.ok(first < second && second < third, `presentation order not preserved:\n${markdown}`);
    // The heading numbers are the presenter's, so slide 1 is the one rId1 names.
    assert.match(markdown, /## Slide 1\n\nThird in the file/);
  });

  test("keeps text and a table in their declared order", async () => {
    const { markdown } = await extractPptx(await fixture("pptx-mixed"));

    const heading = markdown.indexOf("## Slide 1 — Sales by region");
    const intro = markdown.indexOf("The table below");
    const table = markdown.indexOf("| Region |");
    assert.ok(heading < intro && intro < table, `order not preserved:\n${markdown}`);
    assert.match(markdown, /\| --- \| --- \| --- \|/);
    assert.match(markdown, /\| North \| 1200 \| 48000 \|/);
    assert.match(markdown, /## Slide 2 — Outlook/);
  });

  test("a cell cannot break the table it sits in", async () => {
    const { markdown } = await extractPptx(await fixture("pptx-escapes"));

    for (const row of markdown.split("\n").filter((line) => line.startsWith("|"))) {
      assert.equal(row.split(" | ").length, 2, `every row keeps two columns: ${row}`);
    }
    assert.match(markdown, /a \\\| b/);
    assert.match(markdown, /back\\\\slash/);
  });

  test("reports a visual-only slide rather than returning nothing", async () => {
    const { markdown, pictures } = await extractPptx(await fixture("pptx-visual"));

    assert.match(markdown, /## Slide 1/);
    // The slide's picture is now named where it sits, which is what keeps this slide
    // from reading as empty — it used to say only "no extractable text" and count the
    // image among what it had not read. This fixture holds no media part for it, so
    // the marker says that rather than claiming bytes exist.
    assert.match(markdown, /\[picture 1: picture; the package does not hold the part it points at\]/);
    assert.equal(pictures.length, 1);
    assert.equal(pictures[0].bytes, undefined);
    // A chart is not a picture: it stays among what was not read, with no marker.
    assert.match(markdown, /Not read: 1 chart\./);
    assert.doesNotMatch(markdown, /1 image and 1 chart/);
  });

  test("returns only the slides a range names", async () => {
    const { markdown, slides } = await extractPptx(await fixture("pptx-long"), { slides: "3-5" });

    assert.deepEqual(slides, [3, 4, 5]);
    assert.match(markdown, /Slide number 3 of the long deck/);
    assert.match(markdown, /Slide number 5 of the long deck/);
    assert.doesNotMatch(markdown, /Slide number 2 of the long deck/);
    assert.doesNotMatch(markdown, /Slide number 6 of the long deck/);
  });

  test("truncates at the slide cap and names the range left", async () => {
    const { markdown, slides, nextSlide, slideCount } = await extractPptx(await fixture("pptx-long"));

    assert.equal(slideCount, 80);
    assert.equal(slides.length, 60);
    assert.equal(nextSlide, 61);
    assert.match(markdown, /Truncated: slides 1-60 of 80 shown/);
    assert.match(markdown, /slides="61-80"/);
  });

  test("truncates at the character cap too", async () => {
    const { slides, nextSlide } = await extractPptx(await fixture("pptx-long"), { maxChars: 200 });

    assert.ok(slides.length < 60, `expected the character cap to bite first, got ${slides.length} slides`);
    assert.equal(nextSlide, slides.length + 1);
  });

  test("full refuses a deck past the single-answer ceiling instead of cutting it", async () => {
    const failure = await failureOf(await fixture("pptx-long"), { full: true, maxChars: 200 });

    assert.equal(failure.reason, "too-large");
    assert.match(failure.message, /output_path/);
  });

  test("full returns every slide when the deck fits", async () => {
    const { slides, nextSlide } = await extractPptx(await fixture("pptx-long"), { full: true });

    assert.equal(slides.length, 80);
    assert.equal(nextSlide, undefined);
  });

  test("says so when the presentation declares no slides", async () => {
    const { markdown, slideCount } = await extractPptx(await fixture("pptx-no-slides"));

    assert.equal(slideCount, 0);
    assert.match(markdown, /declares no slides/);
  });

  test("refuses a relationship target that leaves the package", async () => {
    const failure = await failureOf(await fixture("pptx-escaping-rel"));

    assert.equal(failure.reason, "unreadable");
    assert.match(failure.message, /outside the presentation's own parts/);
  });

  test("reports a slide whose part is missing without losing the others", async () => {
    const { markdown, slides } = await extractPptx(await fixture("pptx-missing-part"));

    assert.deepEqual(slides, [1, 2]);
    assert.match(markdown, /Present/);
    assert.match(markdown, /## Slide 2\n\n_This slide's content is missing from the package\._/);
  });

  test("refuses a file that is not a presentation", async () => {
    assert.equal((await failureOf(await fixture("pptx-not-office"))).reason, "unreadable");
    assert.match((await failureOf(await fixture("pptx-not-office"))).message, /not an Office package/);
    assert.match((await failureOf(await fixture("pptx-no-presentation"))).message, /not a PowerPoint presentation/);
    assert.equal((await failureOf(await fixture("pptx-corrupt"))).reason, "unreadable");
  });

  test("names encryption rather than returning encrypted parts", async () => {
    const failure = await failureOf(await fixture("pptx-encrypted"));

    assert.equal(failure.reason, "encrypted");
    assert.match(failure.message, /password-protected/);
  });

  test("stops a compression bomb while it expands", async () => {
    const failure = await failureOf(await fixture("pptx-bomb"));

    assert.equal(failure.reason, "too-large");
  });

  // The fixtures above are ours, and every one of them declares its placeholders.
  // This one is a real export (`exemples/document_test_extraction.pptx`), whose
  // slides are plain text boxes with an empty `<p:nvPr/>` — the shape of file the
  // hand-written fixtures cannot produce.
  test("reads a real presentation whose slides are plain text boxes", async () => {
    const { markdown, slideCount, slides } = await extractPptx(await fixture("pptx-real-textboxes"), { full: true });

    assert.equal(slideCount, 3);
    assert.deepEqual(slides, [1, 2, 3]);
    assert.match(markdown, /Rapport d'Analyse du Marché 2026/);
    assert.match(markdown, /Croissance du chiffre d'affaires : \+14\.5% sur un an\./);

    // Reading order across slides, and the table on the last one
    assert.ok(
      markdown.indexOf("Indicateurs Clés") < markdown.indexOf("Répartition Budgétaire"),
      markdown,
    );
    assert.match(markdown, /\| Département \| Budget Alloué \(€\) \| Utilisation \(%\) \|/);
    assert.match(markdown, /\| Recherche & Développement \| 450,000 \| 78% \|/);

    // No placeholder is declared anywhere in this deck, so no title is invented
    // from position or font size — the heading stays the slide number alone.
    assert.match(markdown, /^## Slide 1$/m);
    assert.doesNotMatch(markdown, /## Slide \d+ —/);
  });

  test("refuses an archive with more entries than it will look at", async () => {
    const failure = await failureOf(await fixture("pptx-many-entries"));

    assert.equal(failure.reason, "too-large");
    assert.match(failure.message, /entries \(limit 2048\)/);
  });

  test("stops at the time budget", async () => {
    const failure = await failureOf(await fixture("pptx-long"), { timeoutMs: 0, full: true });

    assert.equal(failure.reason, "budget");
    assert.match(failure.message, /budget/);
  });
});

/**
 * Pictures on a slide.
 *
 * A deck's argument often lives in its pictures, so a slide that held one used to
 * read as a slide with nothing on it. The reading is tested through `parseSlide`
 * with a marker of the test's own, which keeps the cases that matter — a chart, a
 * blip the package cannot resolve — free of any package.
 */
describe("parseSlide and pictures", () => {
  function marking() {
    const seen: Array<{ relationshipId: string; alt?: string }> = [];
    return {
      seen,
      marker: (reference: { relationshipId: string; alt?: string }) => {
        seen.push(reference);
        return `[picture ${seen.length}]`;
      },
    };
  }
  const slide = (inner: string) => `<p:sld><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;
  const textShape = (text: string) =>
    `<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const picture = (rel: string, descr = "") =>
    `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 4"${descr}/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rel}"/></p:blipFill></p:pic>`;

  test("a picture is marked where the shape tree puts it", () => {
    const kit = marking();
    const content = parseSlide(slide(textShape("Title") + picture("rId2")), undefined, kit.marker);
    assert.deepEqual(content.blocks, [
      { kind: "text", text: "Title" },
      { kind: "picture", text: "[picture 1]" },
    ]);
    assert.deepEqual(kit.seen, [{ relationshipId: "rId2" }]);
  });

  test("alternative text comes from the shape's descr", () => {
    const kit = marking();
    parseSlide(slide(picture("rId3", ' descr="Revenue by region"')), undefined, kit.marker);
    assert.equal(kit.seen[0].alt, "Revenue by region");
  });

  test("a marked picture is no longer counted among what was not read", () => {
    const kit = marking();
    const content = parseSlide(slide(picture("rId2")), undefined, kit.marker);
    assert.equal(content.visuals.images, 0, "a slide must not both name a picture and call it unread");
    // Without a marker the old count stands, which is what the deck readers rely on.
    assert.equal(parseSlide(slide(picture("rId2"))).visuals.images, 1);
  });

  test("a chart is not a picture", () => {
    const kit = marking();
    const chart = `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`;
    const content = parseSlide(slide(chart), undefined, kit.marker);
    assert.deepEqual(kit.seen, [], "nothing to mark: a chart has no image part");
    assert.equal(content.visuals.charts, 1);
    assert.deepEqual(content.blocks, []);
  });

  test("a picture whose blip names nothing is still marked", () => {
    const kit = marking();
    const content = parseSlide(slide(`<p:pic><p:nvPicPr><p:cNvPr id="4"/></p:nvPicPr><p:blipFill/></p:pic>`), undefined, kit.marker);
    assert.deepEqual(kit.seen, [{ relationshipId: "" }], "the resolver decides what to say; silence is not an option");
    assert.deepEqual(content.blocks, [{ kind: "picture", text: "[picture 1]" }]);
  });
});
