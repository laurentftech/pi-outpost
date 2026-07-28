import { useEffect } from "react";
import type { GitShowState } from "../useAgent";

type PatchRow =
  | { kind: "file"; text: string }
  | { kind: "hunk"; text: string }
  | { kind: "add" | "del" | "context"; text: string };

/** Classify unified-patch lines for rendering; anything exotic falls back to context. */
function parsePatch(patch: string): PatchRow[] {
  return patch.split("\n").map((line): PatchRow => {
    if (line.startsWith("diff --git ")) return { kind: "file", text: line.slice("diff --git ".length) };
    if (line.startsWith("@@")) return { kind: "hunk", text: line };
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ")) return { kind: "hunk", text: line };
    if (line.startsWith("+")) return { kind: "add", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "del", text: line.slice(1) };
    return { kind: "context", text: line.startsWith(" ") ? line.slice(1) : line };
  });
}

/** Full-pane view of one commit's patch (opened from the git history menu). */
export function GitCommitView({ show, onClose }: { show: GitShowState; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Capture + stop: this pane can sit above the file viewer, whose own
        // Escape handler must not also fire (one Esc = close one overlay)
        event.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="font-mono text-xs text-amber-600 dark:text-amber-500">{show.sha.slice(0, 12)}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-500 dark:text-zinc-400">commit diff</span>
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close commit diff"
          className="shrink-0 px-1 text-sm text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
        >
          ✕
        </button>
      </div>
      {show.truncated && (
        <div className="border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          Patch truncated — showing the first 256 KiB.
        </div>
      )}
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
        {parsePatch(show.patch).map((row, i) => (
          <div
            key={i}
            className={
              row.kind === "file"
                ? "mt-3 border-t border-zinc-200 pt-2 font-bold text-zinc-700 first:mt-0 first:border-t-0 first:pt-0 dark:border-zinc-800 dark:text-zinc-200"
                : row.kind === "hunk"
                  ? "text-sky-600 dark:text-sky-400"
                  : row.kind === "add"
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : row.kind === "del"
                      ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                      : "text-zinc-500 dark:text-zinc-500"
            }
          >
            {row.kind === "add" ? "+ " : row.kind === "del" ? "− " : ""}
            {row.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
