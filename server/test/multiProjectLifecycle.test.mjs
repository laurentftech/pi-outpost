/**
 * The life of a project: opened, listed, persisted, retired, closed, refused.
 *
 * Everything here is about the *set* of open projects and what the server does to it —
 * the counterpart to `multiProjectWorkspaces.test.mjs`, which is about what a single
 * connection sees once that set exists.
 */

import assert from "node:assert/strict";
import { readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import {
  RETIREMENT_TIMEOUT_MS,
  next,
  secondProject,
  seedSession,
  sessionsDirOf,
  startScriptedServer,
  wait,
} from "./multiProjectHarness.mjs";

test("a persisted project is listed but has no session until it is opened", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello");

  assert.equal(hello.workspaces.length, 2, "both projects are listed");
  const restored = hello.workspaces.find((w) => w.root === beta);
  // Startup must not grow with the number of open projects: the session is built
  // on first use, not at boot.
  assert.equal(restored.activity, "stopped", "the restored project has no session yet");
  assert.equal(hello.workspace.root, root, "the connection is bound to the server's own project");
});

test("closing a project is refused while its agent is streaming", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "scripted", isStreaming: false },
    commands_: { prompt: { after: [{ type: "agent_start" }] } },
  });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched");
  client.send({ type: "prompt", text: "go" });
  await client.waitFor((m) => m.type === "agent_start" || m.type === "streaming");

  // Refused rather than queued: cancelling someone's work to satisfy a close is
  // worse than asking them to stop it first.
  client.send({ type: "close_project", root: beta });
  const refused = await client.waitFor((m) => m.type === "workspace_error");
  assert.match(refused.message, /working/i);

  // And the workspace is still there, still running.
  const second = connect(server.wsUrl());
  t.after(() => second.close());
  const hello = await second.waitFor((m) => m.type === "hello");
  assert.ok(hello.workspaces.some((w) => w.root === beta), "the project was not closed");
});

test("an unwatched project is retired, stays listed, and comes back with its history", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta], workspaceIdleTimeoutMs: RETIREMENT_TIMEOUT_MS });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "switch_workspace", root: beta });
  const started = await client.waitFor((m) => m.type === "workspace_switched");
  const sessionId = started.sessionId;

  // Nobody is watching beta any more: the idle clock starts when the last client
  // leaves it, not at the next sweep.
  client.send({ type: "switch_workspace", root });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === root);
  await wait(RETIREMENT_TIMEOUT_MS * 3);

  const retired = await client.waitFor(
    (m) => m.type === "workspace_activity" && m.workspaces.some((w) => w.root === beta && w.activity === "stopped"),
  );
  // Retiring is not closing: the project is still open, it simply holds no session.
  assert.ok(retired.workspaces.some((w) => w.root === beta), "the retired project is still listed as open");

  client.send({ type: "switch_workspace", root: beta });
  const rebuilt = await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === beta);
  assert.equal(rebuilt.sessionId, sessionId, "the rebuilt workspace resumes the session it was retired with");
});

test("a project whose agent is streaming outlives any idle period", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startScriptedServer(
    root,
    [beta],
    {
      state: { sessionId: "scripted", isStreaming: false },
      commands_: { prompt: { after: [{ type: "agent_start" }] } },
    },
    { workspaceIdleTimeoutMs: RETIREMENT_TIMEOUT_MS },
  );
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === beta);
  client.send({ type: "prompt", text: "a long one" });
  await client.waitFor((m) => m.type === "agent_start" || m.type === "streaming");

  // Left alone with the turn still running, well past the timeout. This is the
  // line that makes "unused" mean unused rather than unwatched.
  client.send({ type: "switch_workspace", root });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === root);
  await wait(RETIREMENT_TIMEOUT_MS * 3);

  const second = connect(server.wsUrl());
  t.after(() => second.close());
  const hello = await second.waitFor((m) => m.type === "hello");
  assert.equal(hello.workspaces.find((w) => w.root === beta).activity, "working", "the turn kept its project alive");
});

test("a review-ready project outlives any idle period", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const sessionFile = path.join(root, "review-ready.jsonl");
  await writeFile(sessionFile, "");
  const plan = {
    version: 1,
    id: "review",
    title: "Review result",
    updatedAt: "2026-09-01T00:00:00.000Z",
    tasks: [{ id: "review-result", title: "Review result", status: "needs_review", dependsOn: [], resources: [] }],
  };
  await writeFile(`${sessionFile}.work-plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
  const server = await startScriptedServer(
    root,
    [beta],
    { state: { sessionId: "review-ready", sessionFile, isStreaming: false } },
    { workspaceIdleTimeoutMs: RETIREMENT_TIMEOUT_MS },
  );
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello");
  client.send({ type: "switch_workspace", root: beta });
  const started = await client.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === beta);
  assert.equal(started.workspace.activity, "ready-for-review");

  client.send({ type: "switch_workspace", root });
  await client.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === root);
  await wait(RETIREMENT_TIMEOUT_MS * 3);

  const observer = connect(server.wsUrl());
  t.after(() => observer.close());
  const hello = await observer.waitFor("hello");
  assert.equal(hello.workspaces.find((workspace) => workspace.root === beta).activity, "ready-for-review");
});

test("closing a project releases it, moves whoever was watching, and leaves its history on disk", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // A conversation worth losing: the point of the close is that it does not.
  const betaSession = seedSession(beta, sessionsDirOf(root), [
    ["user", "what did we decide?"],
    ["assistant", "we decided to keep it."],
  ]);
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace?.root === beta);

  client.send({ type: "close_project", root: beta });
  // Bound to the project that just went: a client left there would reach a
  // workspace with no runtime on its next message. Back down to one project the
  // snapshot advertises none at all, which is the single-project rule.
  const moved = await next(client, (m) => m.type === "workspace_switched");
  assert.ok(!moved.workspaces || !moved.workspaces.some((w) => w.root === beta), "the project is no longer listed");

  // Closing is not deleting. A new session is fair — the workspace was stopped,
  // not suspended — but what was said in that project has to still be there.
  client.send({ type: "open_project", root: beta });
  await next(client, (m) => m.type === "workspace_switched" && m.workspace?.root === beta);
  client.send({ type: "list_sessions" });
  const reopened = await next(client, (m) => m.type === "sessions");
  assert.ok(reopened.sessions.some((session) => session.path === betaSession), "the earlier conversation survived the close");
});

test("the open set is written before the project is opened, and survives a restart", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root);
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "open_project", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === beta);

  // Persistence is the server's own doing, not something hand-authored: a project
  // the user watched appear has to still be there at the next start.
  const persisted = JSON.parse(await readFile(server.configFile, "utf8"));
  assert.ok(persisted.openProjects.includes(beta), `the config records ${beta}, got ${JSON.stringify(persisted.openProjects)}`);

  const restarted = await startServer(await realpath(await makeWorkspace({ "a.md": "alpha\n" })), {
    openProjects: persisted.openProjects,
  });
  t.after(() => restarted.stop());
  const afterRestart = connect(restarted.wsUrl());
  t.after(() => afterRestart.close());
  const hello = await afterRestart.waitFor((m) => m.type === "hello");
  assert.ok(hello.workspaces.some((w) => w.root === beta), "the project is open again after a restart");
});

test("a project opened with no settings of its own inherits the server's sandbox", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // Read-only server. The inherited settings are rooted at the new project, but
  // everything else about them — writing off, in particular — comes along: a
  // project opened through the picker must not be a way around the sandbox.
  const server = await startServer(root, {
    openProjects: [beta],
    sandbox: { root, allowWrite: false, allowBash: false },
  });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace?.root === beta);

  client.send({ type: "write_file", path: "beta.md", content: "rewritten\n", expectedMtimeMs: 0, force: true, requestId: "write:beta" });
  const refused = await client.waitFor((m) => m.requestId === "write:beta");
  assert.equal(refused.type, "file_browser_error", "writing in the new project is refused, as it is in the first");

  // Rooted at ITS OWN directory, though: the read is served, and it is beta's file.
  client.send({ type: "read_file", path: "beta.md", requestId: "read:beta" });
  const read = await client.waitFor((m) => m.requestId === "read:beta");
  assert.equal(read.type, "file_content", "the project is sandboxed at its own root, not the server's");
});

test("a client that leaves while its project is starting does not keep it alive", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta], workspaceIdleTimeoutMs: RETIREMENT_TIMEOUT_MS });
  t.after(() => server.stop());

  // Bound by name to a project with no session yet, then gone before it is built.
  // The close handler has already forgotten this socket by the time the build
  // finishes; a bind that ran anyway would leave a dead client watching beta, and
  // a workspace nobody is looking at would count as watched forever.
  const leaving = connect(`${server.wsUrl()}?workspace=${encodeURIComponent(beta)}`);
  // Open first — closing a socket mid-handshake is a different race, and not the
  // one this is about — then leave immediately, while the session is still being
  // built behind the upgrade.
  await leaving.open();
  leaving.close();

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");
  await wait(RETIREMENT_TIMEOUT_MS * 3);

  const retired = await client.waitFor(
    (m) => m.type === "workspace_activity" && m.workspaces.some((w) => w.root === beta && w.activity === "stopped"),
    20_000,
  );
  assert.ok(retired, "the project the departed client started was retired");
});

test("the last project cannot be closed", async (t) => {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root);
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "close_project", root });
  const error = await client.waitFor((m) => m.type === "workspace_error");
  assert.match(error.message, /last open project/i);
});

test("a pinned server refuses to open, close or switch", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta], workspaceLock: true });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello");
  assert.equal(hello.workspaceLocked, true, "the client is told, so it can hide the affordance");

  client.send({ type: "switch_workspace", root: beta });
  const refusedSwitch = await client.waitFor((m) => m.type === "workspace_error");
  assert.match(refusedSwitch.message, /pinned/i);

  client.send({ type: "open_project", root: beta });
  const refusedOpen = await client.waitFor(
    (m) => m.type === "workspace_error" && m !== refusedSwitch,
  );
  assert.match(refusedOpen.message, /pinned/i);

  const refusals = client.received.filter((m) => m.type === "workspace_error").length;
  client.send({ type: "close_project", root: beta });
  client.send({ type: "open_side_session", root: beta });
  await client.waitFor(() => client.received.filter((m) => m.type === "workspace_error").length === refusals + 2);
  assert.deepEqual(
    client.received.filter((m) => m.type === "workspace_error").slice(refusals).map((m) => m.message),
    ["This server is pinned to one project", "This server is pinned to one project"],
    "closing and side sessions are refused the same way",
  );
});

test("opening an unreadable path fails and opens nothing", async (t) => {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root);
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "open_project", root: path.join(root, "does-not-exist") });
  const error = await client.waitFor((m) => m.type === "workspace_error");
  assert.match(error.message, /cannot open/i);

  // Nothing was added: the set is still one project long.
  client.send({ type: "list_sessions" });
  await client.waitFor((m) => m.type === "sessions");
  const second = connect(server.wsUrl());
  t.after(() => second.close());
  const hello = await second.waitFor((m) => m.type === "hello");
  // The set is still one long. Asserted on the list rather than on its absence:
  // the snapshot now always carries it, so "nothing was added" is a length.
  assert.deepEqual(hello.workspaces.map((w) => w.root), [root], "still a single-project server");
});

test("opening a directory that is already open reuses it", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello");

  client.send({ type: "open_project", root: beta });
  const switched = await client.waitFor((m) => m.type === "workspace_switched");

  assert.equal(switched.workspace.root, beta);
  // Two workspaces on one root would be two writers on one session store.
  assert.equal(switched.workspaces.length, hello.workspaces.length, "no duplicate project");
});

test("a persisted set that cannot be written leaves the server untouched", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root);
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  // Persist-first is the rule: a set that cannot be saved must not be applied.
  // Removing the configured source is deterministic on every platform and makes
  // the persistence transaction fail before it can produce a replacement file.
  await unlink(server.configFile);

  client.send({ type: "open_project", root: beta });
  const error = await client.waitFor((m) => m.type === "workspace_error");
  assert.match(error.message, /cannot read|cannot save|could not save/i);

  const second = connect(server.wsUrl());
  t.after(() => second.close());
  const hello = await second.waitFor((m) => m.type === "hello");
  assert.deepEqual(hello.workspaces.map((w) => w.root), [root], "the project was not opened");
});
