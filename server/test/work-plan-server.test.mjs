import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));
const REAL_PI = fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url));
const WORK_PLAN_PROVIDER = fileURLToPath(new URL("./fixtures/work-plan-rpc-provider.mjs", import.meta.url));

const evidence = () => [
  { id: "focused-tests", type: "test", result: "passed", summary: "Focused tests passed" },
  { id: "external-probe", type: "external-check", result: "failed", summary: "External probe failed" },
];
const replacementEvidence = () => [
  { id: "release-check", type: "command", result: "inconclusive", summary: "Release check timed out" },
];

const plan = (status = "in_progress", taskEvidence = evidence()) => ({
  version: 1,
  id: "release",
  title: "Prepare release",
  updatedAt: "2026-08-23T00:00:00.000Z",
  tasks: [
    { id: "build", title: "Build", status, dependsOn: [], resources: [], evidence: taskEvidence },
  ],
});

const messageAfter = (client, predicate, seen) => client.waitFor(
  (message) => predicate(message) && client.received.filter(predicate).length > seen,
);

test("workspace review readiness follows only persisted Work Plan transitions", async () => {
  const root = await makeWorkspace();
  const sessionFile = path.join(root, "review.jsonl");
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(sessionFile, "");
  const transition = (status) => ({
    writes: [{ path: `${sessionFile}.work-plan.json`, content: `${JSON.stringify(plan(status), null, 2)}\n` }],
    after: [
      { type: "agent_start" },
      {
        type: "tool_execution_end",
        toolCallId: `plan-${status}`,
        toolName: "work_plan",
        result: {
          content: [{ type: "text", text: "Work Plan updated." }],
          details: { type: "work_plan", sessionFile, plan: plan(status), changed: true },
        },
        isError: false,
      },
      { type: "agent_settled" },
    ],
  });
  await writeFile(fakeConfig, JSON.stringify({
    state: { sessionId: "review", sessionFile },
    commands_: { prompt: [transition("needs_review"), transition("in_progress"), transition("needs_review"), transition("done")] },
  }));

  const server = await startServer(
    root,
    { sandbox: undefined, agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 } },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  const client = connect(server.wsUrl());
  try {
    let workspaceRoot = root;
    const after = async (label, predicate, seen) => {
      try {
        return await messageAfter(client, predicate, seen);
      } catch (error) {
        const activity = client.received
          .filter((message) => message.type === "workspace_activity")
          .map((message) => message.workspaces.find((workspace) => workspace.root === workspaceRoot)?.activity);
        const statuses = client.received
          .filter((message) => message.type === "work_plan_changed")
          .map((message) => message.workPlan?.tasks[0]?.status);
        throw new Error(`${label} timed out; activities=${activity.join(",")}; planStatuses=${statuses.join(",")}`, { cause: error });
      }
    };
    const hello = await client.waitFor("hello");
    workspaceRoot = hello.workspace.root;
    assert.equal(hello.workspace.activity, "idle", "turn completion is not enough without a review-ready plan");

    const ended = (message) => message.type === "agent_end";
    const reviewPlanChanged = (message) => message.type === "work_plan_changed" && message.workPlan?.tasks[0]?.status === "needs_review";
    const activePlanChanged = (message) => message.type === "work_plan_changed" && message.workPlan?.tasks[0]?.status === "in_progress";
    const donePlanChanged = (message) => message.type === "work_plan_changed" && message.workPlan?.tasks[0]?.status === "done";
    const readyActivity = (message) => message.type === "workspace_activity" && message.workspaces.some((workspace) => workspace.root === workspaceRoot && workspace.activity === "ready-for-review");
    const workingActivity = (message) => message.type === "workspace_activity" && message.workspaces.some((workspace) => workspace.root === workspaceRoot && workspace.activity === "working");
    const idleActivity = (message) => message.type === "workspace_activity" && message.workspaces.some((workspace) => workspace.root === workspaceRoot && workspace.activity === "idle");

    let endCount = client.received.filter(ended).length;
    let planCount = client.received.filter(reviewPlanChanged).length;
    let activityCount = client.received.filter(readyActivity).length;
    client.send({ type: "prompt", text: "prepare review" });
    await after("first review plan", reviewPlanChanged, planCount);
    await after("first agent end", ended, endCount);
    const ready = await after("first ready activity", readyActivity, activityCount);
    const readySummary = ready.workspaces.find((workspace) => workspace.root === workspaceRoot);
    assert.equal(readySummary.needsAttention, true);
    assert.deepEqual(Object.keys(readySummary).sort(), ["activity", "name", "needsAttention", "root"]);

    endCount = client.received.filter(ended).length;
    planCount = client.received.filter(activePlanChanged).length;
    const workingCount = client.received.filter(workingActivity).length;
    activityCount = client.received.filter(idleActivity).length;
    client.send({ type: "prompt", text: "resume meaningful work" });
    await after("resumed working activity", workingActivity, workingCount);
    await after("resumed plan", activePlanChanged, planCount);
    await after("resumed agent end", ended, endCount);
    await after("resumed idle activity", idleActivity, activityCount);

    endCount = client.received.filter(ended).length;
    planCount = client.received.filter(reviewPlanChanged).length;
    activityCount = client.received.filter(readyActivity).length;
    client.send({ type: "prompt", text: "return for review" });
    await after("second review plan", reviewPlanChanged, planCount);
    await after("second agent end", ended, endCount);
    await after("second ready activity", readyActivity, activityCount);

    endCount = client.received.filter(ended).length;
    planCount = client.received.filter(donePlanChanged).length;
    activityCount = client.received.filter(idleActivity).length;
    client.send({ type: "prompt", text: "acknowledge review" });
    await after("acknowledged plan", donePlanChanged, planCount);
    await after("acknowledged agent end", ended, endCount);
    const acknowledged = await after("acknowledged idle activity", idleActivity, activityCount);
    assert.equal(acknowledged.workspaces.find((workspace) => workspace.root === workspaceRoot).needsAttention, undefined);
  } finally {
    client.close();
    await server.stop();
  }
});

test("running server restores, forks, reconnects, and broadcasts authoritative Work Plans", async () => {
  const root = await makeWorkspace();
  const source = path.join(root, "source.jsonl");
  const target = path.join(root, "fork.jsonl");
  const fakeConfig = path.join(root, "fake-rpc.json");
  const userEntry = {
    id: "user-1",
    parentId: null,
    timestamp: "2026-08-23T00:00:00.000Z",
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "Prepare it" }], timestamp: 1 },
  };
  await writeFile(source, "");
  await writeFile(`${source}.work-plan.json`, `${JSON.stringify(plan(), null, 2)}\n`);
  await writeFile(
    fakeConfig,
    JSON.stringify({
      state: { sessionId: "source", sessionFile: source },
      entries: [userEntry],
      tree: [{ entry: userEntry, children: [] }],
      leafId: "user-1",
      commands_: {
        compact: {
          writes: [{ path: source, content: "compacted conversation summary\n" }],
          after: [{ type: "compaction_start" }, { type: "compaction_end" }],
        },
        fork: {
          delayMs: 500,
          before: [{ type: "agent_start" }],
          data: { cancelled: false, text: "Prepare it" },
          replacement: {
            state: { sessionId: "fork", sessionFile: target },
            entries: [userEntry],
            tree: [{ entry: userEntry, children: [] }],
            leafId: "user-1",
          },
        },
        prompt: [
          {
            after: [{
              type: "tool_execution_end",
              toolCallId: "plan-get",
              toolName: "work_plan",
              result: {
                content: [{ type: "text", text: `Work Plan \"Prepare release\": 1 tasks (0 done).\n${JSON.stringify(plan())}` }],
                details: { type: "work_plan", sessionFile: target, plan: plan(), changed: false },
              },
              isError: false,
            }],
          },
          {
            after: [
              { type: "agent_start" },
              { type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: { path: "README.md" } },
              { type: "tool_execution_end", toolCallId: "read-1", toolName: "read", result: { content: [{ type: "text", text: "read" }] }, isError: false },
              { type: "agent_end", messages: [] },
            ],
          },
          {
            after: [{
              type: "tool_execution_end",
              toolCallId: "plan-invalid",
              toolName: "work_plan",
              result: {
                content: [{ type: "text", text: "Work Plan update refused: evidence[0] requires summary or reference" }],
                details: undefined,
                isError: true,
              },
              isError: true,
            }],
          },
          {
            writes: [{ path: `${target}.work-plan.json`, content: `${JSON.stringify(plan("in_progress", replacementEvidence()), null, 2)}\n` }],
            after: [{
              type: "tool_execution_end",
              toolCallId: "plan-evidence",
              toolName: "work_plan",
              result: {
                content: [{ type: "text", text: "Work Plan evidence replaced." }],
                details: { type: "work_plan", sessionFile: target, plan: plan("in_progress", replacementEvidence()), changed: true },
              },
              isError: false,
            }],
          },
          {
            writes: [{ path: `${target}.work-plan.json`, content: `${JSON.stringify(plan("done", replacementEvidence()), null, 2)}\n` }],
            after: [{
              type: "tool_execution_end",
              toolCallId: "plan-1",
              toolName: "work_plan",
              result: {
                content: [{ type: "text", text: "Work Plan updated." }],
                details: { type: "work_plan", sessionFile: target, plan: plan("done", replacementEvidence()), changed: true },
              },
              isError: false,
            }],
          },
        ],
      },
    }),
  );

  const server = await startServer(
    root,
    {
      sandbox: undefined,
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 },
    },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  const first = connect(server.wsUrl());
  let second;
  let third;
  let postCompaction;
  let afterUnrelatedTool;
  let invalidObserver;
  let concurrentFork;
  try {
    const hello = await first.waitFor("hello");
    assert.deepEqual(hello.workPlan, plan(), "the initial snapshot restores the session sidecar");

    first.send({ type: "compact" });
    await first.waitFor("compaction_end");
    assert.deepEqual(JSON.parse(await readFile(`${source}.work-plan.json`, "utf8")), plan());
    postCompaction = connect(server.wsUrl());
    assert.deepEqual((await postCompaction.waitFor("hello")).workPlan, plan(), "compaction does not alter plan availability");
    postCompaction.close();
    postCompaction = undefined;

    concurrentFork = connect(server.wsUrl());
    await concurrentFork.waitFor("hello");
    first.send({ type: "fork_session", entryId: "user-1" });
    await first.waitFor("agent_start");
    concurrentFork.send({ type: "fork_session", entryId: "user-1" });
    await concurrentFork.waitFor(
      (message) => message.type === "error" && message.message === "Session change already in progress",
    );
    const forkSnapshot = await first.waitFor(
      (message) => message.type === "session_replaced" && message.sessionId === "fork",
    );
    assert.deepEqual(forkSnapshot.workPlan, plan(), "the first fork snapshot already carries the inherited plan");
    const inherited = await first.waitFor(
      (message) => message.type === "work_plan_changed" && message.workPlan?.tasks[0]?.status === "in_progress",
    );
    assert.deepEqual(inherited.workPlan, plan());
    concurrentFork.close();
    concurrentFork = undefined;
    assert.equal(
      first.received.some((message) => message.type === "session_replaced" && message.sessionId === "fork" && message.workPlan === null),
      false,
      "the fork never broadcasts a transient empty plan",
    );
    assert.deepEqual(JSON.parse(await readFile(`${target}.work-plan.json`, "utf8")), plan());

    second = connect(server.wsUrl());
    const reconnected = await second.waitFor("hello");
    assert.equal(reconnected.sessionId, "fork");
    assert.deepEqual(reconnected.workPlan, plan(), "a reconnect receives the copied authoritative plan");

    first.send({ type: "prompt", text: "Read the Work Plan after compaction" });
    await first.waitFor((message) => message.type === "tool_end" && message.toolCallId === "plan-get");
    assert.deepEqual(JSON.parse(await readFile(`${target}.work-plan.json`, "utf8")), plan(), "post-compaction get leaves complete evidence unchanged");

    first.send({ type: "prompt", text: "Inspect without changing the plan" });
    await first.waitFor((message) => message.type === "tool_end" && message.toolCallId === "read-1");
    afterUnrelatedTool = connect(server.wsUrl());
    assert.equal(
      (await afterUnrelatedTool.waitFor("hello")).workPlan.tasks[0].status,
      "in_progress",
      "ordinary tool activity does not infer Work Plan completion",
    );
    afterUnrelatedTool.close();
    afterUnrelatedTool = undefined;

    const firstChanges = first.received.filter((message) => message.type === "work_plan_changed").length;
    const secondChanges = second.received.filter((message) => message.type === "work_plan_changed").length;
    first.send({ type: "prompt", text: "Record invalid evidence" });
    await first.waitFor((message) => message.type === "tool_end" && message.toolCallId === "plan-invalid");
    assert.equal(first.received.filter((message) => message.type === "work_plan_changed").length, firstChanges);
    assert.equal(second.received.filter((message) => message.type === "work_plan_changed").length, secondChanges);
    assert.deepEqual(JSON.parse(await readFile(`${target}.work-plan.json`, "utf8")), plan(), "invalid evidence leaves the sidecar unchanged");
    invalidObserver = connect(server.wsUrl());
    assert.deepEqual((await invalidObserver.waitFor("hello")).workPlan, plan(), "new clients still receive the prior authoritative evidence");
    invalidObserver.close();
    invalidObserver = undefined;

    first.send({ type: "prompt", text: "Replace the task evidence" });
    const evidenceChanged = (message) => message.type === "work_plan_changed"
      && message.workPlan?.tasks[0]?.evidence?.[0]?.id === "release-check";
    assert.deepEqual((await first.waitFor(evidenceChanged)).workPlan, plan("in_progress", replacementEvidence()));
    assert.deepEqual(
      (await second.waitFor(evidenceChanged)).workPlan,
      plan("in_progress", replacementEvidence()),
      "set_evidence immediately reaches every connected client",
    );
    assert.deepEqual(
      JSON.parse(await readFile(`${target}.work-plan.json`, "utf8")),
      plan("in_progress", replacementEvidence()),
      "the evidence broadcast matches persisted authoritative state",
    );

    first.send({ type: "prompt", text: "Finish the plan" });
    const finished = (message) => message.type === "work_plan_changed" && message.workPlan?.tasks[0]?.status === "done";
    assert.deepEqual((await first.waitFor(finished)).workPlan, plan("done", replacementEvidence()));
    assert.deepEqual((await second.waitFor(finished)).workPlan, plan("done", replacementEvidence()), "all clients receive one authoritative update");

    // There is deliberately no client-side mutation message in the protocol.
    // An unsolicited server-shaped frame is ignored and cannot replace state.
    first.send({ type: "work_plan_changed", workPlan: plan("blocked") });
    third = connect(server.wsUrl());
    assert.deepEqual((await third.waitFor("hello")).workPlan, plan("done", replacementEvidence()));
    assert.deepEqual(JSON.parse(await readFile(`${source}.work-plan.json`, "utf8")), plan(), "fork changes stay isolated");
  } finally {
    first.close();
    second?.close();
    third?.close();
    postCompaction?.close();
    afterUnrelatedTool?.close();
    invalidObserver?.close();
    concurrentFork?.close();
    await server.stop();
  }
});

test("a real Pi RPC child executes work_plan and synchronizes its persisted result", async () => {
  const root = await makeWorkspace();
  const server = await startServer(root, {
    sandbox: undefined,
    agentRuntime: {
      mode: "rpc",
      executable: process.execPath,
      args: [
        REAL_PI,
        "--provider", "work-plan-test",
        "--model", "work-plan-test",
        "--api-key", "test",
        "--extension", WORK_PLAN_PROVIDER,
        "--no-approve",
      ],
      startupTimeoutMs: 15_000,
    },
  });
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 30_000);
    client.send({ type: "prompt", text: "Create and refine the Work Plan" });
    const changed = await client.waitFor(
      (message) => message.type === "work_plan_changed"
        && message.workPlan?.title === "RPC release"
        && message.workPlan?.tasks.length === 2
        && message.workPlan.tasks[0].status === "done"
        && message.workPlan.tasks[0].evidence?.length === 2,
      30_000,
    );
    assert.equal(changed.workPlan.tasks[0].status, "done");
    assert.deepEqual(changed.workPlan.tasks[0].evidence, evidence());
    assert.equal(changed.workPlan.tasks[1].id, "release-note");
    await client.waitFor("agent_end", 30_000); // emitted only after the provider receives the fifth (`get`) result
    const sidecars = (await readdir(root, { recursive: true }))
      .filter((entry) => entry.endsWith(".work-plan.json"));
    assert.equal(sidecars.length, 1, "the real child persisted exactly one Work Plan sidecar");
    assert.deepEqual(JSON.parse(await readFile(path.join(root, sidecars[0]), "utf8")), changed.workPlan);
  } finally {
    client.close();
    await server.stop();
  }
});

test("the embedded SDK provider receives the same fully typed work_plan schema", async () => {
  const root = await makeWorkspace();
  const server = await startServer(
    root,
    {
      extensionPaths: [WORK_PLAN_PROVIDER],
      allowedModels: [{ provider: "work-plan-test", id: "work-plan-test" }],
    },
    // Embedded: this is the runtime that can withhold the extended tool, so this is
    // where its absence before a plan is a contract rather than an accident.
    { env: { WORK_PLAN_EXPECT_GATED: "1" } },
  );
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 30_000);
    assert.ok(hello.models.some((model) => model.provider === "work-plan-test" && model.id === "work-plan-test"));
    client.send({ type: "set_model", provider: "work-plan-test", id: "work-plan-test" });
    await client.waitFor((message) => message.type === "model_changed" && message.model === "work-plan-test/work-plan-test");
    client.send({ type: "prompt", text: "Create and refine the Work Plan" });
    const changed = await client.waitFor(
      (message) => message.type === "work_plan_changed"
        && message.workPlan?.title === "RPC release"
        && message.workPlan?.tasks.length === 2
        && message.workPlan.tasks[0].status === "done"
        && message.workPlan.tasks[0].evidence?.length === 2,
      30_000,
    );
    assert.equal(changed.workPlan.tasks[0].status, "done");
    assert.deepEqual(changed.workPlan.tasks[0].evidence, evidence());
    assert.equal(changed.workPlan.tasks[1].id, "release-note");
    await client.waitFor("agent_end", 30_000);
  } finally {
    client.close();
    await server.stop();
  }
});
