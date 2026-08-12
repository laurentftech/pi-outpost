import { describe, it, expect } from "vitest";
import type { TreeNode } from "@pi-outpost/shared";
import { layoutGraph } from "./TreeMenu";

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
