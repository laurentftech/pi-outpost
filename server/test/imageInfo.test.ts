/**
 * What a picture is and its proportions, from its bytes — and the SVGs refused
 * because drawing them would mean fetching something.
 */
import assert from "node:assert/strict";
import { deflateSync, crc32 } from "node:zlib";
import { describe, test } from "node:test";
import { ImageError, readImageInfo } from "../src/imageInfo.ts";

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(1))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A JPEG with an APP0 segment before its baseline frame header. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function gif(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.write("GIF89a", 0, "latin1");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return header;
}

const svg = (attributes: string, body = "") => Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`);

describe("readImageInfo", () => {
  test("reads the size of a PNG, a JPEG and a GIF from their headers", () => {
    assert.deepEqual(readImageInfo(png(640, 480), "a.png"), { kind: "png", width: 640, height: 480 });
    assert.deepEqual(readImageInfo(jpeg(1920, 1080), "b.jpg"), { kind: "jpeg", width: 1920, height: 1080 });
    assert.deepEqual(readImageInfo(gif(32, 16), "c.gif"), { kind: "gif", width: 32, height: 16 });
  });

  test("believes the bytes, not the name", () => {
    assert.equal(readImageInfo(png(10, 10), "photo.jpg").kind, "png");
  });

  test("sizes an SVG from width and height, from its viewBox, or from both", () => {
    assert.deepEqual(readImageInfo(svg('width="200" height="100"'), "a.svg"), { kind: "svg", width: 200, height: 100 });
    assert.deepEqual(readImageInfo(svg('viewBox="0 0 400 100"'), "b.svg"), { kind: "svg", width: 400, height: 100 });
    // Percentages say nothing absolute: the viewBox decides.
    assert.deepEqual(readImageInfo(svg('width="100%" height="100%" viewBox="0 0 30 10"'), "c.svg"), { kind: "svg", width: 30, height: 10 });
    // One absolute side and a viewBox: the other follows from the ratio.
    assert.deepEqual(readImageInfo(svg('width="90" viewBox="0 0 30 10"'), "d.svg"), { kind: "svg", width: 90, height: 30 });
    assert.deepEqual(readImageInfo(svg('width="1in" height="2in"'), "e.svg"), { kind: "svg", width: 96, height: 192 });
    // Nothing stated: SVG's default viewport.
    assert.deepEqual(readImageInfo(svg(""), "f.svg"), { kind: "svg", width: 300, height: 150 });
  });

  test("finds the <svg> tag after a prolog, and a hostile prolog costs no time", () => {
    const prolog = `<?xml version="1.0"?>\n<!-- made by hand -->\n`;
    assert.equal(readImageInfo(Buffer.from(`${prolog}<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"/>`), "p.svg").kind, "svg");
    // The shape CodeQL named: a comment opener followed by many close-and-reopen pairs.
    const hostile = Buffer.from(`<!--${"--><!--".repeat(20_000)}`);
    const started = Date.now();
    assert.throws(() => readImageInfo(hostile, "h.svg"), /not a PNG, JPEG, GIF or SVG/);
    assert.ok(Date.now() - started < 1000, "sniffed in linear time");
  });

  test("allows references inside the SVG itself", () => {
    const body = '<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/><image href="data:image/png;base64,AAAA"/>';
    assert.equal(readImageInfo(svg('viewBox="0 0 1 1"', body), "ok.svg").kind, "svg");
  });

  test("refuses an SVG that would make its renderer fetch something", () => {
    for (const body of [
      '<image href="https://example.com/x.png"/>',
      '<image xlink:href="file:///etc/passwd"/>',
      '<image href="../secret.png"/>',
      '<rect style="fill: url(http://example.com/p)"/>',
      "<style>@import 'https://example.com/a.css';</style>",
    ]) {
      assert.throws(() => readImageInfo(svg('viewBox="0 0 1 1"', body), "x.svg"), ImageError, body);
    }
  });

  test("refuses an SVG with a DOCTYPE, where entities could be declared", () => {
    const text = Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.throws(() => readImageInfo(text, "x.svg"), /DOCTYPE/);
  });

  test("refuses what is not a picture, and a picture with no size", () => {
    assert.throws(() => readImageInfo(Buffer.from("just text"), "notes.png"), /not a PNG, JPEG, GIF or SVG/);
    assert.throws(() => readImageInfo(png(0, 10), "zero.png"), /no usable size/);
    assert.throws(() => readImageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "cut.jpg"), /without a frame size/);
  });
});
