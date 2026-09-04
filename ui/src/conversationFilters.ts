/**
 * What the conversation shows.
 *
 * The values here are in *shown* semantics — `tools: true` means tool cards are
 * in the list — because that is what the filter menu presents, and a menu whose
 * checkboxes mean "hide this" reads as a double negative.
 *
 * The stored keys are the opposite polarity, and deliberately so: the tool
 * filter shipped as `pi-outpost:hide-tools`, and inverting the stored value
 * would silently flip the preference of everyone who already set it. The
 * inversion happens here, once, at the boundary.
 */
export type ConversationFilterKind = "tools" | "reasoning";

/** True means the kind is shown. */
export type ConversationFilters = Record<ConversationFilterKind, boolean>;

const HIDE_KEYS: Record<ConversationFilterKind, string> = {
  tools: "pi-outpost:hide-tools",
  reasoning: "pi-outpost:hide-reasoning",
};

export const CONVERSATION_FILTER_KINDS: ConversationFilterKind[] = ["tools", "reasoning"];

export const CONVERSATION_FILTER_LABELS: Record<ConversationFilterKind, string> = {
  tools: "Tool calls",
  reasoning: "Reasoning",
};

/**
 * Storage can throw outright — a private window, a browser set to block site
 * data, an embed on a third-party origin. Showing everything is the right answer
 * there: it is what an unconfigured browser sees, and it loses nothing.
 */
function hidden(kind: ConversationFilterKind): boolean {
  try {
    return localStorage.getItem(HIDE_KEYS[kind]) === "1";
  } catch {
    return false;
  }
}

export function readConversationFilters(): ConversationFilters {
  return { tools: !hidden("tools"), reasoning: !hidden("reasoning") };
}

/** Writes one kind's preference; the other's key is never touched. */
export function persistConversationFilter(kind: ConversationFilterKind, shown: boolean): void {
  try {
    localStorage.setItem(HIDE_KEYS[kind], shown ? "0" : "1");
  } catch {
    // Storage unavailable — the filter still works for this session.
  }
}

/** How many kinds are hidden, for the closed menu's own label. */
export function hiddenCount(filters: ConversationFilters): number {
  return CONVERSATION_FILTER_KINDS.filter((kind) => !filters[kind]).length;
}
