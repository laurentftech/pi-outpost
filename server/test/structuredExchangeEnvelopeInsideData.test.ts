/**
 * An envelope nested in `data`: the refusal leads with where `schema` and `kind` belong.
 *
 * Without a top-level `schema` the document is judged as version 1, and without a
 * top-level `kind` every form `data` can take says why it is not that form — eight
 * true reasons about graphs, sequences and tables, none of them the fix. The added
 * diagnostic names the fix and changes nothing else: every reason given before is
 * still given, and no verdict moves.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { misplacedEnvelopeIssues } from "@pi-outpost/shared/structured-exchange/document";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";

const CONFORMANCE = fileURLToPath(new URL("../../shared/conformance/", import.meta.url));
const parse = (document: unknown) => parseStructuredExchange(document, checkStructuredExchangeSchema);

function refused(document: unknown) {
  const verdict = parse(document);
  assert.equal(verdict.valid, false, "expected the document to be refused");
  return verdict.valid ? [] : verdict.issues;
}

const timeline = {
  schema: "urn:structured-exchange:3",
  kind: "timeline",
  data: {
    title: "Drone",
    time: { start: "2028-04-01", end: "2028-06-05", scale: "week" },
    rows: [{ type: "task", id: "R1", label: "Sim", items: [{ type: "activity", id: "sim", start: "2028-04-03", end: "2028-04-21" }] }],
  },
};
const graph = { schema: "urn:structured-exchange:1", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } };

/** The same document with `fields` moved from beside `data` to inside it. */
function nested(document: { data: object } & Record<string, unknown>, fields: string[]) {
  const outside = Object.fromEntries(Object.entries(document).filter(([key]) => key !== "data" && !fields.includes(key)));
  const inside = Object.fromEntries(fields.map((field) => [field, document[field]]));
  return { ...outside, data: { ...document.data, ...inside } };
}

// openlore: scenario=AMisplacedEnvelopeLeadsTheRefusal spec=structured-exchange
describe("AMisplacedEnvelopeLeadsTheRefusal", () => {
  for (const [name, document] of [["a timeline", timeline], ["a graph", graph]] as const) {
    test(`${name} with schema and kind inside data: both named first, at their paths`, () => {
      const issues = refused(nested(document, ["schema", "kind"]));
      assert.deepEqual(issues.slice(0, 2), [
        { rule: "envelope-inside-data", path: "/data/schema", message: '"schema" belongs beside "data", at the top of the document, not inside it' },
        { rule: "envelope-inside-data", path: "/data/kind", message: '"kind" belongs beside "data", at the top of the document, not inside it' },
      ]);
      assert.equal(issues.filter((issue) => issue.rule === "envelope-inside-data").length, 2, "named once each");
    });
  }

  test("only kind inside data, schema in place: kind alone is named, first", () => {
    const issues = refused(nested(timeline, ["kind"]));
    assert.deepEqual(issues[0], { rule: "envelope-inside-data", path: "/data/kind", message: '"kind" belongs beside "data", at the top of the document, not inside it' });
    assert.equal(issues.filter((issue) => issue.rule === "envelope-inside-data").length, 1);
  });

  test("every reason the schema gave before is still given, after it", () => {
    const issues = refused(nested(timeline, ["schema", "kind"]));
    const rest = issues.slice(2);
    // The published refusal of the top level, and the forms `data` is not — still there.
    assert.ok(rest.some((issue) => issue.rule === "schema/required" && issue.path === "" && /schema, kind/.test(issue.message)), JSON.stringify(rest));
    assert.ok(rest.some((issue) => /nodes, edges/.test(issue.message)), JSON.stringify(rest));
    assert.ok(rest.every((issue) => issue.rule !== "envelope-inside-data"));
  });
});

// openlore: scenario=AFieldInBothPlacesIsNotMisplaced spec=structured-exchange
test("AFieldInBothPlacesIsNotMisplaced: the copy inside data is refused as undefined there, and nothing else", () => {
  const document = { ...timeline, data: { ...timeline.data, kind: "timeline" } };
  assert.deepEqual(misplacedEnvelopeIssues(document), []);
  const issues = refused(document);
  assert.ok(issues.every((issue) => issue.rule !== "envelope-inside-data"));
  assert.deepEqual(issues, [{ rule: "schema/additionalProperties", path: "/data/kind", message: '"kind" is not defined here' }]);
});

// openlore: scenario=NoVerdictMoves spec=structured-exchange
test("NoVerdictMoves: every conformance case keeps its verdict, and no valid one is named misplaced", async () => {
  const index = JSON.parse(await fs.readFile(path.join(CONFORMANCE, "index.json"), "utf8")) as {
    valid: Array<string | { file: string }>;
    invalid: Array<{ file: string }>;
  };
  const file = (entry: string | { file: string }) => (typeof entry === "string" ? entry : entry.file);
  assert.ok(index.valid.length > 0 && index.invalid.length > 0);
  for (const entry of index.valid) {
    const document = JSON.parse(await fs.readFile(path.join(CONFORMANCE, file(entry)), "utf8"));
    assert.equal(parse(document).valid, true, file(entry));
    assert.deepEqual(misplacedEnvelopeIssues(document), [], file(entry));
  }
  for (const entry of index.invalid) {
    const document = JSON.parse(await fs.readFile(path.join(CONFORMANCE, file(entry)), "utf8"));
    assert.equal(parse(document).valid, false, file(entry));
  }
  // Something that is not an envelope at all is left to the schema.
  for (const odd of [null, [], "text", 3, { data: [] }, { data: null }, { kind: "graph" }]) assert.deepEqual(misplacedEnvelopeIssues(odd), []);
});
