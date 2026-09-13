/**
 * A profile and a registry, judged before any document is held to them.
 *
 * Each rule is exercised on the smallest profile that breaks it, and each assertion
 * checks both the rule and where it points: a refusal an author cannot locate in a
 * profile listing sixty kinds is a refusal that gets the profile rewritten from
 * scratch.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { STRUCTURED_EXCHANGE_PROFILE_CEILINGS, type StructuredExchangeProfile } from "@pi-outpost/shared/structured-exchange/profile";
import {
  registryConsistencyIssues,
  validateProfile,
  validateRegistry,
} from "@pi-outpost/shared/structured-exchange/profile-validation";

const requirements = (): StructuredExchangeProfile => ({
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "status", type: "enumeration", values: ["draft", "approved", "withdrawn"], closed: true, required: true },
        { name: "owner", type: "string" },
      ],
    },
    { kind: "test" },
  ],
  relationshipKinds: [{ kind: "verifies" }],
  viewpoints: [{ id: "verification", label: "Verification", concern: "What verifies what", elementKinds: ["requirement", "test"] }],
});

/** The issues of a profile expected to be refused, as `rule @ path` for readable failures. */
function refusal(value: unknown): string[] {
  const verdict = validateProfile(value);
  assert.equal(verdict.valid, false, "the profile was accepted");
  return verdict.issues.map((issue) => `${issue.rule} @ ${issue.path}`);
}

describe("a profile", () => {
  test("declaring kinds, attributes and a closed enumeration is usable", () => {
    // AProfileDeclaresKindsAttributesAndEnumerations
    const verdict = validateProfile(requirements());
    assert.deepEqual(verdict.issues, []);
    assert.ok(verdict.valid);
    assert.equal(verdict.profile.elementKinds?.[0].attributes?.[0].closed, true);
  });

  test("carrying a field the format does not define is refused at that field", () => {
    // AnUnknownProfileFieldIsRefused
    assert.deepEqual(refusal({ ...requirements(), extends: "acme/base" }), ["profile-format/schema/additionalProperties @ /extends"]);
    const nested = requirements();
    (nested.elementKinds![0].attributes![1] as unknown as Record<string, unknown>).default = "nobody";
    assert.deepEqual(refusal(nested), ["profile-format/schema/additionalProperties @ /elementKinds/0/attributes/1/default"]);
  });

  test("naming another format is refused saying which it must be", () => {
    const verdict = validateProfile({ ...requirements(), schema: "urn:structured-exchange:2" });
    assert.ok(!verdict.valid);
    assert.equal(verdict.issues[0].path, "/schema");
    assert.match(verdict.issues[0].message, /urn:structured-exchange-profile:1/);
  });

  test("declaring an enumeration with no values is refused at the attribute", () => {
    // AnEnumerationWithoutValuesIsRefused
    const withoutValues = requirements();
    delete withoutValues.elementKinds![0].attributes![0].values;
    assert.deepEqual(refusal(withoutValues), ["profile-format/incomplete-enumeration @ /elementKinds/0/attributes/0"]);

    const emptyValues = requirements();
    emptyValues.elementKinds![0].attributes![0].values = [];
    assert.deepEqual(refusal(emptyValues), ["profile-format/schema/minItems @ /elementKinds/0/attributes/0/values"]);
  });

  test("declaring an enumeration without saying whether it is closed is refused", () => {
    const profile = requirements();
    delete profile.elementKinds![0].attributes![0].closed;
    const verdict = validateProfile(profile);
    assert.ok(!verdict.valid);
    assert.equal(verdict.issues[0].rule, "profile-format/incomplete-enumeration");
    assert.match(verdict.issues[0].message, /whether it is closed/);
  });

  test("listing an enumeration value twice is refused at the repeated value", () => {
    // ARepeatedEnumerationValueIsRefused
    const profile = requirements();
    profile.elementKinds![0].attributes![0].values = ["draft", "approved", "draft"];
    const verdict = validateProfile(profile);
    assert.ok(!verdict.valid);
    assert.deepEqual(
      verdict.issues.map((issue) => `${issue.rule} @ ${issue.path}`),
      ["profile-format/repeated-enumeration-value @ /elementKinds/0/attributes/0/values/2"],
    );
    assert.match(verdict.issues[0].message, /values\/0/);
  });

  test("values on an attribute that is not an enumeration are refused", () => {
    const profile = requirements();
    Object.assign(profile.elementKinds![0].attributes![1], { values: ["alice"], closed: true });
    assert.deepEqual(refusal(profile), [
      "profile-format/values-on-non-enumeration @ /elementKinds/0/attributes/1/values",
      "profile-format/values-on-non-enumeration @ /elementKinds/0/attributes/1/closed",
    ]);
  });

  test("declaring a kind twice is refused at the second declaration", () => {
    const profile = requirements();
    profile.elementKinds!.push({ kind: "requirement" });
    assert.deepEqual(refusal(profile), ["profile-format/duplicate-kind @ /elementKinds/2/kind"]);
  });

  test("the same word in both vocabularies is two kinds, not a duplicate", () => {
    const profile = requirements();
    profile.relationshipKinds!.push({ kind: "requirement" });
    assert.ok(validateProfile(profile).valid);
  });

  test("declaring an attribute of a kind twice is refused at the second one", () => {
    const profile = requirements();
    profile.elementKinds![0].attributes!.push({ name: "owner", type: "reference" });
    assert.deepEqual(refusal(profile), ["profile-format/duplicate-attribute @ /elementKinds/0/attributes/2/name"]);
  });

  test("a viewpoint retaining a kind the profile does not declare is refused at that kind", () => {
    // AProfileViewpointRetainingAnUndeclaredKindIsRefused
    const profile = requirements();
    profile.viewpoints![0].elementKinds = ["requirement", "verifies"];
    const verdict = validateProfile(profile);
    assert.ok(!verdict.valid);
    assert.deepEqual(
      verdict.issues.map((issue) => `${issue.rule} @ ${issue.path}`),
      ["profile-format/unresolved-viewpoint-kind @ /viewpoints/0/elementKinds/1"],
    );
    assert.match(verdict.issues[0].message, /relationship kind here/);
  });

  test("two viewpoints sharing an identifier, and a viewpoint retaining nothing, are refused", () => {
    const profile = requirements();
    profile.viewpoints!.push({ id: "verification", label: "Again", concern: "Twice" });
    assert.deepEqual(refusal(profile), [
      "profile-format/duplicate-viewpoint-identifier @ /viewpoints/1/id",
      "profile-format/empty-viewpoint @ /viewpoints/1",
    ]);
  });

  test("more enumeration values than the ceiling allows are refused naming the ceiling", () => {
    // AProfileBeyondItsCeilingsIsRefused
    const profile = requirements();
    const limit = STRUCTURED_EXCHANGE_PROFILE_CEILINGS.enumerationValues;
    profile.elementKinds![0].attributes![0].values = Array.from({ length: limit + 1 }, (_, i) => `v${i}`);
    const verdict = validateProfile(profile);
    assert.ok(!verdict.valid);
    assert.equal(verdict.issues[0].rule, "profile-format/schema/maxItems");
    assert.equal(verdict.issues[0].path, "/elementKinds/0/attributes/0/values");
    assert.equal(verdict.issues[0].limit, limit);
  });
});

describe("a registry", () => {
  const registry = { schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/a.json", "profiles/b.json"] };
  const profile = (id: string) => ({ ...requirements(), id });

  test("listing profile files, with or without a default, is usable", () => {
    assert.ok(validateRegistry(registry).valid);
    assert.ok(validateRegistry({ ...registry, default: "acme/requirements" }).valid);
  });

  test("listing no profile, or an unknown field, is refused", () => {
    const empty = validateRegistry({ ...registry, profiles: [] });
    assert.ok(!empty.valid && empty.issues[0].rule === "registry/schema/minItems");
    const unknown = validateRegistry({ ...registry, profile: "acme/requirements" });
    assert.ok(!unknown.valid && unknown.issues[0].path === "/profile");
  });

  test("listing one file twice is refused at the second entry", () => {
    const verdict = validateRegistry({ ...registry, profiles: ["profiles/a.json", "profiles/a.json"] });
    assert.ok(!verdict.valid);
    assert.equal(`${verdict.issues[0].rule} @ ${verdict.issues[0].path}`, "registry/repeated-profile-path @ /profiles/1");
  });

  test("two files declaring the same identifier are refused, naming both", () => {
    // TwoProfilesSharingAnIdentifierRefuseEveryDocument, at the validation level
    const issues = registryConsistencyIssues(registry as never, [
      { path: "profiles/a.json", profile: profile("acme/requirements") },
      { path: "profiles/b.json", profile: profile("acme/requirements") },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(`${issues[0].rule} @ ${issues[0].path}`, "registry/duplicate-profile-identifier @ /profiles/1");
    assert.match(issues[0].message, /profiles\/b\.json/);
    assert.match(issues[0].message, /profiles\/a\.json/);
  });

  test("a default no registered profile declares is refused, listing the registered ones", () => {
    // AnUnregisteredDefaultRefusesEveryDocument, at the validation level
    const issues = registryConsistencyIssues({ ...registry, default: "acme/other" } as never, [
      { path: "profiles/a.json", profile: profile("acme/requirements") },
      { path: "profiles/b.json", profile: profile("acme/tests") },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(`${issues[0].rule} @ ${issues[0].path}`, "registry/unregistered-default @ /default");
    assert.match(issues[0].message, /"acme\/requirements", "acme\/tests"/);
  });

  test("a consistent registry has nothing to say", () => {
    const issues = registryConsistencyIssues({ ...registry, default: "acme/tests" } as never, [
      { path: "profiles/a.json", profile: profile("acme/requirements") },
      { path: "profiles/b.json", profile: profile("acme/tests") },
    ]);
    assert.deepEqual(issues, []);
  });
});

describe("a reserved identifier", () => {
  test("a profile claiming the conformity report's identifier is refused at its identifier", () => {
    // AProfileClaimingAReservedIdentifierIsRefused
    assert.deepEqual(refusal({ ...requirements(), id: "urn:structured-exchange-conformity-report:1" }), ["profile-format/reserved-identifier @ /id"]);
  });
});
