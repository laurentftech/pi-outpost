/**
 * A provider that, asked what the reviewers said, calls `pdf_extract` on the reviewed
 * contract and records the tool result it was then sent.
 *
 * The point: the comments are only worth something if they reach the model. The
 * extraction is unit-tested elsewhere; this records what arrived in the context of a
 * real turn on a real server, after the tool's own wrapping and any sandbox around it.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { toolsOf } from "./transcriptContext.mjs";

const require = createRequire(import.meta.url);

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** The text of every tool result the model has been sent so far, appended to the log. */
function record(context) {
  const file = process.env.PDF_COMMENTS_LOG;
  if (!file) return;
  const results = (context.messages ?? [])
    .filter((item) => item.role === "toolResult")
    .map((item) => (Array.isArray(item.content) ? item.content : []).filter((part) => part.type === "text").map((part) => part.text).join("\n"));
  require("node:fs").appendFileSync(file, `${JSON.stringify({ tools: toolsOf(context).map((tool) => tool.name), results })}\n`);
}

function lastUserText(context) {
  const last = [...(context.messages ?? [])].reverse().find((item) => item.role === "user");
  return JSON.stringify(last?.content ?? "");
}

function message(model, content, stopReason) {
  return { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: USAGE, stopReason, timestamp: Date.now() };
}

function answer(model) {
  const out = createAssistantMessageEventStream();
  const done = message(model, [{ type: "text", text: "ok" }], "stop");
  queueMicrotask(() => {
    out.push({ type: "start", partial: done });
    out.push({ type: "text_start", contentIndex: 0, partial: done });
    out.push({ type: "text_end", contentIndex: 0, content: "ok", partial: done });
    out.push({ type: "done", reason: "stop", message: done });
  });
  return out;
}

function callTool(model, call) {
  const out = createAssistantMessageEventStream();
  const partial = message(model, [call], "toolUse");
  queueMicrotask(() => {
    out.push({ type: "start", partial });
    out.push({ type: "toolcall_start", contentIndex: 0, partial });
    out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
    out.push({ type: "done", reason: "toolUse", message: partial });
  });
  return out;
}

function stream(model, context) {
  record(context);
  const published = toolsOf(context).map((tool) => tool.name);
  const alreadyCalled = (context.messages ?? []).some((item) => item.role === "toolResult");
  if (lastUserText(context).includes("reviewed.pdf") && published.includes("pdf_extract") && !alreadyCalled) {
    return callTool(model, { type: "toolCall", id: `pdf-${Date.now()}`, name: "pdf_extract", arguments: { path: "reviewed.pdf", mode: "text" } });
  }
  return answer(model);
}

export default function (pi) {
  pi.registerProvider("pdf-comments-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "pdf-comments-test-api",
    models: [
      {
        id: "pdf-comments-test",
        name: "PDF Comments Test",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 64_000,
        maxTokens: 1_000,
      },
    ],
    streamSimple: stream,
  });
}
