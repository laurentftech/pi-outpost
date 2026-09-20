/**
 * A provider that records, for each request, the names of the tools it was sent — and,
 * when a prompt asks it to, makes one tool call first, so what a turn does in its middle
 * can be seen in the request that follows.
 *
 * Scripts, by the marker in the last user message:
 * - WRITE THE REGISTRY: `write` the project's registry
 * - READ THE SKILL: `read` the setup skill (PROJECT_MODEL_SKILL)
 * - PRESENT: `present_structure` a small table
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { toolsOf } from "./transcriptContext.mjs";

const require = createRequire(import.meta.url);

function record(context) {
  const fs = require("node:fs");
  const file = process.env.PROJECT_MODEL_LOG;
  if (!file) return;
  fs.appendFileSync(file, `${JSON.stringify(toolsOf(context).map((tool) => tool.name))}\n`);
}

function scriptedCall(context) {
  const last = [...(context.messages ?? [])].reverse().find((item) => item.role === "user");
  const text = JSON.stringify(last?.content ?? "");
  // One call per turn: once a tool result follows the prompt, answer.
  const lastUser = (context.messages ?? []).lastIndexOf(last);
  if ((context.messages ?? []).slice(lastUser).some((item) => item.role === "toolResult")) return undefined;
  if (text.includes("WRITE THE REGISTRY")) {
    return {
      name: "write",
      arguments: {
        path: ".pi-outpost/structured-exchange.json",
        content: JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"] }),
      },
    };
  }
  if (text.includes("READ THE SKILL")) return { name: "read", arguments: { path: process.env.PROJECT_MODEL_SKILL } };
  if (text.includes("PRESENT")) {
    return {
      name: "present_structure",
      arguments: {
        summary: "A table.",
        document: JSON.stringify({ schema: "urn:structured-exchange:2", kind: "table", data: { columns: ["id"], rows: [["R1"]] } }),
      },
    };
  }
  return undefined;
}

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function stream(model, context) {
  record(context);
  const out = createAssistantMessageEventStream();
  const scripted = scriptedCall(context);
  if (scripted !== undefined) {
    const call = { type: "toolCall", id: `call-${Date.now()}`, ...scripted };
    const partial = { role: "assistant", content: [call], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "toolUse", timestamp: Date.now() };
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }
  const message = { role: "assistant", content: [{ type: "text", text: "ok" }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() };
  queueMicrotask(() => {
    out.push({ type: "start", partial: message });
    out.push({ type: "text_start", contentIndex: 0, partial: message });
    out.push({ type: "text_end", contentIndex: 0, content: "ok", partial: message });
    out.push({ type: "done", reason: "stop", message });
  });
  return out;
}

export default function (pi) {
  pi.registerProvider("project-model-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "project-model-test-api",
    models: [{ id: "project-model-test", name: "Project Model Test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16_000, maxTokens: 1_000 }],
    streamSimple: stream,
  });
}
