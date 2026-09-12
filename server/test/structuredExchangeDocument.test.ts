/**
 * Recognising a structured-exchange document that arrived as a file.
 *
 * The four outcomes exist because conflating any two of them misleads somebody.
 * An unrelated JSON file rendered as a diagram would be a lie about what it is; a
 * version we do not implement reported as "invalid" blames a producer who did
 * nothing wrong; a document that declares the schema and fails it must be named
 * as such, because the reader is the only person positioned to say so; and a file
 * refused for its size is not a claim about its content at all.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  declaredStructuredExchangeSchema,
  readStructuredExchangeDocument,
  STRUCTURED_EXCHANGE_SCHEMA_PREFIX,
} from "@pi-outpost/shared/structured-exchange/document";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 } from "@pi-outpost/shared/structured-exchange";

const graph = {
  schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
  kind: "graph",
  data: { nodes: [{ id: "a", label: "A" }], edges: [] },
};

const read = (text: string) => readStructuredExchangeDocument(text, checkStructuredExchangeSchema);

describe("what a candidate declares", () => {
  test("a document in the family reports its own identifier", () => {
    assert.equal(declaredStructuredExchangeSchema(JSON.stringify(graph)), STRUCTURED_EXCHANGE_SCHEMA_V1);
    assert.ok(STRUCTURED_EXCHANGE_SCHEMA_V1.startsWith(STRUCTURED_EXCHANGE_SCHEMA_PREFIX));
  });

  test("a future version still reports as the family, so it can be told apart", () => {
    assert.equal(
      declaredStructuredExchangeSchema(JSON.stringify({ schema: "urn:structured-exchange:7" })),
      "urn:structured-exchange:7",
    );
  });

  test("anything else declares nothing", () => {
    for (const text of [
      "not json at all",
      "[]",
      '"a string"',
      "null",
      JSON.stringify({ kind: "graph", data: {} }),
      JSON.stringify({ schema: 3 }),
      JSON.stringify({ schema: "urn:something-else:1" }),
    ]) {
      assert.equal(declaredStructuredExchangeSchema(text), undefined, `"${text.slice(0, 30)}" declared something`);
    }
  });
});

describe("the verdict on a file's content", () => {
  test("a conforming document comes back validated", () => {
    const verdict = read(JSON.stringify(graph));
    assert.equal(verdict.status, "valid");
    if (verdict.status !== "valid") return;
    assert.equal(verdict.envelope.kind, "graph");
  });

  test("recognition is by the declaration, not by anything around it", () => {
    // The same content minus the one field is simply not ours, and gets no
    // diagram — whatever it is called and however diagram-shaped it looks.
    const { schema: _schema, ...undeclared } = graph;
    assert.equal(read(JSON.stringify(undeclared)).status, "not-a-document");
  });

  test("unparseable text is not one of ours rather than an invalid one", () => {
    assert.equal(read("{ this is not json").status, "not-a-document");
  });

  test("a version we do not implement is named and never validated", () => {
    const verdict = read(JSON.stringify({ schema: "urn:structured-exchange:3", kind: "constellation" }));
    assert.equal(verdict.status, "unsupported-version");
    if (verdict.status !== "unsupported-version") return;
    assert.equal(verdict.schema, "urn:structured-exchange:3");
  });

  test("a document that declares a supported version and fails it says what failed", () => {
    const verdict = read(JSON.stringify({ schema: STRUCTURED_EXCHANGE_SCHEMA_V1, kind: "graph", data: { nodes: [{}], edges: [] } }));
    assert.equal(verdict.status, "invalid");
    if (verdict.status !== "invalid") return;
    assert.ok(verdict.issues.length > 0, "refused with no reason given");
    for (const issue of verdict.issues) assert.ok(issue.message.length > 0, `issue ${issue.rule} says nothing`);
  });

  test("semantic failures the schema cannot express are reported too", () => {
    // An edge whose endpoint names no element: shape-valid, and not a graph.
    const verdict = read(
      JSON.stringify({
        schema: STRUCTURED_EXCHANGE_SCHEMA_V1,
        kind: "graph",
        data: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "ghost" }] },
      }),
    );
    assert.equal(verdict.status, "invalid");
  });

  test("past the byte bound is a size problem, decided before anything parses it", () => {
    // Deliberately valid: were it parsed, it would come back as a good document.
    // It is refused on size alone, and the verdict must not call it invalid.
    const verdict = readStructuredExchangeDocument(JSON.stringify(graph), checkStructuredExchangeSchema, { bytes: 10 });
    assert.equal(verdict.status, "too-large");
    if (verdict.status !== "too-large") return;
    assert.equal(verdict.issue.rule, "document-too-large");
  });
});
