/**
 * Conversion from SDK AgentMessage history to wire ChatItems.
 */
import path from "node:path";
import { rewriteMentionedPathsSync } from "@pi-outpost/shared/mentions";
import type { AssistantBlock, ChatItem, TurnUsage, WireImage } from "@pi-outpost/shared";
import { describeProviderError } from "@pi-outpost/shared/provider-error";
import type { ExtensionRenderer } from "./extensionRender.ts";

const MAX_TOOL_OUTPUT = 20_000;

/**
 * `maybePath` back to root-relative, posix-separated form — undefined for
 * anything that isn't actually an absolute path under `root`, which
 * `rewriteMentionedPathsSync` treats as "leave this mention alone": most
 * mentions were never absolutized (they didn't resolve to a real path in the
 * first place — see absolutizeMentions in index.ts) and must round-trip
 * unchanged, not get mangled by a relative computed against the wrong thing.
 */
function relativizeUnderRoot(root: string, maybePath: string): string | undefined {
  if (!path.isAbsolute(maybePath)) return undefined;
  const rel = path.relative(root, maybePath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join("/");
}

/**
 * The text a user message is shown as — and therefore the only string anything
 * may pair a bubble on. `user_entries` matches the client's bubbles by text, so
 * the entry it sends has to be spelled the way the bubble is: images contribute
 * nothing (they render as thumbnails), and an absolutized `@` mention goes back
 * to the relative path the user typed. Computed in two places, the two spellings
 * drifted the moment mentions were absolutized, and every bubble above the first
 * `@` mention silently lost its ✎.
 */
export function userMessageText(content: string | AnyContent[] | undefined, browserRoot?: string): string {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .filter(Boolean)
            .join("\n")
        : "";
  return browserRoot ? rewriteMentionedPathsSync(text, (p) => relativizeUnderRoot(browserRoot, p)) : text;
}

interface AnyContent {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  data?: string;
  mimeType?: string;
}

interface AnyMessage {
  role: string;
  content: string | AnyContent[];
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  customType?: string;
  details?: unknown;
  /** Whether the message is shown in the transcript vs. sent to the LLM only. */
  display?: boolean;
  /** Billing counters, on finished assistant messages. Shape: pi-ai's `Usage`. */
  usage?: unknown;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Billing counters off a finished assistant message.
 *
 * Deliberately strict: a turn is reported only when the four token counters are
 * all present and numeric. Half a turn would quietly skew any total built on it,
 * and a missing turn is honest in a way that a zeroed one is not — the same
 * reason `cost` stays absent rather than defaulting to 0 for providers that
 * price nothing.
 */
export function messageUsage(message: AnyMessage): TurnUsage | undefined {
  const usage = message.usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const { input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost } = usage as Record<string, unknown>;
  if (!isNumber(input) || !isNumber(output) || !isNumber(cacheRead) || !isNumber(cacheWrite)) return undefined;

  const total = isNumber(totalTokens) ? totalTokens : input + output + cacheRead + cacheWrite;
  const price = messageCost(cost);

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(isNumber(reasoning) ? { reasoning } : {}),
    totalTokens: total,
    ...(price === undefined ? {} : { cost: price }),
  };
}

/**
 * The price of a turn, or nothing when the model priced it at nothing.
 *
 * The SDK always emits a `cost` object and always fills `total` — it computes
 * the figure from the model's rates rather than reading it off the provider — so
 * a model with no rates (the self-hosted case) yields `total: 0`. Carrying that
 * through as a price would put "$0.00" in front of the user as a measured bill
 * on exactly the deployment that has no bill, and would count the turn as priced.
 *
 * A turn is therefore priced only when some component of the breakdown is above
 * zero. The cost is a turn genuinely charged at exactly 0 (a free tier, an amount
 * below float resolution) being reported as unpriced instead of as $0.00 — which
 * says the same thing about the money and does not claim to have measured it.
 */
function messageCost(cost: unknown): number | undefined {
  if (typeof cost !== "object" || cost === null) return undefined;
  const { input, output, cacheRead, cacheWrite, total } = cost as Record<string, unknown>;
  if (!isNumber(total)) return undefined;
  const components = [input, output, cacheRead, cacheWrite, total];
  return components.some((value) => isNumber(value) && value > 0) ? total : undefined;
}

export function contentText(content: string | AnyContent[] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .map((c) => {
      if (c.type === "text") return c.text ?? "";
      if (c.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated, ${text.length} chars total]`;
}

/**
 * A completion fraction a running tool volunteered, sanitised for the wire.
 *
 * Only a finite number survives — a non-number, `NaN` or an infinity yields
 * `undefined`, which the client reads as "no change". A value outside `0..1` is
 * clamped rather than dropped. The trajectory is not policed: a fraction lower
 * than one seen before is a legitimate report and passes through unchanged.
 */
export function toProgressFraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function assistantBlocks(content: string | AnyContent[]): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  if (!Array.isArray(content)) return blocks;
  content.forEach((c, contentIndex) => {
    if (c.type === "text" && c.text) {
      blocks.push({ type: "text", text: c.text, contentIndex });
    } else if (c.type === "thinking" && c.thinking) {
      blocks.push({ type: "thinking", text: c.thinking, contentIndex });
    }
  });
  return blocks;
}

/**
 * Convert session history to chat items. Tool results are merged with the
 * originating toolCall (matched by id) so the UI shows one card per tool run.
 *
 * When `streaming` is true (mid-stream connect):
 * - the trailing partial assistant message (pushed into session.messages at
 *   message_start) is marked `streaming` so deltas route to it;
 * - toolCalls without a result yet become running tool cards.
 *
 * `userEntryIds` are the session entry ids of the user messages on the current
 * branch, oldest first. They are matched to the emitted user items from the END:
 * compaction drops a prefix of the history, so the items are a suffix of the
 * branch. Items left unmatched simply carry no entryId (edit stays disabled).
 *
 * `browserRoot`, when given, turns an `@`-mentioned path back from the absolute
 * form the model was handed (see absolutizeMentions in index.ts) into the
 * relative one the composer actually sent — what replaying history from a
 * reconnect or a page reload shows must match what a live turn showed, or the
 * "transparent" half of that trade stops being true the moment someone reloads.
 */
export function historyToItems(
  messages: AnyMessage[],
  streaming = false,
  userEntryIds: string[] = [],
  browserRoot?: string,
  /**
   * The workspace whose extensions render these cards. Passed in rather than
   * reached for: history belongs to one project, and the renderers that dress it
   * must be that project's own.
   */
  renderer?: ExtensionRenderer,
): ChatItem[] {
  const items: ChatItem[] = [];
  const userItems: Extract<ChatItem, { kind: "user" }>[] = [];
  const pendingCalls = new Map<string, { name: string; args: unknown }>();
  // Item emitted for the trailing message, when that message is assistant
  let trailingAssistantItem: Extract<ChatItem, { kind: "assistant" }> | undefined;

  for (const message of messages) {
    trailingAssistantItem = undefined;
    switch (message.role) {
      case "user": {
        // Text only — images render as thumbnails, no "[image]" marker needed
        const text = userMessageText(message.content, browserRoot);
        const images: WireImage[] = Array.isArray(message.content)
          ? message.content
              .filter((c) => c.type === "image" && c.data && c.mimeType)
              .map((c) => ({ data: c.data as string, mimeType: c.mimeType as string }))
          : [];
        if (text || images.length > 0) {
          const item: Extract<ChatItem, { kind: "user" }> = {
            kind: "user",
            text,
            ...(images.length > 0 ? { images } : {}),
          };
          items.push(item);
          userItems.push(item);
        }
        break;
      }
      case "assistant": {
        const content = Array.isArray(message.content) ? message.content : [];
        for (const c of content) {
          if (c.type === "toolCall" && c.id && c.name) {
            pendingCalls.set(c.id, { name: c.name, args: c.arguments });
          }
        }
        const blocks = assistantBlocks(message.content);
        // Replayed history carries what each turn cost, so reopening a session
        // shows the same totals it showed while it ran. A turn that only called
        // tools has no block to show and is still emitted for its usage — the
        // live path keeps such a turn, and dropping it here would make a
        // reopened session report less than it did while running.
        const usage = messageUsage(message);
        if (blocks.length > 0 || message.errorMessage || usage) {
          trailingAssistantItem = {
            kind: "assistant",
            blocks,
            ...(message.errorMessage ? { errorMessage: describeProviderError(message.errorMessage) } : {}),
            ...(usage ? { usage } : {}),
          };
          items.push(trailingAssistantItem);
        }
        break;
      }
      case "toolResult": {
        // Same detection as the live tool_end path — they must agree, or a result
        // renders while it streams and turns into raw output on reload.
        const call = message.toolCallId ? pendingCalls.get(message.toolCallId) : undefined;
        if (message.toolCallId) pendingCalls.delete(message.toolCallId);

        const toolCallId = message.toolCallId ?? "";
        const toolName = message.toolName ?? call?.name ?? "tool";
        const callHtml = renderer?.renderToolCallHtml(toolCallId, toolName, call?.args ?? {});
        const rendered = renderer?.renderToolResultHtml(
          toolCallId,
          toolName,
          message.content,
          message.details,
          message.isError ?? false,
        );

        items.push({
          kind: "tool",
          toolCallId,
          toolName,
          args: call?.args ?? {},
          output: truncate(contentText(message.content)),
          isError: message.isError ?? false,
          ...(callHtml ? { callHtml } : {}),
          ...(rendered
            ? { outputHtml: rendered.expanded, outputHtmlCollapsed: rendered.collapsed }
            : {}),
          ...structuredExchangeField(message.details),
        });
        break;
      }
      case "custom": {
        // display:false means "context for the LLM only" — the TUI hides those too
        const text = message.display ? contentText(message.content) : "";
        // The same renderer replayed history is being converted with: without it
        // a persisted custom message loses its extension HTML on reload, and the
        // card changes appearance for no reason the reader can see.
        if (text) items.push(customMessageToItem(message, renderer));
        break;
      }
      default:
        // compaction/branch summaries, bash executions — skipped in v1
        break;
    }
  }

  // Right-align: the last user item is the last user entry of the branch
  for (let i = 1; i <= Math.min(userItems.length, userEntryIds.length); i++) {
    userItems[userItems.length - i].entryId = userEntryIds[userEntryIds.length - i];
  }

  if (streaming && messages[messages.length - 1]?.role === "assistant") {
    // The SDK pushes the partial assistant message at message_start, possibly
    // with zero blocks (TTFT window). Mark it — or materialize it when empty —
    // so client deltas route here, never to an earlier complete message.
    if (trailingAssistantItem) {
      trailingAssistantItem.streaming = true;
    } else {
      items.push({ kind: "assistant", blocks: [], streaming: true });
    }
  }
  if (streaming) {
    // toolCalls still executing (no result yet) → running cards
    for (const [toolCallId, call] of pendingCalls) {
      const callHtml = renderer?.renderToolCallHtml(toolCallId, call.name, call.args);
      items.push({
        kind: "tool",
        toolCallId,
        toolName: call.name,
        args: call.args,
        output: "",
        running: true,
        ...(callHtml ? { callHtml } : {}),
      });
    }
  }

  return items;
}


/**
 * A tool result's structured-exchange document, carried on to the client.
 *
 * Deliberately not validated here. The client validates on receipt — that is where
 * the rendering decision is made, and a verdict reached anywhere else would have to
 * be trusted rather than checked. This only declines to forward things that plainly
 * are not envelopes, so the wire does not carry every extension's private metadata.
 *
 * Serialized rather than passed through as an object: an approved proposal is handed
 * on from here exactly as validated, and a value parsed and re-serialised again is no
 * longer the value the reader approved.
 *
 * **The supported channel is `details` on a tool result, and only that.** It is
 * filled by a tool's implementation rather than by the model, so a document arriving
 * here was produced by code and never written by the thing being reviewed.
 *
 * This agent SDK has no MCP client — its README says so outright and recommends an
 * extension for anyone who wants one. So there is no MCP transport here to align a
 * second channel with, and accepting MCP's `structuredContent` today would be
 * guessing at a shape nothing in this process produces. A bridge, if someone writes
 * one as an extension, meets this contract by putting the envelope in `details`;
 * that is a requirement on the bridge, not a second path through here.
 */
export function structuredExchangeField(details: unknown): { structured?: string } {
  if (details === null || typeof details !== "object") return {};
  const schema = (details as { schema?: unknown }).schema;
  if (typeof schema !== "string" || !schema.startsWith("urn:structured-exchange:")) return {};
  try {
    return { structured: JSON.stringify(details) };
  } catch {
    // Circular or otherwise unserialisable: not something a producer could have
    // sent as JSON in the first place, so there is nothing here to forward.
    return {};
  }
}

/** Convert a final assistant message to a ChatItem (for assistant_end sync). */
export function assistantToItem(message: AnyMessage): ChatItem {
  const usage = messageUsage(message);
  return {
    kind: "assistant",
    blocks: assistantBlocks(message.content),
    ...(message.errorMessage ? { errorMessage: describeProviderError(message.errorMessage) } : {}),
    ...(usage ? { usage } : {}),
  };
}

/**
 * Convert an extension-defined custom message (pi.sendMessage() with a
 * customType) to a ChatItem. We don't run the extension's MessageRenderer
 * (a terminal Component, not renderable in the browser) — just the plain
 * text content, with `details` along for an optional expanded view.
 */
export function customMessageToItem(message: AnyMessage, renderer?: ExtensionRenderer): ChatItem {
  const customType = message.customType ?? "custom";
  const display = message.display !== false;
  const content = message.content;
  const rendered = renderer?.renderCustomMessageHtml(customType, content, message.details, display);

  return {
    kind: "custom",
    customType,
    text: contentText(content),
    ...(message.details !== undefined ? { details: message.details } : {}),
    ...(rendered
      ? { contentHtml: rendered.expanded, contentHtmlCollapsed: rendered.collapsed }
      : {}),
  };
}
