/**
 * What a refusal tells the producer who has to act on it.
 *
 * A contract that refuses accurately and explains badly is a contract people work
 * around. `data` is a union of three variants, so when a table is wrong every
 * branch complains, and the loudest answer used to be the graph's: a table whose
 * cell ran one character past its ceiling was told it "must have required
 * properties nodes, edges" — a sentence about a diagram nobody sent, with the real
 * fault seven lines further down.
 *
 * The fix is to narrow the *explanation* while the published schema keeps deciding
 * the verdict. Deciding with the narrowed one moved answers that were already
 * published — a document whose kind disagrees with its data was refused by the
 * semantic rule named for exactly that, and narrowed it would have been refused
 * earlier, by a different name. Nothing is dropped either: a complaint a producer
 * keys on stays in the list, ordered behind the ones that name the real value.
 *
 * That acceptance did not move is asserted here against the whole corpus rather
 * than argued.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import {
  STRUCTURED_EXCHANGE_CEILINGS,
  STRUCTURED_EXCHANGE_CEILINGS_2,
  STRUCTURED_EXCHANGE_SCHEMA_V2 as V2,
} from "@pi-outpost/shared/structured-exchange";

const SUITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../shared/conformance");
const index = JSON.parse(readFileSync(path.join(SUITE, "index.json"), "utf8")) as {
  valid: { file: string }[];
  invalid: { file: string; expectedRule: string }[];
};

const table = (data: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  schema: V2,
  kind: "table",
  ...over,
  data: { columns: ["id"], ...data },
});

/** The line a producer reads first. */
const leading = (document: unknown) => {
  const [issue] = checkStructuredExchangeSchema(document);
  assert.ok(issue !== undefined, "expected this document to be refused");
  return issue;
};

describe("a refusal names the value that caused it", () => {
  test("a cell past its ceiling, with the limit and what was observed", () => {
    const issue = leading(table({ rows: [["x".repeat(STRUCTURED_EXCHANGE_CEILINGS.cell + 1)]] }));
    assert.equal(issue.path, "/data/rows/0/0");
    assert.equal(issue.rule, "schema/maxLength");
    assert.equal(issue.limit, STRUCTURED_EXCHANGE_CEILINGS.cell);
    assert.equal(issue.observed, STRUCTURED_EXCHANGE_CEILINGS.cell + 1);
    assert.equal(issue.level, "ceiling");
  });

  test("an attribute value that is not one the contract carries", () => {
    const issue = leading(table({ rows: [{ id: "r", cells: ["x"], attributes: { owner: { name: "n" } } }] }));
    assert.equal(issue.path, "/data/rows/0/attributes");
  });

  test("a heading nested deeper than headings go", () => {
    const issue = leading(table({ rows: [{ heading: "h", depth: STRUCTURED_EXCHANGE_CEILINGS_2.headingDepth + 1 }] }));
    assert.equal(issue.path, "/data/rows/0/depth");
    assert.equal(issue.limit, STRUCTURED_EXCHANGE_CEILINGS_2.headingDepth);
  });

  test("a digest that is not the one the contract binds to", () => {
    const issue = leading(table({ rows: [["x"]] }, { artifacts: [{ rel: "r", uri: "u", sha256: "md5:1" }] }));
    assert.equal(issue.path, "/artifacts/0/sha256");
    assert.equal(issue.rule, "schema/pattern");
  });

  test("a position past the end of any file a reader will open", () => {
    const issue = leading(
      table({
        rows: [{ cells: ["x"], locations: [{ uri: "u", range: { startLine: 0, endLine: STRUCTURED_EXCHANGE_CEILINGS_2.position + 1 } }] }],
      }),
    );
    assert.equal(issue.path, "/data/rows/0/locations/0/range/endLine");
    assert.equal(issue.limit, STRUCTURED_EXCHANGE_CEILINGS_2.position);
  });

  test("an endpoint that names neither a row nor a reference", () => {
    const issue = leading(table({ rows: [["x"]], relations: [{ from: {}, to: { ref: "T" }, kind: "k" }] }));
    assert.match(issue.path, /^\/data\/relations\/0\/from/);
  });

  test("the variants the document is not are never what it is told first", () => {
    // The regression this exists for: a table answered with the graph's objection.
    // Those complaints are still in the list — a rule a producer keys on cannot be
    // dropped for being unhelpfully phrased — but they are last, not first.
    const issues = checkStructuredExchangeSchema(table({ rows: [["x".repeat(STRUCTURED_EXCHANGE_CEILINGS.cell + 1)]] }));
    const strayed = issues.findIndex((issue) => /nodes|edges|participants|messages/.test(issue.message));
    assert.equal(issues[0].path, "/data/rows/0/0", "the first line was not about the value that is wrong");
    assert.ok(strayed === -1 || strayed > 0, "a table was told about graphs before its own fault");
  });

  test("a document whose kind is not one of ours is still judged, and refused", () => {
    // Narrowing needs a kind it recognises; without one the published schema is
    // used as it stands, which is what refuses the kind in the first place.
    const issues = checkStructuredExchangeSchema({ schema: V2, kind: "constellation", data: { columns: ["a"], rows: [] } });
    assert.ok(issues.length > 0);
    assert.ok(issues.some((issue) => issue.path === "/kind"), `nothing pointed at the kind: ${issues.map((i) => i.path).join(", ")}`);
  });
});

describe("narrowing changed what is said, not what is accepted", () => {
  for (const { file } of index.valid) {
    test(`${file} is still accepted`, () => {
      const document = JSON.parse(readFileSync(path.join(SUITE, file), "utf8"));
      assert.deepEqual(checkStructuredExchangeSchema(document), []);
    });
  }

  for (const { file, expectedRule } of index.invalid) {
    test(`${file} is still refused`, () => {
      const document = JSON.parse(readFileSync(path.join(SUITE, file), "utf8"));
      const issues = checkStructuredExchangeSchema(document);
      // Semantic rules are refused after the schema, so those cases pass this gate.
      if (!expectedRule.startsWith("schema/") && expectedRule !== "unsupported-version") return;
      assert.ok(issues.length > 0, `${file} was accepted by the schema`);
    });
  }
});
