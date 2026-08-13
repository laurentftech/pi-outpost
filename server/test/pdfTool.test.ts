/**
 * The pdf_extract tool: what the model gets back, and what it is refused.
 *
 * The confinement itself is exercised in sandbox-tools.test.ts, where the tool is
 * wrapped the way the running server wraps it. Here it stands alone, which is how
 * it runs when no sandbox is configured.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { createPdfExtractToolDefinition } from "../src/pdfTool.ts";
import { realResolve } from "../src/sandbox.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("pdf_extract", () => {
  let root: string;
  let tool: ReturnType<typeof createPdfExtractToolDefinition>;

  /** Call the tool the way the agent does, with only the arguments it names. */
  async function run(params: Record<string, unknown>): Promise<string> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-1", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-pdftool-")));
    await copyFile(path.join(FIXTURES, "pdf-table.pdf"), path.join(root, "report.pdf"));
    await copyFile(path.join(FIXTURES, "pdf-encrypted.pdf"), path.join(root, "locked.pdf"));
    await writeFile(path.join(root, "notes.txt"), "not a pdf\n");
    tool = createPdfExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot: root });
  });

  test("is named and described for the model", () => {
    assert.equal(tool.name, "pdf_extract");
    assert.match(tool.description, /markdown/i);
    assert.match(tool.description, /OCR/);
  });

  test("returns a PDF's tables as markdown", async () => {
    const text = await run({ path: "report.pdf" });

    assert.match(text, /## Page 1/);
    assert.match(text, /\| Region \| Units \| Revenue \|/);
  });

  test("honours mode and page range", async () => {
    const text = await run({ path: "report.pdf", mode: "text", pages: "1" });

    assert.doesNotMatch(text, /\| --- \|/);
    assert.match(text, /Region/);
  });

  test("refuses a path outside its zone", async () => {
    await assert.rejects(() => run({ path: "../elsewhere/secret.pdf" }), /Access denied/);
  });

  test("says so when the file is not there", async () => {
    await assert.rejects(() => run({ path: "missing.pdf" }), /No such file/);
  });

  test("passes the reason through for a password-protected document", async () => {
    await assert.rejects(() => run({ path: "locked.pdf" }), /password-protected/);
  });

  test("passes the reason through for a file that is not a PDF", async () => {
    await assert.rejects(() => run({ path: "notes.txt" }), /could not be read as a PDF|could not be parsed/);
  });

  test("refuses a PDF above the configured ceiling before parsing it", async () => {
    const tight = createPdfExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 100, writableRoot: root });
    await assert.rejects(
      () =>
        (tight.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>)(
          "call-2",
          { path: "report.pdf" },
          undefined,
        ),
      /larger than the 0 KB PDF limit/,
    );
  });
});

describe("pdf_extract writing to a file", () => {
  let root: string;
  let outside: string;

  function toolWith(writableRoot: string | null) {
    return createPdfExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot });
  }

  async function run(tool: ReturnType<typeof createPdfExtractToolDefinition>, params: Record<string, unknown>): Promise<string> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-w", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    const base = await mkdtemp(path.join(tmpdir(), "pi-pdfout-"));
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await copyFile(path.join(FIXTURES, "pdf-long.pdf"), path.join(root, "long.pdf"));
  });

  test("writes every page, which is more than one call would return", async () => {
    const answer = await run(toolWith(root), { path: "long.pdf", output_path: "long.md" });

    assert.match(answer, /Wrote 10 of 10 pages to `long\.md`/);
    const written = await readFile(path.join(root, "long.md"), "utf8");
    // The whole document: the last page has to be there, which is the failure
    // that started this change — an agent stopping in the middle.
    assert.match(written, /## Page 1\b/);
    assert.match(written, /## Page 10\b/);
    assert.doesNotMatch(written, /Truncated/);
  });

  test("refuses a destination outside the writable zone, and writes nothing", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "long.pdf", output_path: path.join(outside, "escape.md") }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(outside, "escape.md")), false);
  });

  test("refuses every destination when writing is disabled", async () => {
    await assert.rejects(() => run(toolWith(null), { path: "long.pdf", output_path: "x.md" }), /read-only/);
    assert.equal(existsSync(path.join(root, "x.md")), false);
  });

  test("full returns the whole document in the answer itself", async () => {
    const answer = await run(toolWith(root), { path: "long.pdf", full: true });

    assert.match(answer, /## Page 10\b/);
    assert.doesNotMatch(answer, /Truncated/);
  });
});
