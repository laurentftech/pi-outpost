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
import { grapesjs, type Editor, type Plugin } from "grapesjs";
import parserModule from "grapesjs-parser-postcss";
import { FORMATS, pageOf, type PosterFormat } from "./format.ts";
import { DOCX_MEDIA_TYPE, PPTX_MEDIA_TYPE, exportFileName, posterDocx, posterPptx } from "./office.ts";
import { pagePicture } from "./picture.ts";

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
  bar.append(title, save, undo, redo, zoom, style, downloads, fullscreen);
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
    setDirty(changed);
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
    for (const control of [undo, redo, zoom, style]) control.hidden = !editable;
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
      plugins: [parserPostCSS],
      // Blocks and pictograms move by a translation, which keeps the layout the model wrote.
      dragMode: "translate",
      protectedCss: `* { box-sizing: border-box; } body { margin: 0; } [data-gjs-type="wrapper"] { width: ${width}px; height: ${height}px; overflow: hidden; background: #fff; }`,
      // Two-finger scrolling moves around a page bigger than the view; pinching zooms.
      canvas: { styles: [], scripts: [], infiniteCanvas: true },
      styleManager: {
        appendTo: styles,
        sectors: [
          { name: "Text", open: true, properties: ["font-family", "font-size", "font-weight", "color", "text-align", "line-height"] },
          { name: "Background and border", open: true, properties: ["background-color", "border-radius", "border"] },
          { name: "Size", open: false, properties: ["width", "height", "padding", "margin"] },
        ],
      },
      components: shown.html,
      style: shown.css,
    });
    editor = opened;
    opened.on("load", () => {
      if (editor !== opened) return;
      canvasReady = true;
      savedSnapshot = current();
      fitZoom();
      status(canSave ? "Double-click a text to correct it; drag a selected element to move it." : "Double-click a text to correct it, then export. Changes are not saved here.");
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
    "zoom-out": () => editor?.Canvas.setZoom(Math.max(10, editor.Canvas.getZoom() / 1.25)),
    "zoom-in": () => editor?.Canvas.setZoom(Math.min(400, editor.Canvas.getZoom() * 1.25)),
    "zoom-fit": () => fitZoom(),
    style: () => setPanel(page.dataset.posterPanel !== "open"),
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
      canvasSize.disconnect();
      editor?.destroy();
      editor = undefined;
      root.replaceChildren();
    },
  };
}
