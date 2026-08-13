import { useEffect, useRef, useState } from "react";
import type { DirEntry, GitFileState } from "@pi-outpost/shared";
import type { DirState } from "../useAgent";

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
  onSelectFile: (path: string) => void;
  /** Open the file directly on its uncommitted diff (badge click). */
  onSelectDiff?: (path: string) => void;
  /** Attach the file to the composer as an `@path` reference, or drop it if already attached. */
  onToggleAttachPath?: (path: string) => void;
  /** Create an empty file at this path. Absent = no creation affordance at all. */
  onCreateFile?: (path: string) => void;
  /** Create one directory at this path. */
  onCreateDirectory?: (path: string) => void;
  /** The server's refusal of the last creation request, if it refused one. */
  createError?: { path: string; message: string } | null;
  /** Path the last creation produced — the only definite sign that it worked. */
  created?: string | null;
  /** Internal: the open input row. Supplied by `FileTree` to its own rows. */
  creation?: CreationState;
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
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const readOnly = isReadOnly(fullPath, props.writableRoot);

  if (isDir(entry.type)) {
    // Creating needs the directory open: the input row lives among its children,
    // and a name typed into a collapsed directory would have nowhere to appear.
    const startCreating = () => {
      setOpen(true);
      if (props.tree[fullPath] === undefined) props.onExpand(fullPath);
      props.creation?.start(fullPath);
    };
    return (
      <div>
        <div className="group flex w-full items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <button
            type="button"
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next && props.tree[fullPath] === undefined) props.onExpand(fullPath);
            }}
            style={{ paddingLeft: depth * 12 }}
            className="flex min-w-0 flex-1 items-center gap-1 rounded py-0.5 text-left"
          >
            <span className="w-3 shrink-0 text-xs text-zinc-400 dark:text-zinc-600">{open ? "▾" : "▸"}</span>
            <span
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
  return (
    <div
      className={`group flex w-full items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        selected ? "bg-zinc-100 dark:bg-zinc-800" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => props.onSelectFile(fullPath)}
        style={{ paddingLeft: depth * 12 + 16 }}
        className="flex min-w-0 flex-1 items-center py-0.5 text-left"
      >
        <span className={`truncate ${readOnly ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-600 dark:text-zinc-400"}`}>
          {entry.name}
        </span>
      </button>
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

/** Lazily-loaded file/directory tree for the sidebar. */
export function FileTree(props: TreeProps) {
  const [openIn, setOpenIn] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /** What was asked for, so the input can close once the tree shows it. */
  const [pending, setPending] = useState<{ dir: string; name: string } | null>(null);

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

  // The root has no row of its own, so its control sits above the listing —
  // without it the workspace root is the one directory nothing can be made in.
  const rootWritable = !isReadOnly("", props.writableRoot);

  return (
    <div className="text-sm">
      {creation && rootWritable && (
        <button
          type="button"
          onClick={() => creation.start("")}
          aria-label="New file or folder in the workspace root"
          className="mb-1 rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
        >
          + new
        </button>
      )}
      <DirChildren path="" depth={0} {...props} {...(creation ? { creation } : {})} />
    </div>
  );
}

function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}
