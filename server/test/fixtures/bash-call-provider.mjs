/**
 * Calls `bash` once — `echo from-the-shell` — then records the tool result the model
 * receives. Which `bash` ran is in that result: pi-outpost's runs the command, a
 * sandboxing extension's answers in its own words.
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
    const call = { type: "toolCall", id: `bash-${Date.now()}`, name: "bash", arguments: { command: "echo from-the-shell" } };
    const partial = message(model, [call], "toolUse");
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }

  const file = process.env.BASH_CALL_LOG;
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
  pi.registerProvider("bash-call-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "bash-call-test-api",
    models: [{
      id: "bash-call-test",
      name: "Bash Call Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
