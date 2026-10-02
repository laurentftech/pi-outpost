/**
 * A provider that answers "RUN CODEMODE <outside path>" with one `codemode` call, then
 * records the tool result it is handed and replies "ok".
 *
 * The script reads a file inside the workspace, tries one outside it, and reports
 * whether `bash` is reachable — what a sandboxed session lets a script do is the
 * thing under test, so the provider logs the result the model actually received.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { toolsOf } from "./transcriptContext.mjs";

const require = createRequire(import.meta.url);

function thisTurn(context) {
  const messages = context.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages.slice(i);
  }
  return [];
}

const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).map((block) => block?.text ?? "").join("");

function script(outside) {
  return [
    "const out = {};",
    'out.inside = await tools.read({ path: "inside.txt" });',
    `try { out.outside = await tools.read({ path: ${JSON.stringify(outside)} }); } catch (error) { out.outsideError = String(error.message); }`,
    "out.bash = typeof tools.bash;",
    "return out;",
  ].join("\n");
}

const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function stream(model, context) {
  const identity = { api: model.api, provider: model.provider, model: model.id };
  const out = createAssistantMessageEventStream();
  const turn = thisTurn(context);
  const result = turn.find((message) => message?.role === "toolResult");
  const prompt = textOf(turn[0]?.content);
  const match = /RUN CODEMODE (\S+)/.exec(prompt);

  if (result) {
    require("node:fs").writeFileSync(process.env.CODEMODE_LOG, textOf(result.content));
  } else if (match && toolsOf(context).some((tool) => tool.name === "codemode")) {
    const call = { type: "toolCall", id: `cm-${Date.now()}`, name: "codemode", arguments: { code: script(match[1]) } };
    const partial = { role: "assistant", content: [call], ...identity, usage, stopReason: "toolUse", timestamp: Date.now() };
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }

  const message = {
    role: "assistant", content: [{ type: "text", text: "ok" }], ...identity, usage,
    stopReason: "stop", timestamp: Date.now(),
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
  pi.registerProvider("codemode-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "codemode-test-api",
    models: [{
      id: "codemode-test",
      name: "Codemode Test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
