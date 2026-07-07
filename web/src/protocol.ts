/**
 * Wire protocol — mirror of server/src/protocol.ts (keep in sync).
 */

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

export type ClientMessage =
  | { type: "prompt"; text: string }
  | { type: "abort" };
