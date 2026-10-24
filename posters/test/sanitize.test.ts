/**
 * The markup cleaning every editor applies before loading a poster: a second layer under
 * each host's policy (design.md, decision 4). Run under jsdom, which parses as a browser does.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { JSDOM } from "jsdom";

let sanitizePosterHtml: (html: string) => string;
before(async () => {
  const { window } = new JSDOM("<!doctype html><body></body>");
  Object.assign(globalThis, { document: window.document, window });
  ({ sanitizePosterHtml } = await import("../src/editor.ts"));
});

test("Scripts, frames, objects, embeds, forms and document-level elements are removed", () => {
  const html = sanitizePosterHtml(
    `<h1>Title</h1><script>steal()</script><iframe srcdoc="x"></iframe><object data="x"></object><embed src="x"><form action="x"><button>go</button></form><base href="//evil/"><meta http-equiv="refresh" content="0;url=//evil/"><link rel="stylesheet" href="//evil/a.css"><svg><script>steal()</script><rect width="1"/></svg>`,
  );
  assert.equal(html, `<h1>Title</h1><svg><rect width="1"></rect></svg>`);
});

// openlore: scenario=APosterCannotReachTheApplication spec=poster-editor
test("APosterCannotReachTheApplication (first layer): event attributes and javascript: URLs are dropped, the rest kept", () => {
  const html = sanitizePosterHtml(
    `<div class="card" onclick="steal()" ONMOUSEOVER="steal()" style="color:red">Hi</div><img src="x" onerror="steal()"><a href=" java\tscript:steal()">a</a><a href="https://example.org/">b</a><svg><a xlink:href="javascript:steal()"><rect onload="steal()"/></a></svg>`,
  );
  assert.doesNotMatch(html, /steal/);
  assert.match(html, /<div class="card" style="color:red">Hi<\/div>/);
  assert.match(html, /<a href="https:\/\/example.org\/">b<\/a>/);
});

test("A clean poster comes through unchanged", () => {
  const clean = `<div class="poster"><header class="banner"><span class="star">⭐</span><h1>Our class rules</h1></header><p>Together &amp; kind</p></div>`;
  assert.equal(sanitizePosterHtml(clean), clean);
});
