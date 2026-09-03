/**
 * A provider that answers nothing and records everything: for each request, the names
 * of the tools it was actually sent.
 *
 * Reading the server's snapshot would say what the server believes it published. This
 * says what reached the model — which is the only thing that costs tokens, and the only
 * thing that decides whether a tool can be called on the turn that needs it.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

const require = createRequire(import.meta.url);

function record(context) {
  const fs = require("node:fs");
  const file = process.env.DOCUMENT_TOOLS_LOG;
  if (!file) return;
  fs.appendFileSync(file, `${JSON.stringify((context.tools ?? []).map((tool) => tool.name))}\n`);
}

/**
 * When asked to, the model calls the extractor rather than answering — which is what
 * separates a tool that earned its place from one published on a wrong guess.
 */
function wantsToolCall(context) {
  const last = [...(context.messages ?? [])].reverse().find((item) => item.role === "user");
  const text = JSON.stringify(last?.content ?? "");
  return text.includes("USE THE TOOL") && (context.tools ?? []).some((tool) => tool.name === "docx_extract");
}

function stream(model, context) {
  record(context);
  if (wantsToolCall(context) && !(context.messages ?? []).some((item) => item.role === "toolResult")) {
    const out = createAssistantMessageEventStream();
    const call = { type: "toolCall", id: `doc-${Date.now()}`, name: "docx_extract", arguments: { path: "report.docx" } };
    const partial = {
      role: "assistant", content: [call], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse", timestamp: Date.now(),
    };
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }
  const out = createAssistantMessageEventStream();
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
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
  pi.registerProvider("document-tools-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "document-tools-test-api",
    models: [{
      id: "document-tools-test",
      name: "Document Tools Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
