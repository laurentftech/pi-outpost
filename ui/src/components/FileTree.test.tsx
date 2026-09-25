import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { DirEntry, GitFileState } from "@pi-outpost/shared";
import { FileTree } from "./FileTree";
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
    it("offers a pin per file when attaching is possible", () => {
      setup();
      expect(screen.getByRole("button", { name: "Reference readme.md in the prompt" })).toBeInTheDocument();
    });

    it("omits the pin entirely when attaching is not offered", () => {
      setup({ onToggleAttachPath: undefined });
      expect(screen.queryByRole("button", { name: /in the prompt/ })).not.toBeInTheDocument();
    });

    it("reports the path to attach", () => {
      const { onToggleAttachPath } = setup();
      fireEvent.click(screen.getByRole("button", { name: "Reference readme.md in the prompt" }));
      expect(onToggleAttachPath).toHaveBeenCalledWith("readme.md");
    });

    it("says the file is already referenced, and offers to drop it", () => {
      setup({ attachedPaths: ["readme.md"] });
      const pin = screen.getByRole("button", { name: "Remove readme.md in the prompt" });
      expect(pin).toHaveAttribute("aria-pressed", "true");
    });

    it("keeps an attached pin visible rather than hiding it until hover", () => {
      // Two files: one referenced, one not, so both pin styles are on screen
      setup({ tree: { "": [file("readme.md"), file("notes.md")] }, attachedPaths: ["readme.md"] });
      const attached = screen.getByRole("button", { name: /Remove readme.md/ });
      const plain = screen.getByRole("button", { name: /Reference/ });
      expect(attached.className).not.toMatch(/opacity-0/);
      expect(plain.className).toMatch(/opacity-0/);
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

      fireEvent.click(screen.getByRole("button", { name: "Open readme.md with the associated application" }));

      expect(actions.onOpenNative).toHaveBeenCalledWith("readme.md");
      expect(screen.queryByRole("button", { name: "Rename readme.md" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete readme.md" })).not.toBeInTheDocument();
    });

    it("TheTreeOffersRevealOnFilesAndFolders: a file row and a folder row each ask to be shown in the file manager", () => {
      const onRevealNative = vi.fn();
      setup({ tree: { "": [dir("docs"), file("readme.md")] }, onRevealNative, writableRoot: null });

      fireEvent.click(screen.getByRole("button", { name: "Show readme.md in the file manager" }));
      fireEvent.click(screen.getByRole("button", { name: "Show docs in the file manager" }));

      expect(onRevealNative.mock.calls).toEqual([["readme.md"], ["docs"]]);
      // Showing is not writing: a read-only tree offers it all the same, and nothing expanded.
      expect(screen.getByRole("button", { name: "Show docs in the file manager" })).toHaveAttribute("title", "Show in the file manager");
    });

    it("offers no reveal control when the page cannot ask for one", () => {
      setup({ tree: { "": [dir("docs"), file("readme.md")] } });
      expect(screen.queryByRole("button", { name: /in the file manager$/ })).not.toBeInTheDocument();
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
      fireEvent.click(screen.getByRole("button", { name: "Rename readme.md" }));
      const input = screen.getByRole("textbox", { name: "Rename readme.md" });

      fireEvent.change(input, { target: { value: "guide.md" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(actions.onRenameFile).toHaveBeenCalledWith("readme.md", "guide.md");
    });

    it("cancels a rename submitted with a blank name", () => {
      const actions = handlers();
      setup(actions);
      fireEvent.click(screen.getByRole("button", { name: "Rename readme.md" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Rename readme.md" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Rename readme.md" }));
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

      fireEvent.click(screen.getByRole("button", { name: "Delete readme.md" }));

      expect(confirm).toHaveBeenCalledWith('Delete "readme.md" permanently?');
      expect(actions.onDeleteFile).toHaveBeenCalledTimes(1);
      expect(actions.onDeleteFile).toHaveBeenCalledWith("readme.md");
      confirm.mockRestore();
    });

    it("does not request deletion when confirmation is cancelled", () => {
      const actions = handlers();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      setup(actions);

      fireEvent.click(screen.getByRole("button", { name: "Delete readme.md" }));

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

      expect(screen.getByRole("button", { name: "Open readme.md with the associated application" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Rename readme.md" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Delete readme.md" })).toBeDisabled();
      expect(screen.getByText("readme.md").closest("button")).toHaveAttribute("draggable", "false");
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
    fireEvent.click(screen.getByRole("button", { name: "New file or folder in src" }));
    return { ...handlers, input: screen.getByRole("textbox", { name: /New file or folder in src/ }) };
  }

  it("offers no creation control without a creation callback", () => {
    render(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /New file or folder/ })).toBeNull();
  });

  it("offers no control on a directory outside the writable zone", () => {
    render(
      <FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} writableRoot="other" {...creators()} />,
    );

    expect(screen.queryByRole("button", { name: "New file or folder in src" })).toBeNull();
  });

  it("offers nothing at all when the sandbox is read-only", () => {
    render(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} writableRoot={null} {...creators()} />);

    expect(screen.queryByRole("button", { name: /New file or folder/ })).toBeNull();
  });

  it("reports the joined path for a file", () => {
    const { onCreateFile, onCreateDirectory, input } = openInputInSrc();

    fireEvent.change(input, { target: { value: "helper.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateFile).toHaveBeenCalledWith("src/helper.ts");
    expect(onCreateDirectory).not.toHaveBeenCalled();
  });

  it("reads a trailing slash as a directory", () => {
    const { onCreateFile, onCreateDirectory, input } = openInputInSrc();

    fireEvent.change(input, { target: { value: "widgets/" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateDirectory).toHaveBeenCalledWith("src/widgets");
    expect(onCreateFile).not.toHaveBeenCalled();
  });

  it("creates at the workspace root from the header control", () => {
    const handlers = creators();
    render(<FileTree tree={tree()} onExpand={vi.fn()} onSelectFile={vi.fn()} {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "New file or folder in the workspace root" }));
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
    expect(screen.getByRole("textbox", { name: /New file or folder in src/ })).toHaveValue("deep/helper.ts");
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
    expect(screen.getByRole("textbox", { name: /New file or folder in src/ })).toHaveValue("taken.ts");
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
    fireEvent.click(screen.getByRole("button", { name: "New file or folder in src" }));
    const input = screen.getByRole("textbox", { name: /New file or folder in src/ });
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

    expect(screen.queryByRole("textbox", { name: /New file or folder in src/ })).toBeNull();
  });

  it("does not read a listing that already holds the name as success", () => {
    // The refused-duplicate case: the name is in the listing precisely because
    // the server refused it. Closing the input here would swallow the refusal.
    const handlers = creators();
    const existing = { src: [file("main.ts"), file("taken.ts"), dir("nested")] };
    const { rerender } = render(
      <FileTree tree={tree(existing)} onExpand={vi.fn()} onSelectFile={vi.fn()} {...handlers} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New file or folder in src" }));
    const input = screen.getByRole("textbox", { name: /New file or folder in src/ });
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

    expect(screen.getByRole("textbox", { name: /New file or folder in src/ })).toHaveValue("taken.ts");
    expect(screen.getByText('"src/taken.ts" already exists')).toBeInTheDocument();
  });

  it("cancels on Escape without reporting anything", () => {
    const { onCreateFile, onCreateDirectory, input } = openInputInSrc();

    fireEvent.change(input, { target: { value: "helper.ts" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCreateFile).not.toHaveBeenCalled();
    expect(onCreateDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: /New file or folder in src/ })).toBeNull();
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
    expect(screen.queryByRole("button", { name: /New file or folder in the workspace root/ })).toBeNull();
  });

  it("offers none when no refresh callback is supplied", () => {
    setup();

    expect(screen.queryByRole("button", { name: "Refresh the file tree" })).toBeNull();
  });
});
