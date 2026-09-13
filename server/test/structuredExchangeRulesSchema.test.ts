/**
 * The rules schema, against the code that mirrors it and the design's examples.
 *
 * The rules a reviewer writes are copied from the examples first, so an example the
 * schema refuses teaches a format nobody enforces; and a ceiling restated in code that
 * drifts from the schema tells a rules author two stories.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { Compile } from "typebox/compile";
import {
  STRUCTURED_EXCHANGE_PROFILE_CEILINGS,
  STRUCTURED_EXCHANGE_RULES_CEILINGS,
  STRUCTURED_EXCHANGE_RULES_SCHEMA_V1,
} from "@pi-outpost/shared/structured-exchange/profile";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* eslint-disable @typescript-eslint/no-explicit-any */
const rulesSchema: any = JSON.parse(readFileSync(path.join(ROOT, "shared/schemas/structured-exchange-rules-1.json"), "utf8"));
const registrySchema: any = JSON.parse(
  readFileSync(path.join(ROOT, "shared/schemas/structured-exchange-profile-registry-1.json"), "utf8"),
);

/** The design's example rules file (D2), verbatim. */
const exampleRules = {
  schema: "urn:structured-exchange-rules:1",
  profile: "acme/requirements",
  rules: [
    {
      id: "ARP4754A-derived-no-satisfy",
      source: "ARP4754A",
      statement: "Une exigence dérivée ne satisfait pas une exigence amont.",
      level: "refuse",
      relationship: "satisfies",
      when: { from: { category: ["derived"] } },
      then: "forbidden",
    },
    {
      id: "SAF-satisfied-by-safety",
      statement: "Une exigence safety n'est satisfaite que par des exigences safety.",
      level: "refuse",
      relationship: "satisfies",
      when: { to: { safety: ["yes"] } },
      then: { from: { safety: ["yes"] } },
    },
    {
      id: "CAT-derived-verification",
      statement: "Une exigence dérivée se vérifie par analyse ou revue.",
      level: "report",
      element: "requirement",
      when: { category: ["derived"] },
      then: { verification: ["analysis", "review"] },
    },
  ],
};

/** The design's example registry (D1), verbatim. */
const exampleRegistry = {
  schema: "urn:structured-exchange-profile-registry:1",
  profiles: ["profiles/requirements.json"],
  rules: ["rules/arp4754a.json", "rules/safety.json"],
  default: "acme/requirements",
};

describe("the rules schema", () => {
  const check = Compile(rulesSchema);

  test("declares the identifier the code dispatches on", () => {
    assert.equal(rulesSchema.$id, STRUCTURED_EXCHANGE_RULES_SCHEMA_V1);
    assert.equal(rulesSchema.properties.schema.const, STRUCTURED_EXCHANGE_RULES_SCHEMA_V1);
  });

  test("accepts the design's example rules", () => {
    assert.deepEqual([...check.Errors(exampleRules)], []);
  });

  test("refuses a rule without a statement or a level, and a level it does not know", () => {
    const { statement: _statement, ...withoutStatement } = exampleRules.rules[0];
    assert.equal(check.Check({ ...exampleRules, rules: [withoutStatement] }), false);
    assert.equal(check.Check({ ...exampleRules, rules: [{ ...exampleRules.rules[0], level: "warn" }] }), false);
  });

  describe("its ceilings are mirrored, not restated from memory", () => {
    const rule = rulesSchema.$defs.rule.properties;
    const pairs: [keyof typeof STRUCTURED_EXCHANGE_RULES_CEILINGS, unknown][] = [
      ["rulesPerFile", rulesSchema.properties.rules.maxItems],
      ["ruleId", rule.id.maxLength],
      ["statement", rule.statement.maxLength],
      ["source", rule.source.maxLength],
      ["kind", rule.element.maxLength],
      ["kind", rule.relationship.maxLength],
      ["conditionsPerSet", rulesSchema.$defs.conditions.maxProperties],
      ["conditionsPerSet", rulesSchema.$defs.clause.maxProperties],
      ["valuesPerCondition", rulesSchema.$defs.values.maxItems],
      ["value", rulesSchema.$defs.value.maxLength],
      ["attributeName", rulesSchema.$defs.conditions.propertyNames.maxLength],
    ];
    for (const [name, declared] of pairs) {
      test(`${name}`, () => assert.equal(STRUCTURED_EXCHANGE_RULES_CEILINGS[name], declared, `${name} drifted from the schema`));
    }
  });

  test("borrows the profile's magnitudes where one fits", () => {
    assert.equal(STRUCTURED_EXCHANGE_RULES_CEILINGS.valuesPerCondition, STRUCTURED_EXCHANGE_PROFILE_CEILINGS.enumerationValues);
    assert.equal(STRUCTURED_EXCHANGE_RULES_CEILINGS.value, STRUCTURED_EXCHANGE_PROFILE_CEILINGS.enumerationValue);
    assert.equal(STRUCTURED_EXCHANGE_RULES_CEILINGS.attributeName, STRUCTURED_EXCHANGE_PROFILE_CEILINGS.attributeName);
    assert.equal(STRUCTURED_EXCHANGE_RULES_CEILINGS.rulesBytes, STRUCTURED_EXCHANGE_PROFILE_CEILINGS.profileBytes);
  });

  test("bounds every collection, string and object it declares", () => {
    const unbounded: string[] = [];
    const walk = (node: any, where: string) => {
      if (node === null || typeof node !== "object") return;
      if (node.type === "string" && node.maxLength === undefined) unbounded.push(where);
      if (node.type === "array" && node.maxItems === undefined) unbounded.push(where);
      if (node.type === "object" && node.additionalProperties !== false && node.maxProperties === undefined) unbounded.push(where);
      for (const [key, child] of Object.entries(node)) walk(child, `${where}/${key}`);
    };
    walk(rulesSchema, "");
    assert.deepEqual(unbounded, []);
  });
});

describe("the copy shipped with the skill is the same document", () => {
  test("structured-exchange-rules-1.json in skills/ matches shared/schemas", () => {
    const source = readFileSync(path.join(ROOT, "shared/schemas/structured-exchange-rules-1.json"), "utf8");
    const shipped = readFileSync(path.join(ROOT, "skills/structured-exchange/structured-exchange-rules-1.json"), "utf8");
    assert.equal(shipped, source, "the copy shipped with the skill has drifted from the schema");
  });
});

describe("the registry schema, with rules", () => {
  const check = Compile(registrySchema);

  test("accepts the design's example registry listing rules files", () => {
    assert.deepEqual([...check.Errors(exampleRegistry)], []);
  });

  test("its rules ceilings are mirrored", () => {
    assert.equal(STRUCTURED_EXCHANGE_RULES_CEILINGS.rulesFilesPerRegistry, registrySchema.properties.rules.maxItems);
    assert.equal(STRUCTURED_EXCHANGE_PROFILE_CEILINGS.profilePath, registrySchema.properties.rules.items.maxLength);
  });
});
