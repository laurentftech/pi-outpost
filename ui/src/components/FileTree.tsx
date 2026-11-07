import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { DirEntry, GitFileState } from "@pi-outpost/shared";
import type { DirState, FileOperationState } from "../useAgent";
import { readUploadFile, UploadContextChangedError } from "../uploads";
import {
  deleteConfirmation,
  isDirectoryEntry,
  isInside,
  isReadOnly,
  joinPath,
  listedPaths,
  mutable,
  outermost,
  rowActions,
  visibleRows,
  type ActionEntry,
  type ActionHandlers,
  type RowActionId,
  ROW_ACTION_SYMBOL,
} from "./fileTreeModel";
import { RowMenu } from "./RowMenu";

const FILE_DRAG_TYPE = "application/x-pi-outpost-file";
const FILE_COPY_DRAG_TYPE = "application/x-pi-outpost-read-only-file";
/** A drag of several selected entries: their paths, as JSON, beside the dragged row's own. */
const SELECTION_DRAG_TYPE = "application/x-pi-outpost-selection";
/**
 * Hidden until hover, because a control on every row drowns the tree — but always
 * present on a touch screen, where a hidden control is an invisible tap target.
 */
const REVEALED_ON_HOVER =
  "group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0";
const MORE_CLASS = `mr-1 shrink-0 rounded px-1 text-xs leading-none text-zinc-400 hover:bg-zinc-200 dark:text-zinc-600 dark:hover:bg-zinc-700 ${REVEALED_ON_HOVER}`;
const SELECTED_ROW = "bg-blue-50 dark:bg-blue-950/40";
/** The bar already says how many: its buttons say only what they do. */
const BAR_LABEL: Partial<Record<RowActionId, string>> = {
  reference: "Reference",
  download: "Download",
  move: "Move to…",
  delete: "Delete…",
};

/**
 * The open creation input, threaded down to the directory it belongs to. Kept in
 * `FileTree` rather than in each row so expanding or collapsing another branch
 * cannot lose what is being typed.
 */
interface CreationState {
  /** Directory whose input row is open ("" = the browser root), or null. */
  openIn: string | null;
  /** Local refusal, shown without a round trip (a name is not a path). */
  localError: string | null;
  serverError: string | null;
  start: (dir: string) => void;
  cancel: () => void;
  submit: (dir: string, raw: string) => void;
}

interface RenameState {
  path: string | null;
  pending: boolean;
  localError: string | null;
  serverError: string | null;
  start: (path: string) => void;
  cancel: () => void;
  submit: (path: string, raw: string, isDirectory: boolean) => void;
}

interface ImportState {
  pending: boolean;
  start: (directory: string, transfer: DataTransfer) => void;
}

/** What every row needs from the tree as a whole: selection, the menu, drags, picking. */
interface TreeUi {
  selected: ReadonlySet<string>;
  /** The menu is open on this row. */
  menuFor: string | null;
  /** Move to… is choosing a destination for these paths. */
  picking: string[] | null;
  canDrag: (path: string) => boolean;
  dragStart: (path: string, transfer: DataTransfer) => void;
  dragEnd: () => void;
  /** The paths dragged from this tree, or null when the drag came from elsewhere. */
  dragged: () => string[] | null;
  dropSelection: (destination: string, transfer: DataTransfer) => boolean;
  click: (path: string, isDirectory: boolean, event: MouseEvent) => boolean;
  openMenu: (path: string, anchor: { left: number; top: number; above: number }, returnFocus: HTMLElement | null) => void;
  menuAnchorFrom: (element: HTMLElement) => { left: number; top: number; above: number };
  pointerAnchor: (event: MouseEvent) => { left: number; top: number; above: number };
  rowKeyDown: (path: string, event: KeyboardEvent<HTMLElement>) => void;
  pick: (destination: string) => void;
  /** The row's menu holds at least one action. */
  hasMenu: (path: string) => boolean;
}

interface TreeProps {
  tree: Record<string, DirState>;
  openFilePath?: string;
  /** Writable zone; see SessionSnapshot.writableRoot. Entries outside it render dimmed. */
  writableRoot?: string | null;
  /** Git status per browser-root-relative path; badges render from it. */
  gitFiles?: Record<string, GitFileState>;
  /** Paths currently attached to the composer as references (from the tree or the open preview). */
  attachedPaths?: string[];
  onExpand: (path: string) => void;
  /**
   * A directory the user touched, opened or closed.
   *
   * Distinct from `onExpand`, which fires once per directory and only to fetch it:
   * re-opening a cached directory, or collapsing one, tells the tree nothing while
   * telling the user's eye a great deal about which project they are looking at.
   */
  onSelectDirectory?: (path: string) => void;
  onSelectFile: (path: string) => void;
  /** Open the file directly on its uncommitted diff (badge click). */
  onSelectDiff?: (path: string) => void;
  /** Attach the entry to the composer as an `@path` reference, or drop it if already attached. */
  onToggleAttachPath?: (path: string) => void;
  /**
   * Re-list every directory the tree is holding.
   *
   * Offered whatever the server is doing about watching: `fs.watch` is
   * best-effort by contract, and a filesystem that reports nothing — a network
   * mount, a spent inotify budget, watching switched off — looks exactly like a
   * workspace that did not change. A fallback that only appears once the primary
   * is known to have failed is one nobody can reach.
   */
  onRefresh?: () => void;
  /** Create an empty file at this path. Absent = no creation affordance at all. */
  onCreateFile?: (path: string) => void;
  /** Create one directory at this path. */
  onCreateDirectory?: (path: string) => void;
  onOpenNative?: (path: string) => void;
  /** Show the path, selected, in the file manager of the machine the server runs on. */
  onRevealNative?: (path: string) => void;
  /** Rename a file or folder. */
  onRenameFile?: (path: string, name: string) => void;
  /** Delete a file, or a folder with everything in it (the tree has confirmed it). */
  onDeleteFile?: (path: string) => void;
  onMoveFile?: (path: string, destinationDirectory: string) => void;
  onCopyFile?: (path: string, destinationDirectory: string) => void;
  /** Delete several entries in one request (the tree has confirmed it). */
  onDeleteFiles?: (paths: string[]) => void;
  /** Move several entries into one directory in one request. */
  onMoveFiles?: (paths: string[], destinationDirectory: string) => void;
  /** Save entries on this machine: a single file as itself, anything else as one archive. */
  onDownload?: (paths: string[], singleFile: boolean) => Promise<{ skipped: number }>;
  /** Import external bytes into an existing directory, returning the actual saved path. */
  onUploadFile?: (name: string, contentBase64: string, destinationDirectory: string) => Promise<string>;
  /** Internal: the batch shared by every target in this tree. */
  imports?: ImportState;
  fileOperation?: FileOperationState | null;
  /** The server's refusal of the last creation request, if it refused one. */
  createError?: { path: string; message: string } | null;
  /** Path the last creation produced — the only definite sign that it worked. */
  created?: string | null;
  /** Internal: the open input row. Supplied by `FileTree` to its own rows. */
  creation?: CreationState;
  /** Internal: the active in-tree rename input. */
  rename?: RenameState;
  /**
   * Internal: which folders are open. Held by `FileTree` rather than by each row, so
   * a range selection can walk the visible rows and a folder reopened under a
   * collapsed parent comes back as it was left.
   */
  openPaths?: ReadonlySet<string>;
  setOpen?: (path: string, open: boolean) => void;
  /** Internal: selection, menu, drags and picking, shared by every row. */
  ui?: TreeUi;
}

const GIT_BADGE: Record<GitFileState, { label: string; className: string }> = {
  modified: { label: "M", className: "text-amber-600 dark:text-amber-400" },
  added: { label: "A", className: "text-emerald-600 dark:text-emerald-400" },
  untracked: { label: "U", className: "text-emerald-600 dark:text-emerald-400" },
  deleted: { label: "D", className: "text-red-600 dark:text-red-400" },
  conflicted: { label: "C", className: "text-purple-600 dark:text-purple-400" },
};

/** Number of git-changed files under this directory (badge on collapsed directories). */
function dirChangeCount(dirPath: string, gitFiles: Record<string, GitFileState> | undefined): number {
  if (!gitFiles) return 0;
  return Object.keys(gitFiles).filter((p) => p.startsWith(`${dirPath}/`)).length;
}

/**
 * The name is typed where the file will land, so the destination is shown rather
 * than restated. A trailing slash asks for a directory — one control, one
 * keystroke, the way the same intent reads on a command line.
 */
export function CreationRow({ dir, depth, creation }: { dir: string; depth: number; creation: CreationState }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const error = creation.localError ?? creation.serverError;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div style={{ paddingLeft: depth * 12 + 4 }} className="py-0.5">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            creation.submit(dir, value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            creation.cancel();
          }
        }}
        // Blur cancels, but only when nothing was refused: a refusal has to stay
        // on screen with the typed name, and clicking the message would dismiss it.
        onBlur={() => {
          if (error === null) creation.cancel();
        }}
        placeholder="name, or name/ for a folder"
        aria-label={`New file or folder in ${dir === "" ? "the workspace root" : dir}`}
        spellCheck={false}
        className="w-full rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />
      {error !== null && <p className="px-1 pt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function RenameRow({
  path: filePath,
  name,
  depth,
  isDirectory,
  rename,
}: {
  path: string;
  name: string;
  depth: number;
  isDirectory: boolean;
  rename: RenameState;
}) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const error = rename.localError ?? rename.serverError;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div style={{ paddingLeft: depth * 12 + (isDirectory ? 4 : 16) }} className="py-0.5">
      <input
        ref={inputRef}
        value={value}
        disabled={rename.pending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !rename.pending) {
            event.preventDefault();
            rename.submit(filePath, value, isDirectory);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            rename.cancel();
          }
        }}
        onBlur={() => {
          if (error === null) rename.cancel();
        }}
        aria-label={`Rename ${name}`}
        spellCheck={false}
        className="w-full rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />
      {error !== null && <p className="px-1 pt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function DirChildren({ path, depth, ...props }: TreeProps & { path: string; depth: number }) {
  const state = props.tree[path];
  const input =
    props.creation?.openIn === path ? (
      <CreationRow dir={path} depth={depth} creation={props.creation} />
    ) : null;
  if (state === undefined) return input;
  if (state === "loading") {
    return (
      <>
        {input}
        <div style={{ paddingLeft: depth * 12 + 4 }} className="py-0.5 text-xs text-zinc-400 dark:text-zinc-600">
          loading…
        </div>
      </>
    );
  }
  if ("error" in state) {
    return (
      <>
        {input}
        <div style={{ paddingLeft: depth * 12 + 4 }} className="py-0.5 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </div>
      </>
    );
  }
  if (state.length === 0) {
    return (
      <>
        {input}
        {input === null && (
          <div style={{ paddingLeft: depth * 12 + 4 }} className="py-0.5 text-xs text-zinc-400 dark:text-zinc-600">
            empty
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {input}
      {state.map((entry) => (
        <TreeNode key={entry.name} parentPath={path} entry={entry} depth={depth} {...props} />
      ))}
    </>
  );
}

/** The `⋯` that opens a row's menu, and the row's own context menu, wired the same way. */
function useRowMenu(props: TreeProps, fullPath: string) {
  const ui = props.ui;
  const moreRef = useRef<HTMLButtonElement>(null);
  return {
    moreRef,
    more: ui?.hasMenu(fullPath) ? (
      <button
        ref={moreRef}
        type="button"
        aria-label={`Actions for ${fullPath.split("/").pop()}`}
        aria-haspopup="menu"
        aria-expanded={ui.menuFor === fullPath}
        title="Actions"
        onClick={(event) => ui.openMenu(fullPath, ui.menuAnchorFrom(event.currentTarget), event.currentTarget)}
        className={`${MORE_CLASS} ${ui.menuFor === fullPath ? "opacity-100" : ""}`}
      >
        ⋯
      </button>
    ) : null,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (!ui?.hasMenu(fullPath) || ui.picking) return;
      event.preventDefault();
      ui.openMenu(fullPath, ui.pointerAnchor(event), moreRef.current);
    },
  };
}

/**
 * The `@` on a row: references the entry in the prompt, or drops the reference.
 * Referenced, it stays lit, so the tree at rest says what the next prompt carries —
 * whether the reference came from here or from an `@` typed in the draft. Otherwise
 * it follows the hover convention: the one action quick enough to keep on the row.
 */
function ReferenceToggle({ name, path, props }: { name: string; path: string; props: TreeProps }) {
  if (!props.onToggleAttachPath) return null;
  const attached = props.attachedPaths?.includes(path) ?? false;
  return (
    <button
      type="button"
      onClick={() => props.onToggleAttachPath?.(path)}
      title={attached ? "Remove from the prompt" : "Reference in the prompt"}
      aria-label={attached ? `Remove ${name} from the prompt` : `Reference ${name} in the prompt`}
      aria-pressed={attached}
      className={`mr-1 shrink-0 rounded px-1 font-mono text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
        attached ? "font-bold text-blue-600 dark:text-blue-400" : `text-zinc-400 dark:text-zinc-600 ${REVEALED_ON_HOVER}`
      }`}
    >
      @
    </button>
  );
}

function TreeNode({
  parentPath,
  entry,
  depth,
  ...props
}: TreeProps & { parentPath: string; entry: DirEntry; depth: number }) {
  const [dropActive, setDropActive] = useState(false);
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const open = props.openPaths?.has(fullPath) ?? false;
  const setOpen = (next: boolean) => props.setOpen?.(fullPath, next);
  const readOnly = isReadOnly(fullPath, props.writableRoot);
  const lifecyclePending = props.fileOperation?.status === "pending";
  const ui = props.ui;
  const picking = ui?.picking ?? null;
  const selected = (ui?.selected.size ?? 0) > 1 && (ui?.selected.has(fullPath) ?? false);
  const { more, onContextMenu } = useRowMenu(props, fullPath);
  const draggable = (ui?.canDrag(fullPath) ?? false) && !lifecyclePending && picking === null;
  const dragHandlers = {
    draggable,
    onDragStart: (event: React.DragEvent) => {
      if (!draggable) return;
      ui?.dragStart(fullPath, event.dataTransfer);
    },
    onDragEnd: () => ui?.dragEnd(),
  };

  if (props.rename?.path === fullPath) {
    return (
      <div>
        <RenameRow path={fullPath} name={entry.name} depth={depth} isDirectory={isDirectoryEntry(entry.type)} rename={props.rename} />
        {isDirectoryEntry(entry.type) && open && <DirChildren path={fullPath} depth={depth + 1} {...props} />}
      </div>
    );
  }

  if (isDirectoryEntry(entry.type)) {
    const acceptsDrop = !readOnly && !lifecyclePending && !props.imports?.pending;
    // A folder never takes itself, its own content, or what is already directly in it.
    const takes = (paths: string[] | null) =>
      paths === null || paths.every((path) => !isInside(fullPath, path) && (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "") !== fullPath);
    const transferFor = (types: readonly string[]) =>
      types.includes(SELECTION_DRAG_TYPE)
        ? props.onMoveFiles === undefined
          ? null
          : "move"
        : types.includes(FILE_COPY_DRAG_TYPE)
          ? props.onCopyFile === undefined
            ? null
            : "copy"
          : props.onMoveFile === undefined
            ? null
            : "move";
    // Creating needs the directory open: the input row lives among its children,
    // and a name typed into a collapsed directory would have nowhere to appear.
    const toggle = () => {
      const next = !open;
      setOpen(next);
      if (next && props.tree[fullPath] === undefined) props.onExpand(fullPath);
      props.onSelectDirectory?.(fullPath);
    };
    // The same rule as a drop: not into itself or its own content, not where it already is.
    const pickable = picking !== null && !readOnly && entry.type === "directory" && takes(picking);
    const changes = dirChangeCount(fullPath, props.gitFiles);
    return (
      <div>
        <div
          className={`group flex w-full items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selected ? SELECTED_ROW : ""} ${dropActive && acceptsDrop ? "bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-950/40" : ""}`}
          data-drop-directory={fullPath}
          data-selected={selected || undefined}
          onContextMenu={onContextMenu}
          onDragOver={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (types.includes("Files") && !types.includes(FILE_DRAG_TYPE) && props.imports) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = acceptsDrop ? "copy" : "none";
              setDropActive(acceptsDrop);
              return;
            }
            if (!acceptsDrop || !types.includes(FILE_DRAG_TYPE) || !takes(ui?.dragged() ?? null)) return;
            const transfer = transferFor(types);
            if (transfer === null) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = transfer;
            setDropActive(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
          }}
          onDrop={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (types.includes("Files") && !types.includes(FILE_DRAG_TYPE) && props.imports) {
              event.preventDefault();
              event.stopPropagation();
              setDropActive(false);
              if (acceptsDrop) {
                setOpen(true);
                if (props.tree[fullPath] === undefined) props.onExpand(fullPath);
                props.imports.start(fullPath, event.dataTransfer);
              }
              return;
            }
            if (!acceptsDrop || !takes(ui?.dragged() ?? null)) return;
            if (ui?.dropSelection(fullPath, event.dataTransfer)) {
              event.preventDefault();
              event.stopPropagation();
              setDropActive(false);
              return;
            }
            const source = event.dataTransfer.getData(FILE_DRAG_TYPE);
            const transfer = source ? transferFor(types) : null;
            if (transfer === null || !takes([source])) return;
            event.preventDefault();
            event.stopPropagation();
            setDropActive(false);
            if (transfer === "copy") props.onCopyFile?.(source, fullPath);
            else props.onMoveFile?.(source, fullPath);
          }}
        >
          <button
            type="button"
            {...dragHandlers}
            onClick={(event) => {
              if (ui?.click(fullPath, true, event)) return;
              toggle();
            }}
            onKeyDown={(event) => ui?.rowKeyDown(fullPath, event)}
            style={{ paddingLeft: depth * 12 }}
            className="flex min-w-0 flex-1 items-center gap-1 rounded py-0.5 text-left"
          >
            <span className="w-3 shrink-0 text-xs text-zinc-400 dark:text-zinc-600">{open ? "▾" : "▸"}</span>
            <span
              title={entry.name}
              className={`truncate ${readOnly ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-700 dark:text-zinc-300"}`}
            >
              {entry.name}
            </span>
            {!open && changes > 0 && (
              <span
                className="ml-1 shrink-0 rounded bg-amber-100 px-1 font-mono text-[10px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                title={`${changes} changed file(s) inside`}
              >
                {changes}
              </span>
            )}
          </button>
          {pickable && (
            <button
              type="button"
              onClick={() => ui?.pick(fullPath)}
              aria-label={`Move here: ${entry.name}`}
              className="mr-1 shrink-0 rounded border border-blue-300 px-1.5 text-[11px] text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/50"
            >
              Move here
            </button>
          )}
          <ReferenceToggle name={entry.name} path={fullPath} props={props} />
          {picking === null && more}
        </div>
        {open && <DirChildren path={fullPath} depth={depth + 1} {...props} />}
      </div>
    );
  }

  const isOpenFile = fullPath === props.openFilePath;
  const gitState = props.gitFiles?.[fullPath];
  return (
    <div
      className={`group flex w-full items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        selected ? SELECTED_ROW : isOpenFile ? "bg-zinc-100 dark:bg-zinc-800" : ""
      }`}
      data-selected={selected || undefined}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        {...dragHandlers}
        disabled={picking !== null}
        onClick={(event) => {
          if (ui?.click(fullPath, false, event)) return;
          props.onSelectFile(fullPath);
        }}
        onKeyDown={(event) => ui?.rowKeyDown(fullPath, event)}
        style={{ paddingLeft: depth * 12 + 16 }}
        className="flex min-w-0 flex-1 items-center py-0.5 text-left disabled:cursor-default"
      >
        <span
          title={entry.name}
          className={`truncate ${readOnly ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-600 dark:text-zinc-400"}`}
        >
          {entry.name}
        </span>
      </button>
      <ReferenceToggle name={entry.name} path={fullPath} props={props} />
      {gitState && (
        <button
          type="button"
          onClick={() => (props.onSelectDiff ?? props.onSelectFile)(fullPath)}
          title="Show uncommitted diff"
          aria-label={`Show diff of ${entry.name}`}
          className={`mr-1 shrink-0 rounded px-1 font-mono text-xs font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 ${GIT_BADGE[gitState].className}`}
        >
          {GIT_BADGE[gitState].label}
        </button>
      )}
      {picking === null && more}
    </div>
  );
}

/** A name, not a route: the server enforces this too, but say so without a round trip. */
export function creationRequest(raw: string): { kind: "file" | "directory"; name: string } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "A name is required" };
  const directory = trimmed.endsWith("/");
  const name = directory ? trimmed.slice(0, -1).trim() : trimmed;
  if (name === "") return { error: "A name is required" };
  if (name.includes("/") || name.includes("\\")) return { error: "That is a path, not a name" };
  if (name === "." || name === "..") return { error: `"${name}" is not a name` };
  return { kind: directory ? "directory" : "file", name };
}

/** A file's new name; a folder's may carry the trailing slash a folder name is typed with. */
export function renameRequest(raw: string, isDirectory = false): { name: string } | { error: string } {
  const request = creationRequest(raw);
  if ("error" in request) return request;
  if (request.kind === "directory" && !isDirectory) return { error: "That is a folder name" };
  return { name: request.name };
}

/** What a selection or a row's menu is about to act on. */
interface MenuState {
  /** The row the menu was opened from. */
  path: string;
  /** What it acts on: the row, or the whole selection it belongs to. */
  paths: string[];
  anchor: { left: number; top: number; above: number };
  returnFocus: HTMLElement | null;
}

/** Lazily-loaded file/directory tree for the sidebar. */
export function FileTree(props: TreeProps) {
  const importingRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [importPaths, setImportPaths] = useState<string[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [rootDropActive, setRootDropActive] = useState(false);
  const imports: ImportState | undefined = props.onUploadFile ? {
    pending: importing,
    start: (directory, transfer) => {
      if (importingRef.current) return;
      const items = Array.from(transfer.items ?? []).filter((item) => item.kind === "file");
      let hasDirectories = false;
      const files = items.length > 0 ? items.flatMap((item) => {
        if (item.webkitGetAsEntry?.()?.isDirectory) {
          hasDirectories = true;
          return [];
        }
        const file = item.getAsFile();
        return file ? [file] : [];
      }) : Array.from(transfer.files);
      setImportPaths([]);
      setImportErrors(hasDirectories ? ["Folders cannot be imported here; drop files instead."] : []);
      if (files.length === 0) return;
      importingRef.current = true;
      setImporting(true);
      const upload = props.onUploadFile!;
      void (async () => {
        try {
          for (const file of files) {
            try {
              const content = await readUploadFile(file);
              const saved = await upload(file.name, content, directory);
              setImportPaths((paths) => [...paths, saved]);
            } catch (error) {
              setImportErrors((errors) => [...errors, `${file.name}: ${error instanceof Error ? error.message : String(error)}`]);
              if (error instanceof UploadContextChangedError) break;
            }
          }
        } finally {
          importingRef.current = false;
          setImporting(false);
        }
      })();
    },
  } : undefined;

  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(() => new Set());
  const setOpen = useCallback(
    (path: string, open: boolean) =>
      setOpenPaths((current) => {
        if (current.has(path) === open) return current;
        const next = new Set(current);
        if (open) next.add(path);
        else next.delete(path);
        return next;
      }),
    [],
  );
  // A tree with no root listing is a new browser root (a project switch clears the
  // listings): what was open in the old one means nothing here.
  const rootListed = props.tree[""] !== undefined;
  useEffect(() => {
    if (!rootListed) setOpenPaths((current) => (current.size === 0 ? current : new Set()));
  }, [rootListed]);

  const [openIn, setOpenIn] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /** What was asked for, so the input can close once the tree shows it. */
  const [pending, setPending] = useState<{ dir: string; name: string; kind: "file" | "directory" } | null>(null);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameLocalError, setRenameLocalError] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<string | null>(null);

  const canCreate = props.onCreateFile !== undefined || props.onCreateDirectory !== undefined;
  const serverError =
    props.createError && pending && props.createError.path === joinPath(pending.dir, pending.name)
      ? props.createError.message
      : null;

  // Close only on a creation that actually happened. Watching the listing for the
  // name instead would close on a refused duplicate too — the listing already has
  // that name, which is precisely why the server said no.
  const created = props.created ?? null;
  useEffect(() => {
    if (pending === null || created === null) return;
    if (created !== joinPath(pending.dir, pending.name)) return;
    // A created folder is shown open, ready for what goes in it; a file opens in the viewer instead.
    if (pending.kind === "directory") setOpen(created, true);
    setOpenIn(null);
    setPending(null);
    setLocalError(null);
  }, [pending, created, setOpen]);

  const renameServerError =
    props.fileOperation?.status === "error" &&
    props.fileOperation.operation === "rename_file" &&
    pendingRename === props.fileOperation.path
      ? props.fileOperation.message
      : null;

  useEffect(() => {
    const operation = props.fileOperation;
    if (operation?.status !== "succeeded" || operation.operation !== "rename_file" || pendingRename !== operation.path) return;
    setRenamePath(null);
    setPendingRename(null);
    setRenameLocalError(null);
  }, [pendingRename, props.fileOperation]);

  const creation: CreationState | undefined = canCreate
    ? {
        openIn,
        localError,
        serverError,
        start: (dir) => {
          setOpenIn(dir);
          setLocalError(null);
          setPending(null);
        },
        cancel: () => {
          setOpenIn(null);
          setLocalError(null);
          setPending(null);
        },
        submit: (dir, raw) => {
          const request = creationRequest(raw);
          if ("error" in request) {
            setLocalError(request.error);
            return;
          }
          setLocalError(null);
          setPending({ dir, name: request.name, kind: request.kind });
          const target = joinPath(dir, request.name);
          if (request.kind === "directory") props.onCreateDirectory?.(target);
          else props.onCreateFile?.(target);
        },
      }
    : undefined;
  const rename: RenameState | undefined = props.onRenameFile
    ? {
        path: renamePath,
        pending:
          pendingRename !== null &&
          props.fileOperation?.status === "pending" &&
          props.fileOperation.operation === "rename_file" &&
          props.fileOperation.path === pendingRename,
        localError: renameLocalError,
        serverError: renameServerError,
        start: (filePath) => {
          setRenamePath(filePath);
          setPendingRename(null);
          setRenameLocalError(null);
        },
        cancel: () => {
          setRenamePath(null);
          setPendingRename(null);
          setRenameLocalError(null);
        },
        submit: (filePath, raw, isDirectory) => {
          if (raw.trim() === "") {
            // An empty inline rename is an abandoned edit, not a recoverable
            // server error: restore the row instead of trapping focus in a field
            // that requires the user to retype something before they can leave.
            setRenamePath(null);
            setPendingRename(null);
            setRenameLocalError(null);
            return;
          }
          const request = renameRequest(raw, isDirectory);
          if ("error" in request) {
            setRenameLocalError(request.error);
            return;
          }
          setRenameLocalError(null);
          setPendingRename(filePath);
          props.onRenameFile?.(filePath, request.name);
        },
      }
    : undefined;

  // ---------------------------------------------------------------------------
  // Selection, the actions menu, drags and destination picking
  // ---------------------------------------------------------------------------
  const rootRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [picking, setPicking] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const draggedRef = useRef<string[] | null>(null);

  /** Every listed entry by path: what the menu and the drag rules read. */
  const entries = useMemo(() => {
    const map = new Map<string, DirEntry>();
    for (const [dir, listing] of Object.entries(props.tree)) {
      if (Array.isArray(listing)) for (const entry of listing) map.set(joinPath(dir, entry.name), entry);
    }
    return map;
  }, [props.tree]);

  // A path that left the listings leaves the selection, the menu and the picking:
  // a deleted file, or a whole project switched away from.
  useEffect(() => {
    const listed = listedPaths(props.tree);
    setSelected((current) => {
      const kept = [...current].filter((path) => listed.has(path));
      return kept.length === current.size ? current : new Set(kept);
    });
    if (anchorRef.current !== null && !listed.has(anchorRef.current)) anchorRef.current = null;
    setMenu((current) => (current && current.paths.every((path) => listed.has(path)) && listed.has(current.path) ? current : null));
    setPicking((current) => (current && current.every((path) => listed.has(path)) ? current : null));
  }, [props.tree]);

  const actionEntry = useCallback(
    (path: string): ActionEntry => {
      const entry = entries.get(path);
      const kind = entry && isDirectoryEntry(entry.type) ? "directory" : "file";
      return {
        path,
        kind,
        link: entry?.type === "symlink-file" || entry?.type === "symlink-directory",
        readOnly: isReadOnly(path, props.writableRoot),
        protectedRoot: typeof props.writableRoot === "string" && props.writableRoot !== "" && path === props.writableRoot,
        gitState: kind === "file" ? props.gitFiles?.[path] : undefined,
        attached: props.attachedPaths?.includes(path) ?? false,
      };
    },
    [entries, props.writableRoot, props.gitFiles, props.attachedPaths],
  );

  const handlers: ActionHandlers = {
    open: true,
    diff: props.onSelectDiff !== undefined,
    openNative: props.onOpenNative !== undefined,
    reveal: props.onRevealNative !== undefined,
    create: creation !== undefined,
    reference: props.onToggleAttachPath !== undefined,
    download: props.onDownload !== undefined,
    rename: rename !== undefined,
    move: props.onMoveFile !== undefined,
    moveMany: props.onMoveFiles !== undefined,
    delete: props.onDeleteFile !== undefined,
    deleteMany: props.onDeleteFiles !== undefined,
  };
  const lifecyclePending = props.fileOperation?.status === "pending";

  /** The paths a row acts on: the whole selection when it belongs to one, else itself. */
  const targetsOf = (path: string): string[] => (selected.size > 1 && selected.has(path) ? outermost(selected) : [path]);

  const startCreating = (dir: string) => {
    setOpen(dir, true);
    if (props.tree[dir] === undefined) props.onExpand(dir);
    creation?.start(dir);
  };

  const closeMenu = useCallback(() => {
    setMenu((current) => {
      current?.returnFocus?.focus();
      return null;
    });
  }, []);

  const runDelete = (paths: string[]) => {
    const targets = paths.map(actionEntry);
    if (!targets.every(mutable)) return;
    if (!window.confirm(deleteConfirmation(targets))) return;
    if (paths.length === 1) props.onDeleteFile?.(paths[0]);
    else props.onDeleteFiles?.(paths);
    setSelected(new Set());
  };

  const runMove = (paths: string[], destination: string) => {
    if (paths.length === 1) props.onMoveFile?.(paths[0], destination);
    else props.onMoveFiles?.(paths, destination);
    setSelected(new Set());
    setPicking(null);
  };

  const runAction = (id: RowActionId, paths: string[]) => {
    const [first] = paths;
    switch (id) {
      case "open":
        props.onSelectFile(first);
        break;
      case "show-diff":
        (props.onSelectDiff ?? props.onSelectFile)(first);
        break;
      case "open-native":
        props.onOpenNative?.(first);
        break;
      case "reveal":
        props.onRevealNative?.(first);
        break;
      case "new":
        startCreating(first);
        break;
      case "reference":
        for (const path of paths) if (!(props.attachedPaths?.includes(path) ?? false)) props.onToggleAttachPath?.(path);
        break;
      case "unreference":
        props.onToggleAttachPath?.(first);
        break;
      case "download": {
        const single = paths.length === 1 && actionEntry(first).kind === "file";
        setNotice(null);
        props.onDownload?.(paths, single).then(
          ({ skipped }) => {
            if (skipped > 0) setNotice({ kind: "info", text: `${skipped} ${skipped === 1 ? "entry was" : "entries were"} left out of the archive: ${skipped === 1 ? "it leads" : "they lead"} outside the workspace.` });
          },
          (error: unknown) => setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }),
        );
        break;
      }
      case "rename":
        rename?.start(first);
        break;
      case "move":
        setPicking(paths);
        break;
      case "delete":
        runDelete(paths);
        break;
    }
  };

  const ui: TreeUi = {
    selected,
    menuFor: menu?.path ?? null,
    picking,
    hasMenu: (path) => rowActions(targetsOf(path).map(actionEntry), handlers).length > 0,
    canDrag: (path) => {
      const paths = targetsOf(path);
      if (paths.length > 1) return props.onMoveFiles !== undefined && paths.every((p) => mutable(actionEntry(p)));
      const entry = actionEntry(path);
      if (entry.link || entry.protectedRoot) return false;
      return entry.readOnly ? props.onCopyFile !== undefined : props.onMoveFile !== undefined;
    },
    dragStart: (path, transfer) => {
      const paths = targetsOf(path);
      draggedRef.current = paths;
      const readOnly = paths.length === 1 && actionEntry(path).readOnly;
      transfer.effectAllowed = readOnly ? "copy" : "move";
      transfer.setData(FILE_DRAG_TYPE, path);
      if (readOnly) transfer.setData(FILE_COPY_DRAG_TYPE, "copy");
      if (paths.length > 1) transfer.setData(SELECTION_DRAG_TYPE, JSON.stringify(paths));
    },
    dragEnd: () => {
      draggedRef.current = null;
    },
    dragged: () => draggedRef.current,
    dropSelection: (destination, transfer) => {
      const raw = Array.from(transfer.types).includes(SELECTION_DRAG_TYPE) ? transfer.getData(SELECTION_DRAG_TYPE) : "";
      if (!raw) return false;
      let paths: unknown;
      try {
        paths = JSON.parse(raw);
      } catch {
        return false;
      }
      if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) return false;
      draggedRef.current = null;
      runMove(paths as string[], destination);
      return true;
    },
    click: (path, isDirectory, event) => {
      if (picking !== null) return isDirectory ? false : true;
      if (event.shiftKey && anchorRef.current !== null) {
        const rows = visibleRows(props.tree, openPaths).map((row) => row.path);
        const from = rows.indexOf(anchorRef.current);
        const to = rows.indexOf(path);
        if (from !== -1 && to !== -1) {
          event.preventDefault();
          setSelected(new Set(rows.slice(Math.min(from, to), Math.max(from, to) + 1)));
          return true;
        }
      }
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
        anchorRef.current = path;
        return true;
      }
      if (event.shiftKey) {
        // No anchor yet: the first Shift-click starts the range at this row.
        event.preventDefault();
        setSelected(new Set([path]));
        anchorRef.current = path;
        return true;
      }
      // A plain click on a folder opens or closes it: it starts a Shift range there but
      // selects nothing. Selected, it would cover every file Ctrl-clicked inside it
      // afterwards, and a deletion meant for those files would take the whole folder.
      setSelected(isDirectory ? new Set() : new Set([path]));
      anchorRef.current = path;
      return false;
    },
    openMenu: (path, anchor, returnFocus) => {
      const paths = targetsOf(path);
      if (paths.length === 1) {
        setSelected(new Set([path]));
        anchorRef.current = path;
      }
      setMenu({ path, paths, anchor, returnFocus });
    },
    menuAnchorFrom: (element) => {
      const root = rootRef.current?.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return root
        ? { left: rect.right - root.left - 192, top: rect.bottom - root.top, above: rect.top - root.top }
        : { left: 0, top: 0, above: 0 };
    },
    pointerAnchor: (event) => {
      const root = rootRef.current?.getBoundingClientRect();
      return root ? { left: event.clientX - root.left, top: event.clientY - root.top, above: event.clientY - root.top } : { left: 0, top: 0, above: 0 };
    },
    rowKeyDown: (path, event) => {
      if (event.key === "F2" && rename && !lifecyclePending) {
        const paths = targetsOf(path);
        if (paths.length === 1 && mutable(actionEntry(path))) {
          event.preventDefault();
          rename.start(path);
        }
      } else if ((event.key === "Delete" || event.key === "Backspace") && !lifecyclePending) {
        const paths = targetsOf(path);
        if (paths.length === 1 ? handlers.delete : handlers.deleteMany) {
          event.preventDefault();
          runDelete(paths);
        }
      } else if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && ui.hasMenu(path)) {
        event.preventDefault();
        ui.openMenu(path, ui.menuAnchorFrom(event.currentTarget), event.currentTarget);
      }
    },
    pick: (destination) => {
      if (picking) runMove(picking, destination);
    },
  };

  const menuGroups = menu ? rowActions(menu.paths.map(actionEntry), handlers) : [];
  const pendingOff = new Set<RowActionId>(lifecyclePending ? ["open-native", "reveal", "rename", "move", "delete"] : []);
  // The selection's own menu, laid out in a bar: the same actions, found without
  // having to aim at the ⋯ of a row that belongs to the selection.
  const selectionPaths = selected.size > 1 ? outermost(selected) : [];
  const barActions =
    selectionPaths.length > 0 && picking === null
      ? rowActions(selectionPaths.map(actionEntry), handlers)
          .flat()
          .filter((action) => action.id in BAR_LABEL || action.id === "unreference")
      : [];

  // The root has no row of its own, so its control sits above the listing —
  // without it the workspace root is the one directory nothing can be made in.
  const rootWritable = !isReadOnly("", props.writableRoot);
  const pickingLabel = picking ? (picking.length === 1 ? `"${picking[0].split("/").pop()}"` : `${picking.length} items`) : "";
  const copied = props.fileOperation?.status === "succeeded" && props.fileOperation.operation === "copy_file" ? (props.fileOperation.skipped ?? 0) : 0;

  return (
    <div
      ref={rootRef}
      className="relative text-sm"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (picking !== null) {
          event.preventDefault();
          setPicking(null);
        } else if (selected.size > 0) {
          event.preventDefault();
          setSelected(new Set());
          anchorRef.current = null;
        }
      }}
    >
      {imports && (
        <div
          data-drop-directory=""
          title={rootWritable ? "Drop files here to import into the workspace root" : "The workspace root is read-only"}
          className={`mb-1 rounded border border-dashed px-2 py-1 text-xs ${rootWritable ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-400 dark:text-zinc-600"} ${rootDropActive && rootWritable && !importing ? "bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-950/40" : "border-zinc-200 dark:border-zinc-800"}`}
          onDragOver={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (types.includes(FILE_DRAG_TYPE) && rootWritable && props.onMoveFile && (draggedRef.current ?? []).every((path) => path.includes("/"))) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = types.includes(FILE_COPY_DRAG_TYPE) ? "copy" : "move";
              setRootDropActive(true);
              return;
            }
            if (!types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = rootWritable && !importing ? "copy" : "none";
            setRootDropActive(rootWritable && !importing);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRootDropActive(false);
          }}
          onDrop={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (types.includes(FILE_DRAG_TYPE) && rootWritable) {
              event.preventDefault();
              event.stopPropagation();
              setRootDropActive(false);
              if (ui.dropSelection("", event.dataTransfer)) return;
              const source = event.dataTransfer.getData(FILE_DRAG_TYPE);
              if (!source || !source.includes("/")) return;
              if (types.includes(FILE_COPY_DRAG_TYPE)) props.onCopyFile?.(source, "");
              else props.onMoveFile?.(source, "");
              return;
            }
            if (!types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            setRootDropActive(false);
            if (rootWritable && !importingRef.current) imports.start("", event.dataTransfer);
          }}
        >Workspace root</div>
      )}
      {selected.size > 1 && picking === null && (
        <div
          role="toolbar"
          aria-label={`${selectionPaths.length} selected`}
          className="sticky top-0 z-20 mb-1 flex flex-wrap items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-900 shadow-sm dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
        >
          {/* What the actions act on: a folder and a file inside it are one entry. */}
          <span className="mr-1 font-medium">{selectionPaths.length} selected</span>
          {barActions.map((action) => (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              title={action.label}
              disabled={pendingOff.has(action.id)}
              onClick={() => runAction(action.id, selectionPaths)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-blue-100 disabled:opacity-40 dark:hover:bg-blue-900/60 ${action.danger ? "text-red-700 dark:text-red-300" : ""}`}
            >
              <span aria-hidden className="font-mono">{ROW_ACTION_SYMBOL[action.id]}</span>
              {BAR_LABEL[action.id] ?? action.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Clear the selection"
            title="Clear the selection (Esc)"
            onClick={() => {
              setSelected(new Set());
              anchorRef.current = null;
            }}
            className="ml-auto rounded px-1.5 py-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/60"
          >
            ✕
          </button>
        </div>
      )}
      {picking !== null && (
        <div role="status" className="mb-1 flex flex-wrap items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          <span className="min-w-0 flex-1">Moving {pickingLabel}: choose a folder</span>
          {rootWritable && picking.every((path) => path.includes("/")) && (
            <button
              type="button"
              onClick={() => runMove(picking, "")}
              aria-label="Move here: the workspace root"
              className="rounded border border-blue-300 px-1.5 hover:bg-blue-100 dark:border-blue-800 dark:hover:bg-blue-900/50"
            >
              Workspace root
            </button>
          )}
          <button
            type="button"
            onClick={() => setPicking(null)}
            className="rounded px-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/50"
          >
            Cancel
          </button>
        </div>
      )}
      {importing && <p role="status" className="mb-1 px-2 text-xs text-zinc-500">Importing files…</p>}
      {importPaths.length > 0 && <p role="status" className="mb-1 break-words px-2 text-xs text-emerald-700 dark:text-emerald-400">Imported: {importPaths.join(", ")}</p>}
      {importErrors.map((error, index) => <p key={index} role="alert" className="mb-1 break-words px-2 text-xs text-red-600 dark:text-red-400">{error}</p>)}
      {props.fileOperation?.status === "error" && props.fileOperation.operation !== "rename_file" && (
        <p role="alert" className="mb-1 break-words rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {props.fileOperation.message}
        </p>
      )}
      {copied > 0 && (
        <p role="status" className="mb-1 px-2 text-xs text-zinc-500 dark:text-zinc-400">
          {copied} {copied === 1 ? "entry was" : "entries were"} left out of the copy: {copied === 1 ? "it leads" : "they lead"} outside the workspace.
        </p>
      )}
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`mb-1 break-words px-2 text-xs ${notice.kind === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
          {notice.text}
        </p>
      )}
      {((creation && rootWritable) || props.onRefresh) && (
        <div className="mb-1 flex items-center">
          {creation && rootWritable && (
            <button
              type="button"
              onClick={() => creation.start("")}
              aria-label="New file or folder in the workspace root"
              className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
            >
              + new
            </button>
          )}
          {props.onRefresh && (
            <button
              type="button"
              onClick={props.onRefresh}
              title="Refresh the file tree"
              aria-label="Refresh the file tree"
              // Not hidden until hover like the row controls: those repeat on every
              // row and would drown the tree, this one is a single control for the
              // whole panel — and it is the way out of a tree that has gone stale,
              // which is not a state you can see before you look for the way out.
              className="ml-auto rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
            >
              ↻
            </button>
          )}
        </div>
      )}
      <DirChildren
        path=""
        depth={0}
        {...props}
        imports={imports}
        openPaths={openPaths}
        setOpen={setOpen}
        ui={ui}
        {...(creation ? { creation } : {})}
        {...(rename ? { rename } : {})}
      />
      {menu && menuGroups.length > 0 && (
        <RowMenu
          key={`${menu.path}:${menu.anchor.left}:${menu.anchor.top}`}
          label={menu.paths.length === 1 ? `Actions for ${menu.path.split("/").pop()}` : `Actions for ${menu.paths.length} items`}
          groups={menuGroups}
          anchor={menu.anchor}
          disabled={pendingOff}
          onClose={closeMenu}
          onSelect={(id) => {
            const paths = menu.paths;
            setMenu(null);
            runAction(id, paths);
          }}
        />
      )}
    </div>
  );
}
