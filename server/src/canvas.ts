/**
 * The optional native canvas, and the one thing every reader needs from it.
 *
 * Its own module because of a cycle: the PDF reader has to encode the bitmaps
 * pdf.js hands it, `presentationRender.ts` holds the drawing code, and it already
 * imports the PDF reader to rasterise pages. Whoever needs a canvas cannot reach it
 * through there, so it lives here, where nothing of ours is imported and nothing can
 * depend on this in a circle.
 *
 * `@napi-rs/canvas` is optional — absent from the single-file build and from installs
 * that skip optional dependencies — so every caller has an answer for `null`.
 */
import { createRequire } from "node:module";

export interface NativeCanvas {
  getContext(kind: "2d"): {
    fillStyle: string;
    fillRect(x: number, y: number, w: number, h: number): void;
    drawImage(...args: unknown[]): void;
    putImageData(...args: unknown[]): void;
    createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number };
  };
  encode(format: "png"): Promise<Buffer>;
  encode(format: "jpeg", quality: number): Promise<Buffer>;
}

export interface CanvasModule {
  createCanvas(width: number, height: number): NativeCanvas;
  loadImage(source: Buffer): Promise<{ width: number; height: number }>;
}

export function loadCanvas(): CanvasModule | null {
  try {
    return createRequire(import.meta.url)("@napi-rs/canvas") as CanvasModule;
  } catch {
    return null;
  }
}
