/**
 * A figure's canvas once the reader has moved boxes.
 *
 * It used to only grow: pulling boxes closer to tighten a sprawling figure left their
 * old space empty, on screen and in the SVG the reader downloads. Once a box is moved
 * the canvas fits what is drawn; an untouched figure keeps the layout's own canvas.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { graphFigure, type Figure } from "@pi-outpost/shared/structured-exchange/figure";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

type Box = { x: number; y: number; width: number; height: number };

const CHAIN: StructuredGraphData = {
  nodes: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
    { id: "d", label: "Delta" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
  ],
};

function viewBox(figure: Figure): Box {
  const [x, y, width, height] = figure.viewBox.split(" ").map(Number);
  return { x: x!, y: y!, width: width!, height: height! };
}

/** Every rectangle the figure draws for an element or a container. */
function rectangles(figure: Figure): Box[] {
  return figure.groups.flatMap((group) =>
    group.primitives.flatMap((primitive) => (primitive.shape === "rect" ? [primitive as unknown as Box] : [])),
  );
}

function inside(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** Where a node's box is drawn, read from the figure. */
function boxOf(figure: Figure, id: string): Box {
  const group = figure.groups.find((candidate) => candidate.data?.["element-id"] === id);
  assert.ok(group, `no group for ${id}`);
  const rect = group.primitives.find((primitive) => primitive.shape === "rect") as unknown as Box;
  return rect;
}

describe("the canvas of a figure the reader rearranged", () => {
  test("an untouched figure keeps the layout's canvas exactly", () => {
    assert.deepEqual(viewBox(graphFigure(CHAIN, { isProposal: false, nudges: new Map() })), viewBox(graphFigure(CHAIN, { isProposal: false })));
  });

  test("boxes pulled together shrink the canvas, and everything drawn stays inside it", () => {
    const untouched = graphFigure(CHAIN, { isProposal: false, orientation: "landscape" });
    const before = viewBox(untouched);
    const a = boxOf(untouched, "a");
    // Fold the chain back under its first box: each later box moved to sit below "a".
    const nudges = new Map(
      ["b", "c", "d"].map((id, index) => {
        const box = boxOf(untouched, id);
        return [id, { dx: a.x - box.x, dy: (index + 1) * (a.height + 30) }] as const;
      }),
    );
    const folded = graphFigure(CHAIN, { isProposal: false, orientation: "landscape", nudges });
    const after = viewBox(folded);

    assert.ok(after.width < before.width - 50, `width ${after.width} vs ${before.width}`);
    for (const rect of rectangles(folded)) assert.ok(inside(after, rect), `${JSON.stringify(rect)} outside ${folded.viewBox}`);
  });

  test("a box pushed outward still grows the canvas, as before", () => {
    const untouched = graphFigure(CHAIN, { isProposal: false });
    const before = viewBox(untouched);
    const pushed = graphFigure(CHAIN, { isProposal: false, nudges: new Map([["d", { dx: 400, dy: 300 }]]) });
    const after = viewBox(pushed);
    assert.ok(after.x + after.width > before.x + before.width);
    assert.ok(after.y + after.height > before.y + before.height);
    for (const rect of rectangles(pushed)) assert.ok(inside(after, rect));
  });

  test("a container stays inside the fitted canvas, its members moved", () => {
    const grouped: StructuredGraphData = {
      containers: [{ id: "g", label: "Group" }],
      nodes: [
        { id: "a", label: "Alpha", container: "g" },
        { id: "b", label: "Beta", container: "g" },
        { id: "c", label: "Gamma" },
      ],
      edges: [{ from: "a", to: "c" }],
    } as StructuredGraphData;
    const untouched = graphFigure(grouped, { isProposal: false });
    const c = boxOf(untouched, "c");
    const moved = graphFigure(grouped, { isProposal: false, nudges: new Map([["c", { dx: -c.x, dy: 0 }]]) });
    const frame = viewBox(moved);
    for (const rect of rectangles(moved)) assert.ok(inside(frame, rect), `${JSON.stringify(rect)} outside ${moved.viewBox}`);
  });
});
