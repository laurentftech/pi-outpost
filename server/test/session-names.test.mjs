/**
 * Session naming and search, end to end. No model here: titles are generated from
 * a real turn (covered by the live suite) — what this suite pins down is the wiring
 * around them, i.e. renaming any saved session behind the path allowlist, and
 * finding a session by something said in the middle of its transcript.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

/** Seed a saved session in the same store the server reads (agentDir/sessions). */
function seedSession(root, exchanges) {
  const manager = SessionManager.create(root, path.join(root, ".pi-agent", "sessions"));
  for (const [role, text] of exchanges) {
    manager.appendMessage({ role, content: [{ type: "text", text }] });
  }
  return manager.getSessionFile();
}

describe("session names and search", () => {
  let root;
  let server;
  let client;
  let reconnectPath;
  let otherPath;

  before(async () => {
    root = await makeWorkspace();
    // The match lives only in the *reply*, halfway through — the whole point of
    // searching transcripts rather than the session list the client already has.
    reconnectPath = seedSession(root, [
      ["user", "look at the socket please"],
      ["assistant", "The websocket reconnect loop retried forever; capped the backoff."],
    ]);
    otherPath = seedSession(root, [
      ["user", "rename the theme tokens"],
      ["assistant", "Renamed them."],
    ]);
    server = await startServer(root);
    client = connect(server.wsUrl());
    await client.open();
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
  });

  /** The next `sessions` frame (rename broadcasts one, list_sessions answers with one). */
  async function sessions() {
    const seen = client.received.filter((m) => m.type === "sessions").length;
    return (
      await client.waitFor(
        (m) => m.type === "sessions" && client.received.filter((x) => x.type === "sessions").length > seen,
        15_000,
      )
    ).sessions;
  }

  async function search(query) {
    const requestId = `t${Math.random()}`;
    client.send({ type: "search_sessions", query, requestId });
    return (await client.waitFor((m) => m.type === "session_search_results" && m.requestId === requestId, 15_000))
      .sessions;
  }

  test("lists the seeded sessions", async () => {
    const pending = sessions();
    client.send({ type: "list_sessions" });
    const list = await pending;
    const paths = list.map((s) => s.path);
    assert.ok(paths.includes(reconnectPath));
    assert.ok(paths.includes(otherPath));
    assert.equal(list.find((s) => s.path === reconnectPath).name, undefined);
  });

  test("renames an idle session, and every client sees it", async () => {
    const pending = sessions();
    client.send({ type: "rename_session", path: reconnectPath, name: "Fix WebSocket reconnect loop" });
    const list = await pending;
    assert.equal(list.find((s) => s.path === reconnectPath).name, "Fix WebSocket reconnect loop");
  });

  test("the name survives a fresh listing", async () => {
    const pending = sessions();
    client.send({ type: "list_sessions" });
    const list = await pending;
    assert.equal(list.find((s) => s.path === reconnectPath).name, "Fix WebSocket reconnect loop");
  });

  test("an empty name clears it (back to the first message)", async () => {
    let pending = sessions();
    client.send({ type: "rename_session", path: otherPath, name: "Theme tokens" });
    let list = await pending;
    assert.equal(list.find((s) => s.path === otherPath).name, "Theme tokens");

    pending = sessions();
    client.send({ type: "rename_session", path: otherPath, name: "  " });
    list = await pending;
    const cleared = list.find((s) => s.path === otherPath);
    assert.equal(cleared.name, undefined);
    assert.match(cleared.firstMessage, /rename the theme tokens/);
  });

  test("refuses to rename a path the session list never advertised", async () => {
    client.send({ type: "rename_session", path: path.join(root, "..", "elsewhere.jsonl"), name: "pwned" });
    const error = await client.waitFor("error", 15_000);
    assert.match(error.message, /Unknown session/);
  });

  test("finds a session by a word said only in the middle of the transcript", async () => {
    const results = await search("reconnect loop");
    const hit = results.find((s) => s.path === reconnectPath);
    assert.ok(hit, "the session whose reply mentions the reconnect loop should match");
    assert.match(hit.snippet, /reconnect loop/i);
    // Transcripts stay server-side: a result carries an excerpt, never the whole text
    assert.ok(hit.snippet.length <= 130);
    assert.equal(hit.allMessagesText, undefined);
  });

  test("finds a session by its name", async () => {
    const results = await search("websocket");
    assert.ok(results.some((s) => s.path === reconnectPath));
  });

  test("answers with nothing when no session matches", async () => {
    assert.deepEqual(await search("kangaroo"), []);
  });

  test("ignores a query too short to be worth scanning every transcript", async () => {
    assert.deepEqual(await search("t"), []);
  });
});
