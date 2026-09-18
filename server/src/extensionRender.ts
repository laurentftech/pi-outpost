/**
 * Re-invoke pi extension TUI renderers server-side and convert ANSI → HTML.
 * Same approach as pi's export-html (`createToolHtmlRenderer`).
 *
 * Relative imports from node_modules: pi-coding-agent does not export these modules
 * in package.json "exports", so we reach into dist/ directly. Stable in the monorepo
 * layout (they are resolved at build time, so a restructured node_modules is caught
 * by tsc before shipping).
 */
import { createCustomMessage } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js";
import { ansiLinesToHtml } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/ansi-to-html.js";
import { createToolHtmlRenderer } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/tool-renderer.js";
import { getThemeByName } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import type { MessageRenderer, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";

const RENDER_WIDTH = 100;

/**
 * The theme's panel backgrounds: the boxes pi paints behind a tool card or a custom
 * message in a terminal. The widget draws its own cards, in light or dark, and the HTML
 * rendered here is shared by every client whatever its theme — so a dark panel painted
 * in by the server shows up as a black band on a light widget. They are dropped; the
 * text colours, which carry the meaning, are kept.
 */
const PANEL_BACKGROUNDS = ["toolPendingBg", "toolSuccessBg", "toolErrorBg", "customMessageBg", "userMessageBg"] as const;

/**
 * Any OSC sequence: a terminal's out-of-band control, such as the OSC 8 hyperlink pi
 * wraps around a path when it believes its terminal supports one. The HTML conversion
 * reads colours only, so it would leave `]8;;file:///…` in the text; and a `file:` URL
 * of the server's machine is no link for a browser elsewhere. The linked text stays.
 */
const OSC_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** The CSS value the HTML conversion writes for a background escape, found by converting one. */
function cssBackground(ansi: string): string | undefined {
  return /background-color:([^;"]+)/.exec(ansiLinesToHtml([`${ansi}x`]))?.[1];
}

/** The CSS value the HTML conversion writes for a text colour escape, found the same way. */
function cssColor(ansi: string): string | undefined {
  return /style="(?:[^"]*;)?color:([^;"]+)/.exec(ansiLinesToHtml([`${ansi}x`]))?.[1];
}

/**
 * Each dark-theme text colour, and the light theme's colour for the same role.
 *
 * The cards are rendered once, with the dark theme, for every client: a light widget got
 * the dark theme's pale greys and was left with a tool name barely readable. Pairing the
 * two themes role by role lets the HTML carry both — `light-dark()` picks by the widget's
 * `color-scheme`. Where two roles share a dark colour, the first role's light colour is kept.
 */
function lightCounterparts(dark: Theme, light: Theme | undefined): Map<string, string> {
  const pairs = new Map<string, string>();
  if (light === undefined) return pairs;
  const darkColors = (dark as unknown as { fgColors: Map<string, string> }).fgColors;
  const lightColors = (light as unknown as { fgColors: Map<string, string> }).fgColors;
  for (const [role, ansi] of darkColors) {
    const darkCss = cssColor(ansi);
    const lightAnsi = lightColors.get(role);
    const lightCss = lightAnsi === undefined ? undefined : cssColor(lightAnsi);
    if (darkCss === undefined || lightCss === undefined || darkCss === lightCss || pairs.has(darkCss)) continue;
    pairs.set(darkCss, lightCss);
  }
  return pairs;
}

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

/**
 * The renderers one workspace's extensions provide, and the HTML they produce.
 *
 * An instance per workspace, not a module singleton. The singleton this replaced
 * was configured by whichever project started last, so with two projects open the
 * second one's extensions rendered the first one's tool cards — with its own
 * extension runner and its own cwd, which is how a card ends up naming a path
 * that belongs to another project. Display correctness rather than a boundary:
 * nothing crosses the sandbox here, but what the reader sees is attributed to the
 * wrong project.
 */
export class ExtensionRenderer {
  private deps?: ExtensionRenderDeps;
  private theme?: Theme;
  private toolRenderer?: ReturnType<typeof createToolHtmlRenderer>;
  /** The CSS values of the theme's panel backgrounds, to be dropped from what is rendered. */
  private panelBackgrounds = new Set<string>();
  /** Each text colour of the rendering theme, and its counterpart for a light widget. */
  private lightColors = new Map<string, string>();

  configure(next: ExtensionRenderDeps | undefined): void {
    this.deps = next;
    this.theme = next ? (getThemeByName(next.themeName ?? "dark") ?? getThemeByName("dark")) : undefined;
    this.panelBackgrounds = new Set(
      PANEL_BACKGROUNDS.map((key) => {
        try {
          return cssBackground(this.theme?.getBgAnsi(key as never) ?? "");
        } catch {
          return undefined;
        }
      }).filter((value): value is string => value !== undefined),
    );
    try {
      this.lightColors = this.theme ? lightCounterparts(this.theme, getThemeByName("light")) : new Map();
    } catch {
      this.lightColors = new Map();
    }
    this.toolRenderer =
      next && this.theme
        ? createToolHtmlRenderer({
            getToolDefinition: (name: string) => next.getToolDefinition(name),
            theme: this.theme,
            cwd: next.cwd,
            width: RENDER_WIDTH,
          })
        : undefined;
  }

  private forTheWidget(html: string | undefined): string | undefined {
    return html === undefined ? undefined : withLightCounterparts(withoutTerminalMarkup(html, this.panelBackgrounds), this.lightColors);
  }

  /** Render an extension's compact call header, if it provides one. */
  renderToolCallHtml(toolCallId: string, toolName: string, args: unknown): string | undefined {
    if (!this.toolRenderer) return undefined;
    try {
      const html = this.forTheWidget(this.toolRenderer.renderCall(toolCallId, toolName, args));
      return html === undefined ? undefined : withoutBlankEdges(html).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  renderToolResultHtml(
    toolCallId: string,
    toolName: string,
    content: string | ToolContentBlock[] | undefined,
    details: unknown,
    isError: boolean,
  ): RenderedHtml | undefined {
    if (!this.toolRenderer) return undefined;
    try {
      const blocks = normalizeToolContent(content);
      const rendered = this.toolRenderer.renderResult(toolCallId, toolName, blocks, details, isError);
      const expanded = this.forTheWidget(rendered?.expanded);
      const collapsed = this.forTheWidget(rendered?.collapsed);
      if (!expanded?.trim()) return undefined;
      return {
        expanded,
        ...(collapsed && collapsed !== expanded ? { collapsed } : {}),
      };
    } catch {
      return undefined;
    }
  }

  renderCustomMessageHtml(
    customType: string,
    content: string | ToolContentBlock[],
    details: unknown | undefined,
    display: boolean,
  ): RenderedHtml | undefined {
    if (!this.deps || !this.theme) return undefined;
    const msgRenderer = this.deps.getMessageRenderer(customType);
    if (!msgRenderer) return undefined;

    try {
      const message = createCustomMessage(
        customType,
        content as Parameters<typeof createCustomMessage>[1],
        display,
        details,
        new Date().toISOString(),
      );
      const collapsed = this.forTheWidget(componentToHtml(msgRenderer(message, { expanded: false, outputPad: 0 }, this.theme) as RenderComponent));
      const expanded = this.forTheWidget(componentToHtml(msgRenderer(message, { expanded: true, outputPad: 0 }, this.theme) as RenderComponent));
      if (!expanded) return undefined;
      return {
        expanded,
        ...(collapsed && collapsed !== expanded ? { collapsed } : {}),
      };
    } catch {
      return undefined;
    }
  }
}

/**
 * What a terminal needs and a browser does not: OSC sequences, and the panel
 * backgrounds of the theme. Whatever else the HTML carries is left alone.
 */
export function withoutTerminalMarkup(html: string, panelBackgrounds: ReadonlySet<string>): string {
  let cleaned = html.replace(OSC_SEQUENCE, "");
  for (const background of panelBackgrounds) cleaned = cleaned.split(`background-color:${background}`).join("");
  // A style left with only separators, or nothing at all, is dropped with its attribute.
  return cleaned.replace(/style="([^"]*)"/g, (whole, body: string) => {
    const kept = body.split(";").map((part) => part.trim()).filter(Boolean).join(";");
    return kept === "" ? "" : `style="${kept}"`;
  }).replace(/<span >/g, "<span>");
}

/**
 * Every text colour that has a light counterpart, written as `light-dark(light, dark)`:
 * one HTML for every client, each showing the theme its widget is in. A background is
 * left alone — `background-color` is not a text colour.
 */
export function withLightCounterparts(html: string, lightColors: ReadonlyMap<string, string>): string {
  if (lightColors.size === 0) return html;
  return html.replace(/(^|[;"\s])color:([^;"]+)/g, (whole, before: string, value: string) => {
    const light = lightColors.get(value.trim());
    return light === undefined ? whole : `${before}color:light-dark(${light}, ${value.trim()})`;
  });
}

/** A rendered line holding nothing but spaces, or the placeholder the conversion writes for an empty one. */
const BLANK_LINE = /^<div class="ansi-line">(?:\s|&nbsp;|<span[^>]*>(?:\s|&nbsp;)*<\/span>)*<\/div>/;

/**
 * A call header without the blank rows around it: the padding of the panel pi draws in
 * a terminal, which, once its background is gone, only makes one card taller than the next.
 */
export function withoutBlankEdges(html: string): string {
  const lines = html.match(/<div class="ansi-line">[\s\S]*?<\/div>/g);
  if (lines === null || lines.join("") !== html) return html;
  let start = 0;
  let end = lines.length;
  while (start < end && BLANK_LINE.test(lines[start])) start += 1;
  while (end > start && BLANK_LINE.test(lines[end - 1])) end -= 1;
  return lines.slice(start, end).join("");
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
