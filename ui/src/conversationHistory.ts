/**
 * Reading a conversation back past compaction.
 *
 * The server holds the session file and serves the items the model's context no longer
 * has; this is the client's side of that request — the failures it can come back with,
 * and the walk that collects the whole of it for an export.
 */
import type { ChatItem } from "@pi-outpost/shared";
import { HISTORY_CHUNK } from "@pi-outpost/shared";

/**
 * Why a request for older transcript came back with nothing.
 *
 * `unsupported` is a property of the deployment and worth telling the reader about;
 * `stale` means the session moved and the transcript has already been replaced, so
 * there is nothing to say; `failed` is a dropped connection or a timeout, which the
 * reader can retry.
 */
export type HistoryFailure = "unsupported" | "stale" | "failed";

export class HistoryError extends Error {
  readonly kind: HistoryFailure;

  constructor(message: string, kind: HistoryFailure) {
    super(message);
    this.name = "HistoryError";
    this.kind = kind;
  }
}

/** One window of older transcript, as the server serves it. */
export interface HistoryWindow {
  items: ChatItem[];
  /** Items still older than these. */
  remaining: number;
}

export type HistoryFetch = (have: number, count: number) => Promise<HistoryWindow>;

/**
 * Every item the conversation has above the transcript, oldest first.
 *
 * Walks back in chunks until the server says nothing remains. Nothing is put on screen:
 * an export needs the whole conversation, and forcing a thousand turns into a list that
 * is not virtualised would make taking the file away cost more than reading it.
 *
 * `onProgress` is called with how many items have been collected, because a long
 * conversation takes several round trips and a silent wait reads as a hang.
 */
export async function collectOlderItems(
  fetch: HistoryFetch,
  onProgress?: (collected: number) => void,
): Promise<ChatItem[]> {
  const collected: ChatItem[] = [];
  for (;;) {
    const window = await fetch(collected.length, HISTORY_CHUNK);
    // No items and something still remaining would loop forever. The server only
    // answers this way if the prefix shrank under us, which a snapshot has by then
    // already reported — stop rather than spin.
    if (window.items.length === 0) return collected;
    collected.unshift(...window.items);
    onProgress?.(collected.length);
    if (window.remaining === 0) return collected;
  }
}
