/**
 * A project's rules, evaluated on documents that already satisfy the core contract and
 * the profile — the only documents rules ever see.
 *
 * The assertions separate the three outcomes precisely, because the difference is the
 * point: a violation is the requirement's fault, "not verifiable" is the export's gap,
 * and silence is a rule that held.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProfileRule, StructuredExchangeProfile } from "@pi-outpost/shared/structured-exchange/profile";
import { holdToProfile } from "@pi-outpost/shared/structured-exchange/profile-check";
import { evaluateRules } from "@pi-outpost/shared/structured-exchange/rule-evaluation";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";

const profile: StructuredExchangeProfile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "category", type: "enumeration", values: ["derived", "refined", "direct"], closed: true },
        { name: "safety", type: "enumeration", values: ["yes", "no"], closed: true },
        { name: "verification", type: "enumeration", values: ["test", "analysis", "review"], closed: true },
      ],
    },
  ],
  relationshipKinds: [{ kind: "satisfies" }],
};

const forbidDerivedSatisfies: ProfileRule = {
  id: "ARP4754A-derived-no-satisfy",
  source: "ARP4754A",
  statement: "Une exigence dérivée ne satisfait pas une exigence amont.",
  level: "refuse",
  relationship: "satisfies",
  when: { from: { category: ["derived"] } },
  then: "forbidden",
};
const safetyBySafety: ProfileRule = {
  id: "SAF-satisfied-by-safety",
  statement: "Une exigence safety n'est satisfaite que par des exigences safety.",
  level: "refuse",
  relationship: "satisfies",
  when: { to: { safety: ["yes"] } },
  then: { from: { safety: ["yes"] } },
};
const derivedVerification: ProfileRule = {
  id: "CAT-derived-verification",
  statement: "Une exigence dérivée se vérifie par analyse ou revue.",
  level: "report",
  element: "requirement",
  when: { category: ["derived"] },
  then: { verification: ["analysis", "review"] },
};

type Row = { id: string; attributes?: Record<string, unknown> };

/** A table of requirements and relations that passes the core contract and the profile. */
function table(rows: Row[], relations: { from: Record<string, string>; to: Record<string, string> }[]) {
  const document = {
    schema: "urn:structured-exchange:2",
    kind: "table",
    profile: "acme/requirements",
    data: {
      columns: ["id"],
      rows: rows.map((row) => ({ id: row.id, kind: "requirement", cells: [row.id], ...(row.attributes ? { attributes: row.attributes } : {}) })),
      relations: relations.map((relation) => ({ ...relation, kind: "satisfies" })),
    },
  };
  const parsed = parseStructuredExchange(document, checkStructuredExchangeSchema);
  assert.ok(parsed.valid, `the fixture breaks the core contract: ${JSON.stringify(parsed.valid ? [] : parsed.issues)}`);
  const held = holdToProfile(parsed.envelope, { profiles: new Map([[profile.id, profile]]) });
  assert.equal(held.outcome, "conforms", `the fixture strays from the profile: ${JSON.stringify(held)}`);
  return parsed.envelope;
}

const summary = (findings: ReturnType<typeof evaluateRules>) => findings.map((finding) => `${finding.ruleId} ${finding.outcome} @ ${finding.path}`);

describe("rules on a document", () => {
  test("a derived requirement satisfying another violates the rule forbidding it", () => {
    // ADerivedRequirementSatisfyingUpstreamIsAViolation
    const envelope = table([{ id: "req-1", attributes: { category: "derived" } }, { id: "req-2" }], [{ from: { id: "req-1" }, to: { id: "req-2" } }]);
    const findings = evaluateRules(envelope, [forbidDerivedSatisfies]);
    assert.deepEqual(summary(findings), ["ARP4754A-derived-no-satisfy violated @ /data/relations/0"]);
    assert.equal(findings[0].from, "req-1");
    assert.equal(findings[0].to, "req-2");
    assert.match(findings[0].message, /Une exigence dérivée ne satisfait pas une exigence amont\./);
    assert.match(findings[0].message, /\(ARP4754A\)/);
  });

  test("a safety requirement satisfied by a non-safety one violates the rule", () => {
    // ASafetyRequirementSatisfiedByANonSafetyOneIsAViolation
    const envelope = table([{ id: "req-1", attributes: { safety: "no" } }, { id: "req-2", attributes: { safety: "yes" } }], [{ from: { id: "req-1" }, to: { id: "req-2" } }]);
    assert.deepEqual(summary(evaluateRules(envelope, [safetyBySafety])), ["SAF-satisfied-by-safety violated @ /data/relations/0"]);
  });

  test("a link whose ends both carry what the rule requires satisfies it", () => {
    // AConformingLinkSatisfiesTheRule
    const envelope = table([{ id: "req-1", attributes: { safety: "yes" } }, { id: "req-2", attributes: { safety: "yes" } }], [{ from: { id: "req-1" }, to: { id: "req-2" } }]);
    assert.deepEqual(evaluateRules(envelope, [safetyBySafety, forbidDerivedSatisfies]), []);
  });

  test("an end outside the document makes the rule not verifiable, never violated or satisfied", () => {
    // AnEndOutsideTheDocumentIsNotVerifiable
    const envelope = table([{ id: "req-1", attributes: { safety: "no" } }], [{ from: { id: "req-1" }, to: { ref: "REQ-99" } }]);
    const findings = evaluateRules(envelope, [safetyBySafety]);
    assert.deepEqual(summary(findings), ["SAF-satisfied-by-safety not-verifiable @ /data/relations/0"]);
    assert.equal(findings[0].to, "REQ-99");
    assert.match(findings[0].message, /not verifiable here/);
  });

  test("a neighbour carried for context without the attribute makes the rule not verifiable", () => {
    // ANeighbourWithoutTheAttributeIsNotVerifiable
    const envelope = table([{ id: "req-1", attributes: { safety: "no" } }, { id: "req-2" }], [{ from: { id: "req-1" }, to: { id: "req-2" } }]);
    assert.deepEqual(summary(evaluateRules(envelope, [safetyBySafety], { subjects: new Set(["req-1"]) })), [
      "SAF-satisfied-by-safety not-verifiable @ /data/relations/0",
    ]);
  });

  test("a selecting condition that does not hold on a verifiable end leaves the rule silent, even if the other end is unknown", () => {
    const envelope = table([{ id: "req-1", attributes: { category: "direct" } }], [{ from: { id: "req-1" }, to: { ref: "REQ-99" } }]);
    assert.deepEqual(evaluateRules(envelope, [forbidDerivedSatisfies]), []);
  });

  test("an item rule applies only to items meeting its selecting conditions", () => {
    // AnItemRuleSelectsByItsConditions
    const envelope = table([{ id: "req-1", attributes: { category: "direct" } }], []);
    assert.deepEqual(evaluateRules(envelope, [derivedVerification]), []);
  });

  test("a subject missing the attribute a rule requires violates it", () => {
    // AMissingRequiredAttributeViolatesTheRule
    const envelope = table([{ id: "req-1", attributes: { category: "derived" } }], []);
    const findings = evaluateRules(envelope, [derivedVerification]);
    assert.deepEqual(summary(findings), ["CAT-derived-verification violated @ /data/rows/0"]);
    assert.equal(findings[0].item, "req-1");
    assert.equal(findings[0].level, "report");
  });

  test("a subject carrying an allowed value satisfies an item rule", () => {
    const envelope = table([{ id: "req-1", attributes: { category: "derived", verification: "review" } }], []);
    assert.deepEqual(evaluateRules(envelope, [derivedVerification]), []);
  });

  test("findings come in document order, items before relationships", () => {
    const envelope = table(
      [
        { id: "req-1", attributes: { category: "derived", safety: "no" } },
        { id: "req-2", attributes: { category: "derived", safety: "yes" } },
      ],
      [{ from: { id: "req-1" }, to: { id: "req-2" } }],
    );
    assert.deepEqual(summary(evaluateRules(envelope, [safetyBySafety, derivedVerification, forbidDerivedSatisfies])), [
      "CAT-derived-verification violated @ /data/rows/0",
      "CAT-derived-verification violated @ /data/rows/1",
      "SAF-satisfied-by-safety violated @ /data/relations/0",
      "ARP4754A-derived-no-satisfy violated @ /data/relations/0",
    ]);
  });
});

describe("stated subjects", () => {
  test("a neighbour is never judged by an item rule, yet serves a link rule", () => {
    const envelope = table(
      [
        { id: "req-1", attributes: { safety: "no", category: "refined", verification: "test" } },
        // Carried for context: derived and verified by test, which the item rule forbids — a
        // real violation, so judging this neighbour would show up rather than read as unknown.
        { id: "req-2", attributes: { safety: "yes", category: "derived", verification: "test" } },
      ],
      [{ from: { id: "req-1" }, to: { id: "req-2" } }],
    );
    const findings = evaluateRules(envelope, [derivedVerification, safetyBySafety], { subjects: new Set(["req-1"]) });
    assert.deepEqual(summary(findings), ["SAF-satisfied-by-safety violated @ /data/relations/0"]);
  });

  test("a relationship between two neighbours is not evaluated", () => {
    const envelope = table(
      [
        { id: "req-1", attributes: { safety: "yes" } },
        { id: "req-2", attributes: { safety: "no" } },
        { id: "req-3", attributes: { safety: "yes" } },
      ],
      [{ from: { id: "req-2" }, to: { id: "req-3" } }],
    );
    assert.deepEqual(evaluateRules(envelope, [safetyBySafety], { subjects: new Set(["req-1"]) }), []);
  });
});

describe("rules on a graph", () => {
  test("edges are relationships and nodes are items", () => {
    const document = {
      schema: "urn:structured-exchange:2",
      kind: "graph",
      profile: "acme/requirements",
      data: {
        nodes: [
          { id: "a", label: "A", kind: "requirement", attributes: { category: "derived" } },
          { id: "b", label: "B", kind: "requirement" },
        ],
        edges: [{ from: "a", to: "b", kind: "satisfies" }],
      },
    };
    const parsed = parseStructuredExchange(document, checkStructuredExchangeSchema);
    assert.ok(parsed.valid);
    assert.deepEqual(summary(evaluateRules(parsed.envelope, [forbidDerivedSatisfies, derivedVerification])), [
      "CAT-derived-verification violated @ /data/nodes/0",
      "ARP4754A-derived-no-satisfy violated @ /data/edges/0",
    ]);
  });
});
