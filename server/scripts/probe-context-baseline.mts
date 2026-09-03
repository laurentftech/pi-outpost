/**
 * What a session carries before the first word of conversation: the assembled system
 * prompt plus every tool's name, description, guidelines and parameter schema.
 *
 * Three configurations — pi's own defaults, what a pi-outpost session publishes at rest,
 * and everything it can publish — read from real `AgentSession`s rather than from the
 * sources, so the prompt guidelines a tool contributes are counted where they actually
 * land.
 *
 * "At rest" is the figure that matters, because it is what almost every turn of almost
 * every conversation carries: no `work_plan_extended` (published once a session has a
 * plan) and no document extractor (published once a document is named). The full set is
 * what a session that plans and reads documents ends up with.
 *
 * Run it with `npx tsx server/scripts/probe-context-baseline.mts`. It is what the
 * figures in `docs/comparison.md` come from, and re-running it is how they are checked
 * after a tool or a prompt changes.
 *
 * Two things it deliberately does not count, because both depend on the deployment
 * rather than on the software: skills and extensions (discovery is off here) and the
 * project context files a real workspace carries. A sandboxed deployment swaps the
 * built-in tools for path-scoped equivalents of much the same size.
 *
 * Tokens are chars / 4 — an order of magnitude, not a bill.
 */
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createPdfExtractToolDefinition } from "../src/pdfTool.ts";
import { createDocxExtractToolDefinition } from "../src/docxTool.ts";
import { createXlsxExtractToolDefinition } from "../src/xlsxTool.ts";
import { createPptxExtractToolDefinition } from "../src/pptxTool.ts";
import { createWorkPlanExtendedToolDefinition, createWorkPlanToolDefinition } from "../src/workPlanTool.ts";
import { createStructuredExchangeToolDefinition } from "../src/structuredExchangeTool.ts";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { composeAppendSystemPrompt } from "../src/systemPrompt.ts";

const chars = (s: string) => s.length;
const tok = (n: number) => `${(n / 4 / 1000).toFixed(1)}k`;

/** What a session withholds until something asks for it. */
const ON_DEMAND = ["work_plan_extended", "pdf_extract", "docx_extract", "xlsx_extract", "pptx_extract"];

async function measure(label: string, options: { outpost: boolean; withheld?: string[] }) {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), "baseline-")));
  const agentDir = path.join(cwd, "agent");
  const appendSystemPrompt = options.outpost
    ? composeAppendSystemPrompt({ webContext: true, appendSystemPrompt: [] } as never)
    : [];
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt } : {}),
    },
  });
  const extras = options.outpost
    ? [
        createPdfExtractToolDefinition({ cwd, allowedRoots: [cwd], maxBytes: 26214400, writableRoot: cwd }),
        createDocxExtractToolDefinition({ cwd, allowedRoots: [cwd], maxBytes: 26214400, writableRoot: cwd }),
        createXlsxExtractToolDefinition({ cwd, allowedRoots: [cwd], maxBytes: 26214400, writableRoot: cwd }),
        createPptxExtractToolDefinition({ cwd, allowedRoots: [cwd], maxBytes: 26214400, writableRoot: cwd }),
        createWorkPlanToolDefinition(),
        createWorkPlanExtendedToolDefinition(),
        createStructuredExchangeToolDefinition(),
        createStructuredExchangeFigureToolDefinition({ cwd, allowedRoots: [cwd], writableRoot: cwd }),
      ]
    : [];
  const session = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.create(cwd, path.join(cwd, "sessions")),
    ...(extras.length > 0 ? { customTools: extras } : {}),
  });
  const s = (session as { session?: unknown }).session ?? session;
  const withheld = new Set(options.withheld ?? []);
  if (withheld.size > 0) {
    // Withhold them the way the server does. Filtering the list afterwards would count
    // the prompt of a session that still had them: pi rebuilds the system prompt around
    // the active set, and a withheld tool takes its guidelines with it.
    const active = (s as { getActiveToolNames: () => string[] }).getActiveToolNames();
    (s as { setActiveToolsByName: (names: string[]) => void })
      .setActiveToolsByName(active.filter((name) => !withheld.has(name)));
  }
  const prompt = (s as { systemPrompt: string }).systemPrompt;
  const sized = (s as { getAllTools: () => { name?: string }[] }).getAllTools()
    .filter((tool) => !withheld.has(tool.name ?? ""))
    .map((tool) => ({ name: tool.name ?? "?", chars: chars(JSON.stringify(tool)) }))
    .sort((a, b) => b.chars - a.chars);
  const toolChars = sized.reduce((n, tool) => n + tool.chars, 0);
  console.log(
    `\n${label} — prompt ${chars(prompt)} chars (~${tok(chars(prompt))}), ` +
      `${sized.length} tools ${toolChars} chars (~${tok(toolChars)}), total ~${tok(chars(prompt) + toolChars)} tok`,
  );
  // Per tool, largest first: which definitions are worth trimming is the whole point.
  for (const tool of sized) {
    console.log(`  ${tool.name.padEnd(28)} ${String(tool.chars).padStart(6)} chars  ~${tok(tool.chars)}`);
  }
  return { prompt: chars(prompt), tools: toolChars, count: sized.length };
}

await measure("pi (defaults)", { outpost: false });
await measure("pi-outpost (at rest)", { outpost: true, withheld: ON_DEMAND });
await measure("pi-outpost (everything published)", { outpost: true });
