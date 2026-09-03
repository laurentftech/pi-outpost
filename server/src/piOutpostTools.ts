/**
 * pi-outpost's own tools, packaged as a pi extension so an RPC child has them.
 *
 * The embedded runtime hands these seven tool definitions straight to the SDK
 * session (`customTools` in index.ts). A `pi --mode rpc` child is a separate
 * process and builds its own toolset from its own flags, so without this file the
 * agent would lose `present_structure`, `work_plan`, and the document extractors the moment
 * an operator switched runtimes — including the bundled structured-exchange skill,
 * which instructs the model to call a tool that would not exist.
 *
 * pi loads this through `--extension <path>`. Its configuration cannot travel on
 * the command line (the numbers are not the operator's to type, and the whole
 * point is that both runtimes read the same config), so it arrives as JSON in
 * PI_OUTPOST_TOOLS — set by the parent that spawned the child, never inherited
 * from an ambient environment: a missing or unreadable value is a hard error
 * rather than a silent default, because a tool confined to the wrong directory is
 * worse than a tool that is absent.
 *
 * There is no sandbox branch here on purpose. `sandbox` with `agentRuntime.mode:
 * "rpc"` is refused at config load (see config.ts): the sandbox is a *replacement
 * toolset* this server builds for its own in-process session, and nothing on pi's
 * command line confines a child's built-in read/write/bash to a directory. So the
 * only shape this file ever serves is the unsandboxed one: the workspace root is
 * both the readable and the writable zone.
 */
import fs from "node:fs/promises";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createDocxExtractToolDefinition } from "./docxTool.ts";
import { createPdfExtractToolDefinition } from "./pdfTool.ts";
import { createPptxExtractToolDefinition } from "./pptxTool.ts";
import { createStructuredExchangeFigureToolDefinition } from "./structuredExchangeFigureTool.ts";
import { createStructuredExchangeToolDefinition } from "./structuredExchangeTool.ts";
import { createXlsxExtractToolDefinition } from "./xlsxTool.ts";
import { createWorkPlanExtendedToolDefinition, createWorkPlanToolDefinition } from "./workPlanTool.ts";

/** What the parent must tell the child. Mirrors the fields index.ts uses embedded. */
export interface PiOutpostToolsSettings {
  /** The agent's working directory — paths the model gives resolve against it. */
  cwd: string;
  maxBytes: { pdf: number; docx: number; xlsx: number; pptx: number; structuredExchange: number };
}

export const TOOLS_ENV_VAR = "PI_OUTPOST_TOOLS";

/** Parse the settings the parent passed, refusing anything that is not complete. */
export function parseToolsSettings(raw: string | undefined): PiOutpostToolsSettings {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${TOOLS_ENV_VAR} is not set — this extension is loaded by pi-outpost, not discovered`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${TOOLS_ENV_VAR} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const settings = parsed as Partial<PiOutpostToolsSettings>;
  if (typeof settings?.cwd !== "string" || settings.cwd === "") {
    throw new Error(`${TOOLS_ENV_VAR} has no "cwd"`);
  }
  const sizes = settings.maxBytes;
  for (const key of ["pdf", "docx", "xlsx", "pptx", "structuredExchange"] as const) {
    if (typeof sizes?.[key] !== "number" || !Number.isFinite(sizes[key]) || sizes[key] <= 0) {
      throw new Error(`${TOOLS_ENV_VAR} has no positive "maxBytes.${key}"`);
    }
  }
  return { cwd: settings.cwd, maxBytes: sizes as PiOutpostToolsSettings["maxBytes"] };
}

/**
 * The same six tools, built the same way as the unsandboxed branch of index.ts.
 * `realpath` matters: the confinement checks compare resolved paths, and on macOS
 * a workspace under /tmp is reached through a symlink.
 */
export async function createPiOutpostTools(settings: PiOutpostToolsSettings): Promise<ToolDefinition[]> {
  const cwd = settings.cwd;
  const root = await fs.realpath(cwd);
  const common = { cwd, allowedRoots: [root], writableRoot: root };
  return [
    createPdfExtractToolDefinition({ ...common, maxBytes: settings.maxBytes.pdf }),
    createDocxExtractToolDefinition({ ...common, maxBytes: settings.maxBytes.docx }),
    createXlsxExtractToolDefinition({ ...common, maxBytes: settings.maxBytes.xlsx }),
    createPptxExtractToolDefinition({ ...common, maxBytes: settings.maxBytes.pptx }),
    createStructuredExchangeFigureToolDefinition({ ...common, maxBytes: settings.maxBytes.structuredExchange }),
    createStructuredExchangeToolDefinition(),
    createWorkPlanToolDefinition(),
    // Both, always. The server withholds the extended half from a session with no
    // plan through the SDK's active-tool set; the RPC dialect has no command for
    // that, so a child registers the pair and publishes them both. The cost of the
    // gating being embedded-only is one extra tool in a child's prompt, stated here
    // rather than discovered.
    createWorkPlanExtendedToolDefinition(),
  ];
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const tools = await createPiOutpostTools(parseToolsSettings(process.env[TOOLS_ENV_VAR]));
  for (const tool of tools) pi.registerTool(tool);
}
