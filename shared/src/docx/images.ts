/**
 * Pictures a Word document carries, as the mapping receives them.
 *
 * Producing them is the one thing the browser and the server do differently — the
 * browser draws mermaid and fetches workspace files over HTTP, the server reads the
 * sandbox — so the mapping takes them from whoever calls it, in these shapes.
 */

/** A drawn vector and the raster behind it, with its size in pixels. */
export type DiagramImage = {
  svg: string;
  png: Uint8Array;
  width: number;
  height: number;
};

/** The raster formats the writer can embed as themselves. */
export type RasterType = "png" | "jpg" | "gif" | "bmp";

/**
 * A loaded reference, ready to be drawn.
 *
 * A vector arrives as a `DiagramImage` — the very type a rendered diagram produces —
 * so the two go into the package through one embedding rule rather than two. A
 * raster keeps its own bytes and its own format: it is already the picture.
 */
export type ReferencedImage =
  | { kind: "vector"; image: DiagramImage }
  | { kind: "raster"; type: RasterType; bytes: Uint8Array; width: number; height: number };

/**
 * How the caller produces pictures.
 *
 * `imageKey` says which file a reference means, or `undefined` for a reference that is
 * not the caller's to load (an absolute URL, a data URI) — two references with one key
 * are loaded once. Without `renderDiagram`, a mermaid fence stays its source, as code.
 */
export type PictureSource = {
  imageKey?: (src: string) => string | undefined;
  loadImage?: (src: string) => Promise<ReferencedImage | undefined>;
  renderDiagram?: (source: string, id: string) => Promise<DiagramImage>;
};
