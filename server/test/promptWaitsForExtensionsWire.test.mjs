/**
 * A prompt waits for the session's extensions to finish starting.
 *
 * An extension may load, in `session_start`, the rules it applies to every tool call;
 * a turn run before that would escape them. The extension here takes four seconds in
 * `session_start`, then leaves a marker; its `/probe` command records whether that
 * marker existed when it ran. Sent the moment the client is greeted — well inside
 * those four seconds — `/probe` must run after the binding, not before. A binding that
 * never ends must not hold a prompt for ever: abort releases it, unsent.
 *
 * Each subtest boots a server. Keep the count low.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { connect, startServer } from "./harness.mjs";

/**
 * An extension whose session_start takes `startMs` (or never ends), and a /probe command.
 * With `firstOnly`, only its first session_start is slow — a later session binds at once,
 * as real extensions do once their own start-up is behind them.
 */
async function extensionDir(root, markers, startMs, firstOnly = false) {
  const dir = path.join(root, "slow-start-extension");
  await mkdir(dir, { recursive: true });
  const at = (name) => JSON.stringify(path.join(markers, name));
  const sleep = startMs === Infinity ? "await new Promise(() => {});" : `await new Promise((resolve) => setTimeout(resolve, ${startMs}));`;
  const wait = firstOnly ? `if (!existsSync(${at("started")})) { ${sleep} }` : sleep;
  await writeFile(
    path.join(dir, "index.ts"),
    `import { existsSync, writeFileSync } from "node:fs";
export default (pi) => {
  pi.on("session_start", async () => { ${wait} writeFileSync(${at("started")}, "yes"); });
  pi.registerCommand("probe", { description: "probe", handler: async () => {
    writeFileSync(${at("probe")}, existsSync(${at("started")}) ? "after-start" : "before-start");
  } });
};
`,
  );
  return dir;
}

async function boot(startMs, firstOnly = false) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-prompt-waits-"));
  const markers = path.join(root, "markers");
  await mkdir(markers);
  const extension = await extensionDir(root, markers, startMs, firstOnly);
  const server = await startServer(root, { extensionPaths: [extension] });
  const client = connect(server.wsUrl());
  await client.open();
  const hello = await client.waitFor("hello", 60_000);
  return { root, markers, server, client, hello };
}

async function eventually(check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

/** The client's view of "extensions are starting", replayed from what it received, in order. */
function bindingShown(received) {
  let binding = false;
  for (const message of received) {
    if (message.type === "hello" || message.type === "session_replaced" || message.type === "snapshot") binding = message.extensionsBinding === true;
    else if (message.type === "extensions_bound") binding = false;
  }
  return binding;
}

/** An extension that asks a question in every session's `session_start`, numbering them. */
async function askingExtensionDir(root) {
  const dir = path.join(root, "asking-extension");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "index.ts"),
    `let asked = 0;
export default (pi) => {
  pi.on("session_start", async (_event, ctx) => { asked += 1; await ctx.ui.confirm("Start " + asked, "Ready?"); });
};
`,
  );
  return dir;
}

describe("a question an extension asks while a session starts", () => {
  // openlore: scenario=ANewSessionsStartQuestionReachesTheClient spec=extension-startup
  test("ANewSessionsStartQuestionReachesTheClient: asked before the replacement is announced, it is shown after it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-asking-"));
    const server = await startServer(root, { extensionPaths: [await askingExtensionDir(root)] });
    const client = connect(server.wsUrl());
    try {
      await client.open();
      await client.waitFor("hello", 60_000);
      const first = await client.waitFor((m) => m.type === "extension_ui_request" && m.title === "Start 1", 30_000);
      client.send({ type: "extension_ui_response", id: first.id, confirmed: true });
      await client.waitFor("extensions_bound", 30_000).catch(() => {});

      client.send({ type: "new_session" });
      await client.waitFor("session_replaced", 30_000);
      const replacedAt = client.received.findLastIndex((m) => m.type === "session_replaced");
      // A snapshot wipes the client's dialogs: the new session's question has to come after it.
      const asked = () => client.received.slice(replacedAt + 1).find((m) => m.type === "extension_ui_request" && m.title === "Start 2");
      assert.ok(await eventually(() => asked() !== undefined, 15_000), "the new session's question never reached the client after the replacement");
      assert.equal(
        client.received.slice(replacedAt + 1).some((m) => m.type === "extension_ui_request" && m.title === "Start 1"),
        false,
        "the old session's answered question is not shown again",
      );
      client.send({ type: "extension_ui_response", id: asked().id, confirmed: true });
      assert.ok(await eventually(() => !bindingShown(client.received), 15_000), "answered, the start completes");
    } finally {
      client.close();
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a prompt and the extensions' start", () => {
  test("ANewSessionDuringTheStartEndsTheWait: a session replaced while the extensions start is not shown waiting for ever", async () => {
    const { root, markers, server, client, hello } = await boot(4000, true);
    try {
      assert.equal(hello.extensionsBinding, true, "precondition: greeted while the extensions start");
      client.send({ type: "new_session" });
      await client.waitFor("session_replaced", 30_000);
      client.send({ type: "prompt", text: "/probe" });
      assert.ok(await eventually(() => existsSync(path.join(markers, "probe")), 30_000), "the command ran");
      // Whatever order the bindings settled in, the client must end up told they are done.
      assert.ok(await eventually(() => !bindingShown(client.received), 15_000), "the client still shows the extensions starting");
    } finally {
      client.close();
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("APromptWaitsForTheExtensions: sent while they start, it runs once they have", async () => {
    const { root, markers, server, client, hello } = await boot(4000);
    try {
      // Greeted inside the four seconds: the session is shown while the extension starts.
      assert.equal(hello.extensionsBinding, true, "the greeting says the extensions are still starting");
      assert.ok(!existsSync(path.join(markers, "started")), "precondition: session_start has not finished");

      client.send({ type: "prompt", text: "/probe" });
      assert.ok(await eventually(() => existsSync(path.join(markers, "probe"))), "the command ran");
      assert.equal(readFileSync(path.join(markers, "probe"), "utf8"), "after-start", "and only after session_start had finished");
      await client.waitFor("extensions_bound", 20_000);
    } finally {
      client.close();
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("AbortReleasesAWaitingPrompt: a start that never ends does not hold the message for ever", async () => {
    const { root, markers, server, client, hello } = await boot(Infinity);
    try {
      assert.equal(hello.extensionsBinding, true);
      const errorsBefore = client.received.filter((message) => message.type === "error").length;
      client.send({ type: "prompt", text: "/probe" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.ok(!existsSync(path.join(markers, "probe")), "the command waits");

      client.send({ type: "abort" });
      const error = await client.waitFor(
        (message) => message.type === "error" && client.received.filter((m) => m.type === "error").indexOf(message) >= errorsBefore,
        15_000,
      );
      assert.match(error.message, /waiting for the extensions to finish starting/);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.ok(!existsSync(path.join(markers, "probe")), "and never ran");
      assert.equal(client.received.filter((message) => message.type === "user").length, 0, "nothing was echoed as sent");
    } finally {
      client.close();
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
