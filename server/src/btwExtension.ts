/**
 * `/btw <question>`: a question about the conversation, answered from the conversation, while the
 * agent works, and kept out of it (btw-side-question).
 *
 * The SDK runs an extension command before it looks at whether a turn is streaming, so the command
 * runs mid-turn and never reaches the agent. It reads the branch as the session holds it — every
 * finished message, tool call and tool result is appended as it ends — serialises it within a
 * budget, and asks the session's model with no tools. The answer goes in a widget above the
 * composer, never in the session.
 *
 * The handler starts the request and returns at once. The SDK awaits a command before it reports
 * the prompt as handled, and over RPC that report is the `prompt` command's response: a handler
 * that waited for the model would hold both for as long as the model takes.
 *
 * Loaded in the embedded runtime (index.ts) and, through piOutpostTools.ts, in an RPC child.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const BTW_WIDGET = "btw";
/** The panel's first line: what it is, and that it is not part of the conversation. */
export const BTW_TITLE = "Side answer · not part of the conversation";
/** How much of the conversation a side question carries, in characters. */
export const DEFAULT_BTW_BUDGET = 60_000;
/** A tool result, or a tool call's arguments, is cut to this many characters. */
const TOOL_TEXT_LIMIT = 2_000;
const LEFT_OUT = "[Earlier conversation left out.]";

const SYSTEM_PROMPT = [
  "You answer a side question about a conversation between a user and a coding agent, which may still be working.",
  "Answer only from the conversation shown. You have no tools: you cannot read files, run commands or look anything up.",
  "If the conversation does not show the answer, say so. Never add a reason, a fact or a detail the conversation does not state.",
  "Earlier side questions, when given, are the user's previous questions to you, and the new question may follow up on them.",
  "Answer briefly, in the language of the question.",
].join(" ");

interface Block {
  type?: string;
  text?: string;
  name?: string;
  arguments?: unknown;
}

interface BranchEntry {
  type: string;
  id?: string;
  summary?: string;
  firstKeptEntryId?: string;
  message?: { role?: string; content?: unknown; toolName?: string; isError?: boolean };
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… [cut]`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Block[])
    .flatMap((block) => (block?.type === "text" && typeof block.text === "string" ? [block.text] : block?.type === "image" ? ["[image]"] : []))
    .join("\n")
    .trim();
}

/** One section per message the agent was given or produced; undefined for one with nothing to show. */
function sectionOf(entry: BranchEntry): string | undefined {
  const message = entry.type === "message" ? entry.message : undefined;
  if (!message) return undefined;
  if (message.role === "user") {
    const text = textOf(message.content);
    return text ? `User: ${text}` : undefined;
  }
  if (message.role === "assistant") {
    const lines: string[] = [];
    const text = textOf(message.content);
    if (text) lines.push(`Assistant: ${text}`);
    if (Array.isArray(message.content)) {
      for (const block of message.content as Block[]) {
        if (block?.type !== "toolCall" || typeof block.name !== "string") continue;
        lines.push(`Assistant called ${block.name} ${cut(JSON.stringify(block.arguments ?? {}), TOOL_TEXT_LIMIT)}`);
      }
    }
    return lines.length > 0 ? lines.join("\n") : undefined;
  }
  if (message.role === "toolResult") {
    const label = `${message.isError ? "Error from" : "Result of"} ${message.toolName ?? "tool"}`;
    return `${label}: ${cut(textOf(message.content), TOOL_TEXT_LIMIT)}`;
  }
  return undefined;
}

/**
 * The branch as text, most recent last, at most `budget` characters. Cut from the front, a whole
 * section at a time, saying so; the latest compaction summary leads, as it does for the agent.
 */
export function serialiseBranch(entries: readonly BranchEntry[], budget: number = DEFAULT_BTW_BUDGET): string {
  let start = 0;
  let summary: string | undefined;
  const compaction = entries.findLastIndex((entry) => entry.type === "compaction");
  if (compaction !== -1) {
    const entry = entries[compaction]!;
    summary = `Summary of the conversation before this point: ${entry.summary ?? ""}`;
    const kept = entries.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
    start = kept !== -1 && kept < compaction ? kept : compaction + 1;
  }
  const sections = entries.slice(start).flatMap((entry) => {
    const section = sectionOf(entry);
    return section === undefined ? [] : [section];
  });

  const separator = "\n\n";
  // The summary is kept, but never at the cost of the latest messages: it gets half the budget at most.
  const head = summary === undefined ? [] : [cut(summary, Math.floor(budget / 2))];
  const whole = [...head, ...sections].join(separator);
  if (whole.length <= budget) return whole;

  head.push(LEFT_OUT);
  const room = budget - head.join(separator).length;
  const kept: string[] = [];
  let used = 0;
  for (let i = sections.length - 1; i >= 0; i--) {
    const cost = separator.length + sections[i]!.length;
    if (used + cost > room) break;
    kept.unshift(sections[i]!);
    used += cost;
  }
  // A latest section larger than the budget on its own: keep its end, which is what was said last.
  if (kept.length === 0 && sections.length > 0) {
    const last = sections[sections.length - 1]!;
    kept.push(last.slice(last.length - Math.max(0, room - separator.length)));
  }
  return [...head, ...kept].join(separator);
}

/** An answered side question, kept while the panel stays open so that a follow-up can refer to it. */
export interface SideExchange {
  question: string;
  answer: string;
}

/** The thread as text, oldest first, at most `limit` characters: the oldest exchanges go first. */
function serialiseThread(thread: readonly SideExchange[], limit: number): string {
  const parts = thread.map(({ question, answer }) => `Side question: ${question}\nSide answer: ${answer}`);
  while (parts.length > 0 && parts.join("\n\n").length > limit) parts.shift();
  return parts.join("\n\n");
}

/**
 * The request a side question makes: the conversation, then the earlier side questions of the open
 * panel, then the question in a message of its own. No tools. The thread is kept whole before the
 * conversation is cut, up to half the budget.
 */
export function sideQuestionContext(
  entries: readonly BranchEntry[],
  question: string,
  budget: number = DEFAULT_BTW_BUDGET,
  thread: readonly SideExchange[] = [],
) {
  const earlier = serialiseThread(thread, Math.floor(budget / 2));
  const conversation = serialiseBranch(entries, Math.max(0, budget - question.length - earlier.length));
  const now = Date.now();
  const text = `<conversation>\n${conversation}\n</conversation>${earlier ? `\n\n<earlier_side_questions>\n${earlier}\n</earlier_side_questions>` : ""}`;
  return {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: now },
      { role: "user" as const, content: [{ type: "text" as const, text: question }], timestamp: now },
    ],
  };
}

/** Marks the line that starts a side question in the panel; the client scrolls the latest one into view. */
export const QUESTION_MARK = "› ";

/**
 * The panel: a side note, not a message thread. Its title, then the open panel's earlier exchanges,
 * oldest first, then the latest question and its body — so scrolling up, or ↑ once the panel has
 * focus, reaches the earlier ones. The client gives it a close control, so it carries no hint about
 * `/btw` alone.
 */
export function panel(question: string, body: readonly string[], earlier: readonly SideExchange[]): string[] {
  const exchanges = earlier.flatMap((exchange) => [`${QUESTION_MARK}${exchange.question}`, ...exchange.answer.split(/\r?\n/), ""]);
  return [BTW_TITLE, ...exchanges, `${QUESTION_MARK}${question}`, ...body];
}

/** Writes the widget, unless the session it was asked in has since been replaced. */
function show(ctx: ExtensionContext, lines: string[] | undefined): void {
  try {
    ctx.ui.setWidget(BTW_WIDGET, lines, { placement: "aboveEditor" });
  } catch {
    // A context from a replaced session refuses to be used; there is nothing left to show it in.
  }
}

type Outcome = { answered: true; text: string } | { answered: false; reason: string };

async function answer(ctx: ExtensionContext, question: string, budget: number, thread: readonly SideExchange[], signal: AbortSignal): Promise<Outcome> {
  const model = ctx.model;
  if (!model) return { answered: false, reason: "no model is selected" };
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) return { answered: false, reason: `${model.provider}/${model.id} has no credentials` };
  const context = sideQuestionContext(ctx.sessionManager.getBranch() as BranchEntry[], question, budget, thread);
  // A fresh session id and no cache retention: the call shares no cache entry or provider
  // session with the turn. streamSimple, not complete: it is the path that routes a virtual model.
  const reply = await ctx.modelRegistry
    .streamSimple(model, context, { signal, cacheRetention: "none", sessionId: randomUUID() })
    .result();
  if (reply.stopReason === "error") return { answered: false, reason: reply.errorMessage ?? "the provider failed" };
  const text = textOf(reply.content);
  return text ? { answered: true, text } : { answered: false, reason: "the model returned nothing" };
}

export function createBtwExtension(options: { budget?: number } = {}) {
  const budget = options.budget ?? DEFAULT_BTW_BUDGET;
  return function btw(pi: ExtensionAPI): void {
    // The latest question only: a new one, `/btw` alone, or the session going away cancels it.
    let pending: AbortController | undefined;
    // The open panel's answered questions. Closing it, or another conversation, forgets them.
    let thread: SideExchange[] = [];
    const cancel = () => {
      pending?.abort();
      pending = undefined;
    };
    const close = (ctx: ExtensionContext) => {
      cancel();
      thread = [];
      show(ctx, undefined);
    };

    pi.registerCommand("btw", {
      description: "Ask a side question about the conversation, without interrupting the agent or entering the conversation",
      handler: async (args, ctx) => {
        const question = args.trim();
        if (!question) {
          close(ctx);
          return;
        }
        cancel();
        const controller = new AbortController();
        pending = controller;
        const earlier = [...thread];
        show(ctx, panel(question, ["Answering…"], earlier));
        void answer(ctx, question, budget, earlier, controller.signal)
          .catch((error: unknown): Outcome => ({ answered: false, reason: error instanceof Error ? error.message : String(error) }))
          .then((outcome) => {
            if (pending !== controller) return;
            pending = undefined;
            // Only an answered question joins the thread: a failure has nothing to follow up on.
            if (outcome.answered) thread = [...earlier, { question, answer: outcome.text }];
            const body = outcome.answered ? outcome.text.split(/\r?\n/) : [`No answer: ${outcome.reason}.`];
            show(ctx, panel(question, body, earlier));
          });
      },
    });

    // An answer about one conversation is never shown under another.
    pi.on("session_start", (_event, ctx) => close(ctx));
    pi.on("session_shutdown", () => {
      cancel();
      thread = [];
    });
  };
}
