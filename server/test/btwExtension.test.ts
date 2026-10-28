/**
 * The `/btw` extension on its own (btw-side-question): what it shows, what it cancels, and what
 * it sends. A fake `pi` collects the command and hooks; a fake context records the widget and
 * hands each model request a promise the test settles.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BTW_WIDGET, createBtwExtension, serialiseBranch, sideQuestionContext } from "../src/btwExtension.ts";

type Handler = (args: string, ctx: unknown) => Promise<void>;
type Hook = (event: unknown, ctx: unknown) => unknown;

interface Request {
  context: { systemPrompt: string; messages: { role: string; content: { text: string }[] }[]; tools?: unknown };
  options: { signal: AbortSignal; cacheRetention?: string; sessionId?: string };
  settle(reply: { stopReason: string; content?: unknown[]; errorMessage?: string }): void;
}

function harness(options: { model?: { provider: string; id: string } | undefined; auth?: boolean; budget?: number } = {}) {
  let command: Handler | undefined;
  const hooks = new Map<string, Hook>();
  const pi = {
    registerCommand: (name: string, spec: { handler: Handler }) => {
      assert.equal(name, "btw");
      command = spec.handler;
    },
    on: (event: string, hook: Hook) => hooks.set(event, hook),
  };
  createBtwExtension(options.budget === undefined ? {} : { budget: options.budget })(pi as never);

  const widgets: (string[] | undefined)[] = [];
  const requests: Request[] = [];
  const branch: unknown[] = [
    { type: "message", id: "1", message: { role: "user", content: "what is in notes.md?" } },
    { type: "message", id: "2", message: { role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "notes.md" } }] } },
    { type: "message", id: "3", message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "ship Friday" }] } },
  ];
  const ctx = {
    model: "model" in options ? options.model : { provider: "p", id: "m" },
    modelRegistry: {
      hasConfiguredAuth: () => options.auth ?? true,
      streamSimple: (_model: unknown, context: Request["context"], streamOptions: Request["options"]) => {
        let settle!: Request["settle"];
        const result = new Promise<unknown>((resolve) => {
          settle = resolve;
        });
        requests.push({ context, options: streamOptions, settle });
        return { result: () => result };
      },
    },
    sessionManager: { getBranch: () => branch },
    ui: {
      setWidget: (key: string, lines: string[] | undefined, widgetOptions?: { placement?: string }) => {
        assert.equal(key, BTW_WIDGET);
        if (lines !== undefined) assert.equal(widgetOptions?.placement, "aboveEditor");
        widgets.push(lines);
      },
    },
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    widgets,
    requests,
    flush,
    ask: (args: string) => command!(args, ctx),
    hook: (name: string) => hooks.get(name)!({ type: name }, ctx),
  };
}

const TITLE = "Side answer · not part of the conversation";
const text = (reply: string) => ({ stopReason: "stop", content: [{ type: "text", text: reply }] });

describe("btw extension", () => {
  // openlore: scenario=TheWaitIsShown spec=btw-side-question
  test("TheWaitIsShown: the panel says it is a side answer, holds the question and says the answer is coming, and the command returns before it", async () => {
    const { widgets, requests, ask, flush } = harness();
    await ask("  where are you at?  ");
    assert.equal(requests.length, 1, "the request went out");
    assert.deepEqual(widgets.at(-1), [TITLE, "› where are you at?", "Answering…"]);

    requests[0]!.settle(text("Reading notes.md.\nNearly done."));
    await flush();
    assert.deepEqual(widgets.at(-1), [TITLE, "› where are you at?", "Reading notes.md.", "Nearly done."]);
  });

  // openlore: scenario=NoToolIsOffered spec=btw-side-question
  // openlore: scenario=TheAnswerIsMadeFromTheWorkSoFar spec=btw-side-question
  test("the request carries the branch and the question, no tools, no shared cache", async () => {
    const { requests, ask } = harness();
    await ask("which files did you read?");
    const { context, options } = requests[0]!;
    assert.equal(context.tools, undefined);
    assert.match(context.systemPrompt, /no tools/i);
    assert.match(context.messages[0]!.content[0]!.text, /called read \{"path":"notes\.md"\}/);
    assert.match(context.messages[0]!.content[0]!.text, /Result of read: ship Friday/);
    assert.equal(context.messages[1]!.content[0]!.text, "which files did you read?");
    assert.equal(options.cacheRetention, "none");
    assert.ok(options.sessionId);
  });

  // openlore: scenario=ANewQuestionReplacesTheWaitingOne spec=btw-side-question
  test("ANewQuestionReplacesTheWaitingOne: the first request is cancelled and its late answer never shown", async () => {
    const { widgets, requests, ask, flush } = harness();
    await ask("first?");
    await ask("second?");
    assert.equal(requests[0]!.options.signal.aborted, true, "the first request is cancelled");
    assert.equal(requests[1]!.options.signal.aborted, false);
    assert.deepEqual(widgets.at(-1), [TITLE, "› second?", "Answering…"]);

    requests[0]!.settle(text("late first answer"));
    requests[1]!.settle(text("second answer"));
    await flush();
    assert.ok(!widgets.some((lines) => lines?.includes("late first answer")), "the first answer is never shown");
    assert.deepEqual(widgets.at(-1), [TITLE, "› second?", "second answer"]);
  });

  // openlore: scenario=BtwAloneClosesThePanel spec=btw-side-question
  test("BtwAloneClosesThePanel: /btw alone closes the panel and cancels a waiting question", async () => {
    const { widgets, requests, ask, flush } = harness();
    await ask("anything?");
    await ask("   ");
    assert.equal(widgets.at(-1), undefined, "closed");
    assert.equal(requests[0]!.options.signal.aborted, true);
    requests[0]!.settle(text("too late"));
    await flush();
    assert.equal(widgets.at(-1), undefined, "and stays closed");
    assert.equal(requests.length, 1, "/btw alone asks nothing");
  });

  // openlore: scenario=AFailureIsShownInThePanel spec=btw-side-question
  test("AFailureIsShownInThePanel: no model, no credentials, a provider error or a throw is said in the panel", async () => {
    const noModel = harness({ model: undefined });
    await noModel.ask("q?");
    await noModel.flush();
    assert.ok(noModel.widgets.at(-1)?.includes("No answer: no model is selected."));
    assert.equal(noModel.requests.length, 0);

    const noAuth = harness({ auth: false });
    await noAuth.ask("q?");
    await noAuth.flush();
    assert.ok(noAuth.widgets.at(-1)?.includes("No answer: p/m has no credentials."));
    assert.equal(noAuth.requests.length, 0, "no call is made");

    const failing = harness();
    await failing.ask("q?");
    failing.requests[0]!.settle({ stopReason: "error", errorMessage: "rate limited" });
    await failing.flush();
    assert.ok(failing.widgets.at(-1)?.includes("No answer: rate limited."));
  });

  // openlore: scenario=AnotherConversationClosesThePanel spec=btw-side-question
  test("AnotherConversationClosesThePanel: session_start closes the panel and cancels the pending question", async () => {
    const { widgets, requests, ask, hook, flush } = harness();
    await ask("about this one?");
    await hook("session_start");
    assert.equal(widgets.at(-1), undefined);
    assert.equal(requests[0]!.options.signal.aborted, true);
    requests[0]!.settle(text("about the old one"));
    await flush();
    assert.equal(widgets.at(-1), undefined, "the old conversation's answer is not shown under the new one");
  });

  // openlore: scenario=ALongConversationIsCutFromTheFront spec=btw-side-question
  test("ALongConversationIsCutFromTheFront: fits the budget, keeps the latest messages whole, says what was left out", () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({ type: "message", id: String(i), message: { role: i % 2 ? "assistant" : "user", content: `message ${i} ${"x".repeat(200)}` } }));
    const budget = 2_000;
    const question = "what now?";
    const context = sideQuestionContext(entries, question, budget);
    const conversation = context.messages[0]!.content[0]!.text.replace(/^<conversation>\n/, "").replace(/\n<\/conversation>$/, "");
    assert.ok(conversation.length + question.length <= budget, `the request fits: ${conversation.length}`);
    assert.match(conversation, /\[Earlier conversation left out\.\]/);
    assert.ok(conversation.includes(`Assistant: message 49 ${"x".repeat(200)}`), "the last message, whole");
    assert.ok(!conversation.includes("message 0 "), "the first is gone");
    // Whole sections only: every kept message is complete.
    for (const line of conversation.split("\n\n").filter((part) => /^(User|Assistant):/.test(part))) {
      assert.match(line, new RegExp(`message \\d+ x{200}$`));
    }

    const short = serialiseBranch(entries.slice(-2), budget);
    assert.doesNotMatch(short, /left out/, "nothing left out, nothing said");
  });

  // openlore: scenario=AFollowUpSeesTheEarlierSideQuestions spec=btw-side-question
  test("AFollowUpSeesTheEarlierSideQuestions: the next request carries the answered ones, and the panel counts them", async () => {
    const { widgets, requests, ask, flush } = harness();
    await ask("which files did you read?");
    requests[0]!.settle(text("notes.md"));
    await flush();
    await ask("and what did it say?");
    const first = requests[1]!.context.messages[0]!.content[0]!.text;
    assert.match(first, /<earlier_side_questions>\nSide question: which files did you read\?\nSide answer: notes\.md\n<\/earlier_side_questions>$/);
    assert.ok(first.indexOf("</conversation>") < first.indexOf("<earlier_side_questions>"), "after the conversation");
    assert.equal(requests[1]!.context.messages[1]!.content[0]!.text, "and what did it say?");
    assert.deepEqual(widgets.at(-1), [TITLE, "› which files did you read?", "notes.md", "", "› and what did it say?", "Answering…"], "the earlier exchange above the new question");

    // A failed or cancelled question does not join the thread.
    requests[1]!.settle({ stopReason: "error", errorMessage: "rate limited" });
    await flush();
    await ask("cancelled?");
    await ask("third?");
    const third = requests[3]!.context.messages[0]!.content[0]!.text;
    assert.equal((third.match(/Side question:/g) ?? []).length, 1, "only the answered one");
    assert.doesNotMatch(third, /cancelled\?|what did it say/);
  });

  // openlore: scenario=ClosingForgetsTheThread spec=btw-side-question
  test("ClosingForgetsTheThread: /btw alone, or another conversation, forgets the earlier side questions", async () => {
    const { requests, ask, hook, flush } = harness();
    await ask("first?");
    requests[0]!.settle(text("one"));
    await flush();
    await ask("");
    await ask("after closing?");
    assert.doesNotMatch(requests[1]!.context.messages[0]!.content[0]!.text, /earlier_side_questions|first\?/);

    requests[1]!.settle(text("two"));
    await flush();
    await hook("session_start");
    await ask("in the new conversation?");
    assert.doesNotMatch(requests[2]!.context.messages[0]!.content[0]!.text, /earlier_side_questions|after closing/);
  });

  test("an over-long thread drops its oldest exchanges first, and the conversation still fits", () => {
    const thread = Array.from({ length: 20 }, (_, i) => ({ question: `q${i}`, answer: "a".repeat(100) }));
    const context = sideQuestionContext([{ type: "message", id: "1", message: { role: "user", content: "hello" } }], "now?", 1_000, thread);
    const first = context.messages[0]!.content[0]!.text;
    assert.ok(first.length <= 1_000 + "<conversation>\n\n</conversation>\n\n<earlier_side_questions>\n\n</earlier_side_questions>".length);
    assert.match(first, /Side question: q19\n/, "the latest exchange is kept");
    assert.doesNotMatch(first, /Side question: q0\n/, "the oldest is gone");
  });

  test("a compaction summary leads, followed by the kept messages", () => {
    const text = serialiseBranch([
      { type: "message", id: "old", message: { role: "user", content: "long gone" } },
      { type: "message", id: "kept", message: { role: "user", content: "still here" } },
      { type: "compaction", id: "c", summary: "we chose Friday", firstKeptEntryId: "kept" },
      { type: "message", id: "new", message: { role: "assistant", content: [{ type: "text", text: "latest" }] } },
    ]);
    assert.equal(text, "Summary of the conversation before this point: we chose Friday\n\nUser: still here\n\nAssistant: latest");
  });

  test("a latest message larger than the budget keeps its end", () => {
    const text = serialiseBranch([{ type: "message", id: "1", message: { role: "user", content: `start ${"y".repeat(5_000)} end` } }], 500);
    assert.ok(text.length <= 500);
    assert.ok(text.endsWith(" end"));
    assert.match(text, /left out/);
  });
});
