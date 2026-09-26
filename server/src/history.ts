/**
 * The part of a conversation the model has forgotten.
 *
 * Compaction summarizes a prefix of the branch and the agent carries on from the
 * summary — but the session file is append-only, so nothing was destroyed. The
 * entries are still there, on the same branch, in the same order. This module hands
 * them back to a reader.
 *
 * Two rules govern it, and both are about the recovered items being the same items:
 *
 * - They are converted by `historyToItems`, the function that converts the live
 *   transcript. A message recovered from five compactions ago renders exactly as it
 *   rendered when it streamed, with the same tool cards and the same figures, because
 *   nothing else is capable of rendering it differently.
 * - What counts as "forgotten" is not decided here. It is read off the runtime's own
 *   two views of the branch: everything on the branch that the context does not
 *   contain. So the seam between the recovered prefix and the live tail cannot drift
 *   from the seam the agent actually has.
 */
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { ChatItem } from "@pi-outpost/shared";
import { MAX_HISTORY_CHUNK } from "@pi-outpost/shared";
import type { AgentRuntime, RuntimeEntry } from "./agentRuntime.ts";
import { historyToItems } from "./convert.ts";
import type { ExtensionRenderer } from "./extensionRender.ts";

/**
 * A compaction entry, structurally.
 *
 * Read off the entry rather than through an SDK type for the same reason `convert.ts`
 * treats messages structurally: the shape is what the session file holds, and a
 * session written by another version of the SDK is still a session we must read.
 */
interface CompactionShape {
  type: string;
  id: string;
  firstKeptEntryId?: string;
}

/** The last compaction on the branch — the one that decides where the context starts. */
function lastCompactionIndex(branch: RuntimeEntry[]): number {
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction") return i;
  }
  return -1;
}

/**
 * What identifies a prefix: the compaction that ends it.
 *
 * An entry's ancestor chain is unique, so the entries before a given compaction entry
 * are fixed once that entry exists — a later turn, a fork, or a move to another node
 * of the same session does not change them. Keying on the leaf instead would discard
 * the cache on every prompt, for a prefix that had not moved.
 */
function prefixKey(sessionFile: string | undefined, branch: RuntimeEntry[]): string | undefined {
  const index = lastCompactionIndex(branch);
  if (index < 0) return undefined;
  const compaction = branch[index] as unknown as CompactionShape;
  return `${sessionFile ?? ""}\u0000${compaction.id}\u0000${compaction.firstKeptEntryId ?? ""}`;
}

/** Converted prefix for one session and one compaction point. */
interface CachedPrefix {
  key: string;
  items: ChatItem[];
}

const caches = new WeakMap<AgentRuntime, CachedPrefix>();

/** The runtime cannot serve a branch at all — the RPC dialect has no command for it. */
export class HistoryUnavailableError extends Error {
  constructor(runtimeKind: string) {
    super(`reading further back is not available with the ${runtimeKind} agent runtime`);
    this.name = "HistoryUnavailableError";
  }
}

export interface HistoryContext {
  browserRoot: string;
  renderer: ExtensionRenderer;
}

/**
 * Every item of the branch that the model's context no longer holds, oldest first.
 *
 * Marked `readOnly`: these entries are outside the context the agent would branch
 * from, so the operations that rewrite a conversation from a message cannot be
 * honoured on them, and an interface must not offer what would fail.
 */
export function precedingItems(runtime: AgentRuntime, context: HistoryContext): ChatItem[] {
  const branchEntries = runtime.branchEntries;
  if (!branchEntries) throw new HistoryUnavailableError(runtime.kind);
  const branch = branchEntries.call(runtime);
  const key = prefixKey(runtime.snapshot().sessionFile, branch);
  // No compaction on this branch: the context is the whole conversation, and there is
  // nothing to recover. Not an error and not worth a cache entry.
  if (key === undefined) return [];
  const cached = caches.get(runtime);
  if (cached?.key === key) return cached.items;

  const inContext = new Set(runtime.contextEntries().map((entry) => entry.id));
  const cut = lastCompactionIndex(branch);
  // Before the compaction and absent from the context: the entries whose turns were
  // summarized away. The kept ones sit in this same stretch of the branch and are in
  // the context, which is why membership is asked of the context rather than computed
  // from the compaction's own cut point — one source of truth for the seam.
  const forgotten = branch.slice(0, cut).filter((entry) => !inContext.has(entry.id));
  const items = historyToItems(
    forgotten.flatMap((entry) => entryMessages(entry)) as never,
    false,
    [],
    context.browserRoot,
    context.renderer,
  ).map((item) => ({ ...item, readOnly: true as const }));

  caches.set(runtime, { key, items });
  return items;
}

/** A window of the prefix: the `count` items that end `have` items from its end. */
export interface HistoryWindow {
  items: ChatItem[];
  /** How many items are still older than the ones returned. */
  remaining: number;
}

/**
 * The items immediately before the ones a client holds.
 *
 * `have` is how many prefix items the client already has; the window ends there and
 * reaches back at most `count`, clamped to `MAX_HISTORY_CHUNK`. A request past the
 * beginning yields no items and nothing remaining, rather than an error: a client that
 * asks twice at the boundary has not done anything wrong.
 */
export function historyWindow(
  runtime: AgentRuntime,
  context: HistoryContext,
  have: number,
  count: number,
): HistoryWindow {
  const items = precedingItems(runtime, context);
  const wanted = Math.min(Math.max(Math.trunc(count) || 0, 0), MAX_HISTORY_CHUNK);
  const end = Math.max(items.length - Math.max(Math.trunc(have) || 0, 0), 0);
  const start = Math.max(end - wanted, 0);
  return { items: items.slice(start, end), remaining: start };
}

/**
 * How many items precede the ones a snapshot carries, or `undefined` when no client
 * should offer to read further back — nothing was compacted, or this runtime cannot
 * serve the branch.
 */
export function olderItemCount(runtime: AgentRuntime, context: HistoryContext): number | undefined {
  if (!runtime.branchEntries) return undefined;
  try {
    const count = precedingItems(runtime, context).length;
    return count > 0 ? count : undefined;
  } catch {
    // A snapshot is built on hot paths and for every client: a session whose file
    // cannot be read back must not cost the reader their conversation. The control is
    // simply not offered, and the request that would have followed reports why.
    return undefined;
  }
}

/**
 * The messages one session entry contributes to the transcript.
 *
 * `sessionEntryToContextMessages` is the SDK's own projection and covers every entry
 * type that carries content — messages, custom messages, branch and compaction
 * summaries — so an entry kind added to the SDK later contributes here without this
 * module learning about it.
 */
function entryMessages(entry: RuntimeEntry): unknown[] {
  return sessionEntryToContextMessages(entry as never) as unknown[];
}
