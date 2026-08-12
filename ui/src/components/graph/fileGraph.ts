import type { GitFileLogEntry } from "@pi-outpost/shared";
import { WORKTREE_REVISION } from "@pi-outpost/shared";
import type { RailRow } from "./lanes";

/** One row of the file-history graph: a commit, or the working tree pinned on top. */
export interface FileGraphRow extends RailRow {
  /** A commit id, or WORKTREE_REVISION for the pinned first row. */
  rev: string;
  /** The file's path at this revision — what a diff of this row has to ask for. */
  path: string;
  /** Absent on the working-tree row. */
  entry?: GitFileLogEntry;
}

export interface FileGraph {
  rows: FileGraphRow[];
  laneCount: number;
}

/**
 * Assign lanes to a file's commits, newest first.
 *
 * A sweep over active lanes, each holding the id of the commit it is waiting for:
 * a commit takes the lane waiting for it (or the leftmost free one), any *other*
 * lane waiting for it converges here, its first parent inherits the lane, and each
 * additional parent claims a free lane. Read top-down, a merge does send a second
 * line of development downward into the past — which is why extra parents are
 * drawn with the same downward curve the conversation tree uses for a fork.
 *
 * Lane 0 therefore belongs to the newest commit, and keeps the emerald reserved
 * for "you are here".
 *
 * `dirty` marks the file as carrying uncommitted changes: the working-tree row is
 * always shown, but its rail is dashed while the file matches HEAD.
 */
export function layoutFileGraph(entries: GitFileLogEntry[], options: { dirty?: boolean } = {}): FileGraph {
  const rows: FileGraphRow[] = [];
  /** Per lane, the commit it is waiting for; null once the lane is free. */
  const waiting: (string | null)[] = [];
  let laneCount = 0;

  const claimLane = (): number => {
    const free = waiting.indexOf(null);
    if (free !== -1) return free;
    waiting.push(null);
    laneCount = Math.max(laneCount, waiting.length);
    return waiting.length - 1;
  };

  for (const entry of entries) {
    const claimed = waiting.reduce<number[]>((lanes, want, lane) => (want === entry.sha ? [...lanes, lane] : lanes), []);
    const lane = claimed[0] ?? claimLane();
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

    rows.push({
      rev: entry.sha,
      path: entry.path,
      entry,
      lane,
      // Lanes still waiting on something older run past this row
      through: waiting.reduce<number[]>((lanes, want, l) => (want !== null && l !== lane && !forkTo.includes(l) ? [...lanes, l] : lanes), []),
      forkTo,
      mergeFrom,
      lineAbove: true,
      lineBelow: entry.parents.length > 0,
      emphasis: "filled",
    });
  }

  // The working tree sits above the newest commit on its lane: a version you can
  // compare like any other, not a control off to the side
  const newest = rows[0];
  rows.unshift({
    rev: WORKTREE_REVISION,
    path: newest?.path ?? "",
    lane: newest?.lane ?? 0,
    through: newest?.through ?? [],
    forkTo: [],
    mergeFrom: [],
    lineAbove: false,
    lineBelow: rows.length > 0,
    emphasis: "current",
    dashed: !options.dirty,
  });
  // The first commit row now has the working tree above it, not open air
  if (rows[1]) rows[1].lineAbove = true;

  return { rows, laneCount: Math.max(laneCount, 1) };
}
