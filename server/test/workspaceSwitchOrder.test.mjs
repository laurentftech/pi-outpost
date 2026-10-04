/**
 * The project the user clicked last is the one they get.
 *
 * Switching waits for the target to start. A cold project — opened but never watched, or
 * retired after its idle period — starts slowly (a new agent session; on Windows, every
 * process the start spawns costs more), a warm one at once. Clicked one after the other,
 * the warm one answered first and the cold one, finishing later, took the browser back:
 * the user was left on a project they had already left, its file tree with it.
 */
import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import test from "node:test";
import { connect, makeWorkspace } from "./harness.mjs";
import { secondProject, startScriptedServer } from "./multiProjectHarness.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// openlore: scenario=TheLastSwitchWins spec=multi-project-workspaces
test("TheLastSwitchWins: a slow project finishing late does not take the browser back", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // Every agent's first readiness probe is slow; the server's own project has already
  // taken its turn by the time the browser connects, so only beta's start is slow.
  const server = await startScriptedServer(root, [beta], {
    commands_: { get_state: [{ delayMs: 2_500 }, {}] },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello", 30_000);

  // Beta (cold, slow), then straight back to the server's project (warm, instant).
  client.send({ type: "switch_workspace", root: beta });
  client.send({ type: "switch_workspace", root });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === root, 10_000);
  // Long enough for beta's start to finish and, before the fix, to rebind.
  await wait(5_000);

  const switched = client.received.filter((m) => m.type === "workspace_switched").map((m) => m.workspace.root);
  assert.equal(switched.at(-1), root, `the last click wins: ${JSON.stringify(switched)}`);
  assert.ok(!switched.includes(beta), "the abandoned switch never binds the browser");

  // And the file tree answers for the project chosen.
  client.send({ type: "list_directory", path: "", requestId: "after" });
  const listing = await client.waitFor((m) => m.type === "directory_listing" && m.requestId === "after", 10_000);
  assert.ok(listing.entries.some((entry) => entry.name === "a.md"), JSON.stringify(listing.entries.map((entry) => entry.name)));

  // Beta did start meanwhile, and is still there to switch to.
  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === beta, 10_000);
});
