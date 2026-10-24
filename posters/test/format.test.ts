/**
 * The poster file: written, read back, refused. The scenarios are poster-documents'.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FORMAT_NAMES, FORMATS, MAX_POSTER_BYTES, PosterRefusal, checkPoster, pageOf, readPage, slugOf } from "../src/format.ts";

const HTML = `<div class="poster"><h1>Our class rules</h1><p class="motto">Together, we learn better!</p></div>`;
const CSS = `.poster { width: 100%; height: 100%; --c: #3f51b5; }\nh1 { color: var(--c); }`;

function refused(work: () => unknown, pattern: RegExp) {
  assert.throws(work, (error: unknown) => error instanceof PosterRefusal && pattern.test(error.message));
}

// openlore: scenario=APosterFileIsReadBack spec=poster-documents
test("APosterFileIsReadBack: every format comes back with its markup, stylesheet and title", () => {
  for (const format of FORMAT_NAMES) {
    const page = pageOf('Rules & "ideas" <A>', { html: HTML, css: CSS, format });
    assert.deepEqual(readPage(page), { html: HTML, css: CSS, format, title: 'Rules & "ideas" <A>' });
  }
});

test("APosterFileIsReadBack: a stylesheet that says </style survives the round trip", () => {
  const css = `.x::after { content: "</style>"; }`;
  assert.equal(readPage(pageOf("T", { html: HTML, css, format: "A4-portrait" })).css, css);
});

test("APosterFileIsReadBack: markup ending in nested divs keeps them all", () => {
  const html = `<div><div><div>deep</div></div></div>`;
  assert.equal(readPage(pageOf("T", { html, css: "", format: "A4-portrait" })).html, html);
});

// openlore: scenario=APosterOpensAndPrintsInABrowser spec=poster-documents
test("APosterOpensAndPrintsInABrowser: the page is sized to its paper with no margin, colours kept for print", () => {
  for (const format of FORMAT_NAMES) {
    const { width, height, paper } = FORMATS[format];
    const page = pageOf("T", { html: HTML, css: CSS, format });
    assert.match(page, new RegExp(`@page \\{ size: ${paper}; margin: 0; \\}`));
    assert.match(page, new RegExp(`\\.poster-page \\{ width: ${width}px; height: ${height}px;`));
    assert.match(page, /print-color-adjust: exact/);
  }
  // 96 CSS pixels to the inch: the A4 page is 210 x 297 mm.
  assert.equal(Math.round((FORMATS["A4-portrait"].width / 96) * 25.4), 210);
  assert.equal(Math.round((FORMATS["A4-portrait"].height / 96) * 25.4), 297);
});

test("PosterFormats: the page sizes are the ones the guide gives", () => {
  assert.deepEqual(
    Object.fromEntries(FORMAT_NAMES.map((name) => [name, [FORMATS[name].width, FORMATS[name].height]])),
    { "A4-portrait": [794, 1123], "A4-landscape": [1123, 794], "A3-portrait": [1123, 1587], "A3-landscape": [1587, 1123], "slide-16:9": [1280, 720] },
  );
});

// openlore: scenario=AnUnknownFormatIsRefused spec=poster-documents
test("AnUnknownFormatIsRefused: the refusal lists the formats that exist", () => {
  assert.throws(
    () => checkPoster({ html: HTML, css: CSS, format: "Letter" as never }),
    (error: unknown) => error instanceof PosterRefusal && /unknown format "Letter"/.test(error.message) && JSON.stringify(error.details.formats) === JSON.stringify(FORMAT_NAMES),
  );
  refused(() => readPage(pageOf("T", { html: HTML, css: CSS, format: "A4-portrait" }).replace('content="A4-portrait"', 'content="B5"')), /unknown format "B5"/);
});

// openlore: scenario=AScriptIsRefused spec=poster-documents
test("AScriptIsRefused: a script anywhere in the markup, SVG included, is refused", () => {
  refused(() => checkPoster({ html: `<p>hi</p><script>alert(1)</script>`, css: "", format: "A4-portrait" }), /holds no script/);
  refused(() => checkPoster({ html: `<svg><SCRIPT>alert(1)</SCRIPT></svg>`, css: "", format: "A4-portrait" }), /holds no script/);
  refused(() => pageOf("T", { html: `<script src="x.js"></script>`, css: "", format: "A4-portrait" }), /holds no script/);
  const page = pageOf("T", { html: HTML, css: "", format: "A4-portrait" }).replace("<h1>", "<script>steal()</script><h1>");
  refused(() => readPage(page), /holds no script/);
});

// openlore: scenario=AnOversizedPosterIsRefused spec=poster-documents
test("AnOversizedPosterIsRefused: above the ceiling, with the advice to use emoji or small SVG", () => {
  refused(() => checkPoster({ html: "x".repeat(MAX_POSTER_BYTES), css: "y", format: "A4-portrait" }), /too large.*emoji/);
  // Counted in bytes, not characters: an emoji is four.
  refused(() => checkPoster({ html: "🌱".repeat(MAX_POSTER_BYTES / 4 + 1), css: "", format: "A4-portrait" }), /too large/);
  assert.doesNotThrow(() => checkPoster({ html: "x".repeat(MAX_POSTER_BYTES - 1), css: "y", format: "A4-portrait" }));
});

test("readPage names what is missing from a file that is not a poster", () => {
  refused(() => readPage("<!doctype html><html><body>hello</body></html>"), /no <meta name="poster-format">/);
  const page = pageOf("T", { html: HTML, css: CSS, format: "A4-portrait" });
  refused(() => readPage(page.replace("<style data-poster>", "<style>")), /no <style data-poster>/);
  refused(() => readPage(page.replace('<div class="poster-page">', "<div>")), /no <div class="poster-page">/);
});

test("A poster file edited by hand with Windows line endings is still read", () => {
  const page = pageOf("T", { html: HTML, css: CSS, format: "A3-landscape" }).replace(/\n/g, "\r\n");
  const read = readPage(page);
  assert.equal(read.format, "A3-landscape");
  assert.equal(read.html, HTML);
  assert.equal(read.css.replace(/\r\n/g, "\n"), CSS);
});

test("slugOf turns a title into an id", () => {
  assert.equal(slugOf("Règles de la classe"), "regles-de-la-classe");
  assert.equal(slugOf("  !!!  "), "poster");
});

test("The guide's example is itself a poster every check accepts", async () => {
  const { POSTER_EXAMPLE, POSTER_GUIDE } = await import("../src/guide.ts");
  const content = { html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format };
  assert.deepEqual(readPage(pageOf("Example", content)), { ...content, title: "Example" });
  for (const name of FORMAT_NAMES) assert.match(POSTER_GUIDE, new RegExp(`${name} ${FORMATS[name].width} x ${FORMATS[name].height}`));
});

test("readPage stays fast on a file repeating its opening tags (no polynomial backtracking)", () => {
  const page = pageOf("T", { html: HTML, css: CSS, format: "A4-portrait" });
  const crafted = page.replace("<title>", "<title>a".repeat(100_000)).replace("<style data-poster>", "<style data-poster>".repeat(100_000));
  const started = performance.now();
  try {
    readPage(crafted);
  } catch {
    // Read or refused: either is fine, as long as it is quick.
  }
  assert.ok(performance.now() - started < 500, "read in under half a second");
});
