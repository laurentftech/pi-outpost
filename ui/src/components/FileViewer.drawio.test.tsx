import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileViewer, isDrawio } from "./FileViewer";
import type { OpenFile } from "../useAgent";
import { DRAWIO_MESSAGE } from "../util/drawioPage";
import { DrawioFilesContext } from "./drawioFiles";

type Props = React.ComponentProps<typeof FileViewer>;

const DIAGRAM = (name: string) =>
  `<mxfile><diagram name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

function loaded(content: string, mtimeMs = 1000, path = "docs/flow.drawio"): OpenFile {
  return { status: "loaded", path, content, size: content.length, mtimeMs };
}

function open(file: OpenFile, overrides: Partial<Props> = {}) {
  const props: Props = {
    file,
    isStreaming: false,
    gitDiff: null,
    inRepository: false,
    serverUrl: "http://127.0.0.1:9",
    onDirtyChange: vi.fn(),
    onFetchGitDiff: vi.fn(),
    onClearGitDiff: vi.fn(),
    onOpenGitHistory: vi.fn(),
    onClose: vi.fn(),
    onReload: vi.fn(),
    onSave: vi.fn(),
    onImageLoad: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<FileViewer {...props} />) };
}

/** The viewer inside the frame, saying it is ready; returns what is posted to it. */
function viewerReady() {
  const frame = screen.getByTestId("drawio-frame") as HTMLIFrameElement;
  const sent = vi.spyOn(frame.contentWindow!, "postMessage");
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: DRAWIO_MESSAGE.READY }, source: frame.contentWindow }));
  });
  return sent;
}

describe("a draw.io file in the viewer", () => {
  it("is recognised by its extension, .drawio or .dio", () => {
    expect(isDrawio("a/b.drawio")).toBe(true);
    expect(isDrawio("A.DIO")).toBe(true);
    expect(isDrawio("flow.drawio.svg")).toBe(false);
    expect(isDrawio("drawio.md")).toBe(false);
  });

  // openlore: scenario=ADrawioFileIsDrawn spec=drawio-diagrams
  it("ADrawioFileIsDrawn: opens drawn, with the source and split modes offered", () => {
    open(loaded(DIAGRAM("Overview")));
    expect(screen.getByTestId("file-drawio")).toBeInTheDocument();
    const sent = viewerReady();
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ type: DRAWIO_MESSAGE.RENDER, xml: DIAGRAM("Overview") }), "*");
    const modes = screen.getByRole("group", { name: "How to show this document" });
    expect(modes).toHaveTextContent("rendered");
    expect(modes).toHaveTextContent("split");
    expect(modes).toHaveTextContent("source");
    fireEvent.click(screen.getByRole("button", { name: /source/ }));
    expect(screen.queryByTestId("file-drawio")).not.toBeInTheDocument();
    expect(screen.getByText(/<mxfile>/)).toBeInTheDocument();
  });

  // openlore: scenario=OpenInDrawio spec=drawio-diagrams
  it("OpenInDrawio: offers to open it in draw.io, with the associated application", () => {
    const onOpenNative = vi.fn();
    open(loaded(DIAGRAM("Overview")), { onOpenNative });
    fireEvent.click(screen.getByRole("button", { name: /open in draw\.io/ }));
    expect(onOpenNative).toHaveBeenCalledWith("docs/flow.drawio");
  });

  it("offers no draw.io button for another file, and no Word export of a diagram's XML", () => {
    const onOpenNative = vi.fn();
    open(loaded(DIAGRAM("Overview")), { onOpenNative });
    expect(screen.queryByRole("button", { name: /Word/i })).not.toBeInTheDocument();
    const other = open(loaded("# notes", 1000, "docs/notes.md"), { onOpenNative });
    expect(other.container.textContent).not.toMatch(/open in draw\.io/);
  });

  // openlore: scenario=TheDiagramFollowsTheFile spec=drawio-diagrams
  it("TheDiagramFollowsTheFile: a version saved elsewhere is drawn, in the same frame", () => {
    const { props, rerender } = open(loaded(DIAGRAM("Before")));
    const frame = screen.getByTestId("drawio-frame");
    const sent = viewerReady();
    // What the reducer does on file_changed: the file is read again, with a new mtime
    rerender(<FileViewer {...props} file={loaded(DIAGRAM("After"), 2000)} />);
    expect(screen.getByTestId("drawio-frame")).toBe(frame);
    expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ type: DRAWIO_MESSAGE.RENDER, xml: DIAGRAM("After") }), "*");
  });
});

describe("touching up a draw.io file in the viewer", () => {
  function openWithFiles(overrides: Partial<Props> = {}) {
    const fileIo = {
      read: vi.fn().mockResolvedValue({ content: DIAGRAM("Overview"), mtimeMs: 1000 }),
      write: vi.fn().mockResolvedValue({ mtimeMs: 2000 }),
      onChanged: vi.fn(() => () => {}),
    };
    const props: Props = {
      file: loaded(DIAGRAM("Overview")),
      isStreaming: false,
      gitDiff: null,
      inRepository: false,
      serverUrl: "http://127.0.0.1:9",
      onDirtyChange: vi.fn(),
      onFetchGitDiff: vi.fn(),
      onClearGitDiff: vi.fn(),
      onOpenGitHistory: vi.fn(),
      onClose: vi.fn(),
      onReload: vi.fn(),
      onSave: vi.fn(),
      onImageLoad: vi.fn(),
      ...overrides,
    };
    render(
      <DrawioFilesContext.Provider value={{ serverUrl: "http://127.0.0.1:9", fileIo }}>
        <FileViewer {...props} />
      </DrawioFilesContext.Provider>,
    );
    return { props, fileIo };
  }

  // openlore: scenario=UnsavedTouchUpIsNotLostSilently spec=drawio-diagrams
  it("UnsavedTouchUpIsNotLostSilently: unsaved touch-ups mark the file and are asked about before closing or changing mode", async () => {
    const { props } = openWithFiles();
    const frame = screen.getByTestId("drawio-frame") as HTMLIFrameElement;
    const answer = (data: unknown) => act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
    });
    answer({ type: DRAWIO_MESSAGE.READY });
    fireEvent.click(screen.getByRole("button", { name: "✎ touch up" }));
    await screen.findByRole("button", { name: "✓ save" });
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /source/ }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "✓ save" })).toBeInTheDocument();
    confirm.mockRestore();
  });
});
