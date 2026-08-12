import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WORKTREE_REVISION, type GitRevision } from "@pi-outpost/shared";
import type { GitFileDiffState, GitFileHistoryState } from "../useAgent";
import { diffLines } from "../util/diff";
import { SplitDiffBlock } from "./DiffBlocks";
import { Rail } from "./graph/Rail";
import { layoutFileGraph, type FileGraphRow } from "./graph/fileGraph";
import { ROW_H } from "./graph/lanes";

interface GitFileHistoryProps {
  history: GitFileHistoryState;
  diff: GitFileDiffState | null;
  /** The file carries uncommitted changes — draws the working-tree rail solid. */
  dirty: boolean;
  onFetchDiff: (base: GitRevision, target: GitRevision) => void;
  onClearDiff: () => void;
  onClose: () => void;
}

type Role = "base" | "target";

/** The two slots, held together so no update can leave them on the same revision. */
interface Selection {
  base: GitRevision | null;
  target: GitRevision | null;
}

/** Width of the bracket gutter, in px — one bracket, never nested. */
const GUTTER_W = 20;

function relativeDate(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 90) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function revisionLabel(revision: GitRevision): string {
  return revision.rev === WORKTREE_REVISION ? "working tree" : revision.rev.slice(0, 7);
}

function sameRevision(a: GitRevision | null, b: GitRevision | null): boolean {
  return a !== null && b !== null && a.rev === b.rev && a.path === b.path;
}

function toRevision(row: FileGraphRow): GitRevision {
  return { rev: row.rev, path: row.path };
}

/**
 * A file's history as a graph, and the diff between any two of its revisions.
 *
 * Opens over the file viewer with the same overlay and Escape handling as the
 * commit-diff pane, so one Escape closes one layer.
 */
export function GitFileHistory({ history, diff, dirty, onFetchDiff, onClearDiff, onClose }: GitFileHistoryProps) {
  // One piece of state, not two: every rule below has to read *both* slots to
  // decide, and two setters batched in one event would each see the other's stale
  // value — which is how base and target could end up on the same revision.
  const [pair, setPair] = useState<Selection>({ base: null, target: null });
  const { base, target } = pair;
  const [focused, setFocused] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { rows, laneCount } = useMemo(() => layoutFileGraph(history.entries, { dirty }), [history.entries, dirty]);

  // useAgent hands back a fresh object of inline callbacks on every render, so
  // these props change identity constantly. Depending on them directly would
  // re-run the effects below on every render — for the diff effect that is an
  // endless request loop, which the pane renders as a flicker between its
  // loading and loaded states.
  const callbacks = useRef({ onFetchDiff, onClose });
  callbacks.current = { onFetchDiff, onClose };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Capture + stop: the file viewer underneath has its own Escape handler,
      // and one Escape must close one overlay
      event.stopImmediatePropagation();
      callbacks.current.onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Ask for the diff whenever a complete, non-degenerate pair is selected
  useEffect(() => {
    if (base === null || target === null || sameRevision(base, target)) return;
    callbacks.current.onFetchDiff(base, target);
  }, [base, target]);

  /**
   * Every selection goes through here, and every one of them moves something —
   * a click that silently does nothing reads as a broken button. Landing a role
   * on the row that already holds the other role swaps the two rather than being
   * refused, which is both visible and the thing you probably meant.
   */
  const select = useCallback(
    (row: FileGraphRow, role?: Role) => {
      const revision = toRevision(row);
      setPair((current) => {
        if (role === "base") {
          return { base: revision, target: sameRevision(revision, current.target) ? current.base : current.target };
        }
        if (role === "target") {
          return { base: sameRevision(revision, current.base) ? current.target : current.base, target: revision };
        }
        // No role named: show what this commit did to the file, which needs its parent
        if (current.base === null && current.target === null) {
          const parent = row.entry?.parents[0];
          const parentRow = parent !== undefined ? rows.find((candidate) => candidate.rev === parent) : undefined;
          return { base: parentRow ? toRevision(parentRow) : null, target: revision };
        }
        return { base: sameRevision(revision, current.base) ? current.target : current.base, target: revision };
      });
    },
    [rows],
  );

  const clear = useCallback(() => {
    setPair({ base: null, target: null });
    onClearDiff();
  }, [onClearDiff]);

  const swap = useCallback(() => setPair((current) => ({ base: current.target, target: current.base })), []);

  const moveFocus = useCallback(
    (delta: number) => {
      setFocused((current) => {
        const next = Math.max(0, Math.min(rows.length - 1, current + delta));
        rowRefs.current[next]?.focus();
        return next;
      });
    },
    [rows.length],
  );

  const roleOf = (row: FileGraphRow): Role | null => {
    const revision = toRevision(row);
    if (sameRevision(revision, base)) return "base";
    if (sameRevision(revision, target)) return "target";
    return null;
  };

  const baseIndex = rows.findIndex((row) => sameRevision(toRevision(row), base));
  const targetIndex = rows.findIndex((row) => sameRevision(toRevision(row), target));
  const bracket =
    baseIndex >= 0 && targetIndex >= 0
      ? { top: Math.min(baseIndex, targetIndex) * ROW_H + ROW_H / 2, height: Math.abs(targetIndex - baseIndex) * ROW_H }
      : null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400" title={history.path}>
          {history.path}
        </span>
        {base !== null && target !== null && (
          <span
            className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400"
            aria-label={`Comparing ${revisionLabel(base)} to ${revisionLabel(target)}`}
          >
            <span className="text-amber-600 dark:text-amber-500">{revisionLabel(base)}</span>
            {" → "}
            <span className="text-amber-600 dark:text-amber-500">{revisionLabel(target)}</span>
          </span>
        )}
        {base !== null && target !== null && (
          <button
            type="button"
            onClick={swap}
            title="Compare the other way round"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            ⇄ swap
          </button>
        )}
        {(base !== null || target !== null) && (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            clear
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close file history"
          className="shrink-0 px-1 text-sm text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className="relative max-h-[40%] shrink-0 overflow-y-auto border-b border-zinc-200 md:max-h-none md:w-[26rem] md:border-b-0 md:border-r dark:border-zinc-800"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveFocus(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(-1);
            }
          }}
        >
          {history.status === "loading" && <div className="px-3 py-2 text-xs text-zinc-500">Reading history…</div>}
          {history.status === "error" && (
            <div className="m-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {history.error}
            </div>
          )}
          {history.status === "loaded" && history.entries.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">No commits touch this file yet.</div>
          )}
          {history.status === "loaded" && history.entries.length > 0 && (
            <div className="relative" role="group" aria-label="Commits">
              {bracket && <Bracket top={bracket.top} height={bracket.height} baseFirst={baseIndex < targetIndex} />}
              {rows.map((row, index) => (
                <HistoryRow
                  key={row.rev}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  row={row}
                  laneCount={laneCount}
                  role={roleOf(row)}
                  isFocused={index === focused}
                  onSelect={(role) => select(row, role)}
                  onFocus={() => setFocused(index)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <DiffPane diff={diff} base={base} target={target} />
        </div>
      </div>
    </div>
  );
}

/**
 * The comparison bracket: the span being diffed, drawn on the timeline itself so a
 * selection stays findable in a long list. Zinc, so it never competes with a lane.
 */
function Bracket({ top, height, baseFirst }: { top: number; height: number; baseFirst: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 z-10 motion-safe:transition-all motion-safe:duration-150 motion-safe:ease-out"
      style={{ top, height, width: GUTTER_W }}
    >
      <div className="absolute inset-y-0 left-2 w-px bg-zinc-400 dark:bg-zinc-500" />
      <Cap label={baseFirst ? "base" : "target"} className="top-0" />
      <Cap label={baseFirst ? "target" : "base"} className="bottom-0" />
    </div>
  );
}

function Cap({ label, className }: { label: string; className: string }) {
  return (
    <div className={`absolute left-2 flex h-px w-2.5 items-center bg-zinc-400 dark:bg-zinc-500 ${className}`}>
      <span className="absolute -left-1 -top-1.5 rotate-180 text-[9px] leading-none text-zinc-500 [writing-mode:vertical-rl] dark:text-zinc-400">
        {label}
      </span>
    </div>
  );
}

const ACTION_CLASS =
  "shrink-0 rounded px-1 py-0.5 text-[10px] text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 aria-disabled:cursor-default aria-disabled:opacity-30 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200";

interface HistoryRowProps {
  row: FileGraphRow;
  laneCount: number;
  role: Role | null;
  isFocused: boolean;
  onSelect: (role?: Role) => void;
  onFocus: () => void;
}

function HistoryRow({ row, laneCount, role, isFocused, onSelect, onFocus, ref }: HistoryRowProps & { ref?: React.Ref<HTMLDivElement> }) {
  const entry = row.entry;
  const label = entry ? `${entry.sha.slice(0, 7)} ${entry.subject}` : "Working tree";
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={isFocused ? 0 : -1}
      aria-label={label}
      aria-current={role !== null ? "true" : undefined}
      onFocus={onFocus}
      onClick={() => onSelect()}
      onKeyDown={(event) => {
        // Only keys aimed at the row itself. Without this, Enter on one of the
        // role buttons inside fires the button *and* bubbles up to here, so a
        // single keypress sets both roles at once.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        } else if (event.key === "b") {
          onSelect("base");
        } else if (event.key === "t") {
          onSelect("target");
        }
      }}
      style={{ height: ROW_H, paddingLeft: GUTTER_W }}
      className={`group flex cursor-pointer items-center gap-2 pr-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 ${
        role !== null ? "bg-zinc-100 dark:bg-zinc-800/60" : ""
      }`}
    >
      <Rail row={row} laneCount={laneCount} />
      {entry ? (
        <>
          <span className="shrink-0 font-mono text-xs text-amber-600 dark:text-amber-500">{entry.sha.slice(0, 7)}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">{entry.subject}</span>
          <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-600">
            {entry.author} · {relativeDate(entry.date)}
          </span>
          <span
            className="shrink-0 font-mono text-[10px] tabular-nums"
            aria-label={`${entry.added} lines added, ${entry.deleted} removed`}
          >
            <span className="text-emerald-600 dark:text-emerald-500">+{entry.added}</span>{" "}
            <span className="text-red-600 dark:text-red-400">−{entry.deleted}</span>
          </span>
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-500 dark:text-zinc-400">working tree</span>
      )}
      <span className="flex shrink-0 gap-0.5">
        <button
          type="button"
          title={role === "target" ? "Make this the base (swaps the two)" : "Compare from this version"}
          onClick={(event) => {
            event.stopPropagation();
            onSelect("base");
          }}
          className={ACTION_CLASS}
        >
          base
        </button>
        <button
          type="button"
          title={role === "base" ? "Make this the target (swaps the two)" : "Compare to this version"}
          onClick={(event) => {
            event.stopPropagation();
            onSelect("target");
          }}
          className={ACTION_CLASS}
        >
          target
        </button>
      </span>
    </div>
  );
}

function DiffPane({ diff, base, target }: { diff: GitFileDiffState | null; base: GitRevision | null; target: GitRevision | null }) {
  if (base === null && target === null) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-600">Pick a commit to see what changed.</p>;
  }
  if (base === null || target === null) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-600">Now pick the version to compare it against.</p>;
  }
  if (diff?.status === "error") {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
        {diff.error}
      </div>
    );
  }
  if (diff === null) return <p className="text-sm text-zinc-400 dark:text-zinc-600">Loading…</p>;
  if (diff.status === "loaded" && diff.beforeText === diff.afterText) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-600">These two versions are identical.</p>;
  }
  return (
    // Dim rather than clear while reloading: the pane must not flash empty between pairs
    <div className={diff.status === "loading" ? "opacity-40" : undefined}>
      <SplitDiffBlock fill lines={diffLines(diff.beforeText, diff.afterText)} />
    </div>
  );
}
