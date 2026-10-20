/**
 * A draw.io diagram, drawn by jgraph's viewer in a frame that can reach nothing (see
 * `drawioPage`).
 *
 * The frame is made once per mounted viewer and each text is posted to it, so the split
 * mode redraws the draft without reloading the viewer. A text the viewer cannot draw
 * says why, above `fallback` — the source — rather than leaving an empty frame.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useThemeContext } from "../theme/ThemeContext";
import { DRAWIO_MESSAGE, drawioFramePage, drawioViewerUrl } from "../util/drawioPage";

/** Scripts only: no same-origin, so the viewer cannot reach this document, its storage or its token. */
export const DRAWIO_SANDBOX = "allow-scripts";

export function DrawioFrame({ xml, serverUrl, title, fallback }: { xml: string; serverUrl: string; title: string; fallback?: ReactNode }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const dark = useThemeContext() === "dark";
  const page = useMemo(() => drawioFramePage(drawioViewerUrl(serverUrl)), [serverUrl]);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only this frame: any other window could post the same shape
      if (frame.current === null || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: unknown; message?: unknown } | null;
      if (data === null || typeof data !== "object") return;
      if (data.type === DRAWIO_MESSAGE.READY) setReady(true);
      else if (data.type === DRAWIO_MESSAGE.RENDERED) setFailure(null);
      else if (data.type === DRAWIO_MESSAGE.FAILED) setFailure(typeof data.message === "string" ? data.message : "The diagram could not be drawn.");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    // Before READY the viewer is not listening yet; READY itself brings this back round
    if (!ready) return;
    frame.current?.contentWindow?.postMessage({ type: DRAWIO_MESSAGE.RENDER, xml, dark }, "*");
  }, [ready, xml, dark]);

  return (
    <div className="flex h-full min-h-[24rem] flex-col" data-testid="drawio-view">
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
}
