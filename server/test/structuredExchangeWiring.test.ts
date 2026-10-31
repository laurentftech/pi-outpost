/**
 * A graph's relationships routed as draw.io routes an orthogonal connector
 * (structured-exchange-arrangement), over every graph in the conformance corpus and the
 * vehicle model: the routes are the port's, so a relationship the port refused would be
 * drawn some other way — counted here, since none may be.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readDrawio } from "@pi-outpost/shared/drawio/read";
import { writeDrawio } from "@pi-outpost/shared/drawio/write";
import { graphFigure, graphFigurePage, type Figure, type FigureGroup } from "@pi-outpost/shared/structured-exchange/figure";
import { routeGraph } from "@pi-outpost/shared/structured-exchange/wiring";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { StructuredGraphData, ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VALID = path.join(ROOT, "shared", "conformance", "valid");

/** Every graph document committed to the repository. */
const corpus = [
  ...readdirSync(VALID).filter((name) => name.endsWith(".json")).map((name) => path.join(VALID, name)),
  path.join(ROOT, "models", "vehicle-architecture.json"),
].flatMap((file) => {
  const outcome = parseStructuredExchange(JSON.parse(readFileSync(file, "utf8")), checkStructuredExchangeSchema);
  if (!outcome.valid) return [];
  const envelope = outcome.envelope as ValidatedStructuredExchange;
  return envelope.kind === "graph" ? [{ name: path.basename(file), envelope }] : [];
});

/** The drawn line of every relationship, in document order. */
function lines(figure: Figure): string[] {
  const out: string[] = [];
  const walk = (group: FigureGroup) => {
    for (const primitive of group.primitives) if (primitive.data?.edge === "line") out.push((primitive as { d: string }).d);
    for (const inner of group.groups ?? []) walk(inner);
  };
  for (const group of figure.groups) walk(group);
  return out;
}

const pointsOf = (d: string) => {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index]!, y: numbers[index + 1]! });
  return points;
};

const orthogonal = (d: string) => {
  if (!/^M [\d.-]+ [\d.-]+( L [\d.-]+ [\d.-]+)+$/.test(d)) return false;
  const points = pointsOf(d);
  return points.every((point, index) => index === 0 || point.x === points[index - 1]!.x || point.y === points[index - 1]!.y);
};

describe("relationships routed as draw.io routes them", () => {
  test("there are graphs to route", () => assert.ok(corpus.length >= 10, corpus.map((entry) => entry.name).join(", ")));

  // openlore: scenario=WiresRunInStraightSegments spec=structured-exchange-arrangement
  test("WiresRunInStraightSegments: every relationship between two elements, in every corpus graph, is horizontal and vertical runs", () => {
    for (const { name, envelope } of corpus) {
      const data = envelope.data as StructuredGraphData;
      const drawn = lines(graphFigure(data, { isProposal: envelope.target !== undefined }));
      const between = data.edges.map((edge) => edge.from !== edge.to);
      assert.equal(drawn.length, data.edges.length, name);
      drawn.forEach((d, index) => {
        if (between[index]) assert.ok(orthogonal(d), `${name}, relationship ${index}: ${d}`);
      });
    }
  });

  // openlore: scenario=ParallelRelationshipsAreDrawnApart spec=structured-exchange
  test("ParallelRelationshipsAreDrawnApart: five between one pair, both ways, each on a line of its own", () => {
    const data: StructuredGraphData = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b", kind: "one" },
        { from: "a", to: "b", kind: "two" },
        { from: "a", to: "b", kind: "three" },
        { from: "b", to: "a", kind: "back" },
        { from: "b", to: "a", kind: "again" },
      ],
    };
    const drawn = lines(graphFigure(data, { isProposal: false }));
    assert.equal(new Set(drawn).size, 5, drawn.join(" | "));
    // Each leaves from a point of its own, further than the distance at which two lines read as one
    const starts = drawn.map((d) => pointsOf(d)[0]!);
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        assert.ok(Math.hypot(starts[i]!.x - starts[j]!.x, starts[i]!.y - starts[j]!.y) > 8, `${drawn[i]} and ${drawn[j]} start together`);
      }
    }
  });

  test("a relationship from an element to itself keeps its loop", () => {
    const data: StructuredGraphData = { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "a", kind: "self" }] };
    const [loop] = lines(graphFigure(data, { isProposal: false }));
    assert.match(loop!, / C /);
  });
});

describe("the figure's page written as a draw.io file", () => {
  test("reads back as the same cells, and routes the same", () => {
    for (const { name, envelope } of corpus) {
      const page = graphFigurePage(envelope.data as StructuredGraphData);
      const [back] = readDrawio(writeDrawio(page));
      assert.ok(back, name);
      const strip = (cells: typeof page.cells) => cells.map((cell) => ({ ...cell, geometry: cell.geometry === undefined ? undefined : { ...cell.geometry } }));
      assert.deepEqual(strip(back.cells), strip(page.cells), name);
      const ours = routeGraph(page);
      const theirs = routeGraph(back);
      assert.deepEqual([...theirs], [...ours], name);
    }
  });
});
