import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { pageOf, readPage } from "@pi-outpost/posters/format";
import { POSTER_FRAME } from "@pi-outpost/posters/frame";
import { POSTER_EXAMPLE } from "@pi-outpost/posters/guide";
import { FileViewer, isPoster } from "./FileViewer";
import type { OpenFile } from "../useAgent";
import { FileIoError, type FileIo } from "../fileIo";
import { DrawioFilesContext } from "./drawioFiles";
import { POSTER_SANDBOX } from "./PosterFrame";

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
  return render(
    <DrawioFilesContext.Provider value={{ serverUrl: SERVER, fileIo }}>
      <FileViewer {...props} />
    </DrawioFilesContext.Provider>,
  );
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
});
