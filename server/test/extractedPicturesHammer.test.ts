/**
 * The transitions, not the happy path.
 *
 * The walkthrough is the sequence the code was written against, so it is the one least
 * likely to be broken. These are the cases where something moves underneath a caller:
 * the file changes between two calls, an identifier outlives the reading that produced
 * it, every ceiling is crossed at once, and an extraction becomes a file on disk.
 */
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { extractDocx } from "../src/docx.ts";
import { createDocxExtractToolDefinition } from "../src/docxTool.ts";
import {
  MAX_ONE_PICTURE_BYTES,
  MAX_PICTURES_PER_CALL,
  MAX_PICTURE_BYTES_PER_CALL,
  selectPictures,
  type FoundPicture,
} from "../src/extractedPictures.ts";
import { extractPdf } from "../src/pdf.ts";
import { realResolve } from "../src/sandbox.ts";
import { readAllZipEntries } from "../src/zip.ts";
import { writeZip } from "../src/zipWriter.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const unzip = (bytes: Uint8Array) => readAllZipEntries(Buffer.from(bytes), { maxEntries: 4096, maxInflatedBytes: 1e8, maxTotalBytes: 1e9 });

describe("when the document changes under the caller", () => {
  let root: string;
  let tool: ReturnType<typeof createDocxExtractToolDefinition>;

  type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
  async function call(params: Record<string, unknown>): Promise<Content[]> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Content[] }>
    )("call-1", params, undefined);
    return result.content;
  }
  const images = (content: Content[]) => content.filter((one) => one.type === "image");
  const text = (content: Content[]) => content.filter((one) => one.type === "text").map((one) => (one as { text: string }).text).join("\n");

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-hammer-")));
    await copyFile(path.join(FIXTURES, "docx-report.docx"), path.join(root, "report.docx"));
    tool = createDocxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot: root });
  });

  test("its picture part is removed between two calls: named, not crashed", async () => {
    const before = await call({ path: "report.docx", images: "all" });
    assert.equal(images(before).length, 1, "the picture is there to begin with");

    // The media part goes, the drawing that points at it stays — a file edited under a
    // caller that has already read it once.
    const parts = unzip(await readFile(path.join(root, "report.docx")));
    const media = [...parts.keys()].find((name) => name.startsWith("word/media/"));
    assert.ok(media !== undefined, "the fixture has a media part to remove");
    parts.delete(media);
    await writeFile(path.join(root, "report.docx"), Buffer.from(writeZip([...parts].map(([name, data]) => ({ name, data })))));

    const after = await call({ path: "report.docx", images: "all" });
    assert.deepEqual(images(after), [], "no bytes to send");
    assert.match(text(after), /\[picture 1: PNG; its part is missing from the package\]/);
    // And the document still reads: a missing picture is not a failed extraction.
    assert.match(text(after), /# Introduction/);
  });

  test("an identifier from an earlier read of a since-shortened document is refused", async () => {
    // The caller read "picture 1" a moment ago; the document now holds none at all.
    const parts = unzip(await readFile(path.join(FIXTURES, "docx-report.docx")));
    const document = parts.get("word/document.xml")!.toString("utf8");
    const drawing = /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:p>/.exec(document)![0];
    parts.set("word/document.xml", Buffer.from(document.replace(drawing, ""), "utf8"));
    await writeFile(path.join(root, "shrunk.docx"), Buffer.from(writeZip([...parts].map(([name, data]) => ({ name, data })))));

    await assert.rejects(
      () => call({ path: "shrunk.docx", images: ["1"] }),
      (error: unknown) => error instanceof Error && /this document holds no pictures/.test(error.message),
      "a stale identifier is told what is there now, not answered with silence",
    );
  });

  test("markers survive becoming a file on disk, as plain text", async () => {
    const content = await call({ path: "report.docx", output_path: "out.md" });
    const written = await readFile(path.join(root, "out.md"), "utf8");
    // Not markdown image syntax, so nothing downstream reads it as a path to fetch —
    // and it is still legible to a person opening the file.
    assert.match(written, /\[picture 1: PNG; its part is missing from the package\]/);
    assert.doesNotMatch(written, /!\[/);
    assert.equal(images(content).length, 0, "no bytes were asked for");
  });
});

describe("every ceiling crossed at once", () => {
  /** One returnable picture of a given size. */
  const picture = (number: number, bytes: number): FoundPicture => ({
    number,
    format: "PNG",
    width: 10,
    height: 10,
    bytes: Buffer.alloc(bytes),
    mimeType: "image/png",
    });

  test("count, total bytes and one oversized picture, in the same call", async () => {
    const found = [
      picture(1, MAX_ONE_PICTURE_BYTES + 1), // over the per-picture ceiling
      ...Array.from({ length: MAX_PICTURES_PER_CALL + 4 }, (_, i) => picture(i + 2, 600 * 1024)),
    ];
    const chosen = selectPictures(found, "all");

    assert.ok(chosen.returned.length <= MAX_PICTURES_PER_CALL, "the count cap holds");
    const total = chosen.returned.reduce((sum, one) => sum + (one.bytes?.length ?? 0), 0);
    assert.ok(total <= MAX_PICTURE_BYTES_PER_CALL, `the byte cap holds: ${total}`);
    assert.ok(!chosen.returned.some((one) => one.number === 1), "the oversized one waited");
    // Both reasons are stated: a caller that gets fewer pictures than it asked for is
    // told why, and told twice when two different limits bit.
    assert.equal(chosen.notes.length, 2, chosen.notes.join(" | "));
    assert.ok(chosen.notes.some((note) => /over 2 MB/.test(note)));
    assert.ok(chosen.notes.some((note) => /did not fit this answer/.test(note)));
  });

  test("a picture over every ceiling is still reachable when it is named", () => {
    const chosen = selectPictures([picture(1, MAX_PICTURE_BYTES_PER_CALL * 2)], ["1"]);
    assert.equal(chosen.returned.length, 1, "naming it is the way back, whatever its size");
    assert.deepEqual(chosen.notes, []);
  });
});

describe("a PDF whose every page is a scan", () => {
  test("each page is named, and the document-level note fires once", async () => {
    const result = await extractPdf(await readFile(path.join(FIXTURES, "pdf-image-rgb")  + ".pdf"));
    assert.equal(result.pictures.length, 1);
    // One note for the document, not one per page repeated in the body.
    const notes = result.markdown.match(/no extractable text layer/g) ?? [];
    assert.equal(notes.length, 1, "said once, where a reader will see it");
  });

  test("a document with nothing at all does not pretend to hold pictures", async () => {
    const result = await extractDocx(await readFile(path.join(FIXTURES, "docx-text.docx")));
    assert.deepEqual(result.pictures, []);
    assert.doesNotMatch(result.markdown, /\[picture /);
  });
});
