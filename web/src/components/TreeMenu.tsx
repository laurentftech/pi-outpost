import { useEffect, useRef, useState } from "react";
import type { TreeNode } from "@pi-outpost/shared";

interface TreeMenuProps {
  tree: TreeNode[] | null;
  isStreaming: boolean;
  onListTree: () => void;
  onNavigate: (entryId: string) => void;
  onFork: (entryId: string) => void;
}

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

function TreeRow({
  node,
  depth,
  isStreaming,
  onNavigate,
  onFork,
  onClose,
}: {
  node: TreeNode;
  depth: number;
  isStreaming: boolean;
  onNavigate: (entryId: string) => void;
  onFork: (entryId: string) => void;
  onClose: () => void;
}) {
  const isLeafOfPath = node.onPath && !node.children.some((child) => child.onPath);
  return (
    <>
      <div
        className={`group flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
          node.onPath ? "bg-zinc-100/70 dark:bg-zinc-800/50" : ""
        }`}
      >
        <button
          type="button"
          disabled={isStreaming}
          onClick={() => {
            onNavigate(node.entryId);
            onClose();
          }}
          title={isStreaming ? "unavailable while the agent is running" : "go back to this point"}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left text-sm disabled:opacity-50"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <span
            aria-hidden
            className={node.onPath ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-300 dark:text-zinc-600"}
          >
            {node.onPath ? (isLeafOfPath ? "●" : "│") : "○"}
          </span>
          <span className="truncate text-zinc-700 dark:text-zinc-300">{node.text || "(empty)"}</span>
          {node.label && (
            <span className="shrink-0 rounded bg-violet-100 px-1 text-[10px] text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
              {node.label}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            onFork(node.entryId);
            onClose();
          }}
          title="fork a new session from this point"
          className="mr-2 shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          ⑂ fork
        </button>
      </div>
      {node.children.map((child) => (
        <TreeRow
          key={child.entryId}
          node={child}
          // Indent only at branch points (git-log style): a linear conversation
          // stays flat instead of nesting one level per message
          depth={depth + (node.children.length > 1 ? 1 : 0)}
          isStreaming={isStreaming}
          onNavigate={onNavigate}
          onFork={onFork}
          onClose={onClose}
        />
      ))}
    </>
  );
}

/**
 * Conversation tree dropdown: every user message is a point to jump back to
 * (same session file, branches preserved) or to fork into a new session.
 */
export function TreeMenu({ tree, isStreaming, onListTree, onNavigate, onFork }: TreeMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  // Snapshots reset the tree to null (session switched, branch changed):
  // refetch instead of stranding an open menu on "loading…"
  useEffect(() => {
    if (open && tree === null) onListTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tree]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) onListTree();
        }}
        title="conversation tree: go back to an earlier point or fork"
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
      >
        tree
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-96 w-[28rem] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {tree === null && <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>}
          {tree?.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">no messages yet</div>}
          {tree && tree.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {countNodes(tree)} points · click to rewind · ⑂ to fork
              </div>
              {tree.map((node) => (
                <TreeRow
                  key={node.entryId}
                  node={node}
                  depth={0}
                  isStreaming={isStreaming}
                  onNavigate={onNavigate}
                  onFork={onFork}
                  onClose={() => setOpen(false)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
