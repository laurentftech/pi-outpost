/**
 * The page as a PNG, drawn by the browser the editor runs in: the poster's markup and
 * stylesheet in an SVG foreignObject, painted onto a canvas at print resolution — about
 * 300 dpi on A4, the longer side capped at 4000 pixels. It is drawn here because the
 * browser is the only place every host has an engine that lays out HTML; no server does.
 *
 * Browser only.
 */

export interface PageSize {
  width: number;
  height: number;
}

export interface PagePicture {
  png: Uint8Array;
  width: number;
  height: number;
}

/** About 300 dpi on A4 (794 CSS px → 2481 px); the longer side never above 4000 pixels. */
export function pictureScale(page: PageSize): number {
  return Math.min(3.125, 4000 / Math.max(page.width, page.height));
}

/**
 * The SVG document the page is drawn through: XHTML in a foreignObject the picture's size,
 * the page scaled up inside it by a CSS transform. Not by the SVG's viewBox: WebKit draws a
 * foreignObject at its own size whatever the viewBox, leaving the page at 1:1 in a corner.
 */
export function pageSvg(page: PageSize, html: string, css: string, scale = pictureScale(page)): string {
  // Parsed in an inert document, never in the page's: an element of the live document
  // loads its images and runs their handlers (`<img onerror>`) even when not attached.
  // Nothing in an inert document runs or loads; it is only serialised.
  const holder = document.implementation.createHTMLDocument("").createElement("div");
  holder.innerHTML = `<style>*,*::before,*::after{box-sizing:border-box}${css}</style>${html}`;
  holder.setAttribute(
    "style",
    `width:${page.width}px;height:${page.height}px;overflow:hidden;position:relative;background:#fff;transform:scale(${scale});transform-origin:0 0`,
  );
  const markup = new XMLSerializer().serializeToString(holder);
  const width = Math.round(page.width * scale);
  const height = Math.round(page.height * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;
}

export async function pagePicture(page: PageSize, html: string, css: string): Promise<PagePicture> {
  const scale = pictureScale(page);
  const width = Math.round(page.width * scale);
  const height = Math.round(page.height * scale);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("this browser could not draw the page as a picture"));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pageSvg(page, html, css, scale))}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser could not draw the page as a picture");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((made) => (made ? resolve(made) : reject(new Error("this browser could not encode the picture"))), "image/png"),
  );
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}
