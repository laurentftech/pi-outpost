import { useEffect } from "react";
import type { DirState, OpenFile } from "../useAgent";
import { FilePreview } from "./FilePreview";
import { FileTree } from "./FileTree";

interface SidebarProps {
  tree: Record<string, DirState>;
  openFile: OpenFile | null;
  onExpand: (path: string) => void;
  onSelectFile: (path: string) => void;
  onClosePreview: () => void;
}

/** Collapsible file-browser sidebar: lazy tree + read-only preview. */
export function Sidebar({ tree, openFile, onExpand, onSelectFile, onClosePreview }: SidebarProps) {
  useEffect(() => {
    if (tree[""] === undefined) onExpand("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
      <div className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold uppercase text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
        Files
      </div>
      <div className={`overflow-auto p-2 ${openFile ? "max-h-[40%]" : "flex-1"}`}>
        <FileTree tree={tree} openFilePath={openFile?.path} onExpand={onExpand} onSelectFile={onSelectFile} />
      </div>
      {openFile && (
        <div className="min-h-0 flex-1 border-t border-zinc-200 dark:border-zinc-800">
          <FilePreview file={openFile} onClose={onClosePreview} />
        </div>
      )}
    </aside>
  );
}
