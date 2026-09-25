import { useEffect } from "react";
import type { GitFileState } from "@pi-outpost/shared";
import type { DirState, FileOperationState, OpenFile } from "../useAgent";
import { FILES_SIDEBAR_WIDTH } from "../util/panelWidth";
import { FileTree } from "./FileTree";
import { PanelResizeHandle, useResizablePanelWidth } from "./PanelResizeHandle";

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
  onSelectDirectory?: (path: string) => void;
  /** Re-list every directory the tree is holding. */
  onRefresh?: () => void;
  onSelectFile: (path: string) => void;
  onSelectDiff?: (path: string) => void;
  onToggleAttachPath?: (path: string) => void;
  /** Create an empty file at this path (and open it). */
  onCreateFile?: (path: string) => void;
  onCreateDirectory?: (path: string) => void;
  onOpenNative?: (path: string) => void;
  onRevealNative?: (path: string) => void;
  onRenameFile?: (path: string, name: string) => void;
  onDeleteFile?: (path: string) => void;
  onMoveFile?: (path: string, destinationDirectory: string) => void;
  onCopyFile?: (path: string, destinationDirectory: string) => void;
  fileOperation?: FileOperationState | null;
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
  onSelectDirectory,
  onRefresh,
  onSelectFile,
  onSelectDiff,
  onToggleAttachPath,
  onCreateFile,
  onCreateDirectory,
  onOpenNative,
  onRevealNative,
  onRenameFile,
  onDeleteFile,
  onMoveFile,
  onCopyFile,
  fileOperation,
  createError,
  created,
}: SidebarProps) {
  const resize = useResizablePanelWidth(FILES_SIDEBAR_WIDTH);

  // First open arms the browser root. Keeping it listed afterwards — across
  // reconnects and session snapshots, which clear the tree — is useAgent's job
  // (see its "keep the file-browser root listed" effect); this only has to fire
  // the initial request.
  useEffect(() => {
    if (tree[""] === undefined) onExpand("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside
      aria-label="Files"
      style={{ width: resize.width }}
      className="relative flex shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800"
    >
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
          onSelectDirectory={onSelectDirectory}
          onRefresh={onRefresh}
          onSelectFile={onSelectFile}
          onSelectDiff={onSelectDiff}
          onToggleAttachPath={onToggleAttachPath}
          onCreateFile={onCreateFile}
          onCreateDirectory={onCreateDirectory}
          onOpenNative={onOpenNative}
          onRevealNative={onRevealNative}
          onRenameFile={onRenameFile}
          onDeleteFile={onDeleteFile}
          onMoveFile={onMoveFile}
          onCopyFile={onCopyFile}
          fileOperation={fileOperation}
          createError={createError}
          created={created}
        />
      </div>
      <PanelResizeHandle
        label="Resize Files sidebar"
        width={resize.width}
        config={FILES_SIDEBAR_WIDTH}
        separatorProps={resize.separatorProps}
      />
    </aside>
  );
}
