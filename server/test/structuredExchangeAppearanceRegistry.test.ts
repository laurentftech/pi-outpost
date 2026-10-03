/**
 * A project's kind colours, as its registry declares them.
 *
 * Registry version 2 adds one optional section and makes profiles optional; version 1
 * is untouched. A colour is either a colour or a fault that makes the registry
 * unusable, named at the colour — the same answer every other registry fault gets.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { validateRegistry } from "@pi-outpost/shared/structured-exchange/profile-validation";
import { readProjectAppearance, readProjectRegistry } from "@pi-outpost/shared/structured-exchange/project-registry";
import { realResolve } from "../src/sandbox.ts";
import { createStructuredExchangeToolDefinition } from "../src/structuredExchangeTool.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const V2 = "urn:structured-exchange-profile-registry:2";

const profile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [{ kind: "requirement" }],
  relationshipKinds: [{ kind: "verifies" }],
};

describe("registry version 2: appearance", () => {
  let base: string;
  let counter = 0;
  const project = (files: Record<string, unknown>): string => {
    const root = path.join(base, `project-${counter++}`);
    mkdirSync(root, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(root, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    }
    return root;
  };
  const registry = (body: Record<string, unknown>) => ({ ".pi-outpost/structured-exchange.json": { schema: V2, ...body } });

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-appearance-")));
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("AColourIsDeclaredForAKind", async () => {
    const root = project(registry({ appearance: { kinds: { SRR: { color: "#dc2626" } } } }));
    assert.deepEqual(await readProjectAppearance(root), { kinds: { SRR: { color: "#dc2626" } } });
  });

  test("AMalformedColourMakesTheRegistryUnusable", async () => {
    const root = project(registry({ appearance: { kinds: { SRR: { color: "red" } } } }));
    const read = await readProjectRegistry(root);
    assert.equal(read.state, "unusable");
    if (read.state !== "unusable") return;
    assert.deepEqual(
      read.issues.map((issue) => `${issue.rule} ${issue.file} ${issue.path}`),
      ["registry/appearance/color .pi-outpost/structured-exchange.json /appearance/kinds/SRR/color"],
    );
    assert.equal(await readProjectAppearance(root), null);
  });

  test("an unknown property beside a colour is refused at that property", () => {
    const verdict = validateRegistry({ schema: V2, appearance: { kinds: { SRR: { color: "#dc2626", dash: "4 2" } } } });
    assert.equal(verdict.valid, false);
    assert.deepEqual(
      verdict.issues.map((issue) => issue.path),
      ["/appearance/kinds/SRR/dash"],
    );
  });

  test("a map past its ceiling is refused", () => {
    const kinds = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`k${index}`, { color: "#000000" }]));
    const verdict = validateRegistry({ schema: V2, appearance: { kinds } });
    assert.equal(verdict.valid, false);
  });

  test("VocabulariesAreSeparate (as declared)", async () => {
    const root = project(registry({ appearance: { relationshipKinds: { power: { color: "#ea580c" } } } }));
    const appearance = await readProjectAppearance(root);
    assert.equal(appearance?.kinds?.power, undefined);
    assert.deepEqual(appearance?.relationshipKinds?.power, { color: "#ea580c" });
  });

  test("AVersionOneRegistryIsUnchanged", async () => {
    // Version 1 still requires profiles and refuses an appearance.
    assert.equal(validateRegistry({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["p.json"] }).valid, true);
    assert.equal(validateRegistry({ schema: "urn:structured-exchange-profile-registry:1" }).valid, false);
    assert.equal(
      validateRegistry({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["p.json"], appearance: {} }).valid,
      false,
    );
    const root = project({
      ".pi-outpost/structured-exchange.json": { schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/r.json"] },
      "profiles/r.json": profile,
    });
    const read = await readProjectRegistry(root);
    assert.equal(read.state, "usable");
    assert.equal(read.state === "usable" ? read.appearance : "-", undefined);
    assert.equal(await readProjectAppearance(root), null);
  });

  test("ARegistryWithOnlyAnAppearanceConstrainsNothing", async () => {
    const root = project(registry({ appearance: { kinds: { SRR: { color: "#dc2626" } } } }));
    const read = await readProjectRegistry(root);
    assert.equal(read.state, "usable");
    if (read.state !== "usable") return;
    assert.equal(read.context.profiles.size, 0);
    assert.equal(read.context.default, undefined);
  });

  test("ARegistryWithOnlyAnAppearanceConstrainsNothing (presenting)", async () => {
    const root = project(registry({ appearance: { kinds: { gadget: { color: "#dc2626" } } } }));
    const result = await (createStructuredExchangeToolDefinition({ projectRoot: root }).execute as unknown as (
      id: string,
      params: unknown,
    ) => Promise<{ isError?: boolean; content: { text: string }[]; details?: unknown }>)("call-1", {
      document: JSON.stringify({
        schema: "urn:structured-exchange:2",
        kind: "graph",
        data: { nodes: [{ id: "a", label: "A", kind: "anything-at-all", attributes: { free: "form" } }], edges: [] },
      }),
      summary: "A graph.",
    });
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.doesNotMatch(result.content[0].text, /profile/);
  });

  test("ADefaultNeedsARegisteredProfile", async () => {
    const root = project(registry({ default: "acme/requirements", appearance: { kinds: {} } }));
    const read = await readProjectRegistry(root);
    assert.equal(read.state, "unusable");
    if (read.state !== "unusable") return;
    assert.deepEqual(read.issues.map((issue) => `${issue.rule} ${issue.path}`), ["registry/unregistered-default /default"]);
    assert.match(read.issues[0].message, /registered: none/);
  });

  test("a version 2 registry with profiles and colours holds documents as version 1 did", async () => {
    const root = project({
      ...registry({ profiles: ["profiles/r.json"], default: "acme/requirements", appearance: { kinds: { requirement: { color: "#2563eb" } } } }),
      "profiles/r.json": profile,
    });
    const read = await readProjectRegistry(root);
    assert.equal(read.state, "usable");
    if (read.state !== "usable") return;
    assert.equal(read.context.default, "acme/requirements");
    assert.deepEqual(read.appearance, { kinds: { requirement: { color: "#2563eb" } } });
  });

  test("the schema bounds every string, array and map it declares", () => {
    const schema = JSON.parse(readFileSync(path.join(ROOT, "shared/schemas/structured-exchange-profile-registry-2.json"), "utf8"));
    const unbounded: string[] = [];
    const walk = (node: unknown, where: string) => {
      if (node === null || typeof node !== "object") return;
      const typed = node as Record<string, unknown>;
      if (typed.type === "string" && typed.maxLength === undefined && typed.pattern === undefined && typed.const === undefined) unbounded.push(where);
      if (typed.type === "array" && typed.maxItems === undefined) unbounded.push(where);
      if (typed.type === "object" && typed.additionalProperties !== false && typed.additionalProperties !== undefined && typed.maxProperties === undefined)
        unbounded.push(where);
      for (const [key, child] of Object.entries(typed)) walk(child, `${where}/${key}`);
    };
    walk(schema, "");
    assert.deepEqual(unbounded, []);
  });
});
