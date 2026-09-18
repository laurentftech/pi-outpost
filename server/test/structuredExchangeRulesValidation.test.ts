/**
 * A rules file, judged on its own and against the profile it names.
 *
 * The failure this guards against is quiet: a rule that names a word the profile does
 * not have never matches, so a specification passes review against a rule that checked
 * nothing. Each test breaks one thing and asserts both the rule and where it points.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StructuredExchangeProfile, StructuredExchangeRules } from "@pi-outpost/shared/structured-exchange/profile";
import {
  registryRulesIssues,
  rulesAgainstProfile,
  validateRules,
} from "@pi-outpost/shared/structured-exchange/rules-validation";

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
        { name: "verification", type: "enumeration", values: ["test", "analysis", "review", "inspection"], closed: true },
        { name: "level", type: "number" },
        { name: "tags", type: "string", list: true },
        { name: "owner", type: "reference" },
      ],
    },
    { kind: "test" },
  ],
  relationshipKinds: [{ kind: "satisfies" }, { kind: "verifies" }],
};

const rulesFile = (rules: unknown[]): StructuredExchangeRules =>
  ({ schema: "urn:structured-exchange-rules:1", profile: "acme/requirements", rules }) as StructuredExchangeRules;

const forbidDerivedSatisfies = {
  id: "ARP4754A-derived-no-satisfy",
  source: "ARP4754A",
  statement: "Une exigence dérivée ne satisfait pas une exigence amont.",
  level: "refuse",
  relationship: "satisfies",
  when: { from: { category: ["derived"] } },
  then: "forbidden",
};
const safetyBySafety = {
  id: "SAF-satisfied-by-safety",
  statement: "Une exigence safety n'est satisfaite que par des exigences safety.",
  level: "refuse",
  relationship: "satisfies",
  when: { to: { safety: ["yes"] } },
  then: { from: { safety: ["yes"] } },
};
const derivedVerification = {
  id: "CAT-derived-verification",
  statement: "Une exigence dérivée se vérifie par analyse ou revue.",
  level: "report",
  element: "requirement",
  when: { category: ["derived"] },
  then: { verification: ["analysis", "review"] },
};

/** A file expected to pass on its own and against the profile. */
function usable(rules: unknown[]) {
  const verdict = validateRules(rulesFile(rules));
  assert.deepEqual(verdict.issues, [], "the rules file was refused on its own");
  assert.ok(verdict.valid);
  assert.deepEqual(rulesAgainstProfile(verdict.rules, profile), [], "the rules file was refused against its profile");
}

/** `rule @ path` for a file expected to be refused against the profile (after passing on its own). */
function refusedAgainstProfile(rules: unknown[]): string[] {
  const verdict = validateRules(rulesFile(rules));
  assert.ok(verdict.valid, `refused on its own: ${JSON.stringify(verdict.issues)}`);
  return rulesAgainstProfile(verdict.rules, profile).map((issue) => `${issue.rule} @ ${issue.path}`);
}

/** `rule @ path` for a file expected to be refused on its own. */
function refusedOnItsOwn(value: unknown): string[] {
  const verdict = validateRules(value);
  assert.equal(verdict.valid, false, "the rules file was accepted");
  return verdict.issues.map((issue) => `${issue.rule} @ ${issue.path}`);
}

describe("a rules file", () => {
  test("forbidding a relationship by its source's attribute is usable", () => {
    // ALinkRuleForbidsARelationship
    usable([forbidDerivedSatisfies]);
  });

  test("constraining one end of a relationship by the other is usable", () => {
    // ALinkRuleConstrainsTheOtherEnd
    usable([safetyBySafety]);
  });

  test("constraining attributes together on one item is usable", () => {
    // AnItemRuleConstrainsAttributesTogether
    usable([derivedVerification]);
  });

  test("a rule applying to every item of its kind needs no when", () => {
    const { when: _when, ...everyRequirement } = derivedVerification;
    usable([everyRequirement]);
  });

  test("naming a value the profile does not list is refused at that value, listing the ones it does", () => {
    // ARuleNamingAValueTheProfileLacksIsRefused
    const verdict = validateRules(rulesFile([{ ...forbidDerivedSatisfies, when: { from: { category: ["derivee"] } } }]));
    assert.ok(verdict.valid);
    const issues = rulesAgainstProfile(verdict.rules, profile);
    assert.deepEqual(issues.map((issue) => `${issue.rule} @ ${issue.path}`), ["rules-format/undeclared-value @ /rules/0/when/from/category/0"]);
    assert.match(issues[0].message, /"derived", "refined", "direct"/);
  });

  test("naming an attribute the kind does not declare is refused at the attribute", () => {
    // ARuleOnAnUndeclaredAttributeIsRefused
    assert.deepEqual(refusedAgainstProfile([{ ...derivedVerification, then: { verificaton: ["review"] } }]), [
      "rules-format/undeclared-attribute @ /rules/0/then/verificaton",
    ]);
    assert.deepEqual(refusedAgainstProfile([{ ...safetyBySafety, then: { from: { safe: ["yes"] } } }]), [
      "rules-format/undeclared-attribute @ /rules/0/then/from/safe",
    ]);
  });

  test("two rules sharing an identifier are refused at the second", () => {
    // TwoRulesSharingAnIdentifierAreRefused
    assert.deepEqual(refusedOnItsOwn(rulesFile([derivedVerification, { ...safetyBySafety, id: derivedVerification.id }])), [
      "rules-format/duplicate-rule-identifier @ /rules/1/id",
    ]);
  });

  test("a kind the profile does not declare, in the vocabulary the rule uses, is refused", () => {
    assert.deepEqual(refusedAgainstProfile([{ ...derivedVerification, element: "requirment" }]), ["rules-format/undeclared-kind @ /rules/0/element"]);
    // A relationship kind named as an element kind is not declared there.
    assert.deepEqual(refusedAgainstProfile([{ ...derivedVerification, element: "satisfies" }]), ["rules-format/undeclared-kind @ /rules/0/element"]);
    assert.deepEqual(refusedAgainstProfile([{ ...safetyBySafety, relationship: "satisfy" }]), ["rules-format/undeclared-kind @ /rules/0/relationship"]);
  });

  test("a condition on a list or a reference is refused, as is a value of the wrong type", () => {
    assert.deepEqual(refusedAgainstProfile([{ ...derivedVerification, then: { tags: ["safety"] } }]), [
      "rules-format/unsupported-attribute @ /rules/0/then/tags",
    ]);
    assert.deepEqual(refusedAgainstProfile([{ ...derivedVerification, then: { owner: ["ORG-1"] } }]), [
      "rules-format/unsupported-attribute @ /rules/0/then/owner",
    ]);
    assert.deepEqual(refusedAgainstProfile([{ ...derivedVerification, then: { level: ["3"] } }]), ["rules-format/value-type @ /rules/0/then/level/0"]);
  });

  test("a rule naming both an element and a relationship, or neither, is refused", () => {
    assert.deepEqual(refusedOnItsOwn(rulesFile([{ ...derivedVerification, relationship: "satisfies" }])), ["rules-format/rule-form @ /rules/0"]);
    const { element: _element, ...neither } = derivedVerification;
    assert.deepEqual(refusedOnItsOwn(rulesFile([neither])), ["rules-format/rule-form @ /rules/0"]);
  });

  test("an item rule written with ends, and a link rule written without, are refused at the clause", () => {
    assert.deepEqual(refusedOnItsOwn(rulesFile([{ ...derivedVerification, when: { from: { category: ["derived"] } } }])), [
      "rules-format/item-conditions @ /rules/0/when/from",
    ]);
    assert.deepEqual(refusedOnItsOwn(rulesFile([{ ...safetyBySafety, then: { safety: ["yes"] } }])), [
      "rules-format/link-conditions @ /rules/0/then/safety",
    ]);
  });

  test("a then that requires nothing is refused", () => {
    assert.deepEqual(refusedOnItsOwn(rulesFile([{ ...derivedVerification, then: {} }])), ["rules-format/empty-then @ /rules/0/then"]);
  });

  test("an unknown field, a missing statement or an unknown level is refused by the schema", () => {
    assert.ok(refusedOnItsOwn(rulesFile([{ ...derivedVerification, severity: "high" }])).some((line) => line.startsWith("rules-format/schema/additionalProperties @ /rules/0/severity")));
    const { statement: _statement, ...unstated } = derivedVerification;
    assert.ok(refusedOnItsOwn(rulesFile([unstated])).some((line) => line.startsWith("rules-format/schema/required")));
    assert.ok(refusedOnItsOwn(rulesFile([{ ...derivedVerification, level: "warn" }])).some((line) => line.includes("/rules/0/level")));
  });
});

describe("a link rule under a profile declaring relationship ends", () => {
  /** Only a test declares `bench`; `satisfies` joins requirements, `traces` leaves its ends open. */
  const withEnds: StructuredExchangeProfile = {
    ...profile,
    elementKinds: [profile.elementKinds![0], { kind: "test", attributes: [{ name: "bench", type: "enumeration", values: ["hil", "vehicle"], closed: true }] }],
    relationshipKinds: [{ kind: "satisfies", from: ["requirement"], to: ["requirement"] }, { kind: "traces" }],
  };
  const benchRule = (relationship: string) => ({
    id: `BENCH-${relationship}`,
    statement: "Only hardware-in-the-loop evidence counts.",
    level: "report",
    relationship,
    when: { from: { bench: ["vehicle"] } },
    then: "forbidden",
  });
  const against = (rules: unknown[]) => {
    const verdict = validateRules(rulesFile(rules));
    assert.ok(verdict.valid, `refused on its own: ${JSON.stringify(verdict.issues)}`);
    return rulesAgainstProfile(verdict.rules, withEnds);
  };

  test("a condition is read on the kinds allowed at that end, and refused when none of them declares the attribute", () => {
    // ALinkRuleConditionIsReadOnTheDeclaredEnds
    const issues = against([benchRule("satisfies")]);
    assert.deepEqual(
      issues.map((issue) => `${issue.rule} @ ${issue.path}`),
      ["rules-format/undeclared-attribute @ /rules/0/when/from/bench"],
    );
    assert.match(issues[0].message, /at the source of "satisfies", where profile "acme\/requirements" allows only "requirement"/);
  });

  test("an end the relationship kind leaves open reads every element kind", () => {
    // AnUndeclaredEndReadsEveryElementKind
    assert.deepEqual(against([benchRule("traces")]), []);
  });

  test("a value is checked against the attribute as the allowed kinds declare it", () => {
    const wrongValue = { ...benchRule("traces"), when: { from: { bench: ["track"] } } };
    assert.deepEqual(
      against([wrongValue]).map((issue) => `${issue.rule} @ ${issue.path}`),
      ["rules-format/undeclared-value @ /rules/0/when/from/bench/0"],
    );
  });
});

describe("rules files together, in a registry", () => {
  const profiles = new Map([[profile.id, profile]]);

  test("a rules file for a profile the registry does not register is refused, listing the registered ones", () => {
    // ARulesFileForAnUnregisteredProfileRefusesEveryDocument, at the validation level
    const issues = registryRulesIssues([{ path: "rules/other.json", rules: { ...rulesFile([derivedVerification]), profile: "acme/other" } }], profiles);
    assert.deepEqual(issues.map((issue) => `${issue.rule} @ ${issue.path}`), ["registry/rules-for-unregistered-profile @ /rules/0"]);
    assert.match(issues[0].message, /rules\/other\.json/);
    assert.match(issues[0].message, /"acme\/requirements"/);
  });

  test("one rule identifier declared by two files for one profile is refused, naming both", () => {
    const issues = registryRulesIssues(
      [
        { path: "rules/arp.json", rules: rulesFile([forbidDerivedSatisfies]) },
        { path: "rules/safety.json", rules: rulesFile([{ ...safetyBySafety, id: forbidDerivedSatisfies.id }]) },
      ],
      profiles,
    );
    assert.deepEqual(issues.map((issue) => `${issue.rule} @ ${issue.path}`), ["registry/duplicate-rule-identifier @ /rules/1"]);
    assert.match(issues[0].message, /rules\/safety\.json/);
    assert.match(issues[0].message, /rules\/arp\.json/);
  });

  test("consistent rules files have nothing to say", () => {
    assert.deepEqual(
      registryRulesIssues(
        [
          { path: "rules/arp.json", rules: rulesFile([forbidDerivedSatisfies]) },
          { path: "rules/safety.json", rules: rulesFile([safetyBySafety, derivedVerification]) },
        ],
        profiles,
      ),
      [],
    );
  });
});
