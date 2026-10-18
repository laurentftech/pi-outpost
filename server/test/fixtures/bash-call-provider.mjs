/**
 * Calls `bash` once — `echo from-the-shell` — then records the tool result the model
 * receives. Which `bash` ran is in that result: pi-outpost's runs the command, a
 * sandboxing extension's answers in its own words.
 *
 * BASH_CALL_COMMANDS (a JSON array) makes it call the tool once per command, all in one
 * message, as a model does when it batches steps; every result is then recorded, in order.
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
  const results = messages.filter((item, index) => item.role === "toolResult" && index > lastUserIndex);
  const batch = process.env.BASH_CALL_COMMANDS ? JSON.parse(process.env.BASH_CALL_COMMANDS) : undefined;
  const out = createAssistantMessageEventStream();

  if (results.length === 0) {
    // BASH_CALL_COMMAND lets a probe ask for something else; the suites use the default.
    // BASH_CALL_TOOL names another shell tool (`powershell`).
    const commands = batch ?? [process.env.BASH_CALL_COMMAND ?? "echo from-the-shell"];
    const name = process.env.BASH_CALL_TOOL ?? "bash";
    const calls = commands.map((command, i) => ({ type: "toolCall", id: `bash-${Date.now()}-${i}`, name, arguments: { command } }));
    const partial = message(model, calls, "toolUse");
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      calls.forEach((toolCall, contentIndex) => {
        out.push({ type: "toolcall_start", contentIndex, partial });
        out.push({ type: "toolcall_end", contentIndex, toolCall, partial });
      });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }

  const file = process.env.BASH_CALL_LOG;
  const recorded = batch ? results.map((item) => item.content) : results.at(-1).content;
  if (file) require("node:fs").writeFileSync(file, JSON.stringify(recorded));
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
