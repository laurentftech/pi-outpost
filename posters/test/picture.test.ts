/**
 * The SVG the page is drawn through must be well-formed XML, or the browser draws nothing and
 * the export fails with "this browser could not draw the page as a picture". Run under jsdom,
 * which parses as a browser does and refuses XML that is not well formed.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { JSDOM } from "jsdom";

let pageSvg: (page: { width: number; height: number }, html: string, css: string, scale?: number) => string;
let parse: (svg: string) => Document;
let whyNotDrawn: (svg: string) => string;
before(async () => {
  const { window } = new JSDOM("<!doctype html><body></body>");
  Object.assign(globalThis, { document: window.document, window, XMLSerializer: window.XMLSerializer, DOMParser: window.DOMParser });
  parse = (svg) => new window.DOMParser().parseFromString(svg, "image/svg+xml");
  ({ pageSvg, whyNotDrawn } = await import("../src/picture.ts"));
});

function wellFormed(svg: string): Document {
  const parsed = parse(svg);
  assert.equal(parsed.getElementsByTagName("parsererror").length, 0, `not well-formed XML: ${svg}`);
  return parsed;
}

const PAGE = { width: 794, height: 1123 };

test("Text pasted from Word is drawn: its <o:p> elements, o: attributes, control characters and comments do not break the picture", () => {
  const svg = pageSvg(
    PAGE,
    '<h1 class="t">Pasted \u000Bfrom Word<o:p></o:p></h1><p class="MsoNormal" o:spid="1" @click="x" title="a\u0008b">Bonjour\u000Cà tous<o:p><b>gras</b></o:p></p><!-- a -- b -->',
    ".t { color: red\u0001 }",
    1,
  );
  const text = wellFormed(svg).documentElement.textContent!;
  // The words stay, a Word element giving way to its content.
  assert.match(text, /Pasted from Word/);
  assert.match(text, /Bonjourà tous/);
  assert.match(text, /gras/);
  assert.doesNotMatch(svg, /o:p|o:spid|@click|a -- b/);
  assert.match(svg, /title="ab"/);
});

test("A lone surrogate is dropped, a character outside the BMP kept", () => {
  const svg = pageSvg(PAGE, "<p>a\uD83Db 🌱</p>", "", 1);
  assert.match(wellFormed(svg).documentElement.textContent!, /ab 🌱/);
  assert.doesNotThrow(() => encodeURIComponent(svg));
});

test("A clean poster, SVG drawings with xlink:href and xml:lang included, comes through whole", () => {
  const html = '<div class="p" xml:lang="fr"><h1>Règles &amp; vie</h1><div class="drawing"><svg viewBox="0 0 10 10"><defs><circle id="c" r="2"/></defs><use xlink:href="#c"/></svg></div><img src="data:image/png;base64,AAAA" alt="x"></div>';
  const svg = pageSvg(PAGE, html, ".p > h1 { color: #333 }", 1);
  const parsed = wellFormed(svg);
  assert.equal(parsed.getElementsByTagName("use")[0]!.getAttributeNS("http://www.w3.org/1999/xlink", "href"), "#c");
  assert.match(svg, /xml:lang="fr"/);
  assert.match(svg, /\.p &gt; h1|\.p > h1/);
  assert.equal(parsed.getElementsByTagName("img").length, 1);
  assert.match(parsed.documentElement.textContent!, /Règles & vie/);
});

test("A page the browser does not draw is said with its likely cause: its XML error, else its size and pictures", () => {
  assert.match(whyNotDrawn('<svg xmlns="http://www.w3.org/2000/svg"><p>a<o:p></o:p></p></svg>'), /^its markup is not well-formed XML: \S/);
  const page = pageSvg(PAGE, '<img src="data:image/png;base64,AAAA"><img src="data:image/png;base64,AAAA">', "", 1);
  assert.match(whyNotDrawn(page), /^a page of 0\.0 MB with 2 pictures$/);
});
