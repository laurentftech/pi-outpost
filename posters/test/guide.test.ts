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
