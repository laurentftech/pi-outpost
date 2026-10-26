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
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pageOf, readPage, type PosterPage } from "@pi-outpost/posters/format";
import { POSTER_EDITOR_PAGE, POSTER_FRAME } from "@pi-outpost/posters/frame";
import { FileIoError } from "../fileIo";
import { useThemeContext } from "../theme/ThemeContext";
import { useDrawioFiles } from "./drawioFiles";

/** Where the server serves the editor frame page, absolute so a widget's host page resolves it to the server. */
export function posterEditorUrl(serverUrl: string, base: string = window.location.href): string {
  return new URL(`${serverUrl}/${POSTER_EDITOR_PAGE}`, base).href;
}

export const POSTER_SANDBOX = "allow-scripts allow-same-origin";

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
  fallback,
  onTouchUpDirtyChange,
}: {
  path: string;
  content: string;
  /** When `content` was read: what a save of this version is checked against. */
  mtimeMs: number;
  writable: boolean;
  fallback: ReactNode;
  /** Unsaved touch-ups in the editor, so the viewer can ask before leaving them. */
  onTouchUpDirtyChange?: (dirty: boolean) => void;
}) {
  const { serverUrl, fileIo } = useDrawioFiles();
  const dark = useThemeContext() === "dark";
  const frame = useRef<HTMLIFrameElement>(null);
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
  const latest = useRef({ path, content, mtimeMs, dark, readOnly, poster });
  latest.current = { path, content, mtimeMs, dark, readOnly, poster };

  useEffect(() => {
    // Gone with this component: an answer arriving after it is dropped, never posted to a
    // frame now showing another file.
    let alive = true;
    const origin = new URL(editorUrl).origin;
    const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(message, origin);
    const answer = (id: unknown, value: unknown) => {
      if (alive) post({ type: POSTER_FRAME.ANSWER, id, value });
    };

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
    }
    window.addEventListener("message", onMessage);
    return () => {
      alive = false;
      ready.current = false;
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
    <iframe
      ref={frame}
      title={path}
      data-testid="poster-frame"
      data-read-only={readOnly ? "true" : "false"}
      sandbox={POSTER_SANDBOX}
      src={editorUrl}
      className="block h-full w-full border-0"
    />
  );
}
