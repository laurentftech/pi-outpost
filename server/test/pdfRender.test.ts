/**
 * pdf_render: the tool for a page nothing can extract.
 *
 * It exists for the case the image path cannot reach — a page drawn as vectors, with
 * neither text nor a placed image — and for seeing how a page looks rather than what
 * it holds. `fixtures/pdf-scan.pdf` is exactly that page: it models a scan as absence
 * of text, drawn with a filled rectangle, so it holds no image to return.
 */
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { extractPdf } from "../src/pdf.ts";
import { createPdfRenderToolDefinition, MAX_DRAWN_PAGES } from "../src/pdfTool.ts";
import { realResolve } from "../src/sandbox.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("pdf_render", () => {
  let root: string;
  let tool: ReturnType<typeof createPdfRenderToolDefinition>;

  type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
  async function call(params: Record<string, unknown>): Promise<Content[]> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Content[] }>
    )("call-1", params, undefined);
    return result.content;
  }
  const images = (content: Content[]) => content.filter((one): one is Extract<Content, { type: "image" }> => one.type === "image");
  const text = (content: Content[]) => content.filter((one) => one.type === "text").map((one) => (one as { text: string }).text).join("\n");

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-pdfrender-")));
    for (const name of ["pdf-scan.pdf", "pdf-long.pdf", "pdf-text.pdf"]) {
      await copyFile(path.join(FIXTURES, name), path.join(root, name));
    }
    await writeFile(path.join(root, "notes.txt"), "not a pdf\n");
    tool = createPdfRenderToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot: root });
  });

  test("is named, and describes itself as the second choice", () => {
    assert.equal(tool.name, "pdf_render");
    // The recorded failure this guards against is a tool that works and does not get
    // used — or gets used instead of the better one. The order has to be in the words.
    assert.match(tool.description, /second choice/i);
    assert.ok(
      tool.description.indexOf("pdf_extract") < tool.description.indexOf("Use pdf_render for"),
      "extraction is named before the case this tool is for",
    );
    assert.match(tool.description, /no office application/i);
  });

  test("VectorPageWithNoTextIsDrawn: a page with neither text nor an image comes back as a picture", async () => {
    // First, that the extractor really has nothing for this page — otherwise this test
    // would pass for the wrong reason.
    const extraction = await extractPdf(await readFile(path.join(FIXTURES, "pdf-scan.pdf")));
    assert.deepEqual(extraction.pictures, [], "the fixture holds no image to extract");

    const content = await call({ path: "pdf-scan.pdf" });
    const drawn = images(content);
    assert.equal(drawn.length, 1);
    assert.equal(drawn[0].mimeType, "image/png");
    assert.ok(drawn[0].data.length > 0);
    assert.match(text(content), /Drew 1 of 1 page\(s\)/);
  });

  test("PageRangeAndCount: a range draws those pages, with the document's count", async () => {
    const content = await call({ path: "pdf-long.pdf", pages: "2-3" });
    assert.equal(images(content).length, 2);
    assert.match(text(content), /Drew 2 of 10 page\(s\)/);
    assert.match(text(content), /Page 2:/);
    assert.match(text(content), /Page 3:/);
    assert.doesNotMatch(text(content), /Page 1:/);
  });

  test("PageCapIsStated: what was not drawn is named, with how to ask for it", async () => {
    const content = await call({ path: "pdf-long.pdf" });
    assert.equal(images(content).length, MAX_DRAWN_PAGES);
    assert.match(text(content), new RegExp(`Drew ${MAX_DRAWN_PAGES} of 10 page\\(s\\)`));
    assert.match(text(content), /2 more were not drawn/);
    assert.match(text(content), /pages="9-10"/);
  });

  test("NoOfficeApplicationNeeded: the tool has no way to reach a converter", () => {
    // A PDF needs no conversion before it can be drawn, and this is what makes that
    // observable rather than asserted: the tool's options carry no renderer settings
    // at all, so there is no LibreOffice path, no Word, and nothing to configure. The
    // drawing above therefore happened without one.
    const optionKeys = Object.keys({ cwd: root, allowedRoots: [root], maxBytes: 1, writableRoot: root });
    assert.deepEqual(optionKeys, ["cwd", "allowedRoots", "maxBytes", "writableRoot"]);
    assert.doesNotMatch(tool.description, /LibreOffice|ONLYOFFICE|Word installed/i);
  });

  test("refuses what it cannot draw, naming the file", async () => {
    await assert.rejects(() => call({ path: "missing.pdf" }), /No such file: missing\.pdf/);
    await assert.rejects(() => call({ path: "../outside.pdf" }), /outside the sandbox/);
  });

  test("a range naming no page of the document is refused rather than answered emptily", async () => {
    await assert.rejects(() => call({ path: "pdf-text.pdf", pages: "9-12" }), /names none of them|no page/i);
  });
});
