/**
 * A provider for driving two agents on one project at once.
 *
 * It answers `ok: <the prompt>`, so a test can tell which conversation an answer
 * belongs to. Two words change that:
 *
 * - `HOLD` keeps the turn open until the file named by `SIDE_SESSIONS_RELEASE`
 *   exists — a turn that is really running, for as long as the test needs it to.
 * - `WRITE <name>` calls the real `write` tool on `<name>`, then answers `wrote`.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

const require = createRequire(import.meta.url);

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function lastUserText(context) {
  const last = [...(context.messages ?? [])].reverse().find((item) => item.role === "user");
  const content = last?.content;
  if (typeof content === "string") return content;
  return (content ?? []).filter((part) => part.type === "text").map((part) => part.text).join(" ");
}

async function released() {
  const fs = require("node:fs");
  const file = process.env.SIDE_SESSIONS_RELEASE;
  while (file && !fs.existsSync(file)) await new Promise((resolve) => setTimeout(resolve, 50));
}

function stream(model, context) {
  const out = createAssistantMessageEventStream();
  const base = { role: "assistant", api: model.api, provider: model.provider, model: model.id, usage, timestamp: Date.now() };
  const prompt = lastUserText(context);
  const answered = (context.messages ?? []).at(-1)?.role === "toolResult";
  const write = /WRITE (\S+)/.exec(prompt);

  if (write && !answered) {
    const call = { type: "toolCall", id: `write-${Date.now()}`, name: "write", arguments: { path: write[1], content: "written by a side session\n" } };
    const message = { ...base, content: [call], stopReason: "toolUse" };
    queueMicrotask(() => {
      out.push({ type: "start", partial: message });
      out.push({ type: "toolcall_start", contentIndex: 0, partial: message });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
      out.push({ type: "done", reason: "toolUse", message });
    });
    return out;
  }

  const text = write ? "wrote" : `ok: ${prompt}`;
  const message = { ...base, content: [{ type: "text", text }], stopReason: "stop" };
  void (async () => {
    out.push({ type: "start", partial: message });
    if (prompt.includes("HOLD")) await released();
    out.push({ type: "text_start", contentIndex: 0, partial: message });
    out.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
    out.push({ type: "done", reason: "stop", message });
  })();
  return out;
}

export default function (pi) {
  pi.registerProvider("side-sessions-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "side-sessions-test-api",
    models: [{
      id: "side-sessions-test",
      name: "Side Sessions Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
