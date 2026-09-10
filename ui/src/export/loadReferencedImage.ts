/**
 * A picture the document points at, fetched so the export can carry it.
 *
 * The agent is given a tool to write a figure to a path *so that a document can
 * reference it*; a reader who takes that document away as Word and finds the
 * figure replaced by the words "The whole architecture" has lost the thing the
 * tool exists to produce. This module is what turns such a reference into bytes
 * the writer can embed.
 *
 * Two rules govern it, and both are about not drifting from what the reader saw:
 *
 * - Which references are eligible, and how they resolve, is decided by the same
 *   two helpers the viewer's `img` uses — `isExternalRef` and
 *   `resolveRelativeHref` — so a figure that draws on screen and a figure that
 *   travels in the export cannot become different pictures.
 * - Nothing is fetched off the origin that served the application. A reference
 *   carrying a scheme, or a protocol-relative one, is not loadable at all; that
 *   is checked from the URL alone, before any request exists to be made.
 */
import { isExternalRef, rawFileUrl, resolveRelativeHref } from "../util/workspacePath";
import {
  DiagramError,
  inlineStyles,
  rasterise,
  svgDimensions,
  withExplicitSize,
  type DiagramImage,
} from "./mermaidToImage";

/** The raster formats the writer can embed as themselves. */
export type RasterType = "png" | "jpg" | "gif" | "bmp";

/**
 * A loaded reference, ready to be drawn.
 *
 * A vector arrives as a `DiagramImage` — the very type a rendered diagram
 * produces — so the two go into the package through one embedding rule rather
 * than two. A raster keeps its own bytes and its own format: it is already the
 * picture, and redrawing it would only lose quality.
 */
export type ReferencedImage =
  | { kind: "vector"; image: DiagramImage }
  | { kind: "raster"; type: RasterType; bytes: Uint8Array; width: number; height: number };

/**
 * Whether this reference is a workspace file the export may load.
 *
 * The viewer's own test, and deliberately the same expression: anything with a
 * scheme (`https:`, `data:`) or a protocol-relative `//host/x.svg` is somebody
 * else's to serve, and keeps its alt text.
 */
export function isLoadableReference(src: string): boolean {
  return src !== "" && !isExternalRef(src);
}

/**
 * Where the bytes of a reference live, or `undefined` for one that is not ours.
 *
 * The seam the viewer and the export share: this builds exactly the URL the
 * viewer's `img` builds for the same document and the same reference.
 */
export function referenceUrl(
  docPath: string,
  src: string,
  serverUrl: string,
  token: string | null,
): string | undefined {
  if (!isLoadableReference(src)) return undefined;
  return rawFileUrl(serverUrl, resolveRelativeHref(docPath, src), token);
}

/**
 * The reference as a picture, or `undefined` when it cannot be had.
 *
 * Every failure is the same failure to the caller — a file that is gone, a path
 * the server refuses, bytes that are not an image the writer knows, an SVG the
 * browser will not draw. The reference falls back to its alt text and the rest of
 * the document is unaffected, which is the rule diagrams already follow.
 */
export async function loadReference(
  docPath: string,
  src: string,
  serverUrl: string,
  token: string | null,
): Promise<ReferencedImage | undefined> {
  const url = referenceUrl(docPath, src, serverUrl, token);
  if (url === undefined) return undefined;
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return await decodeReference(new Uint8Array(await response.arrayBuffer()));
  } catch {
    // A refused request, a server that has gone away, a body that never arrived:
    // the document is worth more than the picture.
    return undefined;
  }
}

/** The bytes as a picture, whichever kind they turn out to be. */
export async function decodeReference(bytes: Uint8Array): Promise<ReferencedImage | undefined> {
  if (looksLikeSvg(bytes)) return vectorReference(new TextDecoder().decode(bytes));
  const raster = rasterHeader(bytes);
  return raster === undefined ? undefined : { kind: "raster", ...raster, bytes };
}

/** An SVG announces itself in its first bytes, before any XML prologue is past. */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).toLowerCase();
  return head.includes("<svg");
}

/**
 * A vector reference, embedded the way a rendered diagram is.
 *
 * Same order as `renderDiagram`, and for the same reasons: the raster is drawn
 * from the styled original, because a browser applies the CSS and the fallback is
 * correct either way; only the vector — which travels to readers that do not run
 * a stylesheet — needs its appearance written into the shapes.
 */
async function vectorReference(source: string): Promise<ReferencedImage | undefined> {
  try {
    const { width, height } = svgSize(source);
    const sized = withExplicitSize(source, width, height);
    const png = await rasterise(sized, width, height);
    return { kind: "vector", image: { svg: inlineStyles(sized), png, width, height } };
  } catch {
    return undefined;
  }
}

/**
 * How big a workspace SVG is.
 *
 * A figure this project writes carries a `viewBox`, which is what `svgDimensions`
 * reads. A hand-written one in the workspace may instead state `width` and
 * `height` on its root and no viewBox at all, and that file draws perfectly well
 * in the viewer — so the export reads those too rather than refusing a picture the
 * reader can see.
 */
export function svgSize(source: string): { width: number; height: number } {
  try {
    return svgDimensions(source);
  } catch {
    const opening = /<svg\b[^>]*>/.exec(source);
    const width = attributeLength(opening?.[0] ?? "", "width");
    const height = attributeLength(opening?.[0] ?? "", "height");
    if (width === undefined || height === undefined) {
      throw new DiagramError("the referenced svg states no size");
    }
    return { width, height };
  }
}

/** A root attribute as a number of pixels; a percentage is not a size. */
function attributeLength(tag: string, name: string): number | undefined {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  if (value === undefined) return undefined;
  const number = Number.parseFloat(value.replace(/px$/i, ""));
  return Number.isFinite(number) && number > 0 && !value.includes("%") ? number : undefined;
}

/**
 * The format and pixel size of a raster, read from its header.
 *
 * Read rather than decoded: the dimensions of a PNG, JPEG, GIF or BMP are stated
 * in the first bytes of the file, so this is a pure function over bytes that
 * needs no canvas — and can therefore be tested where the export's other
 * picture code cannot be. Anything whose header is not one of the four the
 * writer can embed (a WebP, an AVIF, a text file with a `.png` name) is reported
 * as no picture at all, and the reference keeps its alt text.
 */
export function rasterHeader(
  bytes: Uint8Array,
): { type: RasterType; width: number; height: number } | undefined {
  return pngHeader(bytes) ?? gifHeader(bytes) ?? bmpHeader(bytes) ?? jpegHeader(bytes);
}

function beUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function leUint16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function leInt32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) | 0;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function pngHeader(bytes: Uint8Array): { type: RasterType; width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined;
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return undefined;
  // The IHDR chunk is required to be first, and its width and height open it.
  return sized("png", beUint32(bytes, 16), beUint32(bytes, 20));
}

function gifHeader(bytes: Uint8Array): { type: RasterType; width: number; height: number } | undefined {
  if (bytes.length < 10) return undefined;
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (head !== "GIF87a" && head !== "GIF89a") return undefined;
  return sized("gif", leUint16(bytes, 6), leUint16(bytes, 8));
}

function bmpHeader(bytes: Uint8Array): { type: RasterType; width: number; height: number } | undefined {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return undefined;
  // A negative height means the rows are stored top-down; the picture is that
  // many pixels tall either way.
  return sized("bmp", Math.abs(leInt32(bytes, 18)), Math.abs(leInt32(bytes, 22)));
}

/** The frame headers that state a JPEG's size; every other segment is skipped. */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegHeader(bytes: Uint8Array): { type: RasterType; width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 9 < bytes.length) {
    // Segments are byte-aligned but padding `ff`s are legal between them.
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (JPEG_FRAME_MARKERS.has(marker)) {
      // Length, precision, then height before width — the one place in these four
      // formats where the two are the other way round.
      return sized("jpg", (bytes[at + 7] << 8) | bytes[at + 8], (bytes[at + 5] << 8) | bytes[at + 6]);
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return undefined;
    at += 2 + length;
  }
  return undefined;
}

/** A picture with no width or height is not a picture the export can size. */
function sized(
  type: RasterType,
  width: number,
  height: number,
): { type: RasterType; width: number; height: number } | undefined {
  return width > 0 && height > 0 ? { type, width, height } : undefined;
}
