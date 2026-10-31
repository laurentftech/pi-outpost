/**
 * The arrangement file (structured-exchange-arrangement, design 3): keyed by identity, read
 * strictly, written as canonical text so it can be versioned, and never mistaken for a document.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  arrangementPathFor,
  elementKey,
  emptyArrangement,
  readArrangement,
  relationshipKeys,
  writeArrangement,
  type Arrangement,
} from "@pi-outpost/shared/structured-exchange/arrangement";
import { readStructuredExchangeDocument } from "@pi-outpost/shared/structured-exchange/document";
import { describeFigureRefusal, figureForDocument } from "@pi-outpost/shared/structured-exchange/export";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

const arranged = (): Arrangement => ({
  ...emptyArrangement(),
  views: {
    "": {
      elements: { "id:b": { x: 300, y: 40 }, "id:a": { x: 40, y: 40 } },
      relationships: { "id:a>id:b[power]#0": { exit: { x: 1, y: 0.25 }, entry: { x: 0, y: 0.25 }, waypoints: [{ x: 200, y: 55 }] } },
    },
    power: { orientation: "portrait", elements: { "ref:REQ-1": { x: 40, y: 40 } }, relationships: {} },
  },
});

describe("the arrangement file", () => {
  test("lives beside its document", () => {
    assert.equal(arrangementPathFor("models/vehicle.json"), "models/vehicle.arrangement.json");
    assert.equal(arrangementPathFor("models/vehicle"), "models/vehicle.arrangement.json");
  });

  // openlore: scenario=AnArrangementWritesTheSameTextTwice spec=structured-exchange-arrangement
  test("AnArrangementWritesTheSameTextTwice: the same arrangement is the same bytes, and one moved box one changed line", () => {
    const first = writeArrangement(arranged());
    assert.equal(writeArrangement(arranged()), first);
    // Read back and written again: still the same bytes
    const reread = readArrangement(first);
    assert.ok(reread.ok, reread.ok ? "" : reread.reason);
    assert.equal(writeArrangement(reread.arrangement), first);

    const moved = arranged();
    moved.views[""]!.elements["id:b"] = { x: 320, y: 40 };
    const third = writeArrangement(moved).split("\n");
    const before = first.split("\n");
    assert.equal(third.length, before.length);
    const changed = third.filter((line, index) => line !== before[index]);
    assert.deepEqual(changed, ['        "id:b": { "x": 320, "y": 40 }']);
  });

  test("places are kept on the grid, fractions to four decimals", () => {
    const off = arranged();
    off.views[""]!.elements["id:a"] = { x: 43.7, y: 38.2 };
    off.views[""]!.relationships["id:a>id:b[power]#0"]!.exit = { x: 1, y: 1 / 3 };
    const text = writeArrangement(off);
    assert.match(text, /"id:a": \{ "x": 40, "y": 40 \}/);
    assert.match(text, /"exit": \{ "x": 1, "y": 0\.3333 \}/);
  });

  test("a file that is not an arrangement is refused with the reason, never half-read", () => {
    assert.deepEqual(readArrangement("{"), { ok: false, reason: "it is not parseable JSON" });
    assert.equal(readArrangement(JSON.stringify({ views: {} })).ok, false);
    const bad = readArrangement(JSON.stringify({ format: "pi-outpost/structured-exchange-arrangement-1", views: { "": { elements: { "id:a": { x: "40" } }, relationships: {} } } }));
    assert.deepEqual(bad, { ok: false, reason: 'element "id:a" of view "" has no x and y' });
    // A view missing a map is refused, not read as empty and later written over
    const format = "pi-outpost/structured-exchange-arrangement-1";
    assert.deepEqual(readArrangement(JSON.stringify({ format, views: { "": { relationships: {} } } })), { ok: false, reason: 'view "" has no elements' });
    assert.deepEqual(readArrangement(JSON.stringify({ format, views: { power: { elements: {}, relationships: [] } } })), { ok: false, reason: 'view "power" has no relationships' });
  });

  // openlore: scenario=AnArrangementIsNeverReadAsADocument spec=structured-exchange-arrangement
  test("AnArrangementIsNeverReadAsADocument: the viewer's reader and the figure tool both say it is no document", () => {
    const text = writeArrangement(arranged());
    // The file viewer and the reply blocks read through this, with the browser's schema check
    assert.equal(readStructuredExchangeDocument(text, checkStructuredExchangeSchema).status, "not-a-document");
    const figure = figureForDocument(text, checkStructuredExchangeSchema);
    assert.equal(figure.ok, false);
    assert.match(describeFigureRefusal(figure as Exclude<typeof figure, { ok: true }>), /^not a structured-exchange document/);
  });
});

describe("keys follow identity", () => {
  test("an element is named by its reference when it carries one, so a new envelope id keeps its key", () => {
    assert.equal(elementKey({ id: "e1", ref: "REQ-1" }), "ref:REQ-1");
    assert.equal(elementKey({ id: "e7", ref: "REQ-1" }), elementKey({ id: "e1", ref: "REQ-1" }));
    assert.equal(elementKey({ id: "battery" }), "id:battery");
  });

  test("a reference holding the characters keys are built from cannot make two keys read alike", () => {
    const tricky: StructuredGraphData = {
      nodes: [
        { id: "a>b", label: "x" },
        { id: "c", label: "y" },
        { id: "a", label: "z" },
        { id: "b>c", label: "w" },
      ],
      edges: [
        { from: "a>b", to: "c", kind: "k" },
        { from: "a", to: "b>c", kind: "k" },
      ],
    };
    const [one, two] = relationshipKeys(tricky);
    assert.notEqual(one, two);
  });

  test("a relationship's key is its endpoints, kind and rank: relabelled it keeps its key, re-attached it does not", () => {
    const data: StructuredGraphData = {
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C", ref: "EL-C" },
      ],
      edges: [
        { from: "a", to: "b", kind: "power", label: "48 V" },
        { from: "a", to: "b", kind: "power" },
        { from: "a", to: "c", kind: "signal" },
        { from: "b", to: "c", ref: "REL-9" },
      ],
    };
    assert.deepEqual(relationshipKeys(data), ["id:a>id:b[power]#0", "id:a>id:b[power]#1", "id:a>ref:EL-C[signal]#0", "ref:REL-9"]);
    const relabelled = { ...data, edges: data.edges.map((edge, index) => (index === 0 ? { ...edge, label: "400 V" } : edge)) };
    assert.deepEqual(relationshipKeys(relabelled), relationshipKeys(data));
    const reattached = { ...data, edges: data.edges.map((edge, index) => (index === 2 ? { ...edge, from: "b" } : edge)) };
    assert.notEqual(relationshipKeys(reattached)[2], relationshipKeys(data)[2]);
  });
});
