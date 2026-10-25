/**
 * Makes the tool calls listed in SCRIPTED_CALLS (a JSON array of `{ name, arguments }`), one per
 * turn, and appends each tool result the model receives to SCRIPTED_LOG, one JSON line per call:
 * `{ name, isError, text }`. Ends the run with "done" once the list is spent. The prompt is
 * ignored: the script is the test.
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
  const results = messages.filter((item, index) => item.role === "toolResult" && index > lastUserIndex);
  const last = results.at(-1);
  if (last && process.env.SCRIPTED_LOG) {
    const text = (last.content ?? []).map((part) => part.text ?? "").join("");
    appendFileSync(process.env.SCRIPTED_LOG, `${JSON.stringify({ name: last.toolName, isError: Boolean(last.isError), text })}\n`);
  }
  const next = calls()[results.length];
  const out = createAssistantMessageEventStream();
  if (next) {
    const call = { type: "toolCall", id: `call-${results.length}-${Date.now()}`, name: next.name, arguments: next.arguments };
    const partial = message(model, [call], "toolUse");
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
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
