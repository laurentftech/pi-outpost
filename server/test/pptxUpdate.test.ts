/**
 * Changing an existing deck: pptx_update, and the edits under it.
 *
 * The deck is built here from `fixtures/pptx-template.potx`: five slides, the second
 * carrying a picture no other slide uses, the third on "Two Content", and the last two
 * sharing a title.
 */
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { before, describe, test } from "node:test";
import { readImageInfo } from "../src/imageInfo.ts";
import { buildPresentation, PptxBuildError, readTemplate } from "../src/pptxBuild.ts";
import { updatePresentation } from "../src/pptxUpdate.ts";
import { createPptxUpdateToolDefinition } from "../src/presentationTools.ts";
import { realResolve } from "../src/sandbox.ts";
import { readAllZipEntries } from "../src/zip.ts";
import { assertIntact } from "./ooxmlPackage.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const LIMITS = { maxEntries: 4096, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 };

/** A 2×2 PNG. */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

let deck: Buffer;

before(async () => {
  const picture = png();
  const built = await buildPresentation(readTemplate(await readFile(path.join(FIXTURES, "pptx-template.potx"))), [
    { title: "Cover", subtitle: "Q3" },
    { title: "Photo", bullets: ["The site"], image: { name: "site.png", bytes: picture, info: readImageInfo(picture, "site.png") } },
    { layout: "Two Content", title: "Plan", bullets: ["One", "Two"] },
    { title: "Same", bullets: ["four"] },
    { title: "Same", bullets: ["five"] },
  ]);
  deck = built.bytes;
});

const unzip = (bytes: Uint8Array) => readAllZipEntries(Buffer.from(bytes), LIMITS);
const text = (parts: Map<string, Buffer>, name: string) => parts.get(name)?.toString("utf8") ?? "";

/** Resolve a relationship target against the part that holds it. */
function resolve(from: string, target: string): string {
  const segments = from.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}

function relsOf(part: string): string {
  const cut = part.lastIndexOf("/");
  return `${part.slice(0, cut)}/_rels/${part.slice(cut + 1)}.rels`;
}

/** Internal relationship targets of a part, by type (the last segment of the type URI). */
function targets(parts: Map<string, Buffer>, part: string): Array<{ type: string; part: string }> {
  return [...text(parts, relsOf(part)).matchAll(/<Relationship [^>]*\/>/g)]
    .filter((match) => !/TargetMode="External"/.test(match[0]))
    .map((match) => ({ type: /Type="[^"]*\/([^"/]+)"/.exec(match[0])![1], part: resolve(part, /Target="([^"]+)"/.exec(match[0])![1]) }));
}

/** The slide parts, in the deck's order. */
function slideOrder(parts: Map<string, Buffer>): string[] {
  const rels = text(parts, "ppt/_rels/presentation.xml.rels");
  return [...text(parts, "ppt/presentation.xml").matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map((match) =>
    resolve("ppt/presentation.xml", new RegExp(`Id="${match[1]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${match[1]}"`).exec(rels)![1]),
  );
}

/** A slide and everything it reaches except the layout it is drawn on, with its bytes. */
function slideClosure(parts: Map<string, Buffer>, slide: string): Map<string, Buffer> {
  const closure = new Map<string, Buffer>([[slide, parts.get(slide)!], [relsOf(slide), parts.get(relsOf(slide))!]]);
  for (const target of targets(parts, slide)) {
    if (target.type === "slideLayout") continue;
    closure.set(target.part, parts.get(target.part)!);
  }
  return closure;
}

const layoutOf = (parts: Map<string, Buffer>, slide: string) => targets(parts, slide).find((target) => target.type === "slideLayout")!.part;
const layoutName = (parts: Map<string, Buffer>, layout: string) => /<p:cSld name="([^"]*)"/.exec(text(parts, layout))![1];
const slideText = (parts: Map<string, Buffer>, slide: string) => [...text(parts, slide).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join(" | ");

describe("updatePresentation", () => {
  test("ASlideIsReplacedAndTheOthersAreUntouched: new content on its layout, every other slide byte-identical", async () => {
    const before = unzip(deck);
    const updated = await updatePresentation(deck, [{ action: "replace", slide: 3, content: { title: "New plan", bullets: ["Alpha", "Beta"] } }]);
    const after = unzip(updated.bytes);
    assertIntact(after);
    const slidesBefore = slideOrder(before);
    const slidesAfter = slideOrder(after);
    assert.equal(slidesAfter.length, 5);
    for (const position of [0, 1, 3, 4]) {
      const was = slideClosure(before, slidesBefore[position]);
      const is = slideClosure(after, slidesAfter[position]);
      assert.deepEqual([...is.keys()], [...was.keys()], `slide ${position + 1} reaches the same parts`);
      for (const [name, data] of was) assert.ok(is.get(name)!.equals(data), `slide ${position + 1}: ${name} is byte-identical`);
    }
    const replaced = slidesAfter[2];
    assert.equal(layoutName(after, layoutOf(after, replaced)), "Two Content", "the slide keeps its layout");
    assert.equal(slideText(after, replaced), "New plan | Alpha | Beta");
    assert.deepEqual(updated.changed, [3]);
  });

  test("AnInsertedSlideUsesTheDecksLayouts: after slide 2, on the deck's own layout, named in the report", async () => {
    const updated = await updatePresentation(deck, [{ action: "insert_after", slide: 2, content: { layout: "Title and Content", title: "Inserted", bullets: ["x"] } }]);
    const after = unzip(updated.bytes);
    assertIntact(after);
    const slides = slideOrder(after);
    assert.equal(slides.length, 6);
    assert.equal(slideText(after, slides[2]), "Inserted | x");
    const layout = layoutOf(after, slides[2]);
    assert.equal(layoutName(after, layout), "Title and Content");
    assert.ok(unzip(deck).get(layout)!.equals(after.get(layout)!), "the layout is the deck's own, unchanged");
    assert.deepEqual(updated.changed, [3]);
    assert.deepEqual(updated.report, ['edit 1: added a slide on layout "Title and Content"']);
  });

  test("DeletingASlideSweepsWhatOnlyItUsed: the slide and its picture leave the package, which stays consistent", async () => {
    const before = unzip(deck);
    const doomed = slideOrder(before)[1];
    const picture = targets(before, doomed).find((target) => target.type === "image")!.part;
    assert.ok(before.has(picture));
    const updated = await updatePresentation(deck, [{ action: "delete", slide: "Photo" }]);
    const after = unzip(updated.bytes);
    assertIntact(after);
    assert.ok(!after.has(doomed) && !after.has(relsOf(doomed)), "the slide is gone");
    assert.ok(!after.has(picture), "the picture only it used is gone");
    assert.ok(!text(after, "[Content_Types].xml").includes(`/${doomed}"`));
    const slides = slideOrder(after);
    assert.deepEqual(slides.map((slide) => slideText(after, slide).split(" | ")[0]), ["Cover", "Plan", "Same", "Same"]);
    // One slide list entry and one relationship per remaining slide, and no more.
    assert.equal(text(after, "ppt/_rels/presentation.xml.rels").match(/relationships\/slide"/g)?.length, 4);
  });

  test("AnAmbiguousSlideTitleIsRefused: the refusal lists the slides", async () => {
    await assert.rejects(
      updatePresentation(deck, [{ action: "delete", slide: "Same" }]),
      (error: unknown) => error instanceof PptxBuildError && /2 slides are titled "Same"; name it by number/.test(error.message) && /1\. Cover\n2\. Photo\n3\. Plan\n4\. Same\n5\. Same/.test(error.message),
    );
  });
});

describe("pptx_update", () => {
  let root: string;
  let tool: ReturnType<typeof createPptxUpdateToolDefinition>;
  const call = async (params: Record<string, unknown>) =>
    ((await (tool.execute as unknown as (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>)("call-1", params)).content[0].text);

  before(async () => {
    root = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-pptx-update-")));
    await writeFile(path.join(root, "deck.pptx"), deck);
    await copyFile(path.join(FIXTURES, "pptx-template.potx"), path.join(root, "unused.potx"));
    tool = createPptxUpdateToolDefinition({ cwd: root, allowedRoots: [root], writableRoot: root, maxBytes: 25 * 1024 * 1024, render: { renderer: "auto", timeoutMs: 1000 } });
  });

  test("TheOriginalIsKeptUnlessOverwriteIsAsked: the result goes to output_path, the original stays", async () => {
    const original = await readFile(path.join(root, "deck.pptx"));
    const answer = await call({ path: "deck.pptx", output_path: "deck-v2.pptx", edits: [{ action: "move", slide: 1, after: 3 }] });
    assert.match(answer, /Wrote `deck-v2.pptx`/);
    assert.match(answer, /pptx_render with path "deck-v2.pptx" and slides="/);
    assert.ok((await readFile(path.join(root, "deck.pptx"))).equals(original), "the original is unchanged");
    const moved = unzip(await readFile(path.join(root, "deck-v2.pptx")));
    assert.deepEqual(slideOrder(moved).map((slide) => slideText(moved, slide).split(" | ")[0]), ["Photo", "Plan", "Cover", "Same", "Same"]);
    // Without output_path, the original is only replaced when asked to.
    await assert.rejects(call({ path: "deck.pptx", edits: [{ action: "delete", slide: 2 }] }), /Give output_path for the updated deck, or overwrite: true/);
    await assert.rejects(call({ path: "deck.pptx", output_path: "deck-v2.pptx", edits: [{ action: "delete", slide: 2 }] }), /already exists\. Pass overwrite: true/);
    assert.ok((await readFile(path.join(root, "deck.pptx"))).equals(original));
    await call({ path: "deck.pptx", overwrite: true, edits: [{ action: "delete", slide: 2 }] });
    assert.equal(slideOrder(unzip(await readFile(path.join(root, "deck.pptx")))).length, 4);
  });

  test("an ambiguous title writes nothing", async () => {
    await assert.rejects(call({ path: "deck-v2.pptx", output_path: "never.pptx", edits: [{ action: "delete", slide: "Same" }] }), /"deck-v2.pptx": edit 1: 2 slides are titled "Same"/i);
    assert.ok(!existsSync(path.join(root, "never.pptx")));
  });
});
