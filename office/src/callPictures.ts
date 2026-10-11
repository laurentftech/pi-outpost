/**
 * Pictures for a document built from one call, where nothing is read from disk or
 * fetched: a picture's bytes travel in the call as a `data:` URI, and a Mermaid
 * fence is drawn by the renderer the caller hands in.
 *
 * The Word mapping treats a picture or a diagram it cannot produce as a local
 * failure: it writes the alt text or the source instead, and goes on. A caller that
 * answers a model cannot leave it there — the model never sees the file, so a
 * picture quietly missing from it is a document that was not written as asked. So
 * every failure is recorded here, with its position, and the caller refuses the
 * call with them (`refusals`).
 */
import type { DiagramImage, PictureSource, ReferencedImage } from "@pi-outpost/shared/docx";
import { ImageError, readImageInfo, type ImageInfo, type ImageKind } from "./imageInfo.ts";
import type { MermaidRenderer } from "./mermaidRender.ts";

/** A picture or a diagram the call cannot have, and why. */
export interface PictureRefusal {
  kind: "picture" | "mermaid";
  /** 1-based, in the order the document holds them, counting each kind on its own. */
  position: number;
  reason: string;
}

/** The picture formats a call may give: the ones every reader draws as they are. */
const ACCEPTED: Record<string, Exclude<ImageKind, "svg">> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
};

/** Default limit on one picture's decoded bytes. */
export const DEFAULT_MAX_IMAGE_BYTES = 1024 * 1024;

export interface CallPicturesOptions {
  /** Draws Mermaid fences; without one, a Mermaid fence is refused. */
  mermaid?: MermaidRenderer;
  maxImageBytes?: number;
  /**
   * Pictures the caller made itself, by the reference that stands for them in the
   * Markdown (a structured-exchange figure, for instance).
   */
  vectors?: ReadonlyMap<string, DiagramImage>;
}

export interface CallPictures {
  source: PictureSource;
  refusals(): PictureRefusal[];
}

function shortened(src: string): string {
  return src.length > 60 ? `${src.slice(0, 57)}…` : src;
}

/** A `data:` URI's media type and bytes, or why it cannot be read. */
function decodeDataUri(src: string): { mediaType: string; bytes: Buffer } | string {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(src);
  if (match === null) return "it is not a well-formed data: URI";
  const mediaType = match[1].trim().toLowerCase();
  if (!match[2].split(";").some((parameter) => parameter.trim().toLowerCase() === "base64")) return "its data is not base64 (write data:image/png;base64,…)";
  const body = match[3].replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return "its base64 data has characters base64 does not use";
  return { mediaType, bytes: Buffer.from(body, "base64") };
}

/**
 * A picture given as a `data:` URI, decoded and checked: a PNG, JPEG or GIF whose bytes
 * are what its media type says, within `maxBytes`. The reason it is refused otherwise,
 * worded for the model that sent it.
 */
export function readPictureDataUri(src: string, maxBytes: number): { bytes: Buffer; info: ImageInfo } | string {
  // No mention of data: URIs here: Codestral read one as something to ask the user for.
  if (!/^data:/i.test(src)) return `"${shortened(src)}" is a web address or a file, and pictures are not fetched: leave it out`;
  const decoded = decodeDataUri(src);
  if (typeof decoded === "string") return decoded;
  const declared = ACCEPTED[decoded.mediaType];
  if (declared === undefined) {
    return decoded.mediaType === "image/svg+xml"
      ? "an SVG picture is not accepted: give a PNG, JPEG or GIF"
      : `"${decoded.mediaType || "no media type"}" is not accepted: give a PNG, JPEG or GIF`;
  }
  if (decoded.bytes.length === 0) return "its data is empty";
  if (decoded.bytes.length > maxBytes) return `it is ${decoded.bytes.length} bytes, over the limit of ${maxBytes}`;
  let info: ImageInfo;
  try {
    info = readImageInfo(decoded.bytes, "the picture");
  } catch (error) {
    if (!(error instanceof ImageError)) throw error;
    return `its bytes are not a ${declared.toUpperCase()} picture`;
  }
  if (info.kind !== declared) return `it is declared ${decoded.mediaType} but its bytes are ${info.kind.toUpperCase()}`;
  return { bytes: decoded.bytes, info };
}

export function callPictures(options: CallPicturesOptions = {}): CallPictures {
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const refusals: PictureRefusal[] = [];
  let pictures = 0;

  const refuse = (kind: PictureRefusal["kind"], position: number, reason: string) => refusals.push({ kind, position, reason });

  const loadImage = async (src: string): Promise<ReferencedImage | undefined> => {
    const vector = options.vectors?.get(src);
    if (vector !== undefined) return { kind: "vector", image: vector };
    const position = ++pictures;
    const picture = readPictureDataUri(src, maxImageBytes);
    if (typeof picture === "string") {
      refuse("picture", position, picture);
      return undefined;
    }
    const { bytes, info } = picture;
    return { kind: "raster", type: info.kind === "jpeg" ? "jpg" : (info.kind as "png" | "gif"), bytes: new Uint8Array(bytes), width: info.width, height: info.height };
  };

  const source: PictureSource = {
    // Every reference is this source's to answer for: one it does not load is refused, not skipped.
    imageKey: (src) => src,
    loadImage,
    async renderDiagram(diagram, id) {
      // The mapping names its fences `docx-export-<index>`, in document order.
      const index = Number(/(\d+)$/.exec(id)?.[1] ?? Number.NaN);
      const position = Number.isFinite(index) ? index + 1 : refusals.filter((refusal) => refusal.kind === "mermaid").length + 1;
      if (options.mermaid === undefined) {
        refuse("mermaid", position, "Mermaid diagrams are not drawn here");
        throw new Error("no Mermaid renderer");
      }
      try {
        return await options.mermaid.render(diagram);
      } catch (error) {
        refuse("mermaid", position, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };

  return { source, refusals: () => [...refusals].sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind < b.kind ? -1 : 1)) };
}
