/**
 * What kind of picture a file holds, and its proportions — read from its bytes.
 *
 * The presentation builder places a picture so it fits its box without being
 * stretched, which needs the picture's aspect ratio, and it declares the picture's
 * media type in the package, which must be the type the bytes really are. The file
 * extension is a claim; the header is the fact, so it is the header that decides.
 *
 * SECURITY: the bytes come from a workspace file the model named. Every scan is
 * bounded by the buffer, and an SVG that points outside itself — a link to another
 * file or a URL — is refused: whatever later draws it (PowerPoint, LibreOffice, the
 * rasteriser here) must not be told to go and fetch something.
 */

export type ImageKind = "png" | "jpeg" | "gif" | "svg";

export interface ImageInfo {
  kind: ImageKind;
  /** Intrinsic size in the image's own units — only the ratio of the two matters. */
  width: number;
  height: number;
}

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

export const IMAGE_CONTENT_TYPES: Record<ImageKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function readImageInfo(bytes: Buffer, name: string): ImageInfo {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return sized("png", bytes.readUInt32BE(16), bytes.readUInt32BE(20), name);
  }
  if (bytes.length >= 10 && (bytes.toString("latin1", 0, 6) === "GIF87a" || bytes.toString("latin1", 0, 6) === "GIF89a")) {
    return sized("gif", bytes.readUInt16LE(6), bytes.readUInt16LE(8), name);
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes, name);
  const head = bytes.toString("utf8", 0, Math.min(bytes.length, 4096));
  if (/<svg[\s>]/i.test(head) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg/i.test(head)) return readSvg(bytes, name);
  throw new ImageError(`"${name}" is not a PNG, JPEG, GIF or SVG image`);
}

function sized(kind: ImageKind, width: number, height: number, name: string): ImageInfo {
  if (!(width > 0) || !(height > 0)) throw new ImageError(`"${name}" declares no usable size`);
  return { kind, width, height };
}

/**
 * The frame size from the first start-of-frame marker. Every segment states its own
 * length, so the walk jumps from one to the next and never reads past the buffer.
 */
function readJpeg(bytes: Buffer, name: string): ImageInfo {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new ImageError(`"${name}" is a damaged JPEG`);
    const marker = bytes[at + 1];
    // Fill bytes and markers that carry no length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2) throw new ImageError(`"${name}" is a damaged JPEG`);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 9 > bytes.length) break;
      return sized("jpeg", bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5), name);
    }
    at += 2 + length;
  }
  throw new ImageError(`"${name}" is a JPEG without a frame size`);
}

/** A length attribute as a number, when it is an absolute one (`120`, `120px`, `3cm`). */
function absoluteLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(value);
  if (match === null) return undefined; // a percentage, or nothing we can measure
  const scale: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  return Number(match[1]) * scale[(match[2] ?? "px").toLowerCase()];
}

function readSvg(bytes: Buffer, name: string): ImageInfo {
  const text = bytes.toString("utf8");
  if (/<!doctype/i.test(text)) throw new ImageError(`"${name}" declares a DOCTYPE, which is refused`);
  // An href to anything but a fragment of this file or inline data names something
  // outside it — the renderer would have to fetch it.
  for (const match of text.matchAll(/(?:^|[\s"'])(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const target = (match[2] ?? match[3] ?? "").trim();
    if (!target.startsWith("#") && !/^data:/i.test(target)) {
      throw new ImageError(`"${name}" refers to "${target}" outside itself; embed it or remove it`);
    }
  }
  if (/url\(\s*['"]?\s*(?!#|data:)[^)'"\s]/i.test(text) || /@import/i.test(text)) {
    throw new ImageError(`"${name}" loads a resource from outside itself; embed it or remove it`);
  }

  const root = /<svg\b([^>]*)>/i.exec(text);
  if (root === null) throw new ImageError(`"${name}" has no <svg> element`);
  const attributes = new Map<string, string>();
  for (const match of root[1].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attributes.set(match[1].toLowerCase(), match[3] ?? match[4] ?? "");
  }
  const viewBox = attributes
    .get("viewbox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = absoluteLength(attributes.get("width"));
  const height = absoluteLength(attributes.get("height"));
  if (width !== undefined && height !== undefined && width > 0 && height > 0) return { kind: "svg", width, height };
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    // One absolute dimension and a viewBox: the other follows from the ratio.
    const ratio = viewBox[2] / viewBox[3];
    if (width !== undefined && width > 0) return { kind: "svg", width, height: width / ratio };
    if (height !== undefined && height > 0) return { kind: "svg", width: height * ratio, height };
    return { kind: "svg", width: viewBox[2], height: viewBox[3] };
  }
  // Neither states a size: the SVG default viewport, 300×150.
  return { kind: "svg", width: 300, height: 150 };
}
