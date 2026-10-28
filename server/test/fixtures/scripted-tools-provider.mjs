/**
 * A provider that plays a script of tool calls and records what each request carried.
 *
 * A user message holding `STEPS:[{"tool":…,"args":…},…]` is played one step per request:
 * the step to emit is the number of tool results since that message, and once the steps
 * run out the turn ends with "ok". Each request appends a line to SCRIPTED_TOOLS_LOG:
 * the tools declared, whether the system prompt says how to load the deferred ones, and
 * the text of the tool results since the last user message.
 *
 * Written for the deferred tools: an agent that searches, then calls what it found, is a
 * sequence no single canned answer can play.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { promptOf, toolsOf } from "./transcriptContext.mjs";

const require = createRequire(import.meta.url);

const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).filter((block) => block?.type === "text").map((block) => block.text ?? "").join("");

function sinceLastUser(context) {
  const messages = context.messages ?? [];
  let last = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") last = index;
  });
  return { user: messages[last], after: messages.slice(last + 1) };
}

function record(context) {
  const file = process.env.SCRIPTED_TOOLS_LOG;
  if (!file) return;
  const { after } = sinceLastUser(context);
  const line = {
    tools: toolsOf(context).map((tool) => tool.name),
    hint: promptOf(context).includes("load it with tool_search"),
    results: after.filter((message) => message.role === "toolResult").map((message) => textOf(message.content)),
  };
  require("node:fs").appendFileSync(file, `${JSON.stringify(line)}\n`);
}

function nextStep(context) {
  const { user, after } = sinceLastUser(context);
  const match = /STEPS:(\[.*\])/s.exec(textOf(user?.content));
  if (!match) return undefined;
  const steps = JSON.parse(match[1]);
  return steps[after.filter((message) => message.role === "toolResult").length];
}

function respond(model, content, stopReason) {
  const out = createAssistantMessageEventStream();
  const message = {
    role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, timestamp: Date.now(),
  };
  queueMicrotask(() => {
    out.push({ type: "start", partial: message });
    if (stopReason === "toolUse") {
      out.push({ type: "toolcall_start", contentIndex: 0, partial: message });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: message });
    } else {
      out.push({ type: "text_start", contentIndex: 0, partial: message });
      out.push({ type: "text_end", contentIndex: 0, content: "ok", partial: message });
    }
    out.push({ type: "done", reason: stopReason, message });
  });
  return out;
}

function stream(model, context) {
  record(context);
  const step = nextStep(context);
  if (step) {
    const call = { type: "toolCall", id: `step-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: step.tool, arguments: step.args ?? {} };
    return respond(model, [call], "toolUse");
  }
  return respond(model, [{ type: "text", text: "ok" }], "stop");
}

export default function (pi) {
  pi.registerProvider("scripted-tools-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "scripted-tools-test-api",
    models: [{
      id: "scripted-tools-test",
      name: "Scripted Tools Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
