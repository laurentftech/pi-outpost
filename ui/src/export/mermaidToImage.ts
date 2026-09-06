/**
 * A diagram, as a picture Word keeps sharp.
 *
 * Word 2016 and later draw SVG, through an extension on the picture: the blip
 * points at a raster, and an extension list beside it points at the vector. Word
 * draws the vector at any zoom; a reader whose application does not know the
 * extension — LibreOffice, Google Docs, Pages, older Word — draws the raster
 * instead of a broken image. Both are therefore written, which is also what the
 * writer's own API requires: an SVG image without a fallback is not expressible.
 *
 * Two hazards shaped what follows, and both produce a plausible-looking result
 * rather than an error:
 *
 *  - `foreignObject` does not render when an SVG is drawn through an `<img>`.
 *    Mermaid uses it for flowchart labels unless told otherwise, so the naive
 *    route yields a diagram whose every label is blank. Hence `htmlLabels: false`.
 *  - Mermaid writes `width="100%"` and no intrinsic size, so a canvas draw of it
 *    comes out empty. The real dimensions live in the `viewBox`.
 */

/** What the export needs of a diagram: the vector, the raster, and its size. */
export type DiagramImage = {
  svg: string;
  png: Uint8Array;
  width: number;
  height: number;
};

/** Raised when a diagram cannot be produced, so the caller can fall back. */
export class DiagramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagramError";
  }
}

/** The diagram's own dimensions, read from the viewBox mermaid does set. */
export function svgDimensions(svg: string): { width: number; height: number } {
  const viewBox = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  const width = viewBox ? Number(viewBox[1]) : Number.NaN;
  const height = viewBox ? Number(viewBox[2]) : Number.NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new DiagramError("diagram has no usable viewBox");
  }
  return { width, height };
}

/**
 * The same SVG, carrying its size.
 *
 * `width="100%"` is what makes a mermaid diagram fill its container on a page and
 * what makes it draw as nothing on a canvas. Replacing it with the viewBox's own
 * numbers gives the image an intrinsic size without changing what it depicts.
 */
export function withExplicitSize(svg: string, width: number, height: number): string {
  /*
   * Only the opening `<svg>` tag is touched, and that is the whole point.
   *
   * An unanchored replace of the first `height="…"` does not find the root's — a
   * mermaid root carries `width="100%"` and no height at all, so the first height
   * in the document belongs to a child. Rewriting that one gave the first node in
   * every diagram the height of the entire drawing: a tall block sitting over the
   * rest of the picture, in the vector and in the raster alike, because both are
   * made from this string.
   */
  const opening = /^[\s\S]*?<svg\b[^>]*>/.exec(svg);
  if (opening === null) return svg;

  const tag = opening[0]
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "")
    // The max-width mermaid sets would shrink the drawing again once it has a size.
    .replace(/\sstyle="[^"]*"/, (style) => {
      const cleaned = style.replace(/max-width:[^;"]*;?/, "");
      return /style="\s*"/.test(cleaned) ? "" : cleaned;
    })
    .replace(/>$/, ` width="${width}" height="${height}">`);

  return tag + svg.slice(opening[0].length);
}

/**
 * The properties that decide what a shape looks like.
 *
 * Deliberately short. Copying every computed property would produce an enormous
 * file and pin things — inherited font metrics, transforms — that are better left
 * to the renderer. These are the ones whose absence turns a diagram black.
 */
const PAINTED = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
] as const;

/**
 * A diagram that carries its own appearance.
 *
 * Mermaid styles a diagram with a `<style>` block and class selectors: the shapes
 * themselves have no `fill` or `stroke` of their own. A browser applies that CSS,
 * so the picture looks right on screen and the raster we draw from it is right
 * too — and every reader that does not run CSS inside an SVG paints all 58 shapes
 * with the default fill, which is black. LibreOffice does exactly that: it
 * supports enough of the SVG extension to use the vector, and not enough to style
 * it, so the diagram arrives as a solid black block. That is worse than the
 * missing-image case the fallback was designed for, because the fallback is never
 * reached.
 *
 * So the styles are resolved here, where a browser is present to resolve them, and
 * written onto each element as presentation attributes. What leaves this function
 * depends on no stylesheet at all.
 */
export function inlineStyles(svg: string): string {
  const holder = document.createElement("div");
  // Off-screen but laid out: `display: none` would make every computed style
  // useless, and the whole point is to read what the browser actually computed.
  holder.setAttribute("style", "position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden");
  holder.innerHTML = svg;
  const root = holder.querySelector("svg");
  if (root === null) return svg;

  document.body.append(holder);
  try {
    const elements = [root, ...root.querySelectorAll<SVGElement>("*")].filter(
      (element) => element.tagName.toLowerCase() !== "style",
    );

    /*
     * Read everything first, change nothing.
     *
     * The two passes are not tidiness. Mermaid's rules are descendant selectors —
     * `.node rect { fill: … }` — so stripping a parent's class in the same walk
     * changes what its children compute, and the children are visited after the
     * parent. Doing both at once produced a diagram whose only colours were the
     * inherited default and `none`: every node background silently lost.
     */
    const resolved = elements.map((element) => {
      const computed = window.getComputedStyle(element);
      const painted: [string, string][] = [];
      for (const property of PAINTED) {
        const value = computed.getPropertyValue(property);
        // `none` for a fill is meaningful and kept; an empty value is not.
        if (value !== "") painted.push([property, value]);
      }
      return { element, painted };
    });

    for (const { element, painted } of resolved) {
      for (const [property, value] of painted) element.setAttribute(property, value);
      // The inline `style` attribute has served its purpose and would otherwise
      // travel into the file, where some readers honour it and others do not.
      element.removeAttribute("style");
      element.removeAttribute("class");
    }
    // The stylesheet is now redundant, and it is what confused the reader.
    for (const style of [...root.querySelectorAll("style")]) style.remove();
    return root.outerHTML;
  } finally {
    holder.remove();
  }
}

/**
 * Mermaid, configured for a printed page rather than for the screen.
 *
 * `mermaid.initialize()` is global to the module, and the viewer's own diagrams
 * share it. Every call here is therefore serialised and restores what it found, so
 * an export cannot leave the on-screen renderer configured for export.
 */
let inFlight: Promise<unknown> = Promise.resolve();

async function exclusively<T>(work: () => Promise<T>): Promise<T> {
  const mine = inFlight.then(work, work);
  // The queue must not reject: a failed export still has to release the next one.
  inFlight = mine.then(
    () => undefined,
    () => undefined,
  );
  return mine;
}

/**
 * A diagram rendered for export.
 *
 * Rendered from its source rather than lifted out of the page: the on-screen SVG
 * lives in a mounted component's state, and the export must work from the source
 * view too, where no diagram is mounted at all.
 */
export async function renderDiagram(source: string, id: string): Promise<DiagramImage> {
  return exclusively(async () => {
    const mermaid = (await import("mermaid")).default;
    let svg: string;
    try {
      mermaid.initialize({
        startOnLoad: false,
        // A white page, whatever the reader's theme: the export is not a screenshot.
        theme: "default",
        securityLevel: "strict",
        suppressErrorRendering: true,
        // The reason the labels are not blank; see the note at the top.
        flowchart: { htmlLabels: false },
        htmlLabels: false,
      } as Parameters<typeof mermaid.initialize>[0]);
      ({ svg } = await mermaid.render(id, source));
    } catch (cause) {
      throw new DiagramError(`mermaid could not render the diagram: ${String(cause)}`);
    } finally {
      // Whatever happened, the on-screen renderer is handed back what it had. The
      // component re-initialises on its next render, so restoring the default here
      // is enough to keep an export from changing the page behind it.
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
    }

    const { width, height } = svgDimensions(svg);
    const sized = withExplicitSize(svg, width, height);
    // The raster is drawn from the styled original: a browser applies the CSS, so
    // the fallback is correct either way. Only the vector, which travels to
    // readers that do not, needs its appearance written into it.
    const png = await rasterise(sized, width, height);
    return { svg: inlineStyles(sized), png, width, height };
  });
}

/** How much larger the raster is drawn than the vector, so it is not soft. */
const RASTER_SCALE = 2;

/**
 * The fallback raster.
 *
 * Drawn through an `<img>` onto a canvas. Anything the browser refuses to draw —
 * a tainted canvas, an SVG it will not load — raises, and the caller falls back to
 * the diagram's source text rather than writing a picture that is not there.
 */
export async function rasterise(svg: string, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * RASTER_SCALE));
  canvas.height = Math.max(1, Math.round(height * RASTER_SCALE));
  const context = canvas.getContext("2d");
  if (context === null) throw new DiagramError("no 2d canvas context for the fallback image");

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImage(url);
    // A white ground: a PNG with a transparent background prints as grey blotches
    // in some readers, and the page it is going onto is white anyway.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new DiagramError("the browser would not draw the diagram"));
    image.src = url;
  });
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob === null) throw new DiagramError("the canvas produced no image");
  return new Uint8Array(await blob.arrayBuffer());
}
