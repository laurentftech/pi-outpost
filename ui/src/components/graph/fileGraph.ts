import type { GitFileLogEntry } from "@pi-outpost/shared";
import { WORKTREE_REVISION } from "@pi-outpost/shared";
import { sweepLanes } from "./commitGraph";
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
 * Assign lanes to a file's commits, newest first, with the sweep the repository's
 * map uses (`sweepLanes`).
 *
 * Lane 0 therefore belongs to the newest commit, and keeps the emerald reserved
 * for "you are here".
 *
 * `dirty` marks the file as carrying uncommitted changes: the working-tree row is
 * always shown, but its rail is dashed while the file matches HEAD.
 */
export function layoutFileGraph(entries: GitFileLogEntry[], options: { dirty?: boolean } = {}): FileGraph {
  const { lanes, laneCount } = sweepLanes(entries);
  const rows: FileGraphRow[] = entries.map((entry, index) => {
    const { lane, through, forkTo, mergeFrom } = lanes[index];
    return {
      lane,
      through,
      forkTo,
      mergeFrom,
      rev: entry.sha,
      path: entry.path,
      entry,
      lineAbove: true,
      lineBelow: entry.parents.length > 0,
      emphasis: "filled",
    };
  });

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

  return { rows, laneCount };
}
