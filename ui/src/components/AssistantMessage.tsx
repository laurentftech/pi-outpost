import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { defaultSchema, type Schema } from "hast-util-sanitize";
import type { PluggableList } from "unified";
import type { ChatItem } from "@pi-outpost/shared";
import { normalizeMathDelimiters } from "../util/markdownMath";
import { isExternalRef, rawFileUrl, resolveRelativeHref } from "../util/workspacePath";
import { CopyButton } from "./CopyButton";
import { MarkdownPre } from "./Mermaid";

type AttributeSchema = NonNullable<Schema["attributes"]>;
type PropertyDefinition = AttributeSchema[string][number];

/** `"className"`, or the `["className", …allowed values]` narrowing form. */
function definesClassName(definition: PropertyDefinition): boolean {
  return definition === "className" || (Array.isArray(definition) && definition[0] === "className");
}

/**
 * Allow `className` on every element, dropping the per-tag narrowings the
 * default schema carries.
 *
 * Listing `className` under `*` is not enough on its own: a tag's own entry
 * wins over `*` for a given property rather than merging with it
 * (`properties()` in hast-util-sanitize consults `*` only once the
 * tag-specific definition has rejected the value). The default narrows
 * `className` on seven tags — `a` to `data-footnote-backref`, `code` to
 * `language-*`, `li` to `task-list-item`, and so on — so a class hook on any
 * of those would still be stripped, silently and only for those tags. A
 * styling hook that works on `<details>` but not on the `<a>` inside it is
 * worse than none, so the narrowings go and `*` carries the property.
 */
function allowClassNameEverywhere(attributes: AttributeSchema): AttributeSchema {
  const widened: AttributeSchema = {};
  for (const [tagName, definitions] of Object.entries(attributes)) {
    widened[tagName] = definitions.filter((definition) => !definesClassName(definition));
  }
  widened["*"] = [...(widened["*"] ?? []), "className"];
  return widened;
}

/**
 * The allow-list raw HTML in a reply is filtered against.
 *
 * `hast-util-sanitize`'s default schema is the baseline — the same list the
 * remark ecosystem uses for HTML in markdown. It already strips scripts, event
 * handlers, `javascript:` URLs, iframes, styles and every unknown element, and
 * nothing here loosens that. The two additions are inert:
 *   - `details`/`summary`, the disclosure elements an extension appends its
 *     sources block with. The default already lists them; naming them here
 *     makes the guarantee ours rather than a detail of the dependency.
 *   - `className`, the styling hook a host page's CSS and enhancements need.
 *
 * `id` and `name` keep the default `user-content-` clobber prefix, so markup a
 * model wrote cannot shadow a global on the page the widget is embedded in.
 * The cost is that GFM footnote anchors, already namespaced by `remark-rehype`,
 * are prefixed a second time and no longer link to their notes — the notes
 * themselves still render. See design.md.
 */
export const chatHtmlSchema: Schema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), "details", "summary"])],
  attributes: allowClassNameEverywhere(defaultSchema.attributes ?? {}),
};

/**
 * Raw HTML is reparsed by `rehype-raw`, then filtered by `rehype-sanitize`.
 * Order matters twice over: sanitizing can only happen once the raw nodes are
 * real elements, and `rehype-katex` runs after the filter so the markup KaTeX
 * generates — trusted, and full of `style` attributes the schema would strip —
 * is not subject to it.
 *
 * Module-level so the plugin array keeps one identity across renders, as
 * `ToolMarkdown` does with its own: unified rebuilds its pipeline when the
 * list changes, which on a streaming reply would be every token.
 */
const assistantRehypePlugins: PluggableList = [rehypeRaw, [rehypeSanitize, chatHtmlSchema], rehypeKatex];

const assistantRemarkPlugins: PluggableList = [remarkGfm, remarkMath];

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

interface AssistantMessageProps {
  item: AssistantItem;
  /** Backend origin for the embed widget ("" = same-origin). */
  serverUrl?: string;
  /** Auth token appended to /files/raw image URLs (img can't send headers). */
  token?: string | null;
  /** Opens a workspace-relative path in the file viewer. */
  onOpenFile?: (path: string) => void;
  /**
   * Drop the model's reasoning from the rendering. A view decision only: the
   * blocks are still here, so clearing the filter shows the message in full.
   */
  hideReasoning?: boolean;
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 rounded-lg border border-zinc-200 bg-zinc-50 text-sm dark:border-zinc-800/80 dark:bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-500"
      >
        <span className="italic">thinking</span>
        <span className="ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-zinc-200 px-3 py-2 text-xs italic text-zinc-500 dark:border-zinc-800/80">
          {text}
        </div>
      )}
    </div>
  );
}

export function AssistantMessage({ item, serverUrl = "", token = null, onOpenFile, hideReasoning = false }: AssistantMessageProps) {
  const blocks = hideReasoning ? item.blocks.filter((block) => block.type !== "thinking") : item.blocks;
  const fullText = item.blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();

  // Ref keeps the memoized components below stable even when the parent passes
  // a fresh onOpenFile closure each render — an identity change would remount
  // every <img> in the conversation on every streamed token (and refetch, the
  // endpoint is no-store).
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;

  // Workspace-relative references in replies: images load through the raw-bytes
  // endpoint, links open the file viewer. External URLs pass through untouched.
  const components = useMemo(() => {
    function MarkdownImg({ src, alt, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
      const resolved =
        typeof src === "string" && src !== "" && !isExternalRef(src)
          ? rawFileUrl(serverUrl, resolveRelativeHref("", src), token)
          : src;
      return <img {...rest} src={resolved} alt={alt ?? ""} loading="lazy" className="max-h-96 max-w-full rounded-lg object-contain" />;
    }

    function MarkdownLink({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
      if (typeof href === "string" && href !== "" && !isExternalRef(href) && onOpenFileRef.current) {
        const path = resolveRelativeHref("", href);
        return (
          <a
            {...rest}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              onOpenFileRef.current?.(path);
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a {...rest} href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    }

    return { pre: MarkdownPre, img: MarkdownImg, a: MarkdownLink };
  }, [serverUrl, token]);

  // Nothing left to draw — a filtered-away message must not leave an empty frame
  // in the conversation. The list still keeps its scroll position: it renders a
  // bare anchor for this item rather than calling this component at all.
  if (blocks.length === 0 && !item.errorMessage) return null;

  return (
    <div className="group max-w-none">
      {fullText && !item.streaming && (
        <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={fullText} />
        </div>
      )}
      {blocks.map((block, i) =>
        block.type === "thinking" ? (
          <ThinkingBlock key={block.contentIndex ?? i} text={block.text} />
        ) : (
          <div key={block.contentIndex ?? i} className="prose-chat">
            <ReactMarkdown
              remarkPlugins={assistantRemarkPlugins}
              rehypePlugins={assistantRehypePlugins}
              components={components}
            >
              {normalizeMathDelimiters(block.text)}
            </ReactMarkdown>
          </div>
        ),
      )}
      {item.errorMessage && (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {item.errorMessage}
        </div>
      )}
    </div>
  );
}
