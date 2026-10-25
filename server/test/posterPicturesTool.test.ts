/**
 * poster_pictures: the agent looks at a poster's pictures (poster-elements,
 * TheAgentSeesWhatAFrameHolds and AModelWithoutVisionIsToldSo), the pi-outpost twin of
 * get_poster's see_pictures.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createPosterPicturesToolDefinition } from "../src/posterPicturesTool.ts";

const FAMILY = `data:image/jpeg;base64,${"/9j/4".repeat(400)}`;
const SUN = `data:image/png;base64,${"iVBOR".repeat(300)}`;
const PATTERN = "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E";
const POSTER = `<!doctype html><html><head><meta name="poster-format" content="A4-portrait"><style data-poster>.p{background:url(${PATTERN})}</style></head><body><div class="poster-page"><img data-poster-picture="bread" alt="bread" src="${FAMILY}"><img alt="sun" src="${SUN}"><img data-poster-picture="soup" alt="soup"></div></body></html>`;

let root: string;
let outside: string;
before(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "poster-pictures-")));
  outside = await realpath(await mkdtemp(path.join(tmpdir(), "poster-pictures-outside-")));
  await writeFile(path.join(root, "menu.poster.html"), POSTER);
  await writeFile(path.join(root, "empty.poster.html"), POSTER.replace(/ src="data:[^"]+"/g, "").replace(PATTERN, "none"));
  await writeFile(path.join(outside, "elsewhere.poster.html"), POSTER);
});
after(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

type Result = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
const seeing = { model: { id: "vision-model", input: ["text", "image"] } };
const blind = { model: { id: "text-model", input: ["text"] } };

async function look(params: Record<string, unknown>, ctx: unknown = seeing): Promise<Result> {
  const tool = createPosterPicturesToolDefinition({ cwd: root, allowedRoots: [root] });
  return (await tool.execute("call", params as never, undefined, undefined, ctx as never)) as unknown as Result;
}

// openlore: scenario=TheAgentSeesWhatAFrameHolds spec=poster-elements
test("TheAgentSeesWhatAFrameHolds: each picture comes back as an image after its marker; a pattern is named, not shown", async () => {
  const result = await look({ path: "menu.poster.html" });
  assert.equal(result.isError, undefined);
  // In the file's order: the stylesheet's pattern comes first, in the head.
  assert.deepEqual(result.content.map((block) => block.type), ["text", "text", "text", "image", "text", "image"]);
  assert.match(result.content[0]!.text!, /holds 3 picture\(s\); shown here: poster-picture:1, poster-picture:2, poster-picture:3/);
  assert.match(result.content[1]!.text!, /poster-picture:1 is not a photo or drawing to look at \(image\/svg\+xml\)/);
  assert.equal(result.content[2]!.text, "poster-picture:2:");
  assert.deepEqual({ mimeType: result.content[3]!.mimeType, data: result.content[3]!.data }, { mimeType: "image/jpeg", data: FAMILY.slice("data:image/jpeg;base64,".length) });
  assert.equal(result.content[4]!.text, "poster-picture:3:");
  assert.equal(result.content[5]!.mimeType, "image/png");
});

test("Pictures asked by number, an unknown number named, and none for a poster whose frames are empty", async () => {
  const one = await look({ path: "menu.poster.html", pictures: [3, 7] });
  assert.deepEqual(one.content.map((block) => block.type), ["text", "text", "image", "text"]);
  assert.equal(one.content[1]!.text, "poster-picture:3:");
  assert.match(one.content[3]!.text!, /poster-picture:7 names no picture of this poster \(it has poster-picture:1 to poster-picture:3\)/);
  const empty = await look({ path: "empty.poster.html" });
  assert.match(empty.content[0]!.text!, /holds no picture/);
});

// openlore: scenario=AModelWithoutVisionIsToldSo spec=poster-elements
test("AModelWithoutVisionIsToldSo: a model that takes no images gets no picture data, and is told not to guess", async () => {
  const result = await look({ path: "menu.poster.html" }, blind);
  assert.equal(result.isError, true);
  assert.deepEqual(result.content.map((block) => block.type), ["text"]);
  assert.match(result.content[0]!.text!, /holds 3 picture\(s\), but the model in use \(text-model\) does not take images.*Do not guess/);
});

test("Only posters, and only inside the sandbox", async () => {
  assert.match((await look({ path: "notes.md" })).content[0]!.text!, /is not a poster/);
  await assert.rejects(look({ path: path.join(outside, "elsewhere.poster.html") }), /outside the sandbox/);
  assert.match((await look({ path: "missing.poster.html" })).content[0]!.text!, /No such file/);
});
