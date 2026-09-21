/**
 * A provider that records the tools it was sent, and calls the Work Plan tool when the
 * prompt tells it to.
 *
 * Same contract as `document-tools-provider.mjs`: the assertions read what reached the
 * model, not what the server believes it published. One difference matters — the guard on
 * "have I already answered with a tool call" is scoped to the turn rather than the whole
 * transcript. The extractor fixture calls its tool once per session and never again; this
 * one has to call `work_plan` a second time, several turns later, to prove that the agent
 * can bring the withdrawn half back by itself.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { toolsOf } from "./transcriptContext.mjs";

const require = createRequire(import.meta.url);

function record(context) {
  const fs = require("node:fs");
  const file = process.env.WORK_PLAN_TOOLS_LOG;
  if (!file) return;
  fs.appendFileSync(file, `${JSON.stringify(toolsOf(context).map((tool) => tool.name))}\n`);
}

/** The messages since the last user turn — where "have I answered this prompt yet" lives. */
function thisTurn(context) {
  const messages = context.messages ?? [];
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") { start = i; break; }
  }
  return start < 0 ? [] : messages.slice(start);
}

function promptText(context) {
  const turn = thisTurn(context);
  return JSON.stringify(turn[0]?.content ?? "");
}

/** Which call the prompt asks for, or undefined when it just wants an answer. */
function wantedCall(context) {
  // Already answered with a call this turn: the tool result is back, so reply now or the
  // turn never ends.
  if (thisTurn(context).some((message) => message?.role === "toolResult")) return undefined;
  const text = promptText(context);
  const available = new Set(toolsOf(context).map((tool) => tool.name));
  if (text.includes("MAKE A PLAN") && available.has("work_plan")) {
    return { name: "work_plan", arguments: { action: "create", title: "Test plan", tasks: [{ title: "First task" }] } };
  }
  if (text.includes("TOUCH THE PLAN") && available.has("work_plan")) {
    return { name: "work_plan", arguments: { action: "get" } };
  }
  return undefined;
}

const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function stream(model, context) {
  record(context);
  const identity = { api: model.api, provider: model.provider, model: model.id };
  const out = createAssistantMessageEventStream();
  const wanted = wantedCall(context);

  if (wanted) {
    const call = { type: "toolCall", id: `wp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...wanted };
    const partial = { role: "assistant", content: [call], ...identity, usage, stopReason: "toolUse", timestamp: Date.now() };
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }

  const message = {
    role: "assistant", content: [{ type: "text", text: "ok" }], ...identity, usage,
    stopReason: "stop", timestamp: Date.now(),
  };
  queueMicrotask(() => {
    out.push({ type: "start", partial: message });
    out.push({ type: "text_start", contentIndex: 0, partial: message });
    out.push({ type: "text_end", contentIndex: 0, content: "ok", partial: message });
    out.push({ type: "done", reason: "stop", message });
  });
  return out;
}

export default function (pi) {
  pi.registerProvider("work-plan-tools-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "work-plan-tools-test-api",
    models: [{
      id: "work-plan-tools-test",
      name: "Work Plan Tools Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
