/**
 * The two levels of bound.
 *
 * What these check is not that big documents are refused — the schema does that —
 * but that a refusal is *actionable*: which limit applied, what the document
 * measured, and whether the number came from the published contract or from this
 * installation's own configuration. An operator who cannot tell those apart does
 * not know whether to change their config or the contract.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import {
  STRUCTURED_EXCHANGE_BYTES_CEILING_ANY,
  effectiveLimit,
} from "@pi-outpost/shared/structured-exchange/bounds";
import { STRUCTURED_EXCHANGE_CEILINGS, STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";

const graphOf = (count: number) => ({
  schema: S,
  kind: "graph",
  data: {
    nodes: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `N${i}` })),
    edges: [],
  },
});

const parse = (document: unknown, limits?: Parameters<typeof parseSerializedStructuredExchange>[2]) =>
  parseSerializedStructuredExchange(JSON.stringify(document), checkStructuredExchangeSchema, limits);

describe("structured-exchange bounds", () => {
  describe("the ceiling is the contract's outer edge", () => {
    test("a deployment cannot raise a limit above it", () => {
      assert.deepEqual(effectiveLimit("nodes", { nodes: 100_000 }), {
        limit: STRUCTURED_EXCHANGE_CEILINGS.nodes,
        level: "ceiling",
      });
      // The byte ceiling the gate before the parse can apply is the widest any
      // supported version allows — it has not read the document, so it does not yet
      // know which version's promise to hold it to. Each version's own ceiling is
      // applied once it has said; see structuredExchangeV2Bounds.test.ts.
      assert.deepEqual(effectiveLimit("bytes", { bytes: Number.MAX_SAFE_INTEGER }), {
        limit: STRUCTURED_EXCHANGE_BYTES_CEILING_ANY,
        level: "ceiling",
      });
    });

    test("a deployment can lower one", () => {
      assert.deepEqual(effectiveLimit("nodes", { nodes: 10 }), { limit: 10, level: "deployment" });
    });

    test("no configuration means the ceiling", () => {
      assert.deepEqual(effectiveLimit("nodes", undefined), {
        limit: STRUCTURED_EXCHANGE_CEILINGS.nodes,
        level: "ceiling",
      });
    });
  });

  describe("the byte bound runs before parsing", () => {
    test("an oversized document is refused without being parsed", () => {
      // Deliberately not valid JSON past the opening brace: if this were parsed,
      // the refusal would be "not-json" rather than the size.
      const oversized = `{"schema":"${S}","junk":"${"x".repeat(STRUCTURED_EXCHANGE_BYTES_CEILING_ANY)}`;

      const verdict = parseSerializedStructuredExchange(oversized, checkStructuredExchangeSchema);

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      assert.deepEqual(verdict.issues.map((issue) => issue.rule), ["document-too-large"]);
    });

    test("a deployment's byte limit refuses a document the contract would accept", () => {
      const verdict = parse(graphOf(3), { bytes: 50 });

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      const [issue] = verdict.issues;
      assert.equal(issue.rule, "document-too-large");
      assert.equal(issue.level, "deployment");
      assert.equal(issue.limit, 50);
      assert.ok(issue.observed !== undefined && issue.observed > 50);
    });
  });

  describe("collection limits", () => {
    test("past the deployment's limit but within the ceiling is refused, and says so", () => {
      const verdict = parse(graphOf(12), { nodes: 10 });

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      const [issue] = verdict.issues;
      assert.equal(issue.rule, "collection-past-deployment-limit");
      assert.equal(issue.path, "/data/nodes");
      assert.equal(issue.limit, 10);
      assert.equal(issue.observed, 12);
      assert.equal(issue.level, "deployment");
    });

    test("past the ceiling is refused by the contract, and attributed to it", () => {
      const verdict = parse(graphOf(STRUCTURED_EXCHANGE_CEILINGS.nodes + 1));

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      const issue = verdict.issues.find((candidate) => candidate.limit !== undefined);
      assert.ok(issue, "expected a bound diagnostic");
      assert.equal(issue.limit, STRUCTURED_EXCHANGE_CEILINGS.nodes);
      assert.equal(issue.level, "ceiling");
    });

    test("nothing is truncated on refusal", () => {
      const verdict = parse(graphOf(12), { nodes: 10 });
      assert.equal(verdict.valid, false);
      // A refusal yields no envelope at all — there is nothing to have truncated
      assert.ok(!("envelope" in verdict));
    });
  });

  describe("accepted documents are measured", () => {
    test("acceptance reports what the document weighed", () => {
      const verdict = parse(graphOf(4));

      assert.equal(verdict.valid, true);
      if (!verdict.valid) return;
      assert.equal(verdict.measurement.kind, "graph");
      assert.equal(verdict.measurement.counts.nodes, 4);
      assert.equal(verdict.measurement.counts.edges, 0);
      assert.ok(verdict.measurement.bytes > 0);
    });

    test("a document within a deployment's limit is still accepted and measured", () => {
      const verdict = parse(graphOf(4), { nodes: 10 });

      assert.equal(verdict.valid, true);
      if (!verdict.valid) return;
      assert.equal(verdict.measurement.counts.nodes, 4);
    });
  });

  describe("malformed input", () => {
    test("unparseable JSON is refused without a recovery pass", () => {
      const verdict = parseSerializedStructuredExchange(`{"schema":"${S}","kind":"graph"`, checkStructuredExchangeSchema);

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      assert.deepEqual(verdict.issues.map((issue) => issue.rule), ["not-json"]);
    });
  });
});
