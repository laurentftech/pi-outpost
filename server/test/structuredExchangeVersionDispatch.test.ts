/**
 * Which contract judges a document, and what happens when none of them can.
 *
 * The version is read from the document's own declaration and from nothing else.
 * Inferring it from the content would be the tempting shortcut — a document
 * carrying `relations` is obviously version 2 — and it would mean a producer's
 * envelope being accepted under a contract they never claimed, with fields they
 * believed were refused silently passing.
 *
 * The other half is what the two checks that exist must never do: disagree. The
 * browser decides whether to render, Node decides whether to accept, and a
 * document rendered after being refused is the failure this pair prevents.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { checkStructuredExchangeSchemaInBrowser } from "@pi-outpost/shared/structured-exchange/schema-browser";

const v1Graph = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  data: { nodes: [{ id: "a", label: "A" }], edges: [] },
};

/** A version 2 table of the shape this change exists for: typed rows, chapters, traceability. */
const v2Requirements = {
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  data: {
    columns: ["id", "requirement"],
    rows: [
      { heading: "1. Braking", depth: 1 },
      { id: "r1", ref: "REQ-1", kind: "requirement", cells: ["REQ-1", "Stop within 40 m"] },
      { id: "r2", ref: "REQ-2", kind: "requirement", cells: ["REQ-2", "Read wheel speed at 100 Hz"] },
    ],
    relations: [{ from: { id: "r1" }, to: { id: "r2" }, kind: "derives" }],
  },
};

const rules = (document: unknown) => checkStructuredExchangeSchema(document).map((issue) => issue.rule);

describe("validation is selected by the declared version", () => {
  test("a version 1 document is still judged by version 1", () => {
    assert.deepEqual(checkStructuredExchangeSchema(v1Graph), []);
  });

  test("a version 2 document is judged by version 2", () => {
    assert.deepEqual(checkStructuredExchangeSchema(v2Requirements), []);
    const verdict = parseStructuredExchange(v2Requirements, checkStructuredExchangeSchema);
    assert.equal(verdict.valid, true);
  });

  test("version 1 does not inherit version 2's vocabulary", () => {
    // The point of publishing a second version rather than loosening the first:
    // enrichment under a version 1 identifier must stay refused, or the published
    // contract would have changed meaning under producers who wrote against it.
    const smuggled = { ...v2Requirements, schema: "urn:structured-exchange:1" };
    assert.ok(rules(smuggled).length > 0, "version 1 accepted a version 2 document");
  });

  test("the version is read from the declaration, never inferred from the shape", () => {
    const { profile: _profile, ...withoutProfile } = v2Requirements;
    const plain = { ...withoutProfile, schema: "urn:structured-exchange:2", kind: "graph" as const,
      data: { nodes: [{ id: "a", label: "A" }], edges: [] } };
    // Nothing in this document needs version 2, and it is still judged by version 2
    // because that is what it declares.
    assert.deepEqual(checkStructuredExchangeSchema(plain), []);
  });

  test("a version this build does not have is refused by name", () => {
    const future = { ...v1Graph, schema: "urn:structured-exchange:3" };
    const issues = checkStructuredExchangeSchema(future);
    assert.deepEqual(issues.map((issue) => issue.rule), ["unsupported-version"]);
    assert.match(issues[0].message, /urn:structured-exchange:1 and urn:structured-exchange:2/);
    assert.equal(issues[0].path, "/schema");
  });

  test("something that is not a structured exchange is refused as it always was", () => {
    // Not "a version we lack": there is no version here at all, and answering as
    // though there were would send a producer looking for a schema they never named.
    for (const document of [{ nonsense: true }, { schema: "urn:something-else:1" }, { schema: 7 }]) {
      const refusals = rules(document);
      assert.ok(refusals.length > 0, `accepted ${JSON.stringify(document)}`);
      assert.ok(
        !refusals.includes("unsupported-version"),
        `${JSON.stringify(document)} was reported as an unsupported version`,
      );
    }
  });
});

describe("the browser reaches the same verdict as Node", () => {
  const cases: [string, unknown][] = [
    ["a version 1 graph", v1Graph],
    ["a version 2 requirements table", v2Requirements],
    ["version 2 fields under a version 1 identifier", { ...v2Requirements, schema: "urn:structured-exchange:1" }],
    ["a version this build does not have", { ...v1Graph, schema: "urn:structured-exchange:3" }],
    ["not a structured exchange at all", { nonsense: true }],
    ["a heading row, which only version 2 has", {
      schema: "urn:structured-exchange:2", kind: "table",
      data: { columns: ["a"], rows: [{ heading: "Chapter" }] },
    }],
  ];

  for (const [name, document] of cases) {
    test(name, () => {
      const node = checkStructuredExchangeSchema(document).length > 0;
      const browser = checkStructuredExchangeSchemaInBrowser(document).length > 0;
      assert.equal(browser, node, node ? "Node refused it and the browser did not" : "the browser refused what Node accepted");
    });
  }
});
