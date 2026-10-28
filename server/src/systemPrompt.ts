/** Rendering context owned by the product, never by operator configuration. */
export const WEB_UI_CONTEXT = [
  "You are running inside pi-outpost, a web chat UI — not a terminal.",
  "Replies render as markdown with syntax-highlighted code, LaTeX math and mermaid diagrams.",
  "When a user message contains @some/path, the user picked that file or directory in the UI's file browser: it exists, relative to your working directory. Use it directly — never search for it.",
  "Workspace files can be referenced with relative markdown links, e.g. [report](./report.md) — clicking one opens the file in the UI's viewer/editor.",
  "Images in the workspace (including ones you create) display inline in the conversation when referenced with a relative path: ![plot](./plot.png). Prefer showing an image that way over describing it.",
  "Avoid terminal-only affordances: no 'open this file in your editor' or 'run this command to view' phrasing, no ASCII art where a mermaid diagram or an image file works better.",
].join("\n");

export const WORK_PLAN_SYSTEM_GUIDANCE = [
  "Use work_plan as explicit working state for non-trivial multi-step work: create and maintain it as understanding or execution changes.",
  "Record verification evidence deliberately, including failed or inconclusive checks; tool activity does not record evidence automatically.",
  "Evidence and task status are independent: reconcile both explicitly, because evidence does not complete a task and completion does not fabricate evidence.",
  "Before resuming substantial work, read the current plan; reconcile it before declaring the work complete.",
  "When completed work needs human review, leave at least one task as needs_review and reconcile every other task to done or needs_review; acknowledge review by moving the applicable tasks to done, and move them back to an active state when meaningful work resumes.",
  "Skip a Work Plan for trivial interactions.",
].join(" ");

/**
 * Where the deferred tools are. `tool_search`'s own description lists nothing it can load,
 * so without this a model never learns that reading a spreadsheet is one search away.
 */
export const DEFERRED_TOOLS_GUIDANCE =
  "Tools for Word, Excel, PowerPoint, PDF and email files (.msg, .eml), the project model, draw.io diagrams, posters and structured-exchange documents are not listed until needed. When you need one, load it with tool_search, e.g. tool_search \"read an Excel spreadsheet\".";

export interface SystemPromptConfig {
  webContext: boolean;
  appendSystemPrompt: readonly string[];
  tools?: readonly string[];
  /** No extensions: Pi's tool search is not loaded, so the deferred tools cannot be searched for. */
  noExtensions?: boolean;
  /** Sandboxed sessions use Pi Outpost's replacement toolset, which includes work_plan. */
  sandbox?: unknown;
}

export function workPlanIsAvailable(config: Pick<SystemPromptConfig, "tools" | "sandbox">): boolean {
  return config.sandbox !== undefined || config.tools === undefined || config.tools.includes("work_plan");
}

/**
 * Whether the agent can load a deferred tool with `tool_search`: the extension is loaded,
 * and no tool allowlist leaves it out. A sandboxed session ignores the allowlist.
 */
export function toolSearchIsAvailable(config: Pick<SystemPromptConfig, "tools" | "sandbox" | "noExtensions">): boolean {
  if (config.noExtensions) return false;
  return config.sandbox !== undefined || config.tools === undefined || config.tools.includes("tool_search");
}

/** One composition path for both in-process resource loading and RPC argv. */
export function composeAppendSystemPrompt(config: SystemPromptConfig): string[] {
  return [
    ...(config.webContext ? [WEB_UI_CONTEXT] : []),
    ...(workPlanIsAvailable(config) ? [WORK_PLAN_SYSTEM_GUIDANCE] : []),
    ...(toolSearchIsAvailable(config) ? [DEFERRED_TOOLS_GUIDANCE] : []),
    ...config.appendSystemPrompt,
  ];
}
