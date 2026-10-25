/**
 * One guide for every host (poster-documents: ThePosterGuide). The Claude extension's and
 * the Open WebUI server's descriptions embed POSTER_GUIDE from code, which their own tests
 * check; pi-outpost's skill is Markdown and cannot import it, so this holds it to the same
 * words — and to a skeleton that really is a poster.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readPage } from "../src/format.ts";
import { POSTER_EXAMPLE, POSTER_GUIDE } from "../src/guide.ts";

const SKILL = fs.readFileSync(fileURLToPath(new URL("../../skills/posters/SKILL.md", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

// openlore: scenario=EveryHostGivesTheSameGuide spec=poster-documents
test("EveryHostGivesTheSameGuide (pi-outpost): the posters skill holds the guide and the example word for word", () => {
  assert.ok(SKILL.includes(POSTER_GUIDE), "the skill holds POSTER_GUIDE");
  assert.ok(SKILL.includes(POSTER_EXAMPLE.css), "the skill holds the example's stylesheet");
  assert.ok(SKILL.includes(POSTER_EXAMPLE.html), "the skill holds the example's markup");
});

test("The skill's skeleton, filled with its example, is a poster the editor opens", () => {
  const skeleton = /## The skeleton[\s\S]*?```html\n([\s\S]*?)```/.exec(SKILL)![1]!;
  const page = skeleton.replace("STYLESHEET", POSTER_EXAMPLE.css).replace("MARKUP", POSTER_EXAMPLE.html);
  assert.deepEqual(readPage(page), { html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: "A4-portrait", title: "Our class rules" });
});

// openlore: scenario=TheGuideTeachesSlotsAndDrawings spec=poster-documents
test("TheGuideTeachesSlotsAndDrawings: frames for the person's pictures, drawings in their own element, markers kept", () => {
  assert.match(POSTER_GUIDE, /<img data-poster-picture="bread" alt="bread">/);
  assert.match(POSTER_GUIDE, /the editor removes that look from a frame once it is filled/, "the empty look goes once filled");
  assert.match(POSTER_GUIDE, /<div class="drawing"> holding one <svg> with a viewBox/);
  assert.match(POSTER_GUIDE, /with no text inside/);
  assert.match(POSTER_GUIDE, /poster-picture:2.*Keep every marker exactly as it is/s);
  assert.doesNotMatch(POSTER_GUIDE, /No picture embedded as data|small inline SVG shapes/);
  // The example shows both: a drawing in its holder, and an empty frame styled as empty.
  assert.match(POSTER_EXAMPLE.html, /<div class="drawing"><svg viewBox="[^"]+">/);
  assert.match(POSTER_EXAMPLE.html, /<img class="photo" data-poster-picture="class photo" alt="Our class">/);
  assert.match(POSTER_EXAMPLE.css, /\.photo \{[^}]*border: 4px dashed/);
});

test("The skill tells the agent to read posters with read, keep markers, and leave picture frames for the user", () => {
  assert.match(SKILL, /read the file first\*\* with `read`, never with `bash`/);
  assert.match(SKILL, /keep markers exactly as you read them/);
  assert.match(SKILL, /double-click\s+each frame in the editor/);
  assert.match(SKILL, /call `poster_pictures` with the file's path to look at them/);
});
