/**
 * Reading a structured-exchange document over the socket.
 *
 * The reader's browser holds a schema check that answers yes or no and has no
 * reason to give — deliberately, it is 22 KB it does not otherwise need. So the
 * one place a reader can be told *what* is wrong with a document that claims the
 * contract is here, where the reference validator already runs. These tests are
 * about that: the diagnosis travels with the file, and it travels only when
 * there is one, so its presence means something.
 */
import assert from "node:assert/strict";
import { describe, test, before, after } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const S = "urn:structured-exchange:1";

describe("a structured-exchange document read over the socket", () => {
  let root;
  let server;
  let client;
  let counter = 0;

  const read = async (path) => {
    const requestId = `read-${++counter}`;
    client.send({ type: "read_file", path, requestId });
    return client.waitFor((message) => message.requestId === requestId, 20_000);
  };

  before(async () => {
    root = await makeWorkspace({
      "good.json": JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } }),
      // Declares the contract, and an element without an id does not meet it.
      "broken.json": JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{ label: "no id" }], edges: [] } }),
      // Shape-valid and not a graph: an edge pointing at nothing.
      "dangling.json": JSON.stringify({
        schema: S,
        kind: "graph",
        data: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "ghost" }] },
      }),
      "plain.json": JSON.stringify({ kind: "graph", data: { nodes: [{}], edges: [] } }),
      "future.json": JSON.stringify({ schema: "urn:structured-exchange:3", kind: "constellation" }),
      "notes.md": "# not json at all\n",
    });
    server = await startServer(root, { sandbox: { root, allowWrite: true, allowBash: false } });
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
  });

  test("a document that fails the schema it declares comes back with the reasons", async () => {
    const message = await read("broken.json");
    assert.equal(message.type, "file_content");
    assert.ok(Array.isArray(message.documentIssues), "no diagnosis travelled with the file");
    assert.ok(message.documentIssues.length > 0);
    for (const issue of message.documentIssues) {
      assert.equal(typeof issue.rule, "string");
      assert.equal(typeof issue.message, "string");
      assert.ok(issue.message.length > 0, `issue ${issue.rule} says nothing`);
    }
    // …and the file itself is still there to read, whatever is wrong with it.
    assert.ok(message.content.includes("no id"));
  });

  test("a relational failure the schema cannot express is diagnosed too", async () => {
    const message = await read("dangling.json");
    assert.ok(message.documentIssues?.length > 0, "a dangling endpoint went unreported");
  });

  test("a conforming document carries no diagnosis", async () => {
    // Absence is how "nothing is wrong" is said; a present-but-empty list would
    // make every reader check the length before believing it.
    const message = await read("good.json");
    assert.equal(message.type, "file_content");
    assert.equal(message.documentIssues, undefined);
  });

  test("JSON that declares nothing is not diagnosed against a contract it never claimed", async () => {
    const message = await read("plain.json");
    assert.equal(message.documentIssues, undefined);
  });

  test("a version the server does not implement is not diagnosed either", async () => {
    const message = await read("future.json");
    assert.equal(message.documentIssues, undefined);
  });

  test("an ordinary file is unaffected", async () => {
    const message = await read("notes.md");
    assert.equal(message.type, "file_content");
    assert.equal(message.documentIssues, undefined);
    assert.equal(message.content, "# not json at all\n");
  });
});
