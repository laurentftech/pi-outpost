/**
 * Makes the tool calls listed in SCRIPTED_CALLS (a JSON array of `{ name, arguments }`), one per
 * turn, and appends each tool result the model receives to SCRIPTED_LOG, one JSON line per call:
 * `{ name, isError, text }`. An entry `{ calls: [...] }` makes several calls in one message,
 * which the runtime runs together. Ends the run with "done" once the list is spent. The prompt
 * is ignored: the script is the test.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

function message(model, content, stopReason) {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: Date.now(),
  };
}

function calls() {
  const file = process.env.SCRIPTED_CALLS_FILE;
  return JSON.parse(file ? readFileSync(file, "utf8") : (process.env.SCRIPTED_CALLS ?? "[]"));
}

function stream(model, context) {
  const messages = context.messages ?? [];
  const lastUserIndex = messages.findLastIndex((item) => item.role === "user");
  // The step is the number of tool-calling turns so far; the results to log are the last turn's
  const step = messages.filter((item, index) => item.role === "assistant" && index > lastUserIndex).length;
  const lastAssistantIndex = messages.findLastIndex((item) => item.role === "assistant");
  const latest = lastAssistantIndex > lastUserIndex ? messages.filter((item, index) => item.role === "toolResult" && index > lastAssistantIndex) : [];
  if (process.env.SCRIPTED_LOG) {
    for (const result of latest) {
      const text = (result.content ?? []).map((part) => part.text ?? "").join("");
      appendFileSync(process.env.SCRIPTED_LOG, `${JSON.stringify({ name: result.toolName, isError: Boolean(result.isError), text })}\n`);
    }
  }
  const next = calls()[step];
  const out = createAssistantMessageEventStream();
  if (next) {
    const group = next.calls ?? [next];
    const toolCalls = group.map((entry, index) => ({ type: "toolCall", id: `call-${step}-${index}-${Date.now()}`, name: entry.name, arguments: entry.arguments }));
    const partial = message(model, toolCalls, "toolUse");
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      toolCalls.forEach((toolCall, contentIndex) => {
        out.push({ type: "toolcall_start", contentIndex, partial });
        out.push({ type: "toolcall_end", contentIndex, toolCall, partial });
      });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }
  const partial = message(model, [{ type: "text", text: "done" }], "stop");
  queueMicrotask(() => {
    out.push({ type: "start", partial });
    out.push({ type: "text_start", contentIndex: 0, partial });
    out.push({ type: "text_end", contentIndex: 0, content: "done", partial });
    out.push({ type: "done", reason: "stop", message: partial });
  });
  return out;
}

export default function (pi) {
  pi.registerProvider("scripted-calls-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "scripted-calls-test-api",
    models: [{
      id: "scripted-calls-test",
      name: "Scripted Calls Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
