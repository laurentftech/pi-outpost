import { readFileSync } from "node:fs";
import path from "node:path";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { DrawioFrame, DRAWIO_SANDBOX, type DrawioFrameHandle, type DrawioTouchUpState } from "./DrawioFrame";
import { DRAWIO_MESSAGE, drawioFramePage, drawioViewerUrl } from "../util/drawioPage";
import { ThemeContext } from "../theme/ThemeContext";

const XML = '<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>';
const VIEWER = "http://127.0.0.1:9/vendor/drawio/viewer-static.min.js";

function post(data: unknown, source: MessageEventSource | null) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

function mount(xml = XML, theme: "light" | "dark" = "light") {
  const view = render(
    <ThemeContext.Provider value={theme}>
      <DrawioFrame xml={xml} serverUrl="http://127.0.0.1:9" title="diagrams/flow.drawio" fallback={<pre data-testid="fallback">source</pre>} />
    </ThemeContext.Provider>,
  );
  const frame = screen.getByTestId("drawio-frame") as HTMLIFrameElement;
  const own = frame.contentWindow!;
  const sent = vi.spyOn(own, "postMessage");
  return { ...view, frame, own, sent };
}

describe("drawioFramePage", () => {
  // openlore: scenario=TheViewerNeverReachesTheNetwork spec=drawio-diagrams
  it("TheViewerNeverReachesTheNetwork: its policy lets in the viewer script and nothing else", () => {
    const page = drawioFramePage(VIEWER);
    const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(page)?.[1] ?? "";
    const directives = Object.fromEntries(policy.split("; ").map((part) => [part.split(" ")[0], part.split(" ").slice(1)]));
    expect(directives["default-src"]).toEqual(["'none'"]);
    expect(directives["script-src"]).toEqual([VIEWER, "'unsafe-inline'", "'unsafe-eval'"]);
    expect(directives["img-src"]).toEqual(["data:", "blob:"]);
    expect(directives["font-src"]).toEqual(["data:"]);
    // Nothing can be fetched or connected to: no connect-src, frame-src, media-src…
    expect(Object.keys(directives).sort()).toEqual(["default-src", "font-src", "img-src", "script-src", "style-src"]);
    // The policy comes before any script runs
    expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("<script"));
    expect(page).toContain(`<script src="${VIEWER}"></script>`);
    // The viewer's defaults (viewer.diagrams.net) are replaced before it loads
    expect(page).not.toContain("diagrams.net");
    expect(page.indexOf('"STENCIL_PATH":"http://127.0.0.1:9/vendor/drawio"')).toBeLessThan(page.indexOf(`<script src="${VIEWER}">`));
  });

  it("asks the viewer for its own dark mode in the form it reads, a string", () => {
    // GraphViewer.isDarkMode compares with "dark"; a boolean silently draws light
    const page = drawioFramePage(VIEWER);
    expect(page).toContain('"dark-mode": dark ? "dark" : "light"');
    // Its colours are light-dark() pairs, which follow the document's color-scheme
    expect(page).toContain('document.documentElement.style.colorScheme = dark ? "dark" : "light"');
    // The toolbar at its default place, inside the frame: "inline" draws it above it
    expect(page).not.toContain("toolbar-position");
    expect(page).toContain('toolbar: "pages zoom layers"');
  });

  it("serves the viewer from the server the interface talks to", () => {
    expect(drawioViewerUrl("http://127.0.0.1:9", "http://elsewhere/app/")).toBe(VIEWER);
    // The standalone app talks to its own origin
    expect(drawioViewerUrl("", "http://127.0.0.1:3141/")).toBe("http://127.0.0.1:3141/vendor/drawio/viewer-static.min.js");
  });

  it("carries touch-up inside the same isolation: the mxGraph rules it needs, and nothing loaded", () => {
    const page = drawioFramePage(VIEWER);
    // The label editor is placed by these; without them it opens at the foot of the page
    expect(page).toMatch(/\.mxCellEditor \{ position: absolute;/);
    expect(page).toContain("div.mxRubberband");
    // Turned on and off by message, from the parent only
    for (const type of [DRAWIO_MESSAGE.EDIT, DRAWIO_MESSAGE.SAVE, DRAWIO_MESSAGE.CLEAN, DRAWIO_MESSAGE.UNDO, DRAWIO_MESSAGE.REDO, DRAWIO_MESSAGE.EXPORT_SVG]) {
      expect(page).toContain(JSON.stringify(type));
    }
    expect(page).toContain("if (event.source !== parent) return;");
    // The viewer's no-op click is what keeps edges from ever being selected
    expect(page).toContain("delete graph.click;");
    // No stylesheet, font or frame is fetched for it
    expect(page).not.toMatch(/<link|@import|url\(/);
  });

  it("relies on editing machinery the vendored viewer still has", () => {
    // A jgraph release that drops one of these breaks touch-up: caught here, not by a reader
    const viewer = readFileSync(path.resolve(import.meta.dirname, "../../../web/public/vendor/drawio/viewer-static.min.js"), "utf8");
    for (const name of ["mxUndoManager", "mxKeyHandler", "mxCodec", "mxCellEditor", "getPrettyXml", "Graph.decompress", "Graph.prototype.getSvg", "updateGraphXml"]) {
      expect(viewer).toContain(name);
    }
  });

  it("cannot be broken out of by a URL that closes the script", () => {
    const page = drawioFramePage("http://x/</script><script>alert(1)</script>/viewer-static.min.js");
    // The globals are JSON with < escaped and the src an escaped attribute, so the only
    // </script> are the page's own three
    expect(page.match(/<\/script>/g)?.length).toBe(3);
    expect(page).not.toContain("<script>alert(1)");
  });
});

describe("DrawioFrame", () => {
  // openlore: scenario=TheViewerNeverReachesTheNetwork spec=drawio-diagrams
  it("TheViewerNeverReachesTheNetwork: draws in a frame with an opaque origin", () => {
    const { frame } = mount();
    expect(frame).toHaveAttribute("sandbox", DRAWIO_SANDBOX);
    expect(DRAWIO_SANDBOX).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(frame).toHaveAttribute("title", "diagrams/flow.drawio");
  });

  // openlore: scenario=ADrawioFileIsDrawn spec=drawio-diagrams
  it("ADrawioFileIsDrawn: posts the diagram once the viewer is ready, and only to its own frame", () => {
    const { own, sent } = mount(XML, "dark");
    expect(sent).not.toHaveBeenCalled();
    // Another window saying ready is not the viewer
    post({ type: DRAWIO_MESSAGE.READY }, window);
    expect(sent).not.toHaveBeenCalled();
    post({ type: DRAWIO_MESSAGE.READY }, own);
    expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.RENDER, xml: XML, dark: true }, "*");
  });

  // openlore: scenario=TheDraftIsDrawnBesideIt spec=drawio-diagrams
  it("TheDraftIsDrawnBesideIt: a new text is posted to the same frame, which is not reloaded", () => {
    const { own, sent, frame, rerender } = mount();
    post({ type: DRAWIO_MESSAGE.READY }, own);
    const next = XML.replace('name="P"', 'name="Q"');
    rerender(
      <ThemeContext.Provider value="light">
        <DrawioFrame xml={next} serverUrl="http://127.0.0.1:9" title="diagrams/flow.drawio" />
      </ThemeContext.Provider>,
    );
    expect(screen.getByTestId("drawio-frame")).toBe(frame);
    expect(sent).toHaveBeenLastCalledWith({ type: DRAWIO_MESSAGE.RENDER, xml: next, dark: false }, "*");
  });

  it("draws again when a reloaded frame says READY once more", () => {
    const { own, sent } = mount();
    post({ type: DRAWIO_MESSAGE.READY }, own);
    post({ type: DRAWIO_MESSAGE.READY }, own);
    expect(sent.mock.calls.filter(([message]) => (message as { type: string }).type === DRAWIO_MESSAGE.RENDER)).toHaveLength(2);
  });

  // openlore: scenario=AnUnreadableDiagramSaysWhy spec=drawio-diagrams
  it("AnUnreadableDiagramSaysWhy: says why and shows the source, then draws again once it can", () => {
    const { own, frame } = mount("<html/>");
    post({ type: DRAWIO_MESSAGE.READY }, own);
    post({ type: DRAWIO_MESSAGE.FAILED, message: "This is not a draw.io diagram: its root is <html>." }, own);
    expect(screen.getByRole("alert")).toHaveTextContent("its root is <html>");
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    // Collapsed, still laid out, so the next text is drawn at its width
    expect(frame.className).toContain("h-0");
    expect(frame.className).not.toContain("hidden");
    post({ type: DRAWIO_MESSAGE.RENDERED, pages: 1 }, own);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });
});

describe("DrawioFrame touch-up", () => {
  function mountEditing(props: { editing: boolean; xml?: string; onTouchUpChange?: (state: DrawioTouchUpState) => void; onPageLocked?: () => void }) {
    const handle = createRef<DrawioFrameHandle>();
    const element = (p: typeof props) => (
      <ThemeContext.Provider value="light">
        <DrawioFrame ref={handle} xml={p.xml ?? XML} serverUrl="http://127.0.0.1:9" title="flow.drawio" editing={p.editing} onTouchUpChange={p.onTouchUpChange} onPageLocked={p.onPageLocked} />
      </ThemeContext.Provider>
    );
    const view = render(element(props));
    const frame = screen.getByTestId("drawio-frame") as HTMLIFrameElement;
    const own = frame.contentWindow!;
    const sent = vi.spyOn(own, "postMessage");
    post({ type: DRAWIO_MESSAGE.READY }, own);
    return { handle, own, sent, rerender: (p: typeof props) => view.rerender(element(p)) };
  }
  const types = (sent: ReturnType<typeof vi.spyOn>) => sent.mock.calls.map(([message]) => (message as { type: string }).type);

  // openlore: scenario=ReadingIsReadOnly spec=drawio-diagrams
  it("ReadingIsReadOnly: touch-up is asked of the frame only when editing is on", () => {
    const { sent, rerender } = mountEditing({ editing: false });
    expect(types(sent)).toEqual([DRAWIO_MESSAGE.RENDER]);
    rerender({ editing: true });
    expect(sent).toHaveBeenLastCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: true }, "*");
  });

  it("holds a new text back while touching up, and draws it on leaving, once", () => {
    const { sent, rerender } = mountEditing({ editing: true });
    const next = XML.replace('name="P"', 'name="Saved"');
    rerender({ editing: true, xml: next });
    // Drawing it now would drop the reader's edits without asking
    expect(sent.mock.calls.filter(([m]) => (m as { xml?: string }).xml === next)).toEqual([]);
    rerender({ editing: false, xml: next });
    expect(sent).toHaveBeenLastCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: false, xml: next, dark: false }, "*");
    expect(sent.mock.calls.filter(([m]) => (m as { xml?: string }).xml === next)).toHaveLength(1);
  });

  it("reports touch-up state and a refused page change from its own frame only", () => {
    const onTouchUpChange = vi.fn();
    const onPageLocked = vi.fn();
    const { own } = mountEditing({ editing: true, onTouchUpChange, onPageLocked });
    post({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false }, window);
    expect(onTouchUpChange).not.toHaveBeenCalled();
    post({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false }, own);
    expect(onTouchUpChange).toHaveBeenLastCalledWith({ dirty: true, canUndo: true, canRedo: false });
    post({ type: DRAWIO_MESSAGE.PAGE_LOCKED }, own);
    expect(onPageLocked).toHaveBeenCalledOnce();
  });

  it("saves, undoes, redoes, marks clean and exports through the frame's messages", async () => {
    const { handle, own, sent } = mountEditing({ editing: true });
    const saving = handle.current!.save();
    expect(sent).toHaveBeenLastCalledWith({ type: DRAWIO_MESSAGE.SAVE }, "*");
    // Another window answering is not the frame
    post({ type: DRAWIO_MESSAGE.SAVED, page: 9, xml: "<mxGraphModel/>" }, window);
    post({ type: DRAWIO_MESSAGE.SAVED, page: 1, xml: "<mxGraphModel grid=\"1\"/>" }, own);
    await expect(saving).resolves.toEqual({ page: 1, xml: "<mxGraphModel grid=\"1\"/>" });
    act(() => {
      handle.current!.markClean();
      handle.current!.undo();
      handle.current!.redo();
    });
    expect(types(sent).slice(-3)).toEqual([DRAWIO_MESSAGE.CLEAN, DRAWIO_MESSAGE.UNDO, DRAWIO_MESSAGE.REDO]);
    const exporting = handle.current!.exportSvg();
    post({ type: DRAWIO_MESSAGE.SVG, page: 0, name: "Overview", svg: "<svg/>" }, own);
    await expect(exporting).resolves.toEqual({ page: 0, name: "Overview", svg: "<svg/>" });
  });

  it("fails a save the frame never answers, rather than leaving it pending", async () => {
    vi.useFakeTimers();
    try {
      const { handle } = mountEditing({ editing: true });
      const saving = handle.current!.save();
      vi.advanceTimersByTime(10_001);
      await expect(saving).rejects.toThrow("did not answer");
    } finally {
      vi.useRealTimers();
    }
  });
});
