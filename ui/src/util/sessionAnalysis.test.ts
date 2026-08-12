import { describe, it, expect } from "vitest";
import type { ChatItem, TurnUsage } from "@pi-outpost/shared";
import { analyzeSession, formatSize, rankRequests, rankToolCalls, toolInputSize } from "./sessionAnalysis";

const user = (text: string): ChatItem => ({ kind: "user", text });

const turn = (usage: Partial<TurnUsage> = {}): ChatItem => ({
  kind: "assistant",
  blocks: [],
  usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, ...usage },
});

/** An assistant message the provider reported nothing about (still streaming). */
const streaming = (): ChatItem => ({ kind: "assistant", blocks: [], streaming: true });

const tool = (overrides: Partial<Extract<ChatItem, { kind: "tool" }>> = {}): ChatItem => ({
  kind: "tool",
  toolCallId: "call-1",
  toolName: "read",
  args: { path: "a.ts" },
  output: "x".repeat(100),
  ...overrides,
});

describe("analyzeSession — turns and requests", () => {
  it("numbers turns in conversation order and keeps their item index", () => {
    const analysis = analyzeSession([user("go"), turn(), tool(), turn()]);
    expect(analysis.turns.map((t) => [t.number, t.index])).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });

  it("groups each user message with the turns and tool calls that followed it", () => {
    const analysis = analyzeSession([
      user("first"),
      turn(),
      tool(),
      tool({ toolCallId: "call-2" }),
      turn(),
      user("second"),
      turn(),
    ]);
    expect(analysis.requests).toHaveLength(2);
    expect(analysis.requests[0]).toMatchObject({ index: 0, title: "first", turns: 2, toolCalls: 2 });
    expect(analysis.requests[1]).toMatchObject({ index: 5, title: "second", turns: 1, toolCalls: 0 });
  });

  it("does not count an assistant message that reported nothing", () => {
    const analysis = analyzeSession([user("go"), turn(), streaming()]);
    expect(analysis.turns).toHaveLength(1);
    expect(analysis.requests[0].turns).toBe(1);
    expect(analysis.totals.totalTokens).toBe(18);
  });

  it("attributes tool calls preceding any user message to a leading request", () => {
    const analysis = analyzeSession([tool(), user("go"), turn()]);
    expect(analysis.totalToolCalls).toBe(1);
    expect(analysis.requests[0]).toMatchObject({ index: -1, title: "", toolCalls: 1 });
    expect(analysis.requests[1]).toMatchObject({ index: 1, title: "go" });
  });

  it("omits the leading request when nothing precedes the first user message", () => {
    const analysis = analyzeSession([user("go"), turn()]);
    expect(analysis.requests.map((r) => r.index)).toEqual([0]);
  });

  it("shortens a long user message into a title", () => {
    const analysis = analyzeSession([user(`${"a".repeat(200)}`)]);
    expect(analysis.requests[0].title).toHaveLength(80);
    expect(analysis.requests[0].title.endsWith("…")).toBe(true);
  });
});

describe("analyzeSession — cost statistics", () => {
  it("averages and medians over priced turns only", () => {
    const analysis = analyzeSession([
      user("go"),
      turn({ cost: 0.1 }),
      turn(),
      turn({ cost: 0.3 }),
      turn({ cost: 0.2 }),
    ]);
    expect(analysis.turns).toHaveLength(4);
    expect(analysis.pricedTurns).toBe(3);
    expect(analysis.totals.unpriced).toBe(1);
    expect(analysis.totals.cost).toBeCloseTo(0.6);
    expect(analysis.averageTurnCost).toBeCloseTo(0.2);
    expect(analysis.medianTurnCost).toBeCloseTo(0.2);
  });

  it("takes the mean of the two middles for an even number of priced turns", () => {
    const analysis = analyzeSession([turn({ cost: 0.1 }), turn({ cost: 0.4 })]);
    expect(analysis.medianTurnCost).toBeCloseTo(0.25);
  });

  it("claims no cost statistics when nothing was priced", () => {
    const analysis = analyzeSession([user("go"), turn(), turn()]);
    expect(analysis.pricedTurns).toBe(0);
    expect(analysis.averageTurnCost).toBe(0);
    expect(analysis.medianTurnCost).toBe(0);
    expect(analysis.requests[0].cost).toBeUndefined();
    expect(analysis.requests[0].unpriced).toBe(2);
  });
});

describe("analyzeSession — tool calls", () => {
  it("measures input and output size and counts failures", () => {
    const analysis = analyzeSession([
      user("go"),
      turn(),
      tool({ output: "abc" }),
      tool({ toolCallId: "call-2", isError: true, output: "boom" }),
    ]);
    expect(analysis.toolCalls[0]).toMatchObject({ name: "read", outputSize: 3, isError: false });
    expect(analysis.toolCalls[0].inputSize).toBe(JSON.stringify({ path: "a.ts" }).length);
    expect(analysis.failedToolCalls).toBe(1);
    expect(analysis.requests[0].failedToolCalls).toBe(1);
    expect(analysis.toolCallsPerTurn).toBe(2);
  });

  it("counts a running tool call without calling it a failure", () => {
    const analysis = analyzeSession([tool({ running: true, output: "" })]);
    expect(analysis.totalToolCalls).toBe(1);
    expect(analysis.failedToolCalls).toBe(0);
    expect(analysis.toolCalls[0].running).toBe(true);
  });

  it("accumulates calls, failures and sizes per tool name", () => {
    const analysis = analyzeSession([
      tool({ output: "aa" }),
      tool({ toolCallId: "c2", output: "bbb", isError: true }),
      tool({ toolCallId: "c3", toolName: "bash", args: { cmd: "ls" }, output: "z" }),
    ]);
    const read = analysis.tools.find((t) => t.name === "read");
    expect(read).toMatchObject({ calls: 2, failures: 1, outputSize: 5 });
    expect(analysis.tools.find((t) => t.name === "bash")).toMatchObject({ calls: 1, failures: 0 });
  });

  it("measures a non-serialisable argument as zero instead of throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(toolInputSize(cyclic)).toBe(0);
    expect(analyzeSession([tool({ args: cyclic })]).toolCalls[0].inputSize).toBe(0);
  });
});

describe("analyzeSession — nothing to analyse", () => {
  it("claims no figures for an empty conversation", () => {
    const analysis = analyzeSession([]);
    expect(analysis.turns).toEqual([]);
    expect(analysis.requests).toEqual([]);
    expect(analysis.toolCalls).toEqual([]);
    expect(analysis.tools).toEqual([]);
    expect(analysis.totals.totalTokens).toBe(0);
    expect(analysis.toolCallsPerTurn).toBe(0);
  });
});

describe("rankings", () => {
  const calls = analyzeSession([
    tool({ toolCallId: "small", output: "a", args: { path: "very/long/path/for/input.ts" } }),
    tool({ toolCallId: "big", output: "x".repeat(500), args: {} }),
    tool({ toolCallId: "failed", output: "err", isError: true, args: {} }),
  ]).toolCalls;

  it("ranks by output size", () => {
    expect(rankToolCalls(calls, "output").map((c) => c.toolCallId)).toEqual(["big", "failed", "small"]);
  });

  it("ranks by input size", () => {
    expect(rankToolCalls(calls, "input")[0].toolCallId).toBe("small");
  });

  it("puts failures first when ranking by failure", () => {
    expect(rankToolCalls(calls, "failure")[0].toolCallId).toBe("failed");
  });

  it("ranks requests by consumption and drops the untitled leading one", () => {
    const analysis = analyzeSession([
      tool(),
      user("light"),
      turn({ totalTokens: 10 }),
      user("heavy"),
      turn({ totalTokens: 900 }),
    ]);
    expect(rankRequests(analysis.requests).map((r) => r.title)).toEqual(["heavy", "light"]);
  });
});

describe("formatSize", () => {
  it("scales from bytes to megabytes", () => {
    expect(formatSize(940)).toBe("940 B");
    expect(formatSize(12_400)).toBe("12 kB");
    expect(formatSize(3_400_000)).toBe("3.4 MB");
  });
});
