/**
 * A draw.io page as a poster picture (poster-drawio-pictures, design 2 and 6).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_DIAGRAM_SVG_BYTES, diagramPicture } from "../src/diagrams.ts";

describe("diagramPicture", () => {
  test("is the SVG as a base64 data URL, with the size draw.io gave it", () => {
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" style="background: #fff" width="561px" height="111px" viewBox="-0.5 -0.5 561 111"><text>Client — é</text></svg>';
    const picture = diagramPicture(svg);
    assert.equal(picture.width, 561);
    assert.equal(picture.height, 111);
    assert.match(picture.src, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/);
    // Decoded as UTF-8, the labels' accents and dashes come back intact.
    assert.equal(Buffer.from(picture.src.split(",")[1]!, "base64").toString("utf8"), svg);
  });

  test("reads the size from the viewBox when the SVG names none", () => {
    assert.deepEqual(
      (({ width, height }) => ({ width, height }))(diagramPicture('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"></svg>')),
      { width: 300, height: 150 },
    );
  });

  test("refuses what is no picture, or one too large for a poster, saying why", () => {
    assert.throws(() => diagramPicture("<html></html>"), /drew no picture/);
    assert.throws(() => diagramPicture('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), /has no size/);
    const large = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${"x".repeat(MAX_DIAGRAM_SVG_BYTES)}</svg>`;
    assert.throws(() => diagramPicture(large), /more than a poster takes \(2 MB\)/);
  });
});
