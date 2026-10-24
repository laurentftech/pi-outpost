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
 * file as read when the editor opened: a file the agent rewrote meanwhile is refused,
 * not overwritten. Outside the write zone, or where nothing can write, the editor opens
 * read-only and still exports.
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
  writable,
  fallback,
  onTouchUpDirtyChange,
}: {
  path: string;
  content: string;
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
  // The file as read when the editor opened: what a save is checked against.
  const baseline = useRef<{ mtimeMs: number } | null>(null);
  const [readOnly, setReadOnly] = useState(!writable || fileIo === undefined);
  // Set once the editor page says it is listening: before that the frame is still the
  // blank document it starts as, at this page's origin, and a message to it is refused.
  const ready = useRef(false);
  const onDirty = useRef(onTouchUpDirtyChange);
  onDirty.current = onTouchUpDirtyChange;
  const latest = useRef({ path, dark, readOnly, poster });
  latest.current = { path, dark, readOnly, poster };

  useEffect(() => {
    // Gone with this component: an answer arriving after it is dropped, never posted to a
    // frame now showing another file.
    let alive = true;
    const origin = new URL(editorUrl).origin;
    const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(message, origin);
    const answer = (id: unknown, value: unknown) => {
      if (alive) post({ type: POSTER_FRAME.ANSWER, id, value });
    };

    async function open() {
      const { path: file, poster: shown, dark: isDark } = latest.current;
      if (!("page" in shown)) return;
      let canSave = writable && fileIo !== undefined;
      if (canSave) {
        try {
          baseline.current = { mtimeMs: (await fileIo!.read(file)).mtimeMs };
        } catch {
          canSave = false;
        }
      }
      if (!alive) return;
      setReadOnly(!canSave);
      post({ type: POSTER_FRAME.OPEN, poster: { ...shown.page, revision: 0, readOnly: !canSave }, theme: isDark ? "dark" : "light" });
    }

    async function save(id: unknown, html: string, css: string) {
      const { path: file, poster: shown } = latest.current;
      if (!("page" in shown) || fileIo === undefined || baseline.current === null || latest.current.readOnly) {
        answer(id, { saved: false, message: "this file cannot be saved here" });
        return;
      }
      try {
        const page = pageOf(shown.page.title, { html, css, format: shown.page.format });
        const { mtimeMs } = await fileIo.write(file, page, baseline.current.mtimeMs);
        baseline.current = { mtimeMs };
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
      else if (data.type === POSTER_FRAME.DIRTY) onDirty.current?.((data as { dirty?: unknown }).dirty === true);
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
      // Gone with the editor: nothing unsaved is left to ask about.
      onDirty.current?.(false);
      window.removeEventListener("message", onMessage);
    };
  }, [editorUrl, fileIo, writable]);

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
