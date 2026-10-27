/**
 * A `.poster.html` file, open in the poster editor (@pi-outpost/posters) — correct a
 * text, move a pictogram, change a colour, save back to the file, export to Word or
 * PowerPoint.
 *
 * The editor runs in a frame the server serves (`poster-editor.html`). Not an opaque
 * sandbox like the draw.io viewer's: GrapesJS draws in a nested frame it must reach, which
 * an opaque origin forbids. The frame is held instead by its own Content-Security-Policy —
 * only its bundle runs, nothing is fetched — and the poster is cleaned before loading
 * (poster-editor design, decision 4). It holds no token: it asks this component to save
 * and to download, and this component answers only its own frame.
 *
 * Saving writes the page back through the server's modification-time guard, from the
 * version the editor shows: a file the agent rewrote meanwhile is refused, not
 * overwritten. Outside the write zone, or where nothing can write, the editor opens
 * read-only and still exports.
 *
 * The editor follows the file: a version the agent wrote is sent to it again, unless it
 * holds unsaved touch-ups, which are kept until they are saved or undone.
 *
 * It also draws the project's draw.io diagrams for the editor's diagram frames: the files are
 * read here, and each page drawn by the viewer this application serves (`DrawioPainter`). And it
 * reads the project's picture files for frames naming one, through `loadFile`, the viewer's own
 * route to a file's bytes: the editor frame holds no token.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pageOf, readPage, type PosterPage } from "@pi-outpost/posters/format";
import { MAX_PICTURE_FILE_BYTES, PICTURE_FILE_TYPES, pictureFileType, type DiagramChoice } from "@pi-outpost/posters/diagrams";
import { POSTER_EDITOR_PAGE, POSTER_FRAME, type DrawioAnswer } from "@pi-outpost/posters/frame";
import { FileIoError } from "../fileIo";
import { drawioPage, drawioPages, relativeReference } from "../util/drawioPages";
import type { LoadFile } from "../util/htmlPage";
import { isDrawioFile, resolveRelativeHref } from "../util/workspacePath";
import { DrawioPainter, type DrawioPainterHandle } from "./DrawioPainter";
import { DrawioBlock } from "./DrawioBlock";
import { DIAGRAM_ACTION } from "./diagramControls";
import { useThemeContext } from "../theme/ThemeContext";
import { useDrawioFiles } from "./drawioFiles";

/** Where the server serves the editor frame page, absolute so a widget's host page resolves it to the server. */
export function posterEditorUrl(serverUrl: string, base: string = window.location.href): string {
  return new URL(`${serverUrl}/${POSTER_EDITOR_PAGE}`, base).href;
}

export const POSTER_SANDBOX = "allow-scripts allow-same-origin";

const DISCARD_TOUCH_UPS = "Discard the unsaved touch-ups to this diagram?";

function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PosterFrame({
  path,
  content,
  mtimeMs,
  writable,
  loadFile,
  fallback,
  onTouchUpDirtyChange,
}: {
  path: string;
  content: string;
  /** When `content` was read: what a save of this version is checked against. */
  mtimeMs: number;
  writable: boolean;
  /** A project file's bytes, as the viewer fetches them; absent, frames naming a picture file stay empty. */
  loadFile?: LoadFile;
  fallback: ReactNode;
  /** Unsaved touch-ups in the editor, so the viewer can ask before leaving them. */
  onTouchUpDirtyChange?: (dirty: boolean) => void;
}) {
  const { serverUrl, fileIo, onOpenNative } = useDrawioFiles();
  const dark = useThemeContext() === "dark";
  const frame = useRef<HTMLIFrameElement>(null);
  const painter = useRef<DrawioPainterHandle>(null);
  const editorUrl = useMemo(() => posterEditorUrl(serverUrl), [serverUrl]);
  const poster = useMemo((): { page: PosterPage } | { problem: string } => {
    try {
      return { page: readPage(content) };
    } catch (error) {
      return { problem: error instanceof Error ? error.message : String(error) };
    }
  }, [content]);
  // The version the editor shows, as read: what a save is checked against.
  const baseline = useRef<{ mtimeMs: number } | null>(null);
  // The page the editor holds — as last sent to it, or as it last saved — and whether it
  // holds touch-ups on top of it. A new version of the file is sent only over a clean one.
  const shown = useRef<string | null>(null);
  const touchedUp = useRef(false);
  // The version a save just replaced, still held here until the viewer reads the file back.
  // The editor says it is clean right after saving, and sending it this version then would
  // put the page from before the save back on screen.
  const replaced = useRef<string | null>(null);
  const reopen = useRef<() => void>(() => {});
  const [readOnly, setReadOnly] = useState(!writable || fileIo === undefined);
  // Set once the editor page says it is listening: before that the frame is still the
  // blank document it starts as, at this page's origin, and a message to it is refused.
  const ready = useRef(false);
  const onDirty = useRef(onTouchUpDirtyChange);
  onDirty.current = onTouchUpDirtyChange;
  const latest = useRef({ path, content, mtimeMs, dark, readOnly, poster, loadFile });
  latest.current = { path, content, mtimeMs, dark, readOnly, poster, loadFile };
  // A diagram of the poster open for touch-up over it (poster-diagram-touch-up): the file, the
  // page, the request to answer when it closes, and the file as it was when it opened.
  const [touching, setTouching] = useState<{ file: string; page?: string; id: unknown; before: string } | null>(null);
  const touchingRef = useRef(touching);
  touchingRef.current = touching;
  const touchUpDirty = useRef(false);
  const answerRef = useRef<(id: unknown, value: unknown) => void>(() => {});

  useEffect(() => {
    // Gone with this component: an answer arriving after it is dropped, never posted to a
    // frame now showing another file.
    let alive = true;
    const origin = new URL(editorUrl).origin;
    const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(message, origin);
    const answer = (id: unknown, value: unknown) => {
      if (alive) post({ type: POSTER_FRAME.ANSWER, id, value });
    };
    answerRef.current = answer;

    // Opens overlap when the file changes while one is checking it: only the last one sends.
    let opening = 0;
    async function open() {
      const run = ++opening;
      const { path: file, content: page, mtimeMs: readAt, poster: opened, dark: isDark } = latest.current;
      if (!("page" in opened)) return;
      let canSave = writable && fileIo !== undefined;
      if (canSave) {
        try {
          await fileIo!.read(file);
        } catch {
          canSave = false;
        }
      }
      if (!alive || run !== opening) return;
      // The time of the version shown, not of the file now: a write landing after this
      // version was read must refuse the next save, not be overwritten by it.
      baseline.current = canSave ? { mtimeMs: readAt } : null;
      shown.current = page;
      setReadOnly(!canSave);
      post({ type: POSTER_FRAME.OPEN, poster: { ...opened.page, revision: 0, readOnly: !canSave }, theme: isDark ? "dark" : "light" });
    }
    reopen.current = () => {
      if (!ready.current || touchedUp.current) return;
      if (latest.current.content === replaced.current) return;
      replaced.current = null;
      if (latest.current.content !== shown.current) void open();
      // The same page written again: what the editor shows is the file, as of this time.
      else if (baseline.current !== null) baseline.current = { mtimeMs: latest.current.mtimeMs };
    };

    async function save(id: unknown, html: string, css: string) {
      const { path: file, poster: opened } = latest.current;
      if (!("page" in opened) || fileIo === undefined || baseline.current === null || latest.current.readOnly) {
        answer(id, { saved: false, message: "this file cannot be saved here" });
        return;
      }
      try {
        const page = pageOf(opened.page.title, { html, css, format: opened.page.format });
        const { mtimeMs } = await fileIo.write(file, page, baseline.current.mtimeMs);
        baseline.current = { mtimeMs };
        // Read back as written, the file is what the editor already holds: nothing to reopen.
        if (latest.current.content !== page) replaced.current = latest.current.content;
        shown.current = page;
        answer(id, { saved: true, revision: 0, message: "Saved. The agent reads this version." });
      } catch (error) {
        const conflict = error instanceof FileIoError && error.reason === "conflict";
        answer(id, {
          saved: false,
          message: conflict ? "the file changed on disk since it was opened, so it was not saved. Close and reopen it to see what is there now." : error instanceof Error ? error.message : String(error),
        });
      }
    }

    /** Answers a DRAWIO_LIST or DRAWIO_DRAW with its value, or with why there is none. */
    async function reply<T>(id: unknown, work: () => Promise<T>) {
      let outcome: DrawioAnswer<T>;
      try {
        outcome = { ok: true, value: await work() };
      } catch (error) {
        outcome = { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      answer(id, outcome);
    }

    /** The project's diagrams, as a frame of this poster names them, with their pages. */
    async function listDiagrams(): Promise<DiagramChoice[]> {
      if (fileIo?.find === undefined) throw new Error("this view cannot look through the project's files");
      const found = new Set<string>();
      for (const query of [".drawio", ".dio"]) {
        for (const entry of await fileIo.find(query)) if (entry.type === "file" && isDrawioFile(entry.path)) found.add(entry.path);
      }
      const poster = latest.current.path;
      return Promise.all(
        [...found].map(async (file) => {
          let pages: string[] = [];
          try {
            pages = drawioPages((await fileIo.read(file)).content);
          } catch {
            // Offered all the same: drawing it says what is wrong with it.
          }
          return { path: relativeReference(poster, file), pages };
        }),
      );
    }

    /** One page of the diagram `reference` names, from this poster's directory, as an SVG. */
    async function drawDiagram(reference: string, page: string | undefined): Promise<string> {
      const file = resolveRelativeHref(latest.current.path, reference);
      if (!isDrawioFile(file)) throw new Error(`"${reference}" is not a .drawio file`);
      if (fileIo === undefined) throw new Error("this view cannot read the project's files");
      let text: string;
      try {
        text = (await fileIo.read(file)).content;
      } catch (error) {
        throw new Error(`"${reference}" could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
      const xml = drawioPage(text, page);
      if (painter.current === null) throw new Error("the poster was closed");
      return painter.current.draw(xml);
    }

    /** Opens the diagram `reference` names for touch-up; answered when it closes (closeTouchUp). */
    async function editDiagram(id: unknown, reference: string, page: string | undefined) {
      const refuse = (message: string) => answer(id, { ok: false, message } satisfies DrawioAnswer<boolean>);
      if (touchingRef.current !== null) return refuse("another diagram is open for touch-up");
      const file = resolveRelativeHref(latest.current.path, reference);
      if (!isDrawioFile(file)) return refuse(`"${reference}" is not a .drawio file`);
      if (fileIo === undefined) return refuse("this view cannot read the project's files");
      let before: string;
      try {
        before = (await fileIo.read(file)).content;
        drawioPages(before);
      } catch (error) {
        return refuse(`"${reference}" could not be opened: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!alive) return;
      touchUpDirty.current = false;
      setTouching({ file, page, id, before });
    }

    /** The project's picture files, as a frame of this poster names them. */
    async function listPictures(): Promise<string[]> {
      if (fileIo?.find === undefined) throw new Error("this view cannot look through the project's files");
      const found = new Set<string>();
      for (const extension of Object.keys(PICTURE_FILE_TYPES)) {
        for (const entry of await fileIo.find(extension)) if (entry.type === "file" && pictureFileType(entry.path) !== undefined) found.add(entry.path);
      }
      const poster = latest.current.path;
      return [...found].map((file) => relativeReference(poster, file));
    }

    /** The picture file `reference` names, from this poster's directory, with its media type. */
    async function readPicture(reference: string): Promise<{ type: string; bytes: Uint8Array }> {
      const file = resolveRelativeHref(latest.current.path, reference);
      const type = pictureFileType(file);
      if (type === undefined) throw new Error(`"${reference}" is not a picture file (SVG, PNG, JPEG, GIF or WebP)`);
      const load = latest.current.loadFile;
      if (load === undefined) throw new Error("this view cannot read the project's files");
      const blob = await load(file);
      if (blob === undefined) throw new Error(`"${reference}" could not be read: it is not there, or not in the project`);
      if (blob.size > MAX_PICTURE_FILE_BYTES) throw new Error(`"${reference}" is ${Math.round(blob.size / 1024 / 1024)} MB, more than a poster reads (${MAX_PICTURE_FILE_BYTES / 1024 / 1024} MB)`);
      return { type, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }

    function onMessage(event: MessageEvent) {
      // Only this component's frame, from the server it was loaded from.
      if (frame.current === null || event.source !== frame.current.contentWindow || event.origin !== origin) return;
      const data = event.data as { type?: unknown; id?: unknown; html?: unknown; css?: unknown; name?: unknown; mediaType?: unknown; bytes?: unknown } | null;
      if (data === null || typeof data !== "object") return;
      if (data.type === POSTER_FRAME.READY) {
        ready.current = true;
        void open();
      }
      else if (data.type === POSTER_FRAME.DIRTY) {
        touchedUp.current = (data as { dirty?: unknown }).dirty === true;
        onDirty.current?.(touchedUp.current);
        // Touch-ups saved or undone: a version the agent wrote meanwhile can be shown now.
        reopen.current();
      }
      else if (data.type === POSTER_FRAME.SAVE && typeof data.html === "string" && typeof data.css === "string") void save(data.id, data.html, data.css);
      else if (data.type === POSTER_FRAME.DELIVER && typeof data.name === "string" && typeof data.mediaType === "string" && data.bytes instanceof Uint8Array) {
        download(data.name, data.bytes, data.mediaType);
        answer(data.id, `Downloaded "${data.name}".`);
      }
      else if (data.type === POSTER_FRAME.DRAWIO_LIST) void reply(data.id, listDiagrams);
      else if (data.type === POSTER_FRAME.DRAWIO_DRAW) {
        const { path: reference, page } = data as { path?: unknown; page?: unknown };
        if (typeof reference === "string") void reply(data.id, () => drawDiagram(reference, typeof page === "string" ? page : undefined));
      }
      else if (data.type === POSTER_FRAME.DRAWIO_EDIT) {
        const { path: reference, page } = data as { path?: unknown; page?: unknown };
        if (typeof reference === "string") void editDiagram(data.id, reference, typeof page === "string" ? page : undefined);
      }
      else if (data.type === POSTER_FRAME.PICTURE_LIST) void reply(data.id, listPictures);
      else if (data.type === POSTER_FRAME.PICTURE_READ) {
        const { path: reference } = data as { path?: unknown };
        if (typeof reference === "string") void reply(data.id, () => readPicture(reference));
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      alive = false;
      ready.current = false;
      // The touch-up goes with the poster; its request goes unanswered with the frame that made it
      setTouching(null);
      reopen.current = () => {};
      // Gone with the editor: nothing unsaved is left to ask about.
      onDirty.current?.(false);
      window.removeEventListener("message", onMessage);
    };
  }, [editorUrl, fileIo, writable]);

  // A new version of the file, read after the agent wrote it.
  useEffect(() => reopen.current(), [content, mtimeMs]);

  // The theme follows the application, live.
  useEffect(() => {
    if (ready.current) frame.current?.contentWindow?.postMessage({ type: POSTER_FRAME.THEME, theme: dark ? "dark" : "light" }, new URL(editorUrl).origin);
  }, [dark, editorUrl]);

  /** Closes the touch-up, unsaved touch-ups asked about first, and tells the editor whether the file changed. */
  async function closeTouchUp() {
    const open = touchingRef.current;
    if (open === null) return;
    if (touchUpDirty.current && !window.confirm(DISCARD_TOUCH_UPS)) return;
    setTouching(null);
    let outcome: DrawioAnswer<boolean>;
    try {
      outcome = { ok: true, value: (await fileIo!.read(open.file)).content !== open.before };
    } catch (error) {
      outcome = { ok: false, message: `the diagram could not be read again: ${error instanceof Error ? error.message : String(error)}` };
    }
    answerRef.current(open.id, outcome);
  }

  // Escape closes it, once no touch-up holds the key (the touch-up takes it as "done")
  useEffect(() => {
    if (touching === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      void closeTouchUpRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [touching]);
  const closeTouchUpRef = useRef(closeTouchUp);
  closeTouchUpRef.current = closeTouchUp;

  const onTouchUpDirtyOfDiagram = useCallback((dirty: boolean) => { touchUpDirty.current = dirty; }, []);

  if ("problem" in poster) {
    return (
      <div data-testid="poster-unreadable">
        <p className="border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          This poster cannot be opened in the editor: {poster.problem}.
        </p>
        {fallback}
      </div>
    );
  }
  return (
    <>
      <iframe
        ref={frame}
        title={path}
        data-testid="poster-frame"
        data-read-only={readOnly ? "true" : "false"}
        sandbox={POSTER_SANDBOX}
        src={editorUrl}
        className="block h-full w-full border-0"
      />
      <DrawioPainter ref={painter} serverUrl={serverUrl} />
      {touching !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Touch up ${touching.file}`}
          data-testid="poster-diagram-touch-up"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="flex h-full max-h-[56rem] w-full max-w-[90rem] flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
              <span className="min-w-0 flex-1 truncate font-medium" title={touching.file}>
                {touching.file}{touching.page !== undefined ? ` — ${touching.page}` : ""}
              </span>
              {onOpenNative && (
                <button type="button" className={DIAGRAM_ACTION} onClick={() => onOpenNative(touching.file)} title="Open the diagram in draw.io desktop, for anything more than a touch-up; its saves come back here">
                  ↗ draw.io desktop
                </button>
              )}
              <button type="button" className={DIAGRAM_ACTION} onClick={() => void closeTouchUp()} title="Back to the poster, which takes the diagram as saved (Escape)">
                back to the poster
              </button>
            </header>
            <div className="min-h-0 flex-1">
              <DrawioBlock
                path={touching.file}
                variant="viewer"
                page={touching.page}
                startTouchUp
                onTouchUpDirtyChange={onTouchUpDirtyOfDiagram}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
