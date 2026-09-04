/**
 * A Settings sandbox move over the real socket, browser and embedded agent.
 *
 * The browser and the agent must be rebuilt from the same root. Checking only the
 * acknowledgement caught the former while missing a stale factory in the latter.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/sandbox-settings-provider.mjs", import.meta.url));

async function waitForFile(file, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await readFile(file, "utf8").catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("the agent never returned its ls result");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// openlore: scenario=NewSandboxGovernsTheReplacementSession spec=persistent-runtime-settings
test("moving the sandbox in Settings moves the file browser and the agent's real ls tool", async (t) => {
  const project = await realpath(await makeWorkspace());
  const original = path.join(project, "original");
  const moved = path.join(project, "moved");
  await Promise.all([mkdir(original), mkdir(moved)]);
  await Promise.all([
    writeFile(path.join(original, "original.txt"), "old\n"),
    writeFile(path.join(moved, "moved.txt"), "new\n"),
  ]);
  const log = path.join(project, "agent-ls.json");
  const server = await startServer(
    project,
    {
      sandbox: { root: original, allowWrite: true, writableRoot: original, allowBash: false },
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "sandbox-settings-test", id: "sandbox-settings-test" }],
    },
    { env: { SANDBOX_SETTINGS_LOG: log } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 30_000);
  assert.equal(hello.sandbox.root, original);

  client.send({
    type: "update_config",
    sandbox: { root: moved, allowWrite: true, writableRoot: moved, allowBash: false },
  });
  const ack = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error", 30_000);
  assert.equal(ack.type, "update_config_ack", ack.message);
  assert.equal(ack.sandbox.root, moved);

  client.send({ type: "list_directory", path: "", requestId: "browser-root" });
  const listing = await client.waitFor((message) => message.type === "directory_listing" && message.requestId === "browser-root");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["moved.txt"], "the file browser uses the moved sandbox");

  client.send({ type: "set_model", provider: "sandbox-settings-test", id: "sandbox-settings-test" });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "List the files in your sandbox." });
  const toolResult = await waitForFile(log);

  assert.match(toolResult, /moved\.txt/, "the agent's ls tool uses the moved sandbox");
  assert.doesNotMatch(toolResult, /original\.txt/, "the old sandbox is no longer visible to the agent");
});

test("an extension veto rolls back the sandbox instead of acknowledging a split boundary", async (t) => {
  const project = await realpath(await makeWorkspace());
  const original = path.join(project, "original");
  const moved = path.join(project, "moved");
  await Promise.all([mkdir(original), mkdir(moved)]);
  await Promise.all([
    writeFile(path.join(original, "original.txt"), "old\n"),
    writeFile(path.join(moved, "moved.txt"), "new\n"),
  ]);
  const log = path.join(project, "vetoed-agent-ls.json");
  const server = await startServer(
    project,
    {
      sandbox: { root: original, allowWrite: true, writableRoot: original, allowBash: false },
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "sandbox-settings-test", id: "sandbox-settings-test" }],
    },
    { env: { SANDBOX_SETTINGS_LOG: log, SANDBOX_SETTINGS_VETO: "1" } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);

  client.send({
    type: "update_config",
    sandbox: { root: moved, allowWrite: true, writableRoot: moved, allowBash: false },
  });
  const result = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error", 30_000);
  assert.equal(result.type, "error", "a vetoed replacement must never be acknowledged");
  assert.match(result.message, /cancelled by an extension/i);

  client.send({ type: "list_directory", path: "", requestId: "rolled-back-browser" });
  const listing = await client.waitFor(
    (message) => message.type === "directory_listing" && message.requestId === "rolled-back-browser",
  );
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["original.txt"], "the browser rolls back to the agent's root");

  const persisted = JSON.parse(await readFile(server.configFile, "utf8"));
  assert.equal(persisted.sandbox.root, original, "a restart must retain the same sandbox boundary");
  assert.equal(persisted.sandbox.writableRoot, original);

  client.send({ type: "set_model", provider: "sandbox-settings-test", id: "sandbox-settings-test" });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "List the files in your sandbox." });
  const toolResult = await waitForFile(log);
  assert.match(toolResult, /original\.txt/, "the retained agent stays paired with the rolled-back browser");
  assert.doesNotMatch(toolResult, /moved\.txt/);
});
