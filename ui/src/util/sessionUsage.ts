import type { ChatItem, TurnUsage } from "@pi-outpost/shared";

/**
 * What a session has consumed so far, summed from the turns that reported it.
 *
 * `unpriced` is the point of this shape. Providers differ on what they report,
 * and a turn with tokens but no price is common (a local endpoint, a gateway
 * that strips pricing). Folding those into `cost` as zero would understate the
 * bill and read as authoritative; counting them separately lets the UI say
 * "$0.42 over 7 turns, 2 unpriced" instead of quietly lying by 2 turns.
 */
export interface SessionUsage {
  /** USD across the turns that carried a price. */
  cost: number;
  /** Turns that reported tokens but no price. */
  unpriced: number;
  /** Turns that reported anything at all. */
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

const EMPTY: SessionUsage = {
  cost: 0,
  unpriced: 0,
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
};

export function sessionUsage(items: ChatItem[]): SessionUsage {
  const total = { ...EMPTY };
  for (const item of items) {
    if (item.kind !== "assistant" || !item.usage) continue;
    const usage: TurnUsage = item.usage;
    total.turns += 1;
    total.input += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
    total.totalTokens += usage.totalTokens;
    if (usage.cost === undefined) total.unpriced += 1;
    else total.cost += usage.cost;
  }
  return total;
}

/**
 * Cost as money, with enough precision to stay meaningful when it is small: a
 * cheap turn rounded to two decimals reads as "$0.00", which looks like free
 * rather than like a fraction of a cent.
 */
export function formatCost(value: number): string {
  const digits = value > 0 && value < 0.01 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

/** Compact token counts: 950, 12k, 3.4M. */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
