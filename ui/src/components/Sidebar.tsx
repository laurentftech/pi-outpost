import { useEffect } from "react";
import type { GitFileState } from "@pi-outpost/shared";
import type { DirState, OpenFile } from "../useAgent";
import { FileTree } from "./FileTree";

interface SidebarProps {
  tree: Record<string, DirState>;
  openFile: OpenFile | null;
  /** Writable zone in the tree; see SessionSnapshot.writableRoot. */
  writableRoot?: string | null;
  /** Git status per path, for tree badges. */
  gitFiles?: Record<string, GitFileState>;
  /** Paths already referenced by the composer, so the tree can show the toggle as active. */
  attachedPaths?: string[];
  onExpand: (path: string) => void;
  onSelectFile: (path: string) => void;
  onSelectDiff?: (path: string) => void;
  onToggleAttachPath?: (path: string) => void;
  /** Create an empty file at this path (and open it). */
  onCreateFile?: (path: string) => void;
  onCreateDirectory?: (path: string) => void;
  /** The server's refusal of the last creation request. */
  createError?: { path: string; message: string } | null;
  /** Path the last creation produced. */
  created?: string | null;
}

/** Collapsible file-browser sidebar: lazy tree; selecting a file opens the FileViewer overlay. */
export function Sidebar({
  tree,
  openFile,
  writableRoot,
  gitFiles,
  attachedPaths,
  onExpand,
  onSelectFile,
  onSelectDiff,
  onToggleAttachPath,
  onCreateFile,
  onCreateDirectory,
  createError,
  created,
}: SidebarProps) {
  useEffect(() => {
    if (tree[""] === undefined) onExpand("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
      <div className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold uppercase text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
        Files
      </div>
      <div className="flex-1 overflow-auto p-2">
        <FileTree
          tree={tree}
          openFilePath={openFile?.path}
          writableRoot={writableRoot}
          gitFiles={gitFiles}
          attachedPaths={attachedPaths}
          onExpand={onExpand}
          onSelectFile={onSelectFile}
          onSelectDiff={onSelectDiff}
          onToggleAttachPath={onToggleAttachPath}
          onCreateFile={onCreateFile}
          onCreateDirectory={onCreateDirectory}
          createError={createError}
          created={created}
        />
      </div>
    </aside>
  );
}
