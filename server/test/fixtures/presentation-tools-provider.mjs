/**
 * A scripted "model" for the presentation tools, over a real server.
 *
 * It records the tool names each request carried (DOCUMENT_TOOLS_LOG) and, when the
 * user's prompt asks for it, plays the part of an agent using the skill:
 *
 * - `READ THE SKILL <path>`: calls `read` on that SKILL.md, then answers.
 * - `BUILD THE DECK`: `pptx_layouts` on brand.potx, `pptx_create` into deck.pptx,
 *   `pptx_render` on deck.pptx, then answers — one tool per request, as a model would,
 *   and only calling a tool the request actually offered.
 *
 * Every tool result it receives is appended to PRESENTATION_RESULTS_LOG, so the test
 * reads what the agent was really handed back — text, and how many pictures.
 */
import { createRequire } from "node:module";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { toolsOf } from "./transcriptContext.mjs";

const require = createRequire(import.meta.url);
const fs = require("node:fs");

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const BUILD_STEPS = [
  ["pptx_layouts", { path: "brand.potx" }],
  [
    "pptx_create",
    {
      template_path: "brand.potx",
      output_path: "deck.pptx",
      slides: [
        { title: "Built by the agent", subtitle: "Through the running server" },
        { layout: "Two Content", title: "With a picture", bullets: ["Left side", "  detail"], image: { path: "diagram.svg", alt: "diagram" } },
        { title: "A table", table: { rows: [["Region", "Revenue"], ["EMEA", "4.2"], ["APAC", "1.7"]] } },
        {
          title: "A chart",
          chart: { type: "column", categories: ["Q1", "Q2"], series: [{ name: "2026", values: [2, 2.4] }], number_format: "0.0", show_values: true },
        },
      ],
    },
  ],
  ["pptx_render", { path: "deck.pptx" }],
];

function append(variable, value) {
  const file = process.env[variable];
  if (file) fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

/**
 * The messages since the last user prompt: this turn's tool calls and results. The prompt
 * is read as its text, not as JSON — a Windows path's backslashes would come back doubled.
 */
function thisTurn(context) {
  const messages = context.messages ?? [];
  let start = messages.length - 1;
  while (start >= 0 && messages[start].role !== "user") start--;
  const content = messages[start]?.content ?? "";
  const prompt =
    typeof content === "string" ? content : content.filter((item) => item?.type === "text").map((item) => item.text ?? "").join("\n");
  return { prompt, after: messages.slice(start + 1) };
}

function reply(model, content, stopReason) {
  const out = createAssistantMessageEventStream();
  const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: USAGE, stopReason, timestamp: Date.now() };
  queueMicrotask(() => {
    out.push({ type: "start", partial: message });
    if (stopReason === "toolUse") {
      out.push({ type: "toolcall_start", contentIndex: 0, partial: message });
      out.push({ type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: message });
    } else {
      out.push({ type: "text_start", contentIndex: 0, partial: message });
      out.push({ type: "text_end", contentIndex: 0, content: content[0].text, partial: message });
    }
    out.push({ type: "done", reason: stopReason, message });
  });
  return out;
}

function stream(model, context) {
  const offered = toolsOf(context).map((tool) => tool.name);
  append("DOCUMENT_TOOLS_LOG", offered);
  const { prompt, after } = thisTurn(context);
  const results = after.filter((message) => message.role === "toolResult");
  const last = results.at(-1);
  if (last) {
    append("PRESENTATION_RESULTS_LOG", {
      tool: last.toolName,
      isError: last.isError === true,
      text: (last.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n"),
      images: (last.content ?? []).filter((item) => item.type === "image").length,
    });
  }
  const call = (name, args) =>
    reply(model, [{ type: "toolCall", id: `call-${Date.now()}-${results.length}`, name, arguments: args }], "toolUse");

  const skill = /READ THE SKILL (\S+)/.exec(prompt);
  if (skill && results.length === 0) return call("read", { path: skill[1] });

  if (prompt.includes("BUILD THE DECK") && results.length < BUILD_STEPS.length && !last?.isError) {
    const [name, args] = BUILD_STEPS[results.length];
    if (offered.includes(name)) return call(name, args);
  }
  return reply(model, [{ type: "text", text: "ok" }], "stop");
}

export default function (pi) {
  pi.registerProvider("presentation-tools-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "test",
    api: "presentation-tools-test-api",
    models: [
      {
        id: "presentation-tools-test",
        name: "Presentation Tools Test",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 1_000,
      },
    ],
    streamSimple: stream,
  });
}
