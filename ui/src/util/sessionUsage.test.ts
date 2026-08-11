import { describe, it, expect } from "vitest";
import type { ChatItem, TurnUsage } from "@pi-outpost/shared";
import { formatCost, formatTokens, sessionUsage } from "./sessionUsage";

/** A turn that reported figures. Without `cost`, it is an unpriced one. */
const turn = (usage: Partial<TurnUsage> = {}): ChatItem => ({
  kind: "assistant",
  blocks: [],
  usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, ...usage },
});

/** A turn the provider reported nothing about. */
const silentTurn = (): ChatItem => ({ kind: "assistant", blocks: [] });

describe("sessionUsage", () => {
  it("sums the turns that reported figures", () => {
    const total = sessionUsage([turn({ cost: 0.01 }), turn({ cost: 0.02 })]);
    expect(total.turns).toBe(2);
    expect(total.cost).toBeCloseTo(0.03);
    expect(total.totalTokens).toBe(36);
    expect(total.input).toBe(20);
    expect(total.unpriced).toBe(0);
  });

  it("counts a turn with tokens but no price as unpriced", () => {
    const total = sessionUsage([turn()]);
    expect(total.turns).toBe(1);
    expect(total.unpriced).toBe(1);
    expect(total.cost).toBe(0);
    expect(total.totalTokens).toBe(18);
  });

  it("keeps priced and unpriced turns apart in a mixed session", () => {
    const total = sessionUsage([turn({ cost: 0.05 }), turn(), turn()]);
    expect(total.turns).toBe(3);
    expect(total.unpriced).toBe(2);
    expect(total.cost).toBeCloseTo(0.05);
  });

  it("excludes turns that reported nothing rather than counting them as zero", () => {
    // The turn count is what tells a reader the total is partial, so a turn with
    // no figures must not inflate it.
    const total = sessionUsage([turn({ cost: 0.01 }), silentTurn()]);
    expect(total.turns).toBe(1);
    expect(total.unpriced).toBe(0);
  });

  it("ignores items that are not assistant turns", () => {
    const items: ChatItem[] = [
      { kind: "user", text: "hi" },
      turn({ cost: 0.01 }),
      { kind: "tool", toolCallId: "1", toolName: "read", args: {}, output: "", isError: false },
    ];
    expect(sessionUsage(items).turns).toBe(1);
  });

  it("reports zeroes for an empty conversation", () => {
    const total = sessionUsage([]);
    expect(total).toEqual({
      cost: 0,
      unpriced: 0,
      turns: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    });
  });
});

describe("formatCost", () => {
  it("keeps a fraction of a cent legible", () => {
    // Two decimals would render this as "$0.00", which reads as free.
    expect(formatCost(0.0004)).toBe("$0.0004");
  });

  it("uses two decimals from one cent up", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(12.5)).toBe("$12.50");
  });

  it("shows an exact zero plainly", () => {
    expect(formatCost(0)).toBe("$0.00");
  });
});

describe("formatTokens", () => {
  it("leaves small counts alone", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
  });

  it("abbreviates thousands and millions", () => {
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(12_400)).toBe("12k");
    expect(formatTokens(3_400_000)).toBe("3.4M");
  });
});
