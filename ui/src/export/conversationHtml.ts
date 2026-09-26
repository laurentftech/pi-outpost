/**
 * A conversation, as one file somebody can keep.
 *
 * The document has to survive being sent: opened years later, from a disk, with no
 * server, no network and no JavaScript, by a reader who never ran this application.
 * Three consequences run through everything below.
 *
 * - **Nothing is referenced.** Workspace images travel as `data:` URIs, diagrams as
 *   inline SVG, equations as MathML — which is why KaTeX is asked for MathML rather
 *   than its own HTML, whose legibility depends on a stylesheet and four font files.
 * - **Nothing runs.** Tool calls fold through `<details>`, which needs no script, and
 *   the markup goes through the transcript's own allow-list. The archive will be opened
 *   somewhere we know nothing about; a reply that cannot execute on screen must not
 *   execute there either.
 * - **Nothing is inferred from the screen.** The document is built from the items, not
 *   from the DOM, so a collapsed card and a hidden filter change nothing about what the
 *   file contains. An archive is of the conversation, not of the window.
 */
import { toHtml } from "hast-util-to-html";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { ChatItem } from "@pi-outpost/shared";
import { chatHtmlSchema } from "../components/AssistantMessage";
import { normalizeMathDelimiters } from "../util/markdownMath";

/** What the document says about itself, so a file arriving alone still explains itself. */
export interface ConversationMeta {
  /** The project the conversation ran in, when the server named one. */
  project?: string;
  /** The session's name, or its id when it was never named. */
  session: string;
  /** The model that answered. */
  model?: string;
  /** When the file was produced. */
  exportedAt: Date;
}

/** A workspace image, fetched and ready to travel inside the document. */
export interface InlineImage {
  dataUrl: string;
  /** Bytes the data URI costs the document, for the budget. */
  bytes: number;
}

export interface ConversationHtmlOptions {
  meta: ConversationMeta;
  /** A workspace reference as a `data:` URI, or `undefined` when it cannot be had. */
  loadImage: (src: string) => Promise<InlineImage | undefined>;
  /** A mermaid source as inline SVG, or `undefined` to leave the source text in place. */
  renderDiagram?: (source: string, id: string) => Promise<string | undefined>;
  /** Largest document this export will produce, in bytes of embedded media. */
  budgetBytes?: number;
  /** Told how many items have been rendered, so a long export is not silent. */
  onProgress?: (rendered: number, total: number) => void;
}

/**
 * The export stopped because the document would have been too large.
 *
 * Raised rather than dropping content: a document with pictures silently missing
 * cannot be told from a complete one, which is the failure mode this whole change
 * exists to remove.
 */
export class ExportBudgetError extends Error {
  readonly bytes: number;
  readonly budgetBytes: number;

  constructor(bytes: number, budgetBytes: number) {
    super(
      `the conversation's images come to ${Math.round(bytes / 1024)} kB, over the ${Math.round(budgetBytes / 1024)} kB this export embeds`,
    );
    this.name = "ExportBudgetError";
    this.bytes = bytes;
    this.budgetBytes = budgetBytes;
  }
}

/** Default ceiling on embedded media: generous for a conversation, still openable. */
export const DEFAULT_BUDGET_BYTES = 40 * 1024 * 1024;

// --- hast ------------------------------------------------------------------

/**
 * The tree shapes this module touches.
 *
 * Declared locally and structurally: what comes out of the pipeline is hast, and the
 * two things done to it here — swapping an image's source, replacing a mermaid block —
 * need a tag name, properties and children, nothing more.
 */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

const markdownToHast = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  // The same allow-list the conversation is rendered through, for the same reason: the
  // text is untrusted whoever produced it, and an archive is read further from home.
  .use(rehypeSanitize, chatHtmlSchema)
  // MathML, not KaTeX's HTML: a browser draws it with nothing attached.
  .use(rehypeKatex, { output: "mathml" });

/** The class a fenced mermaid block carries once markdown has become hast. */
function fenceLanguage(node: HastNode): string | undefined {
  const className = node.properties?.className;
  const names = Array.isArray(className) ? className.map(String) : typeof className === "string" ? [className] : [];
  const language = names.find((name) => name.startsWith("language-"));
  return language?.slice("language-".length);
}

/**
 * Walk the tree, replacing what cannot travel as it is.
 *
 * Asynchronous because both replacements are: an image has to be fetched, a diagram
 * has to be drawn. Done over the tree rather than over the text, so a fence inside a
 * quoted example is a fence and a path inside prose stays prose.
 */
async function inlineReferences(
  node: HastNode,
  options: ConversationHtmlOptions,
  state: { bytes: number; diagrams: number },
): Promise<HastNode> {
  if (node.tagName === "img") {
    const src = typeof node.properties?.src === "string" ? node.properties.src : "";
    const image = src ? await options.loadImage(src) : undefined;
    if (!image) {
      // The picture could not be had. Its alt text is what the reader gets, which is
      // what the viewer's own export does — a document is worth more than an image.
      const alt = typeof node.properties?.alt === "string" ? node.properties.alt : src;
      return { type: "element", tagName: "em", properties: {}, children: [{ type: "text", value: `[image: ${alt}]` }] };
    }
    state.bytes += image.bytes;
    const budget = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
    if (state.bytes > budget) throw new ExportBudgetError(state.bytes, budget);
    return { ...node, properties: { ...node.properties, src: image.dataUrl, loading: "lazy" } };
  }

  // A fenced diagram: <pre><code class="language-mermaid">…
  if (node.tagName === "pre" && node.children?.length === 1 && node.children[0].tagName === "code") {
    const code = node.children[0];
    if (fenceLanguage(code) === "mermaid" && options.renderDiagram) {
      const source = textOf(code);
      state.diagrams += 1;
      const svg = await options.renderDiagram(source, `pi-export-diagram-${state.diagrams}`);
      // An undrawable diagram keeps its source: a reader can see what was meant, and a
      // broken diagram never fails the export.
      if (svg) {
        return {
          type: "element",
          tagName: "figure",
          properties: { className: ["diagram"] },
          children: [{ type: "raw", value: svg }],
        };
      }
    }
  }

  if (!node.children) return node;
  const children: HastNode[] = [];
  for (const child of node.children) children.push(await inlineReferences(child, options, state));
  return { ...node, children };
}

/** All the text under a node, which is what a code fence's content is. */
function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** One message's markdown as document HTML, with everything it references inside it. */
async function markdownToHtml(
  markdown: string,
  options: ConversationHtmlOptions,
  state: { bytes: number; diagrams: number },
): Promise<string> {
  const tree = await markdownToHast.run(markdownToHast.parse(normalizeMathDelimiters(markdown)));
  const inlined = await inlineReferences(tree as unknown as HastNode, options, state);
  // `allowDangerousHtml` lets the raw nodes an inlined diagram introduces through. The
  // SVG is ours — mermaid's output, styles inlined — and never the reply's own markup,
  // which went through the allow-list above before this point.
  return toHtml(inlined as never, { allowDangerousHtml: true });
}

// --- the document ----------------------------------------------------------

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The document's own stylesheet.
 *
 * Written for the document rather than lifted from the application: the app's CSS is a
 * Tailwind build sized for an app, and what an archive needs is a readable column in
 * either colour scheme. `prefers-color-scheme` rather than a toggle, because a toggle
 * is a script.
 */
const STYLESHEET = `
:root {
  --bg: #ffffff; --fg: #18181b; --muted: #71717a; --line: #e4e4e7;
  --user-bg: #eff6ff; --tool-bg: #fafafa; --mark-bg: #fffbeb; --mark-fg: #92400e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #18181b; --fg: #e4e4e7; --muted: #a1a1aa; --line: #3f3f46;
    --user-bg: #1e293b; --tool-bg: #27272a; --mark-bg: #292524; --mark-fg: #fcd34d;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1rem; background: var(--bg); color: var(--fg);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
main { max-width: 46rem; margin: 0 auto; }
header.doc { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 2rem; }
header.doc h1 { font-size: 1.4rem; margin: 0 0 0.35rem; }
header.doc dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.75rem; margin: 0; font-size: 0.85rem; color: var(--muted); }
header.doc dt { font-weight: 600; }
header.doc dd { margin: 0; }
article { margin: 1.25rem 0; }
article > .who { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 0.3rem; }
article.user .body { background: var(--user-bg); border-radius: 0.6rem; padding: 0.6rem 0.9rem; }
article.reasoning .body { border-left: 2px solid var(--line); padding-left: 0.9rem; color: var(--muted); font-style: italic; }
details.tool { background: var(--tool-bg); border: 1px solid var(--line); border-radius: 0.6rem; padding: 0.4rem 0.7rem; }
details.tool > summary { cursor: pointer; font-size: 0.85rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
details.tool pre { white-space: pre-wrap; word-break: break-word; }
.compaction { display: flex; align-items: center; gap: 0.6rem; margin: 2rem 0; color: var(--mark-fg); font-size: 0.8rem; }
.compaction::before, .compaction::after { content: ""; flex: 1; height: 1px; background: currentColor; opacity: 0.4; }
.compaction-summary { background: var(--mark-bg); color: var(--fg); border-radius: 0.6rem; padding: 0.6rem 0.9rem; font-size: 0.9rem; }
pre { background: var(--tool-bg); border-radius: 0.5rem; padding: 0.7rem; overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
img, svg { max-width: 100%; height: auto; }
figure.diagram { margin: 1rem 0; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--line); padding: 0.3rem 0.5rem; text-align: left; }
blockquote { margin: 0.8rem 0; padding-left: 0.9rem; border-left: 3px solid var(--line); color: var(--muted); }
footer.doc { margin-top: 3rem; border-top: 1px solid var(--line); padding-top: 0.8rem; font-size: 0.75rem; color: var(--muted); }
`.trim();

/** How the two sides of the exchange are named in the document. */
const WHO = { user: "You", assistant: "Agent" } as const;

/** One item, as a section of the document. */
async function itemToHtml(
  item: ChatItem,
  options: ConversationHtmlOptions,
  state: { bytes: number; diagrams: number },
): Promise<string> {
  switch (item.kind) {
    case "user": {
      const images = (item.images ?? [])
        .map((image) => `<img src="data:${escapeHtml(image.mimeType)};base64,${image.data}" alt="attached image" />`)
        .join("\n");
      const body = await markdownToHtml(item.text, options, state);
      return `<article class="user"><p class="who">${WHO.user}</p><div class="body">${body}${images}</div></article>`;
    }
    case "assistant": {
      const parts: string[] = [];
      for (const block of item.blocks) {
        const body = await markdownToHtml(block.text, options, state);
        // Reasoning is kept and marked as reasoning. An archive that drops it would be
        // hiding how an answer was reached from the only reader who still has it.
        parts.push(
          block.type === "thinking"
            ? `<div class="body"><p class="who">reasoning</p>${body}</div>`
            : `<div class="body">${body}</div>`,
        );
      }
      const failure = item.errorMessage ? `<p class="body"><em>${escapeHtml(item.errorMessage)}</em></p>` : "";
      const classes = item.blocks.every((block) => block.type === "thinking") ? "assistant reasoning" : "assistant";
      return `<article class="${classes}"><p class="who">${WHO.assistant}</p>${parts.join("\n")}${failure}</article>`;
    }
    case "tool": {
      const args = typeof item.args === "string" ? item.args : JSON.stringify(item.args ?? {}, null, 2);
      const status = item.isError ? " — failed" : "";
      return [
        `<article class="tool"><details class="tool">`,
        `<summary>${escapeHtml(item.toolName)}${status}</summary>`,
        `<pre><code>${escapeHtml(args)}</code></pre>`,
        `<pre><code>${escapeHtml(item.output)}</code></pre>`,
        `</details></article>`,
      ].join("");
    }
    case "custom":
      return `<article class="custom"><p class="who">${escapeHtml(item.customType)}</p><div class="body"><pre><code>${escapeHtml(item.text)}</code></pre></div></article>`;
    case "compaction": {
      const tokens = item.tokensBefore ? ` — ${Math.round(item.tokensBefore / 1000)}k tokens summarised` : "";
      const summary = item.summary
        ? `<div class="compaction-summary">${await markdownToHtml(item.summary, options, state)}</div>`
        : "";
      return `<div class="compaction">conversation compacted here${escapeHtml(tokens)}</div>${summary}`;
    }
  }
}

/**
 * The whole conversation as one self-contained HTML document.
 *
 * `items` is expected to be the conversation entire — including what compaction took
 * out of the model's context. Collecting that is the caller's job, and the reason the
 * export does not read the transcript on screen.
 */
export async function conversationToHtml(items: ChatItem[], options: ConversationHtmlOptions): Promise<string> {
  const state = { bytes: 0, diagrams: 0 };
  const sections: string[] = [];
  for (const [index, item] of items.entries()) {
    sections.push(await itemToHtml(item, options, state));
    options.onProgress?.(index + 1, items.length);
  }

  const { meta } = options;
  const title = meta.project ? `${meta.session} — ${meta.project}` : meta.session;
  const rows: string[] = [];
  if (meta.project) rows.push(`<dt>Project</dt><dd>${escapeHtml(meta.project)}</dd>`);
  rows.push(`<dt>Session</dt><dd>${escapeHtml(meta.session)}</dd>`);
  if (meta.model) rows.push(`<dt>Model</dt><dd>${escapeHtml(meta.model)}</dd>`);
  rows.push(`<dt>Exported</dt><dd>${escapeHtml(meta.exportedAt.toISOString().slice(0, 10))}</dd>`);
  rows.push(`<dt>Messages</dt><dd>${items.length}</dd>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${STYLESHEET}
</style>
</head>
<body>
<main>
<header class="doc">
<h1>${escapeHtml(title)}</h1>
<dl>${rows.join("")}</dl>
</header>
${sections.join("\n")}
<footer class="doc">Exported from pi-outpost. This file is self-contained: it needs no network and no scripting.</footer>
</main>
</body>
</html>
`;
}
