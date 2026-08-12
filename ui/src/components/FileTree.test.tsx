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
});
