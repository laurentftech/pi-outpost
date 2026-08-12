import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileViewer } from "./FileViewer";
import type { GitDiffState, OpenFile } from "../useAgent";

function loaded(overrides: Partial<Extract<OpenFile, { status: "loaded" }>> = {}): OpenFile {
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
    file: loaded(),
    isStreaming: false,
    gitDiff: null,
    gitAvailable: false,
    ...handlers,
    ...overrides,
  };
  const view = render(<FileViewer {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<FileViewer {...props} {...next} />);
  return { ...handlers, ...view, rerenderWith };
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const queryButton = (name: string | RegExp) => screen.queryByRole("button", { name });

/** Enter edit mode and type, which is the precondition for most guards below. */
function edit(text: string) {
  fireEvent.click(button("✎ edit"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
}

describe("FileViewer", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    confirmSpy.mockRestore();
  });

  describe("reading", () => {
    it("names the open file", () => {
      setup();
      expect(screen.getAllByTitle("src/main.ts").length).toBeGreaterThan(0);
    });

    it("shows the file while it is still loading", () => {
      setup({ file: { status: "loading", path: "src/main.ts", requestId: "r1" } });
      expect(screen.getByText("loading…")).toBeInTheDocument();
    });

    it("surfaces a read error instead of an empty pane", () => {
      setup({ file: { status: "error", path: "src/main.ts", message: "Binary file — preview not supported" } });
      expect(screen.getByText("Binary file — preview not supported")).toBeInTheDocument();
    });

    it("offers a source toggle for markdown only", () => {
      const { rerenderWith } = setup({ file: loaded({ path: "notes.md", content: "# Title\n" }) });
      expect(button(/source/)).toBeInTheDocument();
      rerenderWith({ file: loaded() });
      expect(queryButton(/source/)).not.toBeInTheDocument();
    });

    it("switches markdown between rendered and source", () => {
      setup({ file: loaded({ path: "notes.md", content: "# Title\n" }) });
      expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
      fireEvent.click(button(/source/));
      expect(screen.queryByRole("heading", { name: "Title" })).not.toBeInTheDocument();
      expect(button(/rendered/)).toBeInTheDocument();
    });
  });

  describe("the writable zone", () => {
    it("offers editing when everything is writable", () => {
      setup({ writableRoot: undefined });
      expect(button("✎ edit")).toBeInTheDocument();
    });

    it("marks the file read-only when nothing is writable", () => {
      setup({ writableRoot: null });
      expect(queryButton("✎ edit")).not.toBeInTheDocument();
      expect(screen.getByText("🔒 read-only")).toBeInTheDocument();
    });

    it("offers editing inside the writable subtree", () => {
      setup({ file: loaded({ path: "src/main.ts" }), writableRoot: "src" });
      expect(button("✎ edit")).toBeInTheDocument();
    });

    it("refuses editing outside the writable subtree", () => {
      setup({ file: loaded({ path: "docs/readme.md" }), writableRoot: "src" });
      expect(queryButton("✎ edit")).not.toBeInTheDocument();
    });

    it("does not mistake a sibling with a shared prefix for the writable subtree", () => {
      // "src-generated" starts with "src" but is not inside it
      setup({ file: loaded({ path: "src-generated/out.ts" }), writableRoot: "src" });
      expect(queryButton("✎ edit")).not.toBeInTheDocument();
    });
  });

  describe("editing", () => {
    it("keeps save disabled until something changes", () => {
      setup();
      fireEvent.click(button("✎ edit"));
      expect(button("save")).toBeDisabled();
    });

    it("submits the draft with the baseline mtime", () => {
      const { onSave } = setup();
      edit("const a = 2;\n");
      fireEvent.click(button("save"));
      expect(onSave).toHaveBeenCalledWith("src/main.ts", "const a = 2;\n", 1000, false);
    });

    it("saves on the keyboard shortcut", () => {
      const { onSave } = setup();
      edit("const a = 2;\n");
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", metaKey: true });
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("ignores the shortcut when there is nothing to save", () => {
      const { onSave } = setup();
      fireEvent.click(button("✎ edit"));
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });
      expect(onSave).not.toHaveBeenCalled();
    });

    it("reports the unsaved state so the app can guard the prompt", () => {
      const { onDirtyChange } = setup();
      edit("changed\n");
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it("marks the filename while the draft differs", () => {
      setup();
      edit("changed\n");
      expect(screen.getByText("●")).toBeInTheDocument();
    });

    it("asks before discarding a dirty draft on cancel", () => {
      setup();
      edit("changed\n");
      fireEvent.click(button("cancel"));
      expect(confirmSpy).toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("keeps the draft when the discard prompt is declined", () => {
      confirmSpy.mockReturnValue(false);
      setup();
      edit("changed\n");
      fireEvent.click(button("cancel"));
      expect(screen.getByRole("textbox")).toHaveValue("changed\n");
    });

    it("leaves a clean draft without asking", () => {
      setup();
      fireEvent.click(button("✎ edit"));
      fireEvent.click(button("cancel"));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("shows the save in flight and blocks a second submit", () => {
      const { rerenderWith, onSave } = setup();
      edit("const a = 2;\n");
      rerenderWith({ file: loaded({ pendingSave: { requestId: "w1", content: "const a = 2;\n" } }) });
      const saveButton = button("saving…");
      expect(saveButton).toBeDisabled();
      onSave.mockClear();
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", metaKey: true });
      expect(onSave).not.toHaveBeenCalled();
    });

    it("leaves edit mode once the save lands", () => {
      const { rerenderWith } = setup();
      edit("const a = 2;\n");
      fireEvent.click(button("save"));
      // The write is acknowledged: new content, new mtime
      rerenderWith({ file: loaded({ content: "const a = 2;\n", mtimeMs: 2000 }) });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("keeps typing that happened during the round-trip", () => {
      const { rerenderWith } = setup();
      edit("const a = 2;\n");
      fireEvent.click(button("save"));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "const a = 3;\n" } });
      rerenderWith({ file: loaded({ content: "const a = 2;\n", mtimeMs: 2000 }) });
      // Still editing, and the newer draft survived the acknowledgement
      expect(screen.getByRole("textbox")).toHaveValue("const a = 3;\n");
    });

    it("shows a save failure that is not a conflict", () => {
      const { rerenderWith } = setup();
      edit("changed\n");
      rerenderWith({ file: loaded({ saveError: { message: "The sandbox is read-only", conflict: false } }) });
      expect(screen.getByText("The sandbox is read-only")).toBeInTheDocument();
    });
  });

  describe("conflicts", () => {
    it("warns when the file moved on disk under the editor", () => {
      const { rerenderWith } = setup();
      edit("mine\n");
      rerenderWith({ file: loaded({ mtimeMs: 5000 }) });
      expect(screen.getByText("File changed on disk since you started editing.")).toBeInTheDocument();
      expect(button("save")).toBeDisabled();
    });

    it("offers to reload, discarding the draft", () => {
      const { rerenderWith, onReload } = setup();
      edit("mine\n");
      rerenderWith({ file: loaded({ mtimeMs: 5000 }) });
      fireEvent.click(button(/reload/));
      expect(onReload).toHaveBeenCalledWith("src/main.ts");
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("offers to overwrite, forcing past the mtime check", () => {
      const { rerenderWith, onSave } = setup();
      edit("mine\n");
      rerenderWith({ file: loaded({ mtimeMs: 5000 }) });
      fireEvent.click(button(/overwrite/));
      expect(onSave).toHaveBeenCalledWith("src/main.ts", "mine\n", 1000, true);
    });

    it("treats a server-reported conflict the same way", () => {
      const { rerenderWith } = setup();
      edit("mine\n");
      rerenderWith({ file: loaded({ saveError: { message: "changed on disk", conflict: true } }) });
      expect(screen.getByText("File changed on disk since you started editing.")).toBeInTheDocument();
    });
  });

  describe("closing", () => {
    it("closes on the button", () => {
      const { onClose } = setup();
      fireEvent.click(button("Close file viewer"));
      expect(onClose).toHaveBeenCalled();
    });

    it("closes on Escape", () => {
      const { onClose } = setup();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });

    it("asks before closing over unsaved changes", () => {
      const { onClose } = setup();
      edit("changed\n");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(confirmSpy).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("stays open when the discard prompt is declined", () => {
      confirmSpy.mockReturnValue(false);
      const { onClose } = setup();
      edit("changed\n");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("reports the file clean on unmount, whatever the draft held", () => {
      const { onDirtyChange, unmount } = setup();
      edit("changed\n");
      unmount();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });
  });

  describe("git surface", () => {
    it("offers the diff toggle only for a file carrying changes", () => {
      const { rerenderWith } = setup({ gitState: undefined });
      expect(queryButton("± diff")).not.toBeInTheDocument();
      rerenderWith({ gitState: "modified" });
      expect(button("± diff")).toBeInTheDocument();
    });

    it("fetches the diff when the toggle goes on and clears it when off", () => {
      const { onFetchGitDiff, onClearGitDiff } = setup({ gitState: "modified" });
      fireEvent.click(button("± diff"));
      expect(onFetchGitDiff).toHaveBeenCalledWith("src/main.ts");
      expect(button("± diff")).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(button("± diff"));
      expect(onClearGitDiff).toHaveBeenCalled();
    });

    it("opens straight onto the diff when asked", () => {
      const { onFetchGitDiff } = setup({ gitState: "modified", initialShowGitDiff: true });
      expect(onFetchGitDiff).toHaveBeenCalledWith("src/main.ts");
      expect(button("± diff")).toHaveAttribute("aria-pressed", "true");
    });

    it("waits rather than showing another file's diff", () => {
      const other: GitDiffState = { path: "other.ts", before: "a", after: "b" };
      setup({ gitState: "modified", initialShowGitDiff: true, gitDiff: other });
      expect(screen.getByText("loading diff…")).toBeInTheDocument();
    });

    it("renders the diff once it arrives for this file", () => {
      const mine: GitDiffState = { path: "src/main.ts", before: "const a = 1;\n", after: "const a = 2;\n" };
      setup({ gitState: "modified", initialShowGitDiff: true, gitDiff: mine });
      expect(screen.queryByText("loading diff…")).not.toBeInTheDocument();
      expect(screen.getAllByText(/const a = 2;/).length).toBeGreaterThan(0);
    });

    it("shows a diff failure in the pane", () => {
      const failed: GitDiffState = { path: "src/main.ts", error: "Binary file — diff not supported" };
      setup({ gitState: "modified", initialShowGitDiff: true, gitDiff: failed });
      expect(screen.getByText("Binary file — diff not supported")).toBeInTheDocument();
    });

    it("drops the fetched diff when the viewer goes away", () => {
      const { onClearGitDiff, unmount } = setup({ gitState: "modified" });
      unmount();
      expect(onClearGitDiff).toHaveBeenCalled();
    });

    it("offers the history affordance for any tracked file, changed or not", () => {
      const { onOpenGitHistory } = setup({ gitAvailable: true, gitState: undefined });
      fireEvent.click(button("⎇ history"));
      expect(onOpenGitHistory).toHaveBeenCalledWith("src/main.ts");
    });

    it("hides the history affordance when git is unavailable", () => {
      setup({ gitAvailable: false });
      expect(queryButton("⎇ history")).not.toBeInTheDocument();
    });

    it("hides both git affordances while editing", () => {
      setup({ gitAvailable: true, gitState: "modified" });
      fireEvent.click(button("✎ edit"));
      expect(queryButton("⎇ history")).not.toBeInTheDocument();
      expect(queryButton("± diff")).not.toBeInTheDocument();
    });
  });

  describe("images", () => {
    it("loads an image from the raw route rather than the text protocol", () => {
      setup({ file: { status: "error", path: "plot.png", message: "Binary file — preview not supported" } });
      const img = screen.getByRole("img", { name: "plot.png" });
      expect(img).toHaveAttribute("src", expect.stringContaining("/files/raw"));
    });

    it("confirms the image decoded before it can become an attachment", () => {
      const { onImageLoad } = setup({ file: { status: "error", path: "plot.png", message: "binary" } });
      fireEvent.load(screen.getByRole("img", { name: "plot.png" }));
      expect(onImageLoad).toHaveBeenCalledWith("plot.png");
    });

    it("carries the auth token on the raw URL, since img cannot send headers", () => {
      setup({ file: { status: "error", path: "plot.png", message: "binary" }, token: "secret-token" });
      expect(screen.getByRole("img", { name: "plot.png" })).toHaveAttribute("src", expect.stringContaining("secret-token"));
    });
  });
});
