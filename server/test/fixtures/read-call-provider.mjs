/**
 * Reads the path the prompt names — "read <path>" — with the real `read` tool, then
 * records the tool result the model receives: the file's text, or the sandbox's refusal.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

const require = createRequire(import.meta.url);

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

function stream(model, context) {
  const messages = context.messages ?? [];
  const lastUserIndex = messages.findLastIndex((item) => item.role === "user");
  const result = messages.findLast((item, index) => item.role === "toolResult" && index > lastUserIndex);
  const out = createAssistantMessageEventStream();

  if (!result) {
    const text = messages[lastUserIndex]?.content;
    const prompt = typeof text === "string" ? text : (text ?? []).filter((part) => part.type === "text").map((part) => part.text).join(" ");
    const target = prompt.replace(/^read\s+/, "").trim();
    const call = { type: "toolCall", id: `read-${Date.now()}`, name: "read", arguments: { path: target } };
    const partial = message(model, [call], "toolUse");
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }

  const file = process.env.READ_CALL_LOG;
  if (file) require("node:fs").writeFileSync(file, JSON.stringify(result.content));
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
  pi.registerProvider("read-call-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "read-call-test-api",
    models: [{
      id: "read-call-test",
      name: "Read Call Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
