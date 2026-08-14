/**
 * The xlsx_extract tool: what the model gets back, and what it is refused.
 *
 * The confinement itself is exercised in sandbox-tools.test.ts, where the tool
 * is wrapped the way the running server wraps it. Here it stands alone, which is
 * how it runs when no sandbox is configured.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { realResolve } from "../src/sandbox.ts";
import { createXlsxExtractToolDefinition } from "../src/xlsxTool.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("xlsx_extract", () => {
  let root: string;
  let tool: ReturnType<typeof createXlsxExtractToolDefinition>;

  /** Call the tool the way the agent does, with only the arguments it names. */
  async function run(params: Record<string, unknown>): Promise<string> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-1", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-xlsxtool-")));
    await copyFile(path.join(FIXTURES, "xlsx-two-sheets.xlsx"), path.join(root, "book.xlsx"));
    await copyFile(path.join(FIXTURES, "xlsx-formats.xlsx"), path.join(root, "formats.xlsx"));
    await copyFile(path.join(FIXTURES, "xlsx-encrypted.xlsx"), path.join(root, "locked.xlsx"));
    await writeFile(path.join(root, "notes.txt"), "not a workbook\n");
    tool = createXlsxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot: root });
  });

  test("is named and described for the model", () => {
    assert.equal(tool.name, "xlsx_extract");
    assert.match(tool.description, /markdown/i);
    // What a caller has to know before trusting the output
    assert.match(tool.description, /every visible sheet/i);
    assert.match(tool.description, /YYYY-MM-DD/);
    assert.match(tool.description, /Charts, pivot tables/i);
  });

  test("leads with the file case, because that is the one that is got wrong", () => {
    // Returning the content and writing it afterwards spends the context twice;
    // the instruction only works if it comes before the reading conventions.
    assert.ok(
      tool.description.indexOf("output_path") < tool.description.indexOf("capped per call"),
      tool.description,
    );
  });

  test("returns every visible sheet as a table", async () => {
    const text = await run({ path: "book.xlsx" });

    assert.match(text, /## First/);
    assert.match(text, /## Second/);
    assert.match(text, /\|\s+\| A \|/);
  });

  test("honours sheet and row range", async () => {
    const second = await run({ path: "book.xlsx", sheet: "Second" });
    assert.match(second, /## Second/);
    assert.doesNotMatch(second, /## First/);

    const rows = await run({ path: "book.xlsx", sheet: "First", rows: "3-4" });
    assert.match(rows, /^\| 3 \|/m);
    assert.doesNotMatch(rows, /^\| 2 \|/m);
  });

  test("renders values from their number format rather than raw", async () => {
    const text = await run({ path: "formats.xlsx" });
    assert.match(text, /2024-01-01/);
    assert.match(text, /15%/);
    assert.doesNotMatch(text, /45292/);
  });

  test("refuses a path outside its zone", async () => {
    await assert.rejects(() => run({ path: "../elsewhere/secret.xlsx" }), /Access denied/);
  });

  test("says so when the file is not there", async () => {
    await assert.rejects(() => run({ path: "missing.xlsx" }), /No such file/);
  });

  test("passes the reason through for a password-protected workbook", async () => {
    await assert.rejects(() => run({ path: "locked.xlsx" }), /password-protected/);
  });

  test("passes the reason through for a file that is not a spreadsheet", async () => {
    await assert.rejects(() => run({ path: "notes.txt" }), /could not be read as a spreadsheet/);
  });

  test("passes a bad row range through as the reason it is bad", async () => {
    await assert.rejects(() => run({ path: "book.xlsx", rows: "later" }), /not a row or a row range/);
  });

  test("refuses a workbook above the ceiling before parsing it", async () => {
    const tight = createXlsxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 100, writableRoot: root });
    await assert.rejects(
      () =>
        (tight.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>)(
          "call-2",
          { path: "book.xlsx" },
          undefined,
        ),
      /larger than the 0 KB spreadsheet limit/,
    );
  });
});

describe("xlsx_extract writing to a file", () => {
  let root: string;
  let outside: string;

  /** A tool with the writable zone this test needs. */
  function toolWith(writableRoot: string | null) {
    return createXlsxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot });
  }

  async function run(tool: ReturnType<typeof createXlsxExtractToolDefinition>, params: Record<string, unknown>): Promise<string> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-w", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    const base = await mkdtemp(path.join(tmpdir(), "pi-xlsxout-"));
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(path.join(root, "sub"), { recursive: true });
    await copyFile(path.join(FIXTURES, "xlsx-two-sheets.xlsx"), path.join(root, "book.xlsx"));
    await writeFile(path.join(root, "taken.md"), "keep me\n");
  });

  test("writes every visible sheet and returns a summary, not the content", async () => {
    const answer = await run(toolWith(root), { path: "book.xlsx", output_path: "out.md" });

    assert.match(answer, /Wrote 2 of 2 sheets, 40 rows to `out\.md`/);
    assert.match(answer, /Opening lines:/);
    // The point of writing to a file is that the workbook does not travel back
    assert.ok(answer.length < 900, `summary should stay a summary, got ${answer.length} chars`);

    const written = await readFile(path.join(root, "out.md"), "utf8");
    assert.match(written, /## First/);
    assert.match(written, /## Second/);
    // Whole sheets, not the first rows of them
    assert.match(written, /^\| 20 \|/m);
  });

  test("with a sheet named, writes that sheet only", async () => {
    const answer = await run(toolWith(root), { path: "book.xlsx", sheet: "Second", output_path: "one.md" });

    assert.match(answer, /Wrote 1 of 2 sheets/);
    const written = await readFile(path.join(root, "one.md"), "utf8");
    assert.match(written, /## Second/);
    assert.doesNotMatch(written, /## First/);
  });

  test("refuses a destination outside the writable zone", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "book.xlsx", output_path: path.join(outside, "escape.md") }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(outside, "escape.md")), false);
  });

  test("refuses a destination that climbs out with ..", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "book.xlsx", output_path: "../outside/climb.md" }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(outside, "climb.md")), false);
  });

  test("refuses a destination in the read-only part of the root", async () => {
    // Writable zone narrowed to root/sub: the rest of the root is readable, not writable
    await assert.rejects(
      () => run(toolWith(path.join(root, "sub")), { path: "book.xlsx", output_path: "elsewhere.md" }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(root, "elsewhere.md")), false);
  });

  test("refuses every destination when writing is disabled", async () => {
    await assert.rejects(() => run(toolWith(null), { path: "book.xlsx", output_path: "nope.md" }), /read-only/);
    assert.equal(existsSync(path.join(root, "nope.md")), false);
  });

  test("never overwrites a file that is already there", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "book.xlsx", output_path: "taken.md" }),
      /already exists/,
    );
    assert.equal(await readFile(path.join(root, "taken.md"), "utf8"), "keep me\n");
  });

  test("a refused destination leaves ordinary extraction working", async () => {
    const readOnly = toolWith(null);
    await assert.rejects(() => run(readOnly, { path: "book.xlsx", output_path: "nope.md" }), /read-only/);

    const answer = await run(readOnly, { path: "book.xlsx" });
    assert.match(answer, /## First/);
  });
});
