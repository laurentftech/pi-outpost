import { describe, it, expect } from "vitest";
import type { GitCommitLogEntry } from "@pi-outpost/shared";
import { layoutCommitGraph } from "./commitGraph";

/** Commits are named by letter; the log is always newest first. */
function entry(sha: string, parents: string[], extra: Partial<GitCommitLogEntry> = {}): GitCommitLogEntry {
  return { sha, parents, author: "Test", date: "2026-01-01T00:00:00Z", subject: sha, refs: [], tags: [], head: false, ...extra };
}

describe("layoutCommitGraph", () => {
  // openlore: scenario=TheCheckedOutLineRunsOnTheFirstLane spec=git
  it("TheCheckedOutLineRunsOnTheFirstLane: HEAD's line keeps lane 0 under a newer branch", () => {
    //   f   │     feature, newer than HEAD
    //   │   h     HEAD (main)
    //   │   g
    //   b───┘     where feature left main
    const { rows, laneCount } = layoutCommitGraph([
      entry("f", ["b"], { refs: ["feature"] }),
      entry("h", ["g"], { refs: ["main"], head: true }),
      entry("g", ["b"]),
      entry("b", []),
    ]);
    const [f, h, g, b] = rows;
    expect(laneCount).toBe(2);

    expect(f.lane).toBe(1);
    // Nothing is drawn on lane 0 beside a commit newer than HEAD
    expect(f.through).toEqual([]);
    expect(f.lineAbove).toBe(false);

    expect([h.lane, g.lane, b.lane]).toEqual([0, 0, 0]);
    expect(h.emphasis).toBe("current");
    expect(h.lineAbove).toBe(false);
    expect(h.through).toEqual([1]);
    expect(g.emphasis).toBe("filled");
    expect(b.mergeFrom).toEqual([1]);
  });

  // openlore: scenario=AMergeJoinsTwoLines spec=git
  it("AMergeJoinsTwoLines: the merge forks to its second parent's lane, which converges on the base", () => {
    const { rows } = layoutCommitGraph([
      entry("m", ["x", "y"], { head: true }),
      entry("x", ["z"]),
      entry("y", ["z"]),
      entry("z", []),
    ]);
    const [m, x, y, z] = rows;
    expect(m.lane).toBe(0);
    expect(m.forkTo).toEqual([1]);
    expect(x.lane).toBe(0);
    expect(y.lane).toBe(1);
    expect(y.lineAbove).toBe(true);
    expect(z.lane).toBe(0);
    expect(z.mergeFrom).toEqual([1]);
    expect(z.lineBelow).toBe(false);
  });

  // openlore: scenario=ABranchTipNamesItsBranch spec=git
  it("ABranchTipNamesItsBranch: a tip nothing newer descends from starts its line at its node", () => {
    const { rows } = layoutCommitGraph([
      entry("h", ["a"], { head: true, refs: ["main"] }),
      entry("t", ["a"], { refs: ["topic"] }),
      entry("a", []),
    ]);
    const [h, t, a] = rows;
    expect(t.lane).toBe(1);
    expect(t.lineAbove).toBe(false);
    expect(t.lineBelow).toBe(true);
    // HEAD's own commit is a tip too: the reservation is not a descendant
    expect(h.lineAbove).toBe(false);
    expect(a.lineAbove).toBe(true);
    expect(a.mergeFrom).toEqual([1]);
  });

  it("a commit built on HEAD descends into it rather than starting HEAD's line", () => {
    const { rows } = layoutCommitGraph([entry("c", ["h"], { refs: ["next"] }), entry("h", ["a"], { head: true }), entry("a", [])]);
    const [c, h] = rows;
    expect(c.lane).toBe(1);
    expect(h.lane).toBe(0);
    expect(h.mergeFrom).toEqual([1]);
    expect(h.lineAbove).toBe(true);
  });

  it("lays out a log with no HEAD among it from lane 0", () => {
    const { rows, laneCount } = layoutCommitGraph([entry("a", ["b"]), entry("b", [])]);
    expect(laneCount).toBe(1);
    expect(rows.map((row) => row.lane)).toEqual([0, 0]);
    expect(rows[0].lineAbove).toBe(false);
  });
});
