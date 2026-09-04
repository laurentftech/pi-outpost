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

test("ReadConfiguredResourceOutsideRoot: a skill added in Settings is readable by the replacement agent", async (t) => {
  const project = await realpath(await makeWorkspace());
  const sandboxRoot = path.join(project, "workspace");
  const skillDir = path.join(project, "resources", "outside-skill");
  const skillFile = path.join(skillDir, "SKILL.md");
  await Promise.all([mkdir(sandboxRoot), mkdir(skillDir, { recursive: true })]);
  await writeFile(
    skillFile,
    "---\nname: outside-skill\ndescription: Proves configured resources remain readable\n---\n\nOUTSIDE_SKILL_BODY\n",
  );
  const log = path.join(project, "skill-read.json");
  const server = await startServer(
    project,
    {
      sandbox: { root: sandboxRoot, allowWrite: false, allowBash: false },
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "sandbox-settings-test", id: "sandbox-settings-test" }],
    },
    { env: { SANDBOX_SETTINGS_LOG: log, SANDBOX_SETTINGS_READ_PATH: skillFile } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);

  client.send({ type: "update_config", userSkillPaths: [skillDir] });
  const applied = await client.waitFor(
    (message) => message.type === "update_config_ack" || message.type === "error",
    30_000,
  );
  assert.equal(applied.type, "update_config_ack", applied.message);
  assert.ok(
    applied.commands.some((command) => command.name === "skill:outside-skill"),
    "the replacement session discovers the configured skill",
  );

  client.send({ type: "set_model", provider: "sandbox-settings-test", id: "sandbox-settings-test" });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "Read the matching skill before answering." });
  const toolResult = await waitForFile(log);
  assert.match(toolResult, /OUTSIDE_SKILL_BODY/, "the replacement agent can read the external skill body");
  assert.doesNotMatch(toolResult, /Access denied/);
});

test("ReadConfiguredResourceOutsideRoot: an extension added in Settings is readable by the replacement agent", async (t) => {
  const project = await realpath(await makeWorkspace());
  const sandboxRoot = path.join(project, "workspace");
  const extensionDir = path.join(project, "resources", "outside-extension");
  const extensionFile = path.join(extensionDir, "index.js");
  await Promise.all([mkdir(sandboxRoot), mkdir(extensionDir, { recursive: true })]);
  await writeFile(
    extensionFile,
    "export default function () {}\n// OUTSIDE_EXTENSION_BODY\n",
  );
  const log = path.join(project, "extension-read.json");
  const server = await startServer(
    project,
    {
      sandbox: { root: sandboxRoot, allowWrite: false, allowBash: false },
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "sandbox-settings-test", id: "sandbox-settings-test" }],
    },
    { env: { SANDBOX_SETTINGS_LOG: log, SANDBOX_SETTINGS_READ_PATH: extensionFile } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);

  client.send({ type: "update_config", userExtensionPaths: [extensionDir] });
  const applied = await client.waitFor(
    (message) => message.type === "update_config_ack" || message.type === "error",
    30_000,
  );
  assert.equal(applied.type, "update_config_ack", applied.message);
  assert.ok(
    applied.extensionPaths.some((loadedPath) => loadedPath === extensionFile || loadedPath === extensionDir),
    `the replacement session loads the configured extension: ${JSON.stringify(applied.extensionPaths)}`,
  );

  client.send({ type: "set_model", provider: "sandbox-settings-test", id: "sandbox-settings-test" });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "Read the matching extension source before answering." });
  const toolResult = await waitForFile(log);
  assert.match(toolResult, /OUTSIDE_EXTENSION_BODY/, "the replacement agent can read the external extension source");
  assert.doesNotMatch(toolResult, /Access denied/);
});
