import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatItem } from "@pi-interface/shared";
import { Mermaid } from "./Mermaid";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

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

export function AssistantMessage({ item }: { item: AssistantItem }) {
  return (
    <div className="max-w-none">
      {item.blocks.map((block, i) =>
        block.type === "thinking" ? (
          <ThinkingBlock key={block.contentIndex ?? i} text={block.text} />
        ) : (
          <div key={block.contentIndex ?? i} className="prose-chat">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: PreBlock }}>
              {block.text}
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
