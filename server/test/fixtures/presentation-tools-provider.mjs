/**
 * A scripted "model" for the presentation tools, over a real server.
 *
 * It records the tool names each request carried (DOCUMENT_TOOLS_LOG) and, when the
 * user's prompt asks for it, plays the part of an agent using the skill:
 *
 * - `READ THE SKILL <path>`: calls `read` on that SKILL.md, then answers.
 * - `BUILD THE DECK`: `pptx_layouts` on brand.potx, `pptx_create` into deck.pptx,
 *   `pptx_update` of it into deck-v2.pptx, `pptx_render` on slide 2 of that, then answers.
 * - `WRITE THE REPORT`: `docx_styles` on brand.dotx, `docx_create` into report.docx,
 *   `docx_update` of it into report-v2.docx, `docx_render` on that, then answers.
 *
 * - `RESTYLE THE DOCUMENT`: `docx_restyle` of old.docx onto brand.dotx, then `docx_render`.
 * - `RENDER BOTH`: `docx_render` on report.docx, then `pptx_render` on deck.pptx, even
 *   when the first fails.
 *
 * One tool per request, as a model would, and only calling a tool the request offered.
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
  [
    "pptx_update",
    {
      path: "deck.pptx",
      output_path: "deck-v2.pptx",
      edits: [
        { action: "replace", slide: "A table", content: { title: "A revised table", table: { rows: [["Region", "Revenue"], ["EMEA", "4.4"]] } } },
        { action: "delete", slide: 4 },
      ],
    },
  ],
  ["pptx_render", { path: "deck-v2.pptx", slides: "3" }],
];

const REPORT_STEPS = [
  ["docx_styles", { path: "brand.dotx" }],
  [
    "docx_create",
    {
      template_path: "brand.dotx",
      output_path: "report.docx",
      keep: ["cover", "toc"],
      markdown: "# Findings\n\nThe quarter went **well**.\n\n## Detail\n\n1. Revenue\n2. Margin\n\n| Region | Revenue |\n|---|---|\n| EMEA | 4.2 |\n\n![Diagram](diagram.svg)\n\n# Next steps\n\nKeep going.\n",
    },
  ],
  [
    "docx_update",
    {
      path: "report.docx",
      output_path: "report-v2.docx",
      edits: [{ action: "replace", section: "Next steps", markdown: "Hire two people.\n\n- Sales\n- Support" }],
    },
  ],
  ["docx_render", { path: "report-v2.docx" }],
];

const RENDER_STEPS = [
  ["docx_render", { path: "report.docx" }],
  ["pptx_render", { path: "deck.pptx" }],
];

const RESTYLE_STEPS = [
  ["docx_restyle", { path: "old.docx", template_path: "brand.dotx", output_path: "old-restyled.docx" }],
  ["docx_render", { path: "old-restyled.docx" }],
];

const SCRIPTS = [
  ["BUILD THE DECK", BUILD_STEPS],
  ["WRITE THE REPORT", REPORT_STEPS],
  ["RENDER BOTH", RENDER_STEPS],
  ["RESTYLE THE DOCUMENT", RESTYLE_STEPS],
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

  for (const [keyword, steps] of SCRIPTS) {
    if (!prompt.includes(keyword) || results.length >= steps.length || (last?.isError && keyword !== "RENDER BOTH")) continue;
    const [name, args] = steps[results.length];
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
