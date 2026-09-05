/**
 * Renders a workspace PDF, page by page, from the bytes of /files/raw.
 *
 * SECURITY: the server serves a PDF as an octet-stream attachment, so it never
 * renders in our origin through the browser's own viewer. Here it is data: pdf.js
 * draws it onto a canvas with annotations disabled, so nothing inside the
 * document can navigate anywhere or run anything.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { rawFileUrl } from "../util/workspacePath";
import { highlightMatches, type HighlightResult } from "../util/findInPage";
import { indexPdfText, searchPdfIndex, type PdfMatch } from "../util/pdfFindIndex";

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
  /** The page's text, for search — read independently of the (streamed) text layer,
   * so a page far outside the render window can still be searched. Absent from a
   * page fake, hence optional; a page without one contributes no matches. */
  getTextContent?(): Promise<{ items: ReadonlyArray<{ str?: string }> }>;
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

/** What the find bar shows for a PDF: the document is searched as a whole (see
 * ui/src/util/pdfFindIndex.ts), not just the pages currently rendered. */
export interface PdfFindState {
  matchCount: number;
  /** -1 when there is no current match (no query, or no matches yet). */
  currentIndex: number;
  /** The document-wide text index is still being built; more matches may still appear. */
  searching: boolean;
}

export interface PdfViewerHandle {
  findNext(): void;
  findPrevious(): void;
}

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
async function fetchPdfBytes(serverUrl: string, path: string, token: string | null, revision: number): Promise<Uint8Array> {
  // fetch can carry a header, unlike <img> — the token stays out of the URL here.
  const response = await fetch(rawFileUrl(serverUrl, path, null, revision), {
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

/**
 * The module, loaded once and shared by every caller.
 *
 * Two pages can each need it at once (the render window holds several), and
 * without this, each dynamic `import()` call raced its own module load —
 * fine in a real browser (repeat imports of one specifier share the module
 * job), but not always through this test suite's mocked module runner, where
 * a second concurrent `import("pdfjs-dist")` was observed to bypass the mock
 * and load the real, unmocked build instead. One shared promise removes the
 * race rather than working around its symptom.
 */
interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: { data: Uint8Array; useWorkerFetch: boolean; isOffscreenCanvasSupported: boolean }): unknown;
  TextLayer: new (options: { textContentSource: unknown; container: HTMLElement; viewport: unknown }) => {
    render(): Promise<void>;
  };
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import("pdfjs-dist") as unknown as Promise<PdfjsModule>;
  return pdfjsPromise;
}

/** Opens the document and hands back the task that owns it, for release later. */
async function openDocument(bytes: Uint8Array): Promise<{ doc: PdfDocumentProxy; task: PdfLoadingTask }> {
  const pdfjs = await loadPdfjs();
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
    const pdfjs = await loadPdfjs();
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
  onTextLayerReady,
}: {
  doc: PdfDocumentProxy;
  pageNumber: number;
  scale: number;
  baseSize: { width: number; height: number };
  active: boolean;
  registerSlot: (pageNumber: number, element: HTMLDivElement | null) => void;
  /** Reports the text layer becoming available (find-in-page can now mark it) or
   * going away (it was drawn at a different scale, or the page left the render
   * window and its whole subtree was unmounted). */
  onTextLayerReady?: (pageNumber: number, container: HTMLDivElement | null) => void;
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
        if (!cancelled) {
          setFailed(false);
          onTextLayerReady?.(pageNumber, textLayerRef.current);
        }
      } catch (error) {
        // A render we cancelled ourselves is not a page that failed to draw.
        const name = error instanceof Error ? error.name : "";
        if (!cancelled && name !== "RenderingCancelledException") setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      cancelRender(renderRef.current);
      onTextLayerReady?.(pageNumber, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onTextLayerReady is a
    // notification, like onLoaded below: a caller passing a fresh closure each
    // render must not retrigger this render/cancel effect.
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

export const PdfViewer = forwardRef<
  PdfViewerHandle,
  {
    path: string;
    serverUrl?: string;
    token?: string | null;
    /** Cache-buster incremented when the file changes without changing path. */
    revision?: number;
    /** Called once the document opened — a PDF that never displayed is not attachable. */
    onLoaded?: (path: string) => void;
    /** The active find-in-page query, or "" when find is not in use. */
    findQuery?: string;
    /** Reported whenever the match count, current match, or indexing progress changes. */
    onFindStateChange?: (state: PdfFindState) => void;
  }
>(function PdfViewer({ path, serverUrl = "", token = null, revision = 0, onLoaded, findQuery = "", onFindStateChange }, ref) {
  const [doc, setDoc] = useState<PdfDocumentProxy | null>(null);
  const [failure, setFailure] = useState<PdfFailure | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomStep, setZoomStep] = useState(2);
  /** Page 1's size at scale 1 — every slot's placeholder until its own page draws. */
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef(new Map<number, HTMLDivElement>());

  // --- find-in-page ---------------------------------------------------------
  // The document-wide text index (ui/src/util/pdfFindIndex.ts): built lazily,
  // independently of which pages are rendered, so a match far from the page
  // currently open can still be found.
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const [indexSearching, setIndexSearching] = useState(false);
  const [matches, setMatches] = useState<PdfMatch[]>([]);
  const [currentMatch, setCurrentMatch] = useState(-1);
  const indexerRef = useRef<{ cancel: () => void } | null>(null);
  const indexStartedRef = useRef(false);
  const prevQueryRef = useRef(findQuery);
  // Ready text-layer containers, by page — populated by PdfPageSlot as pages
  // render, independently of the render-window state above (that drives what's
  // drawn; this drives what can currently be highlighted).
  const textLayerContainersRef = useRef(new Map<number, HTMLDivElement>());
  const activeHighlightRef = useRef<{ page: number; result: HighlightResult } | null>(null);
  // Read inside callbacks that must not go stale between renders (see
  // onTextLayerReady below) without forcing those callbacks to change identity.
  const matchesRef = useRef<PdfMatch[]>([]);
  const currentMatchRef = useRef(-1);
  const findQueryRef = useRef(findQuery);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);
  useEffect(() => {
    currentMatchRef.current = currentMatch;
  }, [currentMatch]);
  useEffect(() => {
    findQueryRef.current = findQuery;
  }, [findQuery]);

  const clearHighlight = useCallback(() => {
    activeHighlightRef.current?.result.clear();
    activeHighlightRef.current = null;
  }, []);

  /** Marks every occurrence on `container`'s page and distinguishes the current one —
   * the same utility, and the same "mark everything, distinguish current" behavior,
   * that a plain text or Markdown view gets (ui/src/util/findInPage.ts). */
  const applyHighlight = useCallback(
    (target: PdfMatch, container: HTMLElement) => {
      clearHighlight();
      const result = highlightMatches(container, findQueryRef.current);
      activeHighlightRef.current = { page: target.page, result };
      const marks = result.matches[target.ordinalOnPage]?.marks ?? [];
      for (const mark of marks) mark.classList.add("find-match-current");
      marks[0]?.scrollIntoView({ block: "center" });
    },
    [clearHighlight],
  );

  const onTextLayerReady = useCallback(
    (page: number, container: HTMLDivElement | null) => {
      if (container === null) {
        textLayerContainersRef.current.delete(page);
        return;
      }
      textLayerContainersRef.current.set(page, container);
      // If find navigation is already waiting on this page (it just came into
      // the render window, or was redrawn at a new scale), finish the job now.
      const target = matchesRef.current[currentMatchRef.current];
      if (target !== undefined && target.page === page) applyHighlight(target, container);
    },
    [applyHighlight],
  );

  useEffect(() => {
    let cancelled = false;
    let loading: PdfLoadingTask | null = null;

    setDoc(null);
    setFailure(null);
    setPageNumber(1);
    setBaseSize(null);
    // A new document is a new document to search: any index, match, or
    // highlight from the previous one describes text that is no longer here.
    indexerRef.current?.cancel();
    indexerRef.current = null;
    indexStartedRef.current = false;
    setPageTexts(new Map());
    setIndexSearching(false);
    setMatches([]);
    setCurrentMatch(-1);
    clearHighlight();
    textLayerContainersRef.current.clear();

    (async () => {
      try {
        const bytes = await fetchPdfBytes(serverUrl, path, token, revision);
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
  }, [path, serverUrl, token, revision]);

  const pageCount = doc?.numPages ?? 0;

  const registerSlot = useCallback((page: number, element: HTMLDivElement | null) => {
    if (element === null) slotsRef.current.delete(page);
    else slotsRef.current.set(page, element);
  }, []);

  /**
   * Starts reading the document's text for search, once — the first time a
   * query arrives. Deliberately not torn down when `findQuery` changes (only
   * `indexStartedRef` gates re-entry): a `useEffect` cleanup runs on every
   * dependency change, and cancelling the indexer on each keystroke would mean
   * it never gets past the first page or two of a document searched while
   * someone is still typing.
   */
  useEffect(() => {
    if (doc === null || findQuery === "" || indexStartedRef.current) return;
    indexStartedRef.current = true;
    setIndexSearching(true);
    const document_ = doc;
    const source = {
      numPages: document_.numPages,
      getPageText: async (page: number) => {
        const proxy = await document_.getPage(page);
        if (proxy.getTextContent === undefined) return "";
        const content = await proxy.getTextContent();
        return content.items.map((item) => (typeof item.str === "string" ? item.str : "")).join("");
      },
    };
    indexerRef.current = indexPdfText(
      source,
      pageNumber,
      (page, text) =>
        setPageTexts((prev) => {
          const next = new Map(prev);
          next.set(page, text);
          return next;
        }),
      () => setIndexSearching(false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageNumber seeds
    // where reading starts and is intentionally not tracked afterward;
    // indexStartedRef already limits this to running once per document.
  }, [doc, findQuery]);

  // The indexer's lifetime is the document's, not any single render of this
  // effect — cancelled on a new document (see the loading effect above) or on
  // unmount, never merely because a dependency above changed.
  useEffect(() => {
    return () => {
      indexerRef.current?.cancel();
      indexerRef.current = null;
    };
  }, [doc]);

  /**
   * Recomputes matches whenever the index grows or the query changes. The
   * current match resets to the first result only when the query itself
   * changed — not when indexing merely delivered another page for the same
   * query, which would otherwise yank the reader back to the top of the
   * document every time a background page finishes indexing mid-navigation.
   */
  useEffect(() => {
    const found = searchPdfIndex(pageTexts, doc?.numPages ?? 0, findQuery);
    const queryChanged = findQuery !== prevQueryRef.current;
    prevQueryRef.current = findQuery;
    setMatches(found);
    setCurrentMatch((prev) => {
      if (found.length === 0) return -1;
      if (queryChanged || prev === -1) return 0;
      return Math.min(prev, found.length - 1);
    });
  }, [pageTexts, findQuery, doc]);

  /**
   * Moves to (and, once rendered, highlights) the current match. A match on a
   * page outside the render window is brought in via `goTo`; highlighting then
   * completes once `onTextLayerReady` reports that page's text layer drawn.
   */
  useEffect(() => {
    if (currentMatch === -1 || matches.length === 0) {
      clearHighlight();
      return;
    }
    const target = matches[currentMatch];
    if (activeHighlightRef.current !== null && activeHighlightRef.current.page !== target.page) clearHighlight();
    if (Math.abs(target.page - pageNumber) > RENDER_WINDOW) {
      goTo(target.page);
      return;
    }
    const container = textLayerContainersRef.current.get(target.page);
    if (container !== undefined) applyHighlight(target, container);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goTo/applyHighlight/clearHighlight
    // are stable; pageNumber is read only to decide whether the target page is
    // already in the render window, not to re-run this on every scroll.
  }, [currentMatch, matches]);

  useImperativeHandle(
    ref,
    () => ({
      findNext() {
        if (matchesRef.current.length === 0) return;
        setCurrentMatch((prev) => (prev + 1) % matchesRef.current.length);
      },
      findPrevious() {
        if (matchesRef.current.length === 0) return;
        setCurrentMatch((prev) => (prev - 1 + matchesRef.current.length) % matchesRef.current.length);
      },
    }),
    [],
  );

  useEffect(() => {
    onFindStateChange?.({ matchCount: matches.length, currentIndex: currentMatch, searching: indexSearching });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onFindStateChange is
    // a notification, like onLoaded above: a caller passing a fresh closure each
    // render must not retrigger anything from this.
  }, [matches.length, currentMatch, indexSearching]);

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
              onTextLayerReady={onTextLayerReady}
            />
          ))}
      </div>
    </div>
  );
});

export default PdfViewer;
