import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PdfViewer } from "./PdfViewer";

const getPage = vi.fn();
const getDocument = vi.fn();
const destroy = vi.fn(async () => {});

const textLayerRender = vi.fn(async () => {});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (...args: unknown[]) => getDocument(...args),
  TextLayer: class {
    render = textLayerRender;
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
    getPage.mockImplementation(async () => ({
      getViewport: () => ({ width: 10, height: 10 }),
      render: () => ({ promise: new Promise<void>((resolve) => (resolveRender = resolve)), cancel }),
    }));

    render(<PdfViewer path="report.pdf" />);
    await screen.findByText("Page 1 / 1");

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

    // What the browser reports when page 4 scrolls across the middle line
    notify?.([{ isIntersecting: true, target: { dataset: { page: "4" } } }]);
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
