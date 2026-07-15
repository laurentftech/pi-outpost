/**
 * Conversation branching, end to end. LIVE: these drive real agent turns, so they
 * need model auth configured (the same credentials `npm run dev` uses) and cost
 * tokens. Run with `npm run test:live --workspace server`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "../harness.mjs";

const SWALLOW_EXTENSION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/swallow-extension.ts",
);

/** The client's pairing rule — mirrors `case "user_entries"` in web/src/useAgent.ts. */
function pairEntries(items, entries) {
  const userIndexes = items.flatMap((item, i) => (item.kind === "user" ? [i] : []));
  const paired = new Map();
  for (let i = userIndexes.length - 1, k = entries.length - 1; i >= 0 && k >= 0; i--, k--) {
    const item = items[userIndexes[i]];
    if (item.kind !== "user" || item.text !== entries[k].text) break;
    paired.set(userIndexes[i], entries[k].entryId);
  }
  return items.map((item, i) =>
    item.kind === "user" ? { ...item, entryId: paired.get(i) } : item,
  );
}

/** Drive one turn and return the client-side view (bubbles + the entries the server confirmed). */
async function turn(client, text, { swallowed = false } = {}) {
  const seen = client.received.filter((m) => m.type === "user_entries").length;
  client.send({ type: "prompt", text });
  if (swallowed) {
    // A swallowed prompt never persists an entry, so no user_entries ever arrives
    await new Promise((r) => setTimeout(r, 3000));
    return null;
  }
  return client.waitFor((m) => {
    return (
      m.type === "user_entries" &&
      client.received.filter((x) => x.type === "user_entries").length > seen
    );
  });
}

/**
 * One AgentSession is shared by every client (that is the whole design), so tests
 * must not inherit each other's branches: start each one on a fresh session.
 */
async function freshSession(client) {
  client.send({ type: "new_session" });
  await client.waitFor("session_replaced", 20_000);
  client.received.length = 0;
}

function bubbles(client) {
  const items = client.received
    .filter((m) => m.type === "user")
    .map((m) => ({ kind: "user", text: m.text }));
  const last = [...client.received].reverse().find((m) => m.type === "user_entries");
  return { items: pairEntries(items, last?.entries ?? []), entries: last?.entries ?? [] };
}

describe("conversation branching (live)", () => {
  let server;
  before(async () => {
    const root = await makeWorkspace({ "README.md": "# test workspace\n" });
    server = await startServer(root, { extensionPaths: [SWALLOW_EXTENSION] });
  });
  after(() => server?.stop());

  test("a bubble the server never persisted stays unpaired, and no other bubble is mispaired", async () => {
    const client = connect(server.wsUrl());
    await client.open();
    await client.waitFor("hello");
    await freshSession(client);

    await turn(client, "Dis A, un seul mot.");
    // An extension consumes this one: echoed as a bubble, never a session entry
    await turn(client, "!swallow ceci ne sera jamais persiste", { swallowed: true });
    await turn(client, "Dis B, un seul mot.");

    const { items, entries } = bubbles(client);
    const phantom = items.find((i) => i.text.startsWith("!swallow"));
    const bubbleB = items.find((i) => i.text === "Dis B, un seul mot.");

    assert.ok(phantom, "the swallowed prompt was still echoed as a bubble");
    assert.ok(
      !entries.some((e) => e.text.startsWith("!swallow")),
      "the swallowed prompt never became a session entry",
    );
    assert.equal(phantom.entryId, undefined, "the phantom bubble must not carry an entry id");
    assert.equal(
      entries.find((e) => e.entryId === bubbleB.entryId)?.text,
      "Dis B, un seul mot.",
      "the last bubble is paired with its own entry",
    );
    // The regression this guards: aligning by position would hand the phantom
    // bubble the entry of "Dis A" — editing it would rewind the wrong turn.
    for (const item of items) {
      if (item.entryId === undefined) continue;
      assert.equal(
        entries.find((e) => e.entryId === item.entryId)?.text,
        item.text,
        `bubble ${JSON.stringify(item.text)} points at another message's entry`,
      );
    }

    client.close();
  });

  test("editing a prompt branches: the original exchange stays in the tree, its reply restorable", async () => {
    const client = connect(server.wsUrl());
    await client.open();
    await client.waitFor("hello");
    await freshSession(client);

    await turn(client, "Dis bleu, un seul mot.");
    const original = bubbles(client).items.at(-1);
    assert.ok(original.entryId, "a persisted turn carries its entry id");

    // The edited turn must be *persisted* before we navigate — waiting on a bare
    // "agent_end" would match the previous turn's, and the navigation would then
    // land mid-stream and be refused
    const turnsBefore = client.received.filter((m) => m.type === "user_entries").length;
    client.send({ type: "edit_prompt", entryId: original.entryId, text: "Dis rouge, un seul mot." });
    await client.waitFor(
      (m) =>
        m.type === "user_entries" &&
        client.received.filter((x) => x.type === "user_entries").length > turnsBefore,
    );

    const tree = await client.waitFor((m) => m.type === "tree" && m.roots.length === 2, 20_000);
    const texts = tree.roots.map((r) => r.text);
    assert.ok(texts.includes("Dis bleu, un seul mot."), "the original prompt survives as a branch");
    assert.ok(texts.includes("Dis rouge, un seul mot."), "the edited prompt is a branch too");

    // The abandoned branch is restorable *with its reply*: that is what tipId is for
    const abandoned = tree.roots.find((r) => r.text === "Dis bleu, un seul mot.");
    assert.ok(abandoned.tipId, "an answered turn advertises its reply tip");

    // The edit already broadcast one snapshot — wait for the navigation's own
    const seen = client.received.filter((m) => m.type === "session_replaced").length;
    client.send({ type: "navigate_tree", entryId: abandoned.tipId });
    const snapshot = await client.waitFor(
      (m) =>
        m.type === "session_replaced" &&
        client.received.filter((x) => x.type === "session_replaced").length > seen,
      20_000,
    );
    const kinds = snapshot.items.map((i) => i.kind);
    assert.deepEqual(kinds, ["user", "assistant"], "the restored transcript has the reply, not just the prompt");
    assert.equal(snapshot.items[0].text, "Dis bleu, un seul mot.");
    assert.ok(
      !client.received.some((m) => m.type === "editor_prefill"),
      "restoring a tip must not prefill the composer (that is what redo does)",
    );

    client.close();
  });

  test("navigating to the turn itself rewinds and hands the text back to the composer", async () => {
    const client = connect(server.wsUrl());
    await client.open();
    await client.waitFor("hello");
    await freshSession(client);

    await turn(client, "Dis vert, un seul mot.");
    const item = bubbles(client).items.at(-1);

    client.send({ type: "navigate_tree", entryId: item.entryId });
    const prefill = await client.waitFor("editor_prefill");
    assert.equal(prefill.text, "Dis vert, un seul mot.");

    client.close();
  });

  test("an entry id the tree never advertised is refused", async () => {
    const client = connect(server.wsUrl());
    await client.open();
    await client.waitFor("hello");

    client.send({ type: "navigate_tree", entryId: "deadbeef" });
    const error = await client.waitFor("error", 10_000);
    assert.match(error.message, /Unknown tree node/);

    client.close();
  });
});
