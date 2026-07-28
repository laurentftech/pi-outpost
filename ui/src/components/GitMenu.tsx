import { useEffect, useRef, useState } from "react";
import type { GitLogEntry } from "@pi-outpost/shared";
import type { GitStatusState } from "../useAgent";

interface GitMenuProps {
  status: GitStatusState | null;
  log: GitLogEntry[] | null;
  onFetchLog: () => void;
  onShowCommit: (sha: string) => void;
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

function relativeDate(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 90) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** Header branch chip; opens the recent-commit history, click a commit for its diff. */
export function GitMenu({ status, log, onFetchLog, onShowCommit }: GitMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const counts =
    status && (status.ahead > 0 || status.behind > 0)
      ? ` ${status.ahead > 0 ? `↑${status.ahead}` : ""}${status.behind > 0 ? `↓${status.behind}` : ""}`
      : "";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) onFetchLog();
        }}
        title="git history"
        className="rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
      >
        ⎇ {status?.branch ?? "…"}
        {counts}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-96 w-[26rem] max-w-[80vw] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {log === null && <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>}
          {log?.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">no commits</div>}
          {log?.map((entry) => (
            <button
              key={entry.sha}
              type="button"
              onClick={() => {
                onShowCommit(entry.sha);
                setOpen(false);
              }}
              className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="shrink-0 font-mono text-xs text-amber-600 dark:text-amber-500">{entry.sha.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{entry.subject}</span>
              <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-600">
                {entry.author} · {relativeDate(entry.date)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
