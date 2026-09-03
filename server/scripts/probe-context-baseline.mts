/**
 * What a session carries before the first word of conversation: the assembled system
 * prompt plus every tool's name, description, guidelines and parameter schema.
 *
 * Two configurations — pi's own defaults, and pi-outpost's toolset on top — read from
 * real `AgentSession`s rather than from the sources, so the prompt guidelines a tool
 * contributes are counted where they actually land.
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
import { createWorkPlanToolDefinition } from "../src/workPlanTool.ts";
import { createStructuredExchangeToolDefinition } from "../src/structuredExchangeTool.ts";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { composeAppendSystemPrompt } from "../src/systemPrompt.ts";

const chars = (s: string) => s.length;
const tok = (n: number) => `${(n / 4 / 1000).toFixed(1)}k`;

async function measure(label: string, options: { outpost: boolean }) {
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
  const prompt = (s as { systemPrompt: string }).systemPrompt;
  const tools = (s as { getAllTools: () => unknown[] }).getAllTools();
  const sized = (tools as { name?: string }[])
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
await measure("pi-outpost", { outpost: true });
