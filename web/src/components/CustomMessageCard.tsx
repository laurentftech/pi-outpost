import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ChatItem } from "@pi-outpost/shared";
import { normalizeMathDelimiters } from "../markdownMath";

type CustomItem = Extract<ChatItem, { kind: "custom" }>;

/**
 * Extension-defined message (pi.sendMessage() with a customType). We can't run
 * an extension's own registered MessageRenderer (a terminal Component) — see
 * extensions.md#message-and-entry-rendering — but when an extension doesn't
 * register one, pi's TUI still applies a default look: a violet background,
 * a bold colored [customType] label, and markdown-rendered content. This
 * mirrors that default (customMessageBg/Label/Text in pi's theme).
 */
export function CustomMessageCard({ item }: { item: CustomItem }) {
  const [open, setOpen] = useState(false);
  const hasDetails = item.details !== undefined;

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm dark:border-violet-900/60 dark:bg-violet-950/30">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-bold text-violet-700 dark:text-violet-300">[{item.customType}]</span>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            title={open ? "Hide details" : "Show details"}
            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-900/40"
          >
            {open ? "▾" : "▸"} Details
          </button>
        )}
      </div>
      <div className="prose-chat mt-1 text-violet-950 dark:text-violet-100">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {normalizeMathDelimiters(item.text)}
        </ReactMarkdown>
      </div>
      {open && hasDetails && (
        <pre className="mt-2 max-h-96 overflow-auto border-t border-violet-200 pt-2 font-mono text-xs text-violet-600 dark:border-violet-900/60 dark:text-violet-400">
          {JSON.stringify(item.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
