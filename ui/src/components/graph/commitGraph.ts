import type { GitCommitLogEntry } from "@pi-outpost/shared";
import type { RailRow } from "./lanes";

/** Where the sweep put one commit. */
export interface SweptLane {
  lane: number;
  through: number[];
  forkTo: number[];
  mergeFrom: number[];
  /** No lane was waiting for this commit: nothing newer in the log descends from it. */
  tip: boolean;
}

/**
 * Assign lanes to commits, newest first.
 *
 * A sweep over active lanes, each holding the id of the commit it is waiting for:
 * a commit takes the lane waiting for it (or the leftmost free one), any *other*
 * lane waiting for it converges here, its first parent inherits the lane, and each
 * additional parent claims a free lane. Read top-down, a merge does send a second
 * line of development downward into the past — which is why extra parents are
 * drawn with the same downward curve the conversation tree uses for a fork.
 *
 * `reserve` holds lane 0 for that commit from the start, so its first-parent chain
 * runs on lane 0 whatever the log lists above it. Until the commit is reached the
 * reserved lane is not drawn: it is waiting, not yet a line.
 */
export function sweepLanes(entries: { sha: string; parents: string[] }[], reserve?: string): { lanes: SweptLane[]; laneCount: number } {
  const lanes: SweptLane[] = [];
  /** Per lane, the commit it is waiting for; null once the lane is free. */
  const waiting: (string | null)[] = reserve === undefined ? [] : [reserve];
  let laneCount = waiting.length;
  let reserved = reserve !== undefined;

  const claimLane = (): number => {
    const free = waiting.indexOf(null);
    if (free !== -1) return free;
    waiting.push(null);
    laneCount = Math.max(laneCount, waiting.length);
    return waiting.length - 1;
  };

  for (const entry of entries) {
    const claimed = waiting.reduce<number[]>((found, want, lane) => (want === entry.sha ? [...found, lane] : found), []);
    const lane = claimed[0] ?? claimLane();
    if (entry.sha === reserve) reserved = false;
    // The reservation is not a descendant: only lanes some newer commit opened count
    const tip = (entry.sha === reserve ? claimed.length - 1 : claimed.length) === 0;
    // Every other lane waiting for this commit ends here, converging into it
    const mergeFrom = claimed.slice(1);
    for (const spare of mergeFrom) waiting[spare] = null;
    laneCount = Math.max(laneCount, lane + 1);

    const [firstParent, ...extraParents] = entry.parents;
    waiting[lane] = firstParent ?? null;
    const forkTo = extraParents.map((parent) => {
      const extra = claimLane();
      waiting[extra] = parent;
      return extra;
    });

    lanes.push({
      lane,
      // Lanes still waiting on something older run past this row — except a
      // reservation nobody has taken up yet
      through: waiting.reduce<number[]>(
        (found, want, l) => (want !== null && l !== lane && !forkTo.includes(l) && !(reserved && l === 0) ? [...found, l] : found),
        [],
      ),
      forkTo,
      mergeFrom,
      tip,
    });
  }

  return { lanes, laneCount: Math.max(laneCount, 1) };
}

/** One row of the repository's metro map. */
export interface CommitGraphRow extends RailRow {
  entry: GitCommitLogEntry;
}

export interface CommitGraph {
  rows: CommitGraphRow[];
  laneCount: number;
}

/**
 * Lay out a repository's log — HEAD and every local branch — as a metro map.
 *
 * Lane 0 is reserved for HEAD's commit, so the checked-out line keeps the emerald
 * `laneColor` gives lane 0 even where another branch's commit is newer.
 */
export function layoutCommitGraph(entries: GitCommitLogEntry[]): CommitGraph {
  const head = entries.find((entry) => entry.head)?.sha;
  const { lanes, laneCount } = sweepLanes(entries, head);
  const rows = entries.map((entry, index) => {
    const { lane, through, forkTo, mergeFrom, tip } = lanes[index];
    return {
      lane,
      through,
      forkTo,
      mergeFrom,
      entry,
      lineAbove: !tip,
      lineBelow: entry.parents.length > 0,
      emphasis: entry.head ? ("current" as const) : ("filled" as const),
    };
  });
  return { rows, laneCount };
}
