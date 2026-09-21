/**
 * The extended Work Plan tool, over a real server and a real embedded session: absent
 * until a plan exists, published for the turn that creates one, kept through the quiet
 * turns around the work, and withdrawn once the conversation has plainly moved on.
 *
 * The assertions read the tool list the *provider* was sent. What the snapshot says the
 * server published is a second-hand account; what the model received is the thing that
 * costs tokens and the thing it can call.
 *
 * Its 3.6 KB schema used to sit in every request for the life of a plan. Existing is
 * still necessary and no longer sufficient.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/work-plan-tools-provider.mjs", import.meta.url));
const EXTENDED = "work_plan_extended";

/** The tool names sent with each request that carried any, in order. */
async function requests(logFile) {
  const text = await readFile(logFile, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((tools) => tools.length > 0);
}

/**
 * The nth request's tool list, once it exists.
 *
 * The log is the thing being asserted, so wait on the log rather than on `agent_end`
 * frames — counting those races the harness's waiter, which resolves against any
 * received message the predicate accepts.
 */
async function nthRequest(logFile, index, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await requests(logFile);
    if (all.length > index) return all[index];
    if (Date.now() > deadline) throw new Error(`request ${index} never reached the model (${all.length} so far)`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("the extended Work Plan tool is withdrawn once the plan stops being worked", async () => {
  const root = await makeWorkspace();
  const log = path.join(root, "work-plan-tools.jsonl");
  const server = await startServer(
    root,
    {
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "work-plan-tools-test", id: "work-plan-tools-test" }],
    },
    { env: { WORK_PLAN_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 30_000);
    const published = hello.tools.filter((tool) => tool.active).map((tool) => tool.name);
    assert.ok(!published.includes(EXTENDED), "no plan, no extended tool");
    assert.ok(published.includes("work_plan"), "the common half is never withheld");

    client.send({ type: "set_model", provider: "work-plan-tools-test", id: "work-plan-tools-test" });
    await client.waitFor((message) => message.type === "model_changed");

    // A turn that creates no plan leaves it withheld.
    client.send({ type: "prompt", text: "Just say ok." });
    const plain = await nthRequest(log, 0);
    assert.ok(!plain.includes(EXTENDED), "still withheld for a prompt that touches no plan");
    assert.ok(plain.includes("work_plan"), "the common half is there to create one with");

    // Creating a plan publishes it from inside the turn — request 1 is the call that
    // created the plan, request 2 is the model being handed the result.
    client.send({ type: "prompt", text: "MAKE A PLAN please." });
    await nthRequest(log, 1);
    const afterCreate = await nthRequest(log, 2);
    assert.ok(afterCreate.includes(EXTENDED), "creating a plan publishes the extended half within the turn");

    // It survives the quiet turns around the work: five of them, since the turn that
    // touched the plan is not one of its idle turns.
    let request = 3;
    for (let turn = 1; turn <= 5; turn += 1) {
      client.send({ type: "prompt", text: `Quiet turn ${turn}.` });
      const during = await nthRequest(log, request++);
      assert.ok(during.includes(EXTENDED), `the extended half survives ${turn} idle turn(s)`);
    }

    // ...and is forgotten once the conversation has plainly moved on.
    client.send({ type: "prompt", text: "Quiet turn 6." });
    const forgotten = await nthRequest(log, request++);
    assert.ok(!forgotten.includes(EXTENDED), "five idle turns after the plan was last touched, and it is withdrawn");
    assert.ok(forgotten.includes("work_plan"), "the common half stays, which is the way back");

    // Withdrawing the tool is not clearing the plan. Read from a second connection's
    // snapshot rather than inferred from the republication below, which would pass just
    // as well if the plan had been destroyed and recreated.
    const observer = connect(server.wsUrl());
    try {
      const snapshot = await observer.waitFor("hello", 30_000);
      assert.ok(snapshot.workPlan, "the plan itself survives the withdrawal of the tool");
      assert.equal(snapshot.workPlan.title, "Test plan", "and it is the same plan");
    } finally {
      observer.close();
    }

    // The way back is the agent's own: a call to the half it still has republishes the
    // pair, from inside the turn, so the extended one is there for the very next request.
    client.send({ type: "prompt", text: "TOUCH THE PLAN again." });
    await nthRequest(log, request++);
    const republished = await nthRequest(log, request);
    assert.ok(republished.includes(EXTENDED), "touching the plan through work_plan brings the extended half back");
  } finally {
    client.close();
    await server.stop();
  }
});
