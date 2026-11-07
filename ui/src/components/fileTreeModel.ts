/**
 * What the Files tree shows and offers, as pure functions: which rows are visible
 * (a range selection walks them), which paths a selection really acts on, and which
 * actions a row's menu holds, in which order. Kept out of the component so the order
 * and the "absent, not disabled" rule are testable without rendering anything.
 */
import type { DirEntry, GitFileState } from "@pi-outpost/shared";
import type { DirState } from "../useAgent";

export type RowKind = "file" | "directory";

export interface VisibleRow {
  path: string;
  kind: RowKind;
  entry: DirEntry;
}

export function isDirectoryEntry(type: DirEntry["type"]): boolean {
  return type === "directory" || type === "symlink-directory";
}

export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

/** Every row on screen, in display order: a folder's rows follow it only while it is open. */
export function visibleRows(tree: Record<string, DirState>, openPaths: ReadonlySet<string>, dir = ""): VisibleRow[] {
  const listing = tree[dir];
  if (!Array.isArray(listing)) return [];
  const rows: VisibleRow[] = [];
  for (const entry of listing) {
    const path = joinPath(dir, entry.name);
    const kind: RowKind = isDirectoryEntry(entry.type) ? "directory" : "file";
    rows.push({ path, kind, entry });
    if (kind === "directory" && openPaths.has(path)) rows.push(...visibleRows(tree, openPaths, path));
  }
  return rows;
}

/** Every path some listing in hand names: a selection keeps only these. */
export function listedPaths(tree: Record<string, DirState>): Set<string> {
  const paths = new Set<string>();
  for (const [dir, listing] of Object.entries(tree)) {
    if (!Array.isArray(listing)) continue;
    for (const entry of listing) paths.add(joinPath(dir, entry.name));
  }
  return paths;
}

/**
 * The paths a selection acts on: each once, and none inside another selected
 * folder — deleting, moving or archiving the folder already takes them with it.
 */
export function outermost(paths: Iterable<string>): string[] {
  const unique = [...new Set(paths)];
  return unique.filter((candidate) => !unique.some((other) => other !== candidate && candidate.startsWith(`${other}/`)));
}

/** True when `path` is `ancestor` or lies inside it. */
export function isInside(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** undefined writableRoot = no sandbox, nothing to dim; null = the whole tree is read-only. */
export function isReadOnly(fullPath: string, writableRoot: string | null | undefined): boolean {
  if (writableRoot === undefined) return false;
  if (writableRoot === null) return true;
  if (writableRoot === "") return false;
  return fullPath !== writableRoot && !fullPath.startsWith(`${writableRoot}/`);
}

export type RowActionId =
  | "open"
  | "show-diff"
  | "open-native"
  | "reveal"
  | "new"
  | "reference"
  | "unreference"
  | "download"
  | "rename"
  | "move"
  | "delete";

/**
 * The symbol each action is drawn with in the menu: the ones the tree rows used to
 * carry (↗ ⌂ ✎ × @ +), so what was learned on the row is found again in the menu,
 * and the same family for the actions that are new.
 */
export const ROW_ACTION_SYMBOL: Record<RowActionId, string> = {
  open: "↵",
  "show-diff": "±",
  "open-native": "↗",
  reveal: "⌂",
  new: "+",
  reference: "@",
  unreference: "@",
  download: "⤓",
  rename: "✎",
  move: "→",
  delete: "×",
};

export interface RowAction {
  id: RowActionId;
  label: string;
  /** A destructive item, drawn as one. */
  danger?: boolean;
  /** A keyboard shortcut the row also answers, shown beside the label. */
  shortcut?: string;
}

/** What the menu needs to know about one entry it may act on. */
export interface ActionEntry {
  path: string;
  kind: RowKind;
  /** A symbolic link: shown and readable, but not renamed, moved or deleted from the tree. */
  link: boolean;
  readOnly: boolean;
  /** The writable root itself: its own folder, which is never renamed, moved or deleted. */
  protectedRoot: boolean;
  gitState?: GitFileState;
  attached: boolean;
}

/** Which callbacks the tree was given: an action without one is not offered at all. */
export interface ActionHandlers {
  open: boolean;
  diff: boolean;
  openNative: boolean;
  reveal: boolean;
  create: boolean;
  reference: boolean;
  download: boolean;
  rename: boolean;
  move: boolean;
  moveMany: boolean;
  delete: boolean;
  deleteMany: boolean;
}

/** An entry the tree may rename, move or delete. */
export function mutable(entry: ActionEntry): boolean {
  return !entry.readOnly && !entry.link && !entry.protectedRoot;
}

const count = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/**
 * The menu for `entries` — one row, or a selection — as ordered groups:
 * open/show · reference/download · rename/move · delete. An item the entries cannot
 * all take, or that no callback answers, is left out; an empty group is dropped.
 */
export function rowActions(entries: readonly ActionEntry[], handlers: ActionHandlers): RowAction[][] {
  if (entries.length === 0) return [];
  const single = entries.length === 1 ? entries[0] : null;
  const allMutable = entries.every(mutable);
  const groups: RowAction[][] = [];

  if (single) {
    const show: RowAction[] = [];
    if (single.kind === "file") {
      if (handlers.open) show.push({ id: "open", label: "Open" });
      if (single.gitState && (handlers.diff || handlers.open)) show.push({ id: "show-diff", label: "Show diff" });
      if (handlers.openNative) show.push({ id: "open-native", label: "Open with associated app" });
    } else if (handlers.create && !single.readOnly && !single.link) {
      show.push({ id: "new", label: "New file or folder…" });
    }
    if (handlers.reveal) show.push({ id: "reveal", label: "Show in file manager" });
    groups.push(show);
  }

  const share: RowAction[] = [];
  if (handlers.reference) {
    if (single) {
      share.push(single.attached ? { id: "unreference", label: "Remove from prompt" } : { id: "reference", label: "Reference in prompt" });
    } else if (entries.some((entry) => !entry.attached)) {
      share.push({ id: "reference", label: `Reference ${count(entries.length)} in prompt` });
    }
  }
  if (handlers.download) {
    const label = single ? (single.kind === "directory" ? "Download as .zip" : "Download") : `Download ${count(entries.length)} as .zip`;
    share.push({ id: "download", label });
  }
  groups.push(share);

  const change: RowAction[] = [];
  if (allMutable) {
    if (single && handlers.rename) change.push({ id: "rename", label: "Rename…", shortcut: "F2" });
    if (single ? handlers.move : handlers.moveMany) change.push({ id: "move", label: single ? "Move to…" : `Move ${count(entries.length)} to…` });
  }
  groups.push(change);

  if (allMutable && (single ? handlers.delete : handlers.deleteMany)) {
    groups.push([{ id: "delete", label: single ? "Delete…" : `Delete ${count(entries.length)}…`, danger: true, shortcut: "Del" }]);
  }
  return groups.filter((group) => group.length > 0);
}

/** The confirmation a deletion asks, naming what goes — a folder's content included. */
export function deleteConfirmation(entries: readonly Pick<ActionEntry, "path" | "kind">[]): string {
  if (entries.length === 1) {
    const [entry] = entries;
    const name = entry.path.split("/").pop() ?? entry.path;
    return entry.kind === "directory"
      ? `Delete the folder "${name}" and everything in it?`
      : `Delete "${name}"?`;
  }
  const folders = entries.filter((entry) => entry.kind === "directory").length;
  return `Delete ${count(entries.length)}?${folders > 0 ? ` ${folders === 1 ? "The folder is" : "Folders are"} deleted with everything in ${folders === 1 ? "it" : "them"}.` : ""}`;
}
