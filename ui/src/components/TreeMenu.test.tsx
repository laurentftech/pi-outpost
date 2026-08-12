import { describe, it, expect } from "vitest";
import type { TreeNode } from "@pi-outpost/shared";
import { layoutGraph } from "./TreeMenu";
import { branchColor, CURRENT_COLOR } from "./graph/lanes";

/**
 * One tree, two different current paths. Navigating between branches must not
 * repaint the whole graph: a branch keeps its lane — and therefore its colour —
 * whichever branch you are standing on.
 */
function node(entryId: string, onPath: boolean, children: TreeNode[] = []): TreeNode {
  return { entryId, text: entryId, onPath, children };
}

/**
 *        root
 *        ├── a ── a1
 *        └── b ── b1
 */
function tree(onPathBranch: "a" | "b"): TreeNode[] {
  const onA = onPathBranch === "a";
  return [
    node("root", true, [
      node("a", onA, [node("a1", onA)]),
      node("b", !onA, [node("b1", !onA)]),
    ]),
  ];
}

/** entryId → lane, which is what the palette is indexed by. */
function lanes(roots: TreeNode[]): Record<string, number> {
  return Object.fromEntries(layoutGraph(roots).rows.map((row) => [row.node.entryId, row.lane]));
}

/** entryId → position in the rendered list. */
function order(roots: TreeNode[]): string[] {
  return layoutGraph(roots).rows.map((row) => row.node.entryId);
}

describe("layoutGraph", () => {
  it("keeps every branch on its lane when the current path moves", () => {
    expect(lanes(tree("b"))).toEqual(lanes(tree("a")));
  });

  it("keeps the rows in the same order when the current path moves", () => {
    expect(order(tree("b"))).toEqual(order(tree("a")));
  });

  it("still marks where the conversation stands", () => {
    const onA = layoutGraph(tree("a")).rows;
    const onB = layoutGraph(tree("b")).rows;
    expect(onA.find((row) => row.isCurrent)?.node.entryId).toBe("a1");
    expect(onB.find((row) => row.isCurrent)?.node.entryId).toBe("b1");
  });

  it("counts the fork once", () => {
    expect(layoutGraph(tree("a")).branchPoints).toBe(1);
    expect(layoutGraph(tree("a")).laneCount).toBe(2);
  });

  it("treats sibling roots as branches too", () => {
    const withRoots = (current: "x" | "y"): TreeNode[] => [node("x", current === "x"), node("y", current === "y")];
    expect(lanes(withRoots("y"))).toEqual(lanes(withRoots("x")));
    expect(order(withRoots("y"))).toEqual(order(withRoots("x")));
  });
});

/**
 * What the rail actually paints for a row — the rule Rail applies, mirrored here
 * so these assertions are about the colour a reader sees, not an internal index.
 */
function paint(roots: TreeNode[]): Record<string, string> {
  return Object.fromEntries(
    layoutGraph(roots).rows.map((row) => [row.node.entryId, row.highlight ? CURRENT_COLOR : branchColor(row.lane)]),
  );
}

/** Entry ids whose colour differs between two current paths. */
function repainted(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys(before).filter((id) => before[id] !== after[id]);
}

describe("layoutGraph colouring across forks", () => {
  /**
   *   root
   *   ├── a ── a1
   *   ├── b ── b1
   *   └── c ── c1 ── (fork) ── c2
   *                        └── d1
   */
  function forked(current: "a1" | "b1" | "c2" | "d1"): TreeNode[] {
    const on = (id: string) => {
      const path: Record<string, string[]> = {
        a1: ["root", "a", "a1"],
        b1: ["root", "b", "b1"],
        c2: ["root", "c", "c1", "c2"],
        d1: ["root", "c", "c1", "d1"],
      };
      return path[current].includes(id);
    };
    return [
      node("root", true, [
        node("a", on("a"), [node("a1", on("a1"))]),
        node("b", on("b"), [node("b1", on("b1"))]),
        node("c", on("c"), [node("c1", on("c1"), [node("c2", on("c2")), node("d1", on("d1"))])]),
      ]),
    ];
  }

  it("gives each branch its own colour", () => {
    const colors = paint(forked("a1"));
    // Three branches off the root plus the nested one — all distinct, none of them
    // the reserved colour while they are off the current path
    expect(new Set([colors.b1, colors.c1, colors.d1]).size).toBe(3);
    expect([colors.b1, colors.c1, colors.d1]).not.toContain(CURRENT_COLOR);
  });

  it("repaints only the rows that entered or left the current path", () => {
    const before = paint(forked("a1"));
    const after = paint(forked("b1"));
    // a/a1 lose the highlight, b/b1 gain it — the rest, including the nested fork,
    // must not move
    expect(repainted(before, after).sort()).toEqual(["a", "a1", "b", "b1"]);
  });

  it("keeps the other branches steady when the current path moves inside a nested fork", () => {
    expect(repainted(paint(forked("c2")), paint(forked("d1"))).sort()).toEqual(["c2", "d1"]);
  });

  it("keeps lanes and order identical across every current path", () => {
    const reference = lanes(forked("a1"));
    const ordering = order(forked("a1"));
    for (const current of ["b1", "c2", "d1"] as const) {
      expect(lanes(forked(current))).toEqual(reference);
      expect(order(forked(current))).toEqual(ordering);
    }
  });

  it("returns a branch to its own colour once you leave it", () => {
    const offPath = paint(forked("a1")).b1;
    expect(paint(forked("b1")).b1).toBe(CURRENT_COLOR);
    // Leaving it again restores exactly the colour it had before, not a new one
    expect(paint(forked("c2")).b1).toBe(offPath);
  });
});
