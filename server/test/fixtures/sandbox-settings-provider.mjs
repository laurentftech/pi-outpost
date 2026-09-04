/**
 * Calls the real `ls` tool once, then records the tool result the model receives.
 * The wire test uses that result to prove which sandbox root the live agent owns.
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
    const userText = lastUserIndex < 0
      ? ""
      : messages[lastUserIndex].content
          .filter?.((part) => part.type === "text")
          .map((part) => part.text)
          .join(" ") ?? String(messages[lastUserIndex].content);
    const readPath = /skill|extension/i.test(userText) ? process.env.SANDBOX_SETTINGS_READ_PATH : undefined;
    const call = readPath
      ? { type: "toolCall", id: `read-${Date.now()}`, name: "read", arguments: { path: readPath } }
      : { type: "toolCall", id: `ls-${Date.now()}`, name: "ls", arguments: { path: "." } };
    const partial = message(model, [call], "toolUse");
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }

  const file = process.env.SANDBOX_SETTINGS_LOG;
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
  if (process.env.SANDBOX_SETTINGS_VETO === "1") {
    pi.on("session_before_switch", async (event) => {
      if (event.reason === "new") return { cancel: true };
    });
  }
  pi.registerProvider("sandbox-settings-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "sandbox-settings-test-api",
    models: [{
      id: "sandbox-settings-test",
      name: "Sandbox Settings Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
