import { describe, it, expect } from "vitest";
import type { GitFileLogEntry } from "@pi-outpost/shared";
import { layoutFileGraph } from "./fileGraph";

/** Commits are named by letter; the log is always newest first. */
function entry(sha: string, parents: string[]): GitFileLogEntry {
  return { sha, parents, author: "Test", date: "2026-01-01T00:00:00Z", subject: sha, path: "notes.txt", added: 1, deleted: 0 };
}

/** The commit rows, skipping the working-tree row pinned on top. */
function commits(rows: ReturnType<typeof layoutFileGraph>["rows"]) {
  return rows.slice(1);
}

describe("layoutFileGraph", () => {
  it("keeps a linear history on one lane", () => {
    const { rows, laneCount } = layoutFileGraph([entry("a", ["b"]), entry("b", ["c"]), entry("c", [])]);
    expect(laneCount).toBe(1);
    expect(commits(rows).map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(commits(rows).every((row) => row.forkTo.length === 0 && row.mergeFrom?.length === 0)).toBe(true);
  });

  it("runs the rail between a commit and its parent", () => {
    const { rows } = layoutFileGraph([entry("a", ["b"]), entry("b", [])]);
    expect(commits(rows).map((row) => row.lineBelow)).toEqual([true, false]);
    expect(commits(rows).every((row) => row.lineAbove)).toBe(true);
  });

  it("opens a second lane at a merge and closes it where the lanes rejoin", () => {
    //   m        merge of x and y
    //   ├─┐
    //   x │
    //   │ y
    //   z─┘      their common ancestor
    const { rows, laneCount } = layoutFileGraph([entry("m", ["x", "y"]), entry("x", ["z"]), entry("y", ["z"]), entry("z", [])]);
    const [m, x, y, z] = commits(rows);
    expect(laneCount).toBe(2);

    expect(m.lane).toBe(0);
    expect(m.forkTo).toEqual([1]);

    expect(x.lane).toBe(0);
    expect(x.through).toEqual([1]);

    expect(y.lane).toBe(1);
    expect(y.through).toEqual([0]);

    expect(z.lane).toBe(0);
    expect(z.mergeFrom).toEqual([1]);
    expect(z.lineBelow).toBe(false);
  });

  it("reuses a lane once its branch has ended", () => {
    const { laneCount } = layoutFileGraph([
      entry("m", ["x", "y"]),
      entry("x", ["z"]),
      entry("y", ["z"]),
      entry("z", ["n"]),
      // A second, later fork: lane 1 is free again by now
      entry("n", ["p", "q"]),
      entry("p", ["r"]),
      entry("q", ["r"]),
      entry("r", []),
    ]);
    expect(laneCount).toBe(2);
  });

  it("gives the same layout for the same input", () => {
    const log = [entry("m", ["x", "y"]), entry("x", ["z"]), entry("y", ["z"]), entry("z", [])];
    expect(layoutFileGraph(log)).toEqual(layoutFileGraph(log));
  });

  it("pins the working tree above the newest commit", () => {
    const { rows } = layoutFileGraph([entry("a", [])]);
    expect(rows[0].rev).toBe("worktree");
    expect(rows[0].lane).toBe(0);
    expect(rows[0].lineBelow).toBe(true);
    expect(rows[0].path).toBe("notes.txt");
  });

  it("dashes the working-tree rail only while the file matches HEAD", () => {
    expect(layoutFileGraph([entry("a", [])]).rows[0].dashed).toBe(true);
    expect(layoutFileGraph([entry("a", [])], { dirty: true }).rows[0].dashed).toBe(false);
  });

  it("survives an empty history", () => {
    const { rows, laneCount } = layoutFileGraph([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].lineBelow).toBe(false);
    expect(laneCount).toBe(1);
  });
});
