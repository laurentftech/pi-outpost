import { useEffect, useRef, type RefObject } from "react";

export interface FindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Matches found so far — the true count while `truncated`/`searching` is still growing. */
  matchCount: number;
  /** More matches exist than are being marked/counted (see MAX_HIGHLIGHTED_MATCHES). */
  truncated?: boolean;
  /** 0-based index of the current match; meaningless (and ignored) when matchCount is 0. */
  currentIndex: number;
  /** A PDF's document-wide index is still being built — matches found so far are shown as partial. */
  searching?: boolean;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Lets the caller refocus the query field after moving focus elsewhere to
   * indicate a match (edit-mode's textarea selection) — falls back to an
   * internal ref when omitted. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * Find-in-page bar: query, match count, next/previous, close.
 *
 * One component for every searchable view in the file viewer — text, code, Markdown
 * in either mode, an in-progress edit, and a PDF — because none of them need a
 * different UI for it, only a different source of matches.
 */
export function FindBar({
  query,
  onQueryChange,
  matchCount,
  truncated = false,
  currentIndex,
  searching = false,
  onNext,
  onPrev,
  onClose,
  inputRef: externalInputRef,
}: FindBarProps) {
  const ownInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? ownInputRef;

  // Opening the bar (including reopening on a second Ctrl+F) always refocuses the
  // query and selects it, so retyping replaces rather than appends.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const countLabel =
    matchCount === 0 ? (searching ? "searching…" : "0/0") : `${currentIndex + 1}/${matchCount}${truncated ? "+" : ""}`;

  return (
    <div
      role="search"
      aria-label="Find in file"
      className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrev();
            else onNext();
          } else if (event.key === "Escape") {
            // Stopped here, not left to bubble to FileViewer's document-level
            // listener: one Escape press must close only the find bar, not the
            // find bar and the viewer together on the same keystroke. A second,
            // separate Escape (find bar already closed) reaches that listener
            // and closes the viewer, as it does without this feature.
            event.stopPropagation();
            onClose();
          }
        }}
        placeholder="Find in file"
        aria-label="Find"
        className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
      />
      <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{countLabel}</span>
      <button
        type="button"
        onClick={onPrev}
        disabled={matchCount === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        className="shrink-0 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label="Next match"
        title="Next match (Enter)"
        className="shrink-0 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        ›
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close find bar"
        title="Close (Esc)"
        className="shrink-0 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        ✕
      </button>
    </div>
  );
}
