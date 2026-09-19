/**
 * A document held to its project's profile.
 *
 * Every document here first passes the core contract through the real parser: the
 * profile check only ever sees documents the core accepted, and a fixture the core
 * would refuse proves nothing about the check. Assertions name the rule, the pointer,
 * and — where the requirement says a refusal states what is allowed — the allowed
 * values, since that is what lets an agent correct instead of guess.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { StructuredExchangeProfile } from "@pi-outpost/shared/structured-exchange/profile";
import {
  checkAgainstProfile,
  holdToProfile,
  selectProfile,
  type ProfileContext,
} from "@pi-outpost/shared/structured-exchange/profile-check";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";

const requirements: StructuredExchangeProfile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "status", type: "enumeration", values: ["draft", "approved", "withdrawn"], closed: true, required: true },
        { name: "priority", type: "enumeration", values: ["must", "should", "could"], closed: false },
        { name: "owner", type: "string" },
        { name: "weight", type: "number" },
        { name: "safety", type: "boolean" },
        { name: "verifiedBy", type: "reference", list: true },
      ],
    },
    { kind: "test" },
  ],
  relationshipKinds: [{ kind: "verifies", attributes: [{ name: "confidence", type: "number" }] }, { kind: "derives" }],
  viewpoints: [{ id: "verification", label: "Verification", concern: "What verifies what", elementKinds: ["requirement", "test"] }],
};

const tests: StructuredExchangeProfile = { schema: "urn:structured-exchange-profile:1", id: "acme/tests", label: "Tests", elementKinds: [{ kind: "test" }] };

const registered = (extra: Partial<ProfileContext> = {}): ProfileContext => ({
  profiles: new Map([
    [requirements.id, requirements],
    [tests.id, tests],
  ]),
  ...extra,
});

/** Through the core contract, as every document the check sees has been. */
function valid(document: Record<string, unknown>) {
  const verdict = parseStructuredExchange(document, checkStructuredExchangeSchema);
  assert.ok(verdict.valid, `the fixture breaks the core contract: ${JSON.stringify(verdict.valid ? [] : verdict.issues)}`);
  return verdict.envelope;
}

type Row = Record<string, unknown>;
const requirementRow = (over: Row = {}): Row => ({ id: "r1", kind: "requirement", cells: ["R1", "Stop within 40 m"], attributes: { status: "approved" }, ...over });

const table = (rows: unknown[], over: Row = {}) =>
  valid({
    schema: "urn:structured-exchange:2",
    kind: "table",
    profile: "acme/requirements",
    ...over,
    data: { columns: ["id", "text"], rows, ...((over.data as Row | undefined) ?? {}) },
  });

const graph = (nodes: Row[], edges: Row[] = [], over: Row = {}) =>
  valid({ schema: "urn:structured-exchange:2", kind: "graph", profile: "acme/requirements", ...over, data: { nodes, edges } });

/** The refusals of a document checked against the requirements profile, as `rule @ path`. */
const refusals = (envelope: unknown) => checkAgainstProfile(envelope, requirements).issues.map((issue) => `${issue.rule} @ ${issue.path}`);
const firstIssue = (envelope: unknown) => checkAgainstProfile(envelope, requirements).issues[0];

describe("a document held to its profile", () => {
  test("conforming, it is accepted with nothing to report", () => {
    // AConformingDocumentIsPresented, at the check level
    const envelope = valid({
      schema: "urn:structured-exchange:2",
      kind: "table",
      profile: "acme/requirements",
      data: {
        columns: ["id", "text"],
        rows: [
          { heading: "Braking" },
          requirementRow({ attributes: { status: "approved", owner: "ada", weight: 3, safety: true, verifiedBy: [{ ref: "T-1" }] } }),
          { id: "t1", kind: "test", cells: ["T1", "Brake test"] },
        ],
        relations: [{ from: { id: "t1" }, to: { id: "r1" }, kind: "verifies", attributes: { confidence: 0.9 } }],
      },
    });
    assert.deepEqual(holdToProfile(envelope, registered()), { outcome: "conforms", profile: "acme/requirements", notes: [] });
  });

  test("a kind the profile does not declare is refused, listing the kinds it does", () => {
    // AnUndeclaredKindIsRefusedWithTheDeclaredOnes
    const envelope = table([requirementRow({ kind: "requirment" })]);
    assert.deepEqual(refusals(envelope), ["profile/undeclared-kind @ /data/rows/0/kind"]);
    assert.match(firstIssue(envelope).message, /declares "requirement", "test"/);
  });

  test("a kind from the other vocabulary is named as such", () => {
    const envelope = graph([{ id: "a", label: "A", kind: "verifies" }]);
    assert.match(firstIssue(envelope).message, /one of its relationship kinds/);
  });

  test("an item carrying no kind is refused", () => {
    // AnUntypedItemIsRefused
    const envelope = graph([{ id: "a", label: "A" }]);
    assert.deepEqual(refusals(envelope), ["profile/missing-kind @ /data/nodes/0"]);
    assert.match(firstIssue(envelope).message, /"requirement", "test"/);
  });

  test("a row that is only cells carries no kind, and is refused", () => {
    assert.deepEqual(refusals(table([["R1", "Stop"]])), ["profile/missing-kind @ /data/rows/0"]);
  });

  test("a structural heading is not held to kinds", () => {
    // AStructuralHeadingIsNotHeldToKinds
    assert.deepEqual(refusals(table([{ heading: "Braking" }, requirementRow()])), []);
  });

  test("an attribute the kind does not have is refused, listing the ones it declares", () => {
    // AnAttributeTheKindDoesNotHaveIsRefused
    const envelope = table([requirementRow({ attributes: { status: "approved", waiver: true } })]);
    assert.deepEqual(refusals(envelope), ["profile/undeclared-attribute @ /data/rows/0/attributes/waiver"]);
    assert.match(firstIssue(envelope).message, /"status", "priority", "owner", "weight", "safety", "verifiedBy"/);
  });

  test("a value of the wrong type is refused", () => {
    // AValueOfTheWrongTypeIsRefused
    const envelope = table([requirementRow({ attributes: { status: "approved", weight: "12" } })]);
    assert.deepEqual(refusals(envelope), ["profile/attribute-type @ /data/rows/0/attributes/weight"]);
    assert.match(firstIssue(envelope).message, /holds a number, and this is the string "12"/);
  });

  test("a reference attribute holding a plain string is refused", () => {
    const envelope = table([requirementRow({ attributes: { status: "approved", verifiedBy: ["T-1"] } })]);
    assert.deepEqual(refusals(envelope), ["profile/attribute-type @ /data/rows/0/attributes/verifiedBy/0"]);
  });

  test("a list where one value is declared is refused, and one value where a list is", () => {
    // AListWhereOneValueIsDeclaredIsRefused
    const list = table([requirementRow({ attributes: { status: "approved", owner: ["ada", "grace"] } })]);
    assert.deepEqual(refusals(list), ["profile/attribute-type @ /data/rows/0/attributes/owner"]);
    const single = table([requirementRow({ attributes: { status: "approved", verifiedBy: { ref: "T-1" } } })]);
    assert.deepEqual(refusals(single), ["profile/attribute-type @ /data/rows/0/attributes/verifiedBy"]);
  });

  test("a value outside a closed enumeration is refused, listing every allowed value", () => {
    // AValueOutsideAClosedEnumerationIsRefusedWithTheAllowedValues
    const envelope = table([requirementRow({ attributes: { status: "in review" } })]);
    assert.deepEqual(refusals(envelope), ["profile/closed-enumeration @ /data/rows/0/attributes/status"]);
    assert.match(firstIssue(envelope).message, /allows "draft", "approved", "withdrawn"/);
  });

  test("a complete document missing a required attribute is refused at the item", () => {
    // AMissingRequiredAttributeIsRefused
    const envelope = table([requirementRow({ attributes: { owner: "ada" } })]);
    assert.deepEqual(refusals(envelope), ["profile/missing-required-attribute @ /data/rows/0"]);
    assert.match(firstIssue(envelope).message, /requires attribute "status"/);
  });

  test("a required attribute set to null is refused", () => {
    // ANullRequiredAttributeIsRefused
    const envelope = table([requirementRow({ attributes: { status: null } })]);
    assert.deepEqual(refusals(envelope), ["profile/null-required-attribute @ /data/rows/0/attributes/status"]);
  });

  test("an attribute that is not required may be null", () => {
    assert.deepEqual(refusals(table([requirementRow({ attributes: { status: "draft", owner: null } })])), []);
  });

  test("a relationship is held to the relationship vocabulary", () => {
    const envelope = graph(
      [
        { id: "r", label: "R", kind: "requirement", attributes: { status: "draft" } },
        { id: "t", label: "T", kind: "test" },
      ],
      [{ from: "t", to: "r", kind: "satisfies" }],
    );
    assert.deepEqual(refusals(envelope), ["profile/undeclared-kind @ /data/edges/0/kind"]);
    assert.match(firstIssue(envelope).message, /"verifies", "derives"/);
  });
});

describe("a proposal held to its profile", () => {
  const proposal = (rows: unknown[]) => table(rows, { target: { ref: "DOC-1" } });

  test("is not refused for required attributes it does not mention on an item it changes", () => {
    // AProposalIsNotRefusedForAttributesItDoesNotMention
    const envelope = proposal([
      { id: "r1", ref: "REQ-1", kind: "requirement", cells: ["R1", "Stop"], set: { attributes: { priority: "must" } } },
    ]);
    assert.deepEqual(refusals(envelope), []);
  });

  test("an item it adds carries its required attributes", () => {
    // AnItemAProposalAddsCarriesItsRequiredAttributes
    const envelope = proposal([{ id: "r2", kind: "requirement", cells: ["R2", "New requirement"] }]);
    assert.deepEqual(refusals(envelope), ["profile/missing-required-attribute @ /data/rows/0"]);
  });

  test("may not remove a required attribute", () => {
    // AProposalMayNotRemoveARequiredAttribute
    const envelope = proposal([
      { id: "r1", ref: "REQ-1", kind: "requirement", cells: ["R1", "Stop"], set: { removeAttributes: ["owner", "status"] } },
    ]);
    assert.deepEqual(refusals(envelope), ["profile/required-attribute-removed @ /data/rows/0/set/removeAttributes/1"]);
  });

  test("checks the values it sets", () => {
    const envelope = proposal([
      { id: "r1", ref: "REQ-1", kind: "requirement", cells: ["R1", "Stop"], set: { attributes: { status: "in review" } } },
    ]);
    assert.deepEqual(refusals(envelope), ["profile/closed-enumeration @ /data/rows/0/set/attributes/status"]);
  });

  test("a changed item still states its kind", () => {
    const envelope = proposal([{ id: "r1", ref: "REQ-1", cells: ["R1", "Stop"], set: { attributes: { priority: "must" } } }]);
    assert.deepEqual(refusals(envelope), ["profile/missing-kind @ /data/rows/0"]);
    assert.match(firstIssue(envelope).message, /states its kind too/);
  });

  test("retyping an item is checked against the kind it moves to, not the one it leaves", () => {
    const envelope = proposal([
      { id: "r1", ref: "REQ-1", kind: "legacy-need", cells: ["R1", "Stop"], set: { kind: "test" } },
    ]);
    assert.deepEqual(refusals(envelope), []);
    const wrong = proposal([{ id: "r1", ref: "REQ-1", kind: "requirement", cells: ["R1", "Stop"], set: { kind: "tst" } }]);
    assert.deepEqual(refusals(wrong), ["profile/undeclared-kind @ /data/rows/0/set/kind"]);
  });
});

describe("an open enumeration", () => {
  test("accepts a value it does not list, and reports it with the declared ones", () => {
    // AValueOutsideAnOpenEnumerationIsAcceptedAndReported
    const envelope = table([requirementRow({ attributes: { status: "approved", priority: "urgent" } })]);
    const verdict = holdToProfile(envelope, registered());
    assert.equal(verdict.outcome, "conforms");
    assert.ok(verdict.outcome === "conforms");
    assert.equal(verdict.notes.length, 1);
    assert.equal(verdict.notes[0].path, "/data/rows/0/attributes/priority");
    assert.deepEqual(verdict.notes[0].declared, ["must", "should", "could"]);
    assert.match(verdict.notes[0].message, /"must", "should", "could"/);
  });
});

describe("which profile a document is held to", () => {
  test("a document naming no profile is held to the default", () => {
    // ADocumentNamingNoProfileIsHeldToTheDefault
    const envelope = valid({ schema: "urn:structured-exchange:2", kind: "table", data: { columns: ["id", "text"], rows: [requirementRow({ attributes: {} })] } });
    const selection = selectProfile(envelope, registered({ default: "acme/requirements" }));
    assert.ok(selection.outcome === "held" && selection.profile.id === "acme/requirements");
    const verdict = holdToProfile(envelope, registered({ default: "acme/requirements" }));
    assert.equal(verdict.outcome, "refused", "the default was not applied");
  });

  test("under a default, a document naming an unregistered profile is refused, listing the registered ones", () => {
    // AnUnregisteredProfileIsRefusedUnderADefault
    const envelope = table([requirementRow()], { profile: "acme/other" });
    const selection = selectProfile(envelope, registered({ default: "acme/requirements" }));
    assert.ok(selection.outcome === "refused");
    assert.equal(`${selection.issues[0].rule} @ ${selection.issues[0].path}`, "profile/unregistered-profile @ /profile");
    assert.match(selection.issues[0].message, /"acme\/requirements", "acme\/tests"/);
  });

  test("under a default, a version 1 document is refused saying the project follows its default under version 2", () => {
    // AVersionOneDocumentIsRefusedUnderADefault
    const envelope = valid({ schema: "urn:structured-exchange:1", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } });
    const selection = selectProfile(envelope, registered({ default: "acme/requirements" }));
    assert.ok(selection.outcome === "refused");
    assert.equal(`${selection.issues[0].rule} @ ${selection.issues[0].path}`, "profile/version-1-under-default @ /schema");
    assert.match(selection.issues[0].message, /acme\/requirements/);
    assert.match(selection.issues[0].message, /urn:structured-exchange:2/);
  });

  test("without a default, an unregistered profile, no profile and version 1 are left to the core contract", () => {
    // WithoutADefaultAnUnregisteredProfileIsPresentedGenerically
    const unregistered = table([["R1", "Stop"]], { profile: "acme/other" });
    const unnamed = valid({ schema: "urn:structured-exchange:2", kind: "table", data: { columns: ["id", "text"], rows: [["R1", "Stop"]] } });
    const versionOne = valid({ schema: "urn:structured-exchange:1", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } });
    for (const envelope of [unregistered, unnamed, versionOne]) {
      assert.deepEqual(holdToProfile(envelope, registered()), { outcome: "unconstrained" });
    }
  });

  test("a sequence naming a registered profile is not held to it", () => {
    // ASequenceIsNotHeldToAProfile
    const envelope = valid({
      schema: "urn:structured-exchange:2",
      kind: "sequence",
      profile: "acme/requirements",
      data: { participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }], messages: [{ from: "a", to: "b", label: "hello" }] },
    });
    assert.deepEqual(holdToProfile(envelope, registered({ default: "acme/requirements" })), { outcome: "unconstrained" });
  });

  describe("a profile identifier that looks like an address", () => {
    const realFetch = globalThis.fetch;
    let fetched = 0;
    beforeEach(() => {
      fetched = 0;
      globalThis.fetch = (async () => {
        fetched += 1;
        throw new Error("nothing may be fetched");
      }) as typeof fetch;
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    test("is matched as a string and never retrieved", () => {
      // ProfilesAreNeverRetrieved
      const envelope = table([["R1", "Stop"]], { profile: "https://acme.example/profiles/requirements" });
      assert.deepEqual(holdToProfile(envelope, registered()), { outcome: "unconstrained" });
      const underDefault = holdToProfile(envelope, registered({ default: "acme/requirements" }));
      assert.equal(underDefault.outcome, "refused");
      assert.equal(fetched, 0);
    });
  });

  test("core validation accepts what only the project's profile refuses", () => {
    // CoreValidationIgnoresRegisteredProfiles
    const document = {
      schema: "urn:structured-exchange:2",
      kind: "table",
      profile: "acme/requirements",
      data: { columns: ["id", "text"], rows: [requirementRow({ attributes: { status: "in review" } })] },
    };
    assert.ok(parseStructuredExchange(document, checkStructuredExchangeSchema).valid, "the core contract refused it");
    assert.equal(holdToProfile(valid(document), registered()).outcome, "refused");
  });
});

describe("viewpoints and the profile", () => {
  test("a document viewpoint sharing an identifier with its profile's is refused", () => {
    const envelope = graph(
      [
        { id: "r", label: "R", kind: "requirement", attributes: { status: "draft" } },
        { id: "t", label: "T", kind: "test" },
      ],
      [{ from: "t", to: "r", kind: "verifies" }],
      { viewpoints: [{ id: "verification", label: "Mine", concern: "Also verification", elementKinds: ["test"] }] },
    );
    assert.deepEqual(refusals(envelope), ["profile/viewpoint-declared-twice @ /viewpoints/0/id"]);
  });
});

describe("a reserved profile identifier", () => {
  test("a document naming the conformity report's identifier is never held to a profile, even under a default", () => {
    // AReservedIdentifierIsNeverHeldToAProfile
    const report = valid({
      schema: "urn:structured-exchange:2",
      kind: "table",
      profile: "urn:structured-exchange-conformity-report:1",
      data: {
        columns: ["id", "text", "conformity"],
        rows: [{ heading: "Summary", depth: 1 }, ["requirements", "1", null], { id: "r1", kind: "requirement", cells: ["R1", "Stop", "conforms"] }],
      },
    });
    const underDefault = registered({ default: "acme/requirements" });
    assert.deepEqual(selectProfile(report, underDefault), { outcome: "unconstrained" });
    assert.deepEqual(holdToProfile(report, underDefault), { outcome: "unconstrained" });
    // The same table naming the default is refused: the exemption is the identifier and nothing else.
    assert.equal(holdToProfile({ ...(report as object), profile: "acme/requirements" }, underDefault).outcome, "refused");
  });
});

describe("a view's reserved identifier", () => {
  test("a rules register or rule patterns are never held to a profile, even under a default", () => {
    // AViewIdentifierIsNeverHeldToAProfile
    const underDefault = registered({ default: "acme/requirements" });
    const register = valid({
      schema: "urn:structured-exchange:2",
      kind: "table",
      profile: "urn:structured-exchange-rules-register:1",
      data: { columns: ["id", "statement"], rows: [{ heading: "element requirement", depth: 1 }, { id: "R-1", kind: "report rule", cells: ["R-1", "Approved."] }] },
    });
    assert.deepEqual(holdToProfile(register, underDefault), { outcome: "unconstrained" });
    const patterns = valid({
      schema: "urn:structured-exchange:2",
      kind: "graph",
      profile: "urn:structured-exchange-rule-patterns:1",
      data: { nodes: [{ id: "rule-1-item", label: "requirement · when safety = yes", kind: "selected item", container: "rule-1" }], edges: [], containers: [{ id: "rule-1", label: "REPORT · R-1 — Approved.", kind: "report rule" }] },
    });
    assert.deepEqual(holdToProfile(patterns, underDefault), { outcome: "unconstrained" });
    assert.equal(holdToProfile({ ...(register as object), profile: "acme/requirements" }, underDefault).outcome, "refused");
  });
});

describe("a relationship's ends", () => {
  /** The requirements profile, with `verifies` allowing only a test at its source and a requirement at its target. */
  const withEnds: StructuredExchangeProfile = {
    ...requirements,
    relationshipKinds: [
      { kind: "verifies", from: ["test"], to: ["requirement"], attributes: [{ name: "confidence", type: "number" }] },
      { kind: "derives" },
    ],
  };
  const context: ProfileContext = { profiles: new Map([[withEnds.id, withEnds]]) };
  const check = (envelope: unknown, subjects?: string[]) =>
    checkAgainstProfile(envelope, withEnds, subjects === undefined ? {} : { subjects: new Set(subjects) });
  const rulesAt = (envelope: unknown) => check(envelope).issues.map((issue) => `${issue.rule} @ ${issue.path}`);

  const requirement = (id: string, over: Row = {}): Row => ({ id, kind: "requirement", label: id, attributes: { status: "approved" }, ...over });
  const testNode = (id: string, over: Row = {}): Row => ({ id, kind: "test", label: id, ...over });

  test("joining a kind its declared end does not allow is refused at that end, listing the allowed kinds", () => {
    // ARelationshipBetweenKindsItsEndsDoNotAllowIsRefused
    const envelope = graph([requirement("r1"), requirement("r2")], [{ from: "r1", to: "r2", kind: "verifies" }]);
    assert.deepEqual(rulesAt(envelope), ["profile/end-kind @ /data/edges/0/from"]);
    const issue = check(envelope).issues[0];
    assert.match(issue.message, /"r1" is a "requirement"/);
    assert.match(issue.message, /allows at its source only "test"/);
    const held = holdToProfile(envelope, context);
    assert.equal(held.outcome, "refused");
  });

  test("a table relation is held to its ends", () => {
    // ATableRelationIsHeldToItsEnds
    const envelope = table(
      [requirementRow({ id: "r1" }), { id: "t1", kind: "test", cells: ["T1", "Bench"] }],
      { data: { relations: [{ from: { id: "r1" }, to: { id: "t1" }, kind: "verifies" }] } },
    );
    // A requirement verifying a test is wrong at both ends.
    assert.deepEqual(rulesAt(envelope), ["profile/end-kind @ /data/relations/0/from", "profile/end-kind @ /data/relations/0/to"]);
    const right = table(
      [requirementRow({ id: "r1" }), { id: "t1", kind: "test", cells: ["T1", "Bench"] }],
      { data: { relations: [{ from: { id: "t1" }, to: { id: "r1" }, kind: "verifies" }] } },
    );
    assert.deepEqual(rulesAt(right), []);
    assert.deepEqual(check(right).ends, []);
  });

  test("a side the relationship kind leaves undeclared allows any kind", () => {
    // AnUndeclaredSideAllowsAnyKind
    const onlySource: StructuredExchangeProfile = { ...requirements, relationshipKinds: [{ kind: "verifies", from: ["test"] }, { kind: "derives" }] };
    const envelope = graph([testNode("t1"), testNode("t2")], [{ from: "t1", to: "t2", kind: "verifies" }]);
    const outcome = checkAgainstProfile(envelope, onlySource);
    assert.deepEqual(outcome.issues, []);
    assert.deepEqual(outcome.ends, []);
    // And a kind declaring no ends at all is not judged by its ends.
    const derives = graph([testNode("t1"), requirement("r1")], [{ from: "t1", to: "r1", kind: "derives" }]);
    assert.deepEqual(check(derives).issues, []);
    assert.deepEqual(check(derives).ends, []);
  });

  test("an end outside the document is a finding to check, never a refusal or a pass", () => {
    // AnEndOutsideTheDocumentIsAFindingToCheck
    const envelope = table([requirementRow({ id: "r1" })], {
      data: { relations: [{ from: { ref: "TEST-9" }, to: { id: "r1" }, kind: "verifies" }] },
    });
    const outcome = check(envelope);
    assert.deepEqual(outcome.issues, []);
    assert.deepEqual(
      outcome.ends.map((finding) => `${finding.ruleId} ${finding.outcome} @ ${finding.path}`),
      ["profile/end-not-verifiable not-verifiable @ /data/relations/0/from"],
    );
    assert.match(outcome.ends[0].message, /"TEST-9" is not in this document/);
    const held = holdToProfile(envelope, context);
    assert.equal(held.outcome, "conforms");
    assert.deepEqual(held.outcome === "conforms" ? held.findings?.map((finding) => finding.path) : undefined, ["/data/relations/0/from"]);
  });

  test("a proposal is judged by the kinds it leaves its items with", () => {
    // AProposalIsJudgedByTheKindsItLeaves
    const envelope = graph(
      [
        { id: "n1", ref: "TST-1", kind: "test", label: "Bench", set: { kind: "requirement", attributes: { status: "draft" } } },
        requirement("r1", { ref: "REQ-1" }),
      ],
      [{ from: "n1", to: "r1", kind: "verifies" }],
      { target: { ref: "MODEL-1" } },
    );
    assert.deepEqual(rulesAt(envelope), ["profile/end-kind @ /data/edges/0/from"]);
    // The same retyping the other way is what makes the link right.
    const fixed = graph(
      [
        { id: "n1", ref: "REQ-7", kind: "requirement", label: "Bench", set: { kind: "test" } },
        requirement("r1", { ref: "REQ-1" }),
      ],
      [{ from: "n1", to: "r1", kind: "verifies" }],
      { target: { ref: "MODEL-1" } },
    );
    assert.deepEqual(rulesAt(fixed), []);
  });

  test("with stated subjects, only the relationships of a subject are judged by their ends", () => {
    const envelope = table(
      [requirementRow({ id: "r1" }), requirementRow({ id: "r2" }), requirementRow({ id: "r3" })],
      { data: { relations: [{ from: { id: "r2" }, to: { id: "r3" }, kind: "verifies" }] } },
    );
    assert.deepEqual(check(envelope, ["r1"]).issues, []);
    assert.deepEqual(check(envelope, ["r2"]).issues.map((issue) => issue.path), ["/data/relations/0/from"]);
  });
});
