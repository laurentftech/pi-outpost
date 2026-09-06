/**
 * The Word export, as the reader reaches it.
 *
 * The claim under test is not "a button appears". It is that the button is offered
 * exactly where the export means something, that it carries the text the reader is
 * *looking at* rather than the text on disk, and that pressing it changes nothing
 * about the document underneath — no save, no closed viewer, no lost draft.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileViewer } from "./FileViewer";
import type { OpenFile } from "../useAgent";

const exported = vi.hoisted(() => ({ calls: [] as { text: string; path: string }[], fail: null as Error | null }));

vi.mock("../export/docxExport", () => ({
  downloadDocx: async (text: string, path: string) => {
    exported.calls.push({ text, path });
    if (exported.fail !== null) throw exported.fail;
  },
}));

type Props = React.ComponentProps<typeof FileViewer>;

function setup(overrides: Partial<Props> = {}, file?: Partial<OpenFile>) {
  const base: OpenFile = {
    status: "loaded",
    path: "notes.md",
    content: "# Title\n\nBody.\n",
    size: 16,
    mtimeMs: 1000,
    ...(file as object),
  } as OpenFile;
  const handlers = {
    onDirtyChange: vi.fn(),
    onFetchGitDiff: vi.fn(),
    onClearGitDiff: vi.fn(),
    onOpenGitHistory: vi.fn(),
    onClose: vi.fn(),
    onReload: vi.fn(),
    onSave: vi.fn(),
    onImageLoad: vi.fn(),
  };
  const props: Props = {
    file: base,
    isStreaming: false,
    gitDiff: null,
    inRepository: false,
    ...handlers,
    ...overrides,
  };
  return { ...handlers, ...render(<FileViewer {...props} />) };
}

const exportButton = () => screen.queryByRole("button", { name: /download as a word document/i });

describe("where the export is offered", () => {
  beforeEach(() => {
    exported.calls.length = 0;
    exported.fail = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it("offers it for a markdown file", () => {
    setup();

    expect(exportButton()).not.toBeNull();
  });

  it("offers it for a text file that is not markdown", () => {
    setup({}, { path: "server.log", content: "a log line\n" });

    expect(exportButton()).not.toBeNull();
  });

  it("offers it for a read-only file, because a download is not a write", () => {
    // The writable zone governs saving. Taking a copy away is not saving, so a file
    // the reader may not edit is still a file they may keep.
    setup({ writableRoot: null });

    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(exportButton()).not.toBeNull();
  });

  it("offers it in source mode as well as rendered", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: /source/ }));

    // It exports the document, not the view: the mode the reader happens to be in
    // does not change what the document is.
    expect(exportButton()).not.toBeNull();
  });

  it("does not offer it for an image", () => {
    setup({}, { path: "diagram.png", content: "" });

    expect(exportButton()).toBeNull();
  });

  it("does not offer it for a PDF", () => {
    setup({}, { path: "report.pdf", content: "" });

    expect(exportButton()).toBeNull();
  });

  it("does not offer it for a file that failed to load", () => {
    setup({ file: { status: "error", path: "gone.md", message: "not found" } as OpenFile });

    expect(exportButton()).toBeNull();
  });

  it("does not offer it while the uncommitted diff is showing", () => {
    // The reader is looking at changes, not at the document; exporting "the
    // document" from here would hand over something they are not looking at.
    setup({ gitState: "modified", initialShowGitDiff: true, gitDiff: null });

    expect(exportButton()).toBeNull();
  });
});

describe("what the export carries", () => {
  beforeEach(() => {
    exported.calls.length = 0;
    exported.fail = null;
  });

  it("sends the file's text and its path", async () => {
    setup();

    fireEvent.click(exportButton()!);

    await waitFor(() => expect(exported.calls).toHaveLength(1));
    expect(exported.calls[0]).toEqual({ text: "# Title\n\nBody.\n", path: "notes.md" });
  });

  it("sends the unsaved draft, not the text on disk", async () => {
    // What the reader is looking at is the draft — the rendering beside it is drawn
    // from the draft too. An export of the saved file would hand over a document
    // that no longer exists in this session.
    setup();
    fireEvent.click(screen.getByRole("button", { name: /edit/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# Edited\n\nNew body.\n" } });

    fireEvent.click(exportButton()!);

    await waitFor(() => expect(exported.calls).toHaveLength(1));
    expect(exported.calls[0].text).toBe("# Edited\n\nNew body.\n");
  });

  it("leaves the viewer exactly as it was", async () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /edit/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# Edited\n" } });

    fireEvent.click(exportButton()!);
    await waitFor(() => expect(exported.calls).toHaveLength(1));

    // Nothing saved, nothing closed, and the draft is still in the editor with its
    // unsaved marker showing.
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("# Edited\n");
  });
});

describe("while it is working, and when it fails", () => {
  beforeEach(() => {
    exported.calls.length = 0;
    exported.fail = null;
  });

  it("says so when the export cannot be produced, and downloads nothing", async () => {
    // A failure that looked like success would leave the reader waiting for a file
    // that is never coming.
    exported.fail = new Error("the writer refused");
    setup();

    fireEvent.click(exportButton()!);

    await waitFor(() => expect(screen.getByRole("button", { name: /download as a word/i })).toHaveTextContent(/failed/i));
    expect(screen.getByRole("button", { name: /download as a word/i }).title).toContain("the writer refused");
  });

  it("shows that it is working, and goes back to itself afterwards", async () => {
    // A button that looks idle while a large document is being built reads as a
    // button that did nothing, and the reader presses it again.
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const module = await import("../export/docxExport");
    vi.spyOn(module, "downloadDocx").mockImplementation(async () => {
      await slow;
    });
    setup();
    const button = exportButton()!;

    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveTextContent(/exporting/i));
    expect(button).toBeDisabled();

    release();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveTextContent(/word/i);
  });

  it("ignores a second press while the first is still running", async () => {
    // Two exports race for mermaid's global configuration, and the reader gets two
    // identical downloads for one intention.
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const module = await import("../export/docxExport");
    vi.spyOn(module, "downloadDocx").mockImplementation(async (text: string, path: string) => {
      exported.calls.push({ text, path });
      await slow;
    });
    setup();

    fireEvent.click(exportButton()!);
    fireEvent.click(exportButton()!);
    fireEvent.click(exportButton()!);

    await waitFor(() => expect(exported.calls).toHaveLength(1));
    release();
  });
});
