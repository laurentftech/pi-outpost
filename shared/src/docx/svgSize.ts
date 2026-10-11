/**
 * A Mermaid diagram's size, and the same SVG carrying it.
 *
 * Mermaid writes `width="100%"` and no intrinsic size: the real dimensions live in
 * the `viewBox`. Shared by the viewer's export, which draws in the browser, and the
 * server's renderer, which draws without one, so both size a diagram the same way.
 */

/** The diagram's own dimensions, read from its `viewBox`, or `null` when it has no usable one. */
export function viewBoxSize(svg: string): { width: number; height: number } | null {
  const viewBox = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  const width = viewBox ? Number(viewBox[1]) : Number.NaN;
  const height = viewBox ? Number(viewBox[2]) : Number.NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
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
