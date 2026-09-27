/**
 * The docx_extract tool: what the model gets back, and what it is refused.
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
    tool = createDocxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot: root });
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
    const tight = createDocxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 100, writableRoot: root });
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

describe("docx_extract writing to a file", () => {
  let root: string;
  let outside: string;

  /** A tool with the writable zone this test needs. */
  function toolWith(writableRoot: string | null) {
    return createDocxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot });
  }

  async function run(tool: ReturnType<typeof createDocxExtractToolDefinition>, params: Record<string, unknown>): Promise<string> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-w", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    const base = await mkdtemp(path.join(tmpdir(), "pi-docxout-"));
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(path.join(root, "sub"), { recursive: true });
    await copyFile(path.join(FIXTURES, "docx-mixed.docx"), path.join(root, "report.docx"));
    await writeFile(path.join(root, "taken.md"), "keep me\n");
  });

  test("writes the whole extraction and returns a summary, not the content", async () => {
    const answer = await run(toolWith(root), { path: "report.docx", output_path: "out.md" });

    assert.match(answer, /Wrote 4 of 4 blocks to `out\.md`/);
    assert.match(answer, /Opening lines:/);
    // The point of writing to a file is that the document does not travel back
    assert.ok(answer.length < 900, `summary should stay a summary, got ${answer.length} chars`);

    const written = await readFile(path.join(root, "out.md"), "utf8");
    assert.match(written, /# Sales by region/);
    assert.match(written, /\| Region \| Units \| Revenue \|/);
    assert.match(written, /Figures are provisional/);
  });

  test("refuses a destination outside the writable zone", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "report.docx", output_path: path.join(outside, "escape.md") }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(outside, "escape.md")), false);
  });

  test("refuses a destination that climbs out with ..", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "report.docx", output_path: "../outside/climb.md" }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(outside, "climb.md")), false);
  });

  test("refuses a destination in the read-only part of the root", async () => {
    // Writable zone narrowed to root/sub: the rest of the root is readable, not writable
    await assert.rejects(
      () => run(toolWith(path.join(root, "sub")), { path: "report.docx", output_path: "elsewhere.md" }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(root, "elsewhere.md")), false);
  });

  test("refuses every destination when writing is disabled", async () => {
    await assert.rejects(
      () => run(toolWith(null), { path: "report.docx", output_path: "nope.md" }),
      /read-only/,
    );
    assert.equal(existsSync(path.join(root, "nope.md")), false);
  });

  test("never overwrites a file that is already there", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "report.docx", output_path: "taken.md" }),
      /already exists/,
    );
    assert.equal(await readFile(path.join(root, "taken.md"), "utf8"), "keep me\n");
  });

  test("a refused destination leaves ordinary extraction working", async () => {
    const readOnly = toolWith(null);
    await assert.rejects(() => run(readOnly, { path: "report.docx", output_path: "nope.md" }), /read-only/);

    const answer = await run(readOnly, { path: "report.docx" });
    assert.match(answer, /# Sales by region/);
  });
});

/**
 * The pictures a document holds, through the tool the agent calls.
 *
 * `docx.test.ts` covers the reading; what matters here is the contract at the
 * surface: an existing call must not start receiving bytes it never asked for, and
 * asking for a picture that is not there must be refused rather than answered with
 * something that looks complete.
 */
describe("docx_extract and pictures", () => {
  let root: string;
  let tool: ReturnType<typeof createDocxExtractToolDefinition>;

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
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-docxpictures-")));
    await copyFile(path.join(FIXTURES, "docx-report.docx"), path.join(root, "report.docx"));
    tool = createDocxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot: root });
  });

  test("the description says pictures are named and how to ask for them", () => {
    assert.match(tool.description, /\[picture 3: PNG 800×600/);
    assert.match(tool.description, /images: "all"/);
    // What it must no longer claim.
    assert.doesNotMatch(tool.description, /text boxes and images are not read/);
  });

  test("by default a picture is named and its bytes stay behind", async () => {
    const content = await call({ path: "report.docx" });
    assert.match(text(content), /\[picture 1: PNG 2×1\]/);
    assert.deepEqual(images(content), []);
  });

  test('"all" returns the picture, announced by its own marker', async () => {
    const content = await call({ path: "report.docx", images: "all" });
    const returned = images(content);
    assert.equal(returned.length, 1);
    assert.equal(returned[0].mimeType, "image/png");
    assert.ok(returned[0].data.length > 0);
    // Announced before the bytes, so a transcript with several is still readable.
    const marker = content.findIndex((one) => one.type === "text" && /\[picture 1: PNG 2×1\]$/.test(one.text));
    assert.ok(marker !== -1 && content[marker + 1]?.type === "image", "the marker precedes its picture");
  });

  test("a picture can be asked for by the number its marker carries", async () => {
    assert.equal(images(await call({ path: "report.docx", images: ["1"] })).length, 1);
    assert.equal(images(await call({ path: "report.docx", images: ["picture 1"] })).length, 1);
  });

  test("an identifier naming no picture is refused, and says what is there", async () => {
    await assert.rejects(
      () => call({ path: "report.docx", images: ["4"] }),
      (error: unknown) => error instanceof Error && /No picture "4"\. This document holds 1, numbered 1–1\./.test(error.message),
    );
  });

  test("writing to a file keeps the markers in it, and still returns the pictures asked for", async () => {
    const content = await call({ path: "report.docx", output_path: "out.md", images: "all" });
    assert.match(await readFile(path.join(root, "out.md"), "utf8"), /\[picture 1: PNG 2×1\]/);
    assert.equal(images(content).length, 1, "the caller asked for the bytes, whichever way the text went");
  });
});
