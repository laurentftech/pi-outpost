/**
 * Queued prompts over a real connection and a real session (queued-prompts). A fake provider
 * holds each request behind a gate file of its own, so a test keeps a turn running while it
 * queues, edits and removes prompts, then releases the gates and reads what the agent was
 * actually sent.
 *
 * Each test boots a server. Keep the count low.
 */
import assert from "node:assert/strict";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/queued-prompts-provider.mjs", import.meta.url));
const FAKE_RPC = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));
const REAL_PI = fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url));
const MODEL = { provider: "queue-test", id: "queue-test" };
const IMAGE = { data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", mimeType: "image/png" };
const SKILL = "---\nname: greet\ndescription: Greets the user.\n---\nSay hello warmly.\n";

async function requests(log) {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function eventually(check, what, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The first message matching `predicate` received after this call. */
function next(client, predicate, timeoutMs = 30_000) {
  const seen = client.received.length;
  return client.waitFor((message) => client.received.indexOf(message) >= seen && predicate(message), timeoutMs);
}

/** The queue as the client last heard it. */
const latestQueue = (client) => client.received.filter((message) => message.type === "queue").at(-1)?.prompts ?? [];
const queueTexts = (client) => latestQueue(client).map((prompt) => prompt.text);
const users = (client) => client.received.filter((message) => message.type === "user");

async function boot(t, configFor = {}, files = {}) {
  const root = await realpath(await makeWorkspace({ "notes.md": "notes\n", ...files }));
  const config = typeof configFor === "function" ? configFor(root) : configFor;
  const log = path.join(root, "requests.jsonl");
  const gates = path.join(root, "gate");
  const server = await startServer(
    root,
    { ...(config.agentRuntime ? {} : { extensionPaths: [PROVIDER], allowedModels: [MODEL] }), ...config },
    { env: { QUEUE_LOG: log, QUEUE_GATES: gates, FAKE_PI_RPC_CONFIG: config.fakeConfig ?? "" } },
  );
  const clients = [];
  const open = async () => {
    const client = connect(server.wsUrl());
    clients.push(client);
    const hello = await client.waitFor("hello", 30_000);
    return { client, hello };
  };
  // One hook, in this order: on Windows the workspace cannot be removed while the server, or its
  // Pi child, still runs in it.
  t.after(async () => {
    for (const client of clients) client.close();
    await server.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const { client, hello } = await open();
  if (!config.fakeConfig && !config.agentRuntime) {
    client.send({ type: "set_model", ...MODEL });
    await client.waitFor("model_changed");
  }
  const gate = (n) => `${gates}-${n}`;
  return { root, log, gate, server, client, hello, open };
}

/** Start a turn held on gate 1, and return once its first request is waiting. */
async function holdTurn({ client, log, gate }, ...gates) {
  for (const n of [1, ...gates]) await writeFile(gate(n), "");
  client.send({ type: "prompt", text: "start" });
  await eventually(async () => (await requests(log)).length >= 1, "the turn's first request");
}

// openlore: scenario=AQueuedPromptWaitsAsAPendingBubble spec=queued-prompts
// openlore: scenario=AQueuedPromptJoinsTheConversationWhenDelivered spec=queued-prompts
// openlore: scenario=ALateClientSeesThePendingPrompts spec=queued-prompts
// openlore: scenario=EditAQueuedPrompt spec=queued-prompts
// openlore: scenario=AnEditStartsFromWhatWasTyped spec=queued-prompts
// openlore: scenario=RemoveAQueuedPrompt spec=queued-prompts
// openlore: scenario=APromptSentDuringAnEditQueuesAfterIt spec=queued-prompts
test("embedded: queued prompts wait as typed, are edited and removed in place, and reach the agent as edited", async (t) => {
  const ctx = await boot(t, (root) => ({ skillPaths: [path.join(root, "skills", "greet")] }), { "skills/greet/SKILL.md": SKILL });
  const { client, log, gate, open } = ctx;
  await holdTurn(ctx);

  // Queued with an image: pending, as typed, editable — and not echoed into the conversation.
  client.send({ type: "prompt", text: "/skill:greet once", images: [IMAGE] });
  await next(client, (message) => message.type === "queue" && message.prompts.length === 1);
  assert.deepEqual(latestQueue(client).map(({ text, images, kind, editable }) => ({ text, images, kind, editable })), [
    { text: "/skill:greet once", images: [IMAGE], kind: "steer", editable: true },
  ]);
  client.send({ type: "prompt", text: "second" });
  await eventually(() => queueTexts(client).length === 2, "the second prompt queued");
  assert.deepEqual(users(client).map((message) => message.text), ["start"], "a queued prompt is not in the conversation yet");

  // Another client sees the same queue on connect.
  const late = await open();
  assert.deepEqual(late.hello.queuedPrompts?.map((prompt) => prompt.text), ["/skill:greet once", "second"]);

  // Edit the first; a prompt sent right behind the edit lands after the re-queue, not inside it.
  const [first, second] = latestQueue(client);
  client.send({ type: "edit_queued_prompt", id: first.id, text: "/skill:greet twice" });
  client.send({ type: "prompt", text: "third" });
  await eventually(() => queueTexts(client).join("|") === "/skill:greet twice|second|third", "edited in place, then the new prompt");
  assert.deepEqual(latestQueue(client)[0].images, [IMAGE], "the edit keeps the image");
  assert.deepEqual(latestQueue(client).slice(0, 2).map((prompt) => prompt.id), [first.id, second.id], "queued again under the same ids");
  await eventually(() => queueTexts(late.client).join("|") === "/skill:greet twice|second|third", "the other client follows");

  client.send({ type: "remove_queued_prompt", id: second.id });
  await eventually(() => queueTexts(client).join("|") === "/skill:greet twice|third", "the second removed");

  // Release: pi delivers the queue one message at a time, each opening the next request.
  await rm(gate(1));
  await eventually(async () => (await requests(log)).length >= 3, "a request per queued prompt");
  await client.waitFor("agent_end");
  const sent = await requests(log);
  const skillTurn = sent[1].users.at(-1);
  assert.match(skillTurn.text, /Say hello warmly/, "the edited prompt, expanded again from what was typed");
  assert.match(skillTurn.text, /twice/);
  assert.doesNotMatch(skillTurn.text, /once/);
  assert.deepEqual(skillTurn.images, ["image/png"], "with its image");
  assert.equal(sent[2].users.at(-1).text, "third");
  assert.ok(sent.every((request) => request.users.every((user) => user.text !== "second")), "the removed prompt never reached the agent");

  // In the conversation once each, as typed, where the agent read them: after the reply before.
  assert.deepEqual(users(client).map((message) => message.text), ["start", "/skill:greet twice", "third"]);
  assert.deepEqual(users(client)[1].images, [IMAGE]);
  const order = client.received.map((message) => (message.type === "user" ? `user:${message.text}` : message.type === "assistant_end" ? "reply" : undefined)).filter(Boolean);
  assert.deepEqual(order, ["user:start", "reply", "user:/skill:greet twice", "reply", "user:third", "reply"]);
  assert.deepEqual(latestQueue(client), [], "nothing left pending");
});

// openlore: scenario=AnEditOfADeliveredPromptIsRefused spec=queued-prompts
// openlore: scenario=RemovingADeliveredPromptIsRefused spec=queued-prompts
// openlore: scenario=APendingPromptOutlivesAnAbort spec=queued-prompts
test("embedded: a prompt the agent received is not changed, and one left by an abort stays pending", async (t) => {
  const ctx = await boot(t);
  const { client, log, gate, open } = ctx;
  await holdTurn(ctx, 2);
  client.send({ type: "prompt", text: "A" });
  client.send({ type: "prompt", text: "B" });
  await eventually(() => queueTexts(client).join("|") === "A|B", "both queued");
  const [a] = latestQueue(client);

  // Gate 1 alone: pi delivers A, and request 2 holds with B still queued.
  await rm(gate(1));
  await eventually(async () => (await requests(log)).length >= 2, "A delivered");
  await eventually(() => queueTexts(client).join("|") === "B", "only B pending");

  const refusedEdit = next(client, (message) => message.type === "queued_prompt_refused");
  client.send({ type: "edit_queued_prompt", id: a.id, text: "A edited" });
  const edit = await refusedEdit;
  assert.match(edit.message, /no longer in the queue/);
  assert.equal(edit.text, "A edited", "the edit goes back to the composer");
  const refusedRemoval = next(client, (message) => message.type === "queued_prompt_refused");
  client.send({ type: "remove_queued_prompt", id: a.id });
  assert.equal((await refusedRemoval).text, undefined);
  assert.deepEqual(users(client).map((message) => message.text), ["start", "A"], "A is in the conversation once, unchanged");
  assert.deepEqual(queueTexts(client), ["B"], "B is still pending");

  // Stopped: pi keeps B queued, and so does the list — for every client.
  client.send({ type: "abort" });
  await client.waitFor("agent_end");
  const late = await open();
  assert.deepEqual(late.hello.queuedPrompts?.map(({ text, editable }) => ({ text, editable })), [{ text: "B", editable: true }]);

  // Edited while idle, it stays queued: an edit never starts a turn.
  const starts = client.received.filter((message) => message.type === "agent_start").length;
  client.send({ type: "edit_queued_prompt", id: latestQueue(client)[0].id, text: "B edited" });
  await eventually(() => queueTexts(client).join("|") === "B edited", "B edited while idle");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(client.received.filter((message) => message.type === "agent_start").length, starts, "no turn started");
  const before = (await requests(log)).length;

  // The next prompt takes it along.
  client.send({ type: "prompt", text: "C" });
  await eventually(async () => (await requests(log)).slice(before).some((request) => request.users.some((user) => user.text === "B edited")), "B edited delivered with the next turn");
  await eventually(() => latestQueue(client).length === 0, "nothing left pending");
});

// openlore: scenario=EditAQueuedPrompt spec=queued-prompts
// openlore: scenario=RemoveAQueuedPrompt spec=queued-prompts
test("rpc: a real Pi child's queue is edited and pruned with clear_queue and steer", async (t) => {
  const ctx = await boot(t, {
    sandbox: false,
    agentRuntime: {
      mode: "rpc",
      executable: process.execPath,
      args: [REAL_PI, "--provider", MODEL.provider, "--model", MODEL.id, "--api-key", "test", "--extension", PROVIDER, "--no-approve"],
      startupTimeoutMs: 15_000,
    },
  });
  const { client, log, gate } = ctx;
  await holdTurn(ctx);
  client.send({ type: "prompt", text: "A", images: [IMAGE] });
  client.send({ type: "prompt", text: "B" });
  await eventually(() => queueTexts(client).join("|") === "A|B", "both queued in the child");
  assert.ok(latestQueue(client).every((prompt) => prompt.editable), "standard pi can take its queue back");
  const [a, b] = latestQueue(client);
  client.send({ type: "edit_queued_prompt", id: a.id, text: "A edited" });
  client.send({ type: "remove_queued_prompt", id: b.id });
  await eventually(() => queueTexts(client).join("|") === "A edited", "edited and pruned");

  await rm(gate(1));
  await client.waitFor("agent_end");
  const sent = await requests(log);
  const delivered = sent.flatMap((request) => request.users.map((user) => user.text));
  assert.ok(delivered.includes("A edited") && !delivered.includes("A") && !delivered.includes("B"), JSON.stringify(delivered));
  assert.deepEqual(sent.find((request) => request.users.some((user) => user.text === "A edited")).users.at(-1).images, ["image/png"]);
  assert.deepEqual(users(client).map((message) => message.text), ["start", "A edited"]);
});

// openlore: scenario=ARuntimeWithoutClearQueueIsReadOnly spec=queued-prompts
test("rpc: a dialect without clear_queue shows its queue read-only and refuses edits", async (t) => {
  const root = await realpath(await makeWorkspace({}));
  const fakeConfig = path.join(root, "fake-rpc.json");
  const commandLog = path.join(root, "commands.jsonl");
  await writeFile(fakeConfig, JSON.stringify({
    commandLog,
    // OMP's dialect: no get_tree, branch messages instead — and so no clear_queue either.
    failures: { get_tree: "Unknown command: get_tree" },
    omitResponseIdsFor: ["get_tree"],
    commands_: {
      get_branch_messages: { data: { messages: [] } },
      prompt: [
        { after: [{ type: "agent_start" }] },
        { data: { disposition: "queued" }, after: [{ type: "queue_update", steering: ["later"], followUp: [] }] },
      ],
    },
  }));
  const ctx = await boot(t, {
    fakeConfig,
    sandbox: false,
    agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE_RPC], startupTimeoutMs: 15_000 },
  });
  const { client } = ctx;
  client.send({ type: "prompt", text: "start" });
  await client.waitFor("agent_start");
  client.send({ type: "prompt", text: "later" });
  await eventually(() => queueTexts(client).join("|") === "later", "queued");
  assert.equal(latestQueue(client)[0].editable, false, "no edit or remove action");
  const refused = next(client, (message) => message.type === "queued_prompt_refused");
  client.send({ type: "edit_queued_prompt", id: latestQueue(client)[0].id, text: "sooner" });
  assert.match((await refused).message, /not available with the rpc agent runtime/);
  const commands = (await readFile(commandLog, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).type);
  assert.ok(!commands.includes("clear_queue"), "the child was never asked to clear");
});

// openlore: scenario=AnExtensionMessageMakesTheQueueReadOnly spec=queued-prompts
test("embedded: a message an extension queued makes the whole queue read-only", async (t) => {
  const ctx = await boot(t);
  const { client } = ctx;
  await holdTurn(ctx);
  client.send({ type: "prompt", text: "mine" });
  await eventually(() => queueTexts(client).join("|") === "mine", "mine queued");
  assert.equal(latestQueue(client)[0].editable, true);

  // The extension queues a follow-up of its own when it sees this text.
  client.send({ type: "prompt", text: "queue one for me" });
  await eventually(() => queueTexts(client).includes("from an extension"), "the extension's follow-up queued").catch((error) => {
    throw new Error(`${error.message}: ${JSON.stringify(client.received.filter((m) => !["block_delta"].includes(m.type)).map((m) => [m.type, m.text ?? m.message ?? m.prompts]))}`);
  });
  assert.deepEqual(latestQueue(client).map(({ text, kind, editable }) => ({ text, kind, editable })), [
    { text: "mine", kind: "steer", editable: false },
    { text: "queue one for me", kind: "steer", editable: false },
    { text: "from an extension", kind: "followUp", editable: false },
  ]);
  const refused = next(client, (message) => message.type === "queued_prompt_refused");
  client.send({ type: "edit_queued_prompt", id: latestQueue(client)[0].id, text: "mine, changed" });
  assert.match((await refused).message, /extension/);
  assert.equal(latestQueue(client)[0].text, "mine", "nothing was taken back");
});

// openlore: scenario=EditCreatesBranch spec=conversation-tree
// openlore: scenario=EditRefusedWhileRunning spec=conversation-tree
test("embedded: a sent prompt is edited by rewinding into a branch, and not while a turn runs", async (t) => {
  const ctx = await boot(t);
  const { client, gate } = ctx;
  client.send({ type: "prompt", text: "first ask" });
  const entries = await client.waitFor((message) => message.type === "user_entries" && message.entries.length === 1);

  // While a turn runs, the server refuses to rewind.
  const held = gate((await requests(ctx.log)).length + 1);
  await writeFile(held, "");
  const started = next(client, (message) => message.type === "agent_start");
  client.send({ type: "prompt", text: "second ask" });
  await started;
  const refused = next(client, (message) => message.type === "error");
  client.send({ type: "edit_prompt", entryId: entries.entries[0].entryId, text: "first ask, edited mid-turn" });
  assert.match((await refused).message, /while the agent is running/);
  const ended = next(client, (message) => message.type === "agent_end");
  client.send({ type: "abort" });
  await ended;
  await rm(held, { force: true });

  // Idle: the edit rewinds to before the first prompt and asks again, beside the original.
  const branched = next(client, (message) => message.type === "tree" && message.roots.length === 2);
  client.send({ type: "edit_prompt", entryId: entries.entries[0].entryId, text: "first ask, edited" });
  const tree = await branched;
  assert.deepEqual(tree.roots.map((root) => root.text).sort(), ["first ask", "first ask, edited"]);
  const last = (await requests(ctx.log)).at(-1);
  assert.deepEqual(last.users.map((user) => user.text), ["first ask, edited"], "the agent is asked the edit, without the rewound turns");
});
