/**
 * The profile and registry schemas, against the code that mirrors them.
 *
 * The same three quiet failures the document schemas are guarded against: a ceiling
 * restated in TypeScript that drifts from the schema, a collection or string added
 * without a bound, and an example in the design that the schema would refuse. A
 * profile is written by someone outside this repository against the published
 * schema, so a schema saying one thing and the checker another is a profile author
 * told two stories.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { Compile } from "typebox/compile";
import {
  STRUCTURED_EXCHANGE_PROFILE_CEILINGS,
  STRUCTURED_EXCHANGE_PROFILE_REGISTRY_SCHEMA_V1,
  STRUCTURED_EXCHANGE_PROFILE_SCHEMA_V1,
} from "@pi-outpost/shared/structured-exchange/profile";
import { STRUCTURED_EXCHANGE_CEILINGS, STRUCTURED_EXCHANGE_CEILINGS_2 } from "@pi-outpost/shared/structured-exchange";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* eslint-disable @typescript-eslint/no-explicit-any */
const profileSchema: any = JSON.parse(readFileSync(path.join(ROOT, "shared/schemas/structured-exchange-profile-1.json"), "utf8"));
const registrySchema: any = JSON.parse(
  readFileSync(path.join(ROOT, "shared/schemas/structured-exchange-profile-registry-1.json"), "utf8"),
);

/** The examples design.md gives, verbatim: a design whose own example is refused misleads everyone who reads it. */
const exampleProfile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements model",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "status", type: "enumeration", values: ["draft", "approved", "withdrawn"], closed: true, required: true },
        { name: "priority", type: "enumeration", values: ["must", "should", "could"], closed: false },
        { name: "owner", type: "string" },
        { name: "verifiedBy", type: "reference", list: true },
      ],
    },
  ],
  relationshipKinds: [{ kind: "derives" }, { kind: "satisfies" }],
  viewpoints: [{ id: "safety", label: "Safety", concern: "What is safety-relevant", elementKinds: ["requirement"] }],
};

const exampleRegistry = {
  schema: "urn:structured-exchange-profile-registry:1",
  profiles: ["profiles/requirements.json"],
  default: "acme/requirements",
};

describe("the profile schema", () => {
  const check = Compile(profileSchema);

  test("declares the identifier the code dispatches on", () => {
    assert.equal(profileSchema.$id, STRUCTURED_EXCHANGE_PROFILE_SCHEMA_V1);
    assert.equal(profileSchema.properties.schema.const, STRUCTURED_EXCHANGE_PROFILE_SCHEMA_V1);
  });

  test("accepts the design's example profile", () => {
    assert.deepEqual([...check.Errors(exampleProfile)], []);
  });

  test("refuses a field it does not define", () => {
    assert.equal(check.Check({ ...exampleProfile, extends: "acme/base" }), false);
  });

  test("offers only the attribute types the checker knows", () => {
    assert.deepEqual(profileSchema.$defs.attribute.properties.type.enum, ["string", "number", "boolean", "reference", "enumeration"]);
  });

  describe("its ceilings are mirrored, not restated from memory", () => {
    const attribute = profileSchema.$defs.attribute.properties;
    const pairs: [keyof typeof STRUCTURED_EXCHANGE_PROFILE_CEILINGS, unknown][] = [
      ["id", profileSchema.properties.id.maxLength],
      ["label", profileSchema.properties.label.maxLength],
      ["description", profileSchema.properties.description.maxLength],
      ["kindsPerVocabulary", profileSchema.properties.elementKinds.maxItems],
      ["kindsPerVocabulary", profileSchema.properties.relationshipKinds.maxItems],
      ["attributesPerKind", profileSchema.$defs.kindDeclaration.properties.attributes.maxItems],
      ["attributeName", attribute.name.maxLength],
      ["enumerationValues", attribute.values.maxItems],
      ["enumerationValue", attribute.values.items.maxLength],
      ["viewpoints", profileSchema.properties.viewpoints.maxItems],
    ];
    for (const [name, declared] of pairs) {
      test(`${name}`, () => assert.equal(STRUCTURED_EXCHANGE_PROFILE_CEILINGS[name], declared, `${name} drifted from the schema`));
    }
  });

  test("borrows the document contract's magnitudes where one fits", () => {
    const ceilings = STRUCTURED_EXCHANGE_PROFILE_CEILINGS;
    assert.equal(ceilings.id, STRUCTURED_EXCHANGE_CEILINGS_2.profile);
    assert.equal(ceilings.kindsPerVocabulary, STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary);
    assert.equal(ceilings.attributesPerKind, STRUCTURED_EXCHANGE_CEILINGS_2.attributesPerItem);
    assert.equal(ceilings.attributeName, STRUCTURED_EXCHANGE_CEILINGS_2.attributeName);
    assert.equal(ceilings.enumerationValue, STRUCTURED_EXCHANGE_CEILINGS_2.attributeString);
    assert.equal(ceilings.viewpoints, STRUCTURED_EXCHANGE_CEILINGS_2.viewpoints);
    assert.equal(profileSchema.$defs.kindName.maxLength, STRUCTURED_EXCHANGE_CEILINGS.kind);
  });
});

describe("the registry schema", () => {
  const check = Compile(registrySchema);

  test("declares the identifier the code dispatches on", () => {
    assert.equal(registrySchema.$id, STRUCTURED_EXCHANGE_PROFILE_REGISTRY_SCHEMA_V1);
    assert.equal(registrySchema.properties.schema.const, STRUCTURED_EXCHANGE_PROFILE_REGISTRY_SCHEMA_V1);
  });

  test("accepts the design's example registry", () => {
    assert.deepEqual([...check.Errors(exampleRegistry)], []);
  });

  test("its ceilings are mirrored", () => {
    assert.equal(STRUCTURED_EXCHANGE_PROFILE_CEILINGS.profilesPerRegistry, registrySchema.properties.profiles.maxItems);
    assert.equal(STRUCTURED_EXCHANGE_PROFILE_CEILINGS.profilePath, registrySchema.properties.profiles.items.maxLength);
    assert.equal(STRUCTURED_EXCHANGE_PROFILE_CEILINGS.id, registrySchema.properties.default.maxLength);
  });
});

describe("both bound every collection and string they declare", () => {
  /** Walks a schema and names every string without maxLength and array without maxItems. */
  function unbounded(node: any, where: string, found: string[]): string[] {
    if (node === null || typeof node !== "object") return found;
    if (node.type === "string" && node.maxLength === undefined) found.push(where);
    if (node.type === "array" && node.maxItems === undefined) found.push(where);
    for (const [key, child] of Object.entries(node)) unbounded(child, `${where}/${key}`, found);
    return found;
  }

  for (const [name, schema] of [
    ["profile", profileSchema],
    ["registry", registrySchema],
  ] as const) {
    test(name, () => assert.deepEqual(unbounded(schema, "", []), []));
  }
});
