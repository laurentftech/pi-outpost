import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawioBlock, svgFileName } from "./DrawioBlock";
import { DrawioFilesContext, type DrawioFiles } from "./drawioFiles";
import { FileIoError, type FileIo } from "../fileIo";
import { DRAWIO_MESSAGE } from "../util/drawioPage";
import { ThemeContext } from "../theme/ThemeContext";

const PATH = "docs/architecture.drawio";
const FILE = [
  '<mxfile host="test">',
  '  <diagram id="p1" name="Overview">',
  '    <mxGraphModel grid="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>',
  "  </diagram>",
  "</mxfile>",
].join("\n");
const MOVED = '<mxGraphModel grid="1">\n  <root>\n    <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="200" y="10" width="80" height="40" as="geometry"/></mxCell>\n  </root>\n</mxGraphModel>';

/** A fileIo whose answers the test controls, recording what it was asked. */
function fakeFileIo(content = FILE, mtimeMs = 1000) {
  const listeners = new Map<string, Set<() => void>>();
  const io = {
    read: vi.fn<FileIo["read"]>().mockResolvedValue({ content, mtimeMs }),
    write: vi.fn<FileIo["write"]>().mockResolvedValue({ mtimeMs: mtimeMs + 1 }),
    onChanged: vi.fn<FileIo["onChanged"]>((path, listener) => {
      const set = listeners.get(path) ?? new Set();
      set.add(listener);
      listeners.set(path, set);
      return () => set.delete(listener);
    }),
    changed: (path: string) => act(() => { for (const listener of listeners.get(path) ?? []) listener(); }),
  };
  return io;
}

function mount(element: React.ReactNode, files: Partial<DrawioFiles> = {}) {
  return render(
    <ThemeContext.Provider value="light">
      <DrawioFilesContext.Provider value={{ serverUrl: "http://127.0.0.1:9", ...files }}>{element}</DrawioFilesContext.Provider>
    </ThemeContext.Provider>,
  );
}

/** Each frame on the page, by title, with a spy on what is posted to it and a way to answer as it. */
async function frame(title = PATH) {
  // jsdom swaps a frame's window once its srcdoc has loaded: spy on the one that stays
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const element = screen.getByTitle(title) as HTMLIFrameElement;
  const own = element.contentWindow!;
  const sent = vi.spyOn(own, "postMessage");
  const answer = (data: Record<string, unknown>) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: own }));
  });
  answer({ type: DRAWIO_MESSAGE.READY });
  answer({ type: DRAWIO_MESSAGE.RENDERED, pages: 1 });
  return { sent, answer, types: () => sent.mock.calls.map(([message]) => (message as { type: string }).type) };
}

let downloads: { name: string; text: Promise<string> }[];
beforeEach(() => {
  downloads = [];
  let blob: Blob | null = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:x"; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, text: blob!.text() });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("svgFileName", () => {
  it("names the SVG after the file and the page shown", () => {
    expect(svgFileName("docs/architecture.drawio", "Overview")).toBe("architecture-Overview.svg");
    expect(svgFileName("a.dio", "Vue d'ensemble / v2")).toBe("a-Vue-d-ensemble-v2.svg");
    expect(svgFileName("flow.drawio", null)).toBe("flow.svg");
  });
});

describe("DrawioBlock in a reply", () => {
  // openlore: scenario=AReferencedDiagramIsDrawnInTheReply spec=drawio-diagrams
  it("AReferencedDiagramIsDrawnInTheReply: reads the file and draws it in an isolated frame, with the reply's controls", async () => {
    const io = fakeFileIo();
    mount(<DrawioBlock path={PATH} variant="reply" />, { fileIo: io, onOpenFile: vi.fn() });
    await screen.findByTitle(PATH);
    expect(io.read).toHaveBeenCalledWith(PATH);
    const { sent } = await frame();
    expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.RENDER, xml: FILE, dark: false }, "*");
    expect(screen.getByTitle(PATH)).toHaveAttribute("sandbox", "allow-scripts");
    const block = screen.getByTestId("drawio-block-reply");
    expect(within(block).getAllByRole("button").map((b) => b.textContent)).toEqual(["⤢ enlarge", "⤓ download SVG", "⤓ download .drawio", "↗ open"]);
    // Not in a reply's small block: a wire's end is too small to aim at there
    expect(within(block).queryByRole("button", { name: /touch up/ })).toBeNull();
  });

  // openlore: scenario=AMissingDiagramSaysSo spec=drawio-diagrams
  it("AMissingDiagramSaysSo: a file that cannot be read is named, with no frame or broken picture", async () => {
    const io = fakeFileIo();
    io.read.mockRejectedValue(new FileIoError("File not found", "not_found"));
    mount(<DrawioBlock path={PATH} variant="reply" />, { fileIo: io });
    const alert = await screen.findByTestId("drawio-block-missing");
    expect(alert).toHaveTextContent(`The diagram ${PATH} could not be shown: File not found`);
    expect(screen.queryByTestId("drawio-frame")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  // openlore: scenario=AMissingDiagramSaysSo spec=drawio-diagrams
  it("AMissingDiagramSaysSo: a file draw.io cannot read says so and names it", async () => {
    mount(<DrawioBlock path={PATH} variant="reply" />, { fileIo: fakeFileIo("<html/>") });
    await screen.findByTitle(PATH);
    const { answer } = await frame();
    answer({ type: DRAWIO_MESSAGE.FAILED, message: "This is not a draw.io diagram: its root is <html>." });
    expect(screen.getByTestId("drawio-failure")).toHaveTextContent("its root is <html>");
    expect(screen.getByTestId("drawio-block-reply")).toHaveTextContent(`The diagram ${PATH} could not be drawn.`);
  });

  // openlore: scenario=TheReplyFollowsTheFile spec=drawio-diagrams
  it("TheReplyFollowsTheFile: a change to the file is read again and drawn", async () => {
    const io = fakeFileIo();
    mount(<DrawioBlock path={PATH} variant="reply" />, { fileIo: io });
    await screen.findByTitle(PATH);
    const { sent } = await frame();
    const saved = FILE.replace('value="A"', 'value="A saved"');
    io.read.mockResolvedValue({ content: saved, mtimeMs: 2000 });
    io.changed(PATH);
    await waitFor(() => expect(sent).toHaveBeenLastCalledWith({ type: DRAWIO_MESSAGE.RENDER, xml: saved, dark: false }, "*"));
    expect(io.read).toHaveBeenCalledTimes(2);
  });

  // openlore: scenario=OpenTheFileFromTheReply spec=drawio-diagrams
  it("OpenTheFileFromTheReply: opens the file in the file viewer", async () => {
    const onOpenFile = vi.fn();
    mount(<DrawioBlock path={PATH} variant="reply" />, { fileIo: fakeFileIo(), onOpenFile });
    fireEvent.click(await screen.findByRole("button", { name: "↗ open" }));
    expect(onOpenFile).toHaveBeenCalledWith(PATH);
  });
});

describe("DrawioBlock controls", () => {
  // openlore: scenario=DownloadDrawioSavesTheFile spec=drawio-diagrams
  it("DownloadDrawioSavesTheFile: saves the file's text under its own name", async () => {
    mount(<DrawioBlock path={PATH} xml={FILE} variant="viewer" />, { fileIo: fakeFileIo() });
    fireEvent.click(screen.getByRole("button", { name: "⤓ download .drawio" }));
    expect(downloads.map((d) => d.name)).toEqual(["architecture.drawio"]);
    await expect(downloads[0].text).resolves.toBe(FILE);
  });

  // openlore: scenario=DownloadSvgSavesThePageShown spec=drawio-diagrams
  it("DownloadSvgSavesThePageShown: asks the frame for the page shown and names it after file and page", async () => {
    mount(<DrawioBlock path={PATH} xml={FILE} variant="viewer" />, { fileIo: fakeFileIo() });
    const { sent, answer } = await frame();
    fireEvent.click(screen.getByRole("button", { name: "⤓ download SVG" }));
    expect(sent).toHaveBeenLastCalledWith({ type: DRAWIO_MESSAGE.EXPORT_SVG }, "*");
    answer({ type: DRAWIO_MESSAGE.SVG, page: 1, name: "Second page", svg: "<svg>page two</svg>" });
    await waitFor(() => expect(downloads.map((d) => d.name)).toEqual(["architecture-Second-page.svg"]));
    await expect(downloads[0].text).resolves.toBe("<svg>page two</svg>");
  });

  // openlore: scenario=EnlargeShowsTheDiagramAtFullSize spec=drawio-diagrams
  it("EnlargeShowsTheDiagramAtFullSize: full size over the app, with its downloads, closed by Escape", async () => {
    mount(<DrawioBlock path={PATH} xml={FILE} variant="viewer" />, { fileIo: fakeFileIo() });
    fireEvent.click(screen.getByRole("button", { name: "Show diagram at full size" }));
    const dialog = screen.getByTestId("drawio-enlarged");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(within(dialog).getByTitle(`${PATH}, full size`)).toHaveAttribute("sandbox", "allow-scripts");
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["⤓ download SVG", "⤓ download .drawio", "✎ touch up"]));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("drawio-enlarged")).toBeNull();
  });
});

describe("DrawioBlock touch-up", () => {
  async function touchUp(io = fakeFileIo()) {
    const onTouchUpDirtyChange = vi.fn();
    mount(<DrawioBlock path={PATH} xml={FILE} variant="viewer" onTouchUpDirtyChange={onTouchUpDirtyChange} />, { fileIo: io });
    const view = await frame();
    fireEvent.click(screen.getByRole("button", { name: "✎ touch up" }));
    await screen.findByRole("button", { name: "✓ save" });
    return { io, onTouchUpDirtyChange, ...view };
  }

  // openlore: scenario=ReadingIsReadOnly spec=drawio-diagrams
  it("ReadingIsReadOnly: the frame is only told to edit once touch-up is asked for", async () => {
    mount(<DrawioBlock path={PATH} xml={FILE} variant="viewer" />, { fileIo: fakeFileIo() });
    const { types } = await frame();
    expect(types()).not.toContain(DRAWIO_MESSAGE.EDIT);
    fireEvent.click(screen.getByRole("button", { name: "✎ touch up" }));
    await waitFor(() => expect(types()).toContain(DRAWIO_MESSAGE.EDIT));
  });

  // openlore: scenario=ShapesMoveAndConnectorsFollow spec=drawio-diagrams
  // openlore: scenario=SavingKeepsTheRestOfTheFile spec=drawio-diagrams
  it("SavingKeepsTheRestOfTheFile: the page the frame returns is spliced into the file read at the start, under its modification time", async () => {
    const { io, sent, answer, types, onTouchUpDirtyChange } = await touchUp();
    expect(io.read).toHaveBeenCalledWith(PATH);
    expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: true }, "*");
    const save = screen.getByRole("button", { name: "✓ save" });
    expect(save).toBeDisabled();
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    expect(save).toBeEnabled();
    expect(onTouchUpDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(save);
    expect(types()).toContain(DRAWIO_MESSAGE.SAVE);
    answer({ type: DRAWIO_MESSAGE.SAVED, page: 0, xml: MOVED });
    await waitFor(() => expect(io.write).toHaveBeenCalledOnce());
    const [path, content, mtime] = io.write.mock.calls[0];
    expect(path).toBe(PATH);
    expect(mtime).toBe(1000);
    expect(content).toContain('<mxGeometry x="200" y="10"');
    expect(content.startsWith('<mxfile host="test">\n  <diagram id="p1" name="Overview">\n')).toBe(true);
    await waitFor(() => expect(types()).toContain(DRAWIO_MESSAGE.CLEAN));
    expect(screen.queryByTestId("drawio-touchup-problem")).toBeNull();
  });

  // openlore: scenario=AFileChangedOnDiskIsNotOverwritten spec=drawio-diagrams
  it("AFileChangedOnDiskIsNotOverwritten: a refused save says so and keeps the touch-up open", async () => {
    const io = fakeFileIo();
    io.write.mockRejectedValue(new FileIoError("changed on disk", "conflict"));
    const { answer, types } = await touchUp(io);
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    fireEvent.click(screen.getByRole("button", { name: "✓ save" }));
    answer({ type: DRAWIO_MESSAGE.SAVED, page: 0, xml: MOVED });
    expect(await screen.findByTestId("drawio-touchup-problem")).toHaveTextContent("The file changed on disk, or was removed, since this touch-up began, so it was not saved.");
    expect(screen.getByRole("button", { name: "✓ save" })).toBeInTheDocument();
    expect(types()).not.toContain(DRAWIO_MESSAGE.CLEAN);
  });

  it("The wire style control shows what the frame reports and sends the choice to it", async () => {
    const { answer, sent } = await touchUp();
    const control = screen.getByRole("combobox", { name: "Wire style" }) as HTMLSelectElement;
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: false, canUndo: false, canRedo: false, wireStyle: "straight" });
    expect(control.value).toBe("straight");
    fireEvent.change(control, { target: { value: "curved" } });
    expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.WIRE_STYLE, style: "curved" }, "*");
    // Wires of several styles: said, and not a choice that can be sent
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false, wireStyle: "mixed" });
    expect(control.value).toBe("mixed");
    expect(within(control).getByRole("option", { name: "mixed" })).toBeDisabled();
    // A style the frame does not know is not taken
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false, wireStyle: "zigzag" });
    expect(control.value).toBe("orthogonal");
  });

  // openlore: scenario=UndoRestoresTheDiagram spec=drawio-diagrams
  it("UndoRestoresTheDiagram: undo and redo go to the frame, enabled as it reports", async () => {
    const { answer, types } = await touchUp();
    const undo = screen.getByRole("button", { name: "↶ undo" });
    expect(undo).toBeDisabled();
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    fireEvent.click(undo);
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: false, canUndo: false, canRedo: true });
    fireEvent.click(screen.getByRole("button", { name: "↷ redo" }));
    expect(types().slice(-2)).toEqual([DRAWIO_MESSAGE.UNDO, DRAWIO_MESSAGE.REDO]);
  });

  // openlore: scenario=UnsavedTouchUpIsNotLostSilently spec=drawio-diagrams
  it("UnsavedTouchUpIsNotLostSilently: leaving with unsaved touch-ups asks, and only agreeing discards", async () => {
    const { answer, sent } = await touchUp();
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "done" }));
    expect(confirm).toHaveBeenCalledWith("Discard the unsaved touch-ups to this diagram?");
    expect(screen.getByRole("button", { name: "✓ save" })).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "done" }));
    expect(screen.queryByRole("button", { name: "✓ save" })).toBeNull();
    expect(sent).toHaveBeenLastCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: false, xml: FILE, dark: false }, "*");
  });

  // openlore: scenario=UnsavedTouchUpIsNotLostSilently spec=drawio-diagrams
  it("UnsavedTouchUpIsNotLostSilently: closing the full-size view mid touch-up asks too", async () => {
    mount(<DrawioBlock path={PATH} xml={FILE} variant="viewer" />, { fileIo: fakeFileIo() });
    fireEvent.click(screen.getByRole("button", { name: "Show diagram at full size" }));
    const full = await frame(`${PATH}, full size`);
    fireEvent.click(within(screen.getByTestId("drawio-enlarged")).getByRole("button", { name: "✎ touch up" }));
    await within(screen.getByTestId("drawio-enlarged")).findByRole("button", { name: "✓ save" });
    full.answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByTestId("drawio-enlarged")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("drawio-enlarged")).toBeNull();
  });

  it("Escape while touching up is \"done\": it leaves the touch-up, not the full-size view", async () => {
    mount(<DrawioBlock path={PATH} xml={FILE} variant="viewer" />, { fileIo: fakeFileIo() });
    fireEvent.click(screen.getByRole("button", { name: "Show diagram at full size" }));
    const full = await frame(`${PATH}, full size`);
    const overlay = () => within(screen.getByTestId("drawio-enlarged"));
    fireEvent.click(overlay().getByRole("button", { name: "✎ touch up" }));
    await overlay().findByRole("button", { name: "✓ save" });
    full.answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    // On the application's side of the frame, as after clicking a control
    fireEvent.keyDown(window, { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(overlay().getByRole("button", { name: "✓ save" })).toBeInTheDocument();
    // In the frame, which says so
    confirm.mockReturnValue(true);
    full.answer({ type: DRAWIO_MESSAGE.ESCAPE });
    expect(overlay().queryByRole("button", { name: "✓ save" })).toBeNull();
    expect(screen.getByTestId("drawio-enlarged")).toBeInTheDocument();
    // Out of touch-up, Escape closes the view as before
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("drawio-enlarged")).toBeNull();
  });

  it("says why a page change was refused", async () => {
    const { answer } = await touchUp();
    answer({ type: DRAWIO_MESSAGE.PAGE_LOCKED });
    expect(screen.getByRole("status")).toHaveTextContent("Save or undo the touch-ups on this page before turning to another.");
  });
});

const TWO_PAGES = [
  '<mxfile host="test">',
  '  <diagram id="p1" name="Overview"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>',
  '  <diagram id="p2" name="Context"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>',
  "</mxfile>",
].join("\n");

describe("DrawioBlock opened from a poster", () => {
  // openlore: scenario=DoubleClickOpensTheDiagramsPage spec=poster-files
  it("draws the page named, by name or by number, and begins touch-up without a click", async () => {
    for (const page of ["Context", "2"]) {
      const io = fakeFileIo(TWO_PAGES);
      const view = mount(<DrawioBlock path={PATH} variant="viewer" page={page} startTouchUp />, { fileIo: io });
      await screen.findByTitle(PATH);
      const { sent } = await frame();
      expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.RENDER, xml: TWO_PAGES, dark: false, page: 1 }, "*");
      // Touch-up began on the file as read, with its controls, and the frame was told
      await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: true }, "*"));
      expect(screen.getByRole("button", { name: "✓ save" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /touch up/ })).toBeNull();
      view.unmount();
    }
  });

  it("says which pages there are for a page the file does not have, and shows the first", async () => {
    const io = fakeFileIo(TWO_PAGES);
    mount(<DrawioBlock path={PATH} variant="viewer" page="Deployment" startTouchUp />, { fileIo: io });
    expect(await screen.findByTestId("drawio-block-page-problem")).toHaveTextContent('has no page "Deployment"; its pages are "Overview", "Context"');
    const { sent } = await frame();
    expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.RENDER, xml: TWO_PAGES, dark: false, page: 0 }, "*");
    // Not touched up: the page asked for is not there
    expect(screen.queryByRole("button", { name: "✓ save" })).toBeNull();
  });
});

describe("DrawioBlock touch-up and a file saved from elsewhere", () => {
  const ELSEWHERE = TWO_PAGES.replace('name="Context"', 'name="Context, from draw.io desktop"');

  // openlore: scenario=ASaveFromDrawioDesktopReachesThePoster spec=poster-files
  it("a touch-up holding nothing unsaved starts again on the file as now saved, and draws it", async () => {
    const io = fakeFileIo(TWO_PAGES);
    mount(<DrawioBlock path={PATH} variant="viewer" startTouchUp />, { fileIo: io });
    await screen.findByTitle(PATH);
    const { sent } = await frame();
    await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: true }, "*"));
    sent.mockClear();
    io.read.mockResolvedValue({ content: ELSEWHERE, mtimeMs: 5000 });
    io.changed(PATH);
    // Left, drawing the new file, then begun again on it
    await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: false, xml: ELSEWHERE, dark: false }, "*"));
    await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: true }, "*"));
    expect(screen.getByRole("button", { name: "✓ save" })).toBeInTheDocument();
  });

  it("a touch-up holding unsaved changes is not started again: they are kept", async () => {
    const io = fakeFileIo(TWO_PAGES);
    mount(<DrawioBlock path={PATH} variant="viewer" startTouchUp />, { fileIo: io });
    await screen.findByTitle(PATH);
    const { sent, answer } = await frame();
    await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: DRAWIO_MESSAGE.EDIT, on: true }, "*"));
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    await screen.findByText("● unsaved");
    sent.mockClear();
    io.read.mockResolvedValue({ content: ELSEWHERE, mtimeMs: 5000 });
    io.changed(PATH);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(sent).not.toHaveBeenCalledWith(expect.objectContaining({ type: DRAWIO_MESSAGE.EDIT }), "*");
    expect(screen.getByText("● unsaved")).toBeInTheDocument();
  });
});
