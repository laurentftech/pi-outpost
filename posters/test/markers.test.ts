/**
 * Markers in place of embedded pictures, and back (poster-elements: TheModelSeesMarkersNotPictureData,
 * MarkersAreRestoredOnWrite). The hosts' own tests check that their tools apply these.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PosterRefusal } from "../src/format.ts";
import { hidePictures, restorePictures } from "../src/markers.ts";

const BREAD = `data:image/png;base64,${"iVBOR".repeat(4000)}`;
const SUN = `data:image/jpeg;base64,${"/9j/4".repeat(3000)}`;
const PATTERN = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";
const HTML = `<div class="poster"><h1>Menu</h1><img class="slot" data-poster-picture="bread" alt="bread" src="${BREAD}"><img alt="sun" src='${SUN}'><p>Bon appétit</p></div>`;
const CSS = `.poster { background: url(${PATTERN}) repeat; } .slot { width: 260px; }`;

test("hidePictures: every picture becomes a numbered marker, named in an inventory, nothing else changes", () => {
  const hidden = hidePictures(HTML, CSS);
  assert.deepEqual(hidden.pictures, [BREAD, SUN, PATTERN]);
  assert.ok(!hidden.html.includes("base64") && !hidden.css.includes("data:"), "no picture data is left");
  assert.match(hidden.html, /^<!-- poster pictures: poster-picture:1 \(bread\) 15 kB; poster-picture:2 \(sun\) 11 kB; poster-picture:3 \(in the stylesheet\) 1 kB\./);
  assert.ok(hidden.html.endsWith(`<img class="slot" data-poster-picture="bread" alt="bread" src="poster-picture:1"><img alt="sun" src='poster-picture:2'><p>Bon appétit</p></div>`));
  assert.equal(hidden.css, ".poster { background: url(poster-picture:3) repeat; } .slot { width: 260px; }");
});

test("hidePictures: a poster without pictures comes back byte for byte", () => {
  const html = `<div class="poster"><h1>Règles</h1><div class="drawing"><svg viewBox="0 0 10 10"><circle r="4"/></svg></div></div>`;
  const css = ".poster { color: #333; }";
  assert.deepEqual(hidePictures(html, css), { html, css, pictures: [] });
});

// openlore: scenario=TheModelRewritesAPosterAndKeepsItsPictures spec=poster-elements
test("restorePictures: what the model sends back with its markers holds the pictures again", () => {
  const hidden = hidePictures(HTML, CSS);
  const rewritten = hidden.html.replace("Menu", "Our menu");
  const restored = restorePictures(rewritten, hidden.css, hidden.pictures);
  assert.equal(restored.html, HTML.replace("Menu", "Our menu"), "the inventory is gone, the pictures are back");
  assert.equal(restored.css, CSS);
});

test("restorePictures: hiding what was restored gives the same markers, so a second round trip changes nothing", () => {
  const first = hidePictures(HTML, CSS);
  const back = restorePictures(first.html, first.css, first.pictures);
  assert.deepEqual(hidePictures(back.html, back.css), first);
});

test("restorePictures: a picture whose marker the model removed is dropped, the others keep their place", () => {
  const hidden = hidePictures(HTML, CSS);
  const restored = restorePictures(hidden.html.replace(/<img alt="sun"[^>]*>/, ""), hidden.css, hidden.pictures);
  assert.ok(restored.html.includes(BREAD) && !restored.html.includes(SUN));
  assert.equal(restored.css, CSS);
});

// openlore: scenario=AnUnknownMarkerIsRefused spec=poster-elements
test("restorePictures: a marker naming no picture is refused, naming it", () => {
  const hidden = hidePictures(HTML, CSS);
  assert.throws(
    () => restorePictures(`${hidden.html}<img src="poster-picture:7">`, hidden.css, hidden.pictures),
    (error: unknown) => error instanceof PosterRefusal && /poster-picture:7 names no picture of this poster \(it has poster-picture:1 to poster-picture:3\)/.test(error.message),
  );
  assert.throws(() => restorePictures(`<img src="poster-picture:1">`, "", []), /\(it has none\)/);
});

test("restorePictures: a model that wrote no inventory and no marker gets its poster as sent", () => {
  assert.deepEqual(restorePictures("<p>plain</p>", ".p{}", [BREAD]), { html: "<p>plain</p>", css: ".p{}" });
});

test("An inventory repeated many times, or left unclosed, is handled in linear time", () => {
  const hostile = `${"<!-- poster pictures:".repeat(50_000)}<p>x</p>`;
  const started = performance.now();
  assert.deepEqual(restorePictures(hostile, "", []), { html: hostile, css: "" });
  assert.equal(restorePictures("<!-- poster pictures: a --><!-- poster pictures: b -->\n<p>y</p>", "", []).html, "<p>y</p>");
  assert.ok(performance.now() - started < 1000);
});
