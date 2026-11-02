/**
 * A provider for queued prompts (queued-prompts), recording what the agent is sent.
 *
 * Request number n (1-based) waits while the file `${QUEUE_GATES}-${n}` exists, then answers
 * "answer n". A test holds a turn open on gate 1, queues prompts behind it, and releases the
 * gates one at a time: pi delivers queued steering messages one at a time, each opening the
 * next request, so releasing gate 1 alone delivers exactly the first queued prompt and holds
 * the second behind gate 2.
 *
 * Typing "queue one for me" makes the extension queue a follow-up of its own.
 *
 * Each request is appended to QUEUE_LOG as one JSON line: { n, users }, `users` being the
 * conversation's user messages as { text, images } — images counted, by MIME type.
 */
import { appendFileSync, existsSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

let requests = 0;

const blocks = (content) => (typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []));

function stream(model, context, options) {
  const users = (context.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) => ({
      text: blocks(message.content).filter((block) => block.type === "text").map((block) => block.text).join(""),
      images: blocks(message.content).filter((block) => block.type === "image").map((block) => block.mimeType),
    }));
  // The server titles a new session with one call of its own: answered at once, and not a
  // request of the conversation, so it neither takes a number nor waits on a gate.
  const titling = users.length === 1 && users[0].text.startsWith("<conversation>");
  const n = titling ? 0 : ++requests;
  if (process.env.QUEUE_LOG && !titling) appendFileSync(process.env.QUEUE_LOG, `${JSON.stringify({ n, users })}\n`);

  const out = createAssistantMessageEventStream();
  const partial = { role: "assistant", content: [{ type: "text", text: titling ? "A title" : `answer ${n}` }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() };
  const gate = process.env.QUEUE_GATES && !titling ? `${process.env.QUEUE_GATES}-${n}` : undefined;
  const signal = options?.signal;
  const finish = () => {
    if (signal?.aborted) {
      out.push({ type: "error", reason: "aborted", error: { ...partial, content: [], stopReason: "aborted", errorMessage: "aborted" } });
      return;
    }
    if (gate && existsSync(gate)) {
      setTimeout(finish, 25);
      return;
    }
    out.push({ type: "start", partial });
    out.push({ type: "text_start", contentIndex: 0, partial });
    out.push({ type: "text_end", contentIndex: 0, content: partial.content[0].text, partial });
    out.push({ type: "done", reason: "stop", message: partial });
  };
  queueMicrotask(finish);
  return out;
}

export default function (pi) {
  // A message an extension queues itself: typing "queue one for me" during a turn makes the
  // extension queue "from an extension" as a follow-up, which pi-outpost did not send.
  pi.on("input", (event) => {
    if (event.text === "queue one for me") pi.sendUserMessage("from an extension", { deliverAs: "followUp" });
    return { action: "continue" };
  });
  pi.registerProvider("queue-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "queue-test-api",
    models: [{
      id: "queue-test",
      name: "Queue Test",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 1_000,
    }],
    streamSimple: stream,
  });
}
