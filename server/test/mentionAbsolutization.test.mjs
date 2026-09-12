/**
 * `@`-mentioned paths, made unambiguous for the model without the user ever
 * seeing the change.
 *
 * A real server, a real WebSocket client, and a real (scripted) RPC child —
 * the boundary under test is literally what text reaches the process the
 * model runs in, which only a running server can show. A unit test of
 * `rewriteMentionedPaths` alone would prove the string transform works and
 * say nothing about whether `handlePrompt` actually applies it, or whether
 * the live broadcast and the reconnect-derived history agree with each other
 * afterwards — which is exactly the kind of gap a fake would paper over.
 */
import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

async function commands(commandLog) {
  const raw = await readFile(commandLog, "utf8").catch(() => "");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("an @-mentioned path reaches the model absolute, and the user still sees it relative", async () => {
  const root = await makeWorkspace({ "notes/todo.md": "- [ ] write the thing\n" });
  const commandLog = path.join(root, "commands.jsonl");
  const fakeConfig = path.join(root, "fake-rpc.json");
  const expectedAbsolute = await realpath(path.join(root, "notes/todo.md"));
  const absolutized = `please check @${expectedAbsolute}`;
  // What the SDK persists after a prompt is whatever reached it — the
  // absolutized text — so the reconnect assertion below needs the fake to
  // echo it back as a real Pi would: a `message_end` event is how
  // rpcRuntime.ts learns of a user message at all (see its own comment —
  // "the browser already echoed its own prompt" — it otherwise trusts the
  // child, not the text pi-outpost itself sent, for what to persist).
  await writeFile(
    fakeConfig,
    JSON.stringify({
      commandLog,
      commands_: {
        prompt: {
          // What the child's own history holds once the turn is over. A real Pi
          // persists the prompt it was given; the server replaces its in-memory
          // messages with this on every completed turn, so a fixture that answers
          // nothing makes a reconnect replay nothing.
          replacement: {
            messages: [{ role: "user", content: absolutized, timestamp: 1 }],
            // The branch the server reads `user_entries` from. Like the messages
            // above, it holds what reached the runtime: the absolutized text.
            tree: [{ entry: { id: "entry-1", type: "message", message: { role: "user", content: absolutized } }, children: [] }],
            leafId: "entry-1",
          },
          after: [
            { type: "message_end", message: { role: "user", content: absolutized } },
            // The turn has to *end*, not merely be accepted. The server persists
            // the history and announces it then; without this the reconnect below
            // raced the write and read an empty session — rarely on macOS, often
            // enough on Windows CI to fail one run in two.
            { type: "agent_settled" },
          ],
        },
      },
    }),
  );

  const server = await startServer(
    root,
    { sandbox: undefined, agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 } },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello");

    client.send({ type: "prompt", text: "please check @notes/todo.md" });

    // The live echo — what the sender themselves sees — must be exactly what
    // they typed. This is the half of the trade that costs nothing to keep.
    const echoed = await client.waitFor("user");
    assert.equal(echoed.text, "please check @notes/todo.md");

    // What actually reached the process the model runs in must not be that
    // same string: an absolute path, not a root-relative one a bash `cd`
    // earlier in the turn could make ambiguous.
    const sent = await commands(commandLog);
    const prompt = sent.find((command) => command.type === "prompt");
    assert.ok(prompt, `no prompt command recorded; saw ${JSON.stringify(sent.map((c) => c.type))}`);
    assert.equal(prompt.message, absolutized);

    // Reconnecting replays history from what the SDK persisted — which is
    // whatever reached runtime.prompt(), the absolute form. The relative
    // mention must survive that round trip too, or "transparent" stops being
    // true the moment the tab reloads.
    // `user_entries` is broadcast once the turn is persisted — the server saying
    // the history now holds what a reconnect would replay.
    const entries = await client.waitFor("user_entries");

    // And it must be broadcast the way the bubble is spelled. The client pairs
    // these entries onto its bubbles by text and stops at the first mismatch, so
    // an absolutized entry here does not merely fail to match its own bubble: it
    // drops the entry id of every bubble above it, and the whole conversation
    // loses its ✎ — no editing, no branching — until the tab is reloaded.
    assert.deepEqual(
      entries.entries.map((entry) => entry.text),
      ["please check @notes/todo.md"],
    );

    const reconnected = connect(server.wsUrl());
    try {
      const hello = await reconnected.waitFor("hello");
      const replayed = hello.items.find((item) => item.kind === "user");
      assert.ok(replayed, `no replayed user item; saw ${JSON.stringify(hello.items.map((i) => i.kind))}`);
      assert.equal(replayed.text, "please check @notes/todo.md");
    } finally {
      reconnected.close();
    }
  } finally {
    client.close();
    await server.stop();
  }
});

test("a mention that isn't a real path is left exactly as typed", async () => {
  const root = await makeWorkspace();
  const commandLog = path.join(root, "commands.jsonl");
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(fakeConfig, JSON.stringify({ commandLog }));

  const server = await startServer(
    root,
    { sandbox: undefined, agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 } },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello");

    client.send({ type: "prompt", text: "ask @someone about this, not @nonexistent.md" });
    await client.waitFor("user");

    const sent = await commands(commandLog);
    const prompt = sent.find((command) => command.type === "prompt");
    assert.equal(prompt.message, "ask @someone about this, not @nonexistent.md");
  } finally {
    client.close();
    await server.stop();
  }
});
