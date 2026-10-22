/**
 * Updating a pi package from Settings, over a real server, a real npm and a registry of
 * our own.
 *
 * The registry and the extension are `fakePiPackages.mjs`'s: each version registers a
 * tool named after itself, so "loaded" is read from the tools the agent was given, not
 * inferred from a version string on disk.
 */
import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { agentDirAtOldVersion, NAME, toolOf } from "./fakePiPackages.mjs";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { next } from "./multiProjectHarness.mjs";
import WebSocket from "ws";

const PROVIDER = fileURLToPath(new URL("./fixtures/side-sessions-provider.mjs", import.meta.url));

/** A server over an agent directory with 1.0.0 installed by npm itself. */
async function setUp(t, config = {}) {
  const { scratch, reg, agentDir, cache, emptyGlobal } = await agentDirAtOldVersion(t, "pi-packages-wire-");
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(
    root,
    {
      agentDir,
      updateCheck: true,
      updateRegistry: reg.url,
      extensionPaths: [PROVIDER, ...(config.extensionPaths ?? [])],
      allowedModels: [{ provider: "side-sessions-test", id: "side-sessions-test" }],
      ...config.server,
    },
    {
      env: {
        // The harness keeps the SDK offline; its package manager then refuses to install.
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
  t.after(() => { if (process.env.DEBUG_WIRE) console.log("TYPES", client.received.map((m) => m.type + (m.type === "pi_packages" ? JSON.stringify(m.packages) : "") + (Array.isArray(m.tools) ? "{" + m.tools.map((x) => x.name).filter((n) => n.startsWith("fake")).join(",") + "}" : "")).join(" | ").slice(0, 3000), "\nLOG", server.log().slice(-3000)); });
  const hello = await client.waitFor((m) => m.type === "hello", 60_000);
  return { reg, client, hello, agentDir, scratch, server };
}

const packagesMessage = (client, predicate) => next(client, (m) => m.type === "pi_packages" && predicate(m.packages[0]));

/**
 * The messages this client has received so far, as a boundary to wait past.
 *
 * `next()` only accepts a message that arrives after it is armed, which is a race
 * whenever something slow — a real npm install — runs between the action and the
 * wait: the broadcast it is waiting for has already landed, and it waits out its
 * timeout for a second one that is never sent. A boundary taken before the action
 * cannot lose that way, and still refuses a message from before it.
 */
const mark = (client) => new Set(client.received);
const packagesAfter = (client, since, predicate) =>
  client.waitFor((m) => m.type === "pi_packages" && !since.has(m) && predicate(m.packages[0]));
const toolNames = (message) => (message.tools ?? []).map((tool) => tool.name);

async function update(client, requestId = "u1") {
  // The list already received, not a new one: only its source is needed, and the
  // broadcast just awaited may be the last before an update. Waiting for a newer list
  // waits for the update this call has not sent yet — a race decided by whether the
  // startup check's broadcast lands before or after the one the test asked for.
  //
  // Nor only a `pi_packages` message: when the startup check has finished before this
  // client connected — a slow runner — the list arrives inside `hello` and no message
  // follows it, and waiting for one waits out the timeout.
  const known = (m) => (m.type === "pi_packages" ? m.packages : m.type === "hello" ? m.piPackages : undefined);
  const [pkg] = known(await client.waitFor((m) => known(m)?.length > 0));
  client.send({ type: "update_pi_package", source: pkg.source, requestId });
  return await client.waitFor((m) => m.type === "pi_package_update_result" && m.requestId === requestId, 120_000);
}

test("a newer version is offered and installed, then a restart loads it", async (t) => {
  // ANewerVersionIsShown (over the wire), AConfirmedUpdateIsInstalledAndAsksForARestart, ARestartLoadsTheUpdatedPackage
  const { reg, client, hello, server } = await setUp(t);
  assert.ok(toolNames(hello).includes(toolOf("1.0.0")), "1.0.0 is what the agent loads");

  reg.state.published.add("1.1.0");
  reg.state.latest = "1.1.0";
  client.send({ type: "check_pi_packages" });
  const offered = await packagesMessage(client, (pkg) => pkg.check?.state === "newer");
  assert.deepEqual(offered.packages[0].check, { state: "newer", latest: "1.1.0" });
  assert.equal(offered.packages[0].installed, "1.0.0");
  assert.equal(offered.packages[0].restartNeeded, undefined);

  const result = await update(client);
  assert.equal(result.outcome, "installed", result.message);
  assert.match(result.message, /1\.1\.0 is installed — restart pi-outpost to use it/);
  assert.doesNotMatch(result.message, /loaded|running/, "it does not claim the new version runs");
  const pending = await client.waitFor((m) => m.type === "pi_packages" && m.packages[0]?.installed === "1.1.0" && m.packages[0]?.restartNeeded === true, 30_000);
  assert.ok(pending);

  // The restart: the connection drops, and a new one is served by a server running 1.1.0.
  client.send({ type: "restart_server" });
  await client.waitFor((m) => m.type === "server_restarting", 10_000);
  // Up again once /health answers; only then is there anything to connect to.
  const deadline = Date.now() + 90_000;
  for (;;) {
    const up = await fetch(`${server.base}/health`).then((res) => res.ok, () => false);
    if (up) break;
    if (Date.now() > deadline) throw new Error(`the server did not come back:\n${server.log().slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const fresh = connect(server.wsUrl());
  t.after(() => fresh.close());
  const after = await fresh.waitFor((m) => m.type === "hello", 30_000);
  assert.ok(toolNames(after).includes(toolOf("1.1.0")) && !toolNames(after).includes(toolOf("1.0.0")), toolNames(after).join(","));
});

test("a version changed behind the server's back needs a restart too", async (t) => {
  const { client, agentDir } = await setUp(t);
  // The startup listing, settled — already received or still to come. `next()` would
  // accept only a list sent after it is armed, and when the startup check's broadcasts
  // have already landed no other list comes until the check below is sent.
  await client.waitFor((m) => m.type === "pi_packages" && m.packages[0]?.check?.state !== "checking", 60_000);
  const manifest = path.join(agentDir, "npm", "node_modules", NAME, "package.json");
  const edited = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(manifest, JSON.stringify({ ...edited, version: "1.0.1" }));
  client.send({ type: "check_pi_packages" });
  const listed = await client.waitFor((m) => m.type === "pi_packages" && m.packages[0]?.installed === "1.0.1", 30_000);
  assert.equal(listed.packages[0].restartNeeded, true);
});

test("a restart waits for a running turn", async (t) => {
  // ARestartWaitsForRunningTurns
  const { client } = await setUp(t);
  client.send({ type: "set_model", provider: "side-sessions-test", id: "side-sessions-test" });
  await client.waitFor((m) => m.type === "model_changed");
  client.send({ type: "prompt", text: "HOLD during a restart" });
  await client.waitFor((m) => m.type === "agent_start");
  client.send({ type: "restart_server" });
  const refused = await client.waitFor((m) => m.type === "error" && /restart/.test(m.message), 10_000);
  assert.match(refused.message, /is working — stop its turn before restarting/);
  assert.equal(client.received.filter((m) => m.type === "server_restarting").length, 0);
});

test("a widget's connection cannot restart the server", async (t) => {
  // AWidgetCannotRestartTheServer (server half)
  const host = "http://127.0.0.1:4999";
  const { server } = await setUp(t, { server: { server: { allowedOrigins: [host] } } });
  const widget = new WebSocket(server.wsUrl(), { headers: { origin: host } });
  t.after(() => widget.close());
  const received = [];
  widget.on("message", (raw) => received.push(JSON.parse(String(raw))));
  await new Promise((resolve) => widget.on("open", resolve));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  widget.send(JSON.stringify({ type: "restart_server" }));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.ok(received.some((m) => m.type === "error" && /embedded widget cannot restart/.test(m.message)), JSON.stringify(received.map((m) => m.type)));
  assert.ok(!received.some((m) => m.type === "server_restarting"));
});

test("an install that fails leaves the installed version and says why", async (t) => {
  // AFailedInstallChangesNothing
  const { reg, client } = await setUp(t);
  reg.state.published.add("1.1.0");
  reg.state.latest = "1.1.0";
  reg.state.withholdTarballs = true;
  const since = mark(client);
  const result = await update(client);
  assert.equal(result.outcome, "failed", result.message);
  const listed = await packagesAfter(client, since, (pkg) => pkg.check?.state !== "checking");
  assert.equal(listed.packages[0].installed, "1.0.0");
});

test("an update waits for a turn that is running, and changes nothing", async (t) => {
  // AnUpdateWaitsForARunningTurn
  const { reg, client, agentDir } = await setUp(t);
  reg.state.published.add("1.1.0");
  reg.state.latest = "1.1.0";
  client.send({ type: "set_model", provider: "side-sessions-test", id: "side-sessions-test" });
  await client.waitFor((m) => m.type === "model_changed");
  client.send({ type: "prompt", text: "HOLD while updating" });
  await client.waitFor((m) => m.type === "agent_start");
  const result = await update(client);
  assert.equal(result.outcome, "refused");
  assert.match(result.message, /busy|turn/);
  const manifest = JSON.parse(await readFile(path.join(agentDir, "npm", "node_modules", NAME, "package.json"), "utf8"));
  assert.equal(manifest.version, "1.0.0", "nothing was installed");
});

test("locked extensions refuse an update", async (t) => {
  // LockedExtensionsOfferNoUpdate (server half)
  const { reg, client } = await setUp(t, { server: { extensionLock: true } });
  reg.state.published.add("1.1.0");
  reg.state.latest = "1.1.0";
  const result = await update(client);
  assert.equal(result.outcome, "refused");
  assert.match(result.message, /locked/);
});

