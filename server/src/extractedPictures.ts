/**
 * The pictures an extraction found: how they are named in the text, and what it
 * costs to hand their bytes to the model.
 *
 * Every extractor here used to drop pictures without a trace. The description said
 * so, but a caller summarising a report could not know it had missed the chart the
 * report was written around — a silence the reader has no way to detect. So a
 * picture is always *named* where it sits, and that is free; its bytes travel only
 * when asked for, and that is not.
 *
 * BUDGET — the reason this module exists rather than a few lines in each tool.
 * Extraction is predictable today: its cost follows a document's text, and callers
 * rely on that. Image bytes do not follow anything — one 300 dpi scan is megabytes.
 * Three ceilings keep an innocuous call from exploding, and every one of them is
 * *stated* when it bites. Silent truncation is the failure the extraction tools
 * already work to avoid for text; pictures get the same treatment.
 */

import { Type } from "typebox";

/** A picture an extractor found, before any decision about returning its bytes. */
export interface FoundPicture {
  /** 1-based position in document order. This is the identifier a caller names. */
  number: number;
  /** As the reader should see it: "PNG", "JPEG", "SVG", "EMF". */
  format: string;
  /** Pixel dimensions, when the format states them. */
  width?: number;
  height?: number;
  /** The document's own alternative text, when it declares one. */
  alt?: string;
  /** The bytes to return, already in a form the model can be shown. */
  bytes?: Buffer;
  /** Media type of `bytes`, e.g. "image/png". */
  mimeType?: string;
  /**
   * Why the bytes cannot travel. Set for a format nothing here can turn into an
   * image, a part that is missing, or a stream that would not decode. A picture
   * with this set is still marked — the whole point is that nothing is passed over
   * in silence, whatever the reason.
   */
  unavailable?: string;
}

/**
 * Called when a reader meets a picture, to get the marker that stands in its place.
 *
 * The marker names the picture's format and pixel dimensions, which only its bytes
 * can say — so the caller resolves the relationship and reads the part, and the
 * parser stays a parser. Returning `""` leaves the picture unmarked, for a reference
 * that turns out not to be a picture at all.
 */
export type PictureMarker = (reference: { relationshipId: string; alt?: string; name?: string }) => string;

/** At most this many pictures in one answer, matching the page cap on rendering. */
export const MAX_PICTURES_PER_CALL = 8;
/** At most this many bytes of pictures in one answer. */
export const MAX_PICTURE_BYTES_PER_CALL = 4 * 1024 * 1024;
/**
 * A single picture above this is not returned by `"all"`, only when named.
 *
 * Measured on the encoded bytes, not a decoded bitmap: a photograph that would be
 * 18 MB as raw RGB passes comfortably once encoded, while a full-page scan of text
 * stays a lossless PNG and may genuinely exceed this — correctly, and it remains
 * reachable on its own. Without this ceiling one such scan eats the call budget and
 * starves every picture after it.
 */
export const MAX_ONE_PICTURE_BYTES = 2 * 1024 * 1024;
/** Past this many pictures the markers give way to a count, so text stays readable. */
export const MAX_MARKERS = 24;

/** What the caller asked for: nothing, everything within budget, or these pictures. */
export type PictureRequest = "none" | "all" | string[];

/**
 * The marker written where a picture sits.
 *
 * Deliberately not markdown image syntax. `![alt](picture-3)` would put a token
 * where a path belongs, and `docx_create` resolves a markdown image's source as a
 * real file: a round trip through it would look for a file named `picture-3`, fail
 * to find it, and — by that tool's own rule — leave the picture out and write the
 * alt text instead. The picture would vanish silently, which is the defect this
 * module exists to remove. A bracketed line fails loudly: it stays as text.
 */
export function pictureMarker(picture: FoundPicture): string {
  const parts = [picture.format];
  if (picture.width !== undefined && picture.height !== undefined) {
    parts.push(`${picture.width}×${picture.height}`);
  }
  let marker = `[picture ${picture.number}: ${parts.join(" ")}`;
  if (picture.alt !== undefined && picture.alt.trim() !== "") marker += ` — "${cleanAlt(picture.alt)}"`;
  if (picture.unavailable !== undefined) marker += `; ${picture.unavailable}`;
  return `${marker}]`;
}

/**
 * Alt text reduced to one line that cannot break the marker.
 *
 * A `]` inside would end the marker early and leave the rest as loose prose, and a
 * newline would split it across blocks. Capped too: alt text is occasionally a
 * paragraph, and a marker is a label.
 */
function cleanAlt(alt: string): string {
  const flat = alt.replace(/[\r\n\t]+/g, " ").replace(/[[\]]/g, "").replace(/"/g, "'").replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119).trimEnd()}…` : flat;
}

/**
 * The markers for a set of pictures, collapsing to a count past `MAX_MARKERS`.
 *
 * A deck of two hundred screenshots would otherwise turn the text into a wall of
 * labels, and the default path — markers and no bytes — is the one every existing
 * caller is already on.
 */
export function pictureMarkers(pictures: FoundPicture[]): string[] {
  if (pictures.length <= MAX_MARKERS) return pictures.map(pictureMarker);
  const shown = pictures.slice(0, MAX_MARKERS).map(pictureMarker);
  const rest = pictures.length - MAX_MARKERS;
  shown.push(`[and ${rest} further picture${rest === 1 ? "" : "s"}, numbered ${MAX_MARKERS + 1}–${pictures.length}]`);
  return shown;
}

/**
 * A caller's identifier, as a picture number.
 *
 * Lenient on purpose: the marker reads `picture 3`, and a caller may pass that,
 * `picture-3`, or `3`. Refusing a reasonable spelling of a number it just read back
 * would be a puzzle, not a safeguard.
 */
export function pictureNumberOf(identifier: string): number | undefined {
  const match = /^\s*(?:picture[\s-]*)?(\d+)\s*$/i.exec(identifier);
  if (match === null) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export interface PictureSelection {
  /** Pictures whose bytes the answer carries, in document order. */
  returned: FoundPicture[];
  /** Sentences naming what did not travel and how to ask for it. */
  notes: string[];
}

/**
 * Which pictures travel, and what to say about the rest.
 *
 * Refuses an identifier that names no picture rather than quietly returning less
 * than was asked for: a caller that mistyped a number should learn it, not read an
 * answer that looks complete.
 */
export function selectPictures(pictures: FoundPicture[], request: PictureRequest): PictureSelection {
  if (request === "none") return { returned: [], notes: [] };

  let wanted: FoundPicture[];
  if (request === "all") {
    wanted = pictures;
  } else {
    const byNumber = new Map(pictures.map((picture) => [picture.number, picture]));
    const unknown: string[] = [];
    wanted = [];
    for (const identifier of request) {
      const number = pictureNumberOf(identifier);
      const picture = number === undefined ? undefined : byNumber.get(number);
      if (picture === undefined) unknown.push(identifier);
      else wanted.push(picture);
    }
    if (unknown.length > 0) {
      const named = unknown.map((one) => `"${one}"`).join(", ");
      throw new Error(
        pictures.length === 0
          ? `No picture ${named} — this document holds no pictures.`
          : `No picture ${named}. This document holds ${pictures.length}, numbered 1–${pictures.length}.`,
      );
    }
  }

  const named = request !== "all";
  const returned: FoundPicture[] = [];
  const notes: string[] = [];
  const tooBig: number[] = [];
  let bytesSoFar = 0;
  let cappedAt: number | undefined;

  for (const picture of wanted) {
    if (picture.bytes === undefined) continue; // Its marker already says why.
    // A picture named outright is returned however large it is: that is the way
    // back for one the budget withheld, and refusing it would leave no way at all.
    if (!named && picture.bytes.length > MAX_ONE_PICTURE_BYTES) {
      tooBig.push(picture.number);
      continue;
    }
    if (returned.length >= MAX_PICTURES_PER_CALL || bytesSoFar + picture.bytes.length > MAX_PICTURE_BYTES_PER_CALL) {
      cappedAt ??= picture.number;
      continue;
    }
    returned.push(picture);
    bytesSoFar += picture.bytes.length;
  }

  if (tooBig.length > 0) {
    notes.push(
      `Picture${tooBig.length === 1 ? "" : "s"} ${tooBig.join(", ")} ${tooBig.length === 1 ? "is" : "are"} over ` +
        `${Math.round(MAX_ONE_PICTURE_BYTES / (1024 * 1024))} MB and did not travel with the rest. ` +
        `Ask for ${tooBig.length === 1 ? "it" : "them"} by number to get ${tooBig.length === 1 ? "it" : "them"}.`,
    );
  }
  if (cappedAt !== undefined) {
    const left = wanted.filter((picture) => picture.bytes !== undefined && !returned.includes(picture) && !tooBig.includes(picture.number));
    notes.push(
      `${left.length} further picture${left.length === 1 ? "" : "s"} did not fit this answer ` +
        `(at most ${MAX_PICTURES_PER_CALL} pictures and ${Math.round(MAX_PICTURE_BYTES_PER_CALL / (1024 * 1024))} MB per call). ` +
        `Ask for them by number, starting at ${cappedAt}.`,
    );
  }
  return { returned, notes };
}

/* ── The tool surface ───────────────────────────────────────────────────────── */

/**
 * The `images` parameter, shared so the three readers cannot drift apart on it.
 *
 * One parameter rather than a flag beside a list: two knobs can disagree, and a
 * caller acting on a marker it just read wants to name that picture, not set a mode
 * and a filter. `"none"` is the default because an existing call must not start
 * receiving bytes it never asked for.
 */
export const imagesParameter = Type.Optional(
  Type.Union([Type.Literal("none"), Type.Literal("all"), Type.Array(Type.String())], {
    description:
      'Pictures to return as images: "none" (the default) marks them in the text only, "all" returns every one within the per-call budget, ' +
      'or a list of the numbers the markers carry (["3", "7"]) to return just those — which is also how to get one the budget held back.',
  }),
);

/** What a tool returns: its text, then the pictures that travelled, each announced. */
export type PictureContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Turns SVG bytes into a raster, or `null` where it cannot. Injected, as elsewhere. */
export type SvgRasteriser = (svg: Buffer, width: number, height: number) => Promise<Buffer | null>;

/** Widest a rasterised vector picture is drawn: enough to read, bounded whatever it declares. */
const RASTER_WIDTH = 1200;

/**
 * The content blocks for a call's pictures, and the lines to add to its answer.
 *
 * Each picture is introduced by its own marker before the bytes arrive, so a reader
 * of the transcript can tell which image is which — an unannounced run of pictures
 * is unreadable the moment there is more than one.
 *
 * A vector picture is rasterised *here* rather than when the document was read: the
 * default asks for no bytes at all, and rasterising every SVG in a document nobody
 * wanted pictures from is work for nothing. It also keeps the marker honest without
 * rewriting it — the marker names the format and the size the file declares, which
 * stays true whether the raster succeeds or not, and a failure is reported in a note
 * beside the answer instead.
 */
export async function pictureContentFor(
  pictures: FoundPicture[],
  request: PictureRequest,
  rasterizeSvg?: SvgRasteriser,
): Promise<{ blocks: PictureContent[]; notes: string[] }> {
  const { returned, notes } = selectPictures(pictures, request);
  const blocks: PictureContent[] = [];
  const failed: number[] = [];
  for (const picture of returned) {
    let bytes = picture.bytes!;
    let mimeType = picture.mimeType ?? "image/png";
    if (mimeType === "image/svg+xml") {
      const ratio = picture.width !== undefined && picture.height !== undefined && picture.width > 0 ? picture.height / picture.width : 1;
      const raster = rasterizeSvg === undefined ? null : await rasterizeSvg(bytes, RASTER_WIDTH, Math.max(1, Math.round(RASTER_WIDTH * ratio)));
      if (raster === null) {
        failed.push(picture.number);
        continue;
      }
      bytes = raster;
      mimeType = "image/png";
    }
    blocks.push({ type: "text", text: pictureMarker(picture) });
    blocks.push({ type: "image", data: bytes.toString("base64"), mimeType });
  }
  if (failed.length > 0) {
    notes.push(
      `Picture${failed.length === 1 ? "" : "s"} ${failed.join(", ")} ${failed.length === 1 ? "is" : "are"} a vector drawing ` +
        `that could not be turned into an image here, so ${failed.length === 1 ? "its" : "their"} bytes did not travel. ` +
        `The text still names ${failed.length === 1 ? "it" : "them"}.`,
    );
  }
  return { blocks, notes };
}
