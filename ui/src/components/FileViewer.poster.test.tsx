import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { pageOf, readPage } from "@pi-outpost/posters/format";
import { POSTER_FRAME } from "@pi-outpost/posters/frame";
import { POSTER_EXAMPLE } from "@pi-outpost/posters/guide";
import { FileViewer, isPoster } from "./FileViewer";
import type { OpenFile } from "../useAgent";
import { FileIoError, type FileIo } from "../fileIo";
import { DrawioFilesContext } from "./drawioFiles";
import { POSTER_SANDBOX } from "./PosterFrame";

// The viewer that draws a page needs a browser that lays text out: here, a stand-in that
// keeps the page it was handed and answers with a fixed picture.
const painted = vi.hoisted(() => ({ xml: [] as string[], svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text>drawn</text></svg>' }));
vi.mock("./DrawioPainter", async () => {
  const React = await import("react");
  return {
    DrawioPainter: React.forwardRef(function FakePainter(_props: unknown, ref: React.Ref<{ draw(xml: string): Promise<string> }>) {
      React.useImperativeHandle(ref, () => ({
        draw: async (xml: string) => {
          painted.xml.push(xml);
          return painted.svg;
        },
      }));
      return null;
    }),
  };
});

type Props = React.ComponentProps<typeof FileViewer>;

const SERVER = "http://127.0.0.1:9";
const PAGE = pageOf("Class rules", { html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format });

function loaded(content: string, path = "posters/Class rules.poster.html", mtimeMs = 1000): OpenFile {
  return { status: "loaded", path, content, size: content.length, mtimeMs };
}

function fakeFileIo(overrides: Partial<FileIo> = {}): FileIo {
  return {
    read: vi.fn(async () => ({ content: PAGE, mtimeMs: 1000 })),
    write: vi.fn(async () => ({ mtimeMs: 2000 })),
    onChanged: vi.fn(() => () => {}),
    ...overrides,
  };
}

function open(file: OpenFile, fileIo: FileIo | undefined = fakeFileIo(), overrides: Partial<Props> = {}) {
  const props: Props = {
    file,
    isStreaming: false,
    gitDiff: null,
    inRepository: false,
    serverUrl: SERVER,
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
  const shown = (props: Props) => (
    <DrawioFilesContext.Provider value={{ serverUrl: SERVER, fileIo }}>
      <FileViewer {...props} />
    </DrawioFilesContext.Provider>
  );
  const view = render(shown(props));
  /** The viewer's re-read of the file, as after the agent wrote it. */
  const reread = (next: OpenFile) => view.rerender(shown({ ...props, file: next }));
  return { ...view, reread };
}

/** The OPEN messages the viewer sent the editor frame, oldest first. */
function opens(sent: { mock: { calls: unknown[][] } }) {
  return sent.mock.calls
    .map(([message]) => message as { type: string; poster?: { html: string } })
    .filter((message) => message.type === POSTER_FRAME.OPEN);
}

/** A message from the editor frame, from the server it was loaded from. */
function fromFrame(frame: HTMLIFrameElement, data: Record<string, unknown>, origin = SERVER) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow, origin }));
  });
}

describe("a poster in the viewer", () => {
  it("is recognised by its double extension, and a plain page is not one", () => {
    expect(isPoster("a/Class rules.poster.html")).toBe(true);
    expect(isPoster("A.POSTER.HTML")).toBe(true);
    expect(isPoster("report.html")).toBe(false);
    expect(isPoster("poster.html")).toBe(false);
  });

  // openlore: scenario=APosterFileOpensInTheEditor spec=poster-files
  it("APosterFileOpensInTheEditor: drawn in the editor frame, with the source mode and no split", async () => {
    open(loaded(PAGE));
    const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe(`${SERVER}/poster-editor.html`);
    expect(frame.getAttribute("sandbox")).toBe(POSTER_SANDBOX);
    const sent = vi.spyOn(frame.contentWindow!, "postMessage");
    fromFrame(frame, { type: POSTER_FRAME.READY });
    await waitFor(() => expect(sent).toHaveBeenCalledWith(expect.objectContaining({ type: POSTER_FRAME.OPEN }), SERVER));
    const opened = sent.mock.calls.find(([message]) => (message as { type: string }).type === POSTER_FRAME.OPEN)![0] as { poster: Record<string, unknown> };
    expect(opened.poster).toMatchObject({ ...readPage(PAGE), readOnly: false });
    const modes = screen.getByRole("group", { name: "How to show this document" });
    expect(modes).toHaveTextContent("rendered");
    expect(modes).toHaveTextContent("source");
    expect(modes).not.toHaveTextContent("split");
    fireEvent.click(screen.getByRole("button", { name: /source/ }));
    expect(screen.queryByTestId("poster-frame")).not.toBeInTheDocument();
    expect(screen.getByText(/poster-format/)).toBeInTheDocument();
  });

  it("A poster offers no export of its text to Word: the editor's Word button is the one", () => {
    open(loaded(PAGE));
    expect(screen.queryByRole("button", { name: /word/i })).not.toBeInTheDocument();
  });

  it("The editor is opened with the application's theme", async () => {
    open(loaded(PAGE));
    const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
    const sent = vi.spyOn(frame.contentWindow!, "postMessage");
    fromFrame(frame, { type: POSTER_FRAME.READY });
    await waitFor(() => expect(sent).toHaveBeenCalledWith(expect.objectContaining({ type: POSTER_FRAME.OPEN, theme: expect.stringMatching(/^(light|dark)$/) }), SERVER));
  });

  it("A plain HTML page still opens as a page, not in the poster editor", () => {
    open(loaded("<!doctype html><p>report</p>", "report.html"));
    expect(screen.queryByTestId("poster-frame")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-html")).toBeInTheDocument();
  });

  // openlore: scenario=ABrokenPosterSaysWhy spec=poster-files
  it("ABrokenPosterSaysWhy: a file that is not a readable poster says why and shows its source", () => {
    open(loaded("<!doctype html><html><body><p>hand-made</p></body></html>"));
    expect(screen.queryByTestId("poster-frame")).not.toBeInTheDocument();
    expect(screen.getByTestId("poster-unreadable")).toHaveTextContent(/cannot be opened in the editor: this is not a poster: it has no <meta name="poster-format">/);
    expect(screen.getByText(/hand-made/)).toBeInTheDocument();
  });

  // openlore: scenario=TouchUpsReachTheAgent spec=poster-files
  it("TouchUpsReachTheAgent: a save writes the page back, guarded by the time the file was read", async () => {
    const fileIo = fakeFileIo();
    open(loaded(PAGE), fileIo);
    const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
    const sent = vi.spyOn(frame.contentWindow!, "postMessage");
    fromFrame(frame, { type: POSTER_FRAME.READY });
    await waitFor(() => expect(fileIo.read).toHaveBeenCalledWith("posters/Class rules.poster.html"));
    const html = POSTER_EXAMPLE.html.replace("I listen", "I listen carefully");
    fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 7, html, css: POSTER_EXAMPLE.css });
    await waitFor(() => expect(fileIo.write).toHaveBeenCalled());
    const [path, written, mtime] = vi.mocked(fileIo.write).mock.calls[0]!;
    expect(path).toBe("posters/Class rules.poster.html");
    expect(mtime).toBe(1000);
    expect(readPage(written)).toMatchObject({ html, css: POSTER_EXAMPLE.css, format: "A4-portrait", title: "Class rules" });
    await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: POSTER_FRAME.ANSWER, id: 7, value: expect.objectContaining({ saved: true }) }, SERVER));
    // The next save is checked against the time of the write that just landed.
    fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 8, html, css: "" });
    await waitFor(() => expect(fileIo.write).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fileIo.write).mock.calls[1]![2]).toBe(2000);
  });

  // openlore: scenario=AFileChangedOnDiskIsNotOverwritten spec=poster-files
  it("AFileChangedOnDiskIsNotOverwritten: a refused write is said to the editor as not saved", async () => {
    const fileIo = fakeFileIo({ write: vi.fn(async () => Promise.reject(new FileIoError("changed", "conflict"))) });
    open(loaded(PAGE), fileIo);
    const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
    const sent = vi.spyOn(frame.contentWindow!, "postMessage");
    fromFrame(frame, { type: POSTER_FRAME.READY });
    await waitFor(() => expect(fileIo.read).toHaveBeenCalled());
    fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 3, html: "<p>mine</p>", css: "" });
    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({ type: POSTER_FRAME.ANSWER, id: 3, value: { saved: false, message: expect.stringMatching(/changed on disk since it was opened/) } }, SERVER),
    );
  });

  // openlore: scenario=AReadOnlyPosterIsNotSaved spec=poster-files
  it("AReadOnlyPosterIsNotSaved: outside the write zone it opens read-only, and a save is refused", async () => {
    const fileIo = fakeFileIo();
    open(loaded(PAGE, "elsewhere/Rules.poster.html"), fileIo, { writableRoot: "/workspace/posters" });
    const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
    const sent = vi.spyOn(frame.contentWindow!, "postMessage");
    fromFrame(frame, { type: POSTER_FRAME.READY });
    await waitFor(() => expect(sent).toHaveBeenCalledWith(expect.objectContaining({ type: POSTER_FRAME.OPEN, poster: expect.objectContaining({ readOnly: true }) }), SERVER));
    fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 1, html: "<p>x</p>", css: "" });
    await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: POSTER_FRAME.ANSWER, id: 1, value: expect.objectContaining({ saved: false }) }, SERVER));
    expect(fileIo.write).not.toHaveBeenCalled();
  });

  // openlore: scenario=APowerPointExportDownloads spec=poster-files
  it("APowerPointExportDownloads: an exported file is downloaded by the viewer under its name", async () => {
    open(loaded(PAGE));
    const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    URL.createObjectURL = vi.fn(() => "blob:poster");
    URL.revokeObjectURL = vi.fn();
    fromFrame(frame, { type: POSTER_FRAME.DELIVER, id: 4, name: "Class rules.pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: new Uint8Array([0x50, 0x4b, 3, 4]) });
    expect(clicked).toEqual(["Class rules.pptx"]);
    click.mockRestore();
  });

  it("Unsaved touch-ups are asked about before the source mode drops them", () => {
    open(loaded(PAGE));
    const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
    fromFrame(frame, { type: POSTER_FRAME.DIRTY, dirty: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: /source/ }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes?");
    expect(screen.getByTestId("poster-frame")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /source/ }));
    expect(screen.queryByTestId("poster-frame")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("Messages from another window or origin are ignored", async () => {
    const fileIo = fakeFileIo();
    open(loaded(PAGE), fileIo);
    const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
    fromFrame(frame, { type: POSTER_FRAME.READY });
    await waitFor(() => expect(fileIo.read).toHaveBeenCalled());
    fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 1, html: "<p>x</p>", css: "" }, "http://evil.example");
    act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: POSTER_FRAME.SAVE, id: 2, html: "<p>y</p>", css: "" }, source: window, origin: SERVER })));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fileIo.write).not.toHaveBeenCalled();
  });

  describe("AShownPosterFollowsItsFile", () => {
    const REWRITTEN = pageOf("Class rules", { html: POSTER_EXAMPLE.html.replace("I listen", "I listen to the agent"), css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format });

    async function ready(fileIo = fakeFileIo()) {
      const view = open(loaded(PAGE), fileIo);
      const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
      const sent = vi.spyOn(frame.contentWindow!, "postMessage");
      fromFrame(frame, { type: POSTER_FRAME.READY });
      await waitFor(() => expect(opens(sent)).toHaveLength(1));
      return { ...view, frame, sent, fileIo };
    }

    // openlore: scenario=AnAgentRewriteIsShown spec=poster-files
    it("AnAgentRewriteIsShown: a clean editor is sent the new version, and a save is checked against its time", async () => {
      const { reread, frame, sent, fileIo } = await ready();
      reread(loaded(REWRITTEN, undefined, 3000));
      await waitFor(() => expect(opens(sent)).toHaveLength(2));
      expect(opens(sent)[1]!.poster).toMatchObject({ html: readPage(REWRITTEN).html, readOnly: false });
      fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 5, html: readPage(REWRITTEN).html, css: POSTER_EXAMPLE.css });
      await waitFor(() => expect(fileIo.write).toHaveBeenCalled());
      expect(vi.mocked(fileIo.write).mock.calls[0]![2]).toBe(3000);
    });

    // openlore: scenario=UnsavedTouchUpsAreKeptOverARewrite spec=poster-files
    it("UnsavedTouchUpsAreKeptOverARewrite: touch-ups are not replaced, and once undone the agent's version is shown", async () => {
      // As the server does: a write against any time but the file's own (3000, the agent's) is refused.
      const { reread, frame, sent, fileIo } = await ready(
        fakeFileIo({ write: vi.fn(async (_path: string, _content: string, expected?: number) => (expected === 3000 ? { mtimeMs: 4000 } : Promise.reject(new FileIoError("changed", "conflict")))) }),
      );
      fromFrame(frame, { type: POSTER_FRAME.DIRTY, dirty: true });
      reread(loaded(REWRITTEN, undefined, 3000));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(opens(sent)).toHaveLength(1);
      // A save meanwhile is still checked against the version the touch-ups were made on.
      fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 6, html: "<p>mine</p>", css: "" });
      await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: POSTER_FRAME.ANSWER, id: 6, value: expect.objectContaining({ saved: false }) }, SERVER));
      expect(vi.mocked(fileIo.write).mock.calls[0]![2]).toBe(1000);
      fromFrame(frame, { type: POSTER_FRAME.DIRTY, dirty: false });
      await waitFor(() => expect(opens(sent)).toHaveLength(2));
      expect(opens(sent)[1]!.poster).toMatchObject({ html: readPage(REWRITTEN).html });
    });

    // openlore: scenario=OwnSaveDoesNotReopen spec=poster-files
    it("OwnSaveDoesNotReopen: the file read back as it was saved leaves the editor alone", async () => {
      const { reread, frame, sent, fileIo } = await ready();
      const html = POSTER_EXAMPLE.html.replace("I listen", "I listen carefully");
      fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 7, html, css: POSTER_EXAMPLE.css });
      await waitFor(() => expect(fileIo.write).toHaveBeenCalled());
      const written = vi.mocked(fileIo.write).mock.calls[0]![1];
      // The server acknowledges the write before it says the file changed.
      await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: POSTER_FRAME.ANSWER, id: 7, value: expect.objectContaining({ saved: true }) }, SERVER));
      fromFrame(frame, { type: POSTER_FRAME.DIRTY, dirty: false });
      reread(loaded(written, undefined, 2000));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(opens(sent)).toHaveLength(1);
    });

    // openlore: scenario=ASaveIsCheckedAgainstTheShownVersion spec=poster-files
    it("ASaveIsCheckedAgainstTheShownVersion: a write landing before the editor opened refuses the save", async () => {
      // The viewer read the page at 1000; by the time the frame is ready, the file is at 3000.
      const fileIo = fakeFileIo({ read: vi.fn(async () => ({ content: REWRITTEN, mtimeMs: 3000 })) });
      const { frame } = await ready(fileIo);
      fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 8, html: "<p>mine</p>", css: "" });
      await waitFor(() => expect(fileIo.write).toHaveBeenCalled());
      expect(vi.mocked(fileIo.write).mock.calls[0]![2]).toBe(1000);
    });

    it("the same page written again moves the guard to its time, so a save is not refused for nothing", async () => {
      const { reread, frame, fileIo } = await ready();
      reread(loaded(PAGE, undefined, 4000));
      fromFrame(frame, { type: POSTER_FRAME.SAVE, id: 9, html: "<p>mine</p>", css: "" });
      await waitFor(() => expect(fileIo.write).toHaveBeenCalled());
      expect(vi.mocked(fileIo.write).mock.calls[0]![2]).toBe(4000);
    });

    it("a version that arrives before the frame is ready is the one it opens with", async () => {
      const view = open(loaded(PAGE));
      const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
      const sent = vi.spyOn(frame.contentWindow!, "postMessage");
      view.reread(loaded(REWRITTEN, undefined, 3000));
      fromFrame(frame, { type: POSTER_FRAME.READY });
      await waitFor(() => expect(opens(sent)).toHaveLength(1));
      expect(opens(sent)[0]!.poster).toMatchObject({ html: readPage(REWRITTEN).html });
    });
  });

  describe("draw.io diagrams for the editor's frames", () => {
    const TWO = '<mxfile><diagram name="Context"><mxGraphModel><root><mxCell id="0"/><mxCell id="a" value="Client" vertex="1" parent="0"/></root></mxGraphModel></diagram><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="b" value="Second" vertex="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
    const FILES: Record<string, string> = { "diagrams/two.drawio": TWO, "old.dio": '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>', "diagrams/broken.drawio": "<html/>" };

    function diagramFileIo(overrides: Partial<FileIo> = {}) {
      return fakeFileIo({
        read: vi.fn(async (path: string) => {
          if (path in FILES) return { content: FILES[path]!, mtimeMs: 1000 };
          if (path.endsWith(".poster.html")) return { content: PAGE, mtimeMs: 1000 };
          throw new FileIoError("not found", "not-found");
        }),
        find: vi.fn(async (query: string) =>
          query === ".drawio"
            ? [
                { path: "diagrams", type: "directory" as const },
                { path: "diagrams/two.drawio", type: "file" as const },
                { path: "diagrams/broken.drawio", type: "file" as const },
                { path: "notes.drawio.md", type: "file" as const },
              ]
            : [{ path: "old.dio", type: "file" as const }],
        ),
        ...overrides,
      });
    }

    async function asked(fileIo: FileIo, data: Record<string, unknown>) {
      open(loaded(PAGE), fileIo);
      const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
      const sent = vi.spyOn(frame.contentWindow!, "postMessage");
      fromFrame(frame, data);
      await waitFor(() => expect(sent).toHaveBeenCalledWith(expect.objectContaining({ type: POSTER_FRAME.ANSWER, id: data.id }), SERVER));
      return (sent.mock.calls.find(([message]) => (message as { id?: unknown }).id === data.id)![0] as { value: unknown }).value;
    }

    // openlore: scenario=TheProjectsDiagramsAreOffered spec=poster-files
    it("TheProjectsDiagramsAreOffered: each diagram file, as a path from the poster's directory, with its pages", async () => {
      const value = await asked(diagramFileIo(), { type: POSTER_FRAME.DRAWIO_LIST, id: 1 });
      expect(value).toEqual({
        ok: true,
        value: [
          { path: "../diagrams/two.drawio", pages: ["Context", "Page 2"] },
          // Offered all the same: drawing it says what is wrong with it.
          { path: "../diagrams/broken.drawio", pages: [] },
          { path: "../old.dio", pages: ["Page 1"] },
        ],
      });
    });

    it("a view that cannot look through the project says so", async () => {
      const fileIo = diagramFileIo();
      delete (fileIo as { find?: unknown }).find;
      expect(await asked(fileIo, { type: POSTER_FRAME.DRAWIO_LIST, id: 2 })).toEqual({ ok: false, message: "this view cannot look through the project's files" });
    });

    // openlore: scenario=TheNamedPageIsDrawn spec=poster-files
    it("TheNamedPageIsDrawn: the frame's path is read from the poster's directory, and only the named page is drawn", async () => {
      painted.xml.length = 0;
      const fileIo = diagramFileIo();
      const value = await asked(fileIo, { type: POSTER_FRAME.DRAWIO_DRAW, id: 3, path: "../diagrams/two.drawio", page: "2" });
      expect(value).toEqual({ ok: true, value: painted.svg });
      expect(fileIo.read).toHaveBeenCalledWith("diagrams/two.drawio");
      expect(painted.xml).toHaveLength(1);
      expect(painted.xml[0]).toContain('value="Second"');
      expect(painted.xml[0]).not.toContain('value="Client"');
    });

    // openlore: scenario=AMissingDiagramLeavesTheFrameEmpty spec=poster-files
    it("AMissingDiagramLeavesTheFrameEmpty: a diagram that cannot be read is named with the reason", async () => {
      expect(await asked(diagramFileIo(), { type: POSTER_FRAME.DRAWIO_DRAW, id: 4, path: "../diagrams/missing.drawio" })).toEqual({ ok: false, message: '"../diagrams/missing.drawio" could not be read: not found' });
    });

    // openlore: scenario=AnUnreadableDiagramSaysWhy spec=poster-files
    it("AnUnreadableDiagramSaysWhy: a file that is no diagram, or no .drawio at all, says so and is never drawn", async () => {
      painted.xml.length = 0;
      const fileIo = diagramFileIo();
      expect(await asked(fileIo, { type: POSTER_FRAME.DRAWIO_DRAW, id: 5, path: "../diagrams/broken.drawio" })).toEqual({ ok: false, message: "it is not a draw.io diagram (its root is <html>)" });
      cleanup();
      expect(await asked(fileIo, { type: POSTER_FRAME.DRAWIO_DRAW, id: 6, path: "../notes.txt" })).toEqual({ ok: false, message: '"../notes.txt" is not a .drawio file' });
      expect(fileIo.read).not.toHaveBeenCalledWith("notes.txt");
      expect(painted.xml).toEqual([]);
    });

    it("a path climbing above the project stays inside it, for the server to confine", async () => {
      const fileIo = diagramFileIo();
      await asked(fileIo, { type: POSTER_FRAME.DRAWIO_DRAW, id: 7, path: "../../../../etc/x.drawio" });
      expect(fileIo.read).toHaveBeenCalledWith("etc/x.drawio");
    });
  });

  describe("the project's picture files for the editor's frames", () => {
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><text>Architecture — é</text></svg>';

    function pictureFileIo() {
      return fakeFileIo({
        find: vi.fn(async (query: string) =>
          query === ".svg"
            ? [{ path: "figures", type: "directory" as const }, { path: "figures/architecture.svg", type: "file" as const }, { path: "notes.svg.md", type: "file" as const }]
            : query === ".png"
              ? [{ path: "posters/photo.png", type: "file" as const }]
              : [],
        ),
      });
    }

    async function asked(data: Record<string, unknown>, fileIo: FileIo = pictureFileIo()) {
      open(loaded(PAGE), fileIo);
      const frame = screen.getByTestId("poster-frame") as HTMLIFrameElement;
      const sent = vi.spyOn(frame.contentWindow!, "postMessage");
      fromFrame(frame, data);
      await waitFor(() => expect(sent).toHaveBeenCalledWith(expect.objectContaining({ type: POSTER_FRAME.ANSWER, id: data.id }), SERVER));
      return (sent.mock.calls.find(([message]) => (message as { id?: unknown }).id === data.id)![0] as { value: unknown }).value;
    }

    // openlore: scenario=TheProjectsPicturesAreOffered spec=poster-files
    it("TheProjectsPicturesAreOffered: each picture file of the project, as a path from the poster's directory", async () => {
      expect(await asked({ type: POSTER_FRAME.PICTURE_LIST, id: 11 })).toEqual({ ok: true, value: ["../figures/architecture.svg", "photo.png"] });
    });

    it("an SVG is read through the viewer's own route, as its bytes and type", async () => {
      const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(SVG, { status: 200, headers: { "content-type": "image/svg+xml" } }));
      try {
        const value = (await asked({ type: POSTER_FRAME.PICTURE_READ, id: 12, path: "../figures/architecture.svg" })) as { ok: true; value: { type: string; bytes: Uint8Array } };
        expect(value.ok).toBe(true);
        expect(value.value.type).toBe("image/svg+xml");
        expect(new TextDecoder().decode(value.value.bytes)).toBe(SVG);
        expect(String(fetched.mock.calls[0]![0])).toContain(`/files/raw?path=${encodeURIComponent("figures/architecture.svg")}`);
      } finally {
        fetched.mockRestore();
      }
    });

    // openlore: scenario=AMissingPictureLeavesTheFrameEmpty spec=poster-files
    it("AMissingPictureLeavesTheFrameEmpty: a file the server does not serve, or no picture at all, is refused with its reason", async () => {
      const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
      try {
        expect(await asked({ type: POSTER_FRAME.PICTURE_READ, id: 13, path: "../figures/gone.svg" })).toEqual({ ok: false, message: '"../figures/gone.svg" could not be read: it is not there, or not in the project' });
        cleanup();
        expect(await asked({ type: POSTER_FRAME.PICTURE_READ, id: 14, path: "../notes.md" })).toEqual({ ok: false, message: '"../notes.md" is not a picture file (SVG, PNG, JPEG, GIF or WebP)' });
        expect(fetched).toHaveBeenCalledTimes(1);
      } finally {
        fetched.mockRestore();
      }
    });

    it("a file too large for a poster is refused before it is read into it", async () => {
      const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: async () => ({ size: 21 * 1024 * 1024 }) } as unknown as Response);
      try {
        expect(await asked({ type: POSTER_FRAME.PICTURE_READ, id: 15, path: "photo.png" })).toEqual({ ok: false, message: '"photo.png" is 21 MB, more than a poster reads (20 MB)' });
      } finally {
        fetched.mockRestore();
      }
    });
  });
});
