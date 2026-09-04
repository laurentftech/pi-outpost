/**
 * Settings changes that outlive the process.
 *
 * The unit tests in config-persist.test.ts prove the file is written correctly;
 * these boot real servers to prove the rest of the chain — that the protocol
 * accepts the update, that the acknowledgement only comes after the write, that
 * the replacement session actually loaded the skill, and that a server started
 * again from the same file still has it.
 *
 * Each subtest boots a server (the restart test boots two). Keep the count low.
 */
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connect, freePort, startServer } from "./harness.mjs";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const CONFIG_FILE = "pi-outpost.test.json";

const skills = (message) => (message.commands ?? []).filter((c) => c.source === "skill").map((c) => c.name);
const activeTools = (message) => (message.tools ?? []).filter((tool) => tool.active).map((tool) => tool.name);

describe("persistent runtime settings", () => {
  test("an applied skill path reaches the session, the config file, and the next start", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "pi-outpost-settings-")));
    const skillDir = path.join(root, "shared", "test-skill");
    await cp(path.join(FIXTURES, "test-skill"), skillDir, { recursive: true });
    // A skill the configuration file names: it must survive every apply, and must
    // never be addressable from the interface.
    const deploymentSkill = path.join(root, "deployment", "deployment-skill");
    await cp(path.join(FIXTURES, "test-skill"), deploymentSkill, { recursive: true });
    await writeFile(
      path.join(deploymentSkill, "SKILL.md"),
      "---\nname: deployment-skill\ndescription: Named by the configuration file.\n---\n\n# Deployment skill\n",
    );

    let first;
    let second;
    try {
      first = await startServer(root, { skillPaths: [deploymentSkill], server: { port: await freePort() } });
      const client = connect(first.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 30_000);
      assert.deepEqual(skills(hello), ["skill:deployment-skill"], "precondition: only the deployment's skill");
      assert.ok(activeTools(hello).includes("present_structure"));
      assert.ok(activeTools(hello).includes("work_plan"));
      assert.deepEqual(hello.userSkillPaths, [], "the snapshot carries the user's own list");

      client.send({ type: "update_config", userSkillPaths: [skillDir] });
      const ack = await client.waitFor("update_config_ack", 30_000);

      assert.deepEqual(
        skills(ack).sort(),
        ["skill:deployment-skill", "skill:test-skill"],
        "the replacement session loaded the new skill, and kept the deployment's",
      );
      assert.deepEqual(ack.userSkillPaths, [skillDir]);
      assert.ok(activeTools(ack).includes("present_structure"), "config apply keeps the Structured Exchange tool");
      assert.ok(activeTools(ack).includes("work_plan"), "config apply keeps the Work Plan tool");
      assert.notEqual(ack.sessionId, hello.sessionId, "the session was replaced");

      const persisted = JSON.parse(await readFile(path.join(root, CONFIG_FILE), "utf8"));
      assert.deepEqual(persisted.userSkillPaths, [skillDir], "the loaded config file holds the chosen path");
      assert.deepEqual(persisted.skillPaths, [deploymentSkill], "the operator's own list is untouched");
      assert.equal(persisted.branding, undefined);

      client.close();

      // Same configuration, new process: what the user chose has to still be there.
      // The first server is stopped after this one boots rather than before —
      // `stop()` deletes the workspace, and the configuration under test lives in it.
      second = await startServer(root, { ...persisted, server: { ...persisted.server, port: await freePort() } });
      const restarted = connect(second.wsUrl());
      await restarted.open();
      const helloAgain = await restarted.waitFor("hello", 30_000);
      assert.deepEqual(skills(helloAgain).sort(), ["skill:deployment-skill", "skill:test-skill"]);
      assert.deepEqual(helloAgain.userSkillPaths, [skillDir]);
      assert.deepEqual(helloAgain.skillPaths, [deploymentSkill]);
      restarted.close();
    } finally {
      await first?.stop();
      await second?.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refusals change nothing, and the path picker browses the host", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-settings-bad-"));
    let server;
    try {
      await cp(path.join(FIXTURES, "test-skill"), path.join(root, "shared", "test-skill"), { recursive: true });
      server = await startServer(root, { userSkillPaths: [], server: { port: await freePort() } });
      const configPath = path.join(root, CONFIG_FILE);
      const before = await readFile(configPath, "utf8");

      const client = connect(server.wsUrl());
      await client.open();
      const hello = await client.waitFor("hello", 30_000);

      // Malformed requests never reach the configuration file.
      client.send({ type: "update_config", userSkillPaths: ["ok", 7] });
      assert.match((await client.waitFor((m) => m.type === "error", 15_000)).message, /Invalid skill paths/);

      client.send({ type: "update_config" });
      assert.match(
        (await client.waitFor((m) => m.type === "error" && /Nothing to update/.test(m.message), 15_000)).message,
        /Nothing to update/,
      );

      // A well-formed request whose result would not load is refused just as hard.
      client.send({
        type: "update_config",
        sandbox: { root: path.join(root, "does-not-exist"), allowWrite: false, allowBash: false },
      });
      const failure = await client.waitFor((m) => m.type === "error" && /cannot save/.test(m.message), 15_000);
      assert.match(failure.message, /does not exist/);

      assert.equal(await readFile(configPath, "utf8"), before, "the config file was not touched");
      assert.equal(
        client.received.some((m) => m.type === "update_config_ack"),
        false,
        "nothing was acknowledged",
      );
      assert.equal(
        client.received.some((m) => m.type === "session_replaced" && m.sessionId !== hello.sessionId),
        false,
        "the live session was kept",
      );

      // Browsing rides the same server: it needs nothing the refusals above
      // changed, and a server boot is the expensive thing in this file.
      // "/" is the top on both platforms: a real directory on POSIX, and on Windows
      // a virtual one whose entries are the drives.
      client.send({ type: "browse_server_directory", path: "/", requestId: "b1" });
      const top = await client.waitFor((m) => m.type === "server_directory" && m.requestId === "b1", 15_000);
      assert.equal(top.path, "/");
      assert.equal(top.parent, null, "the top has nowhere to go back to");
      assert.ok(top.entries.length > 0, "the top of the tree is not empty");

      // Outside the workspace the file browser is confined to — the point of this browser.
      client.send({ type: "browse_server_directory", path: path.join(root, "shared"), requestId: "b2" });
      const shared = await client.waitFor((m) => m.type === "server_directory" && m.requestId === "b2", 15_000);
      assert.deepEqual(
        shared.entries.map((e) => e.name),
        ["test-skill"],
      );
      assert.equal(shared.entries[0].path, path.join(root, "shared", "test-skill"));
      assert.equal(shared.parent, root);

      client.send({ type: "browse_server_directory", path: path.join(root, "nowhere"), requestId: "b3" });
      const error = await client.waitFor((m) => m.type === "server_directory_error" && m.requestId === "b3", 15_000);
      assert.equal(error.path, path.join(root, "nowhere"));
      assert.match(error.message, /does not exist/);
      client.close();
    } finally {
      await server?.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
