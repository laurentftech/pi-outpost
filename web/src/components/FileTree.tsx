import { useState } from "react";
import type { DirEntry, GitFileState } from "@pi-outpost/shared";
import type { DirState } from "../useAgent";

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

function DirChildren({ path, depth, ...props }: TreeProps & { path: string; depth: number }) {
  const state = props.tree[path];
  if (state === undefined) return null;
  if (state === "loading") {
    return (
      <div style={{ paddingLeft: depth * 12 + 4 }} className="py-0.5 text-xs text-zinc-400 dark:text-zinc-600">
        loading…
      </div>
    );
  }
  if ("error" in state) {
    return (
      <div style={{ paddingLeft: depth * 12 + 4 }} className="py-0.5 text-xs text-red-600 dark:text-red-400">
        {state.error}
      </div>
    );
  }
  if (state.length === 0) {
    return (
      <div style={{ paddingLeft: depth * 12 + 4 }} className="py-0.5 text-xs text-zinc-400 dark:text-zinc-600">
        empty
      </div>
    );
  }
  return (
    <>
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
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next && props.tree[fullPath] === undefined) props.onExpand(fullPath);
          }}
          style={{ paddingLeft: depth * 12 }}
          className="flex w-full items-center gap-1 rounded py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
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

/** Lazily-loaded file/directory tree for the sidebar. */
export function FileTree(props: TreeProps) {
  return (
    <div className="text-sm">
      <DirChildren path="" depth={0} {...props} />
    </div>
  );
}
