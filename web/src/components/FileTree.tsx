import { useState } from "react";
import type { DirEntry } from "@pi-interface/shared";
import type { DirState } from "../useAgent";

interface TreeProps {
  tree: Record<string, DirState>;
  openFilePath?: string;
  onExpand: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function isDir(type: DirEntry["type"]): boolean {
  return type === "directory" || type === "symlink-directory";
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
          <span className="truncate text-zinc-700 dark:text-zinc-300">{entry.name}</span>
        </button>
        {open && <DirChildren path={fullPath} depth={depth + 1} {...props} />}
      </div>
    );
  }

  const selected = fullPath === props.openFilePath;
  return (
    <button
      type="button"
      onClick={() => props.onSelectFile(fullPath)}
      style={{ paddingLeft: depth * 12 + 16 }}
      className={`flex w-full items-center rounded py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        selected ? "bg-zinc-100 dark:bg-zinc-800" : ""
      }`}
    >
      <span className="truncate text-zinc-600 dark:text-zinc-400">{entry.name}</span>
    </button>
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
