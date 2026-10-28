/**
 * A provider for side questions (btw-side-question), recording every request it is sent.
 *
 * A turn: the first request calls `read` on the path the prompt names ("read <path>"); the
 * request after the tool result waits while the file BTW_GATE exists, then answers "done".
 * So a test holds a turn open after a real tool call, asks a side question in the middle,
 * and lets the turn end when it chooses.
 *
 * A side question (its system prompt says so): answered at once with "Side answer to: <q>",
 * unless the question says "fail" (an error reply), "slow" (no reply until aborted) or "long"
 * (eighty lines).
 *
 * Each request is appended to BTW_LOG as one JSON line: { kind, prompt, tools, messages },
 * messages as { role, text } with tool calls written as `call <name> <arguments>`.
 */
import { appendFileSync, existsSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { promptOf, toolsOf } from "./transcriptContext.mjs";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function message(model, content, stopReason, extra = {}) {
  return { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage, stopReason, timestamp: Date.now(), ...extra };
}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .map((block) => (block?.type === "text" ? block.text ?? "" : block?.type === "toolCall" ? `call ${block.name} ${JSON.stringify(block.arguments)}` : ""))
        .join("\n");

const conversation = (context) =>
  (context.messages ?? []).filter((item) => item.role !== "system").map((item) => ({ role: item.role, text: textOf(item.content) }));

function reply(out, model, text) {
  const partial = message(model, [{ type: "text", text }], "stop");
  out.push({ type: "start", partial });
  out.push({ type: "text_start", contentIndex: 0, partial });
  out.push({ type: "text_end", contentIndex: 0, content: text, partial });
  out.push({ type: "done", reason: "stop", message: partial });
}

function stream(model, context, options) {
  const prompt = promptOf(context);
  const messages = conversation(context);
  const side = prompt.startsWith("You answer a side question");
  const log = process.env.BTW_LOG;
  if (log) appendFileSync(log, `${JSON.stringify({ kind: side ? "side" : "turn", prompt, tools: toolsOf(context).map((tool) => tool.name), messages })}\n`);
  const out = createAssistantMessageEventStream();

  if (side) {
    const question = messages.at(-1)?.text ?? "";
    if (/fail/.test(question)) {
      queueMicrotask(() => {
        const failed = message(model, [], "error", { errorMessage: "provider down" });
        out.push({ type: "error", reason: "error", error: failed });
      });
    } else if (/slow/.test(question)) {
      const signal = options?.signal;
      const abort = () => out.push({ type: "error", reason: "aborted", error: message(model, [], "aborted", { errorMessage: "aborted" }) });
      if (signal?.aborted) queueMicrotask(abort);
      else signal?.addEventListener("abort", abort, { once: true });
    } else if (/long/.test(question)) {
      queueMicrotask(() => reply(out, model, Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a long side answer.`).join("\n")));
    } else {
      queueMicrotask(() => reply(out, model, `Side answer to: ${question}`));
    }
    return out;
  }

  const lastUser = messages.findLastIndex((item) => item.role === "user");
  const answered = messages.slice(lastUser + 1).some((item) => item.role === "toolResult");
  const target = messages[lastUser]?.text.match(/^read\s+(\S+)/)?.[1];
  if (target && !answered) {
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
  const gate = process.env.BTW_GATE;
  const finish = () => {
    if (gate && existsSync(gate)) setTimeout(finish, 50);
    else reply(out, model, "done");
  };
  queueMicrotask(finish);
  return out;
}

export default function (pi) {
  pi.registerProvider("btw-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "btw-test-api",
    models: [{
      id: "btw-test",
      name: "Btw Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
