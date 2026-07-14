/**
 * Re-invoke pi extension TUI renderers server-side and convert ANSI → HTML.
 * Same approach as pi's export-html (`createToolHtmlRenderer`).
 *
 * pi-coding-agent does not export these modules in package.json "exports", so we
 * import from node_modules by relative path (stable in this monorepo layout).
 */
import { createCustomMessage } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js";
import { ansiLinesToHtml } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/ansi-to-html.js";
import { createToolHtmlRenderer } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/tool-renderer.js";
import { getThemeByName } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import type { MessageRenderer, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";

const RENDER_WIDTH = 100;

/** Minimal pi-tui Component surface used by renderers. */
interface RenderComponent {
  render(width: number): string[];
}

export interface RenderedHtml {
  /** Expanded view (always present when rendering succeeds). */
  expanded: string;
  /** Collapsed preview when it differs from expanded. */
  collapsed?: string;
}

export interface ExtensionRenderDeps {
  getToolDefinition: (name: string) => ToolDefinition | undefined;
  getMessageRenderer: (customType: string) => MessageRenderer | undefined;
  cwd: string;
  themeName?: string;
}

let deps: ExtensionRenderDeps | undefined;
let theme: Theme | undefined;
let toolRenderer: ReturnType<typeof createToolHtmlRenderer> | undefined;

export function configureExtensionRender(next: ExtensionRenderDeps | undefined): void {
  deps = next;
  theme = next ? (getThemeByName(next.themeName ?? "dark") ?? getThemeByName("dark")) : undefined;
  toolRenderer =
    next && theme
      ? createToolHtmlRenderer({
          getToolDefinition: (name: string) => next.getToolDefinition(name),
          theme,
          cwd: next.cwd,
          width: RENDER_WIDTH,
        })
      : undefined;
}

function componentToHtml(component: RenderComponent | undefined): string | undefined {
  if (!component) return undefined;
  try {
    const html = ansiLinesToHtml(component.render(RENDER_WIDTH));
    return html.trim() ? html : undefined;
  } catch {
    return undefined;
  }
}

export type ToolContentBlock = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

export function normalizeToolContent(content: string | ToolContentBlock[] | undefined): ToolContentBlock[] {
  if (content === undefined) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return content;
}

/** Render an extension's compact call header, if it provides one. */
export function renderToolCallHtml(
  toolCallId: string,
  toolName: string,
  args: unknown,
): string | undefined {
  if (!toolRenderer) return undefined;
  try {
    const html = toolRenderer.renderCall(toolCallId, toolName, args);
    return html?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function renderToolResultHtml(
  toolCallId: string,
  toolName: string,
  content: string | ToolContentBlock[] | undefined,
  details: unknown,
  isError: boolean,
): RenderedHtml | undefined {
  if (!toolRenderer) return undefined;
  try {
    const blocks = normalizeToolContent(content);
    const rendered = toolRenderer.renderResult(toolCallId, toolName, blocks, details, isError);
    if (!rendered?.expanded?.trim()) return undefined;
    return {
      expanded: rendered.expanded,
      ...(rendered.collapsed && rendered.collapsed !== rendered.expanded
        ? { collapsed: rendered.collapsed }
        : {}),
    };
  } catch {
    return undefined;
  }
}

export function renderCustomMessageHtml(
  customType: string,
  content: string | ToolContentBlock[],
  details: unknown | undefined,
  display: boolean,
): RenderedHtml | undefined {
  if (!deps || !theme) return undefined;
  const renderer = deps.getMessageRenderer(customType);
  if (!renderer) return undefined;

  try {
    const message = createCustomMessage(
      customType,
      content as Parameters<typeof createCustomMessage>[1],
      display,
      details,
      new Date().toISOString(),
    );
    const collapsed = componentToHtml(renderer(message, { expanded: false }, theme) as RenderComponent);
    const expanded = componentToHtml(renderer(message, { expanded: true }, theme) as RenderComponent);
    if (!expanded) return undefined;
    return {
      expanded,
      ...(collapsed && collapsed !== expanded ? { collapsed } : {}),
    };
  } catch {
    return undefined;
  }
}
