import { useEffect, useMemo, useState } from "react";
import type { GitRepoStatus } from "@pi-outpost/shared";
import type { GitLogState, GitStatusState } from "../useAgent";
import { useClickOutside } from "../util/clickOutside";
import { repoForPath } from "../util/gitRepos";
import { layoutCommitGraph } from "./graph/commitGraph";
import { CURRENT_COLOR, laneColor, ROW_H } from "./graph/lanes";
import { Rail } from "./graph/Rail";
import { HEADER_CONTROL_SHRINKS } from "./headerControl";

interface GitMenuProps {
  status: GitStatusState | null;
  /**
   * Browser-root-relative path of the last thing the user touched in the tree — a file
   * or a directory — or null when they have touched nothing yet.
   */
  selected: string | null;
  log: GitLogState | null;
  onFetchLog: (repo: string) => void;
  onShowCommit: (repo: string, sha: string) => void;
}

function relativeDate(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 90) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** Last path segment: what a person calls the project, rather than where it sits. */
function repoName(repo: string): string {
  return repo.slice(repo.lastIndexOf("/") + 1);
}

/**
 * Header branch chip; opens that repository's recent commits as a metro map — the
 * checked-out line and every local branch beside it — click one for its diff.
 *
 * A workspace holds a set of repositories, so there is no single branch to show and
 * the chip follows the selection instead — a file OR a directory, since walking into
 * a project is how you say which one you are in. No picker: the user already chose by
 * clicking, and a control for choosing again would be asking twice.
 *
 * A selection under no repository names nothing. The chip stays on screen and says
 * `—`, rather than going on claiming the last repository it knew: in a directory of
 * projects the loose files at the root are exactly where a README lives, and a chip
 * naming a project the user has left is worse than one admitting it has none.
 */
export function GitMenu({ status, selected, log, onFetchLog, onShowCommit }: GitMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const repos = status?.repos ?? [];
  const owner = selected === null ? null : repoForPath(repos, selected);
  // Nothing touched yet: a workspace with one repository has only one answer, and a
  // workspace with several has none worth guessing at
  const current: GitRepoStatus | null = owner ?? (selected === null && repos.length === 1 ? repos[0] : null);
  const counts =
    current && (current.ahead > 0 || current.behind > 0)
      ? ` ${current.ahead > 0 ? `↑${current.ahead}` : ""}${current.behind > 0 ? `↓${current.behind}` : ""}`
      : "";
  // Naming the project matters only when there is more than one to confuse it with
  const prefix = repos.length > 1 && current !== null && current.repo !== "" ? `${repoName(current.repo)} ` : "";
  const label = status === null ? "…" : (current?.branch ?? "—");
  // Only this repository's own log. Switching projects with the menu open, or a
  // slower answer landing after a newer one, would otherwise put one project's
  // commits under another's name - and clicking one asks for a commit id the named
  // repository has never heard of.
  const entries = current !== null && log?.repo === current.repo ? log.entries : null;
  const graph = useMemo(() => (entries === null ? null : layoutCommitGraph(entries)), [entries]);

  // The menu is a panel, not a dialog: it stays open while the user walks the tree,
  // so the repository under it can change without it ever being reopened. Asking only
  // on the toggle left it saying "loading…" for a request nobody had made.
  useEffect(() => {
    if (open && current !== null && log?.repo !== current.repo) onFetchLog(current.repo);
    // `log` is deliberately absent: it is the ANSWER to this request, and depending on
    // it would ask again on every reply that is not the one being waited for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current?.repo, onFetchLog]);

  return (
    <div className="relative min-w-[4rem] max-w-[14rem] shrink-[2]" ref={ref}>
      <button
        type="button"
        disabled={current === null}
        onClick={() => {
          if (current === null) return;
          setOpen(!open);
          if (!open) onFetchLog(current.repo);
        }}
        title={current === null ? "no repository selected" : `git history — ${current.repo === "" ? "this project" : current.repo}`}
        className={`${HEADER_CONTROL_SHRINKS} max-w-full border-zinc-300 font-mono text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:cursor-default disabled:hover:border-zinc-300 disabled:hover:text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200 dark:disabled:hover:border-zinc-800 dark:disabled:hover:text-zinc-400`}
      >
        <span className="truncate">
          {prefix}⎇ {label}
        </span>
        {counts}
      </button>
      {open && current !== null && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-96 w-[26rem] max-w-[80vw] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {entries === null && <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>}
          {entries?.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">no commits</div>}
          {graph?.rows.map((row) => {
            const { entry } = row;
            return (
              <button
                key={entry.sha}
                type="button"
                onClick={() => {
                  onShowCommit(current.repo, entry.sha);
                  setOpen(false);
                }}
                style={{ height: ROW_H }}
                className="flex w-full items-center gap-2 pl-2 pr-3 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Rail row={row} laneCount={graph.laneCount} />
                <span className="shrink-0 font-mono text-xs text-amber-600 dark:text-amber-500">{entry.sha.slice(0, 7)}</span>
                {entry.refs.map((ref) => {
                  // The checked-out branch wears the line's emerald; the others their lane's colour
                  const color = ref === current.branch ? CURRENT_COLOR : laneColor(row.lane);
                  return (
                    <span
                      key={ref}
                      style={{ borderColor: color, color }}
                      className={`max-w-[8rem] shrink-0 truncate rounded-full border px-1.5 font-mono text-[10px] leading-4 ${
                        ref === current.branch ? "font-semibold" : ""
                      }`}
                    >
                      {ref}
                    </span>
                  );
                })}
                {entry.tags.map((tag) => (
                  // Square, not round: a tag marks a commit, it is no line of its own
                  <span
                    key={`tag-${tag}`}
                    title={`tag ${tag}`}
                    className="max-w-[8rem] shrink-0 truncate rounded border border-zinc-300 px-1 font-mono text-[10px] leading-4 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400"
                  >
                    ◆ {tag}
                  </span>
                ))}
                {/* Same reason as the history graph: the list truncates, the tooltip
                    gives back the end of the subject without opening the commit. */}
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300" title={entry.subject}>
                  {entry.subject}
                </span>
                <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-600">
                  {entry.author} · {relativeDate(entry.date)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
