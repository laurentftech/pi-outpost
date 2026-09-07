/**
 * PDF extraction: what comes out of a document's text layer, and what is said
 * when nothing can.
 *
 * The fixtures are built by `test/fixtures/make-pdfs.mjs`, which places every
 * string at a known coordinate — table reconstruction reads geometry, so the
 * geometry has to be the input under our control.
 */
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { promisify } from "node:util";
import {
  buildLines,
  collectShapes,
  DEFAULT_TIMEOUT_MS,
  detectTableBlocks,
  type DrawnShape,
  extractPdf,
  FallbackDOMMatrix,
  lineCells,
  linesToMarkdownTable,
  loadPdfjs,
  markStruckPieces,
  pageShapes,
  parsePageRange,
  pdfjsAssetDirs,
  PdfError,
  type TextPiece,
  wordBoundaryNear,
} from "../src/pdf.ts";
import { STRIKE } from "../src/markdownSpans.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const execFile = promisify(execFileCallback);

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, `${name}.pdf`)));
}

/** The failure the call produced, or a message saying it produced none. */
async function failureOf(bytes: Uint8Array, options = {}): Promise<PdfError> {
  try {
    const result = await extractPdf(bytes, options);
    assert.fail(`expected a failure, got: ${result.markdown.slice(0, 120)}`);
  } catch (error) {
    assert.ok(error instanceof PdfError, `expected a PdfError, got ${String(error)}`);
    return error;
  }
}

describe("extractPdf", () => {
  test("gives one document half a minute of parsing, and the parser's own load none of it", async () => {
    assert.equal(DEFAULT_TIMEOUT_MS, 30_000);

    // Loading pdf.js is a fixed process cost — on a cold Windows runner, tens of
    // seconds of it — so it is paid once, outside any document's deadline. That
    // is why the same promise comes back every time.
    assert.equal(loadPdfjs(), loadPdfjs());
    assert.equal(await loadPdfjs(), await loadPdfjs());
  });

  test("publishes the fake worker on globalThis instead of leaving pdf.js to import it", async () => {
    await loadPdfjs();

    // Left alone, pdf.js's "fake worker" setup reaches its own worker code with a
    // *dynamic* `import("./pdf.worker.mjs")`, resolved next to the installed
    // package. Bundled into a single-file SEA executable, no such sibling file
    // exists and Node's SEA loader only resolves dynamic import() to built-in
    // modules — every extraction then dies with "No such built-in module:
    // ./pdf.worker.mjs". pdf.js checks `globalThis.pdfjsWorker` first, so
    // publishing the worker module there ourselves — imported statically, so
    // esbuild bundles it into the same output file — is what keeps that dynamic
    // import from ever running. This test is the regression guard for that.
    const published = (globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } }).pdfjsWorker;
    assert.ok(published, "expected loadPdfjs() to publish globalThis.pdfjsWorker");
    assert.ok(published.WorkerMessageHandler, "expected the published module to export WorkerMessageHandler");

    const directWorkerImport = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    assert.equal(published.WorkerMessageHandler, directWorkerImport.WorkerMessageHandler);
  });

  test("returns page-attributed text", async () => {
    const result = await extractPdf(await fixture("pdf-text"));

    assert.equal(result.pageCount, 2);
    assert.deepEqual(result.pages, [1, 2]);
    assert.equal(result.nextPage, undefined);
    assert.match(result.markdown, /## Page 1/);
    assert.match(result.markdown, /Revenue grew in every region this quarter\./);
    assert.match(result.markdown, /## Page 2/);
    assert.match(result.markdown, /The second half depends on the supply chain\./);
  });

  test("reads only the pages asked for", async () => {
    const result = await extractPdf(await fixture("pdf-text"), { pages: "2" });

    assert.deepEqual(result.pages, [2]);
    assert.doesNotMatch(result.markdown, /## Page 1/);
    assert.match(result.markdown, /## Page 2/);
    assert.doesNotMatch(result.markdown, /Revenue grew/);
  });

  test("reconstructs a regular grid as a markdown table", async () => {
    const result = await extractPdf(await fixture("pdf-table"));

    assert.match(result.markdown, /\| Region \| Units \| Revenue \|/);
    assert.match(result.markdown, /\| --- \| --- \| --- \|/);
    assert.match(result.markdown, /\| North \| 1200 \| 48000 \|/);
    assert.match(result.markdown, /\| East \| 1500 \| 61000 \|/);
  });

  test("keeps a mixed page in reading order", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-mixed"));

    const intro = markdown.indexOf("The table below breaks");
    const table = markdown.indexOf("| Region |");
    const tail = markdown.indexOf("Figures are provisional");
    assert.ok(intro >= 0 && table >= 0 && tail >= 0, markdown);
    assert.ok(intro < table, "the paragraph precedes the table");
    assert.ok(table < tail, "the closing line follows the table");
  });

  test("says so when a page holds no table", async () => {
    const result = await extractPdf(await fixture("pdf-text"), { mode: "tables", pages: "1" });

    assert.match(result.markdown, /No table found on this page/);
    assert.doesNotMatch(result.markdown, /\| --- \|/);
  });

  test("text mode returns the page's content even where a table was detected", async () => {
    // The safety valve: a misread grid must never cost the reader the content.
    const result = await extractPdf(await fixture("pdf-table"), { mode: "text" });

    assert.doesNotMatch(result.markdown, /\| --- \|/);
    for (const value of ["Region", "Units", "Revenue", "North", "1200", "48000", "East", "61000"]) {
      assert.match(result.markdown, new RegExp(value));
    }
  });

  test("can be called twice on the same bytes", async () => {
    // pdf.js transfers its input buffer to the worker; without a defensive copy
    // the caller's array is detached and the second call fails outright.
    const bytes = await fixture("pdf-text");
    const first = await extractPdf(bytes);
    const second = await extractPdf(bytes);

    assert.equal(second.markdown, first.markdown);
    assert.equal(bytes.byteLength > 0, true, "the caller's bytes must survive the call");
  });

  test("covers every page across successive calls", async () => {
    // What an agent does with a document longer than one call's cap: follow the
    // range the truncation note names until there is none left.
    const bytes = await fixture("pdf-long");
    const seen: number[] = [];
    let next: number | undefined = 1;
    let calls = 0;
    while (next !== undefined && calls < 20) {
      const result: Awaited<ReturnType<typeof extractPdf>> = await extractPdf(bytes, {
        pages: `${next}-${99}`,
        maxPages: 4,
      });
      seen.push(...result.pages);
      next = result.nextPage;
      calls++;
    }

    assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(calls, 3);
  });
});

describe("extractPdf without a text layer", () => {
  test("reports a scan instead of returning nothing", async () => {
    const result = await extractPdf(await fixture("pdf-scan"));

    assert.match(result.markdown, /no extractable text layer/i);
    assert.match(result.markdown, /OCR/);
    assert.notEqual(result.markdown.trim(), "");
  });

  test("names the image-only pages of a part-scanned document", async () => {
    const result = await extractPdf(await fixture("pdf-mixed-scan"));

    assert.match(result.markdown, /Cover page with real text/);
    assert.match(result.markdown, /No text layer on page 2/);
    assert.doesNotMatch(result.markdown, /no extractable text layer/i);
  });
});

describe("extractPdf failures", () => {
  test("a password-protected document is refused as encrypted", async () => {
    const error = await failureOf(await fixture("pdf-encrypted"));

    assert.equal(error.reason, "encrypted");
    assert.match(error.message, /password/i);
  });

  test("a corrupt file is refused as unreadable", async () => {
    const error = await failureOf(await fixture("pdf-corrupt"));

    assert.equal(error.reason, "unreadable");
  });

  test("a parse that outruns its budget fails instead of hanging", async () => {
    const error = await failureOf(await fixture("pdf-long"), { timeoutMs: 1 });

    assert.equal(error.reason, "budget");
    assert.match(error.message, /budget/);
  });
});

describe("extractPdf caps", () => {
  test("stops at the page cap and names the next page", async () => {
    const result = await extractPdf(await fixture("pdf-long"), { maxPages: 3 });

    assert.deepEqual(result.pages, [1, 2, 3]);
    assert.equal(result.nextPage, 4);
    assert.equal(result.pageCount, 10);
    assert.match(result.markdown, /Truncated: pages 1-3 of 10/);
    assert.match(result.markdown, /pages="4-10"/);
    assert.doesNotMatch(result.markdown, /## Page 4/);
  });

  test("stops at the character cap too", async () => {
    const result = await extractPdf(await fixture("pdf-long"), { maxChars: 60 });

    assert.ok(result.pages.length < 10, `expected truncation, covered ${result.pages.join(",")}`);
    assert.equal(result.nextPage, result.pages[result.pages.length - 1] + 1);
    assert.match(result.markdown, /Truncated/);
  });

  test("full returns the whole document, with no truncation note", async () => {
    const result = await extractPdf(await fixture("pdf-long"), { full: true, maxPages: undefined });

    assert.deepEqual(result.pages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(result.nextPage, undefined);
    assert.doesNotMatch(result.markdown, /Truncated/);
  });

  test("full refuses a document past the absolute ceiling instead of cutting it", async () => {
    // Truncating here would hand back a document that looks complete: exactly the
    // failure `full` exists to remove.
    try {
      await extractPdf(await fixture("pdf-long"), { full: true, maxChars: 50 });
      assert.fail("expected a refusal");
    } catch (error) {
      assert.ok(error instanceof PdfError);
      assert.equal(error.reason, "too-large");
      assert.match(error.message, /output_path/);
    }
  });

  test("full still respects the deadline", async () => {
    const error = await failureOf(await fixture("pdf-long"), { full: true, timeoutMs: -1 });
    assert.equal(error.reason, "budget");
  });

  test("an explicit range wider than the page cap stops at the cap", async () => {
    const result = await extractPdf(await fixture("pdf-long"), { pages: "2-10", maxPages: 2 });

    assert.deepEqual(result.pages, [2, 3]);
    assert.equal(result.nextPage, 4);
  });
});

describe("extraction without a native canvas", () => {
  test("reads a page drawn with a Type3 font", async () => {
    // The one place text extraction builds a matrix per glyph, rather than once
    // when pdf.js loads.
    const result = await extractPdf(await fixture("pdf-type3"));

    assert.match(result.markdown, /aaa/);
  });

  test("extracts where `@napi-rs/canvas` cannot be resolved", async () => {
    // Its own process: pdf.js takes `DOMMatrix` from the global object, this one
    // already has a real one, and the regression only exists where there is none.
    const { stdout } = await execFile(
      process.execPath,
      [
        "--require",
        path.join(FIXTURES, "no-native-canvas.cjs"),
        "--import",
        "tsx/esm",
        path.join(FIXTURES, "extract-without-canvas.mjs"),
        "pdf-text",
        "pdf-type3",
      ],
      { cwd: path.dirname(FIXTURES) },
    );
    const { results, domMatrix } = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");

    // Without the fallback both of these are `DOMMatrix is not defined`: pdf.js
    // builds one as it loads, so the plain document never gets as far as a page.
    assert.equal(results["pdf-text"].ok, true, `plain text failed: ${results["pdf-text"].message}`);
    assert.match(results["pdf-text"].markdown, /Revenue grew in every region this quarter\./);
    assert.equal(results["pdf-type3"].ok, true, `Type3 failed: ${results["pdf-type3"].message}`);
    assert.match(results["pdf-type3"].markdown, /aaa/);
    assert.equal(domMatrix, "FallbackDOMMatrix", "the fallback should be what carried the extraction");
  });
});

describe("FallbackDOMMatrix", () => {
  /** `+ 0` folds a signed zero, which arithmetic here cannot tell apart anyway. */
  const components = (m: FallbackDOMMatrix) => [m.a, m.b, m.c, m.d, m.e, m.f].map((n) => n + 0);

  test("scales and translates the way pdf.js's Type3 compiler expects", () => {
    // The exact composition pdf.js applies per glyph, for an 8x16 mask: the glyph
    // box is mapped into the unit square with the y axis flipped.
    const m = new FallbackDOMMatrix().scaleSelf(1 / 8, -1 / 16).translateSelf(0, -16);

    assert.deepEqual(components(m), [0.125, 0, 0, -0.0625, 0, 1]);
    // Corners of the mask land on corners of the unit square, top-left first.
    assert.deepEqual([m.a * 0 + m.c * 0 + m.e, m.b * 0 + m.d * 0 + m.f], [0, 1]);
    assert.deepEqual([m.a * 8 + m.c * 16 + m.e, m.b * 8 + m.d * 16 + m.f], [1, 0]);
  });

  test("translates through the current scale, and scales both axes from one argument", () => {
    assert.deepEqual(components(new FallbackDOMMatrix().scaleSelf(0.25, 0.5).translateSelf(3, -2)), [
      0.25, 0, 0, 0.5, 0.75, -1,
    ]);
    assert.deepEqual(components(new FallbackDOMMatrix().scaleSelf(2)), [2, 0, 0, 2, 0, 0]);
  });

  test("refuses to stand in for a matrix built from a value", () => {
    // A rendering path would pass one. Answering with an identity matrix there
    // is crooked output; failing is a bug report.
    assert.throws(() => new FallbackDOMMatrix([1, 0, 0, 1, 0, 0]), /text extraction only/);
  });
});

describe("pdfjsAssetDirs", () => {
  test("ends every path with a forward slash, on every platform", () => {
    const dirs = pdfjsAssetDirs();

    // pdf.js validates these as URLs: anything not ending in "/" is refused
    // outright, which on Windows made `path.sep` fail every single extraction.
    for (const value of [dirs.standardFontDataUrl, dirs.cMapUrl]) {
      assert.ok(value !== undefined, "the installed package should resolve here");
      assert.ok(value.endsWith("/"), `${value} must end with a forward slash`);
      assert.ok(!value.endsWith("\\/"), `${value} must not end with a backslash`);
    }
  });
});

describe("parsePageRange", () => {
  test("reads single pages, ranges, and lists", () => {
    assert.deepEqual(parsePageRange("3", 10), [3]);
    assert.deepEqual(parsePageRange("2-4", 10), [2, 3, 4]);
    assert.deepEqual(parsePageRange("2-4,8", 10), [2, 3, 4, 8]);
    assert.deepEqual(parsePageRange("8,2-3", 10), [2, 3, 8]);
  });

  test("clamps to the document's length", () => {
    assert.deepEqual(parsePageRange("8-99", 10), [8, 9, 10]);
  });

  test("refuses a range that names nothing readable", () => {
    assert.throws(() => parsePageRange("nope", 10), /not a page or a page range/);
    assert.throws(() => parsePageRange("5-2", 10), /not a usable page range/);
    assert.throws(() => parsePageRange("40-50", 10), /no page of this 10-page document/);
  });
});

describe("line and table geometry", () => {
  const piece = (text: string, x: number, y: number): TextPiece => ({ text, x, y, width: text.length * 6, height: 12 });

  test("groups pieces onto one line despite baseline jitter", () => {
    const lines = buildLines([piece("world", 120, 700.4), piece("Hello", 72, 700)]);

    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].pieces.map((p) => p.text), ["Hello", "world"]);
  });

  test("splits a line at wide gaps and only there", () => {
    const line = buildLines([piece("Region", 72, 700), piece("Units", 300, 700)])[0];
    assert.deepEqual(lineCells(line).map((c) => c.text), ["Region", "Units"]);

    const words = buildLines([piece("Hello", 72, 680), piece("world", 105, 680)])[0];
    assert.equal(lineCells(words).length, 1);
  });

  test("one wide-gap line is not a table", () => {
    const lines = buildLines([
      piece("Chapter 1", 72, 700),
      piece("page 4", 480, 700),
      piece("A paragraph of ordinary prose follows here.", 72, 680),
    ]);

    assert.deepEqual(detectTableBlocks(lines), []);
  });

  test("a cell cannot break out of its column", () => {
    // The text is the PDF's, so it is attacker-controlled. Escaping only the pipe
    // would turn a trailing backslash into an escaped backslash followed by a live
    // separator — the cell would swallow the boundary and shift every column after it.
    const rows = [700, 680, 660].flatMap((y, r) => [
      piece(r === 0 ? "name\\" : `n${r}`, 72, y),
      piece(`v${r}`, 300, y),
    ]);
    const lines = buildLines(rows);
    const block = detectTableBlocks(lines)[0];

    const markdown = linesToMarkdownTable(lines, block);
    const header = markdown.split("\n")[0];
    assert.equal(header, String.raw`| name\\ | v0 |`);
    for (const row of markdown.split("\n")) {
      assert.equal(row.split(" | ").length, 2, `every row keeps two columns: ${row}`);
    }
  });

  test("three aligned rows are a table", () => {
    const rows = [700, 680, 660].flatMap((y, r) => [
      piece(`name${r}`, 72, y),
      piece(`value${r}`, 300, y),
    ]);
    const blocks = detectTableBlocks(buildLines(rows));

    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0].columns, [72, 300]);
  });
});

describe("collectShapes", () => {
  /** The page's drawn shapes, read the way extraction reads them. */
  async function shapesOf(name: string, pageNumber = 1): Promise<DrawnShape[]> {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      data: new Uint8Array(await fixture(name)),
      useWorkerFetch: false,
      useSystemFonts: false,
    });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(pageNumber);
      const operators = await page.getOperatorList();
      return collectShapes(operators, pdfjs.OPS as unknown as Record<string, number>);
    } finally {
      await task.destroy();
    }
  }

  test("reports each path in page space, where the generator put it", async () => {
    const shapes = await shapesOf("pdf-strike");

    // The fixture strikes "cent euros" at x 147.4 and the first half of the line
    // below it, both 0.5 high and 0.31 * 12 above their baselines.
    assert.equal(shapes.length, 2);
    const [strike, partial] = shapes;
    assert.ok(Math.abs(strike.x - 147.4) < 0.5, `x was ${strike.x}`);
    assert.ok(Math.abs(strike.xEnd - 203.4) < 0.5, `xEnd was ${strike.xEnd}`);
    assert.ok(Math.abs(strike.y - 703.97) < 0.1, `y was ${strike.y}`);
    assert.ok(Math.abs(strike.height - 0.5) < 0.01, `height was ${strike.height}`);
    assert.equal(strike.filled, true);
    assert.ok(Math.abs(partial.x - 72) < 0.5, `x was ${partial.x}`);
  });

  test("says which shapes were filled and which were only stroked", async () => {
    const shapes = await shapesOf("pdf-strike-underline");

    // An underline, a bar well above a line, the page rule, then the ruled
    // table's own lines and its filled outer rule.
    assert.ok(shapes.length >= 4, `expected the decoys, got ${shapes.length}`);
    assert.deepEqual(shapes.slice(0, 3).map((shape) => shape.filled), [true, true, false]);
    const rule = shapes[2];
    assert.equal(rule.height, 0);
    assert.ok(rule.xEnd - rule.x > 400, `a page rule spans the page: ${rule.xEnd - rule.x}`);
    assert.ok(
      shapes.some((shape) => !shape.filled && shape.xEnd - shape.x < 1),
      "the ruled table's vertical lines are read too",
    );
  });
});

describe("markStruckPieces", () => {
  const piece: TextPiece = { text: "cent euros", x: 100, y: 700, width: 60, height: 12 };
  const shape = (over: Partial<DrawnShape>): DrawnShape => ({
    x: 100,
    xEnd: 160,
    y: 700 + 0.31 * 12,
    height: 0.5,
    filled: true,
    ...over,
  });

  test("marks a piece a filled hairline crosses at strike height", () => {
    const [marked] = markStruckPieces([piece], [shape({})]);

    assert.deepEqual(marked.spans, [{ text: "cent euros", format: STRIKE }]);
    assert.equal(marked.text, "cent euros");
  });

  test("leaves the piece alone when the shape is an underline", () => {
    // Measured on a Word document: hyperlink underlines sit 0.07 to 0.13 em below
    // the baseline, where a strike sits 0.31 above it.
    const [marked] = markStruckPieces([piece], [shape({ y: 700 - 0.1 * 12 })]);

    assert.equal(marked.spans, undefined);
  });

  test("leaves the piece alone for a rule far above it, or a stroked line, or a thick bar", () => {
    for (const decoy of [
      shape({ y: 700 + 0.8 * 12 }),
      shape({ filled: false }),
      shape({ height: 6 }),
      shape({ x: 300, xEnd: 400 }),
    ]) {
      const [marked] = markStruckPieces([piece], [decoy]);
      assert.equal(marked.spans, undefined, `${JSON.stringify(decoy)} should mark nothing`);
    }
  });

  test("splits a piece the strike covers only part of, at a word boundary", () => {
    const line: TextPiece = { text: "aaaa bbbb cccc dddd", x: 100, y: 700, width: 100, height: 12 };
    const [marked] = markStruckPieces([line], [shape({ x: 100, xEnd: 152 })]);

    assert.deepEqual(marked.spans, [
      { text: "aaaa bbbb ", format: STRIKE },
      { text: "cccc dddd", format: 0 },
    ]);
    // Nothing is invented and nothing is lost: the runs still spell the line
    assert.equal(marked.spans?.map((span) => span.text).join(""), line.text);
    // …and the piece keeps the geometry the producer drew
    assert.equal(marked.x, line.x);
    assert.equal(marked.width, line.width);
  });

  test("marks two strikes on one piece separately, not the live words between them", () => {
    const line: TextPiece = { text: "aaaa bbbb cccc dddd", x: 100, y: 700, width: 100, height: 12 };
    const [marked] = markStruckPieces([line], [
      shape({ x: 100, xEnd: 126 }),
      shape({ x: 179, xEnd: 200 }),
    ]);

    assert.deepEqual(marked.spans, [
      { text: "aaaa ", format: STRIKE },
      { text: "bbbb cccc ", format: 0 },
      { text: "dddd", format: STRIKE },
    ]);
    assert.equal(marked.spans?.map((span) => span.text).join(""), line.text);
  });

  test("does not read two rectangles over the same words as covering it twice", () => {
    // Summed rather than merged, these two would report 96 of the piece's 100
    // points as covered — past the full-coverage threshold — and strike the
    // second half of a line the page never drew over.
    const line: TextPiece = { text: "aaaa bbbb cccc dddd", x: 100, y: 700, width: 100, height: 12 };
    const [marked] = markStruckPieces([line], [
      shape({ x: 100, xEnd: 148 }),
      shape({ x: 100, xEnd: 148 }),
    ]);

    assert.deepEqual(marked.spans, [
      { text: "aaaa bbbb", format: STRIKE },
      { text: " cccc dddd", format: 0 },
    ]);
  });

  test("keeps the whitespace inside a piece it splits", () => {
    // Stripping the markers back out has to give the text extraction returned
    // before, runs of spaces included.
    const line: TextPiece = { text: "old   current", x: 100, y: 700, width: 100, height: 12 };
    const [marked] = markStruckPieces([line], [shape({ x: 100, xEnd: 124 })]);

    assert.equal(marked.spans?.map((span) => span.text).join(""), "old   current");
    assert.equal(lineCells({ y: 700, height: 12, pieces: [marked] })[0].text, "~~old~~   current");
  });

  test("marks the whole piece rather than splitting when the strike all but covers it", () => {
    const marked = markStruckPieces([piece], [shape({ xEnd: 158 })]);

    assert.equal(marked.length, 1);
    assert.deepEqual(marked[0].spans, [{ text: "cent euros", format: STRIKE }]);
  });

  test("returns the pieces untouched when the page drew nothing", () => {
    assert.deepEqual(markStruckPieces([piece], []), [piece]);
  });
});

describe("wordBoundaryNear", () => {
  test("snaps to the nearest edge of a word, never into one", () => {
    assert.equal(wordBoundaryNear("aaaa bbbb cccc", 10), 10);
    assert.equal(wordBoundaryNear("aaaa bbbb cccc", 11), 10);
    assert.equal(wordBoundaryNear("aaaa bbbb cccc", 7), 5);
    assert.equal(wordBoundaryNear("aaaa bbbb cccc", 0), 0);
    assert.equal(wordBoundaryNear("aaaa bbbb cccc", 99), 14);
  });
});

describe("pageShapes", () => {
  const ops = { save: 1, restore: 2, transform: 3, constructPath: 4, fill: 5 };

  test("UnreadableDrawingOperations: a page whose drawing cannot be read loses no text", async () => {
    const page = { getTextContent: async () => ({ items: [] }), getOperatorList: async () => { throw new Error("no"); } };

    assert.deepEqual(await pageShapes(page, ops, 1000, 1), []);
  });

  test("DetectionStaysWithinTheBudget: a drawing read that outruns the budget still fails", async () => {
    const page = {
      getTextContent: async () => ({ items: [] }),
      getOperatorList: () => new Promise<never>(() => {}),
    };

    await assert.rejects(
      () => pageShapes(page, ops, 1, 1),
      (error: unknown) => error instanceof PdfError && error.reason === "budget",
    );
  });
});

describe("extractPdf and struck-through text", () => {
  test("WordStrikethroughIsMarked: the struck run comes back as a span", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-strike"), { pages: "1", mode: "text" });

    assert.match(markdown, /Le prix est de ~~cent euros~~ deux cents euros\./);
  });

  test("PartiallyStruckLine: the markers cover the struck words, not the line", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-strike"), { pages: "1", mode: "text" });

    assert.match(markdown, /~~aaaa bbbb~~ cccc dddd/);
  });

  test("NothingIsLostToDetection: stripping the markers gives the page back whole", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-strike"), { pages: "1", mode: "text" });
    const bare = markdown.replaceAll("~~", "");

    assert.match(bare, /^Le prix est de cent euros deux cents euros\.$/m);
    assert.match(bare, /^aaaa bbbb cccc dddd$/m);
  });

  test("StruckTextInsideAReconstructedTable: the cell keeps its span and the row its columns", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-strike"), { pages: "2", mode: "tables" });

    assert.match(markdown, /\| ~~South~~ \| 900 \| 36500 \|/);
    for (const row of markdown.split("\n").filter((line) => line.startsWith("|"))) {
      assert.equal(row.split(" | ").length, 3, `every row keeps three columns: ${row}`);
    }
  });

  test("UnderlineIsNotAStrike and PageRulesAndBordersAreNotStrikes: decoys mark nothing", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-strike-underline"), { mode: "text" });

    assert.match(markdown, /Cliquez ici/);
    assert.match(markdown, /Texte sous une barre lointaine/);
    assert.match(markdown, /Sous le filet de page\./);
    assert.doesNotMatch(markdown, /~~/);
  });

  test("a document that draws nothing over its text is untouched by any of this", async () => {
    const { markdown } = await extractPdf(await fixture("pdf-mixed"));

    assert.doesNotMatch(markdown, /~~/);
  });
});
