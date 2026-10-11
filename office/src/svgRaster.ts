/**
 * The raster behind a vector picture, drawn with resvg.
 *
 * Word 2016+ and PowerPoint 2016+ draw the SVG; LibreOffice, Google Docs and older
 * Office draw this PNG instead. resvg rather than a canvas: a canvas draw ignores SVG
 * markers and `dominant-baseline`, so Mermaid's arrowheads vanished and its labels
 * rose out of their boxes; resvg applies them, and a stylesheet too.
 *
 * SECURITY: resvg is given the SVG as a string and no resource directory, so an
 * `href` to a file or a URL inside it loads nothing.
 */
import { createRequire } from "node:module";

/** How much larger the raster is drawn than the vector, so it is not soft — as the viewer's export. */
export const RASTER_SCALE = 2;

/** Raised when the picture cannot be drawn: the caller refuses rather than writing a blank one. */
export class RasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterError";
  }
}

type ResvgConstructor = new (svg: string, options: Record<string, unknown>) => { render(): { asPng(): Uint8Array } };

let resvg: ResvgConstructor | undefined;

/** The first family of a CSS font list, unquoted: the one resvg falls back to. */
export function firstFamily(font: string): string {
  return font.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

/** The SVG drawn on white at `RASTER_SCALE`, as a PNG. `font` names the family text without one is drawn in. */
export function rasterizeSvg(svg: string, font: string): Uint8Array {
  resvg ??= (createRequire(import.meta.url)("@resvg/resvg-js") as { Resvg: ResvgConstructor }).Resvg;
  try {
    return new resvg(svg, {
      // A white ground, as the viewer's export: a transparent PNG prints as grey
      // blotches in some readers.
      background: "#ffffff",
      fitTo: { mode: "zoom", value: RASTER_SCALE },
      font: { loadSystemFonts: true, defaultFontFamily: firstFamily(font) },
    })
      .render()
      .asPng();
  } catch (error) {
    throw new RasterError(`the picture could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
  }
}
