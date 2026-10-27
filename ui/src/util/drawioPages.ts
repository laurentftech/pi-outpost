/**
 * The pages of a draw.io file, and one of them on its own, for a poster's diagram frame
 * (poster-drawio-pictures, design 4). The viewer draws and exports the page it shows; handed a
 * file of one page, that page is the one asked for.
 *
 * A file is an `<mxfile>` of `<diagram>` pages, or a bare `<mxGraphModel>`, one page.
 */

function parsed(text: string): Element {
  const root = new DOMParser().parseFromString(text, "application/xml").documentElement;
  if (root.nodeName === "parsererror" || root.getElementsByTagName("parsererror").length > 0) throw new Error("it is not a draw.io diagram (not XML)");
  if (root.nodeName !== "mxfile" && root.nodeName !== "mxGraphModel") throw new Error(`it is not a draw.io diagram (its root is <${root.nodeName}>)`);
  return root;
}

function diagramsOf(root: Element): Element[] {
  return [...root.children].filter((child) => child.nodeName === "diagram");
}

/** The pages' names, in order; a page with no name is "Page N", as draw.io shows it. */
export function drawioPages(text: string): string[] {
  const root = parsed(text);
  if (root.nodeName === "mxGraphModel") return ["Page 1"];
  const diagrams = diagramsOf(root);
  if (diagrams.length === 0) throw new Error("it holds no page");
  return diagrams.map((diagram, index) => diagram.getAttribute("name")?.trim() || `Page ${index + 1}`);
}

/**
 * The index, from 0, of the page `page` names — its name, or its number from 1 — or 0 for none.
 * Throws, naming the pages there are, for a page the file does not have.
 */
export function drawioPageIndex(text: string, page?: string): number {
  if (page === undefined || page.trim() === "") return 0;
  const names = drawioPages(text);
  const wanted = page.trim();
  const byName = names.indexOf(wanted);
  const index = byName >= 0 ? byName : /^\d+$/.test(wanted) ? Number(wanted) - 1 : -1;
  if (index < 0 || index >= names.length) throw new Error(`it has no page "${wanted}"; its pages are ${names.map((name) => `"${name}"`).join(", ")}`);
  return index;
}

/**
 * The file reduced to the page `page` names — its name, or its number from 1 — or to its first
 * page. Throws, naming the pages there are, for a page it does not have.
 */
export function drawioPage(text: string, page?: string): string {
  const root = parsed(text);
  const index = drawioPageIndex(text, page);
  if (root.nodeName === "mxGraphModel") return text;
  const file = root.cloneNode(false) as Element;
  file.appendChild(diagramsOf(root)[index]!.cloneNode(true));
  return new XMLSerializer().serializeToString(file);
}

/** `target`, a browser-root-relative path, as a reference from the directory of `from`. */
export function relativeReference(from: string, target: string): string {
  const base = from.split("/").slice(0, -1);
  const parts = target.split("/");
  let shared = 0;
  while (shared < base.length && shared < parts.length - 1 && base[shared] === parts[shared]) shared += 1;
  return [...base.slice(shared).map(() => ".."), ...parts.slice(shared)].join("/");
}
