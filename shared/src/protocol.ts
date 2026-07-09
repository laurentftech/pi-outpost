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
    }
  | {
      /** Extension-defined message (pi.sendMessage() with a customType) — see extensions.md#message-and-entry-rendering. */
      kind: "custom";
      customType: string;
      text: string;
      /** Extension-specific structured data, shown only when expanded (avoid a wall of JSON by default). */
      details?: unknown;
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

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Branding applied by the web UI (from the server's standalone config). */
export interface Branding {
  title?: string;
  welcome?: string;
  accentColor?: string;
  /** Theme applied when the client has no stored preference. Default: "system". */
  defaultTheme?: Theme;
  /** Whether the UI shows a theme toggle button. Default: true. */
  allowThemeToggle?: boolean;
}

/** Context window usage, for the compaction button. */
export interface ContextUsage {
  /** Estimated context tokens, or null if unknown (e.g. right after compaction). */
  tokens: number | null;
  contextWindow: number;
  /** Usage as a percentage of the context window, or null if tokens is unknown. */
  percent: number | null;
}

/**
 * Extension "Custom UI" bridge (see pi's extensions.md#custom-ui). Mirrors the
 * shape of pi's own RPC-mode protocol (`RpcExtensionUIRequest`/Response) so the
 * server can reuse the same request/response semantics over the WebSocket.
 */
export type ExtensionUIRequest =
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
  | { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
  | { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines?: string[];
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
  | { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

/** Client's answer to a dialog-style ExtensionUIRequest (select/confirm/input/editor). */
export type ExtensionUIResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

/** One entry in a directory listing for the file-browser sidebar. */
export interface DirEntry {
  name: string;
  type: "file" | "directory" | "symlink-file" | "symlink-directory" | "other";
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
  contextUsage?: ContextUsage;
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
  | { type: "custom_message"; item: ChatItem }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; text: string }
  | { type: "tool_end"; toolCallId: string; isError: boolean; text: string }
  | { type: "queue"; steering: string[]; followUp: string[] }
  | { type: "context_usage"; usage: ContextUsage }
  | { type: "compaction_start" }
  | { type: "compaction_end"; errorMessage?: string }
  | { type: "error"; message: string }
  | { type: "directory_listing"; requestId: string; path: string; entries: DirEntry[] }
  | { type: "file_content"; requestId: string; path: string; content: string; size: number }
  | { type: "file_browser_error"; requestId: string; path: string; message: string }
  | { type: "file_changed"; path: string }
  | ExtensionUIRequest;

/** Client -> server */
export type ClientMessage =
  | { type: "prompt"; text: string }
  | { type: "abort" }
  | { type: "set_model"; provider: string; id: string }
  | { type: "set_thinking"; level: ThinkingLevel }
  | { type: "new_session" }
  | { type: "switch_session"; path: string }
  | { type: "delete_session"; path: string }
  | { type: "list_sessions" }
  | { type: "compact" }
  | { type: "list_directory"; path: string; requestId: string }
  | { type: "read_file"; path: string; requestId: string }
  | ExtensionUIResponse;
