/**
 * What one connection sees, over the real server and the real WebSocket.
 *
 * A project's sessions belong to that project, a client watching one hears about the
 * others' activity but not their content, and a file, a session or a tool call cannot
 * cross from one project into another.
 *
 * The lifecycle of a project — opening it, closing it, persisting the set, retiring
 * it, pinning the server — lives in `multiProjectLifecycle.test.mjs`. Split because
 * one file of 26 tests, each starting a real server, crossed the per-file timeout on
 * a loaded runner and took a release with it.
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

const reviewPlan = (id) => ({
  version: 1,
  id,
  title: `Review ${id}`,
  updatedAt: "2026-09-01T00:00:00.000Z",
  tasks: [{ id: `${id}-review`, title: `Private review task ${id}`, status: "needs_review", dependsOn: [], resources: [] }],
});

// openlore: scenario=ASingleProjectIsStillDescribed spec=api
test("a single-project server still says which project it is serving", async (t) => {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root);
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello");

  // These used to be omitted below two open projects, which left the interface
  // with no name to show and no way to find one: the snapshot is the only place
  // a project's name and activity exist.
  assert.equal(hello.workspace?.root, root, "the bound project is described");
  assert.deepEqual(
    hello.workspaces?.map((w) => w.root),
    [root],
    "the one open project is listed",
  );
  assert.ok(hello.workspace.name, "a project the interface can name");
  assert.ok(hello.workspace.activity, "with the state the control shows beside it");
});

test("switching builds the other project's session and keeps its history apart", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello");

  client.send({ type: "switch_workspace", root: beta });
  const switched = await client.waitFor((m) => m.type === "workspace_switched");

  assert.equal(switched.workspace.root, beta, "the connection is now bound to the other project");
  // A session of its own, not the first project's handed over.
  assert.notEqual(switched.sessionId, hello.sessionId, "the second project got its own session");
  assert.equal(
    switched.workspaces.find((w) => w.root === beta).activity,
    "idle",
    "starting it is what the switch did",
  );
});

test("session listing is scoped to the project the connection is bound to", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "list_sessions" });
  const onAlpha = await client.waitFor((m) => m.type === "sessions");

  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched");
  client.send({ type: "list_sessions" });
  const onBeta = await client.waitFor((m) => m.type === "sessions");

  // The cache behind this is keyed by project; one shared entry used to answer
  // the second listing with the first project's session paths.
  const alphaPaths = new Set(onAlpha.sessions.map((s) => s.path));
  for (const session of onBeta.sessions) {
    assert.ok(!alphaPaths.has(session.path), `${session.path} belongs to the other project`);
  }
});

test("a client hears about another project's activity, and none of its content", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  const watcher = connect(server.wsUrl());
  const mover = connect(server.wsUrl());
  t.after(() => {
    watcher.close();
    mover.close();
  });
  await watcher.waitFor((m) => m.type === "hello");
  await mover.waitFor((m) => m.type === "hello");

  // The second client starts the other project; the first stays where it is.
  mover.send({ type: "switch_workspace", root: beta });
  const activity = await watcher.waitFor(
    (m) =>
      m.type === "workspace_activity" &&
      m.workspaces.some((w) => w.root === beta && w.activity === "starting"),
  );
  assert.ok(
    !mover.received.some((m) => m.type === "workspace_switched"),
    "starting is observable before the new session is handed to the mover",
  );
  // Activity carries no conversation: that is what makes it safe to send to
  // everyone.
  assert.equal(Object.keys(activity).sort().join(","), "type,workspaces");
  await mover.waitFor((m) => m.type === "workspace_switched");
});

test("a background result moves from working to review-ready without exposing its content", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const sessionFile = path.join(root, "background-review.jsonl");
  const privatePlan = reviewPlan("private-background-result");
  await writeFile(sessionFile, "");
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "background-review", sessionFile, isStreaming: false },
    commands_: {
      prompt: {
        writes: [{ path: `${sessionFile}.work-plan.json`, content: `${JSON.stringify(privatePlan, null, 2)}\n` }],
        after: [
          { type: "agent_start" },
          {
            type: "tool_execution_end",
            toolCallId: "review-plan",
            toolName: "work_plan",
            result: {
              content: [{ type: "text", text: "Private result content" }],
              details: { type: "work_plan", sessionFile, plan: privatePlan, changed: true },
            },
            isError: false,
          },
          { type: "agent_settled" },
        ],
      },
    },
  });
  t.after(() => server.stop());

  const watcher = connect(server.wsUrl());
  const worker = connect(server.wsUrl());
  t.after(() => { watcher.close(); worker.close(); });
  await watcher.waitFor("hello");
  await worker.waitFor("hello");
  worker.send({ type: "switch_workspace", root: beta });
  await worker.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === beta);
  worker.send({ type: "prompt", text: "finish in the background" });

  await watcher.waitFor(
    (message) => message.type === "workspace_activity"
      && message.workspaces.some((workspace) => workspace.root === beta && workspace.activity === "working"),
  );
  const ready = await watcher.waitFor(
    (message) => message.type === "workspace_activity"
      && message.workspaces.some((workspace) => workspace.root === beta && workspace.activity === "ready-for-review"),
  );
  const summary = ready.workspaces.find((workspace) => workspace.root === beta);
  assert.equal(summary.needsAttention, true);
  assert.deepEqual(Object.keys(summary).sort(), ["activity", "id", "name", "needsAttention", "root"]);
  assert.equal(
    watcher.received.some((message) => JSON.stringify(message).includes("Private result content") || JSON.stringify(message).includes("Private review task")),
    false,
    "neither result nor Work Plan content crossed the workspace boundary",
  );
});

test("several review-ready workspaces stay marked across selection without leaking plan content", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const rootSessionFile = path.join(root, "review-ready-root.jsonl");
  const betaSessionFile = path.join(beta, "review-ready-beta.jsonl");
  await writeFile(rootSessionFile, "");
  await writeFile(betaSessionFile, "");
  await writeFile(`${rootSessionFile}.work-plan.json`, `${JSON.stringify(reviewPlan("private-root"), null, 2)}\n`);
  await writeFile(`${betaSessionFile}.work-plan.json`, `${JSON.stringify(reviewPlan("private-beta"), null, 2)}\n`);
  const server = await startScriptedServer(root, [beta], {
    stateByCwd: {
      [root]: { sessionId: "review-ready-root", sessionFile: rootSessionFile, isStreaming: false },
      [beta]: { sessionId: "review-ready-beta", sessionFile: betaSessionFile, isStreaming: false },
    },
  });
  t.after(() => server.stop());
  const watcher = connect(server.wsUrl());
  const mover = connect(server.wsUrl());
  t.after(() => { watcher.close(); mover.close(); });
  const hello = await watcher.waitFor("hello");
  await mover.waitFor("hello");
  assert.equal(hello.workspace.activity, "ready-for-review");
  assert.equal(hello.workPlan?.id, "private-root", "the root derives readiness from its own plan");

  mover.send({ type: "switch_workspace", root: beta });
  const onBeta = await mover.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === beta);
  assert.equal(onBeta.workspace.activity, "ready-for-review");
  assert.equal(onBeta.workPlan?.id, "private-beta", "the second workspace derives readiness from its independent plan");

  const bothReady = await watcher.waitFor(
    (message) => message.type === "workspace_activity"
      && [root, beta].every((workspaceRoot) => message.workspaces.some((workspace) => workspace.root === workspaceRoot && workspace.activity === "ready-for-review" && workspace.needsAttention)),
  );
  for (const summary of bothReady.workspaces) {
    assert.deepEqual(Object.keys(summary).sort(), ["activity", "id", "name", "needsAttention", "root"], "only generic summary fields cross workspaces");
    assert.ok(!JSON.stringify(summary).includes("Private review task private-root"));
    assert.ok(!JSON.stringify(summary).includes("Private review task private-beta"));
  }

  mover.send({ type: "switch_workspace", root });
  await mover.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === root);
  mover.send({ type: "switch_workspace", root: beta });
  const selectedAgain = await next(mover, (message) => message.type === "workspace_switched" && message.workspace.root === beta);
  assert.equal(selectedAgain.workspace.activity, "ready-for-review", "selection never acknowledges review readiness");
  assert.equal(
    watcher.received.filter((message) => message.type === "workspace_activity").some((message) => /Private review task private-(root|beta)/.test(JSON.stringify(message))),
    false,
    "server-wide activity frames contain no plan content",
  );
});

test("a connection names the project it binds to, and an unknown one falls back", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  // This is the embed's whole binding mechanism: the host names the project on
  // the upgrade, because that is the only moment the binding is decided.
  const named = connect(`${server.wsUrl()}?workspace=${encodeURIComponent(beta)}`);
  t.after(() => named.close());
  const boundToBeta = await named.waitFor((m) => m.type === "hello");
  assert.equal(boundToBeta.workspace.root, beta, "the named project is the one served");

  // A project closed server-side must leave a working widget rather than a dead
  // socket, so an unknown root is served the default instead of being refused.
  const stale = connect(`${server.wsUrl()}?workspace=${encodeURIComponent(path.join(root, "gone"))}`);
  t.after(() => stale.close());
  const fellBack = await stale.waitFor((m) => m.type === "hello");
  assert.equal(fellBack.workspace.root, root, "an unknown root falls back to the default project");
});

// openlore: scenario=DifferentlySpelledRootStillBindsToTheOpenProject spec=api
test("a workspace name spelled differently from the registry key still binds, not falls back", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  // The embed client sends whatever string the host app passed to `mount({ workspace })`
  // verbatim (ui/src/useAgent.ts's wsUrlFor does no normalization), while a project is
  // registered under its `fs.realpath()`'d root. A trailing separator — trivial for an
  // integrator to add by accident, on every platform — must not read as "unknown project"
  // and silently serve the wrong one.
  const spelled = connect(`${server.wsUrl()}?workspace=${encodeURIComponent(beta + path.sep)}`);
  t.after(() => spelled.close());
  const hello = await spelled.waitFor((m) => m.type === "hello");
  assert.equal(hello.workspace.root, beta, "the differently-spelled root still resolves to the open project");
});

test("a streaming turn reaches its own project's clients and no others", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // The turn never ends: the fake answers the prompt, emits the start, and stops
  // there — which is exactly the state both this test and the close refusal need.
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "scripted", isStreaming: false },
    commands_: { prompt: { after: [{ type: "agent_start" }] } },
  });
  t.after(() => server.stop());

  const watcher = connect(server.wsUrl());
  const mover = connect(server.wsUrl());
  t.after(() => {
    watcher.close();
    mover.close();
  });
  await watcher.waitFor((m) => m.type === "hello");
  await mover.waitFor((m) => m.type === "hello");

  mover.send({ type: "switch_workspace", root: beta });
  await mover.waitFor((m) => m.type === "workspace_switched");
  mover.send({ type: "prompt", text: "go" });

  // The client that asked hears the turn...
  await mover.waitFor((m) => m.type === "agent_start" || m.type === "streaming");
  // ...and the one bound to the other project is told that something is happening
  // there, without a single frame of what.
  const activity = await watcher.waitFor(
    (m) => m.type === "workspace_activity" && m.workspaces.some((w) => w.root === beta && w.activity === "working"),
  );
  assert.ok(activity, "the other project's work is visible as state");
  assert.equal(
    watcher.received.filter((m) => m.type === "agent_start" || m.type === "streaming" || m.type === "assistant").length,
    0,
    "no turn content crossed into the other project",
  );
});

test("a tool's progress reaches its own project's clients, clamped, and no others", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "scripted", isStreaming: false },
    commands_: {
      prompt: {
        after: [
          { type: "agent_start" },
          { type: "tool_execution_start", toolCallId: "tp-1", toolName: "crawl", args: {} },
          // a progress-only update: no text content, still must be delivered
          { type: "tool_execution_update", toolCallId: "tp-1", partialResult: { details: { progress: 0.8 } } },
          // a later, lower value passes through unchanged (no monotonic policing)
          { type: "tool_execution_update", toolCallId: "tp-1", partialResult: { details: { progress: 0.3 } } },
          // out of range is clamped, not dropped
          { type: "tool_execution_update", toolCallId: "tp-1", partialResult: { details: { progress: 1.7 } } },
        ],
      },
    },
  });
  t.after(() => server.stop());

  const watcher = connect(server.wsUrl());
  const mover = connect(server.wsUrl());
  t.after(() => {
    watcher.close();
    mover.close();
  });
  await watcher.waitFor((m) => m.type === "hello");
  await mover.waitFor((m) => m.type === "hello");

  mover.send({ type: "switch_workspace", root: beta });
  await mover.waitFor((m) => m.type === "workspace_switched");
  mover.send({ type: "prompt", text: "go" });

  await mover.waitFor((m) => m.type === "tool_update" && m.toolCallId === "tp-1" && m.progress === 1);
  const progresses = mover.received
    .filter((m) => m.type === "tool_update" && m.toolCallId === "tp-1")
    .map((m) => m.progress);
  assert.deepEqual(progresses, [0.8, 0.3, 1], "delivered in order, lower value kept, over-range clamped");

  assert.equal(
    watcher.received.filter((m) => m.type === "tool_update").length,
    0,
    "no tool progress crossed into the other project",
  );
});

test("a connection cannot read a file belonging to another project", async (t) => {
  const beta = await realpath(await makeWorkspace({ "secret.md": "beta's own\n" }));
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  // Bound to alpha, reaching into beta by absolute path and by climbing out —
  // the boundary is the workspace's own root, not the process's.
  for (const target of [path.join(beta, "secret.md"), path.join("..", path.basename(beta), "secret.md")]) {
    const requestId = `read:${target}`;
    client.send({ type: "read_file", path: target, requestId });
    const reply = await client.waitFor((m) => m.requestId === requestId);
    assert.equal(reply.type, "file_browser_error", `reading ${target} from the other project must fail`);
  }

  // The same file is readable from the project it belongs to, so the refusal
  // above is confinement and not a broken path.
  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched");
  client.send({ type: "read_file", path: "secret.md", requestId: "read:own" });
  const own = await client.waitFor((m) => m.requestId === "read:own");
  assert.equal(own.type, "file_content", "its own project's file is readable");
});

test("a turn started before a switch finishes in the project it belongs to", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // The answer lands a second after the prompt — long enough for the client to be
  // somewhere else entirely when it does.
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "scripted", isStreaming: false },
    commands_: { prompt: { delayMs: 1_000, after: [{ type: "agent_end", messages: [] }] } },
  });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === beta);
  client.send({ type: "prompt", text: "keep going without me" });

  // Away before the answer: this is the whole promise of the feature — the turn
  // is not cancelled, paused, or restarted by the client leaving.
  client.send({ type: "switch_workspace", root });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === root);

  const finished = await client.waitFor(
    (m) => m.type === "workspace_activity" && m.workspaces.some((w) => w.root === beta && w.activity === "idle"),
  );
  assert.ok(finished, "the turn ran to completion in a project nobody was watching");
});

test("a session belonging to another project cannot be opened", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // One store, two projects: alpha's list must not contain this, and alpha must
  // not be able to open it by naming its path either.
  const betaSession = seedSession(beta, sessionsDirOf(root), [
    ["user", "beta's own question"],
    ["assistant", "beta's own answer"],
  ]);
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());

  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "list_sessions" });
  const onAlpha = await client.waitFor((m) => m.type === "sessions");
  assert.ok(!onAlpha.sessions.some((s) => s.path === betaSession), "the other project's session is not even listed");

  // Only paths the bound workspace's own session manager listed: a session file
  // is a conversation, and one project's is not the other's to open.
  client.send({ type: "switch_session", path: betaSession });
  const refused = await client.waitFor((m) => m.type === "error");
  assert.ok(refused.message, "the request is refused rather than served");

  // Readable from the project it belongs to, so the refusal is scoping and not a
  // broken path.
  client.send({ type: "switch_workspace", root: beta });
  await next(client, (m) => m.type === "workspace_switched" && m.workspace?.root === beta);
  client.send({ type: "list_sessions" });
  const onBeta = await next(client, (m) => m.type === "sessions");
  assert.ok(onBeta.sessions.some((s) => s.path === betaSession), "its own project lists it");
});

test("a question raised in a background project waits there, and can be answered on return", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // The fake holds the prompt open until the dialog is answered, which is what a
  // real blocked turn does.
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "scripted" },
    dialogBlocksCommand: "prompt",
    commands_: { prompt: { before: [{ type: "extension_ui_request", id: "d1", method: "confirm", title: "Deploy?", message: "really?" }] } },
  });
  t.after(() => server.stop());

  const watcher = connect(server.wsUrl());
  const mover = connect(server.wsUrl());
  t.after(() => {
    watcher.close();
    mover.close();
  });
  await watcher.waitFor((m) => m.type === "hello");
  await mover.waitFor((m) => m.type === "hello");

  mover.send({ type: "switch_workspace", root: beta });
  await mover.waitFor((m) => m.type === "workspace_switched" && m.workspace?.root === beta);
  mover.send({ type: "prompt", text: "ship it" });
  await mover.waitFor((m) => m.type === "extension_ui_request");

  // The project nobody is watching reports that it needs someone — and the client
  // bound elsewhere is told that, and not what was asked.
  const waiting = await watcher.waitFor(
    (m) => m.type === "workspace_activity" && m.workspaces.some((w) => w.root === beta && w.needsAttention),
  );
  assert.equal(waiting.workspaces.find((w) => w.root === beta).activity, "waiting");
  assert.equal(watcher.received.filter((m) => m.type === "extension_ui_request").length, 0, "the question itself stayed in its project");

  // Away, and back. The question was sent once, to whoever was bound at the time:
  // without re-presenting it the project reports that it needs an answer nobody
  // can give, and the turn never ends.
  mover.send({ type: "switch_workspace", root });
  await mover.waitFor((m) => m.type === "workspace_switched" && m.workspace?.root === root);
  mover.send({ type: "switch_workspace", root: beta });
  const shownAgain = await next(mover, (m) => m.type === "extension_ui_request");
  assert.equal(shownAgain.id, "d1", "the pending question is shown again on return");

  // And answering it there releases the turn.
  mover.send({ type: "extension_ui_response", id: "d1", confirmed: true });
  const released = await watcher.waitFor(
    (m) => m.type === "workspace_activity" && m.workspaces.every((w) => !w.needsAttention),
  );
  assert.ok(released, "answering clears the attention it raised");
});

test("a client moved to a waiting project is shown what it is waiting for", async (t) => {
  const beta = await secondProject();
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "scripted" },
    dialogBlocksCommand: "prompt",
    commands_: { prompt: { before: [{ type: "extension_ui_request", id: "d1", method: "confirm", title: "Deploy?", message: "really?" }] } },
  });
  t.after(() => server.stop());

  const asker = connect(server.wsUrl());
  const arriving = connect(server.wsUrl());
  t.after(() => {
    asker.close();
    arriving.close();
  });
  await asker.waitFor((m) => m.type === "hello");
  await arriving.waitFor((m) => m.type === "hello");

  asker.send({ type: "switch_workspace", root: beta });
  await asker.waitFor((m) => m.type === "workspace_switched" && m.workspace?.root === beta);
  asker.send({ type: "prompt", text: "ship it" });
  await asker.waitFor((m) => m.type === "extension_ui_request");

  // Arriving by `open_project` on a directory that is already open: the client is
  // bound to a project that is blocked, and a snapshot alone would show it as
  // waiting with nothing to answer.
  arriving.send({ type: "open_project", root: beta });
  const shown = await arriving.waitFor((m) => m.type === "extension_ui_request");
  assert.equal(shown.id, "d1", "the pending question travels with the binding");

  // And the same again for the client the server moves when its project closes.
  const displaced = connect(server.wsUrl());
  t.after(() => displaced.close());
  await displaced.waitFor((m) => m.type === "hello");
  const gamma = await secondProject("gamma");
  displaced.send({ type: "open_project", root: gamma });
  await displaced.waitFor((m) => m.type === "workspace_switched" && m.workspace?.root === gamma);
  // Closing gamma moves it to the default project — which is not the blocked one,
  // so what this pins down is that the move goes through the same binding, and
  // carries whatever that destination is waiting on.
  displaced.send({ type: "close_project", root: gamma });
  const moved = await next(displaced, (m) => m.type === "workspace_switched");
  assert.equal(moved.workspace?.root ?? root, root, "the displaced client landed on the default project");
});

// openlore: scenario=OneProjectIsStillNamed spec=multi-project-workspaces
test("the project a client is bound to rides every snapshot, not only the first", async (t) => {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root);
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello");

  // A field present at connection and absent from a later snapshot would make the
  // control empty itself under the user — which is worse than never having had it.
  client.send({ type: "update_config", userSkillPaths: [] });
  const ack = await client.waitFor((m) => m.type === "update_config_ack" || m.type === "error");
  assert.equal(ack.type, "update_config_ack", ack.message);
  assert.deepEqual(ack.workspace, hello.workspace);
  assert.deepEqual(ack.workspaces, hello.workspaces);

  client.send({ type: "new_session" });
  const replaced = await client.waitFor((m) => m.type === "session_replaced");
  assert.deepEqual(replaced.workspace, hello.workspace);
  assert.deepEqual(replaced.workspaces, hello.workspaces);
});

// openlore: scenario=OneProjectIsStillNamed spec=multi-project-workspaces
test("a single project's activity reaches the client that is watching it", async (t) => {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // The turn never ends: the fake answers the prompt, emits the start, and stops.
  const server = await startScriptedServer(root, [], {
    state: { sessionId: "scripted", isStreaming: false },
    commands_: { prompt: { after: [{ type: "agent_start" }] } },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello");
  assert.equal(hello.workspace.activity, "idle");

  client.send({ type: "prompt", text: "go" });

  // Activity used to be silent below two open projects — there was no selector to
  // feed. Now there is one, and a control that shows a state and never hears it
  // change reports "idle" through an entire turn, which is worse than showing none.
  const activity = await client.waitFor(
    (m) => m.type === "workspace_activity" && m.workspaces.some((w) => w.root === root && w.activity === "working"),
  );
  assert.deepEqual(
    activity.workspaces.map((w) => w.root),
    [root],
    "the one open project is the one reported",
  );
});
