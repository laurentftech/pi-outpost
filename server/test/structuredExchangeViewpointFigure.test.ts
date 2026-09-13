/**
 * What a viewpoint shows, decided once for every consumer.
 *
 * The reader, the export and the agent's figure tool all narrow a graph, and all by
 * exclusion. A viewpoint is written as an inclusion. Resolving it in one place is what
 * keeps the three from each deciding differently what "the power viewpoint" draws —
 * so it is tested here, under Node, with no browser, where the agent's figures are made.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { graphFigure, shownGraph, type Figure, type FigureGroup } from "@pi-outpost/shared/structured-exchange/figure";
import { describeFigureRefusal, figureForEnvelope } from "@pi-outpost/shared/structured-exchange/export";
import { filterKey, resolveViewpoint } from "@pi-outpost/shared/structured-exchange/model";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { StructuredGraphData, ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";

/** Two element kinds share no name with a relationship kind, except "power", which is both. */
const data: StructuredGraphData = {
  nodes: [
    { id: "battery", label: "Battery", kind: "source" },
    { id: "inverter", label: "Inverter", kind: "converter" },
    { id: "motor", label: "Motor", kind: "load" },
    { id: "ecu", label: "ECU", kind: "controller" },
    { id: "bus", label: "Power bus", kind: "power" },
    { id: "note", label: "Unclassified" },
  ],
  edges: [
    { from: "battery", to: "inverter", kind: "power" },
    { from: "inverter", to: "motor", kind: "power" },
    { from: "ecu", to: "inverter", kind: "signal" },
    { from: "battery", to: "bus", kind: "feeds" },
    // Kindless, which the contract allows a relationship only when it carries a reference.
    { from: "note", to: "motor", ref: "REL-1" },
  ],
};

/** The same graph as a document can carry it on its own: every relationship typed. */
const documentData: StructuredGraphData = { ...data, edges: data.edges.filter((edge) => edge.kind !== undefined) };

const power = {
  id: "power",
  label: "Power distribution",
  concern: "Where energy is stored, converted and consumed.",
  elementKinds: ["source", "converter", "load"],
  relationshipKinds: ["power"],
};

const ids = (graph: StructuredGraphData) => ({
  nodes: graph.nodes.map((node) => node.id).sort(),
  edges: graph.edges.map((edge) => `${edge.from}->${edge.to}:${edge.kind ?? ""}`).sort(),
});

const shown = (viewpoint: Parameters<typeof resolveViewpoint>[1], graph = data) =>
  ids(shownGraph(graph, resolveViewpoint(graph, viewpoint)));

describe("a viewpoint resolves to the narrowing every consumer already applies", () => {
  test("it shows exactly the elements and relationships of the kinds it retains", () => {
    // AViewpointRetainsOnlyItsKinds
    const view = shown(power);
    assert.deepEqual(view.nodes, ["battery", "inverter", "motor", "note"]);
    assert.deepEqual(view.edges, ["battery->inverter:power", "inverter->motor:power", "note->motor:"]);
  });

  test("a vocabulary it names no kinds for is left whole", () => {
    // AVocabularyTheViewpointDoesNotNameIsLeftWhole: every relationship between two
    // shown elements stays, whatever its kind.
    const view = shown({ elementKinds: ["source", "converter", "controller"] });
    assert.deepEqual(view.nodes, ["battery", "ecu", "inverter", "note"]);
    assert.deepEqual(view.edges, ["battery->inverter:power", "ecu->inverter:signal"]);
  });

  test("the two vocabularies stay independent", () => {
    // VocabulariesStayIndependent: "power" retained as an element kind retains the
    // power bus, and says nothing about power relationships.
    const narrowing = resolveViewpoint(data, { elementKinds: ["power"], relationshipKinds: ["feeds"] });
    assert.equal(narrowing.has(filterKey("element", "power")), false);
    assert.equal(narrowing.has(filterKey("relationship", "power")), true);
  });

  test("a thing with no kind is not hidden by a viewpoint", () => {
    // AKindlessElementIsNotHiddenByAViewpoint — and a kindless relationship likewise,
    // while it is still hidden when one of its endpoints is.
    assert.ok(shown(power).nodes.includes("note"));
    assert.ok(shown(power).edges.includes("note->motor:"));
    assert.ok(!shown({ elementKinds: ["source"] }).edges.includes("note->motor:"), "an edge to a hidden element survived");
  });

  test("a kind added to the model later is not shown unannounced", () => {
    // AKindAddedLaterIsNotShownUnannounced
    const grown: StructuredGraphData = {
      ...data,
      nodes: [...data.nodes, { id: "supercap", label: "Supercapacitor", kind: "storage" }],
      edges: [...data.edges, { from: "supercap", to: "inverter", kind: "power" }],
    };
    const view = shown(power, grown);
    assert.ok(!view.nodes.includes("supercap"), "a kind the viewpoint never named appeared in it");
    assert.ok(!view.edges.some((edge) => edge.startsWith("supercap")));
  });

  test("a viewpoint and a hand-built narrowing selecting the same kinds draw the same picture", () => {
    // The seam the design rests on: inclusion is only a way of writing the exclusion the
    // key and the figure tool already express.
    const byViewpoint = resolveViewpoint(data, power);
    const byHand = new Set([
      filterKey("element", "controller"),
      filterKey("element", "power"),
      filterKey("relationship", "signal"),
      filterKey("relationship", "feeds"),
    ]);
    assert.deepEqual([...byViewpoint].sort(), [...byHand].sort());
    assert.equal(
      JSON.stringify(graphFigure(data, { isProposal: false, hidden: byViewpoint })),
      JSON.stringify(graphFigure(data, { isProposal: false, hidden: byHand })),
    );
  });
});

/** The text the figure draws about itself, as one sentence. */
function statementOf(figure: Figure): string | undefined {
  const find = (groups: FigureGroup[]): FigureGroup | undefined => {
    for (const group of groups) {
      if (group.id === "filter-note") return group;
      const inner = group.groups ? find(group.groups) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  const note = find(figure.groups);
  return note?.primitives.map((primitive) => (primitive as { text: string }).text).join("");
}

describe("a figure drawn for a viewpoint says so", () => {
  const control = { id: "control", label: "Control", concern: "What commands what", elementKinds: ["controller", "converter"], relationshipKinds: ["signal"] };
  /** The document, with its viewpoints unless told otherwise — omitted, not set to undefined. */
  const envelope = (declaresViewpoints = true) => {
    const outcome = parseStructuredExchange(
      {
        schema: "urn:structured-exchange:2",
        kind: "graph",
        ...(declaresViewpoints ? { viewpoints: [power, control] } : {}),
        data: documentData,
      },
      checkStructuredExchangeSchema,
    );
    assert.ok(outcome.valid, outcome.valid ? "" : JSON.stringify(outcome.issues));
    return outcome.envelope as ValidatedStructuredExchange;
  };

  test("the statement names the viewpoint and the concern it frames, inside the figure", () => {
    const figure = graphFigure(data, { isProposal: false, hidden: resolveViewpoint(data, power), viewpoint: power });
    const drawn = statementOf(figure) ?? "";
    assert.match(drawn, /^Viewpoint: Power distribution — Where energy is stored, converted and consumed\./);
    assert.equal(figure.narrowing, drawn, "what the figure reports is not what it draws");
    assert.doesNotMatch(drawn, /\.\./, "a concern ending in a full stop doubled it");
  });

  test("a concern too long for one line is wrapped, and never cut short", () => {
    const long = { ...power, concern: `${"Where energy is stored, converted and consumed ".repeat(10).trim()}` };
    const figure = graphFigure(data, { isProposal: false, hidden: resolveViewpoint(data, long), viewpoint: long });
    const note = figure.groups.find((group) => group.id === "filter-note")!;
    assert.ok(note.primitives.length > 1, "a long concern was left on one line");
    assert.ok((statementOf(figure) ?? "").includes(long.concern), "the concern was shortened");
    const bottom = Math.max(...note.primitives.map((primitive) => (primitive as { y: number }).y));
    const [, top, , height] = figure.viewBox.split(" ").map(Number);
    assert.ok(bottom <= top + height, "the statement runs past the bottom of the figure");
  });

  test("it says the viewpoint has been adjusted when more is hidden than the viewpoint hides", () => {
    // TheKeyStillAppliesOnTopOfAViewpoint, as the figure states it.
    const hidden = new Set([...resolveViewpoint(data, power), filterKey("element", "load")]);
    const figure = graphFigure(data, { isProposal: false, hidden, viewpoint: power });
    assert.match(statementOf(figure) ?? "", /\(adjusted\)/);
  });

  test("a proposal's figure still says hidden kinds remain part of the proposal", () => {
    // AProposalFigureStillSaysHiddenKindsRemain
    const figure = graphFigure(data, { isProposal: true, hidden: resolveViewpoint(data, power), viewpoint: power });
    const drawn = statementOf(figure) ?? "";
    assert.match(drawn, /^Viewpoint: Power distribution/);
    assert.match(drawn, /still part of the proposal/);
  });

  test("the export draws a declared viewpoint, and names it", () => {
    const result = figureForEnvelope(envelope(), { viewpoint: "power" });
    assert.ok(result.ok, result.ok ? "" : describeFigureRefusal(result));
    assert.deepEqual(result.viewpoint, { id: "power", label: "Power distribution", source: "document" });
    assert.equal(result.coverage.elements, 4);
    assert.match(result.svg, /Viewpoint: Power distribution/);
  });

  test("hidden kinds named beside a viewpoint apply on top of it", () => {
    const result = figureForEnvelope(envelope(), { viewpoint: "power", hiddenElementKinds: ["load"] });
    assert.ok(result.ok);
    assert.equal(result.coverage.elements, 3, "the extra hidden kind was ignored");
    assert.match(result.narrowing ?? "", /\(adjusted\)/);
  });

  test("an undeclared viewpoint is refused, naming the ones the document declares", () => {
    const result = figureForEnvelope(envelope(), { viewpoint: "thermal" });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason === "unknown-viewpoint");
    assert.match(describeFigureRefusal(result), /"thermal".*"power", "control"/);
  });

  test("a viewpoint named for a document that declares none is refused saying so", () => {
    const result = figureForEnvelope(envelope(false), { viewpoint: "power" });
    assert.ok(!result.ok && result.reason === "no-viewpoints");
    assert.match(describeFigureRefusal(result), /declares no viewpoints/);
  });
});
