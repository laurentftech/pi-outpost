/**
 * The enriched schema, against the code that mirrors it and the copies that ship.
 *
 * Three ways the contract can quietly stop being one document. The ceilings are
 * restated in TypeScript so code can name a limit without re-reading the schema,
 * and a restatement drifts. A collection or string added later without a bound
 * would ship unbounded, which is how a size ceiling becomes advisory. And the
 * schema is distributed — a producer reads its copy, not ours — so a copy that
 * lags is a contract that says two things at once.
 *
 * None of these fail loudly on their own: each shows up as a producer whose
 * document is accepted here and refused there, or the reverse.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { Compile } from "typebox/compile";
import {
  STRUCTURED_EXCHANGE_CEILINGS,
  STRUCTURED_EXCHANGE_CEILINGS_2,
  STRUCTURED_EXCHANGE_SCHEMA_V2,
} from "@pi-outpost/shared/structured-exchange";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SOURCE = path.join(ROOT, "shared/schemas/structured-exchange-2.json");

/* eslint-disable @typescript-eslint/no-explicit-any */
const schema = JSON.parse(readFileSync(SOURCE, "utf8")) as any;
const defs = schema.$defs;
const variants = schema.properties.data.oneOf;
const tableVariant = variants.find((variant: any) => variant.properties.rows !== undefined);
const rowVariants = tableVariant.properties.rows.items.oneOf;
const dataRow = defs.dataRow;
const structuralRow = defs.structuralRow;

describe("the enriched schema", () => {
  test("declares the identifier the code dispatches on", () => {
    assert.equal(schema.$id, STRUCTURED_EXCHANGE_SCHEMA_V2);
    assert.equal(schema.properties.schema.const, STRUCTURED_EXCHANGE_SCHEMA_V2);
  });

  test("requires no more of a document than version 1 did", () => {
    assert.deepEqual(schema.required, ["schema", "kind", "data"]);
  });

  test("carries version 1's whole vocabulary", () => {
    // Not a formality: a version 2 that lost containers or row roles would be a
    // narrower contract wearing a higher number, and the documents it refused
    // would be ones its predecessor accepted.
    for (const variant of variants) {
      if (variant.properties.nodes || variant.properties.participants) {
        assert.ok(variant.properties.containers, "a grouping variant lost its containers");
      }
    }
    assert.ok(defs.container, "containers are gone");
    assert.ok(defs.removal, "removals are gone");
    assert.ok(defs.elementChange.properties.label, "element patches are gone");
    assert.deepEqual(defs.role.enum, ["added", "changed", "context", "removed"]);
    assert.deepEqual(dataRow.properties.role, { $ref: "#/$defs/role" });
    // And the bare array of cells still is a row, so the simplest table is unchanged.
    assert.ok(rowVariants.some((variant: any) => variant.$ref === "#/$defs/cells"));
  });

  test("keeps every version 1 ceiling at the number producers were given", () => {
    const graphVariant = variants.find((variant: any) => variant.properties.nodes !== undefined);
    const sequenceVariant = variants.find((variant: any) => variant.properties.participants !== undefined);
    const pairs: [keyof typeof STRUCTURED_EXCHANGE_CEILINGS, unknown][] = [
      ["nodes", graphVariant.properties.nodes.maxItems],
      ["edges", graphVariant.properties.edges.maxItems],
      ["participants", sequenceVariant.properties.participants.maxItems],
      ["messages", sequenceVariant.properties.messages.maxItems],
      ["columns", tableVariant.properties.columns.maxItems],
      ["rows", tableVariant.properties.rows.maxItems],
      ["removals", schema.properties.removals.maxItems],
      ["ref", defs.ref.maxLength],
      ["localId", defs.localId.maxLength],
      ["label", defs.label.maxLength],
      ["kind", defs.kind.maxLength],
      ["cell", defs.cells.items.maxLength],
      ["columnName", tableVariant.properties.columns.items.maxLength],
    ];
    for (const [name, declared] of pairs) {
      assert.equal(STRUCTURED_EXCHANGE_CEILINGS[name], declared, `${name} moved between versions`);
    }
  });

  describe("the enriched ceilings are mirrored, not restated from memory", () => {
    const pairs: [keyof typeof STRUCTURED_EXCHANGE_CEILINGS_2, unknown][] = [
      ["profile", schema.properties.profile.maxLength],
      ["attributesPerItem", defs.attributes.maxProperties],
      ["attributeName", defs.attributes.propertyNames.maxLength],
      ["attributeString", defs.attributeScalar.maxLength],
      ["attributeListItems", defs.attributeValue.oneOf[2].maxItems],
      ["removeAttributesPerItem", defs.removeAttributes.maxItems],
      ["revision", defs.revision.maxLength],
      ["locationsPerItem", defs.locations.maxItems],
      ["uri", defs.location.properties.uri.maxLength],
      ["position", defs.position.maximum],
      ["artifactsPerItem", defs.artifacts.maxItems],
      ["artifactsPerDocument", schema.properties.artifacts.maxItems],
      ["artifactRel", defs.artifact.properties.rel.maxLength],
      ["artifactMediaType", defs.artifact.properties.mediaType.maxLength],
      ["artifactLabel", defs.label.maxLength],
      ["relations", tableVariant.properties.relations.maxItems],
      ["heading", structuralRow.properties.heading.maxLength],
      ["headingDepth", structuralRow.properties.depth.maximum],
    ];
    for (const [name, declared] of pairs) {
      test(`${name}`, () => {
        assert.equal(STRUCTURED_EXCHANGE_CEILINGS_2[name], declared, `${name} ceiling drifted from the schema`);
      });
    }

    test("the digest ceiling is the length the pattern can produce", () => {
      const pattern = defs.artifact.properties.sha256.pattern as string;
      assert.equal(pattern, "^sha256:[0-9a-f]{64}$");
      assert.equal(STRUCTURED_EXCHANGE_CEILINGS_2.artifactDigest, "sha256:".length + 64);
    });
  });

  test("bounds every collection and string it declares", () => {
    const unbounded: string[] = [];
    const walk = (node: unknown, at: string) => {
      if (node === null || typeof node !== "object") return;
      const it = node as Record<string, unknown>;
      if (it.type === "array" && it.maxItems === undefined) unbounded.push(`${at} (array)`);
      if (
        it.type === "string" &&
        it.maxLength === undefined &&
        it.const === undefined &&
        it.enum === undefined &&
        it.pattern === undefined
      ) {
        unbounded.push(`${at} (string)`);
      }
      for (const [key, value] of Object.entries(it)) walk(value, `${at}/${key}`);
    };
    walk(schema, "#");
    assert.deepEqual(unbounded, [], `unbounded: ${unbounded.join(", ")}`);
  });

  test("an attribute value cannot nest another list", () => {
    // The bound on the document is only meaningful while a value's depth is, and
    // generic rendering has to terminate without knowing the vocabulary.
    const listVariant = defs.attributeValue.oneOf[2];
    for (const inner of listVariant.items.oneOf) {
      assert.ok(inner.$ref !== "#/$defs/attributeValue", "a list may hold another list");
      assert.notEqual(inner.type, "array");
    }
  });

  test("a relation names each end explicitly", () => {
    assert.deepEqual(defs.endpoint.oneOf, [{ required: ["id"] }, { required: ["ref"] }]);
    assert.equal(defs.endpoint.maxProperties, 1);
    assert.deepEqual(defs.relation.required, ["from", "to", "kind"]);
  });

  test("an artifact names bytes and never carries them", () => {
    // Payloads stay outside the envelope, which is what keeps the document
    // ceilings meaningful and the rendering surface small. An inline one would
    // also be bytes nobody could verify against the digest beside it.
    assert.deepEqual(defs.artifact.required, ["rel", "uri", "sha256"]);
    assert.equal(defs.artifact.additionalProperties, false);
    for (const carrier of ["content", "data", "bytes", "payload", "base64"]) {
      assert.equal(defs.artifact.properties[carrier], undefined, `an artifact may carry ${carrier}`);
    }
    const compiled = Compile(schema);
    const withPayload = {
      schema: STRUCTURED_EXCHANGE_SCHEMA_V2,
      kind: "table",
      data: {
        columns: ["a"],
        rows: [{ cells: ["x"], artifacts: [{ rel: "r", uri: "u", sha256: `sha256:${"a".repeat(64)}`, content: "aGVsbG8=" }] }],
      },
    };
    assert.ok([...compiled.Errors(withPayload)].length > 0, "an inline payload was accepted");
  });

  test("a heading is a row of its own, never data wearing a heading", () => {
    assert.deepEqual(structuralRow.required, ["heading"]);
    assert.equal(structuralRow.properties.cells, undefined);
    assert.equal(structuralRow.additionalProperties, false);
    assert.equal(dataRow.properties.heading, undefined);
  });
});

describe("the distributed copies are the same document", () => {
  // A producer validates against the copy it was given. Two copies that differ are
  // two contracts, and the one that loses is whichever the producer did not read.
  for (const version of ["1", "2"] as const) {
    test(`version ${version} in skills/ matches shared/schemas`, () => {
      const source = readFileSync(path.join(ROOT, `shared/schemas/structured-exchange-${version}.json`), "utf8");
      const shipped = readFileSync(
        path.join(ROOT, `skills/structured-exchange/structured-exchange-${version}.json`),
        "utf8",
      );
      assert.equal(shipped, source, `the copy shipped with the skill has drifted from the schema`);
    });
  }
});

describe("the enriched schema accepts what version 1 accepted", () => {
  const compiled = Compile(schema);
  const SUITE = path.join(ROOT, "shared/conformance");
  const index = JSON.parse(readFileSync(path.join(SUITE, "index.json"), "utf8")) as { valid: { file: string }[] };

  for (const { file } of index.valid) {
    test(`${file}, with only its identifier changed`, () => {
      const document = JSON.parse(readFileSync(path.join(SUITE, file), "utf8")) as Record<string, unknown>;
      if (document.schema !== "urn:structured-exchange:1") return;
      const enriched: Record<string, unknown> = { ...document, schema: STRUCTURED_EXCHANGE_SCHEMA_V2 };
      // The one shape that deliberately changed: a target is an object, so that a
      // proposal can name the revision it was prepared against.
      if (typeof enriched.target === "string") enriched.target = { ref: enriched.target };
      const errors = [...compiled.Errors(enriched)].map((issue) => `${issue.path} ${issue.message}`);
      assert.deepEqual(errors, [], `refused under the enriched contract: ${errors.join(", ")}`);
    });
  }
});
