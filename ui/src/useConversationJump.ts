import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem } from "@pi-outpost/shared";

interface JumpOptions {
  items: ChatItem[];
  /** The conversation scroller — jump targets are looked up inside it. */
  scrollerRef: React.RefObject<HTMLElement | null>;
  /** True while tool cards are filtered out of the conversation. */
  hideTools: boolean;
  /** Reveals tool cards; called before jumping to one that is filtered out. */
  onShowTools: () => void;
  /** Set to false on a jump so the stick-to-bottom effect does not yank it back. */
  stickToBottom: React.MutableRefObject<boolean>;
}

/** How long the target stays marked after arrival. */
const HIGHLIGHT_MS = 2000;

/**
 * Scrolls the conversation to an item by its index and marks it briefly.
 *
 * The index is the analysis panel's navigation identity (see
 * `util/sessionAnalysis.ts`): items carry it as `data-item-index`, which is what
 * this looks up. A tool call the conversation is currently filtering out is
 * revealed first — scrolling to an unrendered node would make the click a
 * silent no-op, the worst outcome for a navigation affordance.
 */
export function useConversationJump({ items, scrollerRef, hideTools, onShowTools, stickToBottom }: JumpOptions) {
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  // Bumped per jump so a second jump to the same item still scrolls.
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const jumpToItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      // Revealing tools re-renders; the effect below runs after that render, so
      // the target node exists by the time it is looked up.
      if (item.kind === "tool" && hideTools) onShowTools();
      pending.current = index;
      setNonce((current) => current + 1);
    },
    [items, hideTools, onShowTools],
  );

  useEffect(() => {
    const index = pending.current;
    if (index === null) return;
    pending.current = null;
    const target = scrollerRef.current?.querySelector(`[data-item-index="${index}"]`);
    if (!target) return;
    stickToBottom.current = false;
    target.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setHighlightIndex(index);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHighlightIndex(null), HIGHLIGHT_MS);
  }, [nonce, hideTools, scrollerRef, stickToBottom]);

  return { jumpToItem, highlightIndex };
}
