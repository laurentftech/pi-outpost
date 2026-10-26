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

/** A character XML 1.0 does not allow: a control character, a lone surrogate, U+FFFE or U+FFFF. */
const NOT_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
/** A name with no prefix, as XML allows it (NCName). */
const XML_NAME =
  /^[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][-.0-9A-Za-z_\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]*$/u;

/**
 * Makes what the HTML parser took serialise as well-formed XML, which the picture must be or the
 * browser draws nothing: text pasted from Word brings `<o:p>` elements, `o:` attributes and control
 * characters (its line break is a vertical tab), and the parser keeps them all. An element with
 * such a name gives way to its content, such an attribute and comments go, such characters too.
 */
function makeXml(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, 0x1 | 0x4 | 0x80); // elements, texts, comments
  const elements: Element[] = [];
  const comments: Node[] = [];
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === 8) comments.push(node);
    else if (node.nodeType === 3) node.nodeValue = node.nodeValue!.replace(NOT_XML, "");
    else elements.push(node as Element);
  }
  for (const comment of comments) comment.parentNode?.removeChild(comment);
  for (const element of elements) {
    // Removing an attribute shifts the live list: walk a copy of it.
    for (const attribute of Array.from(element.attributes)) {
      // xlink:href and the like carry their namespace, and xml: is always bound; only an unbound prefix or a stray character breaks.
      if (attribute.namespaceURI === null && !XML_NAME.test(attribute.name.replace(/^xml:/, ""))) element.removeAttribute(attribute.name);
      else {
        const value = attribute.value.replace(NOT_XML, "");
        if (value !== attribute.value) attribute.value = value;
      }
    }
    if (element !== root && !XML_NAME.test(element.localName)) element.replaceWith(...element.childNodes);
  }
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
  makeXml(holder);
  holder.setAttribute(
    "style",
    `width:${page.width}px;height:${page.height}px;overflow:hidden;position:relative;background:#fff;transform:scale(${scale});transform-origin:0 0`,
  );
  const markup = new XMLSerializer().serializeToString(holder);
  const width = Math.round(page.width * scale);
  const height = Math.round(page.height * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;
}

/**
 * What may have kept the browser from drawing `svg`, for the message the person reads: the browser
 * says only that the picture failed. Its XML error when it has one, else its size and pictures.
 */
export function whyNotDrawn(svg: string): string {
  const error = new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("parsererror")[0];
  if (error) return `its markup is not well-formed XML: ${error.textContent!.trim().split(/\r?\n/)[0]!.slice(0, 200)}`;
  const pictures = svg.match(/<img\b/g)?.length ?? 0;
  return `a page of ${(svg.length / 1024 / 1024).toFixed(1)} MB with ${pictures} picture${pictures === 1 ? "" : "s"}`;
}

export async function pagePicture(page: PageSize, html: string, css: string): Promise<PagePicture> {
  const scale = pictureScale(page);
  const width = Math.round(page.width * scale);
  const height = Math.round(page.height * scale);
  const svg = pageSvg(page, html, css, scale);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`this browser could not draw the page as a picture (${whyNotDrawn(svg)})`));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`this browser could not make a canvas of ${width} x ${height} pixels to draw the page on`);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((made) => (made ? resolve(made) : reject(new Error("this browser could not encode the picture"))), "image/png"),
  );
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}
