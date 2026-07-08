/**
 * Wire protocol between server and web UI — single source of truth.
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
      /** True for the in-flight message included in `hello` during streaming. */
      streaming?: boolean;
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
  /** Index of this block in the SDK message content array (delta routing key). */
  contentIndex?: number;
}

export interface ModelChoice {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
}

export interface SessionSummary {
  path: string;
  id: string;
  name?: string;
  firstMessage: string;
  modified: string;
  messageCount: number;
}

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Slash command available in the composer (extension command, prompt template or skill). */
export interface CommandInfo {
  /** Invocation name without the leading slash (e.g. "commit", "skill:review"). */
  name: string;
  description?: string;
  argumentHint?: string;
  source: "extension" | "prompt" | "skill";
}

/** Branding applied by the web UI (from the server's standalone config). */
export interface Branding {
  title?: string;
  welcome?: string;
  accentColor?: string;
}

/** Snapshot of session state, sent on connect and after session replacement. */
export interface SessionSnapshot {
  branding: Branding;
  sessionId: string;
  model: string;
  thinkingLevel: string;
  isStreaming: boolean;
  items: ChatItem[];
  models: ModelChoice[];
  commands: CommandInfo[];
}

/** Server -> client */
export type ServerMessage =
  | ({ type: "hello" } & SessionSnapshot)
  | ({ type: "session_replaced" } & SessionSnapshot)
  | { type: "sessions"; sessions: SessionSummary[] }
  | { type: "model_changed"; model: string; reasoning: boolean }
  | { type: "thinking_changed"; level: string }
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
  | { type: "abort" }
  | { type: "set_model"; provider: string; id: string }
  | { type: "set_thinking"; level: ThinkingLevel }
  | { type: "new_session" }
  | { type: "switch_session"; path: string }
  | { type: "delete_session"; path: string }
  | { type: "list_sessions" };
