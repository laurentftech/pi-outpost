/**
 * Adding, removing and restoring a pi package from Settings, over a real server, a real
 * npm and a registry of our own (`fakePiPackages.mjs`). What the agent runs is read from
 * the tools it was given; what is configured, from the settings files on disk.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { agentDirAtOldVersion, NAME } from "./fakePiPackages.mjs";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/side-sessions-provider.mjs", import.meta.url));

async function setUp(t, config = {}) {
  const { scratch, reg, agentDir, cache, emptyGlobal } = await agentDirAtOldVersion(t, "pi-packages-install-wire-");
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(
    root,
    {
      agentDir,
      updateCheck: true,
      updateRegistry: reg.url,
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "side-sessions-test", id: "side-sessions-test" }],
      ...config.server,
    },
    {
      env: {
        PI_OFFLINE: undefined,
        npm_config_registry: reg.url,
        npm_config_prefix: emptyGlobal,
        npm_config_cache: cache,
        SIDE_SESSIONS_RELEASE: path.join(scratch, "release"),
      },
    },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello", 60_000);
  // The startup listing is what "loaded" is measured against: wait until it is taken.
  const listedOnce = (m) => (m.type === "pi_packages" ? m.packages : m.type === "hello" ? m.piPackages : undefined);
  await client.waitFor((m) => listedOnce(m)?.some((pkg) => pkg.name === NAME && pkg.check?.state !== "checking"), 60_000);
  return { reg, client, hello, agentDir, root, server };
}

let counter = 0;
async function ask(client, message) {
  const requestId = `r${++counter}`;
  client.send({ ...message, requestId });
  const type = message.type === "lookup_pi_package" ? "pi_package_lookup_result" : "pi_package_change_result";
  return await client.waitFor((m) => m.type === type && m.requestId === requestId, 120_000);
}

const mark = (client) => new Set(client.received);
const listAfter = (client, since, predicate) => client.waitFor((m) => m.type === "pi_packages" && !since.has(m) && predicate(m.packages), 60_000);
const reasonsAfter = (client, since, predicate) => client.waitFor((m) => m.type === "restart_needed" && !since.has(m) && predicate(m.reasons), 60_000);
const userPackages = async (agentDir) => JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")).packages ?? [];
const projectPackages = async (root) =>
  JSON.parse(await readFile(path.join(root, ".pi", "settings.json"), "utf8").catch(() => "{}")).packages ?? [];
const toolNames = (message) => (message.tools ?? []).map((tool) => tool.name);

test("a removed package stays listed until a restart, can be restored, and is gone after a restart", async (t) => {
  // AConfirmedRemovalIsListedUntilARestart, AddingARemovedPackagePointsAtUndo, UndoRestoresWhatIsRunning,
  // TheRestartNoticeNamesEachPackageOnce, AConfiguredPackageIsNotAddedTwice, ARestartUnloadsARemovedPackage
  const { client, agentDir, server } = await setUp(t);

  let since = mark(client);
  const removed = await ask(client, { type: "remove_pi_package", source: `npm:${NAME}`, scope: "user" });
  assert.equal(removed.outcome, "removed", removed.message);
  assert.deepEqual(await userPackages(agentDir), []);
  const listed = await listAfter(client, since, (packages) => packages.some((pkg) => pkg.removed));
  assert.deepEqual(listed.packages, [{ source: `npm:${NAME}`, name: NAME, scope: "user", removed: true, loaded: "1.0.0" }]);
  await reasonsAfter(client, since, (reasons) => reasons.includes(`${NAME} removed`));

  const again = await ask(client, { type: "lookup_pi_package", name: NAME, scope: "user" });
  assert.equal(again.outcome, "refused");
  assert.match(again.message, /removed and still runs until pi-outpost restarts — undo the removal/);

  since = mark(client);
  const restored = await ask(client, { type: "restore_pi_package", name: NAME, scope: "user" });
  assert.equal(restored.outcome, "restored", restored.message);
  assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`]);
  const back = await listAfter(client, since, (packages) => packages.some((pkg) => pkg.name === NAME && !pkg.removed));
  const entry = back.packages.find((pkg) => pkg.name === NAME);
  assert.equal(entry.installed, "1.0.0");
  assert.equal(entry.restartNeeded, undefined, "what is configured is again what runs");
  assert.equal(back.packages.length, 1, "one entry, not a removed one beside it");
  await reasonsAfter(client, since, (reasons) => !reasons.some((reason) => reason.startsWith(NAME)));

  const twice = await ask(client, { type: "lookup_pi_package", name: NAME, scope: "user" });
  assert.deepEqual([twice.outcome, twice.message], ["refused", `${NAME} is already in the agent's settings`]);

  // Removed for good, then a restart: the agent no longer has its tool, and it is not listed.
  assert.equal((await ask(client, { type: "remove_pi_package", source: `npm:${NAME}`, scope: "user" })).outcome, "removed");
  client.send({ type: "restart_server" });
  await client.waitFor((m) => m.type === "server_restarting", 10_000);
  const deadline = Date.now() + 90_000;
  while (!(await fetch(`${server.base}/health`).then((res) => res.ok, () => false))) {
    if (Date.now() > deadline) throw new Error(`the server did not come back:\n${server.log().slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const fresh = connect(server.wsUrl());
  t.after(() => fresh.close());
  const after = await fresh.waitFor((m) => m.type === "hello", 30_000);
  assert.ok(!toolNames(after).some((name) => name.startsWith("fake_ext_")), toolNames(after).join(","));
  const relisted = await fresh.waitFor((m) => (m.type === "pi_packages" ? m.packages : m.type === "hello" ? m.piPackages : undefined) !== undefined, 30_000);
  assert.deepEqual(relisted.type === "hello" ? relisted.piPackages : relisted.packages, []);
});

test("an install into this project is pinned when a version is given, and a double confirmation installs once", async (t) => {
  // AProjectInstallGoesToTheProjectsSettings, AVersionGivenIsPinned, ADoubleConfirmationInstallsOnce,
  // AConfirmedInstallIsListedAndAsksForARestart (over the wire)
  const { reg, client, agentDir, root } = await setUp(t);
  reg.state.published.add("1.1.0");
  await mkdir(path.join(root, ".pi"), { recursive: true });

  const found = await ask(client, { type: "lookup_pi_package", name: NAME, version: "1.1.0", scope: "project" });
  assert.deepEqual([found.outcome, found.version], ["found", "1.1.0"]);

  const since = mark(client);
  const first = `r${++counter}`;
  const second = `r${++counter}`;
  const install = { type: "install_pi_package", name: NAME, version: "1.1.0", scope: "project", confirmed: "1.1.0" };
  client.send({ ...install, requestId: first });
  client.send({ ...install, requestId: second });
  const results = await Promise.all(
    [first, second].map((id) => client.waitFor((m) => m.type === "pi_package_change_result" && m.requestId === id, 120_000)),
  );
  assert.deepEqual(results.map((result) => result.outcome).sort(), ["installed", "refused"], JSON.stringify(results));
  assert.deepEqual(await projectPackages(root), [`npm:${NAME}@1.1.0`]);
  assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`], "the agent's settings are untouched");

  const listed = await listAfter(client, since, (packages) => packages.some((pkg) => pkg.scope === "project"));
  const project = listed.packages.filter((pkg) => pkg.scope === "project");
  assert.equal(project.length, 1);
  assert.deepEqual(
    { installed: project[0].installed, pinned: project[0].pinned, restartNeeded: project[0].restartNeeded },
    { installed: "1.1.0", pinned: "1.1.0", restartNeeded: true },
  );
});

test("a version published after the confirmation is not installed in its place", async (t) => {
  // AddingAPackageFromSettings: the confirmation names the version installed
  const { reg, client, root } = await setUp(t);
  const found = await ask(client, { type: "lookup_pi_package", name: NAME, scope: "project" });
  assert.deepEqual([found.outcome, found.version], ["found", "1.0.0"]);
  reg.state.published.add("1.1.0");
  reg.state.latest = "1.1.0";
  const stale = await ask(client, { type: "install_pi_package", name: NAME, scope: "project", confirmed: found.version });
  assert.equal(stale.outcome, "refused");
  assert.match(stale.message, /now 1\.1\.0 on the registry, not the 1\.0\.0 you confirmed/);
  assert.deepEqual(await projectPackages(root), []);
});

test("an unknown package is refused at the lookup, and nothing is installed", async (t) => {
  // AnUnknownPackageIsRefusedInPlace (server half)
  const { client, agentDir } = await setUp(t);
  const missing = await ask(client, { type: "lookup_pi_package", name: "pi-nope-xyz", scope: "user" });
  assert.deepEqual([missing.outcome, missing.message], ["refused", "pi-nope-xyz was not found on the registry"]);
  const installed = await ask(client, { type: "install_pi_package", name: "pi-nope-xyz", scope: "user", confirmed: "1.0.0" });
  assert.equal(installed.outcome, "refused");
  assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`]);
});

test("an install waits for a running turn, and changes nothing", async (t) => {
  // AnInstallWaitsForARunningTurn
  const { reg, client, root } = await setUp(t);
  reg.state.published.add("1.1.0");
  client.send({ type: "set_model", provider: "side-sessions-test", id: "side-sessions-test" });
  await client.waitFor((m) => m.type === "model_changed");
  client.send({ type: "prompt", text: "HOLD while installing" });
  await client.waitFor((m) => m.type === "agent_start");
  const result = await ask(client, { type: "install_pi_package", name: NAME, version: "1.1.0", scope: "project", confirmed: "1.1.0" });
  assert.equal(result.outcome, "refused");
  assert.equal(result.message, `${path.basename(root)} is busy; wait for its current turn to finish`, "names the working session's project");
  assert.deepEqual(await projectPackages(root), []);
});

test("locked extensions refuse a lookup, an install, a removal and a restore", async (t) => {
  // LockedExtensionsOfferNoInstallOrRemoval (server half)
  const { client, agentDir } = await setUp(t, { server: { extensionLock: true } });
  for (const message of [
    { type: "lookup_pi_package", name: NAME, scope: "project" },
    { type: "install_pi_package", name: NAME, scope: "project", confirmed: "1.0.0" },
    { type: "remove_pi_package", source: `npm:${NAME}`, scope: "user" },
    { type: "restore_pi_package", name: NAME, scope: "user" },
  ]) {
    const result = await ask(client, message);
    assert.equal(result.outcome, "refused", message.type);
    assert.match(result.message, /locked/, message.type);
  }
  assert.deepEqual(await userPackages(agentDir), [`npm:${NAME}`]);
});
