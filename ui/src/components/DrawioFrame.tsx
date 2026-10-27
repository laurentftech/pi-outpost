/**
 * A draw.io diagram, drawn by jgraph's viewer in a frame that can reach nothing (see
 * `drawioPage`).
 *
 * The frame is made once per mounted viewer and each text is posted to it, so the split
 * mode redraws the draft without reloading the viewer. A text the viewer cannot draw
 * says why, above `fallback` — the source — rather than leaving an empty frame.
 *
 * `editing` turns touch-up on in the frame; the handle saves, undoes and exports. While
 * touch-up is on, a new `xml` is held back rather than drawn: drawing it would drop the
 * reader's edits without asking. It is drawn when touch-up ends.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { useThemeContext } from "../theme/ThemeContext";
import { DRAWIO_MESSAGE, drawioFramePage, drawioViewerUrl } from "../util/drawioPage";

/** Scripts only: no same-origin, so the viewer cannot reach this document, its storage or its token. */
export const DRAWIO_SANDBOX = "allow-scripts";

/** How wires are drawn, as the touch-up bar offers it. */
export type DrawioWireStyle = "straight" | "orthogonal" | "curved";

/** What touch-up reports after each edit, undo, redo, save or selection. */
export interface DrawioTouchUpState {
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The style of the wires a choice would change — the selected ones, else the page's — or `mixed`. */
  wireStyle?: DrawioWireStyle | "mixed";
}

export interface DrawioFrameHandle {
  /** The shown page's `<mxGraphModel>` and its index, to splice into the file. */
  save(): Promise<{ page: number; xml: string }>;
  /** The last `save()` is on disk: what is drawn is no longer dirty. */
  markClean(): void;
  undo(): void;
  redo(): void;
  /** Draws the selected wires, or every wire of the page when none is selected, and new ones, in `style`: one undoable change. */
  setWireStyle(style: DrawioWireStyle): void;
  /** The shown page as a standalone SVG document, with the page's name when it has one. */
  exportSvg(): Promise<{ page: number; name: string | null; svg: string }>;
}

interface DrawioFrameProps {
  xml: string;
  serverUrl: string;
  title: string;
  fallback?: ReactNode;
  /** Touch-up mode. */
  editing?: boolean;
  onTouchUpChange?: (state: DrawioTouchUpState) => void;
  /** A page change was refused: the shown page has unsaved touch-ups. */
  onPageLocked?: () => void;
  /** Escape pressed in the frame (the application cannot see it while the frame has the keyboard). */
  onEscape?: () => void;
  /** Drawn, or not drawable — so a holder can tell an empty frame from a failed one. */
  onRendered?: (failure: string | null) => void;
  /** Height rule for the frame's box; a reply's block is shorter than the file viewer. */
  className?: string;
  /** The page shown first, from 0; later texts keep the page the reader turned to. */
  page?: number;
}

/** How long the frame has to answer a save or an export before it is called gone. */
const ANSWER_TIMEOUT_MS = 10_000;

export const DrawioFrame = forwardRef<DrawioFrameHandle, DrawioFrameProps>(function DrawioFrame(
  { xml, serverUrl, title, fallback, editing = false, onTouchUpChange, onPageLocked, onEscape, onRendered, className = "flex h-full min-h-[24rem] flex-col", page: startPage },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const dark = useThemeContext() === "dark";
  const page = useMemo(() => drawioFramePage(drawioViewerUrl(serverUrl)), [serverUrl]);
  // Counted, not a flag: a frame that reloads says READY again with nothing drawn
  const [ready, setReady] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  // Answers awaited from the frame, one per kind: a second request supersedes the first
  const waiting = useRef(new Map<string, { resolve: (data: never) => void; reject: (error: Error) => void }>());
  const callbacks = useRef({ onTouchUpChange, onPageLocked, onEscape, onRendered });
  callbacks.current = { onTouchUpChange, onPageLocked, onEscape, onRendered };
  // What the frame has drawn, so leaving touch-up draws a newer text exactly once
  const drawn = useRef<{ xml: string; dark: boolean } | null>(null);
  const wasEditing = useRef(editing);

  function post(message: Record<string, unknown>) {
    frame.current?.contentWindow?.postMessage(message, "*");
  }

  function ask<T>(request: string, answer: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.current.get(answer)?.reject(new Error("superseded"));
      const timer = setTimeout(() => {
        waiting.current.delete(answer);
        reject(new Error("the diagram did not answer"));
      }, ANSWER_TIMEOUT_MS);
      waiting.current.set(answer, {
        resolve: ((data: T) => { clearTimeout(timer); resolve(data); }) as (data: never) => void,
        reject: (error: Error) => { clearTimeout(timer); reject(error); },
      });
      post({ type: request });
    });
  }

  useImperativeHandle(ref, () => ({
    save: () => ask<{ page: number; xml: string }>(DRAWIO_MESSAGE.SAVE, DRAWIO_MESSAGE.SAVED),
    markClean: () => post({ type: DRAWIO_MESSAGE.CLEAN }),
    undo: () => post({ type: DRAWIO_MESSAGE.UNDO }),
    redo: () => post({ type: DRAWIO_MESSAGE.REDO }),
    setWireStyle: (style) => post({ type: DRAWIO_MESSAGE.WIRE_STYLE, style }),
    exportSvg: () => ask<{ page: number; name: string | null; svg: string }>(DRAWIO_MESSAGE.EXPORT_SVG, DRAWIO_MESSAGE.SVG),
  }));

  useEffect(() => {
    const pending = waiting.current;
    function onMessage(event: MessageEvent) {
      // Only this frame: any other window could post the same shape
      if (frame.current === null || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: unknown; message?: unknown } & Record<string, unknown> | null;
      if (data === null || typeof data !== "object") return;
      if (data.type === DRAWIO_MESSAGE.READY) {
        drawn.current = null;
        wasEditing.current = false;
        setReady((count) => count + 1);
      }
      else if (data.type === DRAWIO_MESSAGE.RENDERED) {
        setFailure(null);
        callbacks.current.onRendered?.(null);
      } else if (data.type === DRAWIO_MESSAGE.FAILED) {
        const message = typeof data.message === "string" ? data.message : "The diagram could not be drawn.";
        setFailure(message);
        callbacks.current.onRendered?.(message);
      } else if (data.type === DRAWIO_MESSAGE.CHANGED) {
        const wireStyle = ["straight", "orthogonal", "curved", "mixed"].includes(data.wireStyle as string) ? (data.wireStyle as DrawioWireStyle | "mixed") : undefined;
        callbacks.current.onTouchUpChange?.({ dirty: data.dirty === true, canUndo: data.canUndo === true, canRedo: data.canRedo === true, ...(wireStyle ? { wireStyle } : {}) });
      } else if (data.type === DRAWIO_MESSAGE.FOCUS) {
        // Only while touching up: the frame asks on its own mousedown, so the reader is in it
        if (frame.current !== null && document.activeElement !== frame.current) frame.current.focus({ preventScroll: true });
      } else if (data.type === DRAWIO_MESSAGE.ESCAPE) {
        callbacks.current.onEscape?.();
      } else if (data.type === DRAWIO_MESSAGE.PAGE_LOCKED) {
        callbacks.current.onPageLocked?.();
      } else if (data.type === DRAWIO_MESSAGE.SAVED && typeof data.xml === "string" && typeof data.page === "number") {
        pending.get(DRAWIO_MESSAGE.SAVED)?.resolve({ page: data.page, xml: data.xml } as never);
        pending.delete(DRAWIO_MESSAGE.SAVED);
      } else if (data.type === DRAWIO_MESSAGE.SVG && typeof data.svg === "string" && typeof data.page === "number") {
        pending.get(DRAWIO_MESSAGE.SVG)?.resolve({ page: data.page, name: typeof data.name === "string" ? data.name : null, svg: data.svg } as never);
        pending.delete(DRAWIO_MESSAGE.SVG);
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      for (const answer of pending.values()) answer.reject(new Error("the diagram was closed"));
      pending.clear();
    };
  }, []);

  useEffect(() => {
    // Before READY the viewer is not listening yet; READY itself brings this back round
    if (ready === 0) return;
    if (editing) {
      // Touch-up starts on the text given with it: a fresh frame has nothing drawn yet,
      // and the file may have moved since what is drawn was read
      if (!wasEditing.current && (drawn.current === null || drawn.current.xml !== xml || drawn.current.dark !== dark)) {
        drawn.current = { xml, dark };
        post({ type: DRAWIO_MESSAGE.RENDER, xml, dark, ...(startPage === undefined ? {} : { page: startPage }) });
      }
      if (!wasEditing.current) post({ type: DRAWIO_MESSAGE.EDIT, on: true });
      wasEditing.current = true;
      return;
    }
    if (wasEditing.current) {
      // Leaving touch-up redraws, edits dropped: the text it comes back to is the latest
      wasEditing.current = false;
      drawn.current = { xml, dark };
      post({ type: DRAWIO_MESSAGE.EDIT, on: false, xml, dark });
      return;
    }
    if (drawn.current !== null && drawn.current.xml === xml && drawn.current.dark === dark) return;
    drawn.current = { xml, dark };
    post({ type: DRAWIO_MESSAGE.RENDER, xml, dark, ...(startPage === undefined ? {} : { page: startPage }) });
  }, [ready, xml, dark, editing]);

  return (
    <div className={className} data-testid="drawio-view">
      {failure !== null && (
        <div role="alert" data-testid="drawio-failure" className="border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {failure}
        </div>
      )}
      {/* Kept mounted while it fails, so the next draft is drawn without reloading the viewer */}
      <iframe
        ref={frame}
        title={title}
        data-testid="drawio-frame"
        sandbox={DRAWIO_SANDBOX}
        srcDoc={page}
        // Collapsed, not `display: none`: a frame with no width would draw the next
        // diagram fitted to nothing
        className={failure === null ? "min-h-0 w-full flex-1 border-0" : "h-0 w-full border-0"}
      />
      {failure !== null && <div className="min-h-0 flex-1 overflow-auto">{fallback}</div>}
    </div>
  );
});
