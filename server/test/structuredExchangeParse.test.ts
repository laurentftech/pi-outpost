/**
 * Two-stage validation, end to end.
 *
 * The rule under test throughout is that neither stage repairs, completes, or
 * guesses. Most of what follows is therefore a document that is *nearly* right,
 * checked to make sure "nearly" produces nothing at all — a half-understood
 * proposal is worse than a refused one, because a reader might approve it.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";

const parse = (document: unknown) => parseStructuredExchange(document, checkStructuredExchangeSchema);

/** The rules a refusal cited, for asserting on the reason rather than just failure. */
function rules(document: unknown): string[] {
  const verdict = parse(document);
  assert.equal(verdict.valid, false, "expected the document to be refused");
  return verdict.issues.map((issue) => issue.rule);
}

const node = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), ...over });
const graph = (over: Record<string, unknown> = {}) => ({
  schema: S,
  kind: "graph" as const,
  data: { nodes: [node("a"), node("b")], edges: [{ from: "a", to: "b", kind: "composition" }] },
  ...over,
});

describe("structured-exchange two-stage validation", () => {
  test("accepts a complete document and returns it whole", () => {
    const verdict = parse(graph());

    assert.equal(verdict.valid, true);
    if (!verdict.valid) return;
    assert.equal(verdict.envelope.kind, "graph");
    assert.equal(verdict.issues.length, 0);
  });

  // -------------------------------------------------------------------------
  // 1.3 — no repair, no completion, no guessing
  // -------------------------------------------------------------------------
  describe("never repairs or guesses", () => {
    test("refuses an unsupported schema version rather than assuming version 1", () => {
      assert.ok(rules(graph({ schema: "urn:structured-exchange:3" })).length > 0);
    });

    test("refuses arbitrary JSON that merely resembles an envelope", () => {
      assert.ok(rules({ kind: "graph", data: { nodes: [], edges: [] } }).length > 0);
      assert.ok(rules({ nodes: [], edges: [] }).length > 0);
      assert.ok(rules("a string").length > 0);
      assert.ok(rules(null).length > 0);
    });

    test("refuses a truncated document rather than salvaging the part that parsed", () => {
      assert.ok(rules({ schema: S, kind: "graph" }).length > 0);
      assert.ok(rules({ schema: S, kind: "graph", data: { nodes: [node("a")] } }).length > 0);
    });

    test("refuses an endpoint that is nearly a declared identifier", () => {
      // "aa" is one character from "a"; correcting it is exactly the guess that is forbidden
      const verdict = parse(graph({ data: { nodes: [node("a")], edges: [{ from: "a", to: "aa", kind: "k" }] } }));

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      assert.deepEqual(verdict.issues.map((issue) => issue.rule), ["unresolved-endpoint"]);
      assert.match(verdict.issues[0].path, /^\/data\/edges\/0\/to$/);
    });

    test("refuses a kind that disagrees with the data it carries", () => {
      assert.deepEqual(rules({ schema: S, kind: "sequence", data: { nodes: [node("a")], edges: [] } }), ["kind-data-mismatch"]);
    });
  });

  // -------------------------------------------------------------------------
  // 1.4 — what makes a document a patch
  // -------------------------------------------------------------------------
  describe("patch or new artifact", () => {
    test("a target makes it a patch", () => {
      const verdict = parse(graph({ target: "artifact-1" }));
      assert.equal(verdict.valid, true);
      if (!verdict.valid) return;
      assert.equal(verdict.envelope.target, "artifact-1");
    });

    test("no target makes it a complete new artifact", () => {
      const verdict = parse(graph());
      assert.equal(verdict.valid, true);
      if (!verdict.valid) return;
      assert.equal(verdict.envelope.target, undefined);
    });

    test("an addition-only proposal is still a patch, though it carries no reference", () => {
      // The most ordinary proposal there is. Inferring the mode from whether
      // references appear would read this as "start over".
      const verdict = parse(graph({ target: "artifact-1" }));

      assert.equal(verdict.valid, true);
      if (!verdict.valid) return;
      assert.equal(verdict.envelope.target, "artifact-1");
      assert.ok(verdict.envelope.data.nodes.every((element) => element.ref === undefined));
    });

    test("a removal without a target is refused", () => {
      assert.deepEqual(rules(graph({ removals: [{ type: "element", ref: "R" }] })), ["removal-without-target"]);
    });
  });

  // -------------------------------------------------------------------------
  // 1.5 — field-level patch rules
  // -------------------------------------------------------------------------
  describe("field-level patch", () => {
    test("a referenced element states a change in set, and its own fields describe", () => {
      const node = { id: "a", ref: "R", label: "Ledger", set: { label: "General Ledger" } };
      const verdict = parse(graph({ target: "T", data: { nodes: [node], edges: [] } }));

      assert.equal(verdict.valid, true);
      if (!verdict.valid) return;
      assert.deepEqual(verdict.envelope.data.nodes[0], node);
    });

    test("a change needs something to change: set without a reference is refused", () => {
      assert.deepEqual(
        rules(graph({ target: "T", data: { nodes: [{ id: "a", label: "A", set: { label: "B" } }], edges: [] } })),
        ["change-without-reference"],
      );
    });

    test("an empty change is refused rather than treated as a no-op", () => {
      assert.ok(rules(graph({ target: "T", data: { nodes: [{ id: "a", ref: "R", set: {} }], edges: [] } })).length > 0);
    });

    test("a referenced element declaring nothing else is context, not a change", () => {
      const verdict = parse(
        graph({
          target: "T",
          data: { nodes: [{ id: "existing", ref: "R" }, node("fresh")], edges: [{ from: "fresh", to: "existing", kind: "k" }] },
        }),
      );

      assert.equal(verdict.valid, true);
      if (!verdict.valid) return;
      // No label declared: nothing about it is being changed
      assert.equal(verdict.envelope.data.nodes[0].label, undefined);
    });

    test("an element with no reference must declare what a new one requires", () => {
      assert.ok(rules(graph({ data: { nodes: [{ id: "a" }], edges: [] } })).length > 0);
    });
  });

  // -------------------------------------------------------------------------
  // 1.6 — removals
  // -------------------------------------------------------------------------
  describe("removals", () => {
    test("name both a reference and what kind of thing they remove", () => {
      const verdict = parse(graph({ target: "T", removals: [{ type: "relationship", ref: "R" }] }));
      assert.equal(verdict.valid, true);

      assert.ok(rules(graph({ target: "T", removals: [{ ref: "R" }] })).length > 0);
    });

    test("a table carries neither a target nor a removal", () => {
      const table = { schema: S, kind: "table" as const, data: { columns: ["c"], rows: [["v"]] } };
      assert.deepEqual(rules({ ...table, target: "T" }), ["kind-not-proposable"]);
      assert.deepEqual(rules({ ...table, removals: [{ type: "element", ref: "R" }] }), ["kind-not-proposable"]);
    });

    test("addressing the same thing twice is refused, not resolved by precedence", () => {
      const verdict = parse(
        graph({
          target: "T",
          removals: [{ type: "element", ref: "R" }],
          data: { nodes: [{ id: "a", ref: "R", set: { label: "renamed" } }], edges: [] },
        }),
      );

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      assert.deepEqual(verdict.issues.map((issue) => issue.rule), ["duplicate-reference"]);
    });

    test("removing a relationship while changing an element of the same reference is fine", () => {
      // The two references live in different collections and mean different things
      const verdict = parse(
        graph({
          target: "T",
          removals: [{ type: "relationship", ref: "R" }],
          data: { nodes: [{ id: "a", ref: "R", set: { label: "renamed" } }], edges: [] },
        }),
      );

      assert.equal(verdict.valid, true);
    });
  });

  // -------------------------------------------------------------------------
  // 1.10 — a relationship's endpoints are identity
  // -------------------------------------------------------------------------
  describe("relationship endpoints are identity", () => {
    test("declared whether or not the relationship carries a reference", () => {
      const nodes = [node("a"), node("b")];
      assert.ok(rules(graph({ target: "T", data: { nodes, edges: [{ ref: "R", set: { label: "renamed" } }] } })).length > 0);

      const verdict = parse(graph({ target: "T", data: { nodes, edges: [{ from: "a", to: "b", ref: "R", set: { label: "renamed" } }] } }));
      assert.equal(verdict.valid, true);
    });

    test("re-attachment is a removal and a creation", () => {
      const verdict = parse(
        graph({
          target: "T",
          removals: [{ type: "relationship", ref: "old-edge" }],
          data: {
            nodes: [node("a"), node("b"), node("c")],
            edges: [{ from: "a", to: "c", kind: "composition" }],
          },
        }),
      );

      assert.equal(verdict.valid, true);
      if (!verdict.valid) return;
      assert.equal(verdict.envelope.removals?.length, 1);
      assert.equal(verdict.envelope.data.edges.length, 1);
    });
  });

  // -------------------------------------------------------------------------
  // Diagnostics carry what an operator needs
  // -------------------------------------------------------------------------
  describe("diagnostics", () => {
    test("a bound refusal reports the limit, the observed value, and which level bit", () => {
      const verdict = parse(graph({ data: { nodes: [node("a", { label: "x".repeat(501) })], edges: [] } }));

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      const issue = verdict.issues.find((candidate) => candidate.limit !== undefined);
      assert.ok(issue, `expected a bound diagnostic, got ${JSON.stringify(verdict.issues)}`);
      assert.equal(issue.limit, 500);
      assert.equal(issue.observed, 501);
      assert.equal(issue.level, "ceiling");
    });

    test("several broken rules are all reported, not just the first", () => {
      const verdict = parse(
        graph({ data: { nodes: [node("a"), node("a")], edges: [{ from: "a", to: "missing", kind: "k" }] } }),
      );

      assert.equal(verdict.valid, false);
      if (verdict.valid) return;
      assert.deepEqual(verdict.issues.map((issue) => issue.rule).sort(), ["duplicate-identifier", "unresolved-endpoint"]);
    });
  });
});

/**
 * Containers group elements. They are declared once and named by their members,
 * which is what makes membership single-valued and a move an ordinary change —
 * and what gives this stage two new things to check.
 */
describe("containers", () => {
  const grouped = (over: Record<string, unknown> = {}) => ({
    schema: S,
    kind: "graph" as const,
    data: {
      containers: [{ id: "electrical", label: "Electrical system" }],
      nodes: [node("a", { container: "electrical" }), node("b")],
      edges: [{ from: "a", to: "b", kind: "composition" }],
      ...over,
    },
  });

  test("accepts a document that groups some of its elements and not others", () => {
    const verdict = parse(grouped());

    assert.equal(verdict.valid, true);
    if (!verdict.valid) return;
    const data = verdict.envelope.data as { containers?: unknown[]; nodes: { container?: string }[] };
    assert.equal(data.containers?.length, 1);
    assert.equal(data.nodes[0].container, "electrical");
    assert.equal(data.nodes[1].container, undefined);
  });

  test("accepts a container no member names", () => {
    const verdict = parse(
      grouped({
        containers: [
          { id: "electrical", label: "Electrical system" },
          { id: "hydraulic", label: "Hydraulic system" },
        ],
      }),
    );

    assert.equal(verdict.valid, true, "a group declared before it is filled is a coherent intention");
  });

  test("refuses a membership naming a container the envelope does not declare", () => {
    // Rendering it ungrouped instead would state something about the system that
    // the document does not.
    assert.deepEqual(rules(grouped({ nodes: [node("a", { container: "hydraulic" })], edges: [] })), [
      "unresolved-container",
    ]);
  });

  test("refuses two containers sharing an identifier", () => {
    assert.deepEqual(
      rules(
        grouped({
          containers: [
            { id: "electrical", label: "Electrical system" },
            { id: "electrical", label: "Electrical system again" },
          ],
        }),
      ),
      ["duplicate-container-identifier"],
    );
  });

  test("refuses a container identifier used as a relationship endpoint", () => {
    // A container is not an element: it groups, and it connects to nothing.
    assert.deepEqual(
      rules(grouped({ edges: [{ from: "a", to: "electrical", kind: "feeds" }] })),
      ["unresolved-endpoint"],
    );
  });

  test("refuses a proposal that moves a member into a container it does not declare", () => {
    assert.deepEqual(
      rules({
        schema: S,
        kind: "graph" as const,
        target: "artifact-1",
        data: {
          containers: [{ id: "electrical", label: "Electrical system" }],
          nodes: [{ id: "a", ref: "EL-1", container: "electrical", set: { container: "hydraulic" } }],
          edges: [],
        },
      }),
      ["unresolved-container"],
    );
  });

  test("yields no structured result at all when a membership is unresolved", () => {
    const verdict = parse(grouped({ nodes: [node("a", { container: "hydraulic" })], edges: [] }));

    assert.equal(verdict.valid, false);
    assert.equal("envelope" in verdict, false, "a refused document produces no partial structure");
  });
});
