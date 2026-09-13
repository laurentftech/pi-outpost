/**
 * Viewpoints in the contract: where they may appear, and how far.
 *
 * A viewpoint is a named reading of a graph — the concern it frames and the kinds
 * that address it. It joins the version 2 contract rather than a version 3 because
 * version 2 had not reached any producer when it was added: no release, no tag, no
 * package carried it. That is the only reason this was allowed, so the tests that
 * matter most here are the ones proving nothing else moved — version 1 still refuses
 * the field, and a version 2 document without viewpoints means what it meant.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import {
  STRUCTURED_EXCHANGE_CEILINGS,
  STRUCTURED_EXCHANGE_CEILINGS_2,
  STRUCTURED_EXCHANGE_SCHEMA_V1 as V1,
  STRUCTURED_EXCHANGE_SCHEMA_V2 as V2,
} from "@pi-outpost/shared/structured-exchange";

/** A small power-train architecture, with two element kinds and two relationship kinds. */
const architecture = (envelope: Record<string, unknown> = {}) => ({
  schema: V2,
  kind: "graph",
  ...envelope,
  data: {
    nodes: [
      { id: "battery", label: "Battery", kind: "source" },
      { id: "inverter", label: "Inverter", kind: "converter" },
      { id: "motor", label: "Motor", kind: "load" },
      { id: "ecu", label: "ECU", kind: "controller" },
    ],
    edges: [
      { from: "battery", to: "inverter", kind: "power" },
      { from: "inverter", to: "motor", kind: "power" },
      { from: "ecu", to: "inverter", kind: "signal" },
    ],
  },
});

const power = {
  id: "power",
  label: "Power distribution",
  concern: "Where energy is stored, converted and consumed",
  elementKinds: ["source", "converter", "load"],
  relationshipKinds: ["power"],
};

function verdict(document: unknown) {
  const outcome = parseStructuredExchange(document, checkStructuredExchangeSchema);
  return outcome.valid
    ? { valid: true as const, rules: [] as string[], issues: [], envelope: outcome.envelope }
    : { valid: false as const, rules: outcome.issues.map((issue) => issue.rule), issues: outcome.issues, envelope: undefined };
}

describe("viewpoints belong to the enriched contract", () => {
  test("a version 2 graph may declare them", () => {
    const outcome = verdict(architecture({ viewpoints: [power] }));
    assert.equal(outcome.valid, true, `refused: ${outcome.rules.join(", ")}`);
  });

  test("and they come back out of validation exactly as they went in", () => {
    // AnEnrichedDocumentMayDeclareViewpoints: nothing about a viewpoint is normalised,
    // reordered or filled in on the way through.
    const outcome = verdict(architecture({ viewpoints: [power] }));
    assert.deepEqual((outcome.envelope as unknown as { viewpoints: unknown }).viewpoints, [power]);
  });

  test("a version 2 document without them is untouched by their existence", () => {
    const outcome = verdict(architecture());
    assert.equal(outcome.valid, true);
    assert.equal("viewpoints" in (outcome.envelope as object), false, "validation invented an empty viewpoints list");
  });

  test("version 1 does not acquire them", () => {
    // VersionOneDoesNotAcquireViewpoints. The field exists only under the identifier
    // that defines it; the same document asking for version 1 is refused by shape.
    const outcome = verdict({ ...architecture({ viewpoints: [power] }), schema: V1 });
    assert.equal(outcome.valid, false);
    assert.ok(
      outcome.issues.some((issue) => issue.rule.startsWith("schema/") && issue.path === ""),
      `expected a schema refusal at the envelope, got ${JSON.stringify(outcome.issues)}`,
    );
  });

  test("a viewpoint needs an identifier, a label and a concern", () => {
    for (const missing of ["id", "label", "concern"] as const) {
      const partial: Record<string, unknown> = { ...power };
      delete partial[missing];
      const outcome = verdict(architecture({ viewpoints: [partial] }));
      assert.equal(outcome.valid, false, `a viewpoint without ${missing} was accepted`);
      assert.ok(outcome.rules.some((rule) => rule.startsWith("schema/")), missing);
    }
  });

  test("an empty label or concern is not a label or a concern", () => {
    for (const field of ["label", "concern"] as const) {
      const outcome = verdict(architecture({ viewpoints: [{ ...power, [field]: "" }] }));
      assert.equal(outcome.valid, false, `an empty ${field} was accepted`);
    }
  });

  test("a kind list, when present, names at least one kind and names it once", () => {
    // An empty list would mean "retain no element kinds", which hides every typed
    // element and every relationship touching one — never what a producer meant.
    assert.equal(verdict(architecture({ viewpoints: [{ ...power, elementKinds: [] }] })).valid, false);
    assert.equal(
      verdict(architecture({ viewpoints: [{ ...power, relationshipKinds: ["power", "power"] }] })).valid,
      false,
      "a kind listed twice was accepted",
    );
  });

  test("a viewpoint carries nothing the contract does not define", () => {
    const outcome = verdict(architecture({ viewpoints: [{ ...power, colour: "red" }] }));
    assert.equal(outcome.valid, false);
  });
});

describe("viewpoints are bounded", () => {
  const each = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ ...power, id: `v${index}`, label: `Viewpoint ${index}` }));

  test("at the ceiling on viewpoints per document, and not one past it", () => {
    const at = STRUCTURED_EXCHANGE_CEILINGS_2.viewpoints;
    assert.equal(verdict(architecture({ viewpoints: each(at) })).valid, true, "refused at the ceiling");
    const past = verdict(architecture({ viewpoints: each(at + 1) }));
    assert.equal(past.valid, false);
    const issue = past.issues.find((candidate) => candidate.rule === "schema/maxItems");
    assert.ok(issue, `expected schema/maxItems, got ${past.rules.join(", ")}`);
    assert.equal(issue.limit, at, "the refusal does not name the ceiling it exceeds");
  });

  test("at the ceiling on a viewpoint's concern, and not one character past it", () => {
    const at = STRUCTURED_EXCHANGE_CEILINGS_2.viewpointConcern;
    assert.equal(verdict(architecture({ viewpoints: [{ ...power, concern: "c".repeat(at) }] })).valid, true);
    const past = verdict(architecture({ viewpoints: [{ ...power, concern: "c".repeat(at + 1) }] }));
    const issue = past.issues.find((candidate) => candidate.rule === "schema/maxLength");
    assert.ok(issue, `expected schema/maxLength, got ${past.rules.join(", ")}`);
    assert.equal(issue.limit, at);
  });

  test("a viewpoint retains no more kinds than a vocabulary can hold apart", () => {
    const at = STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary;
    const kinds = (count: number) => Array.from({ length: count }, (_, index) => `kind-${index}`);
    const past = verdict(architecture({ viewpoints: [{ ...power, elementKinds: kinds(at + 1) }] }));
    const issue = past.issues.find((candidate) => candidate.rule === "schema/maxItems");
    assert.ok(issue, `expected schema/maxItems, got ${past.rules.join(", ")}`);
    assert.equal(issue.limit, at);
  });

  test("a viewpoint's label is bounded like every other label", () => {
    const at = STRUCTURED_EXCHANGE_CEILINGS.label;
    const past = verdict(architecture({ viewpoints: [{ ...power, label: "l".repeat(at + 1) }] }));
    assert.ok(past.issues.some((issue) => issue.rule === "schema/maxLength" && issue.limit === at));
  });
});

describe("a viewpoint that cannot be meant is refused", () => {
  const withViewpoints = (...viewpoints: Record<string, unknown>[]) => verdict(architecture({ viewpoints }));

  test("a viewpoint naming an element kind no element has", () => {
    // AViewpointNamingAnAbsentKindIsRefused
    const outcome = withViewpoints({ ...power, elementKinds: ["source", "storage"] });
    const issue = outcome.issues.find((candidate) => candidate.rule === "unresolved-viewpoint-kind");
    assert.ok(issue, `expected unresolved-viewpoint-kind, got ${outcome.rules.join(", ")}`);
    assert.equal(issue.path, "/viewpoints/0/elementKinds/1", "the refusal does not point at the kind");
    assert.match(issue.message, /"storage"/);
  });

  test("a viewpoint naming a relationship kind no relationship has", () => {
    const outcome = withViewpoints({ ...power, relationshipKinds: ["fluid"] });
    const issue = outcome.issues.find((candidate) => candidate.rule === "unresolved-viewpoint-kind");
    assert.ok(issue);
    assert.equal(issue.path, "/viewpoints/0/relationshipKinds/0");
  });

  test("a name that exists only in the other vocabulary is not the same kind", () => {
    // "power" is a relationship kind here. Retaining it as an element kind retains
    // nothing, and saying which vocabulary it does belong to is what makes the
    // refusal actionable.
    const { id, label, concern } = power;
    const outcome = withViewpoints({ id, label, concern, elementKinds: ["power"] });
    const issue = outcome.issues.find((candidate) => candidate.rule === "unresolved-viewpoint-kind");
    assert.ok(issue);
    assert.match(issue.message, /relationship kind here/);
  });

  test("a near-miss kind is refused, and nothing is substituted for it", () => {
    // ANearMissKindIsNotCorrected: "sources" is one character from "source".
    const outcome = withViewpoints({ ...power, elementKinds: ["sources"] });
    assert.equal(outcome.valid, false);
    assert.deepEqual(outcome.rules, ["unresolved-viewpoint-kind"]);
    assert.doesNotMatch(outcome.issues[0].message, /did you mean|"source"/);
  });

  test("two viewpoints sharing an identifier, pointing at the second", () => {
    // DuplicateViewpointIdentifiersAreRefused
    const outcome = withViewpoints(power, { ...power, label: "Also power" });
    const issue = outcome.issues.find((candidate) => candidate.rule === "duplicate-viewpoint-identifier");
    assert.ok(issue, `expected duplicate-viewpoint-identifier, got ${outcome.rules.join(", ")}`);
    assert.equal(issue.path, "/viewpoints/1/id");
    assert.match(issue.message, /\/viewpoints\/0/);
  });

  test("a viewpoint retaining no kind at all", () => {
    // AViewpointRetainingNothingIsRefused
    const outcome = withViewpoints({ id: "empty", label: "Nothing", concern: "Nothing in particular" });
    const issue = outcome.issues.find((candidate) => candidate.rule === "empty-viewpoint");
    assert.ok(issue, `expected empty-viewpoint, got ${outcome.rules.join(", ")}`);
    assert.equal(issue.path, "/viewpoints/0");
  });

  test("viewpoints on a document that is not a graph", () => {
    // ViewpointsOutsideAGraphAreRefused
    const sequence = {
      schema: V2,
      kind: "sequence",
      viewpoints: [power],
      data: { participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }], messages: [{ from: "a", to: "b", label: "go" }] },
    };
    const table = { schema: V2, kind: "table", viewpoints: [power], data: { columns: ["a"], rows: [["x"]] } };
    for (const document of [sequence, table]) {
      const outcome = verdict(document);
      const issue = outcome.issues.find((candidate) => candidate.rule === "viewpoints-without-graph");
      assert.ok(issue, `${document.kind}: expected viewpoints-without-graph, got ${outcome.rules.join(", ")}`);
      assert.equal(issue.path, "/viewpoints");
    }
  });

  test("a well-formed set of viewpoints raises nothing", () => {
    const signals = { id: "control", label: "Control", concern: "What commands what", elementKinds: ["controller", "converter"], relationshipKinds: ["signal"] };
    const outcome = withViewpoints(power, signals, { id: "elements-only", label: "Parts", concern: "What is there", elementKinds: ["load"] });
    assert.equal(outcome.valid, true, `refused: ${JSON.stringify(outcome.issues)}`);
  });
});
