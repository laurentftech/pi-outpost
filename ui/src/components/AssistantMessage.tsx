import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ChatItem } from "@pi-outpost/shared";
import { normalizeMathDelimiters } from "../util/markdownMath";
import { isExternalRef, rawFileUrl, resolveRelativeHref } from "../util/workspacePath";
import { CopyButton } from "./CopyButton";
import { Mermaid } from "./Mermaid";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

interface AssistantMessageProps {
  item: AssistantItem;
  /** Backend origin for the embed widget ("" = same-origin). */
  serverUrl?: string;
  /** Auth token appended to /files/raw image URLs (img can't send headers). */
  token?: string | null;
  /** Opens a workspace-relative path in the file viewer. */
  onOpenFile?: (path: string) => void;
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

function mermaidCode(children: React.ReactNode): string | null {
  if (
    children !== null &&
    typeof children === "object" &&
    "props" in children &&
    typeof (children.props as { className?: string }).className === "string" &&
    /language-mermaid\b/.test((children.props as { className: string }).className)
  ) {
    return String((children.props as { children?: React.ReactNode }).children ?? "").trim();
  }
  return null;
}

/** Route ```mermaid fences to the Mermaid renderer, keep other code in <pre>. */
function PreBlock(props: React.HTMLAttributes<HTMLPreElement>) {
  const { children, ...rest } = props;
  const code = mermaidCode(children);
  if (code !== null) return <Mermaid code={code} />;
  return <pre {...rest}>{children}</pre>;
}

export function AssistantMessage({ item, serverUrl = "", token = null, onOpenFile }: AssistantMessageProps) {
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

    return { pre: PreBlock, img: MarkdownImg, a: MarkdownLink };
  }, [serverUrl, token]);

  return (
    <div className="group max-w-none">
      {fullText && !item.streaming && (
        <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={fullText} />
        </div>
      )}
      {item.blocks.map((block, i) =>
        block.type === "thinking" ? (
          <ThinkingBlock key={block.contentIndex ?? i} text={block.text} />
        ) : (
          <div key={block.contentIndex ?? i} className="prose-chat">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
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
