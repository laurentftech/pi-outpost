/**
 * Side sessions: a second agent on a project that is already open, running at the
 * same time as the first, over the real server, the real WebSocket and the embedded
 * runtime — so each conversation has a real session file.
 *
 * The provider answers `ok: <prompt>` — which is how a test tells two conversations'
 * output apart — holds a turn open on `HOLD` until the test releases it, and calls the
 * real `write` tool on `WRITE <name>`.
 */
import assert from "node:assert/strict";
import { access, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { next, secondProject, startScriptedServer, wait } from "./multiProjectHarness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/side-sessions-provider.mjs", import.meta.url));
const MODEL = { provider: "side-sessions-test", id: "side-sessions-test" };

async function sideServer(t, config = {}) {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const release = path.join(root, "release-held-turns");
  const server = await startServer(
    root,
    { extensionPaths: [PROVIDER], allowedModels: [MODEL], ...config },
    { env: { SIDE_SESSIONS_RELEASE: release } },
  );
  t.after(() => server.stop());
  return { root, server, release: () => writeFile(release, "go\n") };
}

/** A client bound to the server's project, on the test model. */
async function mainClient(t, server) {
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor((m) => m.type === "model_changed");
  return { client, hello };
}

/** A client that starts a side session on `root` and is moved to it, on the test model. */
async function sideClient(t, server, root) {
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello", 30_000);
  client.send({ type: "open_side_session", root });
  const switched = await client.waitFor((m) => m.type === "workspace_switched" || m.type === "workspace_error", 30_000);
  assert.equal(switched.type, "workspace_switched", switched.message);
  client.send({ type: "set_model", ...MODEL });
  await next(client, (m) => m.type === "model_changed");
  return { client, switched };
}

/** The assistant answer carrying `text`, once it has arrived. */
function answer(client, text) {
  return client.waitFor((m) => m.type === "assistant_end" && JSON.stringify(m.item).includes(text), 30_000);
}

const said = (client, text) => client.received.some((m) => m.type === "assistant_end" && JSON.stringify(m.item).includes(text));

/** The next activity announcement whose list satisfies `predicate`. */
function activity(client, predicate) {
  return client.waitFor((m) => m.type === "workspace_activity" && predicate(m.workspaces), 30_000);
}

/** The live session file of the conversation a client is showing, from a listing. */
async function sessions(client) {
  client.send({ type: "list_sessions" });
  return (await next(client, (m) => m.type === "sessions")).sessions;
}

test("a side session starts while the project works, and both agents run at once", async (t) => {
  // ASideSessionStartsWhileTheProjectWorks, BothSessionsWorkAtTheSameTime
  const { root, server, release } = await sideServer(t);
  const { client: main } = await mainClient(t, server);
  main.send({ type: "prompt", text: "HOLD main work" });
  await main.waitFor((m) => m.type === "agent_start");

  const { client: side, switched } = await sideClient(t, server, root);
  assert.equal(switched.workspace.root, root, "the side session runs on the same project");
  assert.notEqual(switched.workspace.id, root, "and is not the project's main session");
  assert.equal(switched.items.length, 0, "in a new, empty conversation");
  assert.equal(switched.isStreaming, false);

  // The project's turn is still running: starting a side session interrupted nothing.
  const running = await activity(side, (list) => list.some((w) => w.id === root && w.activity === "working"));
  assert.ok(running);

  side.send({ type: "prompt", text: "side question" });
  await answer(side, "ok: side question");
  assert.ok(!said(main, "ok: side question"), "the side answer stayed in the side conversation");

  await release();
  await answer(main, "ok: HOLD main work");
  assert.ok(!said(side, "ok: HOLD main work"), "the main answer stayed in the main conversation");
});

test("a side session works in the project directory, visible from the project", async (t) => {
  // ASideSessionWorksInTheProjectDirectory
  const { root, server } = await sideServer(t);
  const { client: main } = await mainClient(t, server);
  const { client: side } = await sideClient(t, server, root);

  side.send({ type: "prompt", text: "WRITE from-side.txt" });
  await answer(side, "wrote");
  await access(path.join(root, "from-side.txt"));

  main.send({ type: "list_directory", path: ".", requestId: "after-write" });
  const listing = await main.waitFor((m) => m.requestId === "after-write");
  assert.ok(listing.entries.some((entry) => entry.name === "from-side.txt"), "the project sees the side session's file");
});

test("a side session is listed under its project, and a root alone still names the project", async (t) => {
  // ASideSessionIsListedUnderItsProject
  const { root, server } = await sideServer(t);
  const { client: main } = await mainClient(t, server);
  const { switched } = await sideClient(t, server, root);
  const sideId = switched.workspace.id;

  const listed = await activity(main, (list) => list.some((w) => w.id === sideId && w.activity === "idle"));
  const entry = listed.workspaces.find((w) => w.id === sideId);
  assert.equal(entry.sideOf, root);
  assert.equal(entry.label, "side session 1");
  assert.equal(entry.activity, "idle");
  assert.ok(listed.workspaces.some((w) => w.id === root && !w.sideOf), "beside the project's main session");

  // A client that predates side sessions addresses by root: it reaches the main session.
  const old = connect(server.wsUrl());
  t.after(() => old.close());
  await old.waitFor((m) => m.type === "hello");
  old.send({ type: "switch_workspace", root });
  const landed = await old.waitFor((m) => m.type === "workspace_switched");
  assert.equal(landed.workspace.id, root);
});

test("a side session is labelled by its conversation once it is named", async (t) => {
  // ASideSessionIsLabelledByItsConversation
  const { root, server } = await sideServer(t);
  const { client: main } = await mainClient(t, server);
  const { client: side, switched } = await sideClient(t, server, root);
  const sideId = switched.workspace.id;

  side.send({ type: "prompt", text: "fix the typo" });
  await answer(side, "ok: fix the typo");
  // Named after the first exchange by the session's own model — this provider answers
  // `ok: …` to the titling request too, so the name is whatever that produced.
  const named = await activity(main, (list) => list.some((w) => w.id === sideId && w.label !== "side session 1"));
  const label = named.workspaces.find((w) => w.id === sideId).label;
  const listed = await sessions(side);
  const live = listed.find((s) => s.name === label);
  assert.ok(live, `the label ${JSON.stringify(label)} is the conversation's name`);
});

test("switching away leaves a side session running, and its output is there on return", async (t) => {
  // SwitchingAwayLeavesTheSideSessionRunning
  const { root, server, release } = await sideServer(t);
  const { client: side, switched } = await sideClient(t, server, root);
  const sideId = switched.workspace.id;

  side.send({ type: "prompt", text: "HOLD long side task" });
  await side.waitFor((m) => m.type === "agent_start");
  side.send({ type: "switch_workspace", root, id: root });
  await side.waitFor((m) => m.type === "workspace_switched" && m.workspace.id === root);

  await release();
  // `next`, not `waitFor`: an earlier announcement already reported it idle.
  await next(side, (m) => m.type === "workspace_activity" && m.workspaces.some((w) => w.id === sideId && w.activity === "idle"));
  side.send({ type: "switch_workspace", root, id: sideId });
  const back = await next(side, (m) => m.type === "workspace_switched" && m.workspace.id === sideId);
  assert.ok(JSON.stringify(back.items).includes("ok: HOLD long side task"), "what it produced while away is shown");
});

test("a locked server refuses side sessions", async (t) => {
  // ALockedServerRefusesSideSessions
  const { root, server } = await sideServer(t, { workspaceLock: true });
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello");
  client.send({ type: "open_side_session", root });
  const refused = await client.waitFor((m) => m.type === "workspace_error");
  assert.match(refused.message, /pinned/);
  assert.ok(!hello.workspaces?.some((w) => w.sideOf), "no side session was opened");
});

test("closing a side session moves its clients to the project; a working one is not closed", async (t) => {
  // ClosingASideSessionMovesItsClientsToTheProject, ClosingAWorkingSideSessionIsRefused
  const { root, server, release } = await sideServer(t);
  const { client: side, switched } = await sideClient(t, server, root);
  const sideId = switched.workspace.id;

  side.send({ type: "prompt", text: "HOLD busy" });
  await side.waitFor((m) => m.type === "agent_start");
  side.send({ type: "close_project", root, id: sideId });
  const refused = await side.waitFor((m) => m.type === "workspace_error");
  assert.match(refused.message, /side session 1.*working/);

  await release();
  await answer(side, "ok: HOLD busy");
  side.send({ type: "close_project", root, id: sideId });
  const moved = await next(side, (m) => m.type === "workspace_switched");
  assert.equal(moved.workspace.id, root, "moved to the project's main session");
  await activity(side, (list) => !list.some((w) => w.id === sideId));
});

test("a project closes with its side sessions, and not while one of them works", async (t) => {
  // ClosingAProjectClosesItsSideSessions, AProjectWithAWorkingSideSessionCannotBeClosed
  const { server, release } = await sideServer(t);
  const beta = await secondProject();
  const { client: main } = await mainClient(t, server);
  main.send({ type: "open_project", root: beta });
  await main.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === beta, 30_000);
  const { client: side, switched } = await sideClient(t, server, beta);
  const sideId = switched.workspace.id;

  side.send({ type: "prompt", text: "HOLD on beta" });
  await side.waitFor((m) => m.type === "agent_start");
  main.send({ type: "close_project", root: beta });
  const refused = await main.waitFor((m) => m.type === "workspace_error");
  assert.equal(refused.message, `side session 1 (${path.basename(beta)}) is working — stop its turn before closing the project`);
  assert.ok((await activity(main, (list) => list.some((w) => w.id === sideId))), "both still open");

  await release();
  await answer(side, "ok: HOLD on beta");
  main.send({ type: "close_project", root: beta });
  const closed = await activity(main, (list) => !list.some((w) => w.root === beta));
  assert.ok(!closed.workspaces.some((w) => w.id === sideId), "the side session closed with its project");
});

test("an idle side session nobody watches is closed, not retired, and its conversation is kept", async (t) => {
  // AnIdleSideSessionIsClosedNotRetired, ASideConversationIsKeptInHistory
  const { root, server } = await sideServer(t, { workspaceIdleTimeoutMs: 2_000 });
  const { client: main } = await mainClient(t, server);
  const { client: side, switched } = await sideClient(t, server, root);
  const sideId = switched.workspace.id;
  side.send({ type: "prompt", text: "remember this" });
  await answer(side, "ok: remember this");
  side.close();

  await wait(6_000);
  const gone = await activity(main, (list) => !list.some((w) => w.id === sideId));
  assert.ok(gone);
  const listed = await sessions(main);
  const kept = listed.find((s) => s.firstMessage.includes("remember this"));
  assert.ok(kept, "the side conversation is in the project's history");
  assert.equal(kept.liveIn, undefined, "and no longer marked live anywhere");

  main.send({ type: "switch_session", path: kept.path });
  const reopened = await main.waitFor((m) => m.type === "session_replaced" || (m.type === "error" && /conversation/.test(m.message)), 30_000);
  assert.notEqual(reopened.type, "error", reopened.message);
});

test("side sessions are not reopened after a restart; their conversations are", async (t) => {
  // SideSessionsDoNotSurviveARestart
  // The project and the session store outlive the first server: `stop()` deletes the
  // server's own directory, so neither may live under it.
  const project = await secondProject("gamma");
  const agentDir = await makeWorkspace();
  const config = { extensionPaths: [PROVIDER], allowedModels: [MODEL], openProjects: [project], agentDir };
  const first = await startServer(await realpath(await makeWorkspace()), config);
  try {
    const { client: side } = await sideClient(t, first, project);
    side.send({ type: "prompt", text: "before the restart" });
    await answer(side, "ok: before the restart");
    // The answer is not yet the saved conversation: the SDK tells its listeners about a
    // message before it appends it to the file, and a conversation's first write is a
    // line-by-line loop. On Windows `stop()` is `taskkill /F`, which can land inside that
    // loop and leave a header with no messages — a lost conversation this test would
    // blame on the restart. Stop once the history lists it, which it reads from disk.
    for (const deadline = Date.now() + 30_000; ; await wait(100)) {
      if ((await sessions(side)).some((s) => s.firstMessage.includes("before the restart"))) break;
      assert.ok(Date.now() < deadline, "the conversation was saved before the restart");
    }
  } finally {
    await first.stop();
  }

  const second = await startServer(await realpath(await makeWorkspace()), config);
  t.after(() => second.stop());
  const { client, hello } = await mainClient(t, second);
  assert.ok(hello.workspaces.some((w) => w.id === project), "the project is open again");
  assert.ok(!hello.workspaces.some((w) => w.sideOf), "without its side session");
  client.send({ type: "switch_workspace", root: project });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.id === project, 30_000);
  assert.ok((await sessions(client)).some((s) => s.firstMessage.includes("before the restart")), "its conversation is in the history");
});

test("a side session nobody watches asks for attention when its turn waits on the user", async (t) => {
  // AWaitingSideSessionAsksForAttention
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  // A scripted RPC agent holds the prompt open on a question, as a real blocked turn does.
  const server = await startScriptedServer(root, [], {
    state: { sessionId: "scripted" },
    dialogBlocksCommand: "prompt",
    commands_: { prompt: { before: [{ type: "extension_ui_request", id: "d1", method: "confirm", title: "Deploy?", message: "really?" }] } },
  });
  t.after(() => server.stop());
  const watcher = connect(server.wsUrl());
  t.after(() => watcher.close());
  await watcher.waitFor((m) => m.type === "hello", 30_000);

  const side = connect(server.wsUrl());
  t.after(() => side.close());
  await side.waitFor((m) => m.type === "hello", 30_000);
  side.send({ type: "open_side_session", root });
  const switched = await side.waitFor((m) => m.type === "workspace_switched", 30_000);
  const sideId = switched.workspace.id;
  side.send({ type: "prompt", text: "ship it" });
  await side.waitFor((m) => m.type === "extension_ui_request");
  // Nobody is left watching it.
  side.send({ type: "switch_workspace", root, id: root });

  const waiting = await activity(watcher, (list) => list.some((w) => w.id === sideId && w.needsAttention));
  assert.equal(waiting.workspaces.find((w) => w.id === sideId).activity, "waiting");
  assert.ok(!waiting.workspaces.find((w) => w.id === root).needsAttention, "the project's main session is not the one waiting");
  assert.equal(watcher.received.filter((m) => m.type === "extension_ui_request").length, 0, "the question stayed in the side session");
});

test("a conversation live in one session cannot be opened in another, and the list says where it is", async (t) => {
  // OpeningAConversationLiveElsewhereIsRefused, TheListShowsWhereAConversationIsLive
  const { root, server } = await sideServer(t);
  const { client: main, hello } = await mainClient(t, server);
  main.send({ type: "prompt", text: "main conversation" });
  await answer(main, "ok: main conversation");
  const { client: side, switched } = await sideClient(t, server, root);
  side.send({ type: "prompt", text: "side conversation" });
  await answer(side, "ok: side conversation");

  const fromSide = await sessions(side);
  const mainConversation = fromSide.find((s) => s.firstMessage.includes("main conversation"));
  assert.equal(mainConversation.liveIn, path.basename(root), "the side session's list says where the main conversation is live");
  assert.equal(fromSide.find((s) => s.firstMessage.includes("side conversation")).liveIn, undefined, "its own is not marked");

  // Labelled by its conversation's name, once named: which one does not matter here,
  // only that the main session's list names the side session holding it.
  const fromMain = await sessions(main);
  const sideConversation = fromMain.find((s) => s.firstMessage.includes("side conversation"));
  assert.ok(sideConversation.liveIn?.endsWith(`(${path.basename(root)})`), `marked as live in the side session, got ${sideConversation.liveIn}`);
  assert.notEqual(sideConversation.liveIn, path.basename(root));

  side.send({ type: "switch_session", path: mainConversation.path });
  const refused = await next(side, (m) => m.type === "error");
  assert.match(refused.message, new RegExp(`open in ${path.basename(root)}`));
  // Both kept their conversations.
  side.send({ type: "list_sessions" });
  main.send({ type: "switch_workspace", root, id: root });
  const mainNow = await next(main, (m) => m.type === "workspace_switched");
  assert.equal(mainNow.sessionId, hello.sessionId, "the main session still shows its conversation");
  side.send({ type: "switch_workspace", root, id: switched.workspace.id });
  const sideNow = await next(side, (m) => m.type === "workspace_switched");
  assert.ok(JSON.stringify(sideNow.items).includes("ok: side conversation"), "the side session still shows its own");
});

test("Settings applied from the project reach its side session, which keeps its conversation", async (t) => {
  // APermissionChangeReachesTheSideSession
  const readOnly = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const guarded = await startServer(
    readOnly,
    { extensionPaths: [PROVIDER], allowedModels: [MODEL], sandbox: { root: readOnly, allowWrite: false, allowBash: false } },
  );
  t.after(() => guarded.stop());
  const { client: main } = await mainClient(t, guarded);
  const { client: side, switched } = await sideClient(t, guarded, readOnly);
  side.send({ type: "prompt", text: "keep this thread" });
  await answer(side, "ok: keep this thread");
  // Read-only to begin with, or the write below would prove nothing.
  side.send({ type: "prompt", text: "WRITE before-settings.txt" });
  await answer(side, "wrote");
  await assert.rejects(access(path.join(readOnly, "before-settings.txt")), "the side session could not write yet");

  main.send({ type: "update_config", sandbox: { root: readOnly, allowWrite: true, allowBash: false } });
  const ack = await main.waitFor((m) => m.type === "update_config_ack" || m.type === "error", 30_000);
  assert.equal(ack.type, "update_config_ack", ack.message);

  side.send({ type: "set_model", ...MODEL });
  await next(side, (m) => m.type === "model_changed");
  side.send({ type: "prompt", text: "WRITE after-settings.txt" });
  await next(side, (m) => m.type === "assistant_end" && JSON.stringify(m.item).includes("wrote"));
  await access(path.join(readOnly, "after-settings.txt"));

  side.send({ type: "switch_workspace", root: readOnly, id: readOnly });
  await next(side, (m) => m.type === "workspace_switched");
  side.send({ type: "switch_workspace", root: readOnly, id: switched.workspace.id });
  const back = await next(side, (m) => m.type === "workspace_switched");
  assert.ok(JSON.stringify(back.items).includes("ok: keep this thread"), "the side conversation was kept through the rebuild");
});

test("Settings wait for a side session that is working, and change nothing", async (t) => {
  // SettingsWaitForAWorkingSideSession
  const { root, server, release } = await sideServer(t);
  const { client: main } = await mainClient(t, server);
  const { client: side } = await sideClient(t, server, root);
  side.send({ type: "prompt", text: "HOLD settings" });
  await side.waitFor((m) => m.type === "agent_start");

  main.send({ type: "update_config", sandbox: { root, allowWrite: false, allowBash: false } });
  const refused = await main.waitFor((m) => m.type === "error", 30_000);
  assert.equal(refused.message, `side session 1 (${path.basename(root)}) is working — wait for its turn to finish before applying settings`);
  assert.equal(main.received.filter((m) => m.type === "session_replaced").length, 0, "the main session was not rebuilt");

  // Nothing was applied: the side session's turn ran to its end.
  await release();
  await answer(side, "ok: HOLD settings");
});

test("a client that switches elsewhere while its side session builds is not pulled back to it", async (t) => {
  // Found by driving the app: + then another project before the answer landed the
  // tab in the side session, overriding the user's later choice.
  const { root, server } = await sideServer(t);
  const beta = await secondProject();
  const { client } = await mainClient(t, server);
  client.send({ type: "open_project", root: beta });
  await client.waitFor((m) => m.type === "workspace_switched" && m.workspace.root === beta, 30_000);

  client.send({ type: "open_side_session", root });
  client.send({ type: "switch_workspace", root });
  const listed = await activity(client, (list) => list.some((w) => w.sideOf === root && w.activity === "idle"));
  assert.ok(listed, "the side session was still started, and is listed");
  await wait(500);
  const last = client.received.filter((m) => m.type === "workspace_switched").at(-1);
  assert.equal(last.workspace.id, root, "the client stays where it last chose to be");
});

test("a side session starts on the model and thinking level the project is using", async (t) => {
  // ASideSessionStartsOnTheProjectsModel
  const REASONING = { provider: "side-sessions-test", id: "side-sessions-reasoning" };
  const { root, server } = await sideServer(t, { allowedModels: [MODEL, REASONING] });
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello", 30_000);
  assert.notEqual(hello.model, "side-sessions-test/side-sessions-reasoning", "the project does not start on the model under test");
  client.send({ type: "set_model", ...REASONING });
  await client.waitFor((m) => m.type === "model_changed");
  client.send({ type: "set_thinking", level: "high" });
  await client.waitFor((m) => m.type === "thinking_changed" && m.level === "high");

  const other = connect(server.wsUrl());
  t.after(() => other.close());
  await other.waitFor((m) => m.type === "hello", 30_000);
  other.send({ type: "open_side_session", root });
  const switched = await other.waitFor((m) => m.type === "workspace_switched", 30_000);
  assert.equal(switched.model, "side-sessions-test/side-sessions-reasoning");
  assert.equal(switched.thinkingLevel, "high");
});
