/**
 * A change keeps what is arranged (structured-exchange-arrangement, AChangeKeepsWhatIsArranged):
 * an arranged graph, recorded from its first drawing, then revised the way a chief engineer
 * revises one — an element added, one removed, a label changed — and drawn with the arrangement.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { routeGraph } from "@pi-outpost/shared/structured-exchange/wiring";
import { graphFigurePage } from "@pi-outpost/shared/structured-exchange/figure";
import { relationshipKeys, type ArrangementView } from "@pi-outpost/shared/structured-exchange/arrangement";
import { viewFromPage } from "@pi-outpost/shared/structured-exchange/placement";
import type { DrawioPage } from "@pi-outpost/shared/drawio/read";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

/** An electric vehicle's architecture, twelve elements over four ranks. */
const vehicle: StructuredGraphData = {
  nodes: [
    { id: "charger", label: "Chargeur embarqué", kind: "power" },
    { id: "battery", label: "Batterie HT", kind: "power", ref: "EL-BAT" },
    { id: "bms", label: "BMS", kind: "control" },
    { id: "inverter", label: "Onduleur", kind: "power" },
    { id: "dcdc", label: "Convertisseur DC/DC", kind: "power" },
    { id: "motor", label: "Moteur de traction", kind: "power" },
    { id: "lv", label: "Batterie 12 V", kind: "power" },
    { id: "vcu", label: "Calculateur véhicule", kind: "control" },
    { id: "pedal", label: "Pédale", kind: "sensor" },
    { id: "cooling", label: "Refroidissement", kind: "thermal" },
    { id: "hmi", label: "Tableau de bord", kind: "control" },
    { id: "gearbox", label: "Réducteur", kind: "mechanical" },
  ],
  edges: [
    { from: "charger", to: "battery", kind: "power", label: "charge" },
    { from: "battery", to: "inverter", kind: "power", label: "400 V" },
    { from: "battery", to: "dcdc", kind: "power", label: "400 V" },
    { from: "dcdc", to: "lv", kind: "power", label: "12 V" },
    { from: "inverter", to: "motor", kind: "power", label: "triphasé" },
    { from: "motor", to: "gearbox", kind: "mechanical", label: "couple" },
    { from: "bms", to: "battery", kind: "control", label: "surveillance" },
    { from: "bms", to: "vcu", kind: "data", label: "état de charge" },
    { from: "pedal", to: "vcu", kind: "data", label: "consigne" },
    { from: "vcu", to: "inverter", kind: "control", label: "couple demandé" },
    { from: "vcu", to: "hmi", kind: "data", label: "affichage" },
    { from: "cooling", to: "inverter", kind: "thermal" },
    { from: "cooling", to: "battery", kind: "thermal" },
  ],
};

type Rect = { x: number; y: number; width: number; height: number };

/** The boxes a page draws, by element id. */
const boxes = (page: DrawioPage): Map<string, Rect> =>
  new Map(page.cells.filter((cell) => cell.vertex && cell.id?.startsWith("n:")).map((cell) => [cell.id!.slice(2), { x: cell.geometry!.x, y: cell.geometry!.y, width: cell.geometry!.width, height: cell.geometry!.height }]));

/** The routes a page draws, by relationship key. */
const routes = (data: StructuredGraphData, page: DrawioPage) => {
  const keys = relationshipKeys(data);
  return new Map([...routeGraph(page)].map(([index, wire]) => [keys[index]!, JSON.stringify(wire.points)]));
};

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The graph arranged: drawn once, recorded, and the record drawn — what a figure written twice shows. */
function arranged(): { view: ArrangementView; page: DrawioPage } {
  const view = viewFromPage(vehicle, graphFigurePage(vehicle));
  return { view, page: graphFigurePage(vehicle, { arrangement: view }) };
}

describe("a change keeps what is arranged", () => {
  test("an arranged graph draws where its arrangement says, the same every time", () => {
    const { view, page } = arranged();
    for (const node of vehicle.nodes) {
      const key = node.ref === undefined ? `id:${node.id}` : `ref:${node.ref}`;
      const box = boxes(page).get(node.id)!;
      assert.deepEqual({ x: box.x, y: box.y }, view.elements[key], node.id);
    }
    assert.deepEqual(graphFigurePage(vehicle, { arrangement: view }), page);
  });

  // openlore: scenario=AnAddedElementLeavesTheRestInPlace spec=structured-exchange-arrangement
  test("AnAddedElementLeavesTheRestInPlace: a heat pump added to the cooling loop", () => {
    const { view, page } = arranged();
    const revised: StructuredGraphData = {
      nodes: [...vehicle.nodes, { id: "heatpump", label: "Pompe à chaleur", kind: "thermal" }],
      edges: [...vehicle.edges, { from: "cooling", to: "heatpump", kind: "thermal", label: "calories" }],
    };
    const after = graphFigurePage(revised, { arrangement: view });
    const before = boxes(page);
    const now = boxes(after);
    for (const [id, box] of before) assert.deepEqual(now.get(id), box, `${id} moved`);

    // Beside the element it relates to, overlapping nothing
    const added = now.get("heatpump")!;
    const cooling = now.get("cooling")!;
    const gap = Math.max(added.x - (cooling.x + cooling.width), cooling.x - (added.x + added.width), added.y - (cooling.y + cooling.height), cooling.y - (added.y + added.height));
    assert.ok(gap <= 120, `the heat pump is ${gap} away from the cooling loop`);
    for (const [id, box] of before) assert.ok(!overlap(added, box), `the heat pump lies on ${id}`);

    // Only the wires touching it, or crossing its box, are routed again
    const was = routes(vehicle, page);
    const is = routes(revised, after);
    for (const [key, route] of was) {
      const points: Array<{ x: number; y: number }> = JSON.parse(is.get(key)!);
      const crosses = points.some((point, index) => index > 0 && overlap(added, { x: Math.min(point.x, points[index - 1]!.x), y: Math.min(point.y, points[index - 1]!.y), width: Math.abs(point.x - points[index - 1]!.x) || 1, height: Math.abs(point.y - points[index - 1]!.y) || 1 }));
      if (!crosses) assert.equal(is.get(key), route, `${key} was routed again`);
    }
  });

  // openlore: scenario=ARemovedElementLeavesItsPlaceEmpty spec=structured-exchange-arrangement
  test("ARemovedElementLeavesItsPlaceEmpty: the pedal removed, nothing moves into its place", () => {
    const { view, page } = arranged();
    const revised: StructuredGraphData = { nodes: vehicle.nodes.filter((node) => node.id !== "pedal"), edges: vehicle.edges.filter((edge) => edge.from !== "pedal" && edge.to !== "pedal") };
    const after = boxes(graphFigurePage(revised, { arrangement: view }));
    const before = boxes(page);
    const hole = before.get("pedal")!;
    for (const [id, box] of after) {
      assert.deepEqual(box, before.get(id), `${id} moved`);
      assert.ok(!overlap(box, hole), `${id} moved into the pedal's place`);
    }
  });

  // openlore: scenario=AChangedLabelKeepsTheRoute spec=structured-exchange-arrangement
  test("AChangedLabelKeepsTheRoute: 400 V relabelled 800 V, its route unchanged", () => {
    const { view, page } = arranged();
    const revised: StructuredGraphData = { ...vehicle, edges: vehicle.edges.map((edge) => (edge.label === "400 V" && edge.to === "inverter" ? { ...edge, label: "800 V" } : edge)) };
    const after = graphFigurePage(revised, { arrangement: view });
    assert.deepEqual([...routes(revised, after)], [...routes(vehicle, page)]);
  });

  // openlore: scenario=AnElementKeepsItsPlaceThroughItsReference spec=structured-exchange-arrangement
  test("AnElementKeepsItsPlaceThroughItsReference: the battery given another envelope id keeps its place", () => {
    const { view, page } = arranged();
    const rename = (id: string) => (id === "battery" ? "hv-battery" : id);
    const revised: StructuredGraphData = {
      nodes: vehicle.nodes.map((node) => ({ ...node, id: rename(node.id) })),
      edges: vehicle.edges.map((edge) => ({ ...edge, from: rename(edge.from), to: rename(edge.to) })),
    };
    const after = boxes(graphFigurePage(revised, { arrangement: view }));
    assert.deepEqual(after.get("hv-battery"), boxes(page).get("battery"));
  });

  test("an element related to nothing placed goes after everything, in reading order", () => {
    const { view, page } = arranged();
    const revised: StructuredGraphData = { ...vehicle, nodes: [...vehicle.nodes, { id: "radio", label: "Radio", kind: "comfort" }] };
    const radio = boxes(graphFigurePage(revised, { arrangement: view })).get("radio")!;
    const right = Math.max(...[...boxes(page).values()].map((box) => box.x + box.width));
    assert.ok(radio.x > right, `the radio at ${radio.x} is not after ${right}`);
  });
});

describe("making room", () => {
  test("an element with no free slot near what it relates to moves what lies beyond, and says which", async () => {
    const { placeArranged } = await import("@pi-outpost/shared/structured-exchange/placement");
    // A packed 15 × 15 block of arranged boxes, the anchor in its middle: no slot within reach
    const nodes = Array.from({ length: 225 }, (_, index) => ({ id: `b${index}`, label: `B${index}` }));
    const view: ArrangementView = { elements: Object.fromEntries(nodes.map((node, index) => [`id:${node.id}`, { x: (index % 15) * 130, y: Math.floor(index / 15) * 50 }])), relationships: {} };
    const data: StructuredGraphData = { nodes: [...nodes, { id: "new", label: "New" }], edges: [{ from: "b112", to: "new", kind: "k" }] };
    const placement = placeArranged(data, view, () => ({ width: 120, height: 40 }), "landscape");
    const all = new Map(placement.boxes.map((box) => [box.id, box]));
    const added = all.get("new")!;
    assert.ok(placement.shifted.length > 0, "nothing was moved to make room");
    for (const box of placement.boxes) if (box.id !== "new") assert.ok(!overlap(added, box), `new lies on ${box.id}`);
    // Every box reported moved is one that did move, from where it was
    for (const { id, from } of placement.shifted) assert.notDeepEqual({ x: all.get(id)!.x, y: all.get(id)!.y }, from);
    // Boxes before the insertion did not move
    assert.deepEqual({ x: all.get("b105")!.x, y: all.get("b105")!.y }, view.elements["id:b105"]);
  });
});
