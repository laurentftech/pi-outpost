/**
 * A provider that records the tools it was sent and, when asked, calls `mail_extract`
 * to unpack a message's attachments.
 *
 * The point of the second half: an attachment's extractor is published by the *write*,
 * from inside the turn. Only a real turn that really unpacks something shows whether the
 * tool reached the model afterwards — the mapping is unit-tested elsewhere, and a
 * mapping that is never wired up is a tool the agent cannot see.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { toolsOf } from "./transcriptContext.mjs";

const require = createRequire(import.meta.url);

function record(context) {
  const fs = require("node:fs");
  const file = process.env.MAIL_TOOLS_LOG;
  if (!file) return;
  fs.appendFileSync(file, `${JSON.stringify(toolsOf(context).map((tool) => tool.name))}\n`);
}

function lastUserText(context) {
  const last = [...(context.messages ?? [])].reverse().find((item) => item.role === "user");
  return JSON.stringify(last?.content ?? "");
}

function answer(model) {
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

function callTool(model, call) {
  const out = createAssistantMessageEventStream();
  const partial = {
    role: "assistant",
    content: [call],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
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
  const text = lastUserText(context);
  const published = toolsOf(context).map((tool) => tool.name);
  const alreadyCalled = (context.messages ?? []).some((item) => item.role === "toolResult");

  if (text.includes("UNPACK IT") && published.includes("mail_extract") && !alreadyCalled) {
    return callTool(model, {
      type: "toolCall",
      id: `mail-${Date.now()}`,
      name: "mail_extract",
      arguments: { path: "uploads/dossier.msg", attachments: "all" },
    });
  }
  return answer(model);
}

export default function (pi) {
  pi.registerProvider("mail-tools-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "mail-tools-test-api",
    models: [
      {
        id: "mail-tools-test",
        name: "Mail Tools Test",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_000,
        maxTokens: 1_000,
      },
    ],
    streamSimple: stream,
  });
}
