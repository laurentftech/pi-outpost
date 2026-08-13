/**
 * The docx_extract tool: what the model gets back, and what it is refused.
 *
 * The confinement itself is exercised in sandbox-tools.test.ts, where the tool
 * is wrapped the way the running server wraps it. Here it stands alone, which is
 * how it runs when no sandbox is configured.
 */
import assert from "node:assert/strict";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { createDocxExtractToolDefinition } from "../src/docxTool.ts";
import { realResolve } from "../src/sandbox.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("docx_extract", () => {
  let root: string;
  let tool: ReturnType<typeof createDocxExtractToolDefinition>;

  /** Call the tool the way the agent does, with only the arguments it names. */
  async function run(params: Record<string, unknown>): Promise<string> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-1", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-docxtool-")));
    await copyFile(path.join(FIXTURES, "docx-mixed.docx"), path.join(root, "report.docx"));
    await copyFile(path.join(FIXTURES, "docx-encrypted.docx"), path.join(root, "locked.docx"));
    await writeFile(path.join(root, "notes.txt"), "not a docx\n");
    tool = createDocxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024 });
  });

  test("is named and described for the model", () => {
    assert.equal(tool.name, "docx_extract");
    assert.match(tool.description, /markdown/i);
    // The two things a caller has to know before trusting the output
    assert.match(tool.description, /tracked changes/i);
    assert.match(tool.description, /Headers, footers/i);
  });

  test("returns headings and tables as markdown", async () => {
    const text = await run({ path: "report.docx" });

    assert.match(text, /# Sales by region/);
    assert.match(text, /\| Region \| Units \| Revenue \|/);
  });

  test("honours mode and block range", async () => {
    const tables = await run({ path: "report.docx", mode: "tables" });
    assert.match(tables, /\| Region \|/);
    assert.doesNotMatch(tables, /Sales by region/);

    const first = await run({ path: "report.docx", blocks: "1" });
    assert.match(first, /# Sales by region/);
    assert.doesNotMatch(first, /\| --- \|/);
  });

  test("refuses a path outside its zone", async () => {
    await assert.rejects(() => run({ path: "../elsewhere/secret.docx" }), /Access denied/);
  });

  test("says so when the file is not there", async () => {
    await assert.rejects(() => run({ path: "missing.docx" }), /No such file/);
  });

  test("passes the reason through for a password-protected document", async () => {
    await assert.rejects(() => run({ path: "locked.docx" }), /password-protected/);
  });

  test("passes the reason through for a file that is not a Word document", async () => {
    await assert.rejects(() => run({ path: "notes.txt" }), /could not be read as a Word document/);
  });

  test("refuses a document above the ceiling before parsing it", async () => {
    const tight = createDocxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 100 });
    await assert.rejects(
      () =>
        (tight.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>)(
          "call-2",
          { path: "report.docx" },
          undefined,
        ),
      /larger than the 0 KB Word limit/,
    );
  });
});
