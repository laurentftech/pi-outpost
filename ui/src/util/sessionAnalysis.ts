import type { ChatItem, TurnUsage } from "@pi-outpost/shared";
import { sessionUsage, type SessionUsage } from "./sessionUsage";

/**
 * Reads the conversation as a session rather than as a transcript: which turns
 * were expensive, which tool calls were large or failed, which request drove
 * the spend.
 *
 * Everything here is derived from the item list the UI already holds — no model
 * call, no server round-trip. Targets are item indices, the only identity a
 * `ChatItem` has that covers user, assistant and tool alike; the panel hands one
 * back to the conversation to scroll to.
 */

/** An assistant message that reported figures. Streaming ones are not turns. */
export interface AnalyzedTurn {
  /** Index in the item list — the navigation target. */
  index: number;
  /** 1-based position among the session's turns. */
  number: number;
  /** Owning request, or -1 for turns preceding any user message. */
  requestIndex: number;
  usage: TurnUsage;
}

export interface AnalyzedToolCall {
  index: number;
  toolCallId: string;
  name: string;
  /** Characters of serialized arguments — a size, never a cost. */
  inputSize: number;
  /** Characters of raw output. */
  outputSize: number;
  isError: boolean;
  running: boolean;
  requestIndex: number;
}

/** A user message together with everything it caused, up to the next one. */
export interface AnalyzedRequest {
  /** Item index of the user message, or -1 for the leading request. */
  index: number;
  /** Excerpt of the user message; empty for the leading request. */
  title: string;
  turns: number;
  toolCalls: number;
  failedToolCalls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  /** Absent when no turn in the request carried a price. */
  cost?: number;
  unpriced: number;
}

export interface ToolSummary {
  name: string;
  calls: number;
  failures: number;
  inputSize: number;
  outputSize: number;
}

export interface SessionAnalysis {
  turns: AnalyzedTurn[];
  requests: AnalyzedRequest[];
  toolCalls: AnalyzedToolCall[];
  tools: ToolSummary[];
  /** Session-wide counters, from the same aggregate the model bar shows. */
  totals: SessionUsage;
  /** Turns that carried a price — what the cost statistics cover. */
  pricedTurns: number;
  /** Over priced turns only; 0 when none. */
  averageTurnCost: number;
  medianTurnCost: number;
  totalToolCalls: number;
  failedToolCalls: number;
  /** Tool calls per turn; 0 when no turn reported figures. */
  toolCallsPerTurn: number;
}

/** How a tool call ranking is ordered. */
export type ToolRanking = "output" | "input" | "failure";

const TITLE_LENGTH = 80;

/**
 * Measured per argument object and cached: the analysis re-runs on every render
 * of a streaming conversation, and re-serialising every tool call's arguments on
 * each token delta is the one part of the walk that is not cheap. Tool items are
 * immutable once received, so the cache can never go stale.
 */
const inputSizes = new WeakMap<object, number>();

/**
 * Arguments come from a tool the server serialized, but a cyclic or otherwise
 * non-serialisable value must not take the panel down. An unmeasurable call
 * sorts last, which is the honest place for it.
 */
export function toolInputSize(args: unknown): number {
  const cacheable = typeof args === "object" && args !== null;
  if (cacheable) {
    const cached = inputSizes.get(args as object);
    if (cached !== undefined) return cached;
  }
  let size = 0;
  try {
    size = JSON.stringify(args)?.length ?? 0;
  } catch {
    size = 0;
  }
  if (cacheable) inputSizes.set(args as object, size);
  return size;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_LENGTH ? `${flat.slice(0, TITLE_LENGTH - 1)}…` : flat;
}

function emptyRequest(index: number, title: string): AnalyzedRequest {
  return {
    index,
    title,
    turns: 0,
    toolCalls: 0,
    failedToolCalls: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    unpriced: 0,
  };
}

function addTurn(request: AnalyzedRequest, usage: TurnUsage): void {
  request.turns += 1;
  request.input += usage.input;
  request.output += usage.output;
  request.cacheRead += usage.cacheRead;
  request.cacheWrite += usage.cacheWrite;
  request.totalTokens += usage.totalTokens;
  if (usage.cost === undefined) request.unpriced += 1;
  else request.cost = (request.cost ?? 0) + usage.cost;
}

/** Mean of the two middles on an even count, so a two-turn session has a median. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** One linear pass over the conversation; the rankings sort copies afterwards. */
export function analyzeSession(items: ChatItem[]): SessionAnalysis {
  const turns: AnalyzedTurn[] = [];
  const toolCalls: AnalyzedToolCall[] = [];
  const requests: AnalyzedRequest[] = [];
  const tools = new Map<string, ToolSummary>();

  // A replayed session can open with tool activity (a resumed run, a compaction
  // artefact). Those calls are real and on screen, so they are attributed to a
  // leading request rather than dropped — it is kept only if anything lands in it.
  const leading = emptyRequest(-1, "");
  let current = leading;

  items.forEach((item, index) => {
    if (item.kind === "user") {
      current = emptyRequest(index, excerpt(item.text));
      requests.push(current);
      return;
    }
    if (item.kind === "assistant") {
      if (!item.usage) return; // streaming, or a provider that reported nothing
      turns.push({ index, number: turns.length + 1, requestIndex: current.index, usage: item.usage });
      addTurn(current, item.usage);
      return;
    }
    if (item.kind !== "tool") return;

    const call: AnalyzedToolCall = {
      index,
      toolCallId: item.toolCallId,
      name: item.toolName,
      inputSize: toolInputSize(item.args),
      outputSize: item.output.length,
      isError: item.isError === true,
      running: item.running === true,
      requestIndex: current.index,
    };
    toolCalls.push(call);
    current.toolCalls += 1;
    if (call.isError) current.failedToolCalls += 1;

    const summary = tools.get(call.name) ?? { name: call.name, calls: 0, failures: 0, inputSize: 0, outputSize: 0 };
    summary.calls += 1;
    if (call.isError) summary.failures += 1;
    summary.inputSize += call.inputSize;
    summary.outputSize += call.outputSize;
    tools.set(call.name, summary);
  });

  if (leading.turns > 0 || leading.toolCalls > 0) requests.unshift(leading);

  const totals = sessionUsage(items);
  const pricedCosts = turns.map((t) => t.usage.cost).filter((cost): cost is number => cost !== undefined);
  const failedToolCalls = toolCalls.filter((call) => call.isError).length;

  return {
    turns,
    requests,
    toolCalls,
    tools: [...tools.values()],
    totals,
    pricedTurns: pricedCosts.length,
    averageTurnCost: pricedCosts.length === 0 ? 0 : totals.cost / pricedCosts.length,
    medianTurnCost: median(pricedCosts),
    totalToolCalls: toolCalls.length,
    failedToolCalls,
    toolCallsPerTurn: turns.length === 0 ? 0 : toolCalls.length / turns.length,
  };
}

/**
 * Tool calls ordered by the chosen criterion. Failure ranking puts the errors
 * first and orders the rest by output, so the list stays useful past the failures.
 */
export function rankToolCalls(calls: AnalyzedToolCall[], ranking: ToolRanking): AnalyzedToolCall[] {
  const sorted = [...calls];
  if (ranking === "input") return sorted.sort((a, b) => b.inputSize - a.inputSize);
  if (ranking === "failure") {
    return sorted.sort((a, b) => Number(b.isError) - Number(a.isError) || b.outputSize - a.outputSize);
  }
  return sorted.sort((a, b) => b.outputSize - a.outputSize);
}

/**
 * Requests ordered by what they consumed, heaviest first. The leading request is
 * excluded: it has no user message to name it, so it has no row to show.
 */
export function rankRequests(requests: AnalyzedRequest[]): AnalyzedRequest[] {
  return requests
    .filter((request) => request.index >= 0)
    .sort((a, b) => b.totalTokens - a.totalTokens || (b.cost ?? 0) - (a.cost ?? 0));
}

/** Compact byte-ish sizes for tool input and output: 940 B, 12 kB, 3.4 MB. */
export function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} B`;
  if (chars < 1_000_000) return `${Math.round(chars / 1000)} kB`;
  return `${(chars / 1_000_000).toFixed(1)} MB`;
}
