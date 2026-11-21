/**
 * #527: the extraction budget on a document that is slow to read.
 *
 * A scanned page with an OCR layer is cheap text over an expensive picture: pdf.js decodes
 * the full-resolution scan while it lists the page's drawing, whatever the call wants.
 * The document is generated here — a text page, then two pages that are each a large
 * JPEG — with the canvas the image path already depends on, so the suite skips it where
 * that optional dependency is missing.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, test } from "node:test";
import { DEFAULT_TIMEOUT_MS, extractionBudget, extractPdf, MAX_TIMEOUT_MS, PdfError, PER_PAGE_TIMEOUT_MS } from "../src/pdf.ts";

const require = createRequire(import.meta.url);

function loadCanvas(): { createCanvas: (width: number, height: number) => any } | null {
  try {
    return require("@napi-rs/canvas");
  } catch {
    return null;
  }
}

/** A noisy JPEG: noise is what keeps a scan large, and slow to decode. */
function scanJpeg(canvasModule: NonNullable<ReturnType<typeof loadCanvas>>, width: number, height: number): Buffer {
  const canvas = canvasModule.createCanvas(width, height);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(width, height);
  for (let at = 0; at < pixels.data.length; at += 4) {
    const value = 200 + Math.floor(Math.random() * 55);
    pixels.data[at] = value;
    pixels.data[at + 1] = value;
    pixels.data[at + 2] = value;
    pixels.data[at + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toBuffer("image/jpeg", 90);
}

/** Page 1 is text; pages 2 and 3 are each the scan, with an invisible text layer. */
function slowDocument(jpeg: Buffer, width: number, height: number): Uint8Array {
  const objects: Buffer[] = [];
  const set = (id: number, body: string | Buffer) => {
    objects[id] = Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1");
  };
  set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  let id = 4;
  for (let page = 1; page <= 3; page++) {
    const pageId = id++;
    const contentId = id++;
    kids.push(pageId);
    const words = `BT ${page === 1 ? 0 : 3} Tr /F1 12 Tf 72 700 Td (Page ${page} says something) Tj ET`;
    if (page === 1) {
      set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
      set(contentId, `<< /Length ${words.length} >>\nstream\n${words}\nendstream`);
      continue;
    }
    const imageId = id++;
    const stream = `q 612 0 0 792 0 0 cm /Im0 Do Q ${words}`;
    set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    set(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    set(
      imageId,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
          "latin1",
        ),
        jpeg,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
  }
  set(2, `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`);

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let length = parts[0].length;
  const offsets: number[] = [];
  for (let at = 1; at < objects.length; at++) {
    offsets[at] = length;
    const part = Buffer.concat([Buffer.from(`${at} 0 obj\n`, "latin1"), objects[at], Buffer.from("\nendobj\n", "latin1")]);
    parts.push(part);
    length += part.length;
  }
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let at = 1; at < objects.length; at++) xref += `${String(offsets[at]).padStart(10, "0")} 00000 n \n`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

const canvas = loadCanvas();

describe("the extraction budget", () => {
  test("follows the pages asked for, up to a ceiling", () => {
    assert.equal(extractionBudget(1), DEFAULT_TIMEOUT_MS + PER_PAGE_TIMEOUT_MS);
    assert.equal(extractionBudget(10), DEFAULT_TIMEOUT_MS + 10 * PER_PAGE_TIMEOUT_MS);
    assert.ok(extractionBudget(10) > 30_000, "ten pages are no longer held to the flat 30 s that ran out (#527)");
    assert.equal(extractionBudget(10_000), MAX_TIMEOUT_MS);
  });
});

describe("a document slow to read", { skip: canvas === null ? "@napi-rs/canvas is not installed" : false }, () => {
  let slow: Uint8Array;
  /** How long the slow pages take here, measured, so the budgets below are relative to it. */
  let pageMs: number;

  before(async () => {
    const width = 3000;
    const height = 4000;
    slow = slowDocument(scanJpeg(canvas!, width, height), width, height);
    const started = Date.now();
    await extractPdf(slow, { pages: "2", timeoutMs: 10 * 60_000 });
    pageMs = Date.now() - started;
  });

  // openlore: scenario=ABudgetSpentMidRangeReturnsThePagesRead spec=pdf-documents
  test("a budget that runs out mid-range returns the pages read and where to start again", async () => {
    // Enough for the text page, not for a scan: page 1 costs next to nothing.
    const result = await extractPdf(slow, { pages: "1-3", timeoutMs: Math.max(50, Math.floor(pageMs / 3)) });
    assert.deepEqual(result.pages, [1], `measured ${pageMs} ms for one scanned page`);
    assert.equal(result.nextPage, 2);
    assert.match(result.markdown, /Page 1 says something/);
    assert.match(result.markdown, /Truncated: the \d+ ms budget ran out at page 2; pages 1 are shown\. Call again with pages="2-3" for the rest\./);
    assert.equal(result.pictures.length, 0, "the page that ran out leaves no picture numbered for a section never written");
  });

  // openlore: scenario=AWholeDocumentOutOfTimeSaysWhereAndWhatToAsk spec=pdf-documents
  test("a whole-document call out of time names the step and the range to ask for", async () => {
    await assert.rejects(
      () => extractPdf(slow, { full: true, timeoutMs: Math.max(50, Math.floor(pageMs / 3)) }),
      (error: unknown) => {
        assert.ok(error instanceof PdfError && error.reason === "budget", String(error));
        assert.match(error.message, /page 2 exceeded the \d+ ms budget, after pages 1\./, error.message);
        assert.match(error.message, /Ask for it in ranges, e\.g\. pages="1-1", then the next\./, error.message);
        return true;
      },
    );
  });

  // openlore: scenario=PicturesNotAskedForAreNamedNotEncoded spec=pdf-documents
  test("pictures not asked for are named with their format, and carry no bytes", async () => {
    const named = await extractPdf(slow, { pages: "2-3", pictures: "none" });
    assert.match(named.markdown, /\[picture 1: JPEG 3000×4000\]/);
    assert.match(named.markdown, /\[picture 2: JPEG 3000×4000\]/);
    assert.ok(named.pictures.every((picture) => picture.bytes === undefined), "nothing was encoded");

    const one = await extractPdf(slow, { pages: "2-3", pictures: ["2"] });
    assert.equal(one.pictures[0].bytes, undefined);
    assert.ok(one.pictures[1].bytes !== undefined && one.pictures[1].mimeType === "image/jpeg", "the one asked for is encoded");
  });
});
