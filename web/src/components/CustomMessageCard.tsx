import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatItem } from "@pi-interface/shared";

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
    <div className="rounded-lg border border-violet-200 bg-violet-50 text-sm dark:border-violet-900/60 dark:bg-violet-950/30">
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-violet-700 dark:text-violet-300">
          [{item.customType}]
        </span>
        <div className="prose-chat min-w-0 flex-1 text-violet-950 dark:text-violet-100">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
        </div>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            title="Show details"
            className="shrink-0 text-xs text-violet-500 hover:text-violet-700 dark:text-violet-500 dark:hover:text-violet-300"
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </div>
      {open && hasDetails && (
        <pre className="max-h-96 overflow-auto border-t border-violet-200 px-3 py-2 font-mono text-xs text-violet-600 dark:border-violet-900/60 dark:text-violet-400">
          {JSON.stringify(item.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
