/**
 * What the enriched contract must still refuse to take in.
 *
 * Three ways a bound can be there and not hold. A byte gate that cannot know which
 * version it is guarding either lets a version 1 document past its own published
 * ceiling or refuses a version 2 document the schema calls legal. A collection the
 * deployment limits do not know about is unbounded in practice however carefully
 * the schema bounds it. And a number that arrives as Infinity passes every
 * `type: "number"` keyword, then comes back out of `JSON.stringify` as `null` —
 * a document that says something its producer never sent.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseSerializedStructuredExchange, parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import {
  bytesCeilingFor,
  ceilingFor,
  effectiveLimit,
  STRUCTURED_EXCHANGE_BYTES_CEILING,
  STRUCTURED_EXCHANGE_BYTES_CEILING_ANY,
} from "@pi-outpost/shared/structured-exchange/bounds";
import {
  STRUCTURED_EXCHANGE_BYTES_CEILING_2,
  STRUCTURED_EXCHANGE_CEILINGS,
  STRUCTURED_EXCHANGE_CEILINGS_2,
  STRUCTURED_EXCHANGE_SCHEMA_V1,
  STRUCTURED_EXCHANGE_SCHEMA_V2,
} from "@pi-outpost/shared/structured-exchange";

/**
 * A table of the declared version, padded so its serialized form passes `bytes`.
 *
 * Padded across many rows rather than into one enormous cell, because a cell is
 * bounded at a thousand characters: a single oversized one is refused by the
 * schema, and the byte rule under test here would never be reached. Every value
 * stays inside its own ceiling, so the only thing large about the document is the
 * document.
 */
function tableOf(version: string, bytes: number) {
  const document: Record<string, unknown> = {
    schema: version,
    kind: "table",
    data: { columns: ["a"], rows: [] as unknown[] },
  };
  const cell = "x".repeat(STRUCTURED_EXCHANGE_CEILINGS_2.attributeString);
  const perRow = JSON.stringify([cell]).length + 1;
  const rows = Math.max(1, Math.ceil((bytes - JSON.stringify(document).length) / perRow));
  (document.data as { rows: unknown[] }).rows = Array.from({ length: rows }, () => [cell]);
  return document;
}

/**
 * A document too large to parse, padded however is cheapest: nothing reads past
 * the pre-parse gate, so no bound inside the document applies.
 */
function oversized(version: string, bytes: number) {
  return { schema: version, kind: "table", data: { columns: ["a"], rows: [["x".repeat(bytes)]] } };
}

const parse = (document: unknown, limits?: Parameters<typeof parseSerializedStructuredExchange>[2]) =>
  parseSerializedStructuredExchange(JSON.stringify(document), checkStructuredExchangeSchema, limits);

describe("the byte ceiling follows the version the document declares", () => {
  test("the gate before the parse is the widest any version allows", () => {
    assert.equal(STRUCTURED_EXCHANGE_BYTES_CEILING_ANY, STRUCTURED_EXCHANGE_BYTES_CEILING_2);
    assert.equal(ceilingFor("bytes"), STRUCTURED_EXCHANGE_BYTES_CEILING_ANY);
  });

  test("each version's own ceiling is the one it promised its producers", () => {
    assert.equal(bytesCeilingFor(STRUCTURED_EXCHANGE_SCHEMA_V1), STRUCTURED_EXCHANGE_BYTES_CEILING);
    assert.equal(bytesCeilingFor(STRUCTURED_EXCHANGE_SCHEMA_V2), STRUCTURED_EXCHANGE_BYTES_CEILING_2);
    assert.equal(bytesCeilingFor(undefined), STRUCTURED_EXCHANGE_BYTES_CEILING);
  });

  test("a version 1 document past four megabytes is still refused", () => {
    // The widest ceiling let it through the pre-parse gate; its own version takes
    // it from there. Raising the outer edge for version 2 must not raise version 1's.
    const verdict = parse(tableOf(STRUCTURED_EXCHANGE_SCHEMA_V1, STRUCTURED_EXCHANGE_BYTES_CEILING + 5_000));
    assert.equal(verdict.valid, false);
    if (verdict.valid) return;
    assert.equal(verdict.issues[0].rule, "document-too-large");
    assert.equal(verdict.issues[0].limit, STRUCTURED_EXCHANGE_BYTES_CEILING);
  });

  test("the same document is accepted when it declares version 2", () => {
    const verdict = parse(tableOf(STRUCTURED_EXCHANGE_SCHEMA_V2, STRUCTURED_EXCHANGE_BYTES_CEILING + 5_000));
    assert.equal(verdict.valid, true, verdict.valid ? "" : JSON.stringify(verdict.issues));
  });

  test("no version reaches past the outer edge", () => {
    // Padded into one enormous cell on purpose: nothing inside the document is read,
    // so a refusal naming the cell's length instead of the document's size would
    // mean the gate had not run before the parse.
    const verdict = parse(oversized(STRUCTURED_EXCHANGE_SCHEMA_V2, STRUCTURED_EXCHANGE_BYTES_CEILING_2 + 5_000));
    assert.equal(verdict.valid, false);
    if (verdict.valid) return;
    assert.equal(verdict.issues[0].rule, "document-too-large");
    assert.equal(verdict.issues[0].limit, STRUCTURED_EXCHANGE_BYTES_CEILING_2);
  });

  test("a deployment limit is stricter than either and says so", () => {
    const verdict = parse(tableOf(STRUCTURED_EXCHANGE_SCHEMA_V2, 60_000), { bytes: 50_000 });
    assert.equal(verdict.valid, false);
    if (verdict.valid) return;
    assert.equal(verdict.issues[0].level, "deployment");
    assert.equal(verdict.issues[0].limit, 50_000);
  });
});

describe("relations are a bounded collection like any other", () => {
  const relationsTable = (count: number) => ({
    schema: STRUCTURED_EXCHANGE_SCHEMA_V2,
    kind: "table",
    data: {
      columns: ["id"],
      rows: [{ id: "r1", cells: ["REQ-1"] }],
      relations: Array.from({ length: count }, () => ({ from: { id: "r1" }, to: { ref: "X" }, kind: "derives" })),
    },
  });

  test("the ceiling is the one the schema declares", () => {
    assert.equal(ceilingFor("relations"), STRUCTURED_EXCHANGE_CEILINGS_2.relations);
    assert.deepEqual(effectiveLimit("relations", undefined), {
      limit: STRUCTURED_EXCHANGE_CEILINGS_2.relations,
      level: "ceiling",
    });
  });

  test("a deployment can hold them below it, and the refusal says whose number that is", () => {
    const verdict = parse(relationsTable(5), { relations: 2 });
    assert.equal(verdict.valid, false);
    if (verdict.valid) return;
    const issue = verdict.issues[0];
    assert.equal(issue.rule, "collection-past-deployment-limit");
    assert.equal(issue.path, "/data/relations");
    assert.equal(issue.level, "deployment");
    assert.equal(issue.observed, 5);
  });

  test("under the limit it passes", () => {
    assert.equal(parse(relationsTable(2), { relations: 2 }).valid, true);
  });
});

describe("values the contract cannot carry are refused by the schema itself", () => {
  // Checked here rather than added as a second rule beside the schema. TypeBox
  // already refuses a non-finite number, a nested list, and an object that is not a
  // reference — so a semantic rule repeating those would be a second enforcement
  // point that can drift from the first, which is the thing this contract is most
  // careful to avoid. What it costs is the diagnostic: the refusal names the row
  // rather than the value, and sharpening that is its own task.
  const withAttributes = (attributes: unknown) => ({
    schema: STRUCTURED_EXCHANGE_SCHEMA_V2,
    kind: "table",
    data: { columns: ["a"], rows: [{ id: "r1", cells: ["x"], attributes }] },
  });
  const refused = (document: unknown) => checkStructuredExchangeSchema(document).length > 0;

  test("a number literal too large to represent, which JSON is happy to carry", () => {
    // 1e400 is valid JSON and arrives as Infinity. Accepted, it would be written
    // back out by JSON.stringify as `null` — the document handed to an authority
    // would differ from the one that was approved.
    const document = JSON.parse(
      `{"schema":"${STRUCTURED_EXCHANGE_SCHEMA_V2}","kind":"table","data":{"columns":["a"],"rows":[{"id":"r1","cells":["x"],"attributes":{"mass":1e400}}]}}`,
    );
    assert.equal(Number.isFinite(document.data.rows[0].attributes.mass), false, "the premise of this test is gone");
    assert.ok(refused(document), "a non-finite attribute was accepted");
  });

  test("the same, in a table cell", () => {
    const document = JSON.parse(
      `{"schema":"${STRUCTURED_EXCHANGE_SCHEMA_V2}","kind":"table","data":{"columns":["a"],"rows":[[1e400]]}}`,
    );
    assert.ok(refused(document), "a non-finite cell was accepted");
  });

  test("a list inside a list", () => {
    assert.ok(refused(withAttributes({ samples: [[1, 2]] })), "a nested list was accepted");
  });

  test("an object value that is not a reference", () => {
    assert.ok(refused(withAttributes({ owner: { name: "someone" } })), "an arbitrary object was accepted");
  });

  test("a reference is the one object shape allowed, and ordinary values pass", () => {
    assert.equal(refused(withAttributes({ owner: { ref: "EL-7" } })), false);
    assert.equal(
      refused(withAttributes({ mass: 12.5, verified: true, note: "ok", nothing: null, refs: [{ ref: "A" }, "b", 3] })),
      false,
    );
  });
});
