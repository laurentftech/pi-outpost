/**
 * The pictures a deck holds, through the tool the agent calls.
 *
 * A file of its own rather than a block in `pptxTool.test.ts`, because that file opens
 * with a symlink in its `before` hook — which needs a privilege a plain Windows account
 * does not have, so the whole file is cancelled there and these cases would never run
 * on the machine most likely to be checking Office behaviour.
 *
 * The deck is built here with `pptx_create` rather than committed, so the picture in it
 * is one the writer really produced: a fixture asserting what a writer does is only
 * worth its bytes if those bytes came from the writer.
 */
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { createPptxCreateToolDefinition } from "../src/presentationTools.ts";
import { createPptxExtractToolDefinition } from "../src/pptxTool.ts";
import { realResolve } from "../src/sandbox.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** A 2×1 PNG, the same shape the other fixtures use. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

describe("pptx_extract and pictures", () => {
  let root: string;
  let tool: ReturnType<typeof createPptxExtractToolDefinition>;

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
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-pptxpictures-")));
    await copyFile(path.join(FIXTURES, "pptx-template.potx"), path.join(root, "template.potx"));
    await writeFile(path.join(root, "logo.png"), PNG);
    const options = { cwd: root, allowedRoots: [root], writableRoot: root, maxBytes: 25 * 1024 * 1024, render: { renderer: "auto" as const, timeoutMs: 60_000 } };
    await (
      createPptxCreateToolDefinition(options).execute as unknown as (id: string, params: unknown) => Promise<unknown>
    )("build", {
      template_path: "template.potx",
      output_path: "deck.pptx",
      slides: [
        { title: "A slide with a picture", image: { path: "logo.png", alt: "Revenue by region" } },
        { title: "A slide with a chart", chart: { type: "column", categories: ["A", "B"], series: [{ name: "2026", values: [1, 2] }] } },
      ],
    });
    tool = createPptxExtractToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 25 * 1024 * 1024, writableRoot: root });
  });

  test("the description says pictures are named and how to ask for them", () => {
    assert.match(tool.description, /\[picture 3: PNG 800×600/);
    assert.match(tool.description, /images: "all"/);
    // What it must no longer claim, now that pictures are read.
    assert.doesNotMatch(tool.description, /Images, charts, SmartArt/);
  });

  test("NoSlidePictureBytesByDefault: the picture is named and its bytes stay behind", async () => {
    const content = await call({ path: "deck.pptx" });
    assert.match(text(content), /\[picture 1: PNG 2×1 — "Revenue by region"\]/);
    assert.deepEqual(images(content), [], "an existing call must not start receiving bytes");
  });

  test("SlidePictureBytesOnRequest: asking returns it, announced by its marker", async () => {
    const content = await call({ path: "deck.pptx", images: "all" });
    const returned = images(content);
    assert.equal(returned.length, 1);
    assert.equal(returned[0].mimeType, "image/png");
    assert.ok(returned[0].data.length > 0);
    const marker = content.findIndex((one) => one.type === "text" && /\[picture 1: PNG 2×1 — "Revenue by region"\]$/.test(one.text));
    assert.ok(marker !== -1 && content[marker + 1]?.type === "image", "the marker precedes its picture");
  });

  test("a picture can be asked for by the number its marker carries", async () => {
    assert.equal(images(await call({ path: "deck.pptx", images: ["1"] })).length, 1);
    await assert.rejects(
      () => call({ path: "deck.pptx", images: ["5"] }),
      (error: unknown) => error instanceof Error && /No picture "5"\. This deck|No picture "5"\. This document holds 1/.test(error.message),
    );
  });

  test("AChartIsNotAPicture: the chart on the second slide returns no bytes and gets no marker", async () => {
    const content = await call({ path: "deck.pptx", images: "all" });
    // One picture in the whole deck, and it is the one on slide 1.
    assert.equal(images(content).length, 1);
    // The extraction itself is the first block; the markers that announce each
    // returned picture come after it, so the slide's own text is read from that one.
    const answer = (content[0] as { text: string }).text;
    const second = answer.split("## Slide 2")[1] ?? "";
    assert.notEqual(second, "", "the deck has a second slide");
    assert.match(second, /Not read: 1 chart\./);
    assert.doesNotMatch(second, /\[picture /);
  });

  test("writing to a file keeps the markers in it, and still returns what was asked for", async () => {
    const content = await call({ path: "deck.pptx", output_path: "out.md", images: "all" });
    assert.match(await readFile(path.join(root, "out.md"), "utf8"), /\[picture 1: PNG 2×1 — "Revenue by region"\]/);
    assert.equal(images(content).length, 1);
  });
});
