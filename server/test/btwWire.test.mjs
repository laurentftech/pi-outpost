/**
 * `/btw` over a real connection, a real session and a fake provider that records every request
 * (btw-side-question). The provider holds a turn open after a real `read`, so a side question is
 * asked while the agent works, from what the session holds at that moment.
 *
 * Each test boots a server. Keep the count low.
 */
import assert from "node:assert/strict";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/btw-provider.mjs", import.meta.url));
const REAL_PI = fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url));
const MODEL = { provider: "btw-test", id: "btw-test" };
const NOT_AVAILABLE = "This command is not available.";

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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The first message matching `predicate` received after this call. */
function next(client, predicate, timeoutMs = 30_000) {
  const seen = client.received.length;
  return client.waitFor((message) => client.received.indexOf(message) >= seen && predicate(message), timeoutMs);
}

const btwWidget = (message) => message.type === "extension_ui_request" && message.method === "setWidget" && message.widgetKey === "btw";
// The latest question answered: the panel now also shows earlier answers above it.
const answered = (message) => btwWidget(message) && message.widgetLines?.at(-1)?.startsWith("Side answer to:");
const conversationText = (request) => request.messages.map((item) => item.text).join("\n");

async function boot(t, config = {}, files = {}) {
  const root = await realpath(await makeWorkspace({ "notes.md": "We decided to ship on Friday.\n", ...files }));
  t.after(() => rm(root, { recursive: true, force: true }));
  const log = path.join(root, "requests.jsonl");
  const gate = path.join(root, "gate");
  const server = await startServer(
    root,
    { ...(config.agentRuntime ? {} : { extensionPaths: [PROVIDER], allowedModels: [MODEL] }), ...config },
    { env: { BTW_LOG: log, BTW_GATE: gate } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 30_000);
  if (!config.agentRuntime) {
    client.send({ type: "set_model", ...MODEL });
    await client.waitFor("model_changed");
  }
  return { root, log, gate, server, client, hello };
}

/** Starts `read notes.md` and returns once the turn waits on the gate, after its tool result. */
async function turnHeldAfterRead({ client, log, gate }) {
  await writeFile(gate, "");
  client.send({ type: "prompt", text: "read notes.md" });
  await eventually(async () => (await requests(log)).filter((request) => request.kind === "turn" && request.messages.some((item) => item.role === "toolResult")).length > 0, "the turn's request after the read");
}

// openlore: scenario=ASideQuestionIsAnsweredWhileTheAgentWorks spec=btw-side-question
// openlore: scenario=TheAnswerIsMadeFromTheWorkSoFar spec=btw-side-question
// openlore: scenario=NoToolIsOffered spec=btw-side-question
// openlore: scenario=AHandledCommandIsNotEchoed spec=btw-side-question
// openlore: scenario=TheQuestionIsNotInTheHistory spec=btw-side-question
// openlore: scenario=AnIdleSessionCanBeAsked spec=btw-side-question
// openlore: scenario=AFailureIsShownInThePanel spec=btw-side-question
// openlore: scenario=AnotherConversationClosesThePanel spec=btw-side-question
// openlore: scenario=AFollowUpSeesTheEarlierSideQuestions spec=btw-side-question
// openlore: scenario=ClosingForgetsTheThread spec=btw-side-question
// openlore: scenario=TheCloseControlClosesThePanel spec=btw-side-question
// openlore: scenario=APlainMessageGoesToTheAgentWhileThePanelIsOpen spec=btw-side-question
test("embedded: a side question mid-turn is answered from the work so far, and stays out of the conversation", async (t) => {
  const ctx = await boot(t);
  const { client, log, gate, server } = ctx;
  await turnHeldAfterRead(ctx);
  const errorsBefore = client.received.filter((message) => message.type === "error").length;

  // Asked while the turn waits: answered, with the turn still running.
  const answer = next(client, answered);
  client.send({ type: "prompt", text: "/btw which files did you read?" });
  assert.deepEqual((await answer).widgetLines.filter((line) => line.startsWith("Side answer to:")), ["Side answer to: which files did you read?"]);
  assert.equal((await answer).widgetPlacement, "aboveEditor");
  assert.equal(client.received.filter((message) => message.type === "agent_end").length, 0, "the turn is still running");

  const side = (await requests(log)).filter((request) => request.kind === "side");
  assert.equal(side.length, 1);
  assert.deepEqual(side[0].tools, [], "no tool is offered");
  assert.match(conversationText(side[0]), /called read \{"path":"notes\.md"\}/, "the read the agent made");
  assert.match(conversationText(side[0]), /We decided to ship on Friday/, "and what it returned");
  assert.equal(side[0].messages.at(-1).text, "which files did you read?", "the question, in a message of its own");

  // The turn goes on to its end, its output kept, and nothing of the question reaches it.
  const ended = next(client, (message) => message.type === "agent_end");
  await rm(gate);
  await ended;
  client.send({ type: "prompt", text: "anything else?" });
  await next(client, (message) => message.type === "agent_end");
  const turns = (await requests(log)).filter((request) => request.kind === "turn");
  for (const request of turns) assert.doesNotMatch(conversationText(request), /which files|Side answer/, "no turn request carries the question or its answer");
  assert.ok(turns.at(-1).messages.some((item) => item.role === "assistant" && item.text === "done"), "the held turn's answer was kept");

  const echoed = client.received.filter((message) => message.type === "user").map((message) => message.text);
  assert.deepEqual(echoed, ["read notes.md", "anything else?"], "the handled command is not echoed");
  assert.equal(client.received.filter((message) => message.type === "error").length, errorsBefore, "no error banner");

  // Idle: answered, and no turn starts.
  const idleAnswer = next(client, answered);
  const starts = client.received.filter((message) => message.type === "agent_start").length;
  client.send({ type: "prompt", text: "/btw what did we decide?" });
  assert.ok((await idleAnswer).widgetLines.includes("Side answer to: what did we decide?"));
  const followUp = conversationText((await requests(log)).filter((request) => request.kind === "side").at(-1));
  assert.match(followUp, /ship on Friday/);
  assert.match(followUp, /Side question: which files did you read\?\nSide answer: Side answer to: which files did you read\?/, "the earlier side question is carried");
  const lines = (await idleAnswer).widgetLines;
  assert.ok(lines.indexOf("› which files did you read?") < lines.indexOf("› what did we decide?"), "the earlier exchange is shown above the new one");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(client.received.filter((message) => message.type === "agent_start").length, starts, "no turn started");

  // A provider failure goes in the panel, not the error banner.
  const failed = next(client, (message) => btwWidget(message) && message.widgetLines?.some((line) => line.startsWith("No answer")));
  client.send({ type: "prompt", text: "/btw will this fail?" });
  assert.ok((await failed).widgetLines.includes("No answer: provider down."));
  assert.equal(client.received.filter((message) => message.type === "error").length, errorsBefore, "the error banner is unchanged");

  // Reloaded: neither question nor answer is in the conversation.
  const again = connect(server.wsUrl());
  t.after(() => again.close());
  const reloaded = await again.waitFor("hello", 30_000);
  const items = JSON.stringify(reloaded.items);
  assert.match(items, /read notes\.md/, "precondition: the history is there");
  assert.doesNotMatch(items, /btw|which files|Side answer|what did we decide/);

  // Closing from one client (the × sends `/btw` alone) closes it for both, adds nothing, starts nothing,
  // and forgets the thread.
  const closedHere = next(client, (message) => btwWidget(message) && message.widgetLines === undefined);
  const closedThere = next(again, (message) => btwWidget(message) && message.widgetLines === undefined);
  const startsBeforeClose = client.received.filter((message) => message.type === "agent_start").length;
  again.send({ type: "prompt", text: "/btw" });
  await Promise.all([closedHere, closedThere]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(client.received.filter((message) => message.type === "agent_start").length, startsBeforeClose, "closing starts no turn");
  assert.deepEqual(client.received.filter((message) => message.type === "user").map((message) => message.text), echoed, "closing adds no message");
  const fresh = next(client, answered);
  client.send({ type: "prompt", text: "/btw a fresh one?" });
  await fresh;
  assert.doesNotMatch(conversationText((await requests(log)).filter((request) => request.kind === "side").at(-1)), /earlier_side_questions|Side question:/, "the thread was forgotten");

  // Another conversation closes the panel.
  const closed = next(client, (message) => btwWidget(message) && message.widgetLines === undefined);
  client.send({ type: "new_session" });
  await closed;
});

// openlore: scenario=ABlockedBtwIsNeitherOfferedNorRun spec=btw-side-question
test("embedded: a blocked /btw is neither offered nor run", async (t) => {
  const { client, log, hello } = await boot(t, { blockedCommands: ["btw"] });
  assert.ok(!(hello.commands ?? []).some((command) => command.name === "btw"), "not offered");
  const error = next(client, (message) => message.type === "error");
  client.send({ type: "prompt", text: "/btw where are you at?" });
  assert.equal((await error).message, NOT_AVAILABLE);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await requests(log)).length, 0, "no model request");
  assert.equal(client.received.filter(btwWidget).length, 0);
});

// openlore: scenario=ASideQuestionIsAnsweredWhileTheAgentWorks spec=btw-side-question
// openlore: scenario=AHandledCommandIsNotEchoed spec=btw-side-question
// openlore: scenario=AHandledCommandStartsNoTurn spec=btw-side-question
test("rpc: a real Pi child answers /btw mid-turn, echoes nothing, and a handled command leaves the session idle", async (t) => {
  const ctx = await boot(t, {
    sandbox: undefined,
    agentRuntime: {
      mode: "rpc",
      executable: process.execPath,
      args: [REAL_PI, "--provider", MODEL.provider, "--model", MODEL.id, "--api-key", "test", "--extension", PROVIDER, "--no-approve"],
      startupTimeoutMs: 15_000,
    },
  });
  const { client, log, gate, hello } = ctx;
  assert.ok((hello.commands ?? []).some((command) => command.name === "btw"), "the child offers /btw");

  // Idle: handled, answered, and the plain message after it starts a turn of its own.
  const idle = next(client, answered);
  client.send({ type: "prompt", text: "/btw are you there?" });
  assert.ok((await idle).widgetLines.includes("Side answer to: are you there?"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const started = next(client, (message) => message.type === "agent_start");
  client.send({ type: "prompt", text: "hello" });
  await started;
  await next(client, (message) => message.type === "agent_end");

  // Mid-turn: answered while the turn waits.
  await turnHeldAfterRead(ctx);
  const answer = next(client, answered);
  client.send({ type: "prompt", text: "/btw which files did you read?" });
  assert.ok((await answer).widgetLines.includes("Side answer to: which files did you read?"));
  const side = (await requests(log)).filter((request) => request.kind === "side").at(-1);
  assert.deepEqual(side.tools, []);
  assert.match(conversationText(side), /called read \{"path":"notes\.md"\}/);
  const ended = next(client, (message) => message.type === "agent_end");
  await rm(gate);
  await ended;

  assert.deepEqual(client.received.filter((message) => message.type === "user").map((message) => message.text), ["hello", "read notes.md"]);
  for (const request of (await requests(log)).filter((request) => request.kind === "turn")) {
    assert.doesNotMatch(conversationText(request), /which files|are you there|Side answer/);
  }
});
