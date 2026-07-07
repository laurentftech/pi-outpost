/**
 * Wire protocol between server and web UI.
 * Lean events: SDK events are transformed server-side to keep frames small
 * (raw message_update events carry the full partial message on every delta).
 */

/** Chat item as displayed by the UI (also used to serialize history). */
export type ChatItem =
  | { kind: "user"; text: string }
  | {
      kind: "assistant";
      blocks: AssistantBlock[];
      errorMessage?: string;
    }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      args: unknown;
      output: string;
      isError?: boolean;
      running?: boolean;
    };

export interface AssistantBlock {
  type: "text" | "thinking";
  text: string;
}

/** Server -> client */
export type ServerMessage =
  | {
      type: "hello";
      sessionId: string;
      model: string;
      thinkingLevel: string;
      isStreaming: boolean;
      items: ChatItem[];
    }
  | { type: "user"; text: string }
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "assistant_start" }
  | {
      type: "block_delta";
      block: "text" | "thinking";
      contentIndex: number;
      delta: string;
    }
  | { type: "assistant_end"; item: ChatItem }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; text: string }
  | { type: "tool_end"; toolCallId: string; isError: boolean; text: string }
  | { type: "queue"; steering: string[]; followUp: string[] }
  | { type: "error"; message: string };

/** Client -> server */
export type ClientMessage =
  | { type: "prompt"; text: string }
  | { type: "abort" };
