import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import type { DirEntry, GitFileState } from "@pi-outpost/shared";
import { FileTree } from "./FileTree";
import { UploadContextChangedError } from "../uploads";
import type { DirState } from "../useAgent";

const file = (name: string): DirEntry => ({ name, type: "file" });
const dir = (name: string): DirEntry => ({ name, type: "directory" });

/** Root holds src/ and readme.md; src/ is loaded but only rendered once expanded. */
function tree(overrides: Record<string, DirState> = {}): Record<string, DirState> {
  return {
    "": [dir("src"), file("readme.md")],
    src: [file("main.ts"), dir("nested")],
    ...overrides,
  };
}

type Props = React.ComponentProps<typeof FileTree>;

function setup(overrides: Partial<Props> = {}) {
  const handlers = {
    onExpand: vi.fn(),
    onSelectFile: vi.fn(),
    onSelectDiff: vi.fn(),
    onToggleAttachPath: vi.fn(),
  };
  const view = render(<FileTree tree={tree()} {...handlers} {...overrides} />);
  return { ...handlers, ...view };
}

/**
 * The directory toggle for a name. Anchored at both ends: "src" must not also
 * match "src-gen", which is exactly the confusion one of the tests below is about.
 * The trailing digits are the change-count badge, which the accessible name runs
 * straight onto the directory name with no separator.
 */
const dirToggle = (name: string) => screen.getByRole("button", { name: new RegExp(`^[▸▾]\\s*${name}\\s*\\d*$`) });

/** Open a row's actions menu from its ⋯ control and return the menu. */
function openMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  return screen.getByRole("menu");
}
const menuItem = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const queryMenuItem = (name: string | RegExp) => screen.queryByRole("menuitem", { name });
/** Choose an item from a row's actions menu. */
function choose(row: string, item: string | RegExp) {
  openMenu(row);
  fireEvent.click(menuItem(item));
}

describe("FileTree", () => {
  describe("expanding", () => {
    it("lists the root without expanding anything", () => {
      setup();
      expect(dirToggle("src")).toBeInTheDocument();
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.queryByText("main.ts")).not.toBeInTheDocument();
    });

    it("reveals children when a directory opens", () => {
      setup();
      fireEvent.click(dirToggle("src"));
      expect(screen.getByText("main.ts")).toBeInTheDocument();
    });

    it("hides them again when it closes", () => {
      setup();
      fireEvent.click(dirToggle("src"));
      fireEvent.click(dirToggle("src"));
      expect(screen.queryByText("main.ts")).not.toBeInTheDocument();
    });

    it("asks for a directory it has never seen", () => {
      const { onExpand } = setup({ tree: { "": [dir("src")] } });
      fireEvent.click(dirToggle("src"));
      expect(onExpand).toHaveBeenCalledWith("src");
    });

    it("does not re-ask for a directory already in hand", () => {
      const { onExpand } = setup();
      fireEvent.click(dirToggle("src"));
      expect(onExpand).not.toHaveBeenCalled();
    });

    it("builds nested paths from the parent", () => {
      const { onExpand } = setup();
      fireEvent.click(dirToggle("src"));
      fireEvent.click(dirToggle("nested"));
      expect(onExpand).toHaveBeenCalledWith("src/nested");
    });

    it("says a directory is loading", () => {
      setup({ tree: { "": [dir("src")], src: "loading" } });
      fireEvent.click(dirToggle("src"));
      expect(screen.getByText("loading…")).toBeInTheDocument();
    });

    it("says a directory is empty rather than showing nothing", () => {
      setup({ tree: { "": [dir("src")], src: [] } });
      fireEvent.click(dirToggle("src"));
      expect(screen.getByText("empty")).toBeInTheDocument();
    });

    it("surfaces a listing error", () => {
      setup({ tree: { "": [dir("src")], src: { error: "Cannot read \"src\": EACCES" } } });
      fireEvent.click(dirToggle("src"));
      expect(screen.getByText(/EACCES/)).toBeInTheDocument();
    });
  });

  describe("selecting", () => {
    it("reports the full path of the chosen file", () => {
      const { onSelectFile } = setup();
      fireEvent.click(dirToggle("src"));
      fireEvent.click(screen.getByText("main.ts"));
      expect(onSelectFile).toHaveBeenCalledWith("src/main.ts");
    });

    it("reports a root-level file without a leading slash", () => {
      const { onSelectFile } = setup();
      fireEvent.click(screen.getByText("readme.md"));
      expect(onSelectFile).toHaveBeenCalledWith("readme.md");
    });

    // A mouse click carries `detail: 1`; jsdom's default `detail: 0` is a keyboard activation.
    it("AClickSelectsADoubleClickOpens: a mouse click selects, a double-click opens", () => {
      const { onSelectFile } = setup();
      const row = screen.getByRole("button", { name: "readme.md" });

      fireEvent.pointerDown(row, { pointerType: "mouse" });
      fireEvent.click(row, { detail: 1 });
      expect(onSelectFile).not.toHaveBeenCalled();
      expect(row.closest("[data-selected]")).toHaveAttribute("data-selected", "true");

      fireEvent.click(row, { detail: 2 });
      fireEvent.doubleClick(row);
      expect(onSelectFile).toHaveBeenCalledTimes(1);
      expect(onSelectFile).toHaveBeenCalledWith("readme.md");
    });

    it("EnterOpensTheFocusedFile: a keyboard activation opens at once", () => {
      const { onSelectFile } = setup();
      // Enter on a focused button is a click with no pointer behind it.
      fireEvent.click(screen.getByRole("button", { name: "readme.md" }), { detail: 0 });
      expect(onSelectFile).toHaveBeenCalledWith("readme.md");
    });

    it("ATapOpens: a touch tap opens without a second tap", () => {
      const { onSelectFile } = setup();
      const row = screen.getByRole("button", { name: "readme.md" });
      fireEvent.pointerDown(row, { pointerType: "touch" });
      fireEvent.click(row, { detail: 1 });
      expect(onSelectFile).toHaveBeenCalledWith("readme.md");
    });

    it("a modified double-click stays a selection gesture", () => {
      const { onSelectFile } = setup();
      const row = screen.getByRole("button", { name: "readme.md" });
      fireEvent.doubleClick(row, { metaKey: true });
      fireEvent.doubleClick(row, { shiftKey: true });
      expect(onSelectFile).not.toHaveBeenCalled();
    });
  });

  describe("the writable zone", () => {
    it("dims nothing when there is no sandbox", () => {
      setup({ writableRoot: undefined });
      // Match the light-mode token only: dark:text-zinc-400 is what an *undimmed*
      // row carries, so a bare /zinc-400/ would pass on either
      expect(screen.getByText("readme.md").className).not.toMatch(/(^|\s)text-zinc-400\b/);
    });

    it("dims everything when the sandbox is read-only", () => {
      setup({ writableRoot: null });
      expect(screen.getByText("readme.md").className).toMatch(/(^|\s)text-zinc-400\b/);
    });

    it("dims only what sits outside the writable subtree", () => {
      setup({ writableRoot: "src" });
      fireEvent.click(dirToggle("src"));
      expect(screen.getByText("main.ts").className).not.toMatch(/(^|\s)text-zinc-400\b/);
      expect(screen.getByText("readme.md").className).toMatch(/(^|\s)text-zinc-400\b/);
    });

    it("does not treat a sibling sharing a prefix as inside the zone", () => {
      setup({ tree: { "": [file("src-generated.ts")] }, writableRoot: "src" });
      expect(screen.getByText("src-generated.ts").className).toMatch(/(^|\s)text-zinc-400\b/);
    });
  });

  describe("git badges", () => {
    const gitFiles: Record<string, GitFileState> = {
      "src/main.ts": "modified",
      "readme.md": "untracked",
    };

    it("badges a changed file with its state", () => {
      setup({ gitFiles });
      fireEvent.click(dirToggle("src"));
      expect(screen.getByRole("button", { name: "Show diff of main.ts" })).toHaveTextContent("M");
      expect(screen.getByRole("button", { name: "Show diff of readme.md" })).toHaveTextContent("U");
    });

    it("leaves an unchanged file unbadged", () => {
      setup({ gitFiles: { "readme.md": "modified" } });
      fireEvent.click(dirToggle("src"));
      expect(screen.queryByRole("button", { name: "Show diff of main.ts" })).not.toBeInTheDocument();
    });

    it("opens the file straight on its diff", () => {
      const { onSelectDiff } = setup({ gitFiles });
      fireEvent.click(dirToggle("src"));
      fireEvent.click(screen.getByRole("button", { name: "Show diff of main.ts" }));
      expect(onSelectDiff).toHaveBeenCalledWith("src/main.ts");
    });

    it("falls back to plain selection when no diff handler is given", () => {
      const { onSelectFile } = setup({ gitFiles, onSelectDiff: undefined });
      fireEvent.click(dirToggle("src"));
      fireEvent.click(screen.getByRole("button", { name: "Show diff of main.ts" }));
      expect(onSelectFile).toHaveBeenCalledWith("src/main.ts");
    });

    it("counts changed files on a collapsed directory", () => {
      setup({ gitFiles: { "src/main.ts": "modified", "src/nested/deep.ts": "added" } });
      const badge = within(dirToggle("src")).getByTitle("2 changed file(s) inside");
      expect(badge).toHaveTextContent("2");
    });

    // openlore: scenario=TheBadgeSaysAtLeast spec=git
    it("TheBadgeSaysAtLeast: a directory holding at least N untracked files shows N+, open or not, and so do its parents", () => {
      const toggle = (name: string) => screen.getByRole("button", { name: new RegExp(`^[▸▾]\\s*${name}\\s*[\\d+]*$`) });
      setup({
        tree: tree({ "": [dir("src"), dir("vendor"), file("readme.md")], vendor: [file("a.bin"), file("b.bin")] }),
        gitFiles: { vendor: "untracked", "src/main.ts": "modified", "src/nested": "untracked", "readme.md": "modified" },
        gitAtLeast: { vendor: 2000, "src/nested": 2000 },
      });
      expect(within(toggle("vendor")).getByTitle("At least 2000 changed file(s) inside")).toHaveTextContent("2000+");
      // A parent adds what it holds besides, and is a lower bound too
      expect(within(toggle("src")).getByTitle("At least 2001 changed file(s) inside")).toHaveTextContent("2001+");
      fireEvent.click(toggle("vendor"));
      expect(within(toggle("vendor")).getByTitle("At least 2000 changed file(s) inside")).toHaveTextContent("2000+");
      // No row inside carries a badge of its own
      expect(screen.getByRole("button", { name: /^a\.bin/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Show diff of [ab]\.bin$/ })).not.toBeInTheDocument();
      // ...while a file the status names does carry one, so the absence above means something
      expect(screen.getByRole("button", { name: "Show diff of readme.md" })).toBeInTheDocument();
    });

    it("drops the count once the directory is open, since the files speak for themselves", () => {
      setup({ gitFiles: { "src/main.ts": "modified" } });
      fireEvent.click(dirToggle("src"));
      expect(within(dirToggle("src")).queryByTitle(/changed file/)).not.toBeInTheDocument();
    });

    it("does not count a sibling directory sharing a prefix", () => {
      setup({ tree: { "": [dir("src"), dir("src-gen")] }, gitFiles: { "src-gen/out.ts": "modified" } });
      expect(within(dirToggle("src")).queryByTitle(/changed file/)).not.toBeInTheDocument();
      expect(within(dirToggle("src-gen")).getByTitle("1 changed file(s) inside")).toBeInTheDocument();
    });

    describe("a workspace whose root is no repository and whose children are", () => {
      /** Two projects side by side, each a repository, each with one change. */
      const projects: Record<string, DirState> = {
        "": [dir("projA"), dir("projB"), file("notes.md")],
        projA: [file("a.ts")],
        projB: [file("b.ts")],
      };
      const across: Record<string, GitFileState> = {
        "projA/a.ts": "modified",
        "projB/b.ts": "untracked",
      };

      it("badges files from both repositories, not just one", () => {
        setup({ tree: projects, gitFiles: across });
        fireEvent.click(dirToggle("projA"));
        fireEvent.click(dirToggle("projB"));
        expect(screen.getByRole("button", { name: "Show diff of a.ts" })).toHaveTextContent("M");
        expect(screen.getByRole("button", { name: "Show diff of b.ts" })).toHaveTextContent("U");
      });

      it("puts a change count on each collapsed project", () => {
        setup({ tree: projects, gitFiles: across });
        expect(within(dirToggle("projA")).getByTitle("1 changed file(s) inside")).toBeInTheDocument();
        expect(within(dirToggle("projB")).getByTitle("1 changed file(s) inside")).toBeInTheDocument();
      });

      it("reports the directory the user touched, opening it, closing it, or reopening it", () => {
        const onSelectDirectory = vi.fn();
        setup({ tree: projects, gitFiles: across, onSelectDirectory });

        fireEvent.click(dirToggle("projA"));
        expect(onSelectDirectory).toHaveBeenLastCalledWith("projA");

        // Collapsing is still saying which project you are looking at
        fireEvent.click(dirToggle("projA"));
        expect(onSelectDirectory).toHaveBeenCalledTimes(2);

        // And reopening a directory already listed fetches nothing, so onExpand is
        // silent — this is the case the branch chip used to miss entirely
        fireEvent.click(dirToggle("projA"));
        expect(onSelectDirectory).toHaveBeenCalledTimes(3);
        expect(onSelectDirectory).toHaveBeenLastCalledWith("projA");
      });

      it("leaves a file under no repository unbadged", () => {
        setup({ tree: projects, gitFiles: across });
        expect(screen.queryByRole("button", { name: "Show diff of notes.md" })).not.toBeInTheDocument();
      });
    });
  });

  describe("prompt references", () => {
    it("offers Reference in prompt in a file's menu when attaching is possible", () => {
      setup();
      openMenu("readme.md");
      expect(menuItem("Reference in prompt")).toBeInTheDocument();
    });

    it("omits it entirely when attaching is not offered", () => {
      setup({ onToggleAttachPath: undefined });
      openMenu("readme.md");
      expect(queryMenuItem(/prompt/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /from the prompt/ })).not.toBeInTheDocument();
    });

    it("User references a file from the tree: the menu reports the path to attach", () => {
      const { onToggleAttachPath } = setup();
      choose("readme.md", "Reference in prompt");
      expect(onToggleAttachPath).toHaveBeenCalledWith("readme.md");
    });

    it("says the file is already referenced on its row, and the menu offers to drop it", () => {
      setup({ attachedPaths: ["readme.md"] });
      const marker = screen.getByRole("button", { name: "Remove readme.md from the prompt" });
      expect(marker).toHaveAttribute("aria-pressed", "true");
      openMenu("readme.md");
      expect(menuItem("Remove from prompt")).toBeInTheDocument();
    });

    it("TheMarkerDropsTheReference: the marker and Remove from prompt both drop it", () => {
      const { onToggleAttachPath } = setup({ attachedPaths: ["readme.md"] });
      fireEvent.click(screen.getByRole("button", { name: "Remove readme.md from the prompt" }));
      choose("readme.md", "Remove from prompt");
      expect(onToggleAttachPath.mock.calls).toEqual([["readme.md"], ["readme.md"]]);
    });

    it("ReferenceAFolder: a folder is referenced from its menu and marked on its row", () => {
      const { onToggleAttachPath, rerender } = setup();
      choose("src", "Reference in prompt");
      expect(onToggleAttachPath).toHaveBeenCalledWith("src");
      rerender(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} onToggleAttachPath={onToggleAttachPath} attachedPaths={["src"]} />);
      expect(screen.getByRole("button", { name: "Remove src from the prompt" })).toHaveAttribute("aria-pressed", "true");
    });

    it("keeps the @ lit on a referenced row, and reveals it only on hover elsewhere", () => {
      setup({ tree: { "": [file("readme.md"), file("notes.md")] }, attachedPaths: ["readme.md"] });
      expect(screen.getByRole("button", { name: /Remove readme.md/ }).className).not.toMatch(/opacity-0/);
      const plain = screen.getByRole("button", { name: "Reference notes.md in the prompt" });
      expect(plain).toHaveAttribute("aria-pressed", "false");
      expect(plain.className).toMatch(/opacity-0/);
    });

    it("the @ on a row references the file or the folder in one click", () => {
      const { onToggleAttachPath } = setup();
      fireEvent.click(screen.getByRole("button", { name: "Reference readme.md in the prompt" }));
      fireEvent.click(screen.getByRole("button", { name: "Reference src in the prompt" }));
      expect(onToggleAttachPath.mock.calls).toEqual([["readme.md"], ["src"]]);
    });
  });

  it("marks the file currently open in the viewer", () => {
    setup({ openFilePath: "readme.md" });
    const row = screen.getByText("readme.md").closest("div")!;
    expect(row.className).toMatch(/bg-zinc-100/);
  });

  it("keeps the complete entry name available on hover when the row truncates it", () => {
    const longName = "a-very-long-document-name-that-does-not-fit.docx";
    setup({ tree: { "": [dir("a-very-long-directory-name-that-does-not-fit"), file(longName)] } });

    expect(screen.getByText(longName)).toHaveAttribute("title", longName);
    expect(screen.getByText("a-very-long-directory-name-that-does-not-fit")).toHaveAttribute(
      "title",
      "a-very-long-directory-name-that-does-not-fit",
    );
  });

  describe("file lifecycle actions", () => {
    const handlers = () => ({
      onOpenNative: vi.fn(),
      onRenameFile: vi.fn(),
      onDeleteFile: vi.fn(),
      onMoveFile: vi.fn(),
      onCopyFile: vi.fn(),
    });

    it("opens a read-only file with its associated application", () => {
      const actions = handlers();
      setup({ ...actions, writableRoot: null });

      openMenu("readme.md");
      expect(queryMenuItem(/^Rename/)).not.toBeInTheDocument();
      expect(queryMenuItem(/^Delete/)).not.toBeInTheDocument();
      fireEvent.click(menuItem("Open with associated app"));

      expect(actions.onOpenNative).toHaveBeenCalledWith("readme.md");
    });

    it("TheTreeOffersRevealOnFilesAndFolders: a file row and a folder row each ask to be shown in the file manager", () => {
      const onRevealNative = vi.fn();
      setup({ tree: { "": [dir("docs"), file("readme.md")] }, onRevealNative, writableRoot: null });

      choose("readme.md", "Show in file manager");
      choose("docs", "Show in file manager");

      // Showing is not writing: a read-only tree offers it all the same, and nothing expanded.
      expect(onRevealNative.mock.calls).toEqual([["readme.md"], ["docs"]]);
      expect(screen.queryByText("empty")).not.toBeInTheDocument();
    });

    it("offers no reveal control when the page cannot ask for one", () => {
      setup({ tree: { "": [dir("docs"), file("readme.md")] } });
      openMenu("readme.md");
      expect(queryMenuItem("Show in file manager")).not.toBeInTheDocument();
    });

    it("shows why a reveal failed, on the tree", () => {
      setup({
        tree: { "": [file("readme.md")] },
        onRevealNative: vi.fn(),
        fileOperation: { status: "error", operation: "reveal_native", path: "readme.md", requestId: "fileop:1", message: 'Cannot show "readme.md" in the file manager: xdg-open exited with code 3' },
      });
      expect(screen.getByRole("alert")).toHaveTextContent('Cannot show "readme.md" in the file manager: xdg-open exited with code 3');
    });

    it("renames a writable file in place", () => {
      const actions = handlers();
      setup(actions);
      choose("readme.md", /^Rename/);
      const input = screen.getByRole("textbox", { name: "Rename readme.md" });

      fireEvent.change(input, { target: { value: "guide.md" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(actions.onRenameFile).toHaveBeenCalledWith("readme.md", "guide.md");
    });

    it("cancels a rename submitted with a blank name", () => {
      const actions = handlers();
      setup(actions);
      choose("readme.md", /^Rename/);
      const input = screen.getByRole("textbox", { name: "Rename readme.md" });

      fireEvent.change(input, { target: { value: "" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(actions.onRenameFile).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox", { name: "Rename readme.md" })).not.toBeInTheDocument();
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.queryByText("A name is required")).not.toBeInTheDocument();
    });

    it("does not submit the same rename twice while its acknowledgement is pending", () => {
      const actions = handlers();
      const view = render(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} {...actions} />);
      choose("readme.md", /^Rename/);
      const input = screen.getByRole("textbox", { name: "Rename readme.md" });
      fireEvent.change(input, { target: { value: "guide.md" } });
      fireEvent.keyDown(input, { key: "Enter" });

      view.rerender(
        <FileTree
          tree={tree()}
          onExpand={vi.fn()}
          onSelectFile={vi.fn()}
          {...actions}
          fileOperation={{ status: "pending", operation: "rename_file", path: "readme.md", requestId: "fileop:1" }}
        />,
      );

      expect(input).toBeDisabled();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(actions.onRenameFile).toHaveBeenCalledTimes(1);
    });

    it("keeps the rename input and typed value after a server refusal", () => {
      const actions = handlers();
      const view = render(
        <FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} {...actions} />,
      );
      choose("readme.md", /^Rename/);
      const input = screen.getByRole("textbox", { name: "Rename readme.md" });
      fireEvent.change(input, { target: { value: "taken.md" } });
      fireEvent.keyDown(input, { key: "Enter" });

      view.rerender(
        <FileTree
          tree={tree()}
          onExpand={vi.fn()}
          onSelectFile={vi.fn()}
          {...actions}
          fileOperation={{
            status: "error",
            operation: "rename_file",
            path: "readme.md",
            message: '"taken.md" already exists',
            requestId: "fileop:1",
          }}
        />,
      );

      expect(screen.getByText('"taken.md" already exists')).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Rename readme.md" })).toHaveValue("taken.md");
    });

    it("sends one delete request only after confirmation", () => {
      const actions = handlers();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      setup(actions);

      choose("readme.md", /^Delete/);

      expect(confirm).toHaveBeenCalledWith('Delete "readme.md"?');
      expect(actions.onDeleteFile).toHaveBeenCalledTimes(1);
      expect(actions.onDeleteFile).toHaveBeenCalledWith("readme.md");
      confirm.mockRestore();
    });

    it("does not request deletion when confirmation is cancelled", () => {
      const actions = handlers();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      setup(actions);

      choose("readme.md", /^Delete/);

      expect(actions.onDeleteFile).not.toHaveBeenCalled();
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      confirm.mockRestore();
    });

    it("disables lifecycle controls and dragging while an operation is pending", () => {
      setup({
        ...handlers(),
        fileOperation: {
          status: "pending",
          operation: "rename_file",
          path: "other.txt",
          requestId: "fileop:pending",
        },
      });

      expect(screen.getByText("readme.md").closest("button")).toHaveAttribute("draggable", "false");
      openMenu("readme.md");
      expect(menuItem("Open with associated app")).toBeDisabled();
      expect(menuItem(/^Rename/)).toBeDisabled();
      expect(menuItem(/^Delete/)).toBeDisabled();
    });

    it("moves a dragged file onto a writable directory", () => {
      const actions = handlers();
      setup(actions);
      const stored = new Map<string, string>();
      const dataTransfer = {
        types: ["application/x-pi-outpost-file"],
        effectAllowed: "none",
        dropEffect: "none",
        setData: (type: string, value: string) => stored.set(type, value),
        getData: (type: string) => stored.get(type) ?? "",
      };
      const fileRow = screen.getByText("readme.md").closest("[draggable='true']")!;
      const directoryRow = dirToggle("src").parentElement!;

      fireEvent.dragStart(fileRow, { dataTransfer });
      fireEvent.dragOver(directoryRow, { dataTransfer });
      fireEvent.drop(directoryRow, { dataTransfer });

      expect(actions.onMoveFile).toHaveBeenCalledWith("readme.md", "src");
      expect(actions.onCopyFile).not.toHaveBeenCalled();
    });

    it("copies a dragged read-only file onto a writable directory", () => {
      const actions = handlers();
      setup({ ...actions, writableRoot: "src" });
      const stored = new Map<string, string>();
      const types = ["application/x-pi-outpost-file"];
      const dataTransfer = {
        types,
        effectAllowed: "none",
        dropEffect: "none",
        setData: (type: string, value: string) => {
          stored.set(type, value);
          if (!types.includes(type)) types.push(type);
        },
        getData: (type: string) => stored.get(type) ?? "",
      };
      const fileRow = screen.getByText("readme.md").closest("[draggable='true']")!;
      const directoryRow = dirToggle("src").parentElement!;

      fireEvent.dragStart(fileRow, { dataTransfer });
      expect(dataTransfer.effectAllowed).toBe("copy");
      fireEvent.dragOver(directoryRow, { dataTransfer });
      expect(dataTransfer.dropEffect).toBe("copy");
      fireEvent.drop(directoryRow, { dataTransfer });

      expect(actions.onCopyFile).toHaveBeenCalledWith("readme.md", "src");
      expect(actions.onMoveFile).not.toHaveBeenCalled();
    });

    it("does not accept a drop on a read-only directory", () => {
      const actions = handlers();
      setup({ ...actions, tree: { "": [dir("src"), dir("readonly")] }, writableRoot: "src" });
      const dataTransfer = {
        types: ["application/x-pi-outpost-file"],
        effectAllowed: "move",
        dropEffect: "none",
        setData: vi.fn(),
        getData: () => "src/main.ts",
      };

      fireEvent.drop(dirToggle("readonly").parentElement!, { dataTransfer });

      expect(actions.onMoveFile).not.toHaveBeenCalled();
    });

    it("shows a non-rename operation failure in the tree", () => {
      setup({
        ...handlers(),
        fileOperation: {
          status: "error",
          operation: "move_file",
          path: "readme.md",
          message: "destination already exists",
          requestId: "fileop:2",
        },
      });

      expect(screen.getByRole("alert")).toHaveTextContent("destination already exists");
    });
  });
});

describe("creating", () => {
  const creators = () => ({ onCreateFile: vi.fn(), onCreateDirectory: vi.fn() });

  /** Open the input inside `src`, which the fixture already has a listing for. */
  function openInputInSrc(extra: Partial<Props> = {}) {
    const handlers = creators();
    render(
      <FileTree
        tree={tree()}
        onExpand={vi.fn()}
        onSelectFile={vi.fn()}
        {...handlers}
        {...extra}
      />,
    );
    choose("src", "New file…");
    return { ...handlers, input: screen.getByRole("textbox", { name: /New file in src/ }) };
  }

  /** The tree with both creation callbacks, nothing opened yet. */
  function creatorsRendered() {
    const handlers = creators();
    render(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} {...handlers} />);
    return handlers;
  }

  it("a folder's menu offers New file… and New folder…, and the root has a control for each", () => {
    const { onCreateDirectory } = creatorsRendered();
    openMenu("src");
    expect(menuItem("New file…")).toBeInTheDocument();
    expect(menuItem("New folder…")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "New folder in the workspace root" }));
    const input = screen.getByRole("textbox", { name: "New folder in the workspace root" });
    fireEvent.change(input, { target: { value: "notes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateDirectory).toHaveBeenCalledWith("notes");
    expect(screen.getByRole("button", { name: "New file in the workspace root" })).toBeInTheDocument();
  });

  it("New file… refuses a name ending in a slash, instead of making a folder of it", () => {
    const { onCreateFile, onCreateDirectory, input } = openInputInSrc();
    expect(input).toHaveAttribute("placeholder", "file name");
    fireEvent.change(input, { target: { value: "widgets/" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("A file name cannot end with /")).toBeInTheDocument();
    expect(onCreateFile).not.toHaveBeenCalled();
    expect(onCreateDirectory).not.toHaveBeenCalled();
  });

  it("offers no creation control without a creation callback", () => {
    render(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} onRevealNative={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /New (file|folder)/ })).toBeNull();
    openMenu("src");
    expect(queryMenuItem(/^New (file|folder)…/)).toBeNull();
  });

  it("ReadOnlyDirectoryOffersNothing: no creation item on a directory outside the writable zone", () => {
    render(
      <FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} writableRoot="other" onRevealNative={vi.fn()} {...creators()} />,
    );

    openMenu("src");
    expect(queryMenuItem(/^New (file|folder)…/)).toBeNull();
  });

  it("offers nothing at all when the sandbox is read-only — a folder with no action has no ⋯ either", () => {
    render(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} writableRoot={null} {...creators()} />);

    expect(screen.queryByRole("button", { name: /New (file|folder)/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for src" })).toBeNull();
  });

  it("reports the joined path for a file", () => {
    const { onCreateFile, onCreateDirectory, input } = openInputInSrc();

    fireEvent.change(input, { target: { value: "helper.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateFile).toHaveBeenCalledWith("src/helper.ts");
    expect(onCreateDirectory).not.toHaveBeenCalled();
  });

  it("New folder… creates a folder, the name typed plainly (a trailing slash tolerated)", () => {
    const { onCreateFile, onCreateDirectory } = creatorsRendered();
    choose("src", "New folder…");
    const input = screen.getByRole("textbox", { name: "New folder in src" });

    fireEvent.change(input, { target: { value: "widgets/" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateDirectory).toHaveBeenCalledWith("src/widgets");
    expect(onCreateFile).not.toHaveBeenCalled();
  });

  it("creates at the workspace root from the header control", () => {
    const handlers = creators();
    render(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "New file in the workspace root" }));
    const input = screen.getByRole("textbox", { name: /workspace root/ });
    fireEvent.change(input, { target: { value: "notes.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(handlers.onCreateFile).toHaveBeenCalledWith("notes.md");
  });

  it("refuses a name that is a path, without asking the server", () => {
    const { onCreateFile, input } = openInputInSrc();

    fireEvent.change(input, { target: { value: "deep/helper.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateFile).not.toHaveBeenCalled();
    expect(screen.getByText("That is a path, not a name")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /New file in src/ })).toHaveValue("deep/helper.ts");
  });

  it("refuses an empty name", () => {
    const { onCreateFile, input } = openInputInSrc();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateFile).not.toHaveBeenCalled();
    expect(screen.getByText("A name is required")).toBeInTheDocument();
  });

  it("keeps the typed name when the server refuses it", () => {
    const { input } = openInputInSrc({
      createError: { path: "src/taken.ts", message: '"src/taken.ts" already exists' },
    });

    fireEvent.change(input, { target: { value: "taken.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText('"src/taken.ts" already exists')).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /New file in src/ })).toHaveValue("taken.ts");
  });

  it("shows nothing for a refusal of some other path", () => {
    const { input } = openInputInSrc({
      createError: { path: "elsewhere/other.ts", message: "already exists" },
    });

    fireEvent.change(input, { target: { value: "mine.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.queryByText("already exists")).toBeNull();
  });

  it("closes the input when the creation actually happened", () => {
    const handlers = creators();
    const { rerender } = render(
      <FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} {...handlers} />,
    );
    choose("src", "New file…");
    const input = screen.getByRole("textbox", { name: /New file in src/ });
    fireEvent.change(input, { target: { value: "helper.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // What the server answers: the creation happened, and at which path
    rerender(
      <FileTree
        tree={tree({ src: [file("main.ts"), file("helper.ts"), dir("nested")] })}
        onExpand={vi.fn()}
        onSelectFile={vi.fn()}
        created="src/helper.ts"
        {...handlers}
      />,
    );

    expect(screen.queryByRole("textbox", { name: /New file in src/ })).toBeNull();
  });

  it("does not read a listing that already holds the name as success", () => {
    // The refused-duplicate case: the name is in the listing precisely because
    // the server refused it. Closing the input here would swallow the refusal.
    const handlers = creators();
    const existing = { src: [file("main.ts"), file("taken.ts"), dir("nested")] };
    const { rerender } = render(
      <FileTree tree={tree(existing)} onExpand={vi.fn()} onSelectFile={vi.fn()} {...handlers} />,
    );
    choose("src", "New file…");
    const input = screen.getByRole("textbox", { name: /New file in src/ });
    fireEvent.change(input, { target: { value: "taken.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    rerender(
      <FileTree
        tree={tree(existing)}
        onExpand={vi.fn()}
        onSelectFile={vi.fn()}
        createError={{ path: "src/taken.ts", message: '"src/taken.ts" already exists' }}
        {...handlers}
      />,
    );

    expect(screen.getByRole("textbox", { name: /New file in src/ })).toHaveValue("taken.ts");
    expect(screen.getByText('"src/taken.ts" already exists')).toBeInTheDocument();
  });

  it("cancels on Escape without reporting anything", () => {
    const { onCreateFile, onCreateDirectory, input } = openInputInSrc();

    fireEvent.change(input, { target: { value: "helper.ts" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCreateFile).not.toHaveBeenCalled();
    expect(onCreateDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: /New file in src/ })).toBeNull();
  });
});

describe("refreshing", () => {
  it("offers a refresh control when one is wired", () => {
    const onRefresh = vi.fn();
    setup({ onRefresh });

    fireEvent.click(screen.getByRole("button", { name: "Refresh the file tree" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("offers it on a read-only tree too", () => {
    // The safety net cannot be conditional on anything the user would have to
    // diagnose first: a watcher that reports nothing looks exactly like a
    // workspace that did not change, and a read-only workspace still moves
    // underneath you.
    setup({ onRefresh: vi.fn(), writableRoot: null, onCreateFile: vi.fn() });

    expect(screen.getByRole("button", { name: "Refresh the file tree" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New (file|folder) in the workspace root/ })).toBeNull();
  });

  it("offers none when no refresh callback is supplied", () => {
    setup();

    expect(screen.queryByRole("button", { name: "Refresh the file tree" })).toBeNull();
  });
});


describe("external file imports", () => {
  const transfer = (files: File[]) => ({ types: ["Files"], files, items: [], dropEffect: "none" });
  it("ImportIntoAFolder: imports bytes and shows the saved path", async () => {
    const onUploadFile = vi.fn(async () => "src/scan.pdf");
    setup({ onUploadFile });
    const target = dirToggle("src").parentElement!;
    const dataTransfer = transfer([new File([new Uint8Array([0, 255])], "scan.pdf")]);
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(target).toHaveClass("ring-1");
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledWith("scan.pdf", "AP8=", "src"));
    await waitFor(() => expect(screen.getByText("Imported: src/scan.pdf")).toBeInTheDocument());
    expect(screen.queryByText("Importing files…")).toBeNull();
  });
  it("ImportIntoTheRoot: sends an empty destination explicitly", async () => {
    const onUploadFile = vi.fn(async () => "note.txt");
    setup({ onUploadFile });
    fireEvent.drop(screen.getByText("Workspace root"), { dataTransfer: transfer([new File(["a"], "note.txt")]) });
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledWith("note.txt", "YQ==", ""));
  });
  it("ReadOnlyDropIsNotAnAttachment: consumes the drop without uploading", () => {
    const onUploadFile = vi.fn();
    const onDrop = vi.fn();
    render(<div onDrop={onDrop}><FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} writableRoot={null} onUploadFile={onUploadFile} /></div>);
    const dataTransfer = transfer([new File(["a"], "note.txt")]);
    const target = dirToggle("src").parentElement!;
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("none");
    fireEvent.drop(target, { dataTransfer });
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });
  it("ImportReportsIndividualFailures: refuses size before reading and continues the batch", async () => {
    const large = new File(["x"], "large.bin");
    Object.defineProperty(large, "size", { value: 25 * 1024 * 1024 + 1 });
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const onUploadFile = vi.fn(async () => "src/ok.txt");
    setup({ onUploadFile });
    fireEvent.drop(dirToggle("src").parentElement!, { dataTransfer: transfer([large, new File(["ok"], "ok.txt")]) });
    await waitFor(() => expect(screen.getByText("Imported: src/ok.txt")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("large.bin: Files are limited to 25 MB");
    expect(read).toHaveBeenCalledTimes(1);
    expect(onUploadFile).toHaveBeenCalledTimes(1);
    read.mockRestore();
  });
  it("FolderDropsAreRefused: never uploads a directory placeholder", () => {
    const onUploadFile = vi.fn();
    setup({ onUploadFile });
    fireEvent.drop(dirToggle("src").parentElement!, { dataTransfer: { types: ["Files"], files: [], items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => new File([], "folder") }] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Folders cannot be imported");
    expect(onUploadFile).not.toHaveBeenCalled();
  });
  it("does not start duplicate batches while an import is pending", async () => {
    let finish!: (path: string) => void;
    const onUploadFile = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    setup({ onUploadFile });
    const target = dirToggle("src").parentElement!;
    const dataTransfer = transfer([new File(["a"], "note.txt")]);
    fireEvent.drop(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Importing files…")).toBeInTheDocument();
    await act(async () => finish("src/note.txt"));
    await waitFor(() => expect(screen.queryByText("Importing files…")).toBeNull());
  });
  it("continues after a server refusal and releases the batch for a later drop", async () => {
    const onUploadFile = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce("src/ok.txt").mockResolvedValueOnce("src/later.txt");
    setup({ onUploadFile });
    const target = dirToggle("src").parentElement!;
    fireEvent.drop(target, { dataTransfer: transfer([new File(["a"], "bad.txt"), new File(["b"], "ok.txt")]) });
    await waitFor(() => expect(screen.getByText("Imported: src/ok.txt")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("bad.txt: disk full");
    expect(onUploadFile).toHaveBeenCalledTimes(2);
    fireEvent.drop(target, { dataTransfer: transfer([new File(["c"], "later.txt")]) });
    await waitFor(() => expect(screen.getByText("Imported: src/later.txt")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("stops the remaining batch when its workspace is no longer active", async () => {
    const onUploadFile = vi.fn().mockRejectedValue(new UploadContextChangedError());
    setup({ onUploadFile });
    fireEvent.drop(dirToggle("src").parentElement!, { dataTransfer: transfer([new File(["a"], "first.txt"), new File(["b"], "second.txt")]) });
    await waitFor(() => expect(screen.queryByText("Importing files…")).toBeNull());
    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("first.txt: The workspace changed");
  });
  it("clears root and folder hover feedback when a drag leaves their boundaries", () => {
    setup({ onUploadFile: vi.fn() });
    const dataTransfer = transfer([new File(["a"], "note.txt")]);
    for (const target of [screen.getByText("Workspace root"), dirToggle("src").parentElement!]) {
      fireEvent.dragOver(target, { dataTransfer });
      expect(target).toHaveClass("ring-1");
      fireEvent.dragLeave(target, { dataTransfer, relatedTarget: document.body });
      expect(target).not.toHaveClass("ring-1");
    }
  });

});

// ---------------------------------------------------------------------------
// The actions menu, folders at parity, selection, picking
// ---------------------------------------------------------------------------

/** Every callback wired, so each menu holds everything its entries can take. */
function everything(overrides: Partial<Props> = {}) {
  const handlers = {
    onExpand: vi.fn(),
    onSelectFile: vi.fn(),
    onSelectDiff: vi.fn(),
    onToggleAttachPath: vi.fn(),
    onOpenNative: vi.fn(),
    onRevealNative: vi.fn(),
    onRenameFile: vi.fn(),
    onDeleteFile: vi.fn(),
    onMoveFile: vi.fn(),
    onCopyFile: vi.fn(),
    onDeleteFiles: vi.fn(),
    onMoveFiles: vi.fn(),
    onCreateFile: vi.fn(),
    onCreateDirectory: vi.fn(),
    onDownload: vi.fn(async () => ({ skipped: 0 })),
    onRestoreDeleted: vi.fn(),
  };
  const view = render(<FileTree tree={tree()} {...handlers} {...overrides} />);
  return { ...handlers, ...view };
}

/** The names of the rows the selection highlights, in display order. */
const selectedNames = () =>
  Array.from(document.querySelectorAll('[data-selected="true"]')).map((row) => row.querySelector("[title]")!.getAttribute("title"));
const label = (name: string) => screen.getByText(name).closest("button")!;
/** A menu item as it is seen: its symbol, then the accessible name it is chosen by. */
const symbolAndName = (item: HTMLElement) =>
  `${item.querySelector("[aria-hidden]")?.textContent ?? ""} ${item.getAttribute("aria-label") ?? within(item).getByText(/\w/, { selector: "span:not([aria-hidden])" }).textContent}`;
const flat = { "": [file("a"), file("b"), file("c"), file("d")] };

describe("the actions menu", () => {
  it("TheRowKeepsTheAtAndItsStates: the @, the git badge and ⋯, nothing else, on files and folders", () => {
    everything({ attachedPaths: ["readme.md"], gitFiles: { "readme.md": "modified" } });
    const names = (row: HTMLElement) => within(row).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names(label("readme.md").parentElement!)).toEqual([
      "readme.md",
      "Remove readme.md from the prompt",
      "Show diff of readme.md",
      "Actions for readme.md",
    ]);
    expect(names(dirToggle("src").parentElement!).slice(1)).toEqual(["Reference src in the prompt", "Actions for src"]);
  });

  it("each menu item carries the symbol of its action", () => {
    everything({ attachedPaths: ["readme.md"] });
    openMenu("readme.md");
    expect(symbolAndName(menuItem("Remove from prompt"))).toBe("@ Remove from prompt");
    expect(symbolAndName(menuItem("Show in file manager"))).toBe("⌂ Show in file manager");
  });

  it("AFileRowsMenuInItsOrder: the rendered menu reads its groups in order", () => {
    everything({ gitFiles: { "readme.md": "modified" } });
    const menu = openMenu("readme.md");
    expect(within(menu).getAllByRole("group").map((group) => within(group).getAllByRole("menuitem").map(symbolAndName))).toEqual([
      ["↵ Open", "± Show diff", "↗ Open with associated app", "⌂ Show in file manager"],
      ["@ Reference in prompt", "⤓ Download"],
      ["✎ Rename…", "→ Move to…"],
      ["× Delete…"],
    ]);
  });

  it("TheContextMenuOpensTheSameMenu: a right-click opens it instead of the browser's own", () => {
    everything();
    // fireEvent answers false when a handler prevented the default: the browser's menu.
    expect(fireEvent.contextMenu(label("readme.md"), { clientX: 30, clientY: 40 })).toBe(false);
    expect(screen.getByRole("menu", { name: "Actions for readme.md" })).toBeInTheDocument();
    expect(menuItem("Open")).toBeInTheDocument();
  });

  it("OneMenuAtATime: opening another row's menu replaces the first; a new project closes it", () => {
    const { rerender, ...handlers } = everything();
    openMenu("readme.md");
    openMenu("src");
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu", { name: "Actions for src" })).toBeInTheDocument();

    rerender(<FileTree tree={{}} onExpand={handlers.onExpand} onSelectFile={handlers.onSelectFile} onRevealNative={handlers.onRevealNative} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("TheMenuIsAKeyboardMenu: Escape closes it and focus returns to the row's ⋯", () => {
    everything();
    const menu = openMenu("readme.md");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Actions for readme.md" })).toHaveFocus();
  });

  it("CreateDirectoryFromTree: the created folder appears expanded, and no file is opened", () => {
    const { onCreateDirectory, onSelectFile, rerender, ...rest } = everything();
    choose("src", "New folder…");
    const input = screen.getByRole("textbox", { name: "New folder in src" });
    expect(input).toHaveAttribute("placeholder", "folder name");
    fireEvent.change(input, { target: { value: "widgets" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateDirectory).toHaveBeenCalledWith("src/widgets");

    rerender(
      <FileTree
        {...rest}
        onCreateDirectory={onCreateDirectory}
        onSelectFile={onSelectFile}
        tree={tree({ src: [file("main.ts"), dir("nested"), dir("widgets")], "src/widgets": [] })}
        created="src/widgets"
      />,
    );
    expect(dirToggle("widgets")).toHaveTextContent("▾");
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it("CreateFileFromTree: New file… opens the input inside the folder", () => {
    const { onCreateFile } = everything();
    choose("src", "New file…");
    const input = screen.getByRole("textbox", { name: "New file in src" });
    fireEvent.change(input, { target: { value: "util.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateFile).toHaveBeenCalledWith("src/util.ts");
  });

  it("TheRootsOfferNoRemoval: the writable root's own folder cannot be renamed, moved or deleted", () => {
    everything({ writableRoot: "src" });
    openMenu("src");
    expect(queryMenuItem(/^Rename/)).toBeNull();
    expect(queryMenuItem(/^Move/)).toBeNull();
    expect(queryMenuItem(/^Delete/)).toBeNull();
    expect(menuItem("New file…")).toBeInTheDocument();
    expect(menuItem("New folder…")).toBeInTheDocument();
  });
});

describe("folders at parity", () => {
  it("AFolderRowsMenu: a writable folder offers everything a file does that a folder can take", () => {
    everything();
    const menu = openMenu("src");
    expect(within(menu).getAllByRole("menuitem").map(symbolAndName)).toEqual([
      "+ New file…",
      "⊞ New folder…",
      "⌂ Show in file manager",
      "@ Reference in prompt",
      "⤓ Download as .zip",
      "✎ Rename…",
      "→ Move to…",
      "× Delete…",
    ]);
  });

  it("renames a folder in place, a trailing slash allowed", () => {
    const { onRenameFile } = everything();
    choose("src", /^Rename/);
    const input = screen.getByRole("textbox", { name: "Rename src" });
    fireEvent.change(input, { target: { value: "lib/" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameFile).toHaveBeenCalledWith("src", "lib");
  });

  it("ConfirmAFolderDeletion: the confirmation says its content goes with it", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDeleteFile } = everything();
    choose("src", /^Delete/);
    expect(confirm).toHaveBeenCalledWith('Delete the folder "src" and everything in it?');
    expect(onDeleteFile).toHaveBeenCalledWith("src");
    confirm.mockRestore();
  });

  it("DragAFolderOntoAWritableFolder: it moves there, and never into one of its own subfolders", () => {
    const { onMoveFile } = everything({ tree: { "": [dir("drafts"), dir("archive")], drafts: [dir("inner")], archive: [] } });
    const stored = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: "none",
      dropEffect: "none",
      setData: (type: string, value: string) => {
        stored.set(type, value);
        dataTransfer.types.push(type);
      },
      getData: (type: string) => stored.get(type) ?? "",
    };
    fireEvent.click(dirToggle("drafts"));
    fireEvent.dragStart(dirToggle("drafts"), { dataTransfer });

    const inner = dirToggle("inner").parentElement!;
    fireEvent.dragOver(inner, { dataTransfer });
    expect(inner).not.toHaveClass("ring-1");
    fireEvent.drop(inner, { dataTransfer });
    expect(onMoveFile).not.toHaveBeenCalled();

    const archive = dirToggle("archive").parentElement!;
    fireEvent.dragOver(archive, { dataTransfer });
    fireEvent.drop(archive, { dataTransfer });
    expect(onMoveFile).toHaveBeenCalledWith("drafts", "archive");
  });

  it("a read-only folder dropped on a writable one is copied", () => {
    const { onCopyFile } = everything({ tree: { "": [dir("reference"), dir("work")], work: [] }, writableRoot: "work" });
    const stored = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: "none",
      dropEffect: "none",
      setData: (type: string, value: string) => {
        stored.set(type, value);
        dataTransfer.types.push(type);
      },
      getData: (type: string) => stored.get(type) ?? "",
    };
    fireEvent.dragStart(dirToggle("reference"), { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe("copy");
    fireEvent.drop(dirToggle("work").parentElement!, { dataTransfer });
    expect(onCopyFile).toHaveBeenCalledWith("reference", "work");
  });

  it("reports a folder copy that left entries out", () => {
    everything({ fileOperation: { status: "succeeded", operation: "copy_file", path: "reference", resultPath: "work/reference", requestId: "fileop:1", skipped: 2 } });
    expect(screen.getByRole("status")).toHaveTextContent("2 entries were left out of the copy");
  });
});

describe("multi-selection", () => {
  it("ShiftClickSelectsARange: from the anchor to the clicked row, without opening anything", () => {
    const { onSelectFile } = everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("c"), { shiftKey: true });
    expect(selectedNames()).toEqual(["a", "b", "c"]);
    expect(onSelectFile).toHaveBeenCalledTimes(1);
  });

  it("CtrlClickTogglesOneFile: Ctrl or Cmd adds and removes one row", () => {
    everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("b"), { ctrlKey: true });
    expect(selectedNames()).toEqual(["a", "b"]);
    fireEvent.click(label("b"), { metaKey: true });
    fireEvent.click(label("d"), { ctrlKey: true });
    expect(selectedNames()).toEqual(["a", "d"]);
  });

  it("EscapeClearsTheSelection", () => {
    everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("c"), { shiftKey: true });
    fireEvent.keyDown(label("b"), { key: "Escape" });
    expect(selectedNames()).toEqual([]);
  });

  it("ARangeIncludesVisibleFoldersOnly: folder rows count, a collapsed folder's entries do not", () => {
    const { onExpand } = everything({
      tree: { "": [file("a"), dir("open"), dir("shut"), file("z")], open: [file("b")], shut: [file("hidden")] },
    });
    fireEvent.click(dirToggle("open"));
    fireEvent.click(label("a"));
    fireEvent.click(label("z"), { shiftKey: true });
    expect(selectedNames()).toEqual(["a", "open", "b", "shut", "z"]);
    // Selecting a folder with a modifier neither expands nor fetches it.
    fireEvent.click(dirToggle("shut"), { ctrlKey: true });
    expect(screen.queryByText("hidden")).toBeNull();
    expect(onExpand).not.toHaveBeenCalledWith("shut");
  });

  it("ASelectionDoesNotOutliveItsFiles: a deleted file leaves it, another project clears it", () => {
    const { rerender, ...handlers } = everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("c"), { shiftKey: true });
    rerender(<FileTree {...handlers} tree={{ "": [file("a"), file("c"), file("d")] }} />);
    expect(selectedNames()).toEqual(["a", "c"]);
    rerender(<FileTree {...handlers} tree={{}} />);
    rerender(<FileTree {...handlers} tree={flat} />);
    expect(selectedNames()).toEqual([]);
  });
});

describe("acting on a selection", () => {
  it("DeleteASelectionWithOneConfirmation: one confirmation naming the count, one batch request", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDeleteFiles, onDeleteFile } = everything();
    fireEvent.click(label("readme.md"));
    fireEvent.click(dirToggle("src"), { ctrlKey: true });
    choose("readme.md", "Delete 2 items…");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Delete 2 items? The folder is deleted with everything in it.");
    expect(onDeleteFiles).toHaveBeenCalledWith(["readme.md", "src"]);
    expect(onDeleteFile).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("ASelectedFolderCoversItsContent: a selected file inside a selected folder is not acted on twice", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDeleteFile, onDeleteFiles } = everything();
    fireEvent.click(dirToggle("src"));
    fireEvent.click(dirToggle("src"), { ctrlKey: true });
    fireEvent.click(label("main.ts"), { ctrlKey: true });
    expect(selectedNames()).toEqual(["src", "main.ts"]);
    expect(screen.getByRole("toolbar", { name: "1 selected" })).toBeInTheDocument();
    choose("main.ts", /^Delete/);
    expect(onDeleteFile).toHaveBeenCalledWith("src");
    expect(onDeleteFiles).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("ExpandingAFolderDoesNotSelectIt: files Ctrl-clicked inside a folder just opened are deleted alone", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDeleteFiles, onDeleteFile } = everything({ tree: { "": [dir("box"), file("other")], box: [file("one"), file("two"), file("three")] } });
    fireEvent.click(dirToggle("box"));
    fireEvent.click(label("one"), { ctrlKey: true });
    fireEvent.click(label("three"), { ctrlKey: true });
    expect(selectedNames()).toEqual(["one", "three"]);
    expect(screen.getByRole("toolbar", { name: "2 selected" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Delete 2 items…" }));
    expect(onDeleteFiles).toHaveBeenCalledWith(["box/one", "box/three"]);
    expect(onDeleteFile).not.toHaveBeenCalledWith("box");
    confirm.mockRestore();
  });

  it("DownloadASelectionAsOneArchive, and a single file or folder downloads as itself or a zip", async () => {
    const { onDownload } = everything();
    choose("readme.md", "Download");
    choose("src", "Download as .zip");
    fireEvent.click(label("readme.md"));
    fireEvent.click(dirToggle("src"), { ctrlKey: true });
    choose("src", "Download 2 items as .zip");
    expect(onDownload.mock.calls).toEqual([
      [["readme.md"], true],
      [["src"], false],
      [["readme.md", "src"], false],
    ]);
  });

  it("ATooLargeFolderIsRefusedUpFront, on the tree: the refusal is shown, and a left-out count too", async () => {
    const onDownload = vi
      .fn()
      .mockRejectedValueOnce(new Error("More than 65535 entries: too many for one archive — download a subfolder instead"))
      .mockResolvedValueOnce({ skipped: 1 });
    everything({ onDownload });
    choose("src", "Download as .zip");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("More than 65535 entries"));
    choose("src", "Download as .zip");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 entry was left out of the archive"));
  });

  it("TheMenuOfAnUnselectedRowActsOnThatRow: the selection becomes that row", () => {
    everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("b"), { shiftKey: true });
    const menu = openMenu("d");
    expect(menu).toHaveAccessibleName("Actions for d");
    expect(menuItem("Delete…")).toBeInTheDocument();
    // `d` alone — shown now that a single selected row is highlighted too.
    expect(selectedNames()).toEqual(["d"]);
  });

  it("AMixedSelectionOffersNoMutation: a read-only entry in it takes Delete and Move away", () => {
    everything({ writableRoot: "src" });
    fireEvent.click(dirToggle("src"));
    fireEvent.click(label("main.ts"));
    fireEvent.click(label("readme.md"), { ctrlKey: true });
    openMenu("main.ts");
    expect(queryMenuItem(/^Delete/)).toBeNull();
    expect(queryMenuItem(/^Move/)).toBeNull();
    expect(menuItem("Download 2 items as .zip")).toBeInTheDocument();
    expect(menuItem("Reference 2 items in prompt")).toBeInTheDocument();
  });

  it("DragASelectionOntoAFolder: dropping one selected row moves them all in one request", () => {
    const { onMoveFiles, onMoveFile } = everything({ tree: { "": [dir("src"), file("readme.md"), file("notes.md")], src: [] } });
    fireEvent.click(label("readme.md"));
    fireEvent.click(label("notes.md"), { ctrlKey: true });
    const stored = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: "none",
      dropEffect: "none",
      setData: (type: string, value: string) => {
        stored.set(type, value);
        dataTransfer.types.push(type);
      },
      getData: (type: string) => stored.get(type) ?? "",
    };
    fireEvent.dragStart(label("readme.md"), { dataTransfer });
    fireEvent.dragOver(dirToggle("src").parentElement!, { dataTransfer });
    fireEvent.drop(dirToggle("src").parentElement!, { dataTransfer });
    expect(onMoveFiles).toHaveBeenCalledWith(["readme.md", "notes.md"], "src");
    expect(onMoveFile).not.toHaveBeenCalled();
  });

  it("ReferenceASelection: each selected entry is referenced once, the one already referenced left alone", () => {
    const { onToggleAttachPath } = everything({ tree: flat, attachedPaths: ["b"] });
    fireEvent.click(label("a"));
    fireEvent.click(label("c"), { shiftKey: true });
    choose("a", "Reference 3 items in prompt");
    expect(onToggleAttachPath.mock.calls).toEqual([["a"], ["c"]]);
  });

  it("KeyboardShortcutsOnTheSelection: Delete asks the same single confirmation, F2 renames one entry", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDeleteFiles } = everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("b"), { shiftKey: true });
    fireEvent.keyDown(label("a"), { key: "Delete" });
    expect(confirm).toHaveBeenCalledWith("Delete 2 items?");
    expect(onDeleteFiles).toHaveBeenCalledWith(["a", "b"]);

    fireEvent.click(label("c"));
    fireEvent.keyDown(label("c"), { key: "F2" });
    expect(screen.getByRole("textbox", { name: "Rename c" })).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("TheTreeReportsWhatWasRefused: a batch with refusals says how many were done and why the others were not", () => {
    everything({
      fileOperation: {
        status: "error",
        operation: "move_file",
        path: "a",
        requestId: "fileop:1",
        message: '2 of 3 moved. Not moved: outside/b.txt: "outside/b.txt" is outside the writable zone',
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent('2 of 3 moved. Not moved: outside/b.txt: "outside/b.txt" is outside the writable zone');
  });
});

describe("the selection bar", () => {
  const bar = () => screen.queryByRole("toolbar");
  const barButtons = () => within(screen.getByRole("toolbar")).getAllByRole("button").map((button) => button.getAttribute("aria-label"));

  it("TheBarAppearsWithASelection: it counts, and holds what the selection's menu holds", () => {
    everything({ tree: flat });
    fireEvent.click(label("a"));
    expect(bar()).toBeNull();
    fireEvent.click(label("b"), { ctrlKey: true });
    expect(screen.getByRole("toolbar", { name: "2 selected" })).toHaveTextContent("2 selected");
    fireEvent.click(label("c"), { ctrlKey: true });
    expect(screen.getByRole("toolbar", { name: "3 selected" })).toBeInTheDocument();
    expect(barButtons()).toEqual([
      "Reference 3 items in prompt",
      "Download 3 items as .zip",
      "Move 3 items to…",
      "Delete 3 items…",
      "Clear the selection",
    ]);
    openMenu("b");
    expect(screen.getAllByRole("menuitem").map((item) => item.getAttribute("aria-label") ?? within(item).getByText(/\w/, { selector: "span:not([aria-hidden])" }).textContent)).toEqual(barButtons().slice(0, -1));
  });

  it("DeleteFromTheBar: one confirmation, one batch, and the bar goes away", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDeleteFiles } = everything({ tree: { "": [file("a"), dir("d"), file("z")], d: [] } });
    fireEvent.click(label("a"));
    fireEvent.click(label("z"), { shiftKey: true });
    fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Delete 3 items…" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Delete 3 items? The folder is deleted with everything in it.");
    expect(onDeleteFiles).toHaveBeenCalledWith(["a", "d", "z"]);
    expect(bar()).toBeNull();
    confirm.mockRestore();
  });

  it("the bar's other actions run on the whole selection too", () => {
    const { onDownload, onToggleAttachPath } = everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("b"), { shiftKey: true });
    const toolbar = within(screen.getByRole("toolbar"));
    fireEvent.click(toolbar.getByRole("button", { name: "Download 2 items as .zip" }));
    fireEvent.click(toolbar.getByRole("button", { name: "Reference 2 items in prompt" }));
    fireEvent.click(toolbar.getByRole("button", { name: "Move 2 items to…" }));
    expect(onDownload).toHaveBeenCalledWith(["a", "b"], false);
    expect(onToggleAttachPath.mock.calls).toEqual([["a"], ["b"]]);
    expect(screen.getByRole("status")).toHaveTextContent("Moving 2 items: choose a folder");
    expect(bar()).toBeNull();
  });

  it("TheBarClearsTheSelection", () => {
    everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("c"), { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Clear the selection" }));
    expect(selectedNames()).toEqual([]);
    expect(bar()).toBeNull();
  });

  it("NoBarForOneEntry, and a mixed selection's bar offers no deletion", () => {
    everything({ writableRoot: "src" });
    fireEvent.click(dirToggle("src"));
    fireEvent.click(label("readme.md"));
    expect(bar()).toBeNull();
    fireEvent.click(label("main.ts"), { ctrlKey: true });
    expect(barButtons()).toEqual(["Reference 2 items in prompt", "Download 2 items as .zip", "Clear the selection"]);
  });

  it("stays in view while the tree scrolls", () => {
    everything({ tree: flat });
    fireEvent.click(label("a"));
    fireEvent.click(label("b"), { ctrlKey: true });
    expect(screen.getByRole("toolbar").className).toMatch(/\bsticky\b/);
  });
});

describe("undo of the last change", () => {
  type Operation = NonNullable<Props["fileOperation"]>;
  const moved: Operation = {
    status: "succeeded",
    operation: "move_file",
    path: "inbox/a.txt",
    resultPath: "archive/a.txt",
    requestId: "fileop:move",
    batch: {
      done: [
        { path: "inbox/a.txt", resultPath: "archive/a.txt" },
        { path: "inbox/b.txt", resultPath: "archive/b.txt" },
      ],
      refused: [],
    },
  };
  const projectTree = { "": [dir("inbox"), dir("archive"), file("readme.md")], inbox: [], archive: [file("a.txt"), file("b.txt")] };

  /** Mount the tree, then answer with `operation` the way useAgent would. */
  function after(operation: Operation) {
    const view = everything({ tree: projectTree });
    const { rerender, ...handlers } = view;
    const answer = (next: Operation | null) => rerender(<FileTree {...handlers} tree={projectTree} fileOperation={next} />);
    answer(operation);
    return { ...view, answer };
  }
  const undoButton = () => screen.queryByRole("button", { name: "Undo" });

  it("UndoAMove and AnUndoIsNotUndone: one move back, then the move is said undone and nothing more is offered", () => {
    const { onMoveFiles, answer } = after(moved);
    expect(screen.getByText("Moved 2 items to archive")).toBeInTheDocument();
    fireEvent.click(undoButton()!);
    expect(onMoveFiles).toHaveBeenCalledWith(["archive/a.txt", "archive/b.txt"], "inbox");

    answer({ status: "pending", operation: "move_file", path: "archive/a.txt", requestId: "fileop:undo", paths: ["archive/a.txt", "archive/b.txt"] });
    answer({ ...moved, requestId: "fileop:undo", batch: { done: [{ path: "archive/a.txt", resultPath: "inbox/a.txt" }, { path: "archive/b.txt", resultPath: "inbox/b.txt" }], refused: [] } });
    expect(screen.getByText("Move undone.")).toBeInTheDocument();
    expect(undoButton()).toBeNull();
  });

  it("UndoPutsEachBackWhereItCameFrom: one folder of origin at a time, the next once the first is answered", () => {
    const { onMoveFile, answer } = after({
      ...moved,
      batch: { done: [{ path: "x/one.txt", resultPath: "archive/one.txt" }, { path: "y/two.txt", resultPath: "archive/two.txt" }], refused: [] },
    });
    fireEvent.click(undoButton()!);
    expect(onMoveFile.mock.calls).toEqual([["archive/one.txt", "x"]]);

    answer({ status: "pending", operation: "move_file", path: "archive/one.txt", requestId: "fileop:undo-1" });
    expect(onMoveFile).toHaveBeenCalledTimes(1);
    answer({ status: "succeeded", operation: "move_file", path: "archive/one.txt", resultPath: "x/one.txt", requestId: "fileop:undo-1" });
    expect(onMoveFile.mock.calls).toEqual([["archive/one.txt", "x"], ["archive/two.txt", "y"]]);

    answer({ status: "pending", operation: "move_file", path: "archive/two.txt", requestId: "fileop:undo-2" });
    answer({ status: "succeeded", operation: "move_file", path: "archive/two.txt", resultPath: "y/two.txt", requestId: "fileop:undo-2" });
    expect(screen.getByText("Move undone.")).toBeInTheDocument();
    expect(undoButton()).toBeNull();
  });

  it("UndoByKeyboard: Cmd+Z, or Ctrl+Z, in the tree undoes it", () => {
    const { onMoveFiles } = after(moved);
    fireEvent.keyDown(label("readme.md"), { key: "z", metaKey: true });
    expect(onMoveFiles).toHaveBeenCalledWith(["archive/a.txt", "archive/b.txt"], "inbox");
  });

  it("Ctrl+Z while typing a name stays the input's own undo", () => {
    const { onMoveFiles } = after(moved);
    choose("readme.md", /^Rename/);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename readme.md" }), { key: "z", ctrlKey: true });
    expect(onMoveFiles).not.toHaveBeenCalled();
  });

  it("UndoIsOfferedForTheLastMoveOnly: another operation, or a dismissal, takes the offer away", () => {
    const { answer } = after(moved);
    answer({ status: "pending", operation: "reveal_native", path: "readme.md", requestId: "fileop:other" });
    expect(undoButton()).toBeNull();
    answer({ ...moved, requestId: "fileop:move-2" });
    expect(undoButton()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(undoButton()).toBeNull();
  });

  it("AnUndoThatCannotBeDoneSaysWhy: the refusal is shown, and offers no undo of the undo", () => {
    const { answer } = after(moved);
    fireEvent.click(undoButton()!);
    answer({ status: "pending", operation: "move_file", path: "archive/a.txt", requestId: "fileop:undo" });
    answer({
      status: "error",
      operation: "move_file",
      path: "archive/a.txt",
      requestId: "fileop:undo",
      message: '1 of 2 moved. Not moved: archive/b.txt: "inbox/b.txt" already exists',
      batch: { done: [{ path: "archive/a.txt", resultPath: "inbox/a.txt" }], refused: [{ path: "archive/b.txt", message: '"inbox/b.txt" already exists' }] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent('"inbox/b.txt" already exists');
    expect(undoButton()).toBeNull();
  });

  it("UndoARename: renamed back to its old name, and said undone; a refused undo of a rename is shown", () => {
    const { onRenameFile, answer } = after({ status: "succeeded", operation: "rename_file", path: "inbox/draft.md", resultPath: "inbox/final.md", requestId: "fileop:rename" });
    expect(screen.getByText('Renamed "draft.md" to "final.md"')).toBeInTheDocument();
    fireEvent.click(undoButton()!);
    expect(onRenameFile).toHaveBeenCalledWith("inbox/final.md", "draft.md");
    answer({ status: "pending", operation: "rename_file", path: "inbox/final.md", requestId: "fileop:undo" });
    answer({ status: "error", operation: "rename_file", path: "inbox/final.md", requestId: "fileop:undo", message: '"inbox/draft.md" already exists' });
    expect(screen.getByRole("alert")).toHaveTextContent('"inbox/draft.md" already exists');

    const again = after({ status: "succeeded", operation: "rename_file", path: "inbox/draft.md", resultPath: "inbox/final.md", requestId: "fileop:rename-2" });
    fireEvent.click(screen.getAllByRole("button", { name: "Undo" }).at(-1)!);
    again.answer({ status: "pending", operation: "rename_file", path: "inbox/final.md", requestId: "fileop:undo-2" });
    again.answer({ status: "succeeded", operation: "rename_file", path: "inbox/final.md", resultPath: "inbox/draft.md", requestId: "fileop:undo-2" });
    expect(screen.getByText("Rename undone.")).toBeInTheDocument();
  });

  it("UndoADeletion: every restore token in one request, and said undone", () => {
    const { onRestoreDeleted, answer } = after({
      status: "succeeded",
      operation: "delete_file",
      path: "a.txt",
      resultPath: "a.txt",
      requestId: "fileop:delete",
      batch: {
        done: [
          { path: "a.txt", resultPath: "a.txt", restoreToken: "t1" },
          { path: "b.txt", resultPath: "b.txt", restoreToken: "t2" },
          { path: "folder", resultPath: "folder", restoreToken: "t3" },
        ],
        refused: [],
      },
    });
    expect(screen.getByText("Deleted 3 items")).toBeInTheDocument();
    fireEvent.click(undoButton()!);
    expect(onRestoreDeleted).toHaveBeenCalledWith(["t1", "t2", "t3"]);
    answer({ status: "pending", operation: "restore_deleted", path: "", requestId: "fileop:restore" });
    answer({ status: "succeeded", operation: "restore_deleted", path: "", resultPath: "a.txt", requestId: "fileop:restore", batch: { done: [], refused: [] } });
    expect(screen.getByText("Deletion undone.")).toBeInTheDocument();
    expect(undoButton()).toBeNull();
  });

  it("a single deletion is offered back by its own token", () => {
    const { onRestoreDeleted } = after({ status: "succeeded", operation: "delete_file", path: "inbox/note.md", resultPath: "inbox/note.md", requestId: "fileop:d", restoreToken: "tok" });
    expect(screen.getByText('Deleted "note.md"')).toBeInTheDocument();
    fireEvent.keyDown(label("readme.md"), { key: "z", ctrlKey: true });
    expect(onRestoreDeleted).toHaveBeenCalledWith(["tok"]);
  });
});

describe("destination picking", () => {
  const nested = {
    "": [file("a"), file("b"), dir("archive"), dir("project"), dir("reference")],
    archive: [dir("2026")],
    "archive/2026": [],
    project: [dir("sub")],
    "project/sub": [],
    reference: [],
  };

  it("PickADestination: Move to… names what moves; a folder expanded meanwhile is a target", () => {
    const { onMoveFiles } = everything({ tree: nested });
    fireEvent.click(label("a"));
    fireEvent.click(label("b"), { shiftKey: true });
    choose("a", "Move 2 items to…");
    expect(screen.getByRole("status")).toHaveTextContent("Moving 2 items: choose a folder");
    fireEvent.click(dirToggle("archive"));
    fireEvent.click(screen.getByRole("button", { name: "Move here: 2026" }));
    expect(onMoveFiles).toHaveBeenCalledWith(["a", "b"], "archive/2026");
    expect(screen.queryByText(/choose a folder/)).toBeNull();
  });

  it("CancelPicking: Escape or Cancel leaves without a move", () => {
    const { onMoveFile, onMoveFiles } = everything({ tree: nested });
    choose("a", "Move to…");
    fireEvent.keyDown(dirToggle("archive"), { key: "Escape" });
    expect(screen.queryByText(/choose a folder/)).toBeNull();
    choose("a", "Move to…");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/choose a folder/)).toBeNull();
    expect(onMoveFile).not.toHaveBeenCalled();
    expect(onMoveFiles).not.toHaveBeenCalled();
  });

  it("AReadOnlyFolderIsNoTarget, AMovedFolderIsNoTargetForItself", () => {
    const { onMoveFile } = everything({ tree: { ...nested, "": [...nested[""], dir("w")], w: [] }, writableRoot: "" });
    choose("project", "Move to…");
    fireEvent.click(dirToggle("project"));
    expect(screen.queryByRole("button", { name: "Move here: project" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move here: sub" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move here: w" }));
    expect(onMoveFile).toHaveBeenCalledWith("project", "w");
  });

  it("a read-only folder offers no target while picking, nor the folder the entry is already in", () => {
    everything({ tree: { "": [dir("w"), dir("ro")], w: [file("x"), dir("inbox")], "w/inbox": [], ro: [] }, writableRoot: "w" });
    fireEvent.click(dirToggle("w"));
    choose("x", "Move to…");
    expect(screen.queryByRole("button", { name: "Move here: ro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move here: w" })).toBeNull();
    expect(screen.getByRole("button", { name: "Move here: inbox" })).toBeInTheDocument();
  });
});

describe("FileTree — copying paths", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("CopyARowsPaths: relative, then absolute, each briefly confirmed", async () => {
    everything({ tree: { "": [dir("docs")], docs: [file("a.md")] }, browserRoot: "/home/u/proj" });
    fireEvent.click(dirToggle("docs"));

    choose("a.md", /Copy relative path/);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Path copied"));
    expect(writeText).toHaveBeenLastCalledWith("docs/a.md");

    choose("a.md", /Copy absolute path/);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("/home/u/proj/docs/a.md"));
  });

  it("AnAbsolutePathUsesTheServersSeparator", async () => {
    everything({ tree: { "": [dir("docs")], docs: [file("a.md")] }, browserRoot: "C:\\Users\\u\\proj" });
    fireEvent.click(dirToggle("docs"));
    choose("a.md", /Copy absolute path/);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("C:\\Users\\u\\proj\\docs\\a.md"));
  });

  it("CopyASelectionsPaths: one path per line", async () => {
    everything({ tree: { "": [file("a.md"), dir("docs")], docs: [] } });
    fireEvent.click(label("a.md"), { detail: 1 });
    fireEvent.click(screen.getByText("docs").closest("button")!, { ctrlKey: true });
    choose("a.md", /Copy relative paths/);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("a.md\ndocs"));
    expect(screen.getByRole("status")).toHaveTextContent("2 paths copied");
  });

  it("offers no absolute path when the server did not say where the tree lives", () => {
    everything({ tree: { "": [file("a.md")] } });
    openMenu("a.md");
    expect(menuItem(/Copy relative path/)).toBeInTheDocument();
    expect(queryMenuItem(/Copy absolute path/)).toBeNull();
  });

  it("each copy item carries the ⧉ symbol", () => {
    everything({ tree: { "": [file("a.md")] }, browserRoot: "/p" });
    openMenu("a.md");
    expect(menuItem(/Copy relative path/)).toHaveTextContent("⧉");
    expect(menuItem(/Copy absolute path/)).toHaveTextContent("⧉");
  });

  it("says so when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    everything({ tree: { "": [file("a.md")] } });
    choose("a.md", /Copy relative path/);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not copy: denied"));
  });
});
