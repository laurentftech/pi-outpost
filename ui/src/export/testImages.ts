/**
 * Real image bytes, for tests.
 *
 * Built rather than checked in, and built properly: a PNG here carries its
 * signature, a valid IHDR with the width and height asked for, deflated pixel
 * data and correct CRCs. A test that embedded a handful of plausible-looking
 * bytes would prove the export copies bytes, not that it carries a picture — and
 * a fake kinder than reality is how this ships broken.
 *
 * Imported by tests alone; no application code reaches this file.
 */
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** A real 8-bit greyscale PNG of the size asked for. */
export function pngBytes(width: number, height: number): Uint8Array {
  // One filter byte per row, then one byte per pixel: the simplest encoding the
  // format allows, which is all a size assertion needs.
  const raw = new Uint8Array((width + 1) * height);
  for (let row = 0; row < height; row += 1) raw[row * (width + 1)] = 0;
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 0, 0, 0, 0], 8);
  return concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** A GIF's header, which is where its size is stated. */
export function gifHeaderBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([...("GIF89a" as string)].map((character) => character.charCodeAt(0)), 0);
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

/** A BMP's file and info headers, up to and including its dimensions. */
export function bmpHeaderBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x42, 0x4d], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  // Negative: rows stored top-down, which is a real and common BMP.
  view.setInt32(22, -height, true);
  return bytes;
}

/** A JPEG up to its frame header, with a comment segment in front of it. */
export function jpegHeaderBytes(width: number, height: number): Uint8Array {
  const comment = concat([Uint8Array.from([0xff, 0xfe, 0x00, 0x04]), Uint8Array.from([0x00, 0x00])]);
  const frame = new Uint8Array(11);
  frame.set([0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  const view = new DataView(frame.buffer);
  view.setUint16(5, height);
  view.setUint16(7, width);
  return concat([Uint8Array.from([0xff, 0xd8]), comment, frame]);
}

/** A self-contained SVG of the size asked for, stating it in a viewBox. */
export function svgSource(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#3366cc"/></svg>`;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  head.set([...type].map((character) => character.charCodeAt(0)), 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([head.subarray(4), data])));
  return concat([head, data, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
