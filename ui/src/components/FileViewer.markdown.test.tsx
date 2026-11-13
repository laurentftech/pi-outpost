import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileViewer } from "./FileViewer";
import { DrawioFilesContext } from "./drawioFiles";
import type { FileIo } from "../fileIo";

type Props = React.ComponentProps<typeof FileViewer>;
const XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

function open(content: string, path = "docs/report.md") {
  const fileIo = {
    read: vi.fn<FileIo["read"]>().mockResolvedValue({ content: XML, mtimeMs: 1 }),
    write: vi.fn<FileIo["write"]>(),
    onChanged: vi.fn<FileIo["onChanged"]>().mockReturnValue(() => {}),
  };
  const props: Props = {
    file: { status: "loaded", path, content, size: content.length, mtimeMs: 1 },
    isStreaming: false, gitDiff: null, inRepository: false,
    onDirtyChange: vi.fn(), onFetchGitDiff: vi.fn(), onClearGitDiff: vi.fn(),
    onOpenGitHistory: vi.fn(), onClose: vi.fn(), onReload: vi.fn(), onSave: vi.fn(),
    serverUrl: "http://127.0.0.1:9", token: "test-token", workspace: "project-b",
  };
  const element = (changes: Partial<Props> = {}) => (
    <DrawioFilesContext.Provider value={{ serverUrl: props.serverUrl!, fileIo }}>
      <FileViewer {...props} {...changes} />
    </DrawioFilesContext.Provider>
  );
  const view = render(element());
  return { ...view, props, fileIo, rerenderWith: (changes: Partial<Props>) => view.rerender(element(changes)) };
}

describe("pictures in a rendered Markdown file", () => {
  // openlore: scenario=AReferencedDiagramIsDrawnInMarkdown spec=drawio-diagrams
  it("AReferencedDiagramIsDrawnInMarkdown: draws a sibling instead of loading its XML as an image", async () => {
    const { fileIo } = open("# Structure\n\n![structure](document.drawio)");
    const frame = await screen.findByTestId("drawio-frame");
    expect(fileIo.read).toHaveBeenCalledWith("docs/document.drawio");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.closest("p")).toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show diagram at full size" })).toBeInTheDocument();
  });

  it("resolves encoded names and .dio references relative to the Markdown directory", async () => {
    const { fileIo } = open("![structure](../diagrams/plan%20v2.DIO?revision=1#page)", "docs/reports/report.md");
    await screen.findByTestId("drawio-frame");
    expect(fileIo.read).toHaveBeenCalledWith("docs/diagrams/plan v2.DIO");
  });

  it("keeps text and diagrams outside paragraphs that cannot contain their controls", async () => {
    open("Before ![structure](document.drawio) after.");
    const frame = await screen.findByTestId("drawio-frame");
    expect(frame.closest("p")).toBeNull();
    expect(screen.getByText(/Before/)).toHaveTextContent("Before");
    expect(screen.getByText(/after\./)).toHaveTextContent("after.");
  });

  // openlore: scenario=MarkdownDiagramsStayMounted spec=drawio-diagrams
  it("MarkdownDiagramsStayMounted: parent activity and updated prose keep the frame and its file subscription", async () => {
    const { props, fileIo, rerenderWith } = open("Text.\n\n![structure](document.drawio)");
    const frame = await screen.findByTestId("drawio-frame");
    const onReload = vi.fn();
    rerenderWith({ isStreaming: true, onReload });
    expect(screen.getByTestId("drawio-frame")).toBe(frame);
    rerenderWith({ file: { ...props.file, status: "loaded", path: "docs/report.md", content: "More text.\n\n![structure](document.drawio)", size: 60, mtimeMs: 2 }, onReload: vi.fn() });
    expect(screen.getByTestId("drawio-frame")).toBe(frame);
    expect(fileIo.read).toHaveBeenCalledTimes(1);
    expect(fileIo.onChanged).toHaveBeenCalledTimes(1);
  });

  it("ordinary pictures also stay mounted while links use the latest callback", () => {
    const { rerenderWith } = open("![logo](logo.svg)\n\n[details](details.md)");
    const image = screen.getByRole("img");
    const onReload = vi.fn();
    rerenderWith({ isStreaming: true, onReload });
    expect(screen.getByRole("img")).toBe(image);
    expect(image).toHaveAttribute("src", "http://127.0.0.1:9/files/raw?path=docs%2Flogo.svg&token=test-token&workspace=project-b");
    fireEvent.click(screen.getByRole("link", { name: "details" }));
    expect(onReload).toHaveBeenCalledWith("docs/details.md");
  });

  // openlore: scenario=AMissingMarkdownDiagramSaysSo spec=drawio-diagrams
  it("AMissingMarkdownDiagramSaysSo: names the missing file without retrying on unrelated updates", async () => {
    const { fileIo, rerenderWith } = open("![structure](missing.drawio)");
    await screen.findByTestId("drawio-frame");
    // Replacing a reference must discard the old drawing while the new read fails.
    fileIo.read.mockRejectedValue(new Error("not found"));
    rerenderWith({ file: { status: "loaded", path: "docs/report.md", content: "![structure](gone.drawio)", size: 30, mtimeMs: 2 } });
    await waitFor(() => expect(screen.getByTestId("drawio-block-missing")).toHaveTextContent("docs/gone.drawio"));
    expect(screen.getByTestId("drawio-block-missing")).toHaveTextContent("not found");
    const reads = fileIo.read.mock.calls.length;
    rerenderWith({ isStreaming: true, file: { status: "loaded", path: "docs/report.md", content: "![structure](gone.drawio)", size: 30, mtimeMs: 2 } });
    expect(screen.getByTestId("drawio-block-missing")).toHaveTextContent("not found");
    expect(fileIo.read).toHaveBeenCalledTimes(reads);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("leaves remote and ordinary image URLs on the image path", () => {
    const { fileIo } = open("![remote](https://example.com/diagram.drawio) ![cdn](//example.com/a.drawio) ![svg](diagram.drawio.svg)");
    expect(screen.getByRole("img", { name: "remote" })).toHaveAttribute("src", "https://example.com/diagram.drawio");
    expect(screen.getByRole("img", { name: "cdn" })).toHaveAttribute("src", "//example.com/a.drawio");
    expect(screen.getByRole("img", { name: "svg" })).toHaveAttribute("src", expect.stringContaining("docs%2Fdiagram.drawio.svg"));
    expect(fileIo.read).not.toHaveBeenCalled();
  });
});
