import { useEffect, useRef, useState } from "react";
import type { DirEntry, GitFileState } from "@pi-outpost/shared";
import type { DirState, FileOperationState } from "../useAgent";

const FILE_DRAG_TYPE = "application/x-pi-outpost-file";
const FILE_COPY_DRAG_TYPE = "application/x-pi-outpost-read-only-file";
const ROW_ACTION_CLASS =
  "mr-1 shrink-0 rounded px-1 text-xs text-zinc-400 hover:bg-zinc-200 group-hover:opacity-100 focus-visible:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-700 [@media(hover:hover)]:opacity-0";

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
  submit: (path: string, raw: string) => void;
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
  /** Attach the file to the composer as an `@path` reference, or drop it if already attached. */
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
  onRenameFile?: (path: string, name: string) => void;
  onDeleteFile?: (path: string) => void;
  onMoveFile?: (path: string, destinationDirectory: string) => void;
  onCopyFile?: (path: string, destinationDirectory: string) => void;
  fileOperation?: FileOperationState | null;
  /** The server's refusal of the last creation request, if it refused one. */
  createError?: { path: string; message: string } | null;
  /** Path the last creation produced — the only definite sign that it worked. */
  created?: string | null;
  /** Internal: the open input row. Supplied by `FileTree` to its own rows. */
  creation?: CreationState;
  /** Internal: the active in-tree rename input. */
  rename?: RenameState;
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

function isDir(type: DirEntry["type"]): boolean {
  return type === "directory" || type === "symlink-directory";
}

/** undefined writableRoot = no sandbox, nothing to dim; null = the whole tree is read-only. */
function isReadOnly(fullPath: string, writableRoot: string | null | undefined): boolean {
  if (writableRoot === undefined) return false;
  if (writableRoot === null) return true;
  if (writableRoot === "") return false;
  return fullPath !== writableRoot && !fullPath.startsWith(`${writableRoot}/`);
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

function RenameRow({ path: filePath, name, depth, rename }: { path: string; name: string; depth: number; rename: RenameState }) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const error = rename.localError ?? rename.serverError;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div style={{ paddingLeft: depth * 12 + 16 }} className="py-0.5">
      <input
        ref={inputRef}
        value={value}
        disabled={rename.pending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !rename.pending) {
            event.preventDefault();
            rename.submit(filePath, value);
          } else if (event.key === "Escape") {
            event.preventDefault();
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

function TreeNode({
  parentPath,
  entry,
  depth,
  ...props
}: TreeProps & { parentPath: string; entry: DirEntry; depth: number }) {
  const [open, setOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const readOnly = isReadOnly(fullPath, props.writableRoot);
  const lifecyclePending = props.fileOperation?.status === "pending";

  if (isDir(entry.type)) {
    const acceptsDrop = !readOnly && !lifecyclePending;
    const transferFor = (types: readonly string[]) =>
      types.includes(FILE_COPY_DRAG_TYPE)
        ? props.onCopyFile === undefined
          ? null
          : "copy"
        : props.onMoveFile === undefined
          ? null
          : "move";
    // Creating needs the directory open: the input row lives among its children,
    // and a name typed into a collapsed directory would have nowhere to appear.
    const startCreating = () => {
      setOpen(true);
      if (props.tree[fullPath] === undefined) props.onExpand(fullPath);
      props.creation?.start(fullPath);
    };
    return (
      <div>
        <div
          className={`group flex w-full items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${dropActive ? "bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-950/40" : ""}`}
          onDragOver={(event) => {
            if (!acceptsDrop || !Array.from(event.dataTransfer.types).includes(FILE_DRAG_TYPE)) return;
            const transfer = transferFor(Array.from(event.dataTransfer.types));
            if (transfer === null) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = transfer;
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            if (!acceptsDrop) return;
            const source = event.dataTransfer.getData(FILE_DRAG_TYPE);
            const transfer = source ? transferFor(Array.from(event.dataTransfer.types)) : null;
            if (transfer === null) return;
            event.preventDefault();
            event.stopPropagation();
            setDropActive(false);
            if (transfer === "copy") props.onCopyFile?.(source, fullPath);
            else props.onMoveFile?.(source, fullPath);
          }}
        >
          <button
            type="button"
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next && props.tree[fullPath] === undefined) props.onExpand(fullPath);
              props.onSelectDirectory?.(fullPath);
            }}
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
            {!open && dirChangeCount(fullPath, props.gitFiles) > 0 && (
              <span
                className="ml-1 shrink-0 rounded bg-amber-100 px-1 font-mono text-[10px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                title={`${dirChangeCount(fullPath, props.gitFiles)} changed file(s) inside`}
              >
                {dirChangeCount(fullPath, props.gitFiles)}
              </span>
            )}
          </button>
          {props.onRevealNative && (
            <button
              type="button"
              disabled={lifecyclePending}
              onClick={() => props.onRevealNative?.(fullPath)}
              title="Show in the file manager"
              aria-label={`Show ${entry.name} in the file manager`}
              className={ROW_ACTION_CLASS}
            >
              ⌂
            </button>
          )}
          {props.creation && !readOnly && (
            <button
              type="button"
              onClick={startCreating}
              title="New file or folder here"
              aria-label={`New file or folder in ${entry.name}`}
              // Same reveal rule as the `@` control: hidden until hover, because an
              // icon on every row drowns the tree — but always present on a touch
              // screen, where a hidden control is an invisible tap target.
              className="mr-1 shrink-0 rounded px-1 font-mono text-xs text-zinc-400 hover:bg-zinc-200 group-hover:opacity-100 focus-visible:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-700 [@media(hover:hover)]:opacity-0"
            >
              +
            </button>
          )}
        </div>
        {open && <DirChildren path={fullPath} depth={depth + 1} {...props} />}
      </div>
    );
  }

  const selected = fullPath === props.openFilePath;
  const gitState = props.gitFiles?.[fullPath];
  const attached = props.attachedPaths?.includes(fullPath) ?? false;
  const regularFile = entry.type === "file";
  const nativeOpenable = regularFile || entry.type === "symlink-file";
  const mutable = regularFile && !readOnly;
  const transferable = regularFile && (readOnly ? props.onCopyFile !== undefined : props.onMoveFile !== undefined);
  if (props.rename?.path === fullPath) {
    return <RenameRow path={fullPath} name={entry.name} depth={depth} rename={props.rename} />;
  }
  return (
    <div
      className={`group flex w-full items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        selected ? "bg-zinc-100 dark:bg-zinc-800" : ""
      }`}
    >
      <button
        type="button"
        draggable={transferable && !lifecyclePending}
        onDragStart={(event) => {
          if (!transferable || lifecyclePending) return;
          event.dataTransfer.effectAllowed = readOnly ? "copy" : "move";
          event.dataTransfer.setData(FILE_DRAG_TYPE, fullPath);
          if (readOnly) event.dataTransfer.setData(FILE_COPY_DRAG_TYPE, "copy");
        }}
        onClick={() => props.onSelectFile(fullPath)}
        style={{ paddingLeft: depth * 12 + 16 }}
        className="flex min-w-0 flex-1 items-center py-0.5 text-left"
      >
        <span
          title={entry.name}
          className={`truncate ${readOnly ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-600 dark:text-zinc-400"}`}
        >
          {entry.name}
        </span>
      </button>
      {nativeOpenable && props.onOpenNative && (
        <button
          type="button"
          disabled={lifecyclePending}
          onClick={() => props.onOpenNative?.(fullPath)}
          title="Open with the associated application"
          aria-label={`Open ${entry.name} with the associated application`}
          className={ROW_ACTION_CLASS}
        >
          ↗
        </button>
      )}
      {props.onRevealNative && (
        <button
          type="button"
          disabled={lifecyclePending}
          onClick={() => props.onRevealNative?.(fullPath)}
          title="Show in the file manager"
          aria-label={`Show ${entry.name} in the file manager`}
          className={ROW_ACTION_CLASS}
        >
          ⌂
        </button>
      )}
      {mutable && props.onRenameFile && (
        <button
          type="button"
          disabled={lifecyclePending}
          onClick={() => props.rename?.start(fullPath)}
          title="Rename file"
          aria-label={`Rename ${entry.name}`}
          className={ROW_ACTION_CLASS}
        >
          ✎
        </button>
      )}
      {mutable && props.onDeleteFile && (
        <button
          type="button"
          disabled={lifecyclePending}
          onClick={() => {
            if (window.confirm(`Delete "${entry.name}" permanently?`)) props.onDeleteFile?.(fullPath);
          }}
          title="Delete file"
          aria-label={`Delete ${entry.name}`}
          className={`${ROW_ACTION_CLASS} hover:text-red-600 dark:hover:text-red-400`}
        >
          ×
        </button>
      )}
      {props.onToggleAttachPath && (
        <button
          type="button"
          onClick={() => props.onToggleAttachPath?.(fullPath)}
          title={attached ? "Remove this file from the prompt" : "Reference this file in the prompt"}
          aria-label={`${attached ? "Remove" : "Reference"} ${entry.name} in the prompt`}
          aria-pressed={attached}
          // Referenced: the pin stays lit, so the tree at rest says what the next prompt carries —
          // whether the reference came from a chip or from an `@` the user typed. Otherwise the pin
          // only appears on hover (an icon on every row drowns the tree), except on a touch screen,
          // which has no hover and where a hidden control is an invisible tap target.
          className={`mr-1 shrink-0 rounded px-1 font-mono text-xs hover:bg-zinc-200 group-hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-zinc-700 ${
            attached
              ? "font-bold text-blue-600 dark:text-blue-400"
              : "text-zinc-400 dark:text-zinc-600 [@media(hover:hover)]:opacity-0"
          }`}
        >
          @
        </button>
      )}
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

export function renameRequest(raw: string): { name: string } | { error: string } {
  const request = creationRequest(raw);
  if ("error" in request) return request;
  if (request.kind === "directory") return { error: "That is a folder name" };
  return { name: request.name };
}

/** Lazily-loaded file/directory tree for the sidebar. */
export function FileTree(props: TreeProps) {
  const [openIn, setOpenIn] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /** What was asked for, so the input can close once the tree shows it. */
  const [pending, setPending] = useState<{ dir: string; name: string } | null>(null);
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
    setOpenIn(null);
    setPending(null);
    setLocalError(null);
  }, [pending, created]);

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
          setPending({ dir, name: request.name });
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
        submit: (filePath, raw) => {
          if (raw.trim() === "") {
            // An empty inline rename is an abandoned edit, not a recoverable
            // server error: restore the row instead of trapping focus in a field
            // that requires the user to retype something before they can leave.
            setRenamePath(null);
            setPendingRename(null);
            setRenameLocalError(null);
            return;
          }
          const request = renameRequest(raw);
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

  // The root has no row of its own, so its control sits above the listing —
  // without it the workspace root is the one directory nothing can be made in.
  const rootWritable = !isReadOnly("", props.writableRoot);

  return (
    <div className="text-sm">
      {props.fileOperation?.status === "error" && props.fileOperation.operation !== "rename_file" && (
        <p role="alert" className="mb-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {props.fileOperation.message}
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
      <DirChildren path="" depth={0} {...props} {...(creation ? { creation } : {})} {...(rename ? { rename } : {})} />
    </div>
  );
}

function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}
