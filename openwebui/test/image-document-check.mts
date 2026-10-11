/**
 * Reads create_document's answer from stdin — the page the container embedded — and
 * checks the Word document inside it: one SVG picture per diagram given, each with a
 * PNG behind it that shows something, and the picture given as a data: URI.
 *
 * Used by image.sh, after the container wrote the document: what is checked here is
 * that the image's own Mermaid worker, fonts and rasteriser drew it.
 *
 *   curl … | node --import tsx/esm test/image-document-check.mts <expected diagrams>
 */
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";

const expected = Number(process.argv[2] ?? "1");
const html = await new Response(process.stdin as unknown as ReadableStream).text();
const match = /data-planning="([A-Za-z0-9+/=]*)"/.exec(html);
if (match === null) throw new Error(`no embed in the answer: ${html.slice(0, 300)}`);
const payload = JSON.parse(gunzipSync(Buffer.from(match[1]!, "base64")).toString("utf8"));
if (payload.mode !== "download") throw new Error(`not a download: ${payload.mode}`);
const parts = readAllZipEntries(Buffer.from(payload.data, "base64"), { maxEntries: 2000, maxInflatedBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
const media = [...parts.keys()].filter((name) => name.startsWith("word/media/"));
const svgs = media.filter((name) => name.endsWith(".svg"));
const pngs = media.filter((name) => name.endsWith(".png"));
if (svgs.length !== expected) throw new Error(`${svgs.length} SVG pictures, expected ${expected}: ${media.join(", ")}`);
// One PNG per diagram, behind its SVG, and the picture given in the call.
if (pngs.length !== expected + 1) throw new Error(`${pngs.length} PNG pictures, expected ${expected + 1}: ${media.join(", ")}`);

const canvas = createRequire(import.meta.url)("@napi-rs/canvas") as {
  loadImage(source: Buffer): Promise<{ width: number; height: number }>;
  createCanvas(width: number, height: number): {
    getContext(kind: "2d"): { drawImage(image: unknown, x: number, y: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } };
  };
};
for (const name of pngs) {
  const image = await canvas.loadImage(parts.get(name)!);
  const surface = canvas.createCanvas(image.width, image.height);
  const context = surface.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let inked = 0;
  for (let at = 0; at < data.length; at += 4) if (data[at + 3]! > 0 && (data[at]! < 200 || data[at + 1]! < 200 || data[at + 2]! < 200)) inked++;
  if (inked < 20) throw new Error(`${name} (${image.width}×${image.height}) is blank`);
}
console.log(`document checked: ${svgs.length} diagrams, ${pngs.length} PNG pictures, none blank`);
