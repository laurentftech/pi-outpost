/**
 * Producing a figure with no browser anywhere.
 *
 * The gate first: a document that fails validation yields no figure, and the
 * reason is the answer. Then the two things a narrowing can get wrong quietly —
 * a name qualified into the wrong vocabulary, which hides nothing and draws a
 * perfectly good picture of the whole document; and a narrowing that hides
 * everything, which draws an empty canvas and reports success.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  describeCoverage,
  describeFigureRefusal,
  figureForDocument,
  type FigureExport,
} from "@pi-outpost/shared/structured-exchange/export";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";

const graph = {
  schema: S,
  kind: "graph",
  data: {
    nodes: [
      { id: "batt", label: "Batterie", kind: "power" },
      { id: "ecu", label: "Calculateur", kind: "compute" },
    ],
    edges: [
      { from: "batt", to: "ecu", label: "400V", kind: "power" },
      { from: "ecu", to: "batt", label: "état", kind: "signal" },
    ],
  },
};

const table = { schema: S, kind: "table", data: { columns: ["ID"], rows: [["REQ-1"]] } };

const figure = (document: unknown, narrowing = {}) =>
  figureForDocument(JSON.stringify(document), checkStructuredExchangeSchema, narrowing);

const produced = (document: unknown, narrowing = {}): FigureExport => {
  const result = figure(document, narrowing);
  if (!result.ok) throw new Error(`expected a figure, got ${result.reason}`);
  return result;
};

describe("a document that is not fit to draw yields no figure", () => {
  test("an invalid document is refused with its reasons and no markup", () => {
    const result = figure({ schema: S, kind: "graph", data: { nodes: [{}], edges: [] } });
    assert.equal(result.ok, false);
    if (result.ok || result.reason !== "invalid") return assert.fail(`got ${JSON.stringify(result)}`);
    assert.ok(result.issues.length > 0);
    // Nothing partial travelled back alongside the refusal.
    assert.equal((result as unknown as { svg?: string }).svg, undefined);
    assert.match(describeFigureRefusal(result), /does not satisfy/);
  });

  test("a version this build does not implement is named, not validated", () => {
    const result = figure({ schema: "urn:structured-exchange:3", kind: "constellation" });
    if (result.ok || result.reason !== "unsupported-version") return assert.fail(`got ${JSON.stringify(result)}`);
    assert.match(describeFigureRefusal(result), /urn:structured-exchange:3/);
  });

  test("JSON that declares nothing is refused as what it is", () => {
    const result = figure({ kind: "graph", data: { nodes: [], edges: [] } });
    if (result.ok || result.reason !== "not-a-document") return assert.fail(`got ${JSON.stringify(result)}`);
  });

  test("a table has no figure, and says so rather than drawing an empty one", () => {
    // A table leaves as a spreadsheet. Refusing it here is what keeps a caller
    // from writing a blank .svg and referencing it from a report.
    const result = figure(table);
    if (result.ok || result.reason !== "not-drawable") return assert.fail(`got ${JSON.stringify(result)}`);
    assert.equal(result.kind, "table");
    assert.match(describeFigureRefusal(result), /table/);
  });
});

describe("the narrowing is the reader's narrowing", () => {
  test("no narrowing draws the whole document", () => {
    const result = produced(graph);
    assert.deepEqual(result.coverage, { elements: 2, ofElements: 2, relationships: 2, ofRelationships: 2 });
    assert.equal(result.narrowing, undefined, "a whole document has nothing to say about itself");
    assert.match(describeCoverage(result.coverage), /whole document/);
  });

  test("the two vocabularies are independent even when a name is in both", () => {
    // `power` names an element kind *and* a relationship kind here, and the two
    // are deliberately not on the same things: the power relationship runs between
    // two compute elements, and the power element is on the end of a signal one.
    // So each half of this can fail without the other noticing.
    const both = {
      schema: S,
      kind: "graph",
      data: {
        nodes: [
          { id: "p1", label: "Batterie", kind: "power" },
          { id: "c1", label: "Calculateur", kind: "compute" },
          { id: "c2", label: "Tableau", kind: "compute" },
        ],
        edges: [
          { from: "c1", to: "c2", label: "400V", kind: "power" },
          { from: "p1", to: "c1", label: "état", kind: "signal" },
        ],
      },
    };

    const asElement = produced(both, { hiddenElementKinds: ["power"] });
    assert.equal(asElement.coverage.elements, 2, "the power element was not hidden");
    // The power *relationship* survived hiding the power *element* kind. The one
    // relationship that went with it went because its endpoint did, which is a
    // different rule and the only one allowed to drop it.
    assert.equal(asElement.coverage.relationships, 1, "hiding an element kind hid a same-named relationship");

    const asRelationship = produced(both, { hiddenRelationshipKinds: ["power"] });
    assert.equal(asRelationship.coverage.relationships, 1, "the power relationship was not hidden");
    assert.equal(asRelationship.coverage.elements, 3, "hiding a relationship kind hid a same-named element");
  });

  test("a relationship whose endpoint is hidden goes with it", () => {
    // Stated on its own rather than left implicit in the test above: an arrow to a
    // box that is not drawn cannot be drawn, and the count has to say so.
    const result = produced(graph, { hiddenElementKinds: ["power"] });
    assert.equal(result.coverage.elements, 1);
    assert.equal(result.coverage.relationships, 0);
  });

  test("a narrowed figure states how much of the document it shows", () => {
    const result = produced(graph, { hiddenRelationshipKinds: ["signal"] });
    assert.match(result.narrowing ?? "", /1 of 2 relationships/);
    // …and the sentence is inside the picture, not only in the result.
    assert.ok(result.svg.includes("1 of 2 relationships"), "the figure does not carry its own statement");
  });

  test("the accessible name counts what is drawn, not what was declared", () => {
    // The name is the whole picture to a reader who cannot see it. Hiding a
    // relationship kind leaves every box in place, which is exactly the case that
    // went on announcing the full relationship count.
    const narrowed = produced(graph, { hiddenRelationshipKinds: ["signal"] });
    assert.match(narrowed.svg, /aria-label="Graph of 2 elements and 2 relationships, filtered to 2 elements and 1 relationships"/);

    const whole = produced(graph);
    assert.match(whole.svg, /aria-label="Graph of 2 elements and 2 relationships"/);
    assert.doesNotMatch(whole.svg, /filtered to/);
  });

  test("a proposal's figure says the hidden types are still proposed", () => {
    const result = produced(
      { ...graph, target: "artifact-1" },
      { hiddenRelationshipKinds: ["signal"] },
    );
    assert.match(result.narrowing ?? "", /still part of the proposal/);
  });

  test("a narrowing that leaves nothing is reported, not drawn", () => {
    const result = figure(graph, { hiddenElementKinds: ["power", "compute"] });
    if (result.ok || result.reason !== "nothing-to-draw") return assert.fail(`got ${JSON.stringify(result)}`);
    assert.equal(result.coverage.ofElements, 2);
    assert.match(describeFigureRefusal(result), /nothing to draw/);
  });
});

describe("the figure itself", () => {
  test("is one complete, self-contained SVG document", () => {
    const svg = produced(graph).svg;
    assert.ok(svg.startsWith("<svg "), "not an SVG document");
    assert.ok(svg.trimEnd().endsWith("</svg>"));
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
    for (const forbidden of ["<script", "<style", "<image", "xlink:href", "@import", "@font-face"]) {
      assert.ok(!svg.includes(forbidden), `the figure carries ${forbidden}`);
    }
    // The only address a figure may name is the namespace it declares.
    assert.deepEqual(
      (svg.match(/https?:\/\/[^"' )]+/g) ?? []).filter((url) => url !== "http://www.w3.org/2000/svg"),
      [],
    );
  });

  test("is byte-identical for the same document and narrowing", () => {
    const narrowing = { hiddenRelationshipKinds: ["signal"] };
    assert.equal(produced(graph, narrowing).svg, produced(graph, narrowing).svg);
  });

  test("draws a sequence too", () => {
    const result = produced({
      schema: S,
      kind: "sequence",
      data: {
        participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        messages: [{ from: "a", to: "b", label: "hello" }],
      },
    });
    assert.ok(result.svg.includes("hello"));
    assert.deepEqual(result.coverage, { elements: 2, ofElements: 2, relationships: 1, ofRelationships: 1 });
  });
});
