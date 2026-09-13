/**
 * A project's rules files, read from its own directory beside its profiles.
 *
 * Real files in a real temporary project: what is outside the project, what is missing,
 * what an edit changes on the next read — and above all that a rules file which no
 * longer matches its profile makes the registry unusable instead of silently checking
 * nothing.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { readProjectProfiles, type ProjectProfiles } from "../src/structuredExchangeProfiles.ts";
import { realResolve } from "../src/sandbox.ts";

const profile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "category", type: "enumeration", values: ["derived", "refined", "direct"], closed: true },
        { name: "safety", type: "enumeration", values: ["yes", "no"], closed: true },
      ],
    },
  ],
  relationshipKinds: [{ kind: "satisfies" }],
};

const forbidDerived = {
  id: "ARP4754A-derived-no-satisfy",
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

const rulesFile = (rules: unknown[], profileId = "acme/requirements") => ({ schema: "urn:structured-exchange-rules:1", profile: profileId, rules });
const registry = (rules: string[]) => ({
  schema: "urn:structured-exchange-profile-registry:1",
  profiles: ["profiles/requirements.json"],
  rules,
});

describe("a project's rules files", () => {
  let base: string;
  let counter = 0;

  function project(files: Record<string, unknown>): string {
    const root = path.join(base, `project-${counter++}`);
    mkdirSync(root, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    }
    return root;
  }
  const withRules = (rules: string[], files: Record<string, unknown>) =>
    project({ ".pi-outpost/structured-exchange.json": registry(rules), "profiles/requirements.json": profile, ...files });

  const unusable = (outcome: ProjectProfiles) => {
    assert.equal(outcome.state, "unusable", `expected an unusable registry, got ${outcome.state}`);
    return (outcome as Extract<ProjectProfiles, { state: "unusable" }>).issues.map((issue) => `${issue.rule} in ${issue.file} at ${issue.path}`);
  };

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-rules-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("registered rules are available for the profile they name, in the registry's order", async () => {
    // RegisteredRulesApplyToTheirProfile, at the reading level
    const root = withRules(["rules/arp.json", "rules/safety.json"], {
      "rules/arp.json": rulesFile([forbidDerived]),
      "rules/safety.json": rulesFile([safetyBySafety]),
    });
    const outcome = await readProjectProfiles(root);
    assert.equal(outcome.state, "usable");
    assert.ok(outcome.state === "usable");
    assert.deepEqual(
      outcome.context.rules?.get("acme/requirements")?.map((rule) => rule.id),
      ["ARP4754A-derived-no-satisfy", "SAF-satisfied-by-safety"],
    );
  });

  test("a registry listing no rules has none", async () => {
    const root = project({ ".pi-outpost/structured-exchange.json": { schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"] }, "profiles/requirements.json": profile });
    const outcome = await readProjectProfiles(root);
    assert.ok(outcome.state === "usable");
    assert.equal(outcome.context.rules, undefined);
  });

  test("a rules file inconsistent with its profile makes the registry unusable, naming the file, rule and pointer", async () => {
    // ARulesFileInconsistentWithItsProfileRefusesEveryDocument, at the reading level
    const root = withRules(["rules/arp.json"], { "rules/arp.json": rulesFile([{ ...forbidDerived, when: { from: { category: ["derivee"] } } }]) });
    assert.deepEqual(unusable(await readProjectProfiles(root)), ["rules-format/undeclared-value in rules/arp.json at /rules/0/when/from/category/0"]);
  });

  test("a rules file for a profile the registry does not register makes it unusable", async () => {
    // ARulesFileForAnUnregisteredProfileRefusesEveryDocument, at the reading level
    const root = withRules(["rules/other.json"], { "rules/other.json": rulesFile([forbidDerived], "acme/other") });
    assert.deepEqual(unusable(await readProjectProfiles(root)), ["registry/rules-for-unregistered-profile in .pi-outpost/structured-exchange.json at /rules/0"]);
  });

  test("a missing, malformed or escaping rules file makes the registry unusable", async () => {
    const missing = withRules(["rules/gone.json"], {});
    assert.deepEqual(unusable(await readProjectProfiles(missing)), ["registry/missing-rules in .pi-outpost/structured-exchange.json at /rules/0"]);

    const malformed = withRules(["rules/broken.json"], { "rules/broken.json": "{ not json" });
    assert.deepEqual(unusable(await readProjectProfiles(malformed)), ["rules-format/not-json in rules/broken.json at "]);

    const escaping = withRules(["../elsewhere-rules.json"], {});
    writeFileSync(path.join(base, "elsewhere-rules.json"), JSON.stringify(rulesFile([forbidDerived])));
    assert.deepEqual(unusable(await readProjectProfiles(escaping)), ["registry/rules-outside-project in .pi-outpost/structured-exchange.json at /rules/0"]);
  });

  test("one rule identifier declared by two files is refused against the registry", async () => {
    const root = withRules(["rules/a.json", "rules/b.json"], {
      "rules/a.json": rulesFile([forbidDerived]),
      "rules/b.json": rulesFile([{ ...safetyBySafety, id: forbidDerived.id }]),
    });
    assert.deepEqual(unusable(await readProjectProfiles(root)), ["registry/duplicate-rule-identifier in .pi-outpost/structured-exchange.json at /rules/1"]);
  });

  test("an edited rules file applies to the next read, with nothing restarted", async () => {
    // AnEditedRulesFileAppliesToTheNextCheck, at the reading level
    const root = withRules(["rules/arp.json"], { "rules/arp.json": rulesFile([forbidDerived, safetyBySafety]) });
    const first = await readProjectProfiles(root);
    assert.ok(first.state === "usable");
    assert.equal(first.context.rules?.get("acme/requirements")?.length, 2);
    writeFileSync(path.join(root, "rules/arp.json"), JSON.stringify(rulesFile([safetyBySafety])));
    const second = await readProjectProfiles(root);
    assert.ok(second.state === "usable");
    assert.deepEqual(second.context.rules?.get("acme/requirements")?.map((rule) => rule.id), ["SAF-satisfied-by-safety"]);
  });
});
