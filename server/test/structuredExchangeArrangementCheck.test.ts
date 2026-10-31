/**
 * What an arrangement leaves for a person to look at (structured-exchange-arrangement,
 * TheArrangementIsCheckedAgainstTheDocument), said in the document's terms with the value that
 * fixes it — and nothing at all for a clean one.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkArrangement } from "@pi-outpost/shared/structured-exchange/arrangement-check";
import { graphFigurePage } from "@pi-outpost/shared/structured-exchange/figure";
import { viewFromPage } from "@pi-outpost/shared/structured-exchange/placement";
import type { ArrangementView } from "@pi-outpost/shared/structured-exchange/arrangement";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

const row: StructuredGraphData = {
  nodes: [
    { id: "a", label: "Capteur" },
    { id: "b", label: "Filtre" },
    { id: "c", label: "Calculateur" },
  ],
  edges: [
    { from: "a", to: "b", kind: "signal", label: "brut" },
    { from: "b", to: "c", kind: "signal", label: "filtré" },
    { from: "a", to: "c", kind: "signal", label: "diagnostic" },
  ],
};

/** Three boxes in a row, and the diagnostic wire from the first to the last sent straight through the middle one. */
const through = (): ArrangementView => ({
  elements: { "id:a": { x: 20, y: 100 }, "id:b": { x: 220, y: 100 }, "id:c": { x: 420, y: 100 } },
  relationships: { "id:a>id:c[signal]#0": { exit: { x: 1, y: 0.5 }, entry: { x: 0, y: 0.5 } } },
});

describe("the arrangement check", () => {
  // openlore: scenario=AWireThroughABoxIsListed spec=structured-exchange-arrangement
  test("AWireThroughABoxIsListed: the relationship and the box are named, with waypoints that go round, which clear it", () => {
    const findings = checkArrangement(row, { arrangement: through() });
    const found = findings.find((finding) => /runs through/.test(finding.message));
    assert.ok(found, JSON.stringify(findings));
    assert.deepEqual(found.relationships, [2]);
    assert.deepEqual(found.elements, ["b"]);
    const match = /^"Capteur → Calculateur" \(diagnostic\) runs through "Filtre": give it waypoints at \((-?\d+), (-?\d+)\), \((-?\d+), (-?\d+)\)$/.exec(found.message);
    assert.ok(match, found.message);
    // The waypoints given, put in the arrangement, take the wire clear
    const fixed = through();
    fixed.relationships["id:a>id:c[signal]#0"]!.waypoints = [{ x: Number(match[1]), y: Number(match[2]) }, { x: Number(match[3]), y: Number(match[4]) }];
    assert.equal(checkArrangement(row, { arrangement: fixed }).some((finding) => /runs through/.test(finding.message)), false);
  });

  // openlore: scenario=ACleanArrangementReportsNothing spec=structured-exchange-arrangement
  test("ACleanArrangementReportsNothing: an arrangement recorded from a clean drawing reports nothing", () => {
    const view = viewFromPage(row, graphFigurePage(row));
    assert.deepEqual(checkArrangement(row, { arrangement: view }), []);
    // …and neither does no arrangement at all, on a graph the cleanup leaves clean
    assert.deepEqual(checkArrangement(row), []);
  });

  // openlore: scenario=AnEntryForSomethingGoneIsNamed spec=structured-exchange-arrangement
  test("AnEntryForSomethingGoneIsNamed: entries for an element and a relationship the document dropped are named, and nothing is drawn for them", () => {
    const view = viewFromPage(row, graphFigurePage(row));
    view.elements["id:old"] = { x: 600, y: 100 };
    view.relationships["id:old>id:a[signal]#0"] = {};
    const findings = checkArrangement(row, { arrangement: view }).map((finding) => finding.message);
    assert.deepEqual(findings, [
      'the arrangement places "id:old", which the document no longer holds: nothing is drawn for it, and it can be removed from the arrangement',
      'the arrangement routes "id:old>id:a[signal]#0", which the document no longer holds: nothing is drawn for it, and it can be removed from the arrangement',
    ]);
    assert.equal(graphFigurePage(row, { arrangement: view }).cells.some((cell) => cell.id === "n:old"), false);
  });

  test("a box moved to make room is named, with where it was and where it is", () => {
    const nodes = Array.from({ length: 225 }, (_, index) => ({ id: `b${index}`, label: `B${index}` }));
    const view: ArrangementView = { elements: Object.fromEntries(nodes.map((node, index) => [`id:${node.id}`, { x: (index % 15) * 130, y: Math.floor(index / 15) * 50 }])), relationships: {} };
    const data: StructuredGraphData = { nodes: [...nodes, { id: "new", label: "Nouveau" }], edges: [{ from: "b112", to: "new", kind: "k" }] };
    const moved = checkArrangement(data, { arrangement: view }).filter((finding) => /to make room/.test(finding.message));
    assert.ok(moved.length > 0);
    assert.match(moved[0]!.message, /^"B\d+" was moved from \(\d+, \d+\) to \(\d+, \d+\) to make room for "Nouveau": check it still reads as you arranged it$/);
  });

  test("a rule's warning is said in the document's terms, its values kept", () => {
    const view = viewFromPage(row, graphFigurePage(row));
    // Both of the sensor's flows pinned to one point: a shared point between different data
    view.relationships["id:a>id:b[signal]#0"] = { exit: { x: 1, y: 0.5 } };
    view.relationships["id:a>id:c[signal]#0"] = { exit: { x: 1, y: 0.5 } };
    const shared = checkArrangement(row, { arrangement: view }).find((finding) => /at the same point/.test(finding.message));
    assert.ok(shared);
    assert.match(shared.message, /"Capteur → Filtre" \(brut\)/);
    assert.match(shared.message, /meet shape "Capteur" at the same point/);
    assert.match(shared.message, /exitX=1;exitY=0\.\d+ for "Capteur → (Filtre|Calculateur)"/);
    assert.doesNotMatch(shared.message, /"[nr]:/);
  });
});
