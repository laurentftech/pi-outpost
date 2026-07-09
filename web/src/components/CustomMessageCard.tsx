import { useState } from "react";
import type { ChatItem } from "@pi-interface/shared";

type CustomItem = Extract<ChatItem, { kind: "custom" }>;

/** First line only, truncated — the compact default view, never raw JSON. */
function summaryLine(text: string, max = 140): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/**
 * Extension-defined message (pi.sendMessage() with a customType). We can't run
 * the extension's own MessageRenderer (a terminal Component) — see
 * extensions.md#message-and-entry-rendering — so this shows a compact summary
 * by default, with the full text and any structured `details` behind a toggle.
 */
export function CustomMessageCard({ item }: { item: CustomItem }) {
  const [open, setOpen] = useState(false);
  const isMultiline = item.text.includes("\n");

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="font-mono text-xs uppercase text-zinc-400 dark:text-zinc-600">{item.customType}</span>
        <span className="truncate text-zinc-700 dark:text-zinc-300">{summaryLine(item.text)}</span>
        {(isMultiline || item.details !== undefined) && (
          <span className="ml-auto shrink-0 text-xs text-zinc-400 dark:text-zinc-600">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{item.text}</div>
          {item.details !== undefined && (
            <pre className="mt-2 max-h-96 overflow-auto font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {JSON.stringify(item.details, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
