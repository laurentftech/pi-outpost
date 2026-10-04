/**
 * A project's files are shown before its agent has started.
 *
 * Starting an agent is the slow part of a switch — seconds, more on Windows — and its
 * files never needed it. A switch to a project whose agent is not running binds the
 * browser at once with `workspace_starting`: its file tree, files and git answer, what
 * needs the agent waits, and `workspace_switched` follows as it always did.
 */
import assert from "node:assert/strict";
import { realpath, rm } from "node:fs/promises";
import test from "node:test";
import { connect, makeWorkspace } from "./harness.mjs";
import { secondProject, startScriptedServer } from "./multiProjectHarness.mjs";

async function slowServer(t) {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // Every agent's first readiness probe takes 3 s; the server's own project has paid it
  // by the time a browser connects, so only beta's start is slow.
  const server = await startScriptedServer(root, [beta], { commands_: { get_state: [{ delayMs: 3_000 }, {}] } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello", 30_000);
  return { beta, root, server, client };
}

// openlore: scenario=FilesBeforeTheAgent spec=multi-project-workspaces
test("FilesBeforeTheAgent: the files of a project whose agent is starting are served at once", async (t) => {
  const { beta, client } = await slowServer(t);
  const asked = Date.now();
  client.send({ type: "switch_workspace", root: beta });
  const starting = await client.waitFor((m) => m.type === "workspace_starting", 10_000);
  assert.ok(Date.now() - asked < 2_000, `bound before the agent: ${Date.now() - asked} ms`);
  assert.equal(starting.workspace.root, beta);
  assert.equal(starting.agentStarting, true);
  assert.deepEqual(starting.items, [], "no conversation yet");

  client.send({ type: "list_directory", path: "", requestId: "tree" });
  const listing = await client.waitFor((m) => m.type === "directory_listing" && m.requestId === "tree", 10_000);
  assert.ok(listing.entries.some((entry) => entry.name === "beta.md"), "beta's tree");
  assert.ok(!client.received.some((m) => m.type === "workspace_switched" && m.workspace?.root === beta), "answered before the agent was ready");

  // Asked of the agent meanwhile: it waits, and is answered once the agent is there.
  client.send({ type: "list_sessions" });
  const switched = await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === beta, 15_000);
  assert.equal(switched.agentStarting, undefined, "the full snapshot");
  assert.ok(switched.sessionId, "with its session");
  const sessions = await client.waitFor((m) => m.type === "sessions", 10_000);
  const order = client.received.indexOf(sessions) > client.received.indexOf(switched);
  assert.ok(order, "the queued request is handled after the agent is ready");
});

// openlore: scenario=AFailedStartTakesTheBrowserBack spec=multi-project-workspaces
test("AFailedStartTakesTheBrowserBack: a project whose agent cannot start does not hold the browser", async (t) => {
  const { beta, root, client } = await slowServer(t);
  // Gone from under the server: its files were built, its agent cannot start there.
  await rm(beta, { recursive: true, force: true });
  client.send({ type: "switch_workspace", root: beta });
  const error = await client.waitFor((m) => m.type === "workspace_error", 20_000);
  assert.match(error.message, /Could not start/);
  const back = await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === root, 10_000);
  assert.ok(back.sessionId, "back on the server's project, with its session");
  // And it is usable: a request that needs the agent is answered.
  client.send({ type: "list_sessions" });
  await client.waitFor((m) => m.type === "sessions", 10_000);
});
