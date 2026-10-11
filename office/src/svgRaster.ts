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
import { existsSync } from "node:fs";
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

type ResvgConstructor = new (
  svg: string,
  options: Record<string, unknown>,
) => { render(): { asPng(): Uint8Array }; getBBox(): { width: number } | undefined | null };

let resvg: ResvgConstructor | undefined;
/** Whether text can be drawn in a font, asked once per font: see `missingFont`. */
const checkedFonts = new Map<string, string | undefined>();

/**
 * Where fonts are looked for, besides the system's own list.
 *
 * resvg finds a Linux system's fonts through fontconfig's configuration, and a slim
 * container has fonts but no such configuration: every label was drawn as nothing,
 * shapes and arrows intact, in a picture that looked complete at a glance.
 */
const FONT_DIRS = ["/usr/share/fonts", "/usr/local/share/fonts"].filter((dir) => existsSync(dir));

function options(font: string): Record<string, unknown> {
  return {
    // A white ground, as the viewer's export: a transparent PNG prints as grey
    // blotches in some readers.
    background: "#ffffff",
    fitTo: { mode: "zoom", value: RASTER_SCALE },
    font: { loadSystemFonts: true, fontDirs: FONT_DIRS, defaultFontFamily: firstFamily(font) },
  };
}

/**
 * Why text would not be drawn in this font, or `undefined` when it would.
 *
 * Asked once per font, of a word on its own: a raster without its labels is refused
 * like a blank one, not written.
 */
function missingFont(font: string): string | undefined {
  if (!checkedFonts.has(font)) {
    const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="4" y="24" font-size="16" font-family="${firstFamily(font)}">Label</text></svg>`;
    const box = new resvg!(probe, options(font)).getBBox();
    checkedFonts.set(font, box && box.width > 0 ? undefined : `no font to draw the picture's text in (looked for ${firstFamily(font)}${FONT_DIRS.length > 0 ? ` and in ${FONT_DIRS.join(", ")}` : ""})`);
  }
  return checkedFonts.get(font);
}

/** The first family of a CSS font list, unquoted: the one resvg falls back to. */
export function firstFamily(font: string): string {
  return font.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

/** The SVG drawn on white at `RASTER_SCALE`, as a PNG. `font` names the family text without one is drawn in. */
export function rasterizeSvg(svg: string, font: string): Uint8Array {
  resvg ??= (createRequire(import.meta.url)("@resvg/resvg-js") as { Resvg: ResvgConstructor }).Resvg;
  const missing = /<text\b/.test(svg) ? missingFont(font) : undefined;
  if (missing !== undefined) throw new RasterError(`the picture could not be drawn: ${missing}`);
  try {
    return new resvg(svg, options(font)).render().asPng();
  } catch (error) {
    throw new RasterError(`the picture could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
  }
}
