import { useState } from "react";
import type { ChatItem } from "@pi-outpost/shared";

type CompactionItem = Extract<ChatItem, { kind: "compaction" }>;

/** Rounded token count, for saying how much context was replaced without spurious precision. */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/**
 * Where the conversation was compacted.
 *
 * Drawn as a rule across the transcript rather than a message, because it is not one:
 * nobody said it. What it carries is what the agent was left with in place of
 * everything above it — folded, since a reader scrolling past wants the marker, and a
 * reader wondering what the agent still remembers wants the text.
 *
 * Without this, a compacted conversation simply started at a message nobody sent first,
 * and a reader had no way to tell an answer built on the original exchange from one
 * built on three lines about it.
 */
export function CompactionBoundary({ item }: { item: CompactionItem }) {
  const [open, setOpen] = useState(false);
  const label = item.tokensBefore
    ? `Conversation compacted here — ${formatTokens(item.tokensBefore)} tokens summarised`
    : "Conversation compacted here";

  return (
    <div className="my-1" data-compaction-boundary>
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-amber-300 dark:bg-amber-900" />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
        >
          {label} {open ? "▾" : "▸"}
        </button>
        <span className="h-px flex-1 bg-amber-300 dark:bg-amber-900" />
      </div>
      {open && (
        <div className="mt-2 whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-zinc-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-zinc-300">
          <p className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-300">
            What the agent kept of everything above:
          </p>
          {item.summary || "(the runtime recorded no summary)"}
        </div>
      )}
    </div>
  );
}
