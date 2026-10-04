/**
 * show_structure: any structured-exchange document, judged by pi-outpost's gate, shown
 * as pi-outpost draws it, and nothing stored.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { STRUCTURED_EXCHANGE_BYTES_CEILING_ANY } from "@pi-outpost/shared/structured-exchange/bounds";
import { SECRET, filesUnder, mintToken, testApp } from "./helpers.ts";

const CONFORMANCE = fileURLToPath(new URL("../../shared/conformance/", import.meta.url));
const fixture = async (name: string) => JSON.parse(await fs.readFile(path.join(CONFORMANCE, name), "utf8"));
const fixtureText = (name: string) => fs.readFile(path.join(CONFORMANCE, name), "utf8");

/** The document an embed carries, inflated from the page. */
function embedded(html: string): { mode: string; envelope: unknown } {
  const match = /data-planning="([A-Za-z0-9+/=]*)"/.exec(html);
  assert.ok(match, "an embed payload");
  return JSON.parse(gunzipSync(Buffer.from(match[1]!, "base64")).toString("utf8"));
}

function assertEmbeds(response: { statusCode: number; headers: Record<string, unknown>; body: string }) {
  assert.equal(response.statusCode, 200, response.body.slice(0, 300));
  assert.match(String(response.headers["content-type"]), /^text\/html/);
  assert.equal(response.headers["content-disposition"], "inline");
  assert.ok(!response.body.includes("&"), "survives Open WebUI's storage");
}

// openlore: scenario=AGraphIsShown spec=openwebui-structured-exchange
// openlore: scenario=EveryKindIsShown spec=openwebui-structured-exchange
// openlore: scenario=AnEarlierVersionIsShown spec=openwebui-structured-exchange
test("every valid conformance document, of every version and kind, is shown", async (t) => {
  const { call } = await testApp(t);
  const names = (await fs.readdir(path.join(CONFORMANCE, "valid"))).filter((name) => name.endsWith(".json"));
  const kinds = new Set<string>();
  const versions = new Set<string>();
  for (const name of names) {
    const document = await fixture(`valid/${name}`);
    const response = await call("show_structure", { document });
    assertEmbeds(response);
    const payload = embedded(response.body);
    assert.equal(payload.mode, "structure", name);
    kinds.add(document.kind);
    versions.add(document.schema);
  }
  assert.deepEqual([...kinds].sort(), ["graph", "sequence", "table", "timeline"]);
  assert.equal(versions.size, 3, "versions 1, 2 and 3");
});

// openlore: scenario=ADocumentGivenAsAStringIsShown spec=openwebui-structured-exchange
test("ADocumentGivenAsAStringIsShown: the same embed as the object", async (t) => {
  const { call } = await testApp(t);
  const text = await fixtureText("valid/v2-graph-with-viewpoints.json");
  const asString = await call("show_structure", { document: text });
  const asObject = await call("show_structure", { document: JSON.parse(text) });
  assertEmbeds(asString);
  assert.deepEqual(embedded(asString.body), embedded(asObject.body));
});

// openlore: scenario=ADanglingRelationshipIsRefused spec=openwebui-structured-exchange
test("ADanglingRelationshipIsRefused: pi-outpost's diagnostics, nothing embedded", async (t) => {
  const { call } = await testApp(t);
  const text = await fixtureText("invalid/unresolved-endpoint.json");
  const response = await call("show_structure", { document: JSON.parse(text) });
  assert.equal(response.statusCode, 422);
  assert.doesNotMatch(response.body, /data-planning/);
  const expected = parseSerializedStructuredExchange(JSON.stringify(JSON.parse(text)), checkStructuredExchangeSchema);
  assert.equal(expected.valid, false);
  assert.deepEqual(response.json().issues, expected.issues);
  assert.match(response.json().error, /refused by the structured-exchange contract/);
});

// openlore: scenario=AChangeWithoutATargetIsRefused spec=openwebui-structured-exchange
test("AChangeWithoutATargetIsRefused: the contract's diagnostic", async (t) => {
  const { call } = await testApp(t);
  const document = await fixture("invalid/change-without-target.json");
  const response = await call("show_structure", { document });
  assert.equal(response.statusCode, 422);
  const expected = parseSerializedStructuredExchange(JSON.stringify(document), checkStructuredExchangeSchema);
  assert.deepEqual(response.json().issues, expected.valid ? [] : expected.issues);
  assert.ok(response.json().issues.length > 0);
});

// openlore: scenario=ADocumentTooLargeIsRefused spec=openwebui-structured-exchange
test("ADocumentTooLargeIsRefused: past the contract's ceiling, named, nothing embedded", async (t) => {
  const { call } = await testApp(t);
  const huge = {
    schema: "urn:structured-exchange:1",
    kind: "graph",
    data: { nodes: [{ id: "a", label: "x".repeat(STRUCTURED_EXCHANGE_BYTES_CEILING_ANY + 10) }], edges: [] },
  };
  const response = await call("show_structure", { document: huge });
  assert.equal(response.statusCode, 422, "refused by the contract, not by the HTTP layer");
  const issue = response.json().issues[0];
  assert.ok(typeof issue.limit === "number" && issue.limit > 0, "the ceiling is named");
  assert.doesNotMatch(response.body, /data-planning/);
});

test("no document, or one that is not JSON, is refused with a reason", async (t) => {
  const { call } = await testApp(t);
  assert.equal((await call("show_structure", {})).json().issues[0].rule, "document-required");
  assert.equal((await call("show_structure", { document: '{"schema": "urn:structured-exchange:1", ' })).json().issues[0].rule, "not-json");
});

// openlore: scenario=TheEmbeddedDocumentEqualsTheOneValidated spec=openwebui-structured-exchange
test("TheEmbeddedDocumentEqualsTheOneValidated: deep-equal, key order included", async (t) => {
  const { call } = await testApp(t);
  const text = await fixtureText("valid/graph-proposal-reattachment.json");
  const response = await call("show_structure", { document: text });
  assertEmbeds(response);
  const envelope = embedded(response.body).envelope;
  // Same fields, same values, same order: compare the serialisations, not just the values.
  assert.equal(JSON.stringify(envelope), JSON.stringify(JSON.parse(text)));
});

// openlore: scenario=ShowingWritesNothing spec=openwebui-structured-exchange
test("ShowingWritesNothing: valid or not, the data directory is untouched", async (t) => {
  const { call, config } = await testApp(t);
  for (const name of ["valid/graph-minimal.json", "valid/table-minimal.json", "invalid/unresolved-endpoint.json"]) {
    await call("show_structure", { document: await fixture(name) });
  }
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

// openlore: scenario=ShowingWithoutTheSecretIsRefused spec=openwebui-structured-exchange
test("ShowingWithoutTheSecretIsRefused: no bearer, or no identity, nothing embedded", async (t) => {
  const { app } = await testApp(t);
  const document = await fixture("valid/graph-minimal.json");
  for (const headers of [
    { "x-openwebui-user-jwt": mintToken("alice") },
    { authorization: "Bearer wrong", "x-openwebui-user-jwt": mintToken("alice") },
    { authorization: `Bearer ${SECRET}` },
    { authorization: `Bearer ${SECRET}`, "x-openwebui-user-jwt": mintToken("alice", { key: "other" }) },
  ]) {
    const response = await app.inject({ method: "POST", url: "/show_structure", headers, payload: { document } });
    assert.equal(response.statusCode, 401);
    assert.doesNotMatch(response.body, /data-planning/);
  }
});
