/**
 * The poster editor every host shows: GrapesJS over the poster the model wrote, cut down to
 * what retouching needs — click a text to correct it, drag a block or a pictogram, change a
 * colour, a font or a size, undo, zoom and fit, save, export to Word or PowerPoint.
 *
 * A host mounts it in a page of its own (the MCP view, pi-outpost's editor frame, the Open
 * WebUI embed) and supplies what differs: whether and how it saves, how a file reaches the
 * person, and full screen. Everything else is here, so the hosts behave alike.
 *
 * What the probe on `probe/poster-editor` found, kept here (design.md, Context):
 * - GrapesJS reads CSS through the browser by default, which drops every declaration using
 *   var(); the postcss parser keeps the stylesheet as written.
 * - A device with a width files component styles under a media query: `widthMedia: ""`.
 * - The page is GrapesJS's wrapper `div`, sized as the paper, not `body`.
 * - Unless told not to, GrapesJS posts telemetry to app.grapesjs.com and loads Font Awesome
 *   from a CDN (task 1.1): `telemetry: false`, `cssIcons: ""`.
 * - GrapesJS draws in a frame it must reach: under a sandbox without the same origin it
 *   cannot, and `canEdit()` says so before anything is built (task 1.2).
 *
 * Browser only.
 */
import { grapesjs, type Component, type Editor, type IsVisibleFn, type Plugin, type PropertyTypes } from "grapesjs";
import parserModule from "grapesjs-parser-postcss";
import { FORMATS, pageOf, type PosterFormat } from "./format.ts";
import { DOCX_MEDIA_TYPE, PPTX_MEDIA_TYPE, exportFileName, posterDocx, posterPptx } from "./office.ts";
import { pagePicture } from "./picture.ts";
import { DRAWIO_ATTRIBUTE, DRAWIO_PAGE_ATTRIBUTE, diagramPicture, type DiagramChoice } from "./diagrams.ts";

export interface OpenedPoster {
  title: string;
  html: string;
  css: string;
  format: PosterFormat;
  /** The revision the editor opened, sent back with a save; hosts without revisions use 0. */
  revision: number;
  /** No saving here: the file is outside the write zone, or the host cannot save. */
  readOnly?: boolean;
  /** A notice specific to this opened poster, for hosts whose capabilities vary by embed. */
  notice?: string;
}

export type SaveResult = { saved: true; revision: number; message?: string } | { saved: false; message: string };

export interface DeliveredFile {
  name: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface PosterHost {
  /** Saves the poster as shown, against the revision it opened. Absent: this host does not save. */
  save?: (poster: { html: string; css: string; base: number }) => Promise<SaveResult>;
  /** Hands an exported file to the person; resolves with what to tell them. */
  deliver: (file: DeliveredFile) => Promise<string>;
  /** Present when the host can switch full screen. */
  toggleFullscreen?: () => void;
  /** Said under the bar while the poster is open, e.g. that touch-ups stay in the browser. */
  notice?: string;
  /** Why editing is not available, when the frame cannot reach the editor's canvas: the host's own words, naming what would allow it. */
  cannotEditNotice?: string;
  /** What a successful save adds, e.g. "Claude will start from this version." */
  savedNote?: string;
  /** Told when unsaved touch-ups appear and when they are saved, so the host can ask before dropping them. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Present when the host can draw draw.io diagrams (pi-outpost, which serves the viewer):
   * Insert offers them, and an empty frame naming one is filled when the poster opens. Both
   * reject with the reason, in words for the person.
   */
  diagrams?: {
    /** The diagrams a frame may name, with their pages. */
    list(): Promise<DiagramChoice[]>;
    /** One page of `path`, as an SVG: the page's name or number from 1, or the first page. */
    draw(path: string, page?: string): Promise<string>;
  };
}

export interface PosterEditor {
  open(poster: OpenedPoster): void;
  setTheme(theme: "light" | "dark"): void;
  /** inline: a fixed height of its own; fullscreen or fill: the page's whole height. */
  setDisplayMode(mode: "inline" | "fullscreen" | "fill"): void;
  /** The poster as shown, unsaved touch-ups included. */
  current(): { html: string; css: string } | undefined;
  destroy(): void;
}

/** Whether GrapesJS can run here: it draws in a frame it must reach, which an opaque sandbox forbids. */
export function canEdit(): boolean {
  const probe = document.createElement("iframe");
  probe.style.display = "none";
  document.body.append(probe);
  try {
    return probe.contentDocument !== null;
  } catch {
    return false;
  } finally {
    probe.remove();
  }
}

// A CommonJS package: depending on the bundler the import is the plugin or a module holding it.
const parserPostCSS = ((parserModule as unknown as { default?: Plugin }).default ?? parserModule) as unknown as Plugin;

/**
 * Pictures handled as wholes, keeping their proportions when resized. A drawing the model
 * wrote in SVG sits in an element of its own (the guide asks for `<div class="drawing">`),
 * and that element is what is selected, moved and resized: GrapesJS starts a move from the
 * browser's dragstart, which an SVG element never fires, so the SVG itself lets the mouse
 * through.
 */
const KEEP_RATIO = { ratioDefault: true, tl: true, tc: false, tr: true, cl: false, cr: false, bl: true, bc: false, br: true };

const wholePictures: Plugin = (editor) => {
  const keepRatio = KEEP_RATIO;
  const inert = { selectable: false, hoverable: false, draggable: false, droppable: false, layerable: false };
  editor.Components.addType("svg", { model: { defaults: inert } });
  editor.Components.addType("svg-in", { model: { defaults: inert } });
  const imageAttributes = editor.Components.getType("image")!.model.prototype.getAttrToHTML;
  editor.Components.addType("image", {
    model: {
      defaults: { resizable: keepRatio },
      // An empty frame is drawn with GrapesJS's placeholder, which is not the poster's: it
      // is saved without a source, as the model wrote it, so it stays an empty frame.
      getAttrToHTML(this: Component & { isDefaultSrc(): boolean }) {
        const attributes = imageAttributes.call(this) as Record<string, unknown>;
        if (this.isDefaultSrc()) delete attributes.src;
        return attributes;
      },
    },
    // Double-clicking a picture asks for a file of the person's own: GrapesJS would open its
    // asset manager, a library of uploads no host here has.
    view: {
      onActive(this: { model: Component }, event?: Event) {
        event?.stopPropagation();
        editor.trigger("poster:pick-picture", this.model);
      },
    },
  });
};

const DROPPED_ELEMENTS = "script, iframe, frame, object, embed, base, meta, link, form, portal";
const URL_ATTRIBUTES = ["href", "src", "xlink:href", "action", "formaction", "data", "srcset", "poster"];

/**
 * The markup with what could run or reach out removed: scripts and frames, objects and
 * embeds, base, meta and link elements, forms, event attributes, and `javascript:` URLs.
 * A second layer under each host's Content-Security-Policy (design.md, decision 4).
 */
export function sanitizePosterHtml(html: string): string {
  // An inert document: nothing parsed into it runs or loads while it is cleaned.
  const holder = document.implementation.createHTMLDocument("").createElement("div");
  holder.innerHTML = html;
  for (const element of holder.querySelectorAll(DROPPED_ELEMENTS)) element.remove();
  for (const element of holder.querySelectorAll("*")) {
    // A copy: removing an attribute while walking the live list would skip the next one.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      // eslint-disable-next-line no-control-regex -- browsers ignore control characters inside a URL scheme
      else if (URL_ATTRIBUTES.includes(name) && /^\s*(javascript|vbscript|data:text\/html)/i.test(attribute.value.replace(/[\u0000- ]/g, ""))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return holder.innerHTML;
}

/** The longest side a picture keeps once placed: sharp when printed at A4, small enough to embed. */
const PICTURE_MAX_SIDE = 1200;

/**
 * A picture file as a data URL to embed in the poster, scaled down to `PICTURE_MAX_SIDE`.
 * PNG for a picture that may hold transparency (PNG, GIF, WebP sources), JPEG otherwise.
 */
export async function embeddablePicture(file: Blob): Promise<string> {
  const { source, width, height, release } = await decoded(file);
  try {
    const scale = Math.min(1, PICTURE_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    const transparent = /^image\/(png|gif|webp|svg\+xml)$/.test(file.type);
    return transparent ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    release();
  }
}

/**
 * The picture decoded, by createImageBitmap, or else as an <img> from a blob URL: the second
 * takes what the first refuses and a browser still shows (an SVG file, a PNG its strict decoder
 * rejects). Every host's policy allows `blob:` pictures.
 */
async function decoded(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      // An SVG without its own size decodes at 0 × 0: drawn at the size of a placed picture.
      const width = image.naturalWidth || PICTURE_MAX_SIDE / 2;
      const height = image.naturalHeight || PICTURE_MAX_SIDE / 2;
      return { source: image, width, height, release: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
}

/**
 * The shapes the Insert menu offers, drawn in a 100 × 100 box that stretches with its holder
 * (`preserveAspectRatio="none"`). Each paints through the custom properties the Format panel
 * sets on the holder (SHAPE_RULES), so a shape is recoloured like any element.
 */
/** Where a new speech bubble's tail ends, in its 100 × 100 box: below it, towards the left. */
const DEFAULT_TAIL = { x: 18, y: 140 };

/**
 * A speech bubble whose tail ends at (`tipX`, `tipY`) in its 100 × 100 box, the tip allowed
 * outside it: a rounded body filling the box, and a tail leaving the side that faces the tip
 * (the side of the tip's larger offset from the centre), its base kept clear of the corners.
 */
export function bubblePath(tipX: number, tipY: number): string {
  const r = 12;
  const half = 9;
  const dx = tipX - 50;
  const dy = tipY - 50;
  const side = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? "bottom" : "top") : dx > 0 ? "right" : "left";
  const along = (value: number) => Math.min(Math.max(value, r + half), 100 - r - half);
  const tail = (from: [number, number], to: [number, number]) => `L ${from[0]} ${from[1]} L ${tipX} ${tipY} L ${to[0]} ${to[1]} `;
  const bx = along(tipX);
  const by = along(tipY);
  return [
    `M ${r} 0 `,
    side === "top" ? tail([bx - half, 0], [bx + half, 0]) : "",
    `L ${100 - r} 0 Q 100 0 100 ${r} `,
    side === "right" ? tail([100, by - half], [100, by + half]) : "",
    `L 100 ${100 - r} Q 100 100 ${100 - r} 100 `,
    side === "bottom" ? tail([bx + half, 100], [bx - half, 100]) : "",
    `L ${r} 100 Q 0 100 0 ${100 - r} `,
    side === "left" ? tail([0, by + half], [0, by - half]) : "",
    `L 0 ${r} Q 0 0 ${r} 0 Z`,
  ].join("").replace(/\s+/g, " ").trim();
}

/** The tail tip a bubble holder records, or the default for one that records none. */
function tailOf(holder: Component): { x: number; y: number } {
  const [x, y] = String(holder.getAttributes()["data-tail"] ?? "").split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : DEFAULT_TAIL;
}

export const SHAPES = {
  rectangle: { label: "Rectangle", width: 200, height: 140, svg: '<rect x="1" y="1" width="98" height="98"/>' },
  "rounded-rectangle": { label: "Rounded rectangle", width: 200, height: 140, svg: '<rect x="1" y="1" width="98" height="98" rx="14" ry="20"/>' },
  ellipse: { label: "Ellipse", width: 200, height: 140, svg: '<ellipse cx="50" cy="50" rx="49" ry="49"/>' },
  triangle: { label: "Triangle", width: 180, height: 160, svg: '<polygon points="50,1 99,99 1,99"/>' },
  arrow: { label: "Arrow", width: 220, height: 90, svg: '<polygon points="0,30 68,30 68,4 100,50 68,96 68,70 0,70"/>' },
  line: { label: "Line", width: 240, height: 24, svg: '<line x1="0" y1="50" x2="100" y2="50"/>' },
  star: { label: "Star", width: 180, height: 180, svg: '<polygon points="50,2 61,37 98,37 68,59 79,95 50,73 21,95 32,59 2,37 39,37"/>' },
  "speech-bubble": { label: "Speech bubble", width: 220, height: 120, svg: `<path d="${bubblePath(DEFAULT_TAIL.x, DEFAULT_TAIL.y)}"/>` },
} as const;

export type ShapeName = keyof typeof SHAPES;

/** How every shape paints, added to the poster's stylesheet with its first shape. */
const SHAPE_RULES: Array<[string, Record<string, string>]> = [
  [".poster-shape svg", { width: "100%", height: "100%", display: "block", overflow: "visible" }],
  [".poster-shape svg > *", { fill: "var(--shape-fill, #4fc3f7)", stroke: "var(--shape-line, none)", "stroke-width": "var(--shape-line-width, 0)", "vector-effect": "non-scaling-stroke" }],
  [".poster-shape.line svg > *", { fill: "none", stroke: "var(--shape-fill, #4fc3f7)", "stroke-width": "var(--shape-line-width, 4px)" }],
  [".poster-shape-text", { position: "absolute", inset: "12%", display: "flex", "align-items": "center", "justify-content": "center", "text-align": "center", "overflow-wrap": "anywhere", "pointer-events": "none" }],
];

/** The text inside a shape: neither selected nor moved on its own, edited through a double-click on its shape. */
const TEXT_IN_SHAPE = { selectable: false, hoverable: false, draggable: false, droppable: false, layerable: false, copyable: false, removable: false };

/** Resize handles: on the corners keeping the ratio (pictures, drawings), on all eight sides (shapes), on the sides only (text boxes). */
const RESIZE_FREE = { tl: true, tc: true, tr: true, cl: true, cr: true, bl: true, bc: true, br: true };
const RESIZE_WIDTH = { tl: false, tc: false, tr: false, cl: true, cr: true, bl: false, bc: false, br: false, keyHeight: "" };

/** Shape fields of the Format panel: custom properties on the shape's holder, shown only for a shape. */
const onShape: IsVisibleFn = ({ component }) => Boolean(component?.getClasses().includes("poster-shape"));
const SHAPE_SECTOR = {
  id: "shape",
  name: "Shape",
  open: true,
  properties: [
    { property: "--shape-fill", label: "Fill", type: "color", default: "#4fc3f7", isVisible: onShape },
    { property: "--shape-line", label: "Line", type: "color", default: "none", isVisible: onShape },
    { property: "--shape-line-width", label: "Line width", type: "number", units: ["px"], default: "0", min: 0, isVisible: onShape },
  ] as PropertyTypes[],
};

/** A small picture of each shape for the menu, drawn as the shape is. */
function shapeIcon(name: ShapeName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [attribute, value] of Object.entries({ width: "18", height: "14", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" })) svg.setAttribute(attribute, value);
  svg.innerHTML = SHAPES[name].svg;
  for (const part of svg.children) {
    part.setAttribute(name === "line" ? "stroke" : "fill", "currentColor");
    if (name === "line") part.setAttribute("stroke-width", "14");
  }
  return svg;
}

/** A floppy disk, Lucide's "save" (ISC): drawn here so the page fetches nothing. */
function FLOPPY(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
    svg.setAttribute(name, value);
  }
  for (const d of ["M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7", "M7 3v4a1 1 0 0 0 1 1h7"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, value);
  if (text !== undefined) made.textContent = text;
  return made;
}

/** Builds the editor in `root` (its bar, canvas, style panel and status line) and returns its handle. */
export function mountEditor(root: HTMLElement, host: PosterHost): PosterEditor {
  const page = document.documentElement;
  root.replaceChildren();
  const shell = element("div", { class: "poster-shell" });
  const bar = element("header", { class: "poster-bar" });
  const title = element("strong", { class: "poster-title" }, "Loading the poster…");
  const button = (id: string, label: string, help: string, extra: Record<string, string> = {}) => element("button", { type: "button", "data-action": id, title: help, ...extra }, label);
  const undo = button("undo", "↶", "Undo");
  const redo = button("redo", "↷", "Redo");
  const zoom = element("span", { class: "poster-group", role: "group", "aria-label": "Zoom" });
  zoom.append(button("zoom-out", "−", "Zoom out"), button("zoom-fit", "Fit", "See the whole page"), button("zoom-in", "+", "Zoom in"));
  const style = button("style", "Format", "Change the selected element's colours, fonts and sizes", { "aria-pressed": "false" });
  const insert = element("span", { class: "poster-insert" });
  const insertButton = button("insert", "Insert ▾", "Insert a picture, a text box or a shape", { "aria-haspopup": "menu", "aria-expanded": "false" });
  const insertMenu = element("div", { class: "poster-menu", role: "menu", hidden: "" });
  const menuItem = (action: string, label: string, help: string) => {
    const item = element("button", { type: "button", role: "menuitem", "data-insert": action, title: help });
    item.append(element("span", {}, label));
    return item;
  };
  insertMenu.append(
    menuItem("picture", "Picture…", "A picture of yours: into the selected picture, or onto the page"),
    // Only where the host can draw them: elsewhere the menu holds no item it cannot honour.
    ...(host.diagrams ? [menuItem("diagram", "draw.io diagram…", "A page of one of the project's draw.io diagrams: into the selected picture, or onto the page")] : []),
    menuItem("text", "Text", "A text box in the middle of the page"),
    element("hr"),
    ...(Object.keys(SHAPES) as ShapeName[]).map((name) => {
      const item = menuItem(`shape:${name}`, SHAPES[name].label, `A ${SHAPES[name].label.toLowerCase()} in the middle of the page`);
      item.prepend(shapeIcon(name));
      return item;
    }),
  );
  // The project's diagrams, one entry per page, asked of the host each time it opens.
  const diagramMenu = element("div", { class: "poster-diagrams", role: "menu", "aria-label": "draw.io diagrams", hidden: "" });
  insert.append(insertButton, insertMenu, diagramMenu);
  const pictureInput = element("input", { type: "file", accept: "image/*", hidden: "", "aria-hidden": "true" });
  // Save is an icon, first of the controls: it keeps the poster, where the three
  // downloads beside the exports make files of it; alike, they read as one kind of action.
  const save = button("save", "", "Save your changes", { class: "primary poster-icon", "aria-label": "Save" });
  save.append(FLOPPY());
  save.disabled = true;
  const word = button("word", "↓ word", "Download an A4 page to print, the poster as a picture", { "aria-label": "Download for Word" });
  const powerpoint = button("powerpoint", "↓ powerpoint", "Download a slide to show, the poster as a picture", { "aria-label": "Download for PowerPoint" });
  const htmlFile = button("html", "↓ html", "Download the poster as a web page, to print from a browser", { "aria-label": "Download as a web page" });
  const downloads = element("span", { class: "poster-downloads", role: "group", "aria-label": "Download" });
  downloads.append(word, powerpoint, htmlFile);
  const fullscreen = button("fullscreen", "Full screen", "Full screen");
  bar.append(title, save, undo, redo, zoom, style, insert, downloads, fullscreen, pictureInput);
  const work = element("main", { class: "poster-work" });
  const canvasArea = element("div", { class: "poster-canvas" });
  const gjs = element("div", { class: "poster-gjs" });
  canvasArea.append(gjs);
  const side = element("aside", { class: "poster-side" });
  const styles = element("div");
  side.append(styles);
  work.append(canvasArea, side);
  const notice = element("p", { class: "poster-notice" });
  const statusLine = element("footer", { class: "poster-status", role: "status" });
  shell.append(bar, notice, work, statusLine);
  root.append(shell);

  let editor: Editor | undefined;
  let shown: OpenedPoster | undefined;
  let editable = false;
  let dirty = false;
  let saving = false;
  let lastMode: string | undefined;
  let destroyed = false;
  let canvasReady = false;
  let savedSnapshot: { html: string; css: string } | undefined;

  const setDirty = (value: boolean) => {
    if (dirty === value) return;
    dirty = value;
    save.disabled = !dirty || saving;
    host.onDirtyChange?.(value);
  };
  const status = (message: string, kind: "info" | "error" | "ok" = "info") => {
    statusLine.textContent = message;
    statusLine.dataset.kind = kind;
  };
  const size = () => FORMATS[shown!.format];

  function fitZoom() {
    // Not before GrapesJS has built its canvas: fitViewport reads the frame it makes.
    if (!editor || destroyed || !canvasReady) return;
    editor.refresh();
    editor.Canvas.fitViewport({ gap: 16 });
  }

  /**
   * Keeps the page in view however it is scrolled or zoomed: a page smaller than the visible
   * area stays wholly inside it, a larger one never uncovers more than the margin beyond its
   * edges, so the person cannot lose it and face an empty desk.
   */
  let clamping = false;
  function keepPageInView() {
    if (!editor || destroyed || !canvasReady || clamping) return;
    const frame = canvasArea.querySelector("iframe.gjs-frame")?.getBoundingClientRect();
    const area = canvasArea.getBoundingClientRect();
    if (!frame || frame.width === 0 || area.width === 0) return;
    const gap = 16;
    const shift = (start: number, end: number, areaStart: number, areaEnd: number) => {
      if (end - start <= areaEnd - areaStart - 2 * gap) {
        if (start < areaStart + gap) return areaStart + gap - start;
        if (end > areaEnd - gap) return areaEnd - gap - end;
      } else {
        if (start > areaStart + gap) return areaStart + gap - start;
        if (end < areaEnd - gap) return areaEnd - gap - end;
      }
      return 0;
    };
    const dx = shift(frame.left, frame.right, area.left, area.right);
    const dy = shift(frame.top, frame.bottom, area.top, area.bottom);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const { x, y } = editor.Canvas.getCoords();
    clamping = true;
    try {
      editor.Canvas.setCoords(x + dx, y + dy);
    } finally {
      clamping = false;
    }
  }

  function setPanel(open: boolean) {
    page.dataset.posterPanel = open ? "open" : "closed";
    style.setAttribute("aria-pressed", String(open));
    setTimeout(fitZoom, 0);
  }

  function current(): { html: string; css: string } | undefined {
    if (!shown) return undefined;
    if (!editor) return { html: shown.html, css: shown.css };
    return { html: editor.getWrapper()!.getInnerHTML(), css: editor.getCss({ avoidProtected: true }) ?? "" };
  }

  function syncDirty() {
    const value = current();
    if (!value || !savedSnapshot) return;
    const changed = value.html !== savedSnapshot.html || value.css !== savedSnapshot.css;
    const turned = changed !== dirty;
    setDirty(changed);
    // Said when the poster turns unsaved or saved, or over a passing note ("Saving…"), but not
    // over a result or an error: what was just placed, or what failed, would be gone with the
    // update that follows it.
    if (!turned && statusLine.dataset.kind !== "info") return;
    if (host.save && !shown?.readOnly && editable) status(changed ? "Unsaved changes." : "No unsaved changes.");
  }

  async function doSave() {
    if (!host.save || !shown || shown.readOnly || saving || !dirty) return;
    const poster = current();
    if (!poster) return;
    const opened = shown;
    saving = true;
    save.disabled = true;
    status("Saving…");
    try {
      const result = await host.save({ ...poster, base: opened.revision });
      if (destroyed || shown !== opened) return;
      if (!result.saved) {
        status(`Not saved: ${result.message}`, "error");
        return;
      }
      shown = { ...opened, revision: result.revision };
      savedSnapshot = poster;
      syncDirty();
      status(
        dirty
          ? `${result.message ?? `Saved.${host.savedNote ? ` ${host.savedNote}` : ""}`} Newer changes are still unsaved.`
          : result.message ?? `Saved.${host.savedNote ? ` ${host.savedNote}` : ""}`,
        dirty ? undefined : "ok",
      );
    } catch (error) {
      if (!destroyed && shown === opened) status(`Not saved: ${(error as Error).message}`, "error");
    } finally {
      saving = false;
      save.disabled = !dirty;
    }
  }

  async function exportTo(kind: "docx" | "pptx" | "html") {
    if (!shown) return;
    const poster = current()!;
    const opened = shown;
    const name = kind === "html" ? exportFileName(opened.title, "docx").replace(/\.docx$/, ".html") : exportFileName(opened.title, kind);
    let file: DeliveredFile;
    if (kind === "html") {
      file = { name, mediaType: "text/html", bytes: new TextEncoder().encode(pageOf(opened.title, { ...poster, format: opened.format })) };
    } else {
      status(`Making the ${kind === "docx" ? "Word" : "PowerPoint"} file…`);
      const picture = await pagePicture(size(), poster.html, poster.css);
      const bytes = kind === "docx" ? posterDocx(opened.title, opened.format, picture) : posterPptx(opened.title, picture);
      file = { name, mediaType: kind === "docx" ? DOCX_MEDIA_TYPE : PPTX_MEDIA_TYPE, bytes };
    }
    const said = await host.deliver(file);
    if (!destroyed && shown === opened) status(said, "ok");
  }

  let pictureTarget: Component | undefined;
  const pictureRequests = new WeakMap<object, number>();

  /** Asks for a picture file; it goes into `target` when that is a picture, else onto the page. */
  function pickPicture(target?: Component) {
    if (!editor || !editable) return;
    pictureTarget = target;
    pictureInput.value = "";
    pictureInput.click();
  }

  /** Puts `file` into `target` when that is a picture, else onto the page, centred on `at` (page pixels) or in the page's middle. */
  async function placePicture(file: Blob, target?: Component, at?: { x: number; y: number }) {
    const opened = editor;
    if (!opened || !shown) return;
    status("Placing the picture…");
    // The last picture chosen for a frame wins, even if an earlier, bigger one finishes scaling after it.
    const request = (pictureRequests.get(target ?? opened) ?? 0) + 1;
    pictureRequests.set(target ?? opened, request);
    let source: string;
    try {
      source = await embeddablePicture(file);
    } catch {
      if (editor === opened) status("This file could not be read as a picture.", "error");
      return;
    }
    if (editor !== opened || (target && pictureRequests.get(target) !== request)) return;
    if (target?.is("image")) {
      target.set("src", source);
      // The slot's own look (a dashed frame, a tint) marked it empty; a filled slot shows the
      // picture alone. Set on this element only, whatever the model's stylesheet says.
      target.addStyle({ border: "none", background: "none" });
    } else {
      const side = Math.round(size().width / 3);
      place(opened, { type: "image", src: source, attributes: { alt: "" } }, side, side, at, "auto");
    }
    status("Picture placed: drag it to move it, pull a corner to resize it, then save.", "ok");
  }

  /**
   * Adds `definition` to the page, `width` × `height`, centred on `at` (page pixels) or on the
   * page, kept inside it, and selects it. Placed by its left and top, so it moves by them:
   * GrapesJS's translate drag miscomputes on an element that is already absolutely positioned.
   */
  function place(opened: Editor, definition: Record<string, unknown>, width: number, height: number, at?: { x: number; y: number }, cssHeight?: string): Component | undefined {
    const page = size();
    const centre = at ?? { x: page.width / 2, y: page.height / 2 };
    const clamp = (value: number, room: number) => Math.round(Math.min(Math.max(value, 0), room));
    let left = clamp(centre.x - width / 2, page.width - width);
    let top = clamp(centre.y - height / 2, page.height - height);
    // Inserted where something placed is already centred, it steps down and right, as
    // PowerPoint does, rather than hiding under or over it.
    const centres = opened.getWrapper()!.find("*").flatMap((component) => {
      const placed = component.getEl() as HTMLElement | undefined;
      if (!placed || (component.getStyle() as Record<string, string>).position !== "absolute") return [];
      return [{ x: placed.offsetLeft + placed.offsetWidth / 2, y: placed.offsetTop + placed.offsetHeight / 2 }];
    });
    const taken = () => centres.some((other) => Math.abs(other.x - (left + width / 2)) < 40 && Math.abs(other.y - (top + height / 2)) < 40);
    for (let step = 0; step < 20 && taken(); step += 1) {
      left = clamp(left + 24, page.width - width);
      top = clamp(top + 24, page.height - height);
    }
    // Into the poster's outer element, which fills the page from its corner, so what is added
    // takes the poster's font and colours; the page itself when the poster has no single one.
    const wrapper = opened.getWrapper()!;
    const outer = wrapper.components().length === 1 ? wrapper.components().at(0) : wrapper;
    const [added] = outer.append({ ...definition, dmode: "absolute", style: { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: cssHeight ?? `${height}px` } });
    if (added) opened.select(added);
    return added;
  }

  function insertText() {
    const opened = editor;
    if (!opened || !shown) return;
    const added = place(opened, { type: "text", tagName: "div", classes: ["poster-text"], components: "Text", resizable: RESIZE_WIDTH }, Math.round(size().width / 3), 50, undefined, "auto");
    if (!added) return;
    added.addStyle({ "font-size": "32px" });
    // Ready to type over: the text editor on, then, once it has made the box editable, its
    // placeholder selected.
    const view = added.getView() as unknown as { onActive?: () => void } | undefined;
    view?.onActive?.();
    setTimeout(() => {
      const box = added.getEl();
      const selection = box?.ownerDocument.getSelection();
      if (!box || !selection || editor !== opened) return;
      box.focus();
      selection.selectAllChildren(box);
    }, 0);
    status("Text box added: type your text, then drag it into place.", "ok");
  }

  function insertShape(name: ShapeName) {
    const opened = editor;
    if (!opened || !shown) return;
    const shape = SHAPES[name];
    for (const [selector, style] of SHAPE_RULES) if (!opened.Css.getRule(selector)) opened.Css.setRule(selector, style);
    const text = name === "line" ? [] : [{ type: "text", tagName: "div", classes: ["poster-shape-text"], components: "", ...TEXT_IN_SHAPE }];
    const tail = name === "speech-bubble" ? { "data-tail": `${DEFAULT_TAIL.x},${DEFAULT_TAIL.y}` } : {};
    place(opened, { tagName: "div", classes: ["poster-shape", name], attributes: tail, resizable: RESIZE_FREE, components: [`<svg viewBox="0 0 100 100" preserveAspectRatio="none">${shape.svg}</svg>`, ...text] }, shape.width, shape.height);
    status(`${shape.label} added: drag it to move it, pull its sides to resize it, double-click it to write in it, colour it in Format.`, "ok");
  }

  /**
   * The speech bubble's tail handle: an element of the editor's own in the canvas (never a
   * component, so never saved), at the tip while a bubble is selected. Dragging it rewrites the
   * path live and commits it, with the holder's `data-tail`, on release (design 3d).
   */
  function wireTailHandle(opened: Editor, canvasDocument: Document) {
    const handle = canvasDocument.createElement("div");
    handle.className = "poster-tail-handle";
    handle.title = "Drag to point the bubble's tail";
    canvasDocument.body.append(handle);
    const bubble = () => {
      const selected = opened.getSelected();
      return selected?.getClasses().includes("speech-bubble") ? selected : undefined;
    };
    const boxOf = (holder: Component) => {
      const element = holder.getEl() as HTMLElement;
      const rect = element.getBoundingClientRect();
      const view = canvasDocument.defaultView!;
      return { left: rect.left + view.scrollX, top: rect.top + view.scrollY, width: rect.width, height: rect.height };
    };
    const show = (holder: Component, tip: { x: number; y: number }) => {
      const box = boxOf(holder);
      handle.style.left = `${box.left + (tip.x / 100) * box.width}px`;
      handle.style.top = `${box.top + (tip.y / 100) * box.height}px`;
      handle.style.display = "block";
    };
    const follow = () => {
      const holder = bubble();
      if (holder?.getEl()) show(holder, tailOf(holder));
      else handle.style.display = "none";
    };
    opened.on("component:toggled component:update component:styleUpdate component:drag component:drag:end component:resize update", () => setTimeout(follow, 0));
    canvasDocument.defaultView!.addEventListener("scroll", follow);
    handle.addEventListener("mousedown", (event) => {
      const holder = bubble();
      if (event.button !== 0 || !holder) return;
      event.preventDefault();
      event.stopPropagation();
      const path = holder.find("path")[0];
      const drawn = path?.getEl() as SVGPathElement | undefined;
      if (!path || !drawn) return;
      let tip = tailOf(holder);
      const move = (moving: MouseEvent) => {
        const box = boxOf(holder);
        const view = canvasDocument.defaultView!;
        const clamp = (value: number) => Math.round(Math.min(Math.max(value, -150), 250));
        tip = { x: clamp(((moving.clientX + view.scrollX - box.left) / box.width) * 100), y: clamp(((moving.clientY + view.scrollY - box.top) / box.height) * 100) };
        drawn.setAttribute("d", bubblePath(tip.x, tip.y));
        show(holder, tip);
      };
      const release = () => {
        canvasDocument.removeEventListener("mousemove", move, true);
        canvasDocument.removeEventListener("mouseup", release, true);
        path.addAttributes({ d: bubblePath(tip.x, tip.y) });
        holder.addAttributes({ "data-tail": `${tip.x},${tip.y}` });
      };
      canvasDocument.addEventListener("mousemove", move, true);
      canvasDocument.addEventListener("mouseup", release, true);
    }, true);
  }

  let diagramTarget: Component | undefined;
  let diagramListing = 0;

  /** Lists the project's diagrams, a page per entry, for one to go into `target` or onto the page. */
  async function chooseDiagram(target?: Component) {
    const diagrams = host.diagrams;
    if (!diagrams || !editor) return;
    diagramTarget = target;
    const listing = ++diagramListing;
    diagramMenu.replaceChildren(element("span", { class: "poster-menu-note" }, "Looking for draw.io diagrams…"));
    diagramMenu.hidden = false;
    let choices: DiagramChoice[];
    try {
      choices = await diagrams.list();
    } catch (error) {
      if (listing !== diagramListing) return;
      diagramMenu.hidden = true;
      status(`The draw.io diagrams could not be listed: ${error instanceof Error ? error.message : String(error)}.`, "error");
      return;
    }
    if (listing !== diagramListing || diagramMenu.hidden) return;
    const entries = choices.flatMap((choice) =>
      choice.pages.length > 1
        ? choice.pages.map((page) => ({ path: choice.path, page, label: `${choice.path} — ${page}` }))
        : [{ path: choice.path, page: undefined as string | undefined, label: choice.path }],
    );
    if (entries.length === 0) {
      diagramMenu.replaceChildren(element("span", { class: "poster-menu-note" }, "No draw.io diagram in this project."));
      return;
    }
    diagramMenu.replaceChildren(
      ...entries.map(({ path, page, label }) => {
        const item = element("button", { type: "button", role: "menuitem", "data-diagram": path, title: `Put ${label} in the poster` }, label);
        if (page !== undefined) item.dataset.page = page;
        return item;
      }),
    );
    (diagramMenu.querySelector("button") as HTMLButtonElement | null)?.focus();
  }

  /** Draws `path`'s `page` and puts it into `target` when that is a picture, else onto the page. */
  async function insertDiagram(path: string, page: string | undefined, target?: Component) {
    const opened = editor;
    const diagrams = host.diagrams;
    if (!opened || !shown || !diagrams) return;
    const named = page === undefined ? path : `${path} (${page})`;
    status(`Drawing ${named}…`);
    let picture: ReturnType<typeof diagramPicture>;
    try {
      picture = diagramPicture(await diagrams.draw(path, page));
    } catch (error) {
      if (editor === opened) status(`${named} could not be drawn: ${error instanceof Error ? error.message : String(error)}.`, "error");
      return;
    }
    if (editor !== opened) return;
    const source = { [DRAWIO_ATTRIBUTE]: path, ...(page === undefined ? {} : { [DRAWIO_PAGE_ATTRIBUTE]: page }) };
    if (target?.is("image") && target.getEl()?.isConnected) {
      target.set("src", picture.src);
      target.addAttributes(source);
      target.addStyle({ border: "none", background: "none" });
    } else {
      const width = Math.round(Math.min(size().width * 0.6, picture.width));
      const height = Math.round((width * picture.height) / picture.width);
      place(opened, { type: "image", src: picture.src, attributes: { alt: named, ...source } }, width, height);
    }
    // Unsaved now, before saying what was placed: said after, it would cover this.
    syncDirty();
    status("Diagram placed: drag it to move it, pull a corner to resize it, then save.", "ok");
  }

  /**
   * Fills each empty frame naming a diagram, once the poster is open (design 5): a frame
   * already holding a picture is left as it is. What is filled is an unsaved touch-up.
   */
  async function fillDiagramFrames(opened: Editor) {
    const diagrams = host.diagrams;
    if (!diagrams) return;
    const frames = opened.getWrapper()!.find("img").filter((frame) => {
      const named = frame.getAttributes()[DRAWIO_ATTRIBUTE];
      return typeof named === "string" && named.trim() !== "" && (frame as Component & { isDefaultSrc(): boolean }).isDefaultSrc();
    });
    if (frames.length === 0) return;
    status(`Drawing ${frames.length === 1 ? "the draw.io diagram" : `${frames.length} draw.io diagrams`} named in the poster…`);
    let filled = 0;
    const failed: string[] = [];
    for (const frame of frames) {
      const attributes = frame.getAttributes();
      const path = String(attributes[DRAWIO_ATTRIBUTE]).trim();
      const page = typeof attributes[DRAWIO_PAGE_ATTRIBUTE] === "string" && attributes[DRAWIO_PAGE_ATTRIBUTE].trim() !== "" ? attributes[DRAWIO_PAGE_ATTRIBUTE].trim() : undefined;
      try {
        const picture = diagramPicture(await diagrams.draw(path, page));
        if (editor !== opened) return;
        frame.set("src", picture.src);
        frame.addStyle({ border: "none", background: "none" });
        filled += 1;
      } catch (error) {
        if (editor !== opened) return;
        failed.push(`${page === undefined ? path : `${path} (${page})`}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    syncDirty();
    if (failed.length > 0) status(`${filled > 0 ? `${filled} diagram${filled === 1 ? "" : "s"} drawn; ` : ""}not drawn, its frame left empty — ${failed.join("; ")}.`, "error");
    else status(`${filled === 1 ? "The draw.io diagram is" : `${filled} draw.io diagrams are`} in ${filled === 1 ? "its frame" : "their frames"}: save to keep ${filled === 1 ? "it" : "them"}.`, "ok");
  }

  function setMenu(open: boolean) {
    // The diagram list sits where the menu opens: any move of the menu closes it, and drops a
    // listing still on its way.
    diagramMenu.hidden = true;
    diagramListing += 1;
    insertMenu.hidden = !open;
    insertButton.setAttribute("aria-expanded", String(open));
    if (open) (insertMenu.querySelector("button") as HTMLButtonElement | null)?.focus();
  }

  insertMenu.addEventListener("click", (event) => {
    const choice = (event.target as HTMLElement).closest<HTMLElement>("[data-insert]")?.dataset.insert;
    if (!choice) return;
    setMenu(false);
    if (choice === "picture") {
      const selected = editor?.getSelected();
      pickPicture(selected?.is("image") ? selected : undefined);
    } else if (choice === "diagram") {
      const selected = editor?.getSelected();
      void chooseDiagram(selected?.is("image") ? selected : undefined);
    } else if (choice === "text") {
      insertText();
    } else if (choice.startsWith("shape:")) {
      insertShape(choice.slice("shape:".length) as ShapeName);
    }
  });
  insertMenu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setMenu(false);
    insertButton.focus();
  });
  diagramMenu.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-diagram]");
    if (!item) return;
    diagramMenu.hidden = true;
    void insertDiagram(item.dataset.diagram!, item.dataset.page, diagramTarget);
  });
  // Escape closes the diagram list wherever the focus is: it may still be on Insert while the
  // project is looked through.
  const closeDiagramsOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || diagramMenu.hidden) return;
    setMenu(false);
    insertButton.focus();
  };
  root.ownerDocument.addEventListener("keydown", closeDiagramsOnEscape);
  document.addEventListener("mousedown", (event) => {
    if ((!insertMenu.hidden || !diagramMenu.hidden) && !insert.contains(event.target as Node)) setMenu(false);
  });

  pictureInput.addEventListener("change", () => {
    const file = pictureInput.files?.[0];
    const target = pictureTarget;
    pictureTarget = undefined;
    if (file) void placePicture(file, target);
  });

  function readOnlyView(poster: OpenedPoster) {
    // No editor (an opaque sandbox, or nothing to save to and no frame to edit in): the page
    // drawn in a frame of its own, scaled to fit. Drawing needs no access to the frame.
    const { width, height } = FORMATS[poster.format];
    const frame = element("iframe", { class: "poster-readonly", sandbox: "", title: poster.title });
    frame.srcdoc = pageOf(poster.title, poster);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    gjs.replaceChildren(frame);
    const fit = () => {
      const scale = Math.min((canvasArea.clientWidth - 32) / width, (canvasArea.clientHeight - 32) / height, 1);
      frame.style.transform = `scale(${Math.max(scale, 0.05)})`;
    };
    fit();
    new ResizeObserver(fit).observe(canvasArea);
  }

  function open(poster: OpenedPoster) {
    shown = { ...poster, html: sanitizePosterHtml(poster.html) };
    setDirty(false);
    title.textContent = poster.title;
    editor?.destroy();
    editor = undefined;
    canvasReady = false;
    editable = canEdit();
    const canSave = Boolean(host.save) && !poster.readOnly && editable;
    save.hidden = !canSave;
    for (const control of [undo, redo, zoom, style, insert]) control.hidden = !editable;
    setMenu(false);
    fullscreen.hidden = !host.toggleFullscreen;
    const notes = [
      host.notice,
      poster.notice,
      editable ? undefined : (host.cannotEditNotice ?? "Editing is not available here: this frame may not reach the editor's canvas. The poster is shown as it is, and Word and PowerPoint export still work."),
    ];
    notice.textContent = notes.filter(Boolean).join(" ");
    notice.hidden = notice.textContent === "";
    if (!editable) {
      readOnlyView(shown);
      status("Shown read-only.");
      return;
    }
    const { width, height } = FORMATS[poster.format];
    const opened = grapesjs.init({
      container: gjs,
      height: "100%",
      width: "auto",
      fromElement: false,
      storageManager: false,
      telemetry: false,
      cssIcons: "",
      panels: { defaults: [] },
      blockManager: { blocks: [] },
      layerManager: { appendTo: undefined },
      // Styles go to the selected element itself, not a class it shares with others.
      selectorManager: { componentFirst: true },
      deviceManager: { devices: [{ id: "page", name: "Page", width: `${width}px`, height: `${height}px`, widthMedia: "" }] },
      plugins: [parserPostCSS, wholePictures],
      // Blocks and pictograms move by a translation, which keeps the layout the model wrote.
      dragMode: "translate",
      // A drawing lets the mouse through to the element holding it (wholePictures).
      protectedCss: `* { box-sizing: border-box; } body { margin: 0; } svg, svg * { pointer-events: none; } .poster-shape-text[contenteditable="true"] { pointer-events: auto; } .poster-tail-handle { position: absolute; display: none; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #ffd400; border: 2px solid #7a5d00; box-shadow: 0 0 0 2px #fff; cursor: move; z-index: 10; } [data-gjs-type="wrapper"] { width: ${width}px; height: ${height}px; overflow: hidden; background: #fff; }`,
      // Two-finger scrolling moves around a page bigger than the view; pinching zooms.
      canvas: { styles: [], scripts: [], infiniteCanvas: true },
      styleManager: {
        appendTo: styles,
        sectors: [
          SHAPE_SECTOR,
          { name: "Text", open: true, properties: ["font-family", "font-size", "font-weight", "color", "text-align", "line-height"] },
          { name: "Background and border", open: true, properties: ["background-color", "border-radius", "border"] },
          { name: "Size", open: false, properties: ["width", "height", "padding", "margin"] },
        ],
      },
      components: shown.html,
      style: shown.css,
    });
    editor = opened;
    opened.on("poster:pick-picture", (target: Component) => pickPicture(target));
    opened.on("load", () => {
      if (editor !== opened) return;
      canvasReady = true;
      // An element placed by left and top (a picture put on the page, or one the model wrote
      // so) moves by them; the drag mode is not kept in the markup, so it is set on every open.
      const canvasWindow = opened.Canvas.getWindow()!;
      for (const component of opened.getWrapper()!.find("*")) {
        const placed = component.getEl();
        if (placed && canvasWindow.getComputedStyle(placed).position === "absolute") component.setDragMode("absolute");
        // Resize handles are not kept in the markup either: a shape stretches freely, a text box
        // by its width, the element holding a drawing as the drawing.
        const classes = component.getClasses();
        const children = component.components();
        if (classes.includes("poster-shape-text")) component.set(TEXT_IN_SHAPE);
        else if (classes.includes("poster-shape")) component.set("resizable", RESIZE_FREE);
        else if (classes.includes("poster-text")) component.set("resizable", RESIZE_WIDTH);
        else if (children.length === 1 && children.at(0).is("svg")) component.set("resizable", KEEP_RATIO);
      }
      const canvasDocument = opened.Canvas.getDocument()!;
      // A picture moves once the mouse has travelled a few pixels with the button down, the
      // browser's own dragging of an image never started: GrapesJS moves from the dragstart it
      // cancels, and Claude Desktop's Electron drags the image natively regardless, carrying it
      // off its card. A press that does not travel stays a click or a double-click.
      let pressedPicture: { component: Component; event: MouseEvent } | undefined;
      canvasDocument.addEventListener("mousedown", (event) => {
        pressedPicture = undefined;
        const pressed = (event.target as Element | null)?.closest?.("img");
        if (event.button !== 0 || !pressed) return;
        const component = opened.getWrapper()!.find("img").find((candidate) => candidate.getEl() === pressed);
        if (!component?.get("draggable")) return;
        event.preventDefault();
        pressedPicture = { component, event };
      }, true);
      canvasDocument.addEventListener("mousemove", (event) => {
        if (!pressedPicture) return;
        if (!(event.buttons & 1)) {
          pressedPicture = undefined;
          return;
        }
        const { component, event: start } = pressedPicture;
        if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 4) return;
        pressedPicture = undefined;
        opened.select(component);
        opened.runCommand("tlb-move", { target: component, event: start });
      }, true);
      // Double-clicking a shape writes in it: its text element, inert to the mouse otherwise,
      // is made editable for the time of the edit (design 3d).
      canvasDocument.addEventListener("dblclick", (event) => {
        const pressed = (event.target as Element | null)?.closest?.(".poster-shape");
        if (!pressed || pressed.classList.contains("line")) return;
        const holder = opened.getWrapper()!.find(".poster-shape").find((candidate) => candidate.getEl() === pressed);
        if (!holder) return;
        let text = holder.find(".poster-shape-text")[0];
        if (!text) {
          for (const [selector, style] of SHAPE_RULES) if (!opened.Css.getRule(selector)) opened.Css.setRule(selector, style);
          [text] = holder.append({ type: "text", tagName: "div", classes: ["poster-shape-text"], components: "", ...TEXT_IN_SHAPE });
        }
        if (!text) return;
        const editing = text;
        editing.set({ selectable: true, editable: true });
        opened.select(editing);
        (editing.getView() as unknown as { onActive?: () => void } | undefined)?.onActive?.();
        setTimeout(() => {
          const element = editing.getEl() as HTMLElement | undefined;
          element?.focus();
          if (element) canvasDocument.getSelection()?.selectAllChildren(element);
        }, 0);
        opened.once("rte:disable", () => {
          editing.set(TEXT_IN_SHAPE);
          if (opened.getSelected() === editing) opened.select(holder);
        });
      }, true);
      wireTailHandle(opened, canvasDocument);
      // Scrolling with the pointer over the page reaches the canvas's own document, not the editor's.
      canvasDocument.addEventListener("wheel", () => requestAnimationFrame(keepPageInView), { passive: true });
      // A press in the page closes the Insert menu, as a press anywhere else in the editor does.
      canvasDocument.addEventListener("mousedown", () => setMenu(false));
      canvasDocument.addEventListener("mouseup", () => {
        pressedPicture = undefined;
      }, true);
      canvasDocument.addEventListener("dragover", (event) => {
        if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      }, true);
      canvasDocument.addEventListener("drop", (event) => {
        const file = [...(event.dataTransfer?.files ?? [])].find((candidate) => candidate.type.startsWith("image/"));
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        const under = (event.target as Element | null)?.closest?.("img");
        const target = under ? opened.getWrapper()!.find("img").find((component) => component.getEl() === under) : undefined;
        const view = canvasDocument.defaultView!;
        void placePicture(file, target, { x: event.clientX + view.scrollX, y: event.clientY + view.scrollY });
      }, true);
      savedSnapshot = current();
      fitZoom();
      status(canSave ? "Double-click a text to correct it; drag a selected element to move it." : "Double-click a text to correct it, then export. Changes are not saved here.");
      void fillDiagramFrames(opened);
    });
    opened.on("update", () => {
      if (editor === opened) syncDirty();
    });
    // GrapesJS's rich-text editor commits browser edits when it is disabled; this
    // event is the reliable boundary for edits made inside the canvas iframe.
    opened.on("rte:disable", () => {
      if (editor === opened) setTimeout(syncDirty, 0);
    });
  }

  const actions: Record<string, () => void> = {
    undo: () => editor?.UndoManager.undo(),
    redo: () => editor?.UndoManager.redo(),
    "zoom-out": () => {
      editor?.Canvas.setZoom(Math.max(10, editor.Canvas.getZoom() / 1.25));
      requestAnimationFrame(keepPageInView);
    },
    "zoom-in": () => {
      editor?.Canvas.setZoom(Math.min(400, editor.Canvas.getZoom() * 1.25));
      requestAnimationFrame(keepPageInView);
    },
    "zoom-fit": () => fitZoom(),
    style: () => setPanel(page.dataset.posterPanel !== "open"),
    insert: () => setMenu(Boolean(insertMenu.hidden)),
    save: () => void doSave(),
    word: () => void exportTo("docx").catch((error: Error) => status(error.message, "error")),
    powerpoint: () => void exportTo("pptx").catch((error: Error) => status(error.message, "error")),
    html: () => void exportTo("html").catch((error: Error) => status(error.message, "error")),
    fullscreen: () => host.toggleFullscreen?.(),
  };
  bar.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest("button")?.dataset.action;
    if (action) actions[action]?.();
  });
  // A file dropped beside the page (on the desk around it, on the bar) would make the browser
  // open it in place of the editor, unsaved changes and all: refused here, with where to drop.
  const refuseDrop = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    if (event.type === "drop") status("Drop a picture on the page itself, or on a picture frame.");
  };
  const editorDocument = root.ownerDocument;
  editorDocument.addEventListener("dragover", refuseDrop);
  editorDocument.addEventListener("drop", refuseDrop);
  // The person scrolls or pinches over the page: kept in view once GrapesJS has moved it. Only
  // the person's own gestures: reacting to every canvas move, fitting included, made the clamp
  // and the fit correct each other on a runner a pixel apart, the page never still under a click.
  const afterGesture = () => requestAnimationFrame(keepPageInView);
  canvasArea.addEventListener("wheel", afterGesture, { passive: true });
  const onResize = () => fitZoom();
  window.addEventListener("resize", onResize);
  // The canvas also changes size without the window doing so: the bar wrapping onto a
  // second line, the style panel opening, the host resizing the frame. Fit again then.
  const canvasSize = new ResizeObserver(() => fitZoom());
  canvasSize.observe(canvasArea);
  setPanel(false);

  return {
    open,
    setTheme(theme) {
      page.dataset.theme = theme;
    },
    setDisplayMode(mode) {
      page.dataset.display = mode;
      if (mode !== lastMode) {
        lastMode = mode;
        // Open where there is room for it: full screen. Inline and in a host's panel
        // (pi-outpost's viewer) the page needs the width; the Style button opens it.
        setPanel(mode === "fullscreen");
      }
      // The host resizes the frame after it says so; fit again once it has.
      setTimeout(fitZoom, 50);
      setTimeout(fitZoom, 400);
    },
    current,
    destroy() {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      editorDocument.removeEventListener("dragover", refuseDrop);
      editorDocument.removeEventListener("drop", refuseDrop);
      editorDocument.removeEventListener("keydown", closeDiagramsOnEscape);
      canvasSize.disconnect();
      editor?.destroy();
      editor = undefined;
      root.replaceChildren();
    },
  };
}
