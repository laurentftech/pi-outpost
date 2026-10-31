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
import { checkPages } from "@pi-outpost/shared/drawio/check";
import { ANCHOR } from "@pi-outpost/shared/drawio/follow-advice";
import { readDrawio } from "@pi-outpost/shared/drawio/read";
import { viewFromPage } from "@pi-outpost/shared/structured-exchange/placement";
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

describe("the automatic placement cleaned up by drawio_check's wire rules", () => {
  /** The rules' wire warnings on a page: what the arrangement check lists. */
  const wireWarnings = (page: ReturnType<typeof graphFigurePage>) =>
    checkPages([page]).issues.filter((issue) => ANCHOR.test(issue.message) || /runs through/.test(issue.message)).map((issue) => issue.message);

  // openlore: scenario=TwoFlowsToOneBoxLeaveFromTheirOwnPoints spec=structured-exchange-arrangement
  test("TwoFlowsToOneBoxLeaveFromTheirOwnPoints: two flows of different data out of one element leave at points of their own", () => {
    const data: StructuredGraphData = {
      nodes: [
        { id: "ecu", label: "ECU" },
        { id: "left", label: "Left motor" },
        { id: "right", label: "Right motor" },
      ],
      edges: [
        { from: "ecu", to: "left", kind: "signal", label: "torque" },
        { from: "ecu", to: "right", kind: "signal", label: "speed" },
      ],
    };
    const page = graphFigurePage(data);
    const starts = [...routeGraph(page).values()].map((wire) => wire.points[0]!);
    assert.equal(starts.length, 2);
    assert.ok(Math.hypot(starts[0]!.x - starts[1]!.x, starts[0]!.y - starts[1]!.y) > 8, JSON.stringify(starts));
    assert.deepEqual(wireWarnings(page), []);
  });

  // openlore: scenario=AFreshFigureHasNoWireDefectLeftUnreported spec=structured-exchange-arrangement
  test("AFreshFigureHasNoWireDefectLeftUnreported: every corpus graph, drawn with no arrangement, is clean or says what is left", () => {
    let clean = 0;
    for (const { name, envelope } of corpus) {
      const left = wireWarnings(graphFigurePage(envelope.data as StructuredGraphData));
      if (left.length === 0) clean += 1;
      // Whatever is left carries what to do about it, for the check to pass on
      for (const message of left) assert.match(message, /Fix|fix|move|give|set|drop|remove/, `${name}: ${message}`);
    }
    // The cleanup does its job on most of them, not merely reports
    assert.ok(clean >= corpus.length - 2, `${clean} of ${corpus.length} corpus graphs are clean`);
  });

  test("an arranged wire is never changed by the cleanup, even when a rule has something to say about it", () => {
    const data: StructuredGraphData = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { from: "a", to: "b", kind: "x", label: "one" },
        { from: "a", to: "c", kind: "x", label: "two" },
      ],
    };
    const free = graphFigurePage(data);
    const view = viewFromPage(data, free);
    // Both wires pinned to one point of a's side: a shared point the rules warn about
    for (const entry of Object.values(view.relationships)) entry.exit = { x: 1, y: 0.5 };
    const page = graphFigurePage(data, { arrangement: view });
    const styles = page.cells.filter((cell) => cell.edge).map((cell) => cell.style);
    for (const style of styles) assert.match(style, /exitX=1;exitY=0\.5;/);
    assert.ok(wireWarnings(page).some((message) => /at the same point/.test(message)), "the shared point is still reported");
  });
});
