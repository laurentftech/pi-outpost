import { useEffect, useReducer, useRef } from "react";
import type {
  Branding,
  ChatItem,
  ClientMessage,
  CommandInfo,
  ModelChoice,
  ServerMessage,
  SessionSummary,
  ThinkingLevel,
} from "@pi-interface/shared";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;
type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export interface AgentState {
  connected: boolean;
  branding: Branding;
  sessionId: string;
  model: string;
  thinkingLevel: string;
  modelSupportsReasoning: boolean;
  models: ModelChoice[];
  commands: CommandInfo[];
  sessions: SessionSummary[] | null;
  isStreaming: boolean;
  items: ChatItem[];
  queue: { steering: string[]; followUp: string[] };
  errors: string[];
}

const initialState: AgentState = {
  connected: false,
  branding: {},
  sessionId: "",
  model: "",
  thinkingLevel: "off",
  modelSupportsReasoning: false,
  models: [],
  commands: [],
  sessions: null,
  isStreaming: false,
  items: [],
  queue: { steering: [], followUp: [] },
  errors: [],
};

type Action = { type: "connected" } | { type: "disconnected" } | { type: "server"; message: ServerMessage };

/** Update the in-flight assistant item; append a new one when none exists (upsert). */
function upsertLastAssistant(items: ChatItem[], update: (item: AssistantItem) => ChatItem): ChatItem[] {
  // Scan the whole array for the streaming item: steering echoes and tool
  // cards can land after it without splitting the stream into two bubbles
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "assistant" && item.streaming) {
      const next = [...items];
      next[i] = update(item);
      return next;
    }
  }
  return [...items, update({ kind: "assistant", blocks: [], streaming: true })];
}

/** Update a tool card by id; append a running card when none exists (upsert). */
function upsertTool(items: ChatItem[], toolCallId: string, toolName: string, patch: Partial<ToolItem>): ChatItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "tool" && item.toolCallId === toolCallId) {
      const next = [...items];
      next[i] = { ...item, ...patch };
      return next;
    }
  }
  return [...items, { kind: "tool", toolCallId, toolName, args: {}, output: "", running: true, ...patch }];
}

function applySnapshot(state: AgentState, message: ServerMessage & { sessionId: string }): AgentState {
  if (message.type !== "hello" && message.type !== "session_replaced") return state;
  const current = message.models.find((m) => `${m.provider}/${m.id}` === message.model);
  return {
    ...state,
    connected: true,
    branding: message.branding,
    sessionId: message.sessionId,
    model: message.model,
    thinkingLevel: message.thinkingLevel,
    modelSupportsReasoning: current?.reasoning ?? false,
    models: message.models,
    commands: message.commands,
    isStreaming: message.isStreaming,
    items: message.items,
    queue: { steering: [], followUp: [] },
    errors: [],
  };
}

function reduce(state: AgentState, action: Action): AgentState {
  if (action.type === "connected") return { ...state, connected: true };
  if (action.type === "disconnected") return { ...state, connected: false };

  const message = action.message;
  switch (message.type) {
    case "hello":
    case "session_replaced":
      return applySnapshot(state, message);
    case "sessions":
      return { ...state, sessions: message.sessions };
    case "model_changed":
      return { ...state, model: message.model, modelSupportsReasoning: message.reasoning };
    case "thinking_changed":
      return { ...state, thinkingLevel: message.level };
    case "user":
      return { ...state, items: [...state.items, { kind: "user", text: message.text }] };
    case "agent_start":
      return { ...state, isStreaming: true, errors: [] };
    case "agent_end":
      return {
        ...state,
        isStreaming: false,
        queue: { steering: [], followUp: [] },
        items: state.items.map((item) => {
          if (item.kind === "tool" && item.running) return { ...item, running: false };
          if (item.kind === "assistant" && item.streaming) return { ...item, streaming: false };
          return item;
        }),
      };
    case "assistant_start":
      return { ...state, items: [...state.items, { kind: "assistant", blocks: [], streaming: true }] };
    case "block_delta":
      return {
        ...state,
        items: upsertLastAssistant(state.items, (item) => {
          const blocks = [...item.blocks];
          // Route by contentIndex: same SDK content block → same UI block
          const index = blocks.findIndex((b) => b.contentIndex === message.contentIndex);
          if (index >= 0) {
            blocks[index] = { ...blocks[index], text: blocks[index].text + message.delta };
          } else {
            blocks.push({ type: message.block, text: message.delta, contentIndex: message.contentIndex });
          }
          return { ...item, blocks, streaming: true };
        }),
      };
    case "assistant_end":
      return { ...state, items: upsertLastAssistant(state.items, () => message.item) };
    case "tool_start":
      return {
        ...state,
        items: upsertTool(state.items, message.toolCallId, message.toolName, {
          toolName: message.toolName,
          args: message.args,
          running: true,
        }),
      };
    case "tool_update":
      return {
        ...state,
        items: upsertTool(state.items, message.toolCallId, "tool", { output: message.text }),
      };
    case "tool_end":
      return {
        ...state,
        items: upsertTool(state.items, message.toolCallId, "tool", {
          output: message.text,
          isError: message.isError,
          running: false,
        }),
      };
    case "queue":
      return { ...state, queue: { steering: message.steering, followUp: message.followUp } };
    case "error":
      return { ...state, errors: [...state.errors, message.message] };
    default:
      return state;
  }
}

export function useAgent() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let retryTimer: number | undefined;
    let disposed = false;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        dispatch({ type: "connected" });
      };
      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
        try {
          dispatch({ type: "server", message: JSON.parse(event.data as string) as ServerMessage });
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        // Superseded sockets must not flip the indicator (StrictMode remount, reconnect races)
        if (socketRef.current !== socket) return;
        dispatch({ type: "disconnected" });
        if (!disposed) retryTimer = window.setTimeout(connect, 1500);
      };
    }

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, []);

  function sendMessage(message: ClientMessage) {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  return {
    state,
    prompt: (text: string) => sendMessage({ type: "prompt", text }),
    abort: () => sendMessage({ type: "abort" }),
    setModel: (provider: string, id: string) => sendMessage({ type: "set_model", provider, id }),
    setThinking: (level: ThinkingLevel) => sendMessage({ type: "set_thinking", level }),
    newSession: () => sendMessage({ type: "new_session" }),
    switchSession: (path: string) => sendMessage({ type: "switch_session", path }),
    deleteSession: (path: string) => sendMessage({ type: "delete_session", path }),
    listSessions: () => sendMessage({ type: "list_sessions" }),
  };
}
