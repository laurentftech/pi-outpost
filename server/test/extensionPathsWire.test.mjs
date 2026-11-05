/**
 * Extension paths added from the interface, over a real connection.
 *
 * `extensionPaths.test.ts` proves the configuration layer; these boot servers to prove
 * the rest of the chain — that the protocol accepts the update, that the replacement
 * session actually loaded the extension, that a locked deployment is refused where the
 * decision is made rather than only where the control is drawn, and that the snapshot
 * distinguishes an inventory it has from one it cannot have.
 *
 * Each subtest boots a server. Keep the count low.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connect, freePort, makeWorkspace, startServer } from "./harness.mjs";

const FAKE_RPC = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

/** An extension directory the SDK will discover: a loose `.ts` file registering a command. */
async function extensionDir(root, name, command) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "index.ts"),
    `export default (pi) => {\n  pi.registerCommand(${JSON.stringify(command)}, {\n    description: "from ${command}",\n    handler: async () => {},\n  });\n};\n`,
  );
  return dir;
}

const commandNames = (message) => (message.commands ?? []).map((c) => c.name);

describe("extension paths from the interface", () => {
  // openlore: scenario=PreservesTheChosenExtensionAlias spec=extension-path-aliases
  // openlore: scenario=RetargetedAliasLoadsAfterRestart spec=extension-path-aliases
  // openlore: scenario=RemovesTheAliasWithoutRemovingItsTarget spec=extension-path-aliases
  test("an applied symlink stays in config, follows a new target after restart, and can be taken back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-ext-wire-"));
    const mine = await extensionDir(root, "mine", "mine-hello");
    const alias = path.join(root, "stable-extensions");
    await symlink(mine, alias, process.platform === "win32" ? "junction" : "dir");
    const deployment = await extensionDir(root, "deployment", "deployment-hello");
    let server;
    let second;
    try {
      server = await startServer(root, { extensionPaths: [deployment], server: { port: await freePort() } });
      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 30_000);

      assert.deepEqual(hello.userExtensionPaths, [], "the snapshot carries the user's own list");
      assert.deepEqual(hello.configuredExtensionPaths, [deployment], "and the deployment's, apart");
      assert.deepEqual(hello.agentResources?.capabilities, { skills: "available", extensions: "available" });
      const deploymentRealPath = await realpath(deployment);
      let extensionResource;
      for (const resource of hello.agentResources?.resources ?? []) {
        if (
          resource.kind === "extension" &&
          resource.path &&
          !resource.path.startsWith("<inline:") &&
          (await realpath(resource.path)) === deploymentRealPath
        ) {
          extensionResource = resource;
          break;
        }
      }
      assert.ok(extensionResource?.path, "the embedded adapter preserves extension filesystem provenance");
      assert.equal(await realpath(extensionResource.path), deploymentRealPath);
      assert.equal(
        hello.agentResources?.resources.some((resource) => resource.path?.startsWith("<inline:")),
        false,
        "inline built-in extensions do not masquerade as filesystem resources",
      );
      assert.ok(commandNames(hello).includes("deployment-hello"), "precondition: the deployment's extension loaded");
      assert.ok(!commandNames(hello).includes("mine-hello"));

      client.send({ type: "update_config", userExtensionPaths: [alias, alias] });
      const ack = await client.waitFor("update_config_ack", 30_000);

      assert.ok(
        commandNames(ack).includes("mine-hello"),
        "the replacement session loaded the extension discovered in the added directory",
      );
      assert.ok(commandNames(ack).includes("deployment-hello"), "and kept the deployment's");
      assert.deepEqual(ack.userExtensionPaths, [alias]);
      const added = ack.agentResources.resources.find((resource) => resource.kind === "extension" && resource.origin === "user");
      assert.equal(added?.userRoot, alias, "the Remove action must identify the configured alias");

      const written = JSON.parse(await readFile(server.configFile, "utf8"));
      assert.deepEqual(written.userExtensionPaths, [alias], "persisted before the acknowledgement");
      assert.deepEqual(written.extensionPaths, [deployment], "the deployment's list untouched");

      // An update moves the extension and repoints its stable directory alias.
      // Remove the old target so a saved realpath cannot accidentally keep working.
      const updated = await extensionDir(root, "mine-next", "mine-updated");
      await rm(alias);
      await symlink(updated, alias, process.platform === "win32" ? "junction" : "dir");
      await rm(mine, { recursive: true });

      // Same configuration, new process: what the user chose has to still be there.
      // Started before the first is stopped — `stop()` deletes the workspace the
      // configuration under test lives in.
      second = await startServer(root, { ...written, server: { ...written.server, port: await freePort() } });
      const restarted = connect(second.wsUrl());
      await restarted.open();
      const helloAgain = await restarted.waitFor("hello", 30_000);
      assert.ok(
        commandNames(helloAgain).includes("mine-updated"),
        "a restarted server loads the extensions discovered in the directory the user chose",
      );
      assert.ok(!commandNames(helloAgain).includes("mine-hello"), "the old target is no longer loaded");
      assert.deepEqual(helloAgain.userExtensionPaths, [alias]);
      assert.deepEqual(helloAgain.configuredExtensionPaths, [deployment]);
      restarted.close();

      // Taking it back rebuilds a session without it — the same path as adding.
      // Matched on the list rather than on the type: `waitFor` returns the first
      // message already received, so waiting for `update_config_ack` again hands back
      // the acknowledgement of the *add* and the assertions below pass on stale state.
      client.send({ type: "update_config", userExtensionPaths: [] });
      const removed = await client.waitFor(
        (m) => m.type === "update_config_ack" && (m.userExtensionPaths ?? []).length === 0,
        30_000,
      );
      assert.ok(!commandNames(removed).includes("mine-hello"), "removal rebuilds a session without it");
      assert.ok(!commandNames(removed).includes("mine-updated"));
      assert.ok(commandNames(removed).includes("deployment-hello"));
      assert.equal(await realpath(alias), await realpath(updated), "removing a resource does not remove its link or files");
      client.close();
    } finally {
      await server?.stop();
      await second?.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a locked deployment refuses the change and applies the rest of an update normally", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-ext-lock-"));
    const mine = await extensionDir(root, "mine", "mine-hello");
    const skillDir = path.join(root, "skills", "locked-probe");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: locked-probe\ndescription: Proves the lock is not a blanket refusal.\n---\n\nbody\n",
    );
    let server;
    try {
      server = await startServer(root, { extensionLock: true });
      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 30_000);
      assert.equal(hello.extensionLock, true, "the snapshot reports the lock, so a client draws no control");

      // Sent by hand, as a client that drew no control would have to.
      client.send({ type: "update_config", userExtensionPaths: [mine] });
      const error = await client.waitFor((m) => m.type === "error" && /locked/i.test(m.message), 30_000);
      assert.match(error.message, /locked/i);

      const written = JSON.parse(await readFile(server.configFile, "utf8"));
      assert.equal(written.userExtensionPaths, undefined, "nothing was persisted");
      assert.equal(
        client.received.some((m) => m.type === "update_config_ack"),
        false,
        "the refused change was not acknowledged",
      );
      assert.equal(
        client.received.some((m) => m.type === "session_replaced" && m.sessionId !== hello.sessionId),
        false,
        "the refused change did not replace the live session",
      );

      // The lock is about extensions, not about applying settings at all.
      client.send({ type: "update_config", userSkillPaths: [skillDir] });
      const ack = await client.waitFor("update_config_ack", 30_000);
      assert.deepEqual(ack.userSkillPaths, [await realpath(skillDir)]);
      assert.deepEqual(ack.userExtensionPaths, [], "and the locked list is untouched");
      client.close();
    } finally {
      if (server) await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an update carrying nothing is refused rather than rebuilding a session for no reason", async () => {
    const server = await startServer(await makeWorkspace());
    try {
      const client = connect(server.wsUrl());
      await client.open();
      await client.waitFor("hello", 30_000);
      // Each wait names the message it wants: `waitFor("error")` would resolve with
      // the first error already received, which is the previous assertion's.
      client.send({ type: "update_config" });
      await client.waitFor((m) => m.type === "error" && /Nothing to update/.test(m.message), 30_000);
      client.send({ type: "update_config", userExtensionPaths: ["  "] });
      await client.waitFor((m) => m.type === "error" && /Invalid extension paths/.test(m.message), 30_000);
      client.close();
    } finally {
      await server.stop();
    }
  });

  // openlore: scenario=RefusesInvalidExtensionAliases spec=extension-path-aliases
  test("invalid extension paths leave settings and the active session unchanged", async () => {
    const root = await makeWorkspace({ "not-a-directory.txt": "file" });
    const dangling = path.join(root, "dangling");
    await symlink(path.join(root, "missing"), dangling, process.platform === "win32" ? "junction" : "dir");
    const server = await startServer(root);
    try {
      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 30_000);
      for (const invalid of [dangling, path.join(root, "not-a-directory.txt")]) {
        client.send({ type: "update_config", userExtensionPaths: [invalid] });
        await client.waitFor((m) => m.type === "error" && m.message.includes(invalid), 30_000);
        const written = JSON.parse(await readFile(server.configFile, "utf8"));
        assert.equal(written.userExtensionPaths, undefined);
      }
      assert.equal(client.received.some((m) => m.type === "update_config_ack"), false);
      assert.equal(client.received.some((m) => m.type === "session_replaced" && m.sessionId !== hello.sessionId), false);
      client.close();
    } finally {
      await server.stop();
    }
  });

  test("a runtime that cannot report an inventory omits it rather than reporting none", async () => {
    const root = await makeWorkspace();
    const fakeConfig = path.join(root, "fake-rpc.json");
    await writeFile(fakeConfig, JSON.stringify({}));
    const server = await startServer(
      root,
      {
        sandbox: false,
        agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE_RPC], startupTimeoutMs: 5_000 },
      },
      { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
    );
    try {
      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 30_000);
      client.close();
      assert.equal(
        hello.extensionPaths,
        undefined,
        "an empty list would tell the operator the child loaded none, which this server was never told",
      );
      assert.equal(hello.agentResources?.capabilities.extensions, "unavailable");
    } finally {
      await server.stop();
    }
  });
});
