/**
 * What the Word tools accept before they write anything: page ranges, the pictures a
 * document references, where its Markdown comes from, where it may be written, and the
 * shape of each docx_update edit.
 *
 * Each refusal is checked together with its consequence — nothing written, the original
 * untouched — because a refusal that still writes is the failure that matters.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { before, describe, test } from "node:test";
import { createDocument } from "@pi-outpost/office/docxBuild.ts";
import { readWordPackage } from "@pi-outpost/office/docxTemplate.ts";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";
import type { PictureSource, ReferencedImage } from "@pi-outpost/shared/docx";
import { realResolve } from "../src/sandbox.ts";
import {
  createDocxCreateToolDefinition,
  createDocxUpdateToolDefinition,
  parsePageRange,
  sandboxPictures,
  type WordToolOptions,
} from "../src/wordTools.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

type Tool = ReturnType<typeof createDocxCreateToolDefinition>;
async function call(tool: Tool, params: Record<string, unknown>): Promise<string> {
  const result = await (tool.execute as unknown as (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>)("call-1", params);
  return result.content[0]!.text;
}
const unzip = (bytes: Buffer) => readAllZipEntries(bytes, { maxEntries: 1000, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
const documentXml = async (file: string) => unzip(await readFile(file)).get("word/document.xml")!.toString("utf8");
const exists = (file: string) => readFile(file).then(() => true, () => false);

/** The type leaves both optional; sandboxPictures always provides them, and that is checked. */
function loaders(source: PictureSource): Required<Pick<PictureSource, "imageKey" | "loadImage">> {
  assert.ok(source.imageKey !== undefined && source.loadImage !== undefined, "sandboxPictures provides imageKey and loadImage");
  return { imageKey: source.imageKey, loadImage: source.loadImage };
}

/** A picture that must have loaded as a raster, with its type and size. */
function raster(image: ReferencedImage | undefined): Extract<ReferencedImage, { kind: "raster" }> {
  assert.equal(image?.kind, "raster");
  return image as Extract<ReferencedImage, { kind: "raster" }>;
}

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(1))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe("parsePageRange", () => {
  test("a page, a range and a list, in page order, each page once", () => {
    assert.deepEqual(parsePageRange("3", 10), [3]);
    assert.deepEqual(parsePageRange("2-5", 10), [2, 3, 4, 5]);
    assert.deepEqual(parsePageRange(" 4 - 6 , 1 ", 10), [1, 4, 5, 6]);
    assert.deepEqual(parsePageRange("2,1-3,2", 10), [1, 2, 3], "overlapping parts name each page once");
    assert.deepEqual(parsePageRange("1,,3,", 10), [1, 3], "empty parts are ignored");
  });

  test("a range is cut at the last page, and one past it names nothing", () => {
    assert.deepEqual(parsePageRange("3-9", 4), [3, 4]);
    assert.throws(() => parsePageRange("7", 4), /the document has 4 page\(s\); "7" names none of them/);
    assert.throws(() => parsePageRange("5-8", 4), /names none of them/);
  });

  test("what is not a page or a forward range is refused, naming the part", () => {
    assert.throws(() => parsePageRange("first", 10), /"first" is not a page or a page range \(use "3", "2-5" or "1,4-6"\)/);
    assert.throws(() => parsePageRange("1,2-", 10), /"2-" is not a page or a page range/);
    assert.throws(() => parsePageRange("5-2", 10), /"5-2" is not a page range/);
    assert.throws(() => parsePageRange("0", 10), /"0" is not a page range/);
    assert.throws(() => parsePageRange("-3", 10), /"-3" is not a page or a page range/);
  });
});

describe("Word tool inputs", () => {
  let root: string;
  let outside: string;
  let options: WordToolOptions;

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-word-inputs-")));
    outside = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-word-outside-")));
    await writeFile(path.join(root, "brand.dotx"), await readFile(path.join(FIXTURES, "docx-template.dotx")));
    const document = await createDocument(
      readWordPackage(await readFile(path.join(FIXTURES, "docx-template.dotx"))),
      "# Findings\n\nThe first chapter.\n\n# Next steps\n\nThe second chapter.\n",
    );
    await writeFile(path.join(root, "report.docx"), document.bytes);
    // mermaid: null keeps these tests off the diagram worker; none of them draws one.
    options = { cwd: root, allowedRoots: [root], writableRoot: root, maxBytes: 25 * 1024 * 1024, mermaid: null, render: { renderer: "auto", timeoutMs: 1000 } };
  });

  describe("pictures a document references", () => {
    test("a PNG and a JPEG are read from the folder the Markdown is in, with their size", async () => {
      const folder = path.join(root, "pictures");
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "chart.png"), png(40, 30));
      await writeFile(path.join(folder, "photo.jpeg"), jpeg(64, 48));
      const pictures = loaders(sandboxPictures(options, folder));
      assert.equal(pictures.imageKey("chart.png"), path.join(folder, "chart.png"));
      const chart = raster(await pictures.loadImage("chart.png"));
      assert.deepEqual({ type: chart.type, width: chart.width, height: chart.height }, { type: "png", width: 40, height: 30 });
      const photo = raster(await pictures.loadImage("photo.jpeg"));
      assert.deepEqual({ type: photo.type, width: photo.width, height: photo.height }, { type: "jpg", width: 64, height: 48 }, "a JPEG is embedded as jpg");
    });

    test("a reference is decoded, its query and fragment dropped; one that is not percent-encoded is taken as written", async () => {
      await writeFile(path.join(root, "my chart.png"), png(10, 10));
      await writeFile(path.join(root, "100%.png"), png(12, 12));
      const pictures = loaders(sandboxPictures(options, root));
      assert.equal(raster(await pictures.loadImage("my%20chart.png?v=2#top")).width, 10);
      assert.equal(pictures.imageKey("100%.png"), path.join(root, "100%.png"), "a malformed escape is not an error");
      assert.equal(raster(await pictures.loadImage("100%.png")).width, 12);
    });

    test("nothing is fetched or read outside the workspace: a URL, a protocol-relative link, an escape, a missing file and a non-picture are each left out", async () => {
      await writeFile(path.join(outside, "secret.png"), png(5, 5));
      await writeFile(path.join(root, "notes.png"), "this is text, not a picture");
      const pictures = loaders(sandboxPictures(options, root));
      assert.equal(pictures.imageKey("https://example.com/a.png"), undefined);
      assert.equal(await pictures.loadImage("https://example.com/a.png"), undefined);
      assert.equal(await pictures.loadImage("//example.com/a.png"), undefined);
      assert.equal(await pictures.loadImage("data:image/png;base64,AAAA"), undefined);
      assert.equal(await pictures.loadImage(path.join(outside, "secret.png")), undefined, "a picture outside the readable zone is not read");
      assert.equal(await pictures.loadImage(path.relative(root, path.join(outside, "secret.png"))), undefined, "nor by a relative escape");
      assert.equal(await pictures.loadImage("absent.png"), undefined);
      assert.equal(await pictures.loadImage("notes.png"), undefined, "a file that is not a picture is left out");
    });
  });

  describe("docx_create", () => {
    test("the content is markdown or markdown_path, exactly one; neither and both are refused before anything is written", async () => {
      const create = createDocxCreateToolDefinition(options);
      await writeFile(path.join(root, "content.md"), "# Title\n");
      await assert.rejects(call(create, { template_path: "brand.dotx", output_path: "neither.docx" }), /docx_create: give either markdown or markdown_path, not both and not neither/);
      await assert.rejects(call(create, { template_path: "brand.dotx", output_path: "both.docx", markdown: "# A", markdown_path: "content.md" }), /not both and not neither/);
      assert.equal(await exists(path.join(root, "neither.docx")), false);
      assert.equal(await exists(path.join(root, "both.docx")), false);
    });

    test("markdown_path is read from the workspace, and its pictures resolve against its own folder", async () => {
      const folder = path.join(root, "chapter");
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "figure.png"), png(20, 10));
      await writeFile(path.join(folder, "chapter.md"), "# From a file\n\nBefore the figure.\n\n![The figure](figure.png)\n");
      const create = createDocxCreateToolDefinition(options);
      const answer = await call(create, { template_path: "brand.dotx", output_path: "from-file.docx", markdown_path: path.join("chapter", "chapter.md") });
      assert.match(answer, /Wrote `from-file\.docx`/);
      const entries = unzip(await readFile(path.join(root, "from-file.docx")));
      assert.match(entries.get("word/document.xml")!.toString("utf8"), /From a file/);
      assert.ok([...entries.keys()].some((name) => /^word\/media\/.+\.png$/.test(name)), "the picture next to the Markdown file is embedded");
    });

    test("a Markdown file outside the workspace is refused", async () => {
      await writeFile(path.join(outside, "elsewhere.md"), "# Not yours\n");
      const create = createDocxCreateToolDefinition(options);
      await assert.rejects(call(create, { template_path: "brand.dotx", output_path: "elsewhere.docx", markdown_path: path.join(outside, "elsewhere.md") }), /outside the sandbox/);
      assert.equal(await exists(path.join(root, "elsewhere.docx")), false);
    });

    test("the destination must be a .docx file in an existing folder", async () => {
      const create = createDocxCreateToolDefinition(options);
      for (const name of ["out.dotx", "out.docm", "out.docx.txt"]) {
        await assert.rejects(call(create, { template_path: "brand.dotx", output_path: name, markdown: "# A" }), /must end in \.docx: the tool writes a Word document/, name);
      }
      await mkdir(path.join(root, "folder.docx"), { recursive: true });
      await assert.rejects(call(create, { template_path: "brand.dotx", output_path: "folder.docx", markdown: "# A", overwrite: true }), /"folder\.docx" exists and is not a file/);
      await assert.rejects(call(create, { template_path: "brand.dotx", output_path: path.join("no-such-folder", "out.docx"), markdown: "# A" }), /The folder for ".*out\.docx" does not exist/);
      assert.deepEqual((await readdir(root)).filter((name) => /^out\./.test(name)), [], "no refused destination was written");
    });
  });

  describe("docx_update", () => {
    test("without output_path it refuses unless overwrite: true, and leaves the original as it was", async () => {
      const update = createDocxUpdateToolDefinition(options);
      const before = await readFile(path.join(root, "report.docx"));
      await assert.rejects(
        call(update, { path: "report.docx", edits: [{ action: "append", markdown: "More." }] }),
        /Give output_path for the updated document, or overwrite: true to replace the original/,
      );
      assert.ok((await readFile(path.join(root, "report.docx"))).equals(before));
    });

    test("every edit but append names its section, and delete takes no content", async () => {
      const update = createDocxUpdateToolDefinition(options);
      await assert.rejects(call(update, { path: "report.docx", output_path: "unnamed.docx", edits: [{ action: "replace", markdown: "New." }] }), /edit 1: name the section by its heading/);
      await assert.rejects(
        call(update, { path: "report.docx", output_path: "blank.docx", edits: [{ action: "append", markdown: "Fine." }, { action: "insert_after", section: "  ", markdown: "x" }] }),
        /edit 2: name the section by its heading/,
      );
      await assert.rejects(call(update, { path: "report.docx", output_path: "content.docx", edits: [{ action: "delete", section: "Next steps", markdown: "x" }] }), /edit 1: delete takes no content/);
      for (const name of ["unnamed.docx", "blank.docx", "content.docx"]) assert.equal(await exists(path.join(root, name)), false, name);
    });

    test("delete removes the section named, and only it", async () => {
      const update = createDocxUpdateToolDefinition(options);
      const answer = await call(update, { path: "report.docx", output_path: "deleted.docx", track_changes: false, edits: [{ action: "delete", section: "Next steps" }] });
      assert.match(answer, /Wrote `deleted\.docx`/);
      const xml = await documentXml(path.join(root, "deleted.docx"));
      assert.doesNotMatch(xml, /Next steps|The second chapter/);
      assert.match(xml, /Findings/);
      assert.match(xml, /The first chapter/);
      assert.match(await documentXml(path.join(root, "report.docx")), /Next steps/, "the original keeps the section");
    });
  });
});
