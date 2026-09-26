/**
 * Reading back past compaction, over the wire.
 *
 * The unit tests next door pin down which items a window holds. What this suite is for
 * is everything around that: a compacted session served to a real client, the reply
 * reaching only the socket that asked, a request for a session the server no longer
 * holds, and a runtime that cannot read a branch at all.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE_RPC = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

/**
 * A saved session of `turns` exchanges, compacted so only the last turn is left in the
 * model's context. Seeded in the store the server reads, exactly as a real session is.
 */
function seedCompactedSession(root, turns) {
  const manager = SessionManager.create(root, path.join(root, ".pi-agent", "sessions"));
  const userEntryIds = [];
  for (let i = 1; i <= turns; i++) {
    userEntryIds.push(manager.appendMessage({ role: "user", content: [{ type: "text", text: `ask ${i}` }] }));
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: `answer ${i}` }],
      // Real replies carry their billing counters, and the SDK's context-usage read
      // dereferences them unguarded once a branch holds a compaction entry. A fixture
      // without them crashes the session switch on a bug that is not ours.
      stopReason: "stop",
      usage: { input: 120, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 160 },
    });
  }
  manager.appendCompaction("the conversation so far, in three lines", userEntryIds[turns - 1], 4_321);
  return manager.getSessionFile();
}

/** The text an item shows, for comparing a transcript against what was said. */
function itemText(item) {
  if (item.kind === "user" || item.kind === "custom") return item.text ?? "";
  if (item.kind === "assistant") return (item.blocks ?? []).map((block) => block.text ?? "").join("");
  if (item.kind === "compaction") return `compaction:${item.summary}`;
  return item.kind;
}

describe("reading back past compaction", () => {
  let root;
  let server;
  let client;
  let other;
  let sessionId;

  before(async () => {
    root = await makeWorkspace();
    const sessionFile = seedCompactedSession(root, 6);
    server = await startServer(root);
    client = connect(server.wsUrl());
    other = connect(server.wsUrl());
    await client.open();
    await other.open();
    await client.waitFor("hello");
    await other.waitFor("hello");
    client.send({ type: "switch_session", path: sessionFile });
    const replaced = await client.waitFor("session_replaced");
    sessionId = replaced.sessionId;
  });

  after(async () => {
    client?.close();
    other?.close();
    await server?.stop();
  });

  /** The snapshot the server last sent this client. */
  function snapshot(target = client) {
    const snapshots = target.received.filter((m) => m.type === "hello" || m.type === "session_replaced");
    return snapshots[snapshots.length - 1];
  }

  test("the snapshot says how much of the conversation is out of context", () => {
    const current = snapshot();
    assert.ok(current.olderItems > 0, "a compacted session has items a reader cannot see");
    assert.ok(
      !current.items.some((item) => itemText(item) === "ask 1"),
      "the first turn is not in the transcript — this is the complaint being fixed",
    );
    assert.ok(
      current.items.some((item) => item.kind === "compaction"),
      "and the transcript says where it was cut",
    );
  });

  test("the reader is served the items before the ones they hold, and nobody else is", async () => {
    client.send({ type: "history_before", sessionId, have: 0, count: 4, requestId: "first" });
    const reply = await client.waitFor("history_items");

    assert.equal(reply.requestId, "first");
    assert.equal(reply.items.length, 4);
    assert.ok(reply.remaining > 0, "there is more of this conversation further back");
    assert.ok(
      reply.items.every((item) => item.readOnly === true),
      "what compaction removed cannot be edited or forked from",
    );
    assert.ok(
      !other.received.some((m) => m.type === "history_items" || m.type === "history_unavailable"),
      "the other client asked for nothing and must receive nothing — a scroll position is not session state",
    );
  });

  test("consecutive windows reach the first message with no gap and no repetition", async () => {
    const rebuilt = [];
    let have = 0;
    for (let request = 0; request < 20; request++) {
      client.send({ type: "history_before", sessionId, have, count: 3, requestId: `walk-${request}` });
      const reply = await client.waitFor((m) => m.type === "history_items" && m.requestId === `walk-${request}`);
      rebuilt.unshift(...reply.items.map(itemText));
      have += reply.items.length;
      if (reply.remaining === 0) break;
    }
    assert.equal(rebuilt[0], "ask 1", "the walk reaches the conversation's first message");
    assert.deepEqual(
      rebuilt.filter((text) => text.startsWith("ask ")),
      ["ask 1", "ask 2", "ask 3", "ask 4", "ask 5"],
      "every prompt appears exactly once, in order",
    );
    assert.equal(have, snapshot().olderItems, "the walk collected exactly what the snapshot counted");
  });

  test("a request naming a session the server no longer holds is refused", async () => {
    client.send({ type: "history_before", sessionId: "not-this-session", have: 0, count: 3, requestId: "stale" });
    const reply = await client.waitFor("history_unavailable");
    assert.equal(reply.requestId, "stale");
    assert.equal(reply.kind, "stale");
    assert.ok(
      !client.received.some((m) => m.type === "history_items" && m.requestId === "stale"),
      "no items from another conversation were sent",
    );
  });
});

test("a runtime that cannot read a branch says so instead of serving part of one", async () => {
  const root = await makeWorkspace();
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(fakeConfig, JSON.stringify({ launchLog: path.join(root, "launch.json") }));
  const server = await startServer(
    root,
    {
      // RPC refuses to be paired with a sandbox, and confinement is not what this test is about.
      sandbox: undefined,
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE_RPC], startupTimeoutMs: 5_000 },
    },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello");
    assert.equal(hello.olderItems, undefined, "a runtime that cannot read back offers nothing to read back");

    client.send({ type: "history_before", sessionId: hello.sessionId, have: 0, count: 5, requestId: "rpc" });
    const reply = await client.waitFor("history_unavailable");
    assert.equal(reply.kind, "unsupported");
    assert.match(reply.reason, /rpc agent runtime/);
    assert.ok(
      !client.received.some((m) => m.type === "history_items"),
      "a partial branch is worse than an admitted refusal",
    );
  } finally {
    client.close();
    await server.stop();
  }
});

test("the snapshot names the session, so nothing has to guess from a uuid", async () => {
  const root = await makeWorkspace();
  const sessionFile = seedCompactedSession(root, 3);
  SessionManager.open(sessionFile).appendSessionInfo("Braking, twelve turns");

  const server = await startServer(root);
  const client = connect(server.wsUrl());
  try {
    await client.open();
    await client.waitFor("hello");
    client.send({ type: "switch_session", path: sessionFile });
    const replaced = await client.waitFor("session_replaced");
    assert.equal(replaced.sessionName, "Braking, twelve turns");
  } finally {
    client.close();
    await server.stop();
  }
});

test("a session with no name carries none, rather than an empty one", async () => {
  const root = await makeWorkspace();
  const server = await startServer(root);
  const client = connect(server.wsUrl());
  try {
    await client.open();
    const hello = await client.waitFor("hello");
    assert.equal(hello.sessionName, undefined);
  } finally {
    client.close();
    await server.stop();
  }
});

test("a session whose replies carry no token counters still opens, and says nothing about its context", async () => {
  const root = await makeWorkspace();
  const manager = SessionManager.create(root, path.join(root, ".pi-agent", "sessions"));
  // No `usage` and no `stopReason` on the replies — what a provider that prices nothing
  // produces, and what an imported or hand-edited session file can hold. Paired with a
  // compaction entry it takes the SDK down the branch that dereferences `usage`
  // unguarded (earendil-works/pi #6312, closed as not planned).
  const first = manager.appendMessage({ role: "user", content: [{ type: "text", text: "ask 1" }] });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer 1" }] });
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "ask 2" }] });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer 2" }] });
  manager.appendCompaction("what came before", first, 5_000);
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "ask 3" }] });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer 3" }] });
  const sessionFile = manager.getSessionFile();

  const server = await startServer(root);
  const client = connect(server.wsUrl());
  try {
    await client.open();
    await client.waitFor("hello");
    client.send({ type: "switch_session", path: sessionFile });
    const replaced = await client.waitFor("session_replaced");

    // The conversation arrives — which is the whole point: before the guard, building
    // this snapshot threw and the reader was left with an error instead of a session.
    assert.ok(replaced.items.length > 0, "the transcript is served");
    assert.ok(
      replaced.items.some((item) => item.kind === "compaction"),
      "including the compaction boundary",
    );
    assert.equal(replaced.contextUsage, undefined, "and the context indicator claims nothing it cannot compute");
    assert.ok(
      !client.received.some((message) => message.type === "error" && /totalTokens/.test(message.message ?? "")),
      "no error about a missing token count reaches the client",
    );
  } finally {
    client.close();
    await server.stop();
  }
});
