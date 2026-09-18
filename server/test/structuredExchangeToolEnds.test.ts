/**
 * The agent's tools, in a project whose profile says which element kinds a relationship
 * joins.
 *
 * Driven through the tools as the agent calls them, against a project on disk: the text
 * the agent reads back and whether anything reached the interface are the whole contract.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createStructuredExchangeToolDefinition } from "../src/structuredExchangeTool.ts";
import { realResolve } from "../src/sandbox.ts";

type ToolResult = { content: { text: string }[]; details?: unknown; isError?: boolean };

const profile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [{ kind: "requirement" }, { kind: "test" }],
  relationshipKinds: [{ kind: "verifies", from: ["test"], to: ["requirement"] }],
};

const graph = (edges: unknown[], nodes: unknown[] = [{ id: "r1", label: "Stop", kind: "requirement" }, { id: "r2", label: "Hold", kind: "requirement" }, { id: "t1", label: "Bench", kind: "test" }]) => ({
  schema: "urn:structured-exchange:2",
  kind: "graph",
  profile: "acme/requirements",
  data: { nodes, edges },
});

describe("the agent's tools with a profile declaring relationship ends", () => {
  let root: string;

  const present = (document: unknown) =>
    (createStructuredExchangeToolDefinition({ projectRoot: root }).execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)(
      "call-1",
      { document: JSON.stringify(document), summary: "Requirements and their tests." },
    );

  before(async () => {
    root = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-tool-ends-")));
    mkdirSync(path.join(root, ".pi-outpost"), { recursive: true });
    writeFileSync(path.join(root, "profile.json"), JSON.stringify(profile));
    writeFileSync(
      path.join(root, ".pi-outpost/structured-exchange.json"),
      JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["profile.json"] }),
    );
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("a relationship between kinds its ends do not allow is refused, and the agent is told to ask rather than pick", async () => {
    // ARelationshipBetweenKindsItsEndsDoNotAllowIsRefused
    const result = await present(graph([{ from: "r1", to: "r2", kind: "verifies" }]));
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined, "a refused document is not presented");
    const text = result.content[0].text;
    assert.match(text, /refused by this project's profile "acme\/requirements"/);
    assert.match(text, /profile\/end-kind at \/data\/edges\/0\/from: its source "r1" is a "requirement", and relationship kind "verifies" of profile "acme\/requirements" allows at its source only "test"/);
    assert.match(text, /do not replace it with an allowed one you have no grounds for: ask the user which value is true \(for a link, which kinds it really joins\), or whether the profile should change/);
  });

  test("a relationship between allowed kinds is presented", async () => {
    const result = await present(graph([{ from: "t1", to: "r1", kind: "verifies" }]));
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.ok(result.details !== undefined);
    assert.doesNotMatch(result.content[0].text, /Findings to check/);
  });

  test("an end outside the document is presented and listed to the agent as a finding to check", async () => {
    // AnEndOutsideTheDocumentIsAFindingToCheck
    const table = {
      schema: "urn:structured-exchange:2",
      kind: "table",
      profile: "acme/requirements",
      data: {
        columns: ["id"],
        rows: [{ id: "r1", kind: "requirement", cells: ["R1"] }],
        relations: [{ from: { ref: "TST-4" }, to: { id: "r1" }, kind: "verifies" }],
      },
    };
    const result = await present(table);
    assert.notEqual(result.isError, true, result.content[0].text);
    assert.ok(result.details !== undefined, "the document is presented");
    const text = result.content[0].text;
    assert.match(text, /conforms to this project's profile "acme\/requirements", with 1 finding to check/);
    assert.match(text, /- \/data\/relations\/0\/from \(relationship end not verifiable here\): .*"TST-4" is not in this document/);
    assert.match(text, /add it with its kind and attributes if you have it/);
  });
});
