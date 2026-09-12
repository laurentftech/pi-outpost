/**
 * Which way a figure comes out, with nobody there to ask.
 *
 * This is the half of the orientation work that has to hold outside a browser. A
 * figure is produced for the agent by this same code with no display anywhere, and if
 * it chose its orientation differently from the reader's screen then the figure an
 * agent references from a report would not be the figure the reader approved — which
 * is the one promise the whole figure layer exists to keep.
 *
 * So the assertions here are about a `graphFigure` call with no orientation in it:
 * what it decides, and that turning changes the arrangement and nothing else.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { READING_WIDTH } from "@pi-outpost/shared/diagram-orientation";
import { graphFigure, type Figure, type FigureGroup } from "@pi-outpost/shared/structured-exchange/figure";
import { filterKey } from "@pi-outpost/shared/structured-exchange/model";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

/** A chain of `count` boxes, which is as wide as it is long. */
const chain = (count: number): StructuredGraphData => ({
  nodes: Array.from({ length: count }, (_, index) => ({ id: `n${index}`, label: `Element ${index}`, kind: "part" })),
  edges: Array.from({ length: count - 1 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}`, kind: "feeds" })),
});

/** Every group in the figure, flattened, since the key nests its entries. */
function allGroups(figure: Figure): FigureGroup[] {
  const out: FigureGroup[] = [];
  const walk = (groups: FigureGroup[]) => {
    for (const group of groups) {
      out.push(group);
      if (group.groups) walk(group.groups);
    }
  };
  walk(figure.groups);
  return out;
}

/** The text a figure draws, in order — its content, independent of where it sits. */
function texts(figure: Figure): string[] {
  return allGroups(figure)
    .flatMap((group) => group.primitives)
    .filter((primitive) => primitive.shape === "text")
    .map((primitive) => (primitive as { text: string }).text);
}

const elementIds = (figure: Figure) =>
  allGroups(figure)
    .map((group) => group.data?.["element-id"])
    .filter((id): id is string => id !== undefined)
    .sort();

describe("a figure chooses its own orientation when no reader has", () => {
  test("a graph that fits the reading width is drawn landscape", () => {
    const figure = graphFigure(chain(3), { isProposal: false });
    assert.equal(figure.orientation, "landscape");
    assert.ok(figure.width <= READING_WIDTH, `${figure.width} should fit ${READING_WIDTH}`);
  });

  test("a graph far too wide to be read across is turned", () => {
    // Twelve boxes in a row: the case the reader reported, arriving as a sliver in a
    // column he then had to scroll sideways through.
    const figure = graphFigure(chain(12), { isProposal: false });
    assert.equal(figure.orientation, "portrait");
    assert.ok(figure.height > figure.width, "a turned figure should be taller than it is wide");
  });

  test("the choice is the same every time it is made", () => {
    const chosen = new Set<string | undefined>();
    for (let attempt = 0; attempt < 5; attempt += 1) chosen.add(graphFigure(chain(12), { isProposal: false }).orientation);
    assert.deepEqual([...chosen], ["portrait"]);
  });

  test("an orientation the caller names is the one used", () => {
    // The reader's switch, and the only thing that overrides the automatic choice.
    assert.equal(graphFigure(chain(12), { isProposal: false, orientation: "landscape" }).orientation, "landscape");
    assert.equal(graphFigure(chain(3), { isProposal: false, orientation: "portrait" }).orientation, "portrait");
  });
});

describe("turning a graph changes the arrangement and nothing else", () => {
  const data = chain(6);
  const flat = graphFigure(data, { isProposal: false, orientation: "landscape" });
  const tall = graphFigure(data, { isProposal: false, orientation: "portrait" });

  test("the same elements are drawn either way", () => {
    assert.deepEqual(elementIds(tall), elementIds(flat));
    assert.equal(elementIds(flat).length, 6);
  });

  test("the same labels and the same key are drawn either way", () => {
    // Content compared as a multiset: the order shapes are emitted in follows the
    // layout, and that is exactly what turning is allowed to change.
    assert.deepEqual([...texts(tall)].sort(), [...texts(flat)].sort());
  });

  test("the same relationships are drawn either way", () => {
    const paths = (figure: Figure) =>
      allGroups(figure)
        .flatMap((group) => group.primitives)
        .filter((primitive) => primitive.shape === "path").length;
    assert.equal(paths(tall), paths(flat));
  });

  test("the picture actually moved onto the other axis", () => {
    // Without this the three assertions above would pass on a figure that ignored the
    // orientation entirely.
    assert.ok(flat.width > flat.height, "the chain should be wider than tall across");
    assert.ok(tall.height > tall.width, "the chain should be taller than wide down");
  });

  test("what a screen reader is told does not depend on which way it was drawn", () => {
    assert.equal(tall.ariaLabel, flat.ariaLabel);
  });
});

describe("turning holds the parts of the picture that are drawn by hand", () => {
  // Containers, parallel relationships and self-loops are the three things the layout
  // engine does not place on its own, and each of them was written against a
  // left-to-right flow.
  const awkward: StructuredGraphData = {
    nodes: [
      { id: "a", label: "Alpha", kind: "part", container: "box" },
      { id: "b", label: "Beta", kind: "part", container: "box" },
      { id: "c", label: "Gamma", kind: "part" },
    ],
    containers: [{ id: "box", label: "Enclosure" }],
    edges: [
      { from: "a", to: "b", kind: "feeds" },
      { from: "a", to: "b", kind: "signals" },
      { from: "c", to: "c", kind: "feeds" },
      { from: "b", to: "c", kind: "feeds" },
    ],
  };

  for (const orientation of ["landscape", "portrait"] as const) {
    test(`${orientation}: every relationship is drawn, including the pair and the loop`, () => {
      const figure = graphFigure(awkward, { isProposal: false, orientation });
      const drawn = allGroups(figure)
        .flatMap((group) => group.primitives)
        .filter((primitive) => primitive.shape === "path" && (primitive as { d: string }).d.length > 0);
      // Four relationships, each drawn as more than one overlaid path; what matters
      // is that none of them is missing or degenerate.
      assert.ok(drawn.length >= 4, `only ${drawn.length} paths drawn`);
      for (const primitive of drawn) {
        const d = (primitive as { d: string }).d;
        assert.ok(/^M [\d.-]+ [\d.-]+/.test(d), `a path that starts nowhere: ${d}`);
      }
    });

    test(`${orientation}: the enclosure holds the boxes it declares`, () => {
      const figure = graphFigure(awkward, { isProposal: false, orientation });
      const enclosure = allGroups(figure).find((group) => group.data?.["container"] === "box");
      assert.ok(enclosure !== undefined, "the declared container was not drawn");
      const rect = enclosure.primitives.find((primitive) => primitive.shape === "rect") as
        | { x: number; y: number; width: number; height: number }
        | undefined;
      assert.ok(rect !== undefined, "the container has no rectangle");
      for (const id of ["a", "b"]) {
        const member = allGroups(figure).find((group) => group.data?.["element-id"] === id);
        const box = member?.primitives.find((primitive) => primitive.shape === "rect") as
          | { x: number; y: number; width: number; height: number }
          | undefined;
        assert.ok(box !== undefined, `${id} was not drawn`);
        assert.ok(box.x >= rect.x && box.x + box.width <= rect.x + rect.width, `${id} is outside its enclosure across`);
        assert.ok(box.y >= rect.y && box.y + box.height <= rect.y + rect.height, `${id} is outside its enclosure down`);
      }
    });
  }
});

describe("a narrowed figure stays narrowed when it is turned", () => {
  const data: StructuredGraphData = {
    nodes: [
      { id: "a", label: "Alpha", kind: "part" },
      { id: "b", label: "Beta", kind: "part" },
      { id: "c", label: "Gamma", kind: "note" },
    ],
    edges: [{ from: "a", to: "b", kind: "feeds" }],
  };
  const hidden = new Set([filterKey("element", "note")]);

  test("it still says it is showing less than the whole document", () => {
    for (const orientation of ["landscape", "portrait"] as const) {
      const figure = graphFigure(data, { isProposal: false, hidden, orientation });
      assert.ok(figure.narrowing !== undefined, `${orientation} lost the narrowing statement`);
      assert.equal(elementIds(figure).length, 2);
    }
  });

  test("both orientations hide exactly the same things", () => {
    const flat = graphFigure(data, { isProposal: false, hidden, orientation: "landscape" });
    const tall = graphFigure(data, { isProposal: false, hidden, orientation: "portrait" });
    assert.deepEqual(elementIds(tall), elementIds(flat));
    assert.equal(tall.narrowing, flat.narrowing);
  });
});
