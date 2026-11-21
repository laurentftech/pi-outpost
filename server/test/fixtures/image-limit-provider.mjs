/**
 * A model that accepts at most 4 images per request, and a gateway that enforces it.
 *
 * Plays the LiteLLM/vLLM deployment of #526: the model declares
 * `inputLimits.images.maxPerRequest: 4`, and a request carrying more is refused with the
 * gateway's own error, as a real one would. Each request's image count is appended to
 * IMAGE_LIMIT_LOG, so the test reads what reached the model, not what the server meant.
 *
 * Scripted: a prompt containing `RENDER <range>` makes the model call pdf_render on
 * long.pdf with that range, once; any other request is answered "ok".
 */
import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

const LIMIT = 4;

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function imagesIn(context) {
  let count = 0;
  for (const message of context.messages ?? []) {
    if (Array.isArray(message.content)) count += message.content.filter((block) => block.type === "image").length;
  }
  return count;
}

function stream(model, context) {
  const images = imagesIn(context);
  // The tool result this request answers, as the model receives it.
  const last = (context.messages ?? []).at(-1);
  const result =
    last?.role === "toolResult"
      ? {
          text: last.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"),
          images: last.content.filter((block) => block.type === "image").length,
        }
      : null;
  if (process.env.IMAGE_LIMIT_LOG) appendFileSync(process.env.IMAGE_LIMIT_LOG, `${JSON.stringify({ images, result, roles: (context.messages ?? []).map((m) => `${m.role}:${Array.isArray(m.content) ? m.content.map((b) => b.type).join("+") : typeof m.content}`) })}\n`);
  const out = createAssistantMessageEventStream();
  const base = { role: "assistant", api: model.api, provider: model.provider, model: model.id, usage, timestamp: Date.now() };

  if (images > LIMIT) {
    const error = {
      ...base,
      content: [],
      stopReason: "error",
      errorMessage: `400 litellm.BadRequestError: At most ${LIMIT} image(s) may be provided in one prompt. (parameter=image)`,
    };
    queueMicrotask(() => out.push({ type: "error", reason: "error", error }));
    return out;
  }

  const messages = context.messages ?? [];
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const asked = /RENDER ([0-9,-]+)/.exec(JSON.stringify(lastUser?.content ?? ""));
  const lastIsUser = messages[messages.length - 1]?.role === "user";
  if (asked && lastIsUser) {
    const call = { type: "toolCall", id: `render-${Date.now()}`, name: "pdf_render", arguments: { path: "long.pdf", pages: asked[1] } };
    const partial = { ...base, content: [call], stopReason: "toolUse" };
    queueMicrotask(() => {
      out.push({ type: "start", partial });
      out.push({ type: "toolcall_start", contentIndex: 0, partial });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial });
      out.push({ type: "done", reason: "toolUse", message: partial });
    });
    return out;
  }

  const message = { ...base, content: [{ type: "text", text: "ok" }], stopReason: "stop" };
  queueMicrotask(() => {
    out.push({ type: "start", partial: message });
    out.push({ type: "text_start", contentIndex: 0, partial: message });
    out.push({ type: "text_end", contentIndex: 0, content: "ok", partial: message });
    out.push({ type: "done", reason: "stop", message });
  });
  return out;
}

export default function (pi) {
  pi.registerProvider("image-limit-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "image-limit-test-api",
    models: [
      {
        id: "four-images",
        name: "Four Images",
        reasoning: false,
        input: ["text", "image"],
        inputLimits: { images: { maxPerRequest: LIMIT } },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 64_000,
        maxTokens: 1_000,
      },
    ],
    streamSimple: stream,
  });
}
