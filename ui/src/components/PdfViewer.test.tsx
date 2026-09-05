import { createRef } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PdfViewer, type PdfViewerHandle } from "./PdfViewer";

const getPage = vi.fn();
const getDocument = vi.fn();
const destroy = vi.fn(async () => {});

interface FakeTextLayerOptions {
  container: HTMLElement;
  textContentSource: unknown;
  viewport: unknown;
}
const textLayerRender = vi.fn(async (_options: FakeTextLayerOptions) => {});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (...args: unknown[]) => getDocument(...args),
  TextLayer: class {
    options: FakeTextLayerOptions;
    constructor(options: FakeTextLayerOptions) {
      this.options = options;
    }
    // Real pdf.js renders spans of the page's own text into `container`. The
    // mock renders nothing by default (existing tests only check that it was
    // asked to); a find-in-page test that needs real text in the layer sets
    // `textLayerRender`'s implementation to populate `options.container` itself.
    render = () => textLayerRender(this.options);
  },
}));

/** A page that draws without complaint. */
function fakePage() {
  return {
    getViewport: () => ({ width: 600, height: 800 }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  };
}

/**
 * Shaped like pdf.js 6 and no kinder: `PDFDocumentProxy` has **no** `destroy()`.
 * A fake that grew one is what let a crash-on-close reach the browser, where the
 * throw happened in an effect cleanup and unmounted the whole application.
 */
function documentOf(numPages: number) {
  return { numPages, getPage };
}

/** The bytes arrive; the document opens. */
function serverReturnsPdf(numPages = 3) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
  );
  getDocument.mockReturnValue({ promise: Promise.resolve(documentOf(numPages)), destroy });
}

/** The server refuses with `status`, carrying `body` as JSON. */
function serverRefuses(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
  );
}

describe("PdfViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPage.mockImplementation(async () => fakePage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the first page and says how many there are", async () => {
    serverReturnsPdf(3);
    render(<PdfViewer path="report.pdf" />);

    expect(await screen.findByText("Page 1 / 3")).toBeInTheDocument();
    expect(getPage).toHaveBeenCalledWith(1);
  });

  it("asks the server for the bytes with a header, never a token in the URL", async () => {
    serverReturnsPdf();
    render(<PdfViewer path="report.pdf" token="secret-token" />);

    await screen.findByText("Page 1 / 3");
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).not.toContain("secret-token");
    expect((init as RequestInit).headers).toEqual({ Authorization: "Bearer secret-token" });
  });

  it("refetches changed bytes even when the workspace path stays the same", async () => {
    serverReturnsPdf();
    const { rerender } = render(<PdfViewer path="report.pdf" revision={1} />);
    await screen.findByText("Page 1 / 3");

    rerender(<PdfViewer path="report.pdf" revision={2} />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    const urls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain("v=1");
    expect(urls[1]).toContain("v=2");
  });

  it("moves between pages, and stops at the ends", async () => {
    serverReturnsPdf(2);
    render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 2");

    fireEvent.click(screen.getByLabelText("Next page"));
    expect(await screen.findByText("Page 2 / 2")).toBeInTheDocument();
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(2));

    expect(screen.getByLabelText("Next page")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Previous page"));
    expect(await screen.findByText("Page 1 / 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
  });

  it("pages from the keyboard", async () => {
    serverReturnsPdf(3);
    const { container } = render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 3");

    fireEvent.keyDown(container.firstChild as HTMLElement, { key: "PageDown" });
    expect(await screen.findByText("Page 2 / 3")).toBeInTheDocument();

    fireEvent.keyDown(container.firstChild as HTMLElement, { key: "ArrowLeft" });
    expect(await screen.findByText("Page 1 / 3")).toBeInTheDocument();
  });

  it("zooms, and redraws the page at the new scale", async () => {
    serverReturnsPdf(1);
    const getViewport = vi.fn((options: { scale: number }) => ({ width: 600 * options.scale, height: 800 * options.scale }));
    getPage.mockImplementation(async () => ({
      getViewport,
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    }));

    render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 1");
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(await screen.findByText("125%")).toBeInTheDocument();
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith({ scale: 1.25 }));
  });

  it("renders with annotations disabled, so nothing in the document can be followed", async () => {
    serverReturnsPdf(1);
    const render_ = vi.fn((_options: { annotationMode: number }) => ({
      promise: Promise.resolve(),
      cancel: () => {},
    }));
    getPage.mockImplementation(async () => ({ getViewport: () => ({ width: 10, height: 10 }), render: render_ }));

    render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 1");

    await waitFor(() => expect(render_).toHaveBeenCalled());
    expect(render_.mock.calls[0][0]).toMatchObject({ annotationMode: 0 });
  });

  it("releases the document through its loading task when it closes", async () => {
    serverReturnsPdf(1);
    const { unmount } = render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 1");

    // Regression: this used to call destroy() on the document proxy, which pdf.js
    // does not define. The throw landed in an effect cleanup and took the app down.
    expect(() => unmount()).not.toThrow();
    expect(destroy).toHaveBeenCalled();
  });

  it("cancels a page's render in flight before redrawing it", async () => {
    serverReturnsPdf(1);
    const cancel = vi.fn();
    let resolveRender: (() => void) | undefined;
    const startRender = vi.fn(() => ({
      promise: new Promise<void>((resolve) => (resolveRender = resolve)),
      cancel,
    }));
    getPage.mockImplementation(async () => ({
      getViewport: () => ({ width: 10, height: 10 }),
      render: startRender,
    }));

    render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 1");
    // The counter says the document loaded; it does not say a render started.
    // The component only holds a task to cancel once it is past `await getPage`,
    // so zooming before that finds nothing in flight and the test fails without
    // the component having done anything wrong — which is how it flaked, on the
    // slowest runner and nowhere else.
    await waitFor(() => expect(startRender).toHaveBeenCalled());

    // pdf.js refuses a second render on a canvas already rendering, so zooming
    // mid-render must cancel the first one rather than start beside it.
    fireEvent.click(screen.getByLabelText("Zoom in"));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    resolveRender?.();
  });

  it("does not report a page failure for a render it cancelled itself", async () => {
    serverReturnsPdf(2);
    const cancelled = new Error("cancelled");
    cancelled.name = "RenderingCancelledException";
    getPage.mockImplementation(async () => ({
      getViewport: () => ({ width: 10, height: 10 }),
      render: () => ({ promise: Promise.reject(cancelled), cancel: () => {} }),
    }));

    render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 2");

    await waitFor(() => expect(screen.queryByText(/could not be rendered/)).toBeNull());
  });

  it("lays selectable text over the page", async () => {
    serverReturnsPdf(1);
    const streamTextContent = vi.fn(async () => "text-stream");
    getPage.mockImplementation(async () => ({
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      streamTextContent,
    }));

    const { container } = render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 1");

    const layer = container.querySelector(".pdf-text-layer") as HTMLElement;
    expect(layer).not.toBeNull();
    await waitFor(() => expect(textLayerRender).toHaveBeenCalled());
    expect(streamTextContent).toHaveBeenCalled();
    // The spans size themselves from this variable; without it selection lands nowhere.
    expect(layer.style.getPropertyValue("--total-scale-factor")).toBe("1");
  });

  it("keeps the page when the text layer fails", async () => {
    serverReturnsPdf(1);
    getPage.mockImplementation(async () => ({
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      streamTextContent: async () => {
        throw new Error("no text stream");
      },
    }));

    render(<PdfViewer path="report.pdf" />);

    expect(await screen.findByText("Page 1 / 1")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/could not be rendered/)).toBeNull());
  });

  it("reports a displayed document once, by path", async () => {
    serverReturnsPdf(1);
    const onLoaded = vi.fn();
    render(<PdfViewer path="report.pdf" onLoaded={onLoaded} />);

    await screen.findByText("Page 1 / 1");
    expect(onLoaded).toHaveBeenCalledWith("report.pdf");
  });
});

describe("PdfViewer failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPage.mockImplementation(async () => fakePage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names the limit when the file is too large", async () => {
    serverRefuses(413, { error: "too-large", limit: 26_214_400 });
    render(<PdfViewer path="huge.pdf" />);

    expect(await screen.findByText(/larger than the 25 MB limit/)).toBeInTheDocument();
  });

  it("still says too large when the server named no limit", async () => {
    serverRefuses(413, {});
    render(<PdfViewer path="huge.pdf" />);

    expect(await screen.findByText(/larger than the server's PDF limit/)).toBeInTheDocument();
  });

  it("reports a missing file and an unauthorized session apart", async () => {
    serverRefuses(404);
    const { unmount } = render(<PdfViewer path="gone.pdf" />);
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    unmount();

    serverRefuses(401);
    render(<PdfViewer path="secret.pdf" />);
    expect(await screen.findByText(/not authorized/)).toBeInTheDocument();
  });

  it("reports a password-protected document as such", async () => {
    serverReturnsPdf();
    const error = new Error("password required");
    error.name = "PasswordException";
    getDocument.mockReturnValue({ promise: Promise.reject(error), destroy });

    render(<PdfViewer path="locked.pdf" />);
    expect(await screen.findByText(/password-protected/)).toBeInTheDocument();
  });

  it("reports a file that is not a PDF", async () => {
    serverReturnsPdf();
    const error = new Error("Invalid PDF structure.");
    error.name = "InvalidPDFException";
    getDocument.mockReturnValue({ promise: Promise.reject(error), destroy });

    render(<PdfViewer path="broken.pdf" />);
    expect(await screen.findByText(/could not be read as a PDF/)).toBeInTheDocument();
  });

  it("keeps the document usable when one page fails to render", async () => {
    serverReturnsPdf(3);
    getPage.mockImplementation(async (page: number) => {
      if (page === 2) throw new Error("render failure");
      return fakePage();
    });

    const { container } = render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 3");
    fireEvent.click(screen.getByLabelText("Next page"));

    // The failure stays inside page 2's slot; its neighbours still draw, and the
    // document is still a document rather than an error page.
    expect(await screen.findByText("Page 2 could not be rendered.")).toBeInTheDocument();
    expect(screen.getByText("Page 2 / 3")).toBeInTheDocument();
    expect(container.querySelectorAll("canvas").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(await screen.findByText("Page 3 / 3")).toBeInTheDocument();
    expect(screen.getByText("Page 3 / 3")).toBeInTheDocument();
  });
});

describe("PdfViewer scrolling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPage.mockImplementation(async () => fakePage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("gives every page a slot, so the scrollbar measures the whole document", async () => {
    serverReturnsPdf(12);
    const { container } = render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 12");

    expect(container.querySelectorAll("[data-page]")).toHaveLength(12);
  });

  it("draws only the pages near the one being read", async () => {
    serverReturnsPdf(12);
    const { container } = render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 12");

    // Forty pages of rendered canvas is hundreds of megabytes; a window of three
    // is what keeps a long report openable.
    await waitFor(() => expect(container.querySelectorAll("canvas").length).toBeLessThanOrEqual(3));
    const pages = Array.from(container.querySelectorAll("[data-page]"), (slot) => slot.getAttribute("data-page"));
    expect(pages[0]).toBe("1");
    expect(pages[11]).toBe("12");
  });

  it("follows the scroll: the page crossing the middle becomes the current one", async () => {
    serverReturnsPdf(5);
    let notify: ((entries: unknown[]) => void) | undefined;
    class FakeObserver {
      constructor(callback: (entries: unknown[]) => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 5");

    // The observer is created only once the document has loaded, which is later
    // than the page indicator appearing. `notify?.()` on a callback that is not
    // there yet does nothing at all, and the test then waits for a change that
    // will never come — one ubuntu CI run in a few, never locally.
    await waitFor(() => expect(notify).toBeDefined());

    // What the browser reports when page 4 scrolls across the middle line. Not
    // optional: a missing observer must fail here, naming itself, rather than
    // being swallowed and reported as a page indicator that would not update.
    notify!([{ isIntersecting: true, target: { dataset: { page: "4" } } }]);
    expect(await screen.findByText("Page 4 / 5")).toBeInTheDocument();
  });

  it("scrolls the page into view when the controls are used", async () => {
    serverReturnsPdf(5);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 5");

    fireEvent.click(screen.getByLabelText("Next page"));
    expect(await screen.findByText("Page 2 / 5")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("PdfViewer find-in-page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    textLayerRender.mockImplementation(async () => {});
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    textLayerRender.mockImplementation(async () => {});
  });

  /** A page whose rendered text layer (once `textLayerRender` is told to
   * populate it, see below) reads exactly `text` — real pdf.js text runs are
   * split across several spans, but one text node is enough to exercise the
   * same DOM-walking highlight utility a plain text file uses. */
  function pageWithText(text: string) {
    return {
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      streamTextContent: async () => text,
      getTextContent: async () => ({ items: [{ str: text }] }),
    };
  }

  /** Makes the mocked text layer actually hold the page's text, so a match can
   * be found and marked in it — the default mock renders nothing (see the
   * shared `TextLayer` mock above). */
  function populateTextLayers() {
    textLayerRender.mockImplementation(async (options) => {
      options.container.textContent = typeof options.textContentSource === "string" ? options.textContentSource : "";
    });
  }

  function pagesByNumber(pages: Record<number, ReturnType<typeof pageWithText>>) {
    getPage.mockImplementation(async (page: number) => pages[page] ?? pageWithText(""));
  }

  it("reports the match count and current index once the document is indexed", async () => {
    serverReturnsPdf(2);
    pagesByNumber({ 1: pageWithText("the quick fox"), 2: pageWithText("a fox in the box") });
    const onFindStateChange = vi.fn();

    render(<PdfViewer path="report.pdf" findQuery="fox" onFindStateChange={onFindStateChange} />);
    await screen.findByText("Page 1 / 2");

    await waitFor(() =>
      expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 2, currentIndex: 0, searching: false }),
    );
  });

  it("finds matches on a page that has not been read yet only once indexing reaches it", async () => {
    serverReturnsPdf(2);
    pagesByNumber({ 1: pageWithText("nothing here"), 2: pageWithText("a fox") });
    const onFindStateChange = vi.fn();

    render(<PdfViewer path="report.pdf" findQuery="fox" onFindStateChange={onFindStateChange} />);
    await screen.findByText("Page 1 / 2");

    await waitFor(() =>
      expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 1, currentIndex: 0, searching: false }),
    );
  });

  it("shows matches found so far as navigable while indexing still has pages left to read", async () => {
    serverReturnsPdf(3);
    pagesByNumber({ 1: pageWithText("has a fox"), 2: pageWithText("nothing"), 3: pageWithText("nothing") });
    const onFindStateChange = vi.fn();

    render(<PdfViewer path="report.pdf" findQuery="fox" onFindStateChange={onFindStateChange} />);
    await screen.findByText("Page 1 / 3");

    // The match on page 1 (read first) is reported — and navigable (a real
    // currentIndex, not -1) — before indexing has read every page.
    await waitFor(() =>
      expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 1, currentIndex: 0, searching: true }),
    );
    // Indexing finishes without finding anything further; the count is unchanged.
    await waitFor(() =>
      expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 1, currentIndex: 0, searching: false }),
    );
  });

  it("treats a page whose text cannot be read as contributing no matches, not an error", async () => {
    serverReturnsPdf(2);
    pagesByNumber({
      1: { ...pageWithText(""), getTextContent: () => Promise.reject(new Error("scan, no text layer")) },
      2: pageWithText("a fox"),
    });
    const onFindStateChange = vi.fn();

    render(<PdfViewer path="report.pdf" findQuery="fox" onFindStateChange={onFindStateChange} />);
    await screen.findByText("Page 1 / 2");

    await waitFor(() =>
      expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 1, currentIndex: 0, searching: false }),
    );
    // The page whose text failed to read still renders normally — reading text
    // for search is independent of drawing the page.
    expect(screen.queryByText(/could not be rendered/)).toBeNull();
  });

  it("highlights the current match at its position on the page once the text layer renders", async () => {
    serverReturnsPdf(1);
    pagesByNumber({ 1: pageWithText("has a fox here") });
    populateTextLayers();

    const { container } = render(<PdfViewer path="report.pdf" findQuery="fox" />);
    await screen.findByText("Page 1 / 1");

    await waitFor(() => {
      const mark = container.querySelector(".pdf-text-layer mark.find-match-current");
      expect(mark).not.toBeNull();
      expect(mark?.textContent).toBe("fox");
    });
  });

  it("jumps to a page containing the next match when it is outside the render window", async () => {
    serverReturnsPdf(5);
    pagesByNumber({
      1: pageWithText("has a fox here"),
      2: pageWithText("nothing"),
      3: pageWithText("nothing"),
      4: pageWithText("nothing"),
      5: pageWithText("another fox"),
    });
    populateTextLayers();
    const onFindStateChange = vi.fn();

    const ref = createRef<PdfViewerHandle>();
    const { container } = render(
      <PdfViewer ref={ref} path="report.pdf" findQuery="fox" onFindStateChange={onFindStateChange} />,
    );
    await screen.findByText("Page 1 / 5");
    // The first match (page 1) is already in view — nothing to jump to yet.
    await waitFor(() => expect(container.querySelector(".find-match-current")).not.toBeNull());
    // Both matches must be indexed before "next" has anywhere to go.
    await waitFor(() =>
      expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 2, currentIndex: 0, searching: false }),
    );

    ref.current?.findNext();

    expect(await screen.findByText("Page 5 / 5")).toBeInTheDocument();
    await waitFor(() => {
      const mark = container.querySelector(".pdf-text-layer mark.find-match-current");
      expect(mark?.textContent).toBe("fox");
    });
  });

  it("moves the highlight between matches on the same page without changing page", async () => {
    serverReturnsPdf(1);
    pagesByNumber({ 1: pageWithText("fox fox") });
    populateTextLayers();

    const ref = createRef<PdfViewerHandle>();
    const { container } = render(<PdfViewer ref={ref} path="report.pdf" findQuery="fox" />);
    await screen.findByText("Page 1 / 1");
    await waitFor(() => expect(container.querySelectorAll(".find-match").length).toBe(2));

    ref.current?.findNext();

    await waitFor(() => expect(container.querySelectorAll(".find-match-current")).toHaveLength(1));
    expect(screen.getByText("Page 1 / 1")).toBeInTheDocument(); // still the same page
    expect(getPage).not.toHaveBeenCalledWith(2);
  });

  it("wraps navigation from the last match back to the first", async () => {
    serverReturnsPdf(1);
    pagesByNumber({ 1: pageWithText("fox fox") });
    populateTextLayers();
    const onFindStateChange = vi.fn();

    const ref = createRef<PdfViewerHandle>();
    render(<PdfViewer ref={ref} path="report.pdf" findQuery="fox" onFindStateChange={onFindStateChange} />);
    await screen.findByText("Page 1 / 1");
    await waitFor(() => expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 2, currentIndex: 0, searching: false }));

    ref.current?.findNext();
    await waitFor(() => expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 2, currentIndex: 1, searching: false }));

    ref.current?.findNext();
    await waitFor(() => expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 2, currentIndex: 0, searching: false }));

    ref.current?.findPrevious();
    await waitFor(() => expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 2, currentIndex: 1, searching: false }));
  });

  it("clears matches and highlighting when the document changes", async () => {
    serverReturnsPdf(1);
    pagesByNumber({ 1: pageWithText("has a fox") });
    populateTextLayers();
    const onFindStateChange = vi.fn();

    const { rerender } = render(
      <PdfViewer path="a.pdf" findQuery="fox" onFindStateChange={onFindStateChange} revision={1} />,
    );
    await screen.findByText("Page 1 / 1");
    await waitFor(() =>
      expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 1, currentIndex: 0, searching: false }),
    );

    serverReturnsPdf(1);
    pagesByNumber({ 1: pageWithText("nothing at all") });
    onFindStateChange.mockClear();

    rerender(<PdfViewer path="b.pdf" findQuery="fox" onFindStateChange={onFindStateChange} revision={1} />);

    await waitFor(() =>
      expect(onFindStateChange).toHaveBeenCalledWith({ matchCount: 0, currentIndex: -1, searching: false }),
    );
  });
});
