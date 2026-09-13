/**
 * What a reader is told about a presented document and its project's profile.
 *
 * Established from the project's files each time a document is shown, so these tests
 * change the files between two statements and check the statement follows — the
 * property that makes a restored proposal say "no longer conforms" when it no longer
 * does.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { structuredConformanceFor } from "../src/structuredExchangeProfiles.ts";
import { realResolve } from "../src/sandbox.ts";

const profile = (statuses: string[]) => ({
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "status", type: "enumeration", values: statuses, closed: true, required: true },
        { name: "priority", type: "enumeration", values: ["must", "should"], closed: false },
      ],
    },
  ],
});

const table = (attributes: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: "urn:structured-exchange:2",
    kind: "table",
    profile: "acme/requirements",
    ...over,
    data: { columns: ["id"], rows: [{ id: "r1", kind: "requirement", cells: ["R1"], attributes }] },
  });

describe("the conformance statement", () => {
  let root: string;

  const writeProfile = (statuses: string[]) => writeFileSync(path.join(root, "profiles/requirements.json"), JSON.stringify(profile(statuses)));
  const writeRegistry = (value: unknown) => writeFileSync(path.join(root, ".pi-outpost/structured-exchange.json"), typeof value === "string" ? value : JSON.stringify(value));
  const registry = { schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"] };

  before(async () => {
    root = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-conformance-")));
    mkdirSync(path.join(root, "profiles"), { recursive: true });
    mkdirSync(path.join(root, ".pi-outpost"), { recursive: true });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("a conforming document says so, counting values outside open enumerations", async () => {
    // AConformingDocumentSaysSo, OpenEnumerationValuesAreCounted, at the server
    writeRegistry(registry);
    writeProfile(["draft", "approved"]);
    const statements = await structuredConformanceFor(root, [
      { toolCallId: "a", structured: table({ status: "approved" }) },
      { toolCallId: "b", structured: table({ status: "approved", priority: "urgent" }) },
    ]);
    assert.deepEqual(statements, [
      { toolCallId: "a", conformance: { profile: "acme/requirements", state: "conforms", openValues: 0 } },
      { toolCallId: "b", conformance: { profile: "acme/requirements", state: "conforms", openValues: 1 } },
    ]);
  });

  test("a document that conformed says it no longer does once the profile is tightened", async () => {
    // ARestoredDocumentIsCheckedAgainstTheProfileAsItIsNow, at the server
    writeRegistry(registry);
    writeProfile(["draft", "approved", "in review"]);
    const document = [{ toolCallId: "p", structured: table({ status: "in review" }) }];
    assert.equal((await structuredConformanceFor(root, document))[0].conformance.state, "conforms");
    writeProfile(["draft", "approved"]);
    assert.deepEqual(await structuredConformanceFor(root, document), [
      { toolCallId: "p", conformance: { profile: "acme/requirements", state: "strays", openValues: 0 } },
    ]);
  });

  test("findings to check are counted beside a conforming verdict", async () => {
    // FindingsToCheckAreCounted, at the server
    writeProfile(["draft", "approved"]);
    writeFileSync(
      path.join(root, "rules.json"),
      JSON.stringify({
        schema: "urn:structured-exchange-rules:1",
        profile: "acme/requirements",
        rules: [
          // Violated by the document below: approved but only "should".
          { id: "R-approved-must", statement: "Approved requirements are musts.", level: "report", element: "requirement", when: { status: ["approved"] }, then: { priority: ["must"] } },
          // Not verifiable: the relation leaves the document.
          { id: "R-derives-from-approved", statement: "Derive only from approved requirements.", level: "refuse", relationship: "derives", when: {}, then: { to: { status: ["approved"] } } },
        ],
      }),
    );
    const profileWithRelations = { ...profile(["draft", "approved"]), relationshipKinds: [{ kind: "derives" }] };
    writeFileSync(path.join(root, "profiles/requirements.json"), JSON.stringify(profileWithRelations));
    writeRegistry({ ...registry, rules: ["rules.json"] });
    const document = JSON.stringify({
      schema: "urn:structured-exchange:2",
      kind: "table",
      profile: "acme/requirements",
      data: {
        columns: ["id"],
        rows: [{ id: "r1", kind: "requirement", cells: ["R1"], attributes: { status: "approved", priority: "should" } }],
        relations: [{ from: { id: "r1" }, to: { ref: "REQ-99" }, kind: "derives" }],
      },
    });
    assert.deepEqual(await structuredConformanceFor(root, [{ toolCallId: "f", structured: document }]), [
      { toolCallId: "f", conformance: { profile: "acme/requirements", state: "conforms", openValues: 0, findings: 2 } },
    ]);
    writeRegistry(registry);
  });

  test("an unusable registry says the document could not be checked", async () => {
    writeRegistry("{ not json");
    assert.deepEqual(await structuredConformanceFor(root, [{ toolCallId: "u", structured: table({ status: "approved" }) }]), [
      { toolCallId: "u", conformance: { profile: "acme/requirements", state: "unchecked", openValues: 0 } },
    ]);
  });

  test("a document held to no profile carries no statement", async () => {
    // ADocumentNotHeldToAProfileCarriesNoStatement, at the server
    writeRegistry(registry);
    writeProfile(["draft", "approved"]);
    const unnamed = JSON.stringify({ schema: "urn:structured-exchange:1", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } });
    assert.deepEqual(await structuredConformanceFor(root, [{ toolCallId: "n", structured: unnamed }]), []);

    const bare = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-conformance-bare-")));
    try {
      assert.deepEqual(await structuredConformanceFor(bare, [{ toolCallId: "x", structured: table({ status: "approved" }) }]), []);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test("a stored document that no longer passes the core contract carries no statement", async () => {
    writeRegistry(registry);
    writeProfile(["draft", "approved"]);
    assert.deepEqual(await structuredConformanceFor(root, [{ toolCallId: "c", structured: "{\"schema\":\"urn:structured-exchange:2\"}" }]), []);
  });
});
