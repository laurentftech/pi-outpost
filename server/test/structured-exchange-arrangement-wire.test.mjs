/**
 * A graph's arrangement kept from the browser (structured-exchange-arrangement,
 * AMovedBoxIsKeptInTheArrangement): written beside its document, created when missing, never
 * the document itself, refused unless it is an arrangement, and refused in a read-only sandbox.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const DOCUMENT = JSON.stringify({
  schema: "urn:structured-exchange:1",
  kind: "graph",
  data: { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b", kind: "k" }] },
});
const arrangement = (x) =>
  `${JSON.stringify({ format: "pi-outpost/structured-exchange-arrangement-1", views: { "": { elements: { "id:a": { x, y: 40 } }, relationships: {} } } }, null, 2)}\n`;

test("an arrangement is kept beside its document, created then rewritten, and the document is left alone", async (t) => {
  const root = await makeWorkspace({ "models/car.json": DOCUMENT });
  const server = await startServer(root, { sandbox: false });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello");

  client.send({ type: "save_arrangement", documentPath: "models/car.json", content: arrangement(40), requestId: "a-1" });
  const saved = await client.waitFor((message) => message.requestId === "a-1");
  assert.deepEqual(saved, { type: "arrangement_saved", requestId: "a-1", path: "models/car.arrangement.json" });
  assert.equal(await readFile(path.join(root, "models", "car.arrangement.json"), "utf8"), arrangement(40));

  client.send({ type: "save_arrangement", documentPath: "models/car.json", content: arrangement(120), requestId: "a-2" });
  assert.equal((await client.waitFor((message) => message.requestId === "a-2")).type, "arrangement_saved");
  assert.equal(await readFile(path.join(root, "models", "car.arrangement.json"), "utf8"), arrangement(120));
  assert.equal(await readFile(path.join(root, "models", "car.json"), "utf8"), DOCUMENT);
});

test("content that is not an arrangement is refused, and nothing is written", async (t) => {
  const root = await makeWorkspace({ "car.json": DOCUMENT });
  const server = await startServer(root, { sandbox: false });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello");

  client.send({ type: "save_arrangement", documentPath: "car.json", content: DOCUMENT, requestId: "bad" });
  const refused = await client.waitFor((message) => message.requestId === "bad");
  assert.equal(refused.type, "file_browser_error");
  assert.equal(refused.reason, "invalid");
  assert.match(refused.message, /^Not an arrangement: it does not declare "format"/);
  await assert.rejects(readFile(path.join(root, "car.arrangement.json"), "utf8"));
});

test("a read-only sandbox says it cannot keep the arrangement", async (t) => {
  const root = await makeWorkspace({ "car.json": DOCUMENT });
  const server = await startServer(root, { sandbox: { root, allowWrite: false, allowBash: false } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello");

  client.send({ type: "save_arrangement", documentPath: "car.json", content: arrangement(40), requestId: "ro" });
  const refused = await client.waitFor((message) => message.requestId === "ro");
  assert.equal(refused.type, "file_browser_error");
  assert.equal(refused.reason, "denied");
  await assert.rejects(readFile(path.join(root, "car.arrangement.json"), "utf8"));
});

test("two arrangements kept at once both answer, and the last one is on disk", async (t) => {
  const root = await makeWorkspace({ "car.json": DOCUMENT });
  const server = await startServer(root, { sandbox: false });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello");

  client.send({ type: "save_arrangement", documentPath: "car.json", content: arrangement(40), requestId: "p-1" });
  client.send({ type: "save_arrangement", documentPath: "car.json", content: arrangement(80), requestId: "p-2" });
  const first = await client.waitFor((message) => message.requestId === "p-1", 5_000);
  const second = await client.waitFor((message) => message.requestId === "p-2", 5_000);
  assert.equal(first.type, "arrangement_saved", JSON.stringify(first));
  assert.equal(second.type, "arrangement_saved", JSON.stringify(second));
  // Still answering afterwards
  client.send({ type: "save_arrangement", documentPath: "car.json", content: arrangement(120), requestId: "p-3" });
  assert.equal((await client.waitFor((message) => message.requestId === "p-3", 5_000)).type, "arrangement_saved");
  assert.equal(await readFile(path.join(root, "car.arrangement.json"), "utf8"), arrangement(120));
});
