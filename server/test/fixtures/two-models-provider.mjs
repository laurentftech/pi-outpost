/**
 * One provider, two models — `denied` and `allowed` — each answering with its own id, so a
 * test reads which model really ran a turn, not which one the snapshot names.
 */
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

function stream(model) {
  const out = createAssistantMessageEventStream();
  const text = `answered by ${model.id}`;
  const partial = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    out.push({ type: "start", partial });
    out.push({ type: "text_start", contentIndex: 0, partial });
    out.push({ type: "text_end", contentIndex: 0, content: text, partial });
    out.push({ type: "done", reason: "stop", message: partial });
  });
  return out;
}

const model = (id) => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16_000,
  maxTokens: 1_000,
});

export default function (pi) {
  pi.registerProvider("two-models-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "two-models-test-api",
    models: [model("denied"), model("allowed")],
    streamSimple: stream,
  });
}
