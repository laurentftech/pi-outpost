import { describe, expect, it } from "vitest";
import type { DirEntry } from "@pi-outpost/shared";
import {
  deleteConfirmation,
  outermost,
  rowActions,
  visibleRows,
  type ActionEntry,
  type ActionHandlers,
} from "./fileTreeModel";

const file = (name: string): DirEntry => ({ name, type: "file" });
const dir = (name: string): DirEntry => ({ name, type: "directory" });

const all: ActionHandlers = {
  open: true,
  diff: true,
  openNative: true,
  reveal: true,
  create: true,
  reference: true,
  download: true,
  rename: true,
  move: true,
  moveMany: true,
  delete: true,
  deleteMany: true,
};

const entry = (overrides: Partial<ActionEntry> = {}): ActionEntry => ({
  path: "src/main.ts",
  kind: "file",
  link: false,
  readOnly: false,
  protectedRoot: false,
  attached: false,
  ...overrides,
});

const labels = (groups: ReturnType<typeof rowActions>) => groups.map((group) => group.map((action) => action.label));

describe("visibleRows", () => {
  const tree = {
    "": [file("a"), dir("open"), dir("shut"), file("z")],
    open: [file("b"), dir("deeper")],
    "open/deeper": [file("c")],
    shut: [file("hidden")],
  };

  it("lists rows in display order, folders included, children only under open folders", () => {
    const rows = visibleRows(tree, new Set(["open", "open/deeper"]));
    expect(rows.map((row) => [row.path, row.kind])).toEqual([
      ["a", "file"],
      ["open", "directory"],
      ["open/b", "file"],
      ["open/deeper", "directory"],
      ["open/deeper/c", "file"],
      ["shut", "directory"],
      ["z", "file"],
    ]);
  });

  it("excludes the children of a collapsed folder, even under an open one", () => {
    expect(visibleRows(tree, new Set(["open/deeper"])).map((row) => row.path)).toEqual(["a", "open", "shut", "z"]);
  });
});

describe("outermost", () => {
  it("drops a path under another selected folder, and duplicates", () => {
    expect(outermost(["docs/a.md", "docs", "readme.md", "docs", "docs-other/x"])).toEqual(["docs", "readme.md", "docs-other/x"]);
  });
});

describe("rowActions", () => {
  it("AFileRowsMenuInItsOrder: open/show · reference/download · rename/move · delete", () => {
    expect(labels(rowActions([entry({ gitState: "modified" })], all))).toEqual([
      ["Open", "Show diff", "Open with associated app", "Show in file manager"],
      ["Reference in prompt", "Download"],
      ["Rename…", "Move to…"],
      ["Delete…"],
    ]);
  });

  it("AFolderRowsMenu: the same groups, at parity with a file", () => {
    expect(labels(rowActions([entry({ path: "src", kind: "directory" })], all))).toEqual([
      ["New file or folder…", "Show in file manager"],
      ["Reference in prompt", "Download as .zip"],
      ["Rename…", "Move to…"],
      ["Delete…"],
    ]);
  });

  it("AReadOnlyFileOffersOnlyWhatItCanTake: no change, no creation, but download and reference", () => {
    expect(labels(rowActions([entry({ readOnly: true })], all))).toEqual([
      ["Open", "Open with associated app", "Show in file manager"],
      ["Reference in prompt", "Download"],
    ]);
    expect(labels(rowActions([entry({ path: "ref", kind: "directory", readOnly: true })], all))).toEqual([
      ["Show in file manager"],
      ["Reference in prompt", "Download as .zip"],
    ]);
  });

  it("TheRootsOfferNoRemoval: the writable root's own row cannot be renamed, moved or deleted", () => {
    const groups = labels(rowActions([entry({ path: "workspace", kind: "directory", protectedRoot: true })], all)).flat();
    expect(groups).not.toContain("Rename…");
    expect(groups).not.toContain("Move to…");
    expect(groups).not.toContain("Delete…");
    expect(groups).toContain("New file or folder…");
  });

  it("an action no callback answers is absent, not disabled", () => {
    const groups = rowActions([entry()], { ...all, openNative: false, download: false, delete: false });
    expect(labels(groups).flat()).toEqual(["Open", "Show in file manager", "Reference in prompt", "Rename…", "Move to…"]);
  });

  it("a referenced entry offers to drop the reference", () => {
    expect(labels(rowActions([entry({ attached: true })], all))[1]).toEqual(["Remove from prompt", "Download"]);
  });

  it("a selection counts its items and drops what only one entry can take", () => {
    const selection = [entry({ path: "a.txt" }), entry({ path: "docs", kind: "directory" }), entry({ path: "b.txt", attached: true })];
    expect(labels(rowActions(selection, all))).toEqual([
      ["Reference 3 items in prompt", "Download 3 items as .zip"],
      ["Move 3 items to…"],
      ["Delete 3 items…"],
    ]);
  });

  it("AMixedSelectionOffersNoMutation: one read-only entry takes Delete and Move away", () => {
    const groups = labels(rowActions([entry({ path: "a.txt" }), entry({ path: "ro.txt", readOnly: true })], all));
    expect(groups).toEqual([["Reference 2 items in prompt", "Download 2 items as .zip"]]);
  });

  it("a selection already all referenced offers no reference", () => {
    const groups = labels(rowActions([entry({ path: "a", attached: true }), entry({ path: "b", attached: true })], all));
    expect(groups[0]).toEqual(["Download 2 items as .zip"]);
  });
});

describe("deleteConfirmation", () => {
  it("names the file, says a folder goes with its content, and counts a selection", () => {
    expect(deleteConfirmation([{ path: "docs/readme.md", kind: "file" }])).toBe('Delete "readme.md" permanently?');
    expect(deleteConfirmation([{ path: "docs", kind: "directory" }])).toBe('Delete the folder "docs" and everything in it permanently?');
    expect(deleteConfirmation([{ path: "a", kind: "file" }, { path: "b", kind: "file" }])).toBe("Delete 2 items permanently?");
    expect(deleteConfirmation([{ path: "a", kind: "file" }, { path: "d", kind: "directory" }])).toBe(
      "Delete 2 items permanently? The folder is deleted with everything in it.",
    );
  });
});
