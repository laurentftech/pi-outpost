/**
 * The pptx_extract tool: what the model gets back, and what it is refused.
 *
 * The confinement itself is exercised in sandbox-tools.test.ts, where the tool is
 * wrapped the way the running server wraps it. Here it stands alone, which is how
 * it runs when no sandbox is configured.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { realResolve } from "../src/sandbox.ts";
import { createPptxExtractToolDefinition } from "../src/pptxTool.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("pptx_extract", () => {
  let root: string;
  let outside: string;
  let tool: ReturnType<typeof createPptxExtractToolDefinition>;

  /** Call the tool the way the agent does, with only the arguments it names. */
  async function run(params: Record<string, unknown>): Promise<string> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-1", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    const base = await mkdtemp(path.join(tmpdir(), "pi-pptxtool-"));
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await copyFile(path.join(FIXTURES, "pptx-mixed.pptx"), path.join(root, "deck.pptx"));
    await copyFile(path.join(FIXTURES, "pptx-order.pptx"), path.join(root, "ordered.pptx"));
    await copyFile(path.join(FIXTURES, "pptx-long.pptx"), path.join(root, "long.pptx"));
    await copyFile(path.join(FIXTURES, "pptx-encrypted.pptx"), path.join(root, "locked.pptx"));
    await copyFile(path.join(FIXTURES, "pptx-mixed.pptx"), path.join(outside, "secret.pptx"));
    await writeFile(path.join(root, "notes.txt"), "not a presentation\n");
    await symlink(path.join(outside, "secret.pptx"), path.join(root, "link.pptx"));
    tool = createPptxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot: root });
  });

  test("is named and described for the model", () => {
    assert.equal(tool.name, "pptx_extract");
    assert.match(tool.description, /markdown/i);
    // What a caller has to know before trusting the output
    assert.match(tool.description, /order it is presented/i);
    // It used to say "Images, charts, SmartArt … are not read". Pictures are read now,
    // so the list of what is not is shorter — and the description has to say both halves,
    // or a caller trusts the wrong one.
    assert.match(tool.description, /Charts, SmartArt/i);
    assert.doesNotMatch(tool.description, /Images, charts, SmartArt/i);
    assert.match(tool.description, /Each picture is named/i);
  });

  test("leads with the file case, because that is the one that is got wrong", () => {
    // Returning the content and writing it afterwards spends the context twice;
    // the instruction only works if it comes before the reading conventions.
    assert.ok(
      tool.description.indexOf("output_path") < tool.description.indexOf("capped per call"),
      tool.description,
    );
  });

  test("tells the agent that read and grep will not do", () => {
    assert.ok(
      (tool.promptGuidelines ?? []).some((line: string) => /pptx_extract/.test(line) && /read\/grep/.test(line)),
      JSON.stringify(tool.promptGuidelines),
    );
  });

  test("returns numbered slides with their text and tables", async () => {
    const text = await run({ path: "deck.pptx" });

    assert.match(text, /## Slide 1 — Sales by region/);
    assert.match(text, /\| North \| 1200 \| 48000 \|/);
    assert.match(text, /## Slide 2 — Outlook/);
  });

  test("returns slides in presentation order, not package order", async () => {
    const text = await run({ path: "ordered.pptx" });

    assert.ok(
      text.indexOf("Third in the file") < text.indexOf("First in the file"),
      text,
    );
  });

  test("honours a slide range and reads nothing outside it", async () => {
    const text = await run({ path: "long.pptx", slides: "2-3" });

    assert.match(text, /Slide number 2 of the long deck/);
    assert.match(text, /Slide number 3 of the long deck/);
    assert.doesNotMatch(text, /Slide number 1 of the long deck/);
    assert.doesNotMatch(text, /Slide number 4 of the long deck/);
  });

  test("truncates a long deck and names the range to ask for", async () => {
    const text = await run({ path: "long.pptx" });

    assert.match(text, /Truncated: slides 1-60 of 80 shown/);
    assert.match(text, /slides="61-80"/);
  });

  test("refuses a path outside its zone", async () => {
    await assert.rejects(() => run({ path: "../outside/secret.pptx" }), /Access denied/);
  });

  test("refuses a symlink that resolves outside its zone", async () => {
    await assert.rejects(() => run({ path: "link.pptx" }), /Access denied/);
  });

  test("says so when the file is not there", async () => {
    await assert.rejects(() => run({ path: "missing.pptx" }), /No such file/);
  });

  test("passes the reason through for a password-protected presentation", async () => {
    await assert.rejects(() => run({ path: "locked.pptx" }), /password-protected/);
  });

  test("passes the reason through for a file that is not a presentation", async () => {
    await assert.rejects(() => run({ path: "notes.txt" }), /could not be read as a PowerPoint presentation/);
  });

  test("passes a bad slide range through as the reason it is bad", async () => {
    await assert.rejects(() => run({ path: "deck.pptx", slides: "later" }), /not a slide or a slide range/);
  });

  test("refuses a presentation above the ceiling before parsing it", async () => {
    const tight = createPptxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 100, writableRoot: root });
    await assert.rejects(
      () =>
        (tight.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>)(
          "call-2",
          { path: "deck.pptx" },
          undefined,
        ),
      /larger than the 0 KB presentation limit/,
    );
  });
});

describe("pptx_extract writing to a file", () => {
  let root: string;
  let outside: string;

  /** A tool with the writable zone this test needs. */
  function toolWith(writableRoot: string | null) {
    return createPptxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot });
  }

  async function run(tool: ReturnType<typeof createPptxExtractToolDefinition>, params: Record<string, unknown>): Promise<string> {
    const result = await (
      tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: { text: string }[] }>
    )("call-w", params, undefined);
    return result.content[0].text;
  }

  before(async () => {
    const base = await mkdtemp(path.join(tmpdir(), "pi-pptxout-"));
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(path.join(root, "sub"), { recursive: true });
    await copyFile(path.join(FIXTURES, "pptx-long.pptx"), path.join(root, "long.pptx"));
    await writeFile(path.join(root, "taken.md"), "keep me\n");
  });

  test("writes every slide and returns a summary, not the content", async () => {
    const answer = await run(toolWith(root), { path: "long.pptx", output_path: "out.md" });

    assert.match(answer, /Wrote 80 of 80 slides to `out\.md`/);
    assert.match(answer, /Opening lines:/);
    // The point of writing to a file is that the deck does not travel back
    assert.ok(answer.length < 1200, `summary should stay a summary, got ${answer.length} chars`);

    const written = await readFile(path.join(root, "out.md"), "utf8");
    // Whole deck, not the first slides of it
    assert.match(written, /## Slide 80 — Slide number 80 of the long deck\./);
    assert.doesNotMatch(written, /Truncated/);
  });

  test("refuses a destination outside the writable zone", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "long.pptx", output_path: path.join(outside, "escape.md") }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(outside, "escape.md")), false);
  });

  test("refuses a destination that climbs out with ..", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "long.pptx", output_path: "../outside/climb.md" }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(outside, "climb.md")), false);
  });

  test("refuses a destination in the read-only part of the root", async () => {
    // Writable zone narrowed to root/sub: the rest of the root is readable, not writable
    await assert.rejects(
      () => run(toolWith(path.join(root, "sub")), { path: "long.pptx", output_path: "elsewhere.md" }),
      /outside the writable zone/,
    );
    assert.equal(existsSync(path.join(root, "elsewhere.md")), false);
  });

  test("refuses every destination when writing is disabled", async () => {
    await assert.rejects(() => run(toolWith(null), { path: "long.pptx", output_path: "nope.md" }), /read-only/);
    assert.equal(existsSync(path.join(root, "nope.md")), false);
  });

  test("never overwrites a file that is already there", async () => {
    await assert.rejects(
      () => run(toolWith(root), { path: "long.pptx", output_path: "taken.md" }),
      /already exists/,
    );
    assert.equal(await readFile(path.join(root, "taken.md"), "utf8"), "keep me\n");
  });

  test("a refused destination leaves ordinary extraction working", async () => {
    const readOnly = toolWith(null);
    await assert.rejects(() => run(readOnly, { path: "long.pptx", output_path: "nope.md" }), /read-only/);

    const answer = await run(readOnly, { path: "long.pptx" });
    assert.match(answer, /## Slide 1/);
  });
});
