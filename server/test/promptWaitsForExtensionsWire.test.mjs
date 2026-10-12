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

/** An extension whose session_start takes `startMs` (or never ends), and a /probe command. */
async function extensionDir(root, markers, startMs) {
  const dir = path.join(root, "slow-start-extension");
  await mkdir(dir, { recursive: true });
  const at = (name) => JSON.stringify(path.join(markers, name));
  const wait = startMs === Infinity ? "await new Promise(() => {});" : `await new Promise((resolve) => setTimeout(resolve, ${startMs}));`;
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

async function boot(startMs) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-prompt-waits-"));
  const markers = path.join(root, "markers");
  await mkdir(markers);
  const extension = await extensionDir(root, markers, startMs);
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

describe("a prompt and the extensions' start", () => {
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
