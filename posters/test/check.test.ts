/**
 * The poster check, from the text alone. The scenarios are poster-files'
 * (TheAgentChecksThePostersItWrites); the files frames name are opened by the server tool,
 * tested in server/test/posterCheckTool.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_DRAWING_BYTES, checkPosterText } from "../src/check.ts";
import { pageOf } from "../src/format.ts";

const poster = (html: string, css = ".p { width: 100%; height: 100%; }") => pageOf("Car", { html, css, format: "slide-16:9" });
const errors = (text: string) => checkPosterText(text).issues.filter((issue) => issue.severity === "error").map((issue) => issue.message);
const warnings = (text: string) => checkPosterText(text).issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message);

// openlore: scenario=APageThatIsNotAPosterIsNamed spec=poster-files
test("APageThatIsNotAPosterIsNamed: each missing marker is the one error, pointing to the skeleton", () => {
  const whole = poster("<p>hi</p>");
  const cases: Array<[string, RegExp]> = [
    [whole.replace(/<meta name="poster-format"[^>]*>/, ""), /no <meta name="poster-format">/],
    [whole.replace("<style data-poster>", "<style>"), /no <style data-poster>/],
    [whole.replace('<div class="poster-page">', "<div>"), /no <div class="poster-page">/],
  ];
  for (const [text, missing] of cases) {
    const check = checkPosterText(text);
    assert.equal(check.format, undefined);
    assert.equal(check.issues.length, 1);
    assert.equal(check.issues[0]!.severity, "error");
    assert.match(check.issues[0]!.message, missing);
    assert.match(check.issues[0]!.message, /The editor will not open it: write it from the skeleton in the posters skill/);
  }
  // The page Gemini wrote: an ordinary HTML page, no marker at all.
  assert.match(errors(`<!DOCTYPE html><html><head><style>body{}</style></head><body><img src="../docs/a.drawio"></body></html>`)[0]!, /this is not a poster/);
});

// openlore: scenario=AFileTheEditorWouldNotDrawIsNamed spec=poster-files
test("AFileTheEditorWouldNotDrawIsNamed: a diagram, a picture file, the web and a stylesheet url, each with what to write", () => {
  const found = errors(
    poster(
      `<img src="../docs/architecture.drawio" alt="a"><img src='../figures/car.svg'><img src="https://example.org/a.png"><div style="background: url(/figures/bg.png)"></div>`,
      `.p { background-image: url("../figures/car.svg"); }`,
    ),
  );
  assert.equal(found.length, 5);
  assert.ok(found.some((message) => message.startsWith("url(../figures/car.svg) in the stylesheet is never drawn") && /data-picture-file="\.\.\/figures\/car\.svg"/.test(message)));
  assert.ok(found.some((message) => message.startsWith('<img src="../docs/architecture.drawio"> is never drawn: a poster fetches nothing') && /<img data-poster-picture="diagram" data-drawio="\.\.\/docs\/architecture\.drawio" alt="…"> with a width and a height, and no src/.test(message)));
  assert.ok(found.some((message) => message.startsWith('<img src="../figures/car.svg">') && /data-picture-file="\.\.\/figures\/car\.svg"/.test(message)));
  assert.ok(found.some((message) => message.startsWith('<img src="https://example.org/a.png"> is never drawn: a poster fetches nothing, from the web or the project') && !/data-picture-file="https/.test(message)));
  assert.ok(found.some((message) => message.startsWith("url(/figures/bg.png) in the style attribute of <div>")));
});

test("What draws in place is no error: embedded pictures, markers, fragments, empty frames, links", () => {
  const html = [
    `<img src="data:image/png;base64,iVBOR" alt="sun">`,
    `<img src="poster-picture:2" alt="bread">`,
    `<img data-poster-picture="soup" alt="soup">`,
    `<div class="drawing"><svg viewBox="0 0 10 10"><defs><circle id="c" r="2"/></defs><use href="#c"/></svg></div>`,
    `<a href="https://example.org">a link stays text</a>`,
  ].join("");
  assert.deepEqual(checkPosterText(poster(html, `.p { background: url(data:image/svg+xml;utf8,x) }`)).issues, []);
});

test("An @import in the stylesheet is named", () => {
  assert.match(errors(poster("<p>x</p>", `@import url("https://fonts.example/a.css"); .p {}`)).join("\n"), /holds an @import/);
});

// openlore: scenario=WhatTheEditorRemovesIsNamed spec=poster-files
test("WhatTheEditorRemovesIsNamed: event attributes, frames and links to other pages", () => {
  const found = errors(poster(`<button onclick="go()">Go</button><iframe></iframe><link rel="stylesheet">`));
  assert.equal(found.length, 3);
  assert.match(found[0]!, /the onclick attribute on <button> is removed by the editor: nothing runs in a poster/);
  assert.match(found[1]!, /<iframe> is removed by the editor/);
  assert.match(found[2]!, /<link> is removed by the editor/);
});

test("A script is refused as the page is", () => {
  assert.match(errors(poster("<p>x</p>").replace("<p>x</p>", "<script>1</script>"))[0]!, /a poster holds no script/);
});

// openlore: scenario=AWellFormedPosterPasses spec=poster-files
test("AWellFormedPosterPasses: frames naming a diagram page and a picture file are listed, not errors", () => {
  const check = checkPosterText(
    poster(
      `<img class="d" data-poster-picture="architecture" data-drawio="../docs/architecture.drawio" data-drawio-page="Overview" alt="Architecture"><img data-picture-file="/figures/car.svg" alt="Car"><img data-picture-file="../figures/old.png" src="data:image/png;base64,AA" alt="Old">`,
    ),
  );
  assert.deepEqual(check.issues, []);
  assert.equal(check.format, "slide-16:9");
  assert.deepEqual(check.frames, [
    { kind: "drawio", path: "../docs/architecture.drawio", page: "Overview", name: "architecture", filled: false },
    { kind: "picture", path: "/figures/car.svg", name: "Car", filled: false },
    { kind: "picture", path: "../figures/old.png", name: "Old", filled: true },
  ]);
});

test("AFrameNamingSomethingMissingIsNamed: a frame naming what the editor does not take", () => {
  const found = errors(
    poster(`<img data-drawio="../docs/a.svg" alt="a"><img data-picture-file="../notes.md" alt="b"><img data-picture-file="../docs/c.drawio"><img data-drawio="x.drawio" data-picture-file="x.svg" alt="d">`),
  );
  assert.equal(found.length, 4);
  assert.match(found[0]!, /the frame "a" names "\.\.\/docs\/a\.svg" as its draw\.io diagram, which is not a \.drawio file\. For a picture file, write data-picture-file instead/);
  assert.match(found[1]!, /the frame "b" names "\.\.\/notes\.md" as its picture file, which the editor does not take: SVG, PNG, JPEG, GIF and WebP only\.$/);
  assert.match(found[2]!, /a frame names "\.\.\/docs\/c\.drawio" as its picture file.*For a draw\.io diagram, write data-drawio instead/);
  assert.match(found[3]!, /the frame "d" names both a diagram \(data-drawio\) and a picture file \(data-picture-file\): keep one/);
});

// openlore: scenario=WarningsDoNotFailThePoster spec=poster-files
test("WarningsDoNotFailThePoster: text in a drawing, a large drawing, a page size not the format's", () => {
  const big = `<div class="drawing"><svg viewBox="0 0 10 10"><path d="${"M0 0 L1 1 ".repeat(MAX_DRAWING_BYTES / 10)}"/></svg></div>`;
  const text = poster(`<div class="drawing"><svg viewBox="0 0 10 10"><text x="1" y="5">Car</text></svg></div>${big}`).replace("width: 1280px; height: 720px;", "width: 1536px; height: 864px;");
  assert.deepEqual(errors(text), []);
  const found = warnings(text);
  assert.equal(found.length, 3);
  assert.match(found[0]!, /an SVG drawing holds <text>: the person cannot correct a text inside a drawing/);
  assert.match(found[1]!, /an SVG drawing is \d+ kB, above the 50 kB a drawing should keep under/);
  assert.match(found[2]!, /sizes \.poster-page at 1536 x 864 px, but a slide-16:9 poster is 1280 x 720 px.*width: 1280px; height: 720px/);
});

test("Nested SVGs are one drawing; an unclosed one is still looked at", () => {
  assert.equal(warnings(poster(`<div class="drawing"><svg><svg><text>a</text></svg><rect/></svg></div>`)).length, 1);
  assert.equal(warnings(poster(`<div class="drawing"><svg><text>a</text>`)).length, 1);
});

test("A repeated unclosed tag is checked in linear time", () => {
  const started = performance.now();
  checkPosterText(poster(`<img src="${"<a \"".repeat(20_000)}`));
  assert.ok(performance.now() - started < 2000);
});

test("A repeated unclosed page rule is checked in linear time", () => {
  const started = performance.now();
  checkPosterText(poster("<p>x</p>").replace("</style>", `${".poster-page{{|".repeat(50_000)}</style>`));
  assert.ok(performance.now() - started < 2000);
});

test("A stylesheet repeating url( with none closed is checked in linear time", () => {
  const started = performance.now();
  checkPosterText(poster("<p>x</p>", "url(".repeat(50_000)));
  checkPosterText(poster(`<div style="${"url(".repeat(50_000)}"></div>`));
  assert.ok(performance.now() - started < 2000);
});
