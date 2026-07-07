import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatItem } from "../protocol";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 rounded-lg border border-zinc-800/80 bg-zinc-900/40 text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-500"
      >
        <span className="italic">thinking</span>
        <span className="ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-zinc-800/80 px-3 py-2 text-xs italic text-zinc-500">
          {text}
        </div>
      )}
    </div>
  );
}

export function AssistantMessage({ item }: { item: AssistantItem }) {
  return (
    <div className="max-w-none">
      {item.blocks.map((block, i) =>
        block.type === "thinking" ? (
          <ThinkingBlock key={i} text={block.text} />
        ) : (
          <div key={i} className="prose-chat">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
          </div>
        ),
      )}
      {item.errorMessage && (
        <div className="mt-2 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {item.errorMessage}
        </div>
      )}
    </div>
  );
}
