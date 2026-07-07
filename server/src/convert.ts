/**
 * Conversion from SDK AgentMessage history to wire ChatItems.
 */
import type { AssistantBlock, ChatItem } from "./protocol.ts";

const MAX_TOOL_OUTPUT = 20_000;

interface AnyContent {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface AnyMessage {
  role: string;
  content: string | AnyContent[];
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
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
 * Convert session history to chat items. Tool results are merged with the
 * originating toolCall (matched by id) so the UI shows one card per tool run.
 */
export function historyToItems(messages: AnyMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  const toolArgs = new Map<string, { name: string; args: unknown }>();

  for (const message of messages) {
    switch (message.role) {
      case "user": {
        const text = contentText(message.content);
        if (text) items.push({ kind: "user", text });
        break;
      }
      case "assistant": {
        const blocks: AssistantBlock[] = [];
        const content = Array.isArray(message.content) ? message.content : [];
        for (const c of content) {
          if (c.type === "text" && c.text) {
            blocks.push({ type: "text", text: c.text });
          } else if (c.type === "thinking" && c.thinking) {
            blocks.push({ type: "thinking", text: c.thinking });
          } else if (c.type === "toolCall" && c.id && c.name) {
            toolArgs.set(c.id, { name: c.name, args: c.arguments });
          }
        }
        if (blocks.length > 0 || message.errorMessage) {
          items.push({
            kind: "assistant",
            blocks,
            ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
          });
        }
        break;
      }
      case "toolResult": {
        const call = message.toolCallId ? toolArgs.get(message.toolCallId) : undefined;
        items.push({
          kind: "tool",
          toolCallId: message.toolCallId ?? "",
          toolName: message.toolName ?? call?.name ?? "tool",
          args: call?.args ?? {},
          output: truncate(contentText(message.content)),
          isError: message.isError ?? false,
        });
        break;
      }
      default:
        // custom messages (compaction summaries, etc.) — skipped in v1
        break;
    }
  }
  return items;
}

/** Convert a final assistant message to a ChatItem (for assistant_end sync). */
export function assistantToItem(message: AnyMessage): ChatItem {
  const blocks: AssistantBlock[] = [];
  const content = Array.isArray(message.content) ? message.content : [];
  for (const c of content) {
    if (c.type === "text" && c.text) blocks.push({ type: "text", text: c.text });
    else if (c.type === "thinking" && c.thinking) blocks.push({ type: "thinking", text: c.thinking });
  }
  return {
    kind: "assistant",
    blocks,
    ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
  };
}
