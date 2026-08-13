/**
 * Renders a workspace PDF, page by page, from the bytes of /files/raw.
 *
 * SECURITY: the server serves a PDF as an octet-stream attachment, so it never
 * renders in our origin through the browser's own viewer. Here it is data: pdf.js
 * draws it onto a canvas with annotations disabled, so nothing inside the
 * document can navigate anywhere or run anything.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { rawFileUrl } from "../util/workspacePath";

/** What went wrong, in the terms a reader can act on. */
export type PdfFailure =
  | { kind: "too-large"; limitBytes?: number }
  | { kind: "encrypted" }
  | { kind: "unreadable" }
  | { kind: "not-found" }
  | { kind: "unauthorized" };

/** A render in flight. Starting a second one on the same canvas throws, so cancel first. */
interface PdfRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

interface PdfPageProxy {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvas: HTMLCanvasElement; viewport: unknown; annotationMode: number }): PdfRenderTask;
  /** Feeds the selectable text layer. Absent from a page fake, hence optional. */
  streamTextContent?(): ReadableStream;
}

interface PdfDocumentProxy {
  numPages: number;
  getPage(page: number): Promise<PdfPageProxy>;
}

/**
 * The document is owned by its loading task, and only the task can release it —
 * `PDFDocumentProxy` has no `destroy()`. Calling one on the proxy throws inside an
 * effect cleanup, which unmounts the whole app rather than just this viewer.
 */
interface PdfLoadingTask {
  promise: Promise<PdfDocumentProxy>;
  destroy(): Promise<void>;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

function failureMessage(failure: PdfFailure): string {
  switch (failure.kind) {
    case "too-large":
      return failure.limitBytes === undefined
        ? "This PDF is larger than the server's PDF limit."
        : `This PDF is larger than the ${describeSize(failure.limitBytes)} limit the server allows.`;
    case "encrypted":
      return "This PDF is password-protected, so it cannot be displayed.";
    case "not-found":
      return "This file no longer exists.";
    case "unauthorized":
      return "This session is not authorized to read this file.";
    case "unreadable":
      return "This file could not be read as a PDF.";
  }
}

/** Fetch the bytes, turning the server's refusals into the viewer's failure states. */
async function fetchPdfBytes(serverUrl: string, path: string, token: string | null): Promise<Uint8Array> {
  // fetch can carry a header, unlike <img> — the token stays out of the URL here.
  const response = await fetch(rawFileUrl(serverUrl, path, null), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    if (response.status === 413) {
      const body = (await response.json().catch(() => ({}))) as { limit?: number };
      throw { kind: "too-large", ...(typeof body.limit === "number" ? { limitBytes: body.limit } : {}) } as PdfFailure;
    }
    if (response.status === 401 || response.status === 403) throw { kind: "unauthorized" } as PdfFailure;
    if (response.status === 404) throw { kind: "not-found" } as PdfFailure;
    throw { kind: "unreadable" } as PdfFailure;
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Opens the document and hands back the task that owns it, for release later. */
async function openDocument(bytes: Uint8Array): Promise<{ doc: PdfDocumentProxy; task: PdfLoadingTask }> {
  const pdfjs = await import("pdfjs-dist");
  // Bundled beside the app, never fetched from a CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
  }) as unknown as PdfLoadingTask;
  try {
    return { doc: await task.promise, task };
  } catch (error) {
    await task.destroy().catch(() => {});
    const name = error instanceof Error ? error.name : "";
    throw { kind: name === "PasswordException" ? "encrypted" : "unreadable" } as PdfFailure;
  }
}

/**
 * Lays the page's own text over the canvas, transparent and selectable, so the
 * document can be read with the mouse and copied — a rendered page alone is an
 * image, and an image of text is not text.
 *
 * Failing here costs selection, not the page: the canvas is already drawn.
 */
async function drawTextLayer(
  page: PdfPageProxy,
  viewport: unknown,
  container: HTMLElement | null,
  scale: number,
): Promise<void> {
  if (container === null || page.streamTextContent === undefined) return;
  container.replaceChildren();
  try {
    const pdfjs = await import("pdfjs-dist");
    // The layer's spans size themselves from this variable; without it every
    // glyph collapses to zero and selection lands nowhere.
    container.style.setProperty("--total-scale-factor", String(scale));
    const layer = new pdfjs.TextLayer({
      textContentSource: await page.streamTextContent(),
      container,
      viewport: viewport as never,
    });
    await layer.render();
  } catch {
    container.replaceChildren();
  }
}

/**
 * Cancellation runs in effect cleanup, where a throw unmounts the whole
 * application. Nothing about releasing a render is worth that, so it never throws.
 */
function cancelRender(task: PdfRenderTask | null): void {
  try {
    task?.cancel();
  } catch {
    // Already finished, or a task that does not implement cancel.
  }
}

function isFailure(value: unknown): value is PdfFailure {
  return typeof value === "object" && value !== null && typeof (value as { kind?: unknown }).kind === "string";
}

/** Pages kept drawn on either side of the one being read. Three canvases, not four hundred. */
const RENDER_WINDOW = 1;

/**
 * One page in the scroll. The slot always occupies its full height — that is what
 * makes the scrollbar tell the truth about the document's length — but it only
 * holds a canvas while it is near the viewport. Scrolling away releases the
 * bitmap: forty pages of rendered canvas is hundreds of megabytes.
 */
function PdfPageSlot({
  doc,
  pageNumber,
  scale,
  baseSize,
  active,
  registerSlot,
}: {
  doc: PdfDocumentProxy;
  pageNumber: number;
  scale: number;
  baseSize: { width: number; height: number };
  active: boolean;
  registerSlot: (pageNumber: number, element: HTMLDivElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<PdfRenderTask | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ width: baseSize.width * scale, height: baseSize.height * scale });

  useEffect(() => {
    setSize({ width: baseSize.width * scale, height: baseSize.height * scale });
  }, [baseSize.width, baseSize.height, scale]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const previous = renderRef.current;
    cancelRender(previous);

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (cancelled || canvas === null) return;
        await previous?.promise.catch(() => {});
        if (cancelled) return;
        // The real page may not have page 1's proportions — correct the slot.
        setSize({ width: viewport.width, height: viewport.height });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        // annotationMode 0 = disabled: no link, widget or action inside the
        // document is rendered, so none of them can be followed.
        const task = page.render({ canvas, viewport, annotationMode: 0 });
        renderRef.current = task;
        await task.promise;
        if (cancelled) return;
        await drawTextLayer(page, viewport, textLayerRef.current, scale);
        if (!cancelled) setFailed(false);
      } catch (error) {
        // A render we cancelled ourselves is not a page that failed to draw.
        const name = error instanceof Error ? error.name : "";
        if (!cancelled && name !== "RenderingCancelledException") setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      cancelRender(renderRef.current);
    };
  }, [doc, pageNumber, scale, active]);

  return (
    <div
      ref={(element) => registerSlot(pageNumber, element)}
      data-page={pageNumber}
      className="relative mx-auto mb-4 bg-white shadow last:mb-0"
      style={{ width: size.width, height: size.height }}
    >
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-red-600 dark:text-red-400">
          Page {pageNumber} could not be rendered.
        </p>
      ) : active ? (
        <>
          {/* The canvas is the picture; the layer above it is the text,
              transparent and selectable, sized to the same box. Unmounting them
              when the page scrolls away is what releases the bitmap. */}
          <canvas ref={canvasRef} className="block h-full w-full" />
          <div ref={textLayerRef} className="pdf-text-layer" aria-hidden />
        </>
      ) : null}
    </div>
  );
}

export function PdfViewer({
  path,
  serverUrl = "",
  token = null,
  onLoaded,
}: {
  path: string;
  serverUrl?: string;
  token?: string | null;
  /** Called once the document opened — a PDF that never displayed is not attachable. */
  onLoaded?: (path: string) => void;
}) {
  const [doc, setDoc] = useState<PdfDocumentProxy | null>(null);
  const [failure, setFailure] = useState<PdfFailure | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomStep, setZoomStep] = useState(2);
  /** Page 1's size at scale 1 — every slot's placeholder until its own page draws. */
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    let cancelled = false;
    let loading: PdfLoadingTask | null = null;

    setDoc(null);
    setFailure(null);
    setPageNumber(1);
    setBaseSize(null);

    (async () => {
      try {
        const bytes = await fetchPdfBytes(serverUrl, path, token);
        const { doc: document, task } = await openDocument(bytes);
        loading = task;
        if (cancelled) {
          await task.destroy().catch(() => {});
          return;
        }
        // One page's geometry sizes every slot, so the scroll has its full length
        // before a single page has been drawn.
        try {
          const first = await document.getPage(1);
          const viewport = first.getViewport({ scale: 1 });
          if (!cancelled) setBaseSize({ width: viewport.width, height: viewport.height });
        } catch {
          if (!cancelled) setBaseSize({ width: 612, height: 792 }); // US Letter, the usual default
        }
        if (cancelled) return;
        setDoc(document);
        onLoaded?.(path);
      } catch (error) {
        if (!cancelled) setFailure(isFailure(error) ? error : { kind: "unreadable" });
      }
    })();

    return () => {
      cancelled = true;
      // Cleanup must not throw: an exception here unmounts the whole app, not
      // just this viewer, and the user sees a blank page.
      void loading?.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded is a
    // notification, not an input: a caller passing a fresh closure each render
    // must not refetch the document.
  }, [path, serverUrl, token]);

  const pageCount = doc?.numPages ?? 0;

  const registerSlot = useCallback((page: number, element: HTMLDivElement | null) => {
    if (element === null) slotsRef.current.delete(page);
    else slotsRef.current.set(page, element);
  }, []);

  /**
   * The page indicator follows the scroll: whichever slot crosses the middle of
   * the viewport is the page being read. The margins collapse the observation
   * band to that middle line, so exactly one page qualifies at a time.
   */
  useEffect(() => {
    if (doc === null || typeof IntersectionObserver === "undefined") return;
    const root = scrollerRef.current;
    if (root === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (Number.isFinite(page)) setPageNumber(page);
        }
      },
      { root, rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const slot of slotsRef.current.values()) observer.observe(slot);
    return () => observer.disconnect();
  }, [doc, pageCount]);

  /** Jump to a page — from the controls or the keyboard; scrolling needs no help. */
  const goTo = useCallback(
    (next: number) => {
      if (next < 1 || next > pageCount) return;
      setPageNumber(next);
      slotsRef.current.get(next)?.scrollIntoView({ block: "start" });
    },
    [pageCount],
  );

  if (failure !== null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="max-w-md text-center text-sm text-zinc-600 dark:text-zinc-400">{failureMessage(failure)}</p>
      </div>
    );
  }

  if (doc === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-zinc-500">Loading PDF…</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(event) => {
        if (event.key === "PageDown" || event.key === "ArrowRight") goTo(pageNumber + 1);
        else if (event.key === "PageUp" || event.key === "ArrowLeft") goTo(pageNumber - 1);
        else return;
        event.preventDefault();
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
        <button
          type="button"
          onClick={() => goTo(pageNumber - 1)}
          disabled={pageNumber <= 1}
          aria-label="Previous page"
          className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
        >
          ‹
        </button>
        <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
          Page {pageNumber} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => goTo(pageNumber + 1)}
          disabled={pageNumber >= pageCount}
          aria-label="Next page"
          className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
        >
          ›
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomStep((step) => Math.max(0, step - 1))}
            disabled={zoomStep === 0}
            aria-label="Zoom out"
            className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          >
            −
          </button>
          <span className="tabular-nums text-zinc-500">{Math.round(ZOOM_STEPS[zoomStep] * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoomStep((step) => Math.min(ZOOM_STEPS.length - 1, step + 1))}
            disabled={zoomStep === ZOOM_STEPS.length - 1}
            aria-label="Zoom in"
            className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          >
            +
          </button>
        </span>
      </div>
      {/* One continuous scroll, as a PDF is read. Every page has a slot at its
          real height, but only the pages near the viewport hold a bitmap. */}
      <div ref={scrollerRef} className="flex-1 overflow-auto bg-zinc-100 p-4 dark:bg-zinc-950">
        {baseSize !== null &&
          Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
            <PdfPageSlot
              key={page}
              doc={doc}
              pageNumber={page}
              scale={ZOOM_STEPS[zoomStep]}
              baseSize={baseSize}
              active={Math.abs(page - pageNumber) <= RENDER_WINDOW}
              registerSlot={registerSlot}
            />
          ))}
      </div>
    </div>
  );
}

export default PdfViewer;
