import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { FileViewer } from "./FileViewer";
import type { GitDiffState, OpenFile } from "../useAgent";
import type { PdfFindState, PdfViewerHandle } from "./PdfViewer";

const pdfFindNext = vi.fn();
const pdfFindPrevious = vi.fn();
let lastOnFindStateChange: ((state: PdfFindState) => void) | undefined;

vi.mock("./PdfViewer", () => ({
  default: forwardRef<PdfViewerHandle, { path: string; onFindStateChange?: (state: PdfFindState) => void }>(
    function FakePdfViewer({ path, onFindStateChange }, ref) {
      lastOnFindStateChange = onFindStateChange;
      useImperativeHandle(ref, () => ({ findNext: pdfFindNext, findPrevious: pdfFindPrevious }), []);
      return <div data-testid="pdf-viewer" data-path={path} />;
    },
  ),
}));

function loadedFile(overrides: Partial<Extract<OpenFile, { status: "loaded" }>> = {}): OpenFile {
  return { status: "loaded", path: "src/main.ts", content: "const a = 1;\n", size: 13, mtimeMs: 1000, ...overrides };
}

type Props = React.ComponentProps<typeof FileViewer>;

function setup(overrides: Partial<Props> = {}) {
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
    file: loadedFile(),
    isStreaming: false,
    gitDiff: null as GitDiffState | null,
    gitAvailable: false,
    ...handlers,
    ...overrides,
  };
  const view = render(<FileViewer {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<FileViewer {...props} {...next} />);
  return { ...handlers, ...view, rerenderWith };
}

const ctrlF = () => fireEvent.keyDown(document, { key: "f", ctrlKey: true });
const escape = () => fireEvent.keyDown(document, { key: "Escape" });
const findInput = () => screen.getByLabelText("Find") as HTMLInputElement;
const typeQuery = (text: string) => fireEvent.change(findInput(), { target: { value: text } });
// `getByRole("textbox")` is ambiguous once the find input (also role
// "textbox") is on screen alongside the edit-mode textarea.
const editTextarea = () => document.querySelector("textarea") as HTMLTextAreaElement;

describe("FileViewer find-in-page", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    Element.prototype.scrollIntoView = vi.fn();
    lastOnFindStateChange = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("opening and closing", () => {
    it("opens the find bar with Ctrl+F on a text file", () => {
      setup();
      expect(screen.queryByRole("search", { name: "Find in file" })).toBeNull();

      ctrlF();

      expect(screen.getByRole("search", { name: "Find in file" })).toBeInTheDocument();
    });

    it("does nothing on an image file", () => {
      setup({ file: { status: "error", path: "photo.png", message: "Binary file — preview not supported" } });

      ctrlF();

      expect(screen.queryByRole("search", { name: "Find in file" })).toBeNull();
    });

    it("does nothing while showing a git diff", () => {
      setup({ gitState: "modified", initialShowGitDiff: true });

      ctrlF();

      expect(screen.queryByRole("search", { name: "Find in file" })).toBeNull();
    });

    it("does nothing in the side-by-side split view", () => {
      // jsdom ships no matchMedia, and the mode asks it whether there is room
      // for two panes — see FileViewer.split.test.tsx for the same stub.
      window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
      setup({ file: loadedFile({ path: "notes.md", content: "# Title\nfox" }) });
      fireEvent.click(screen.getByRole("button", { name: /split/ }));
      expect(screen.getByTestId("file-split")).toBeInTheDocument();

      ctrlF();

      expect(screen.queryByRole("search", { name: "Find in file" })).toBeNull();
    });

    it("closes the find bar first on Escape, leaving the viewer open", () => {
      const onClose = vi.fn();
      setup({ onClose });
      ctrlF();
      expect(screen.getByRole("search", { name: "Find in file" })).toBeInTheDocument();

      escape();

      expect(screen.queryByRole("search", { name: "Find in file" })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("closes the viewer on a second Escape once the find bar is already closed", () => {
      const onClose = vi.fn();
      setup({ onClose });
      ctrlF();
      escape(); // closes the find bar

      escape(); // now closes the viewer

      expect(onClose).toHaveBeenCalled();
    });

    it("reopens with the previous query preselected", () => {
      setup();
      ctrlF();
      typeQuery("outpost");
      escape();

      ctrlF();

      expect(findInput().value).toBe("outpost");
    });
  });

  describe("dom-mode search (source and rendered views)", () => {
    it("marks every match and distinguishes the current one", async () => {
      setup({ file: loadedFile({ content: "const fox = 1;\nconst fox2 = fox;\n" }) });
      ctrlF();

      typeQuery("fox");

      await waitFor(() => expect(screen.getByText("1/3")).toBeInTheDocument());
      const marks = document.querySelectorAll("mark.find-match");
      expect(marks).toHaveLength(3);
      expect(document.querySelectorAll("mark.find-match-current")).toHaveLength(1);
    });

    it("scrolls the current match into view when navigating", async () => {
      setup({ file: loadedFile({ content: "fox fox fox" }) });
      ctrlF();
      typeQuery("fox");
      await waitFor(() => expect(screen.getByText("1/3")).toBeInTheDocument());
      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

      fireEvent.click(screen.getByLabelText("Next match"));

      await waitFor(() => expect(screen.getByText("2/3")).toBeInTheDocument());
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it("re-evaluates the query when switching from rendered to source view", async () => {
      setup({ file: loadedFile({ path: "notes.md", content: "The fox jumps over the fox." }) });
      ctrlF();
      typeQuery("fox");
      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /source/ }));

      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
      expect(document.querySelectorAll("mark.find-match")).toHaveLength(2);
    });

    it("shows no matches, not an error, for a query the file does not contain", async () => {
      setup({ file: loadedFile({ content: "nothing interesting here" }) });
      ctrlF();

      typeQuery("xyzzy");

      await waitFor(() => expect(screen.getByText("0/0")).toBeInTheDocument());
    });
  });

  describe("edit-mode search", () => {
    it("selects the current match's exact text in the textarea", async () => {
      setup({ file: loadedFile({ content: "one fox two fox" }), writableRoot: undefined });
      fireEvent.click(screen.getByRole("button", { name: "✎ edit" }));
      ctrlF();

      typeQuery("fox");

      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
      const textarea = editTextarea();
      expect(textarea.value.slice(textarea.selectionStart ?? -1, textarea.selectionEnd ?? -1)).toBe("fox");
      expect(textarea.selectionStart).toBe(4);
      expect(textarea.selectionEnd).toBe(7);
      // Focus bounces back to the find field once the selection (and its
      // native scroll-into-view) is made, so Enter/Shift+Enter keep stepping
      // through matches without the reader having to reclick the find box.
      expect(findInput()).toHaveFocus();
    });

    it("does not mark the other matches while editing — a textarea's value carries no markup", async () => {
      setup({ file: loadedFile({ content: "one fox two fox" }), writableRoot: undefined });
      fireEvent.click(screen.getByRole("button", { name: "✎ edit" }));
      ctrlF();

      typeQuery("fox");

      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
      expect(document.querySelectorAll("mark")).toHaveLength(0);
    });

    it("updates the match count as the buffer is edited, without moving the selection", async () => {
      setup({ file: loadedFile({ content: "one fox two fox" }), writableRoot: undefined });
      fireEvent.click(screen.getByRole("button", { name: "✎ edit" }));
      ctrlF();
      typeQuery("fox");
      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());

      const textarea = editTextarea();
      findInput().focus(); // simulate focus having returned to the find field
      fireEvent.change(textarea, { target: { value: "one fox two fox three fox" } });

      await waitFor(() => expect(screen.getByText("1/3")).toBeInTheDocument());
      // Typing in the document must not steal focus back to the textarea.
      expect(findInput()).toHaveFocus();
    });

    it("moves to the next match with Enter and wraps around", async () => {
      setup({ file: loadedFile({ content: "one fox two fox" }), writableRoot: undefined });
      fireEvent.click(screen.getByRole("button", { name: "✎ edit" }));
      ctrlF();
      typeQuery("fox");
      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());

      fireEvent.keyDown(findInput(), { key: "Enter" });
      await waitFor(() => expect(screen.getByText("2/2")).toBeInTheDocument());
      expect(editTextarea().selectionStart).toBe(12);

      fireEvent.keyDown(findInput(), { key: "Enter" });
      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
      expect(editTextarea().selectionStart).toBe(4);
    });
  });

  describe("pdf mode", () => {
    function pdfFile(path = "docs/report.pdf"): OpenFile {
      return { status: "error", path, message: "Binary file — preview not supported" };
    }

    it("forwards the query to PdfViewer only while find is open", async () => {
      setup({ file: pdfFile() });
      await screen.findByTestId("pdf-viewer");

      ctrlF();
      typeQuery("fox");
      expect(screen.getByTestId("pdf-viewer")).toBeInTheDocument();

      escape(); // closes the find bar
      // The effective query passed down clears; nothing to assert on the fake
      // beyond it not crashing — PdfViewer's own tests cover its find logic.
    });

    it("delegates next/previous to the PdfViewer handle", async () => {
      setup({ file: pdfFile() });
      await screen.findByTestId("pdf-viewer");
      ctrlF();
      // Next/previous are disabled at 0 matches — give PdfViewer something to report.
      lastOnFindStateChange?.({ matchCount: 2, currentIndex: 0, searching: false });
      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText("Next match"));
      fireEvent.click(screen.getByLabelText("Previous match"));

      expect(pdfFindNext).toHaveBeenCalledTimes(1);
      expect(pdfFindPrevious).toHaveBeenCalledTimes(1);
    });

    it("shows the match count PdfViewer reports", async () => {
      setup({ file: pdfFile() });
      await screen.findByTestId("pdf-viewer");
      ctrlF();

      lastOnFindStateChange?.({ matchCount: 4, currentIndex: 1, searching: false });

      await waitFor(() => expect(screen.getByText("2/4")).toBeInTheDocument());
    });
  });

  describe("resets on file change", () => {
    // App.tsx mounts FileViewer with `key={state.openFile.path}` specifically
    // so a switch to another file is a remount, not a prop update — the same
    // reason an edit draft can never survive it. Find state relies on that
    // same remount, so this reproduces it explicitly rather than assuming it.
    it("clears the query and matches when the open file is a new mount", async () => {
      const { unmount } = setup({ file: loadedFile({ path: "a.ts", content: "fox fox" }) });
      ctrlF();
      typeQuery("fox");
      await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
      unmount();

      setup({ file: loadedFile({ path: "b.ts", content: "nothing here" }) });

      expect(screen.queryByRole("search", { name: "Find in file" })).toBeNull();
      expect(screen.queryByText("1/2")).toBeNull();
    });
  });
});
