import { useEffect, useReducer, useRef } from "react";
import type { ChatItem, ClientMessage, ServerMessage } from "./protocol";

export interface AgentState {
  connected: boolean;
  sessionId: string;
  model: string;
  isStreaming: boolean;
  items: ChatItem[];
  queue: { steering: string[]; followUp: string[] };
  errors: string[];
}

const initialState: AgentState = {
  connected: false,
  sessionId: "",
  model: "",
  isStreaming: false,
  items: [],
  queue: { steering: [], followUp: [] },
  errors: [],
};

type Action = { type: "connected" } | { type: "disconnected" } | { type: "server"; message: ServerMessage };

function updateLastAssistant(items: ChatItem[], update: (item: Extract<ChatItem, { kind: "assistant" }>) => ChatItem): ChatItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "assistant") {
      const next = [...items];
      next[i] = update(item);
      return next;
    }
  }
  return items;
}

function updateTool(items: ChatItem[], toolCallId: string, patch: Partial<Extract<ChatItem, { kind: "tool" }>>): ChatItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "tool" && item.toolCallId === toolCallId) {
      const next = [...items];
      next[i] = { ...item, ...patch };
      return next;
    }
  }
  return items;
}

function reduce(state: AgentState, action: Action): AgentState {
  if (action.type === "connected") return { ...state, connected: true };
  if (action.type === "disconnected") return { ...state, connected: false };

  const message = action.message;
  switch (message.type) {
    case "hello":
      return {
        ...state,
        connected: true,
        sessionId: message.sessionId,
        model: message.model,
        isStreaming: message.isStreaming,
        items: message.items,
        errors: [],
      };
    case "user":
      return { ...state, items: [...state.items, { kind: "user", text: message.text }] };
    case "agent_start":
      return { ...state, isStreaming: true, errors: [] };
    case "agent_end":
      return {
        ...state,
        isStreaming: false,
        queue: { steering: [], followUp: [] },
        items: state.items.map((item) => (item.kind === "tool" && item.running ? { ...item, running: false } : item)),
      };
    case "assistant_start":
      return { ...state, items: [...state.items, { kind: "assistant", blocks: [] }] };
    case "block_delta":
      return {
        ...state,
        items: updateLastAssistant(state.items, (item) => {
          const blocks = [...item.blocks];
          const last = blocks[blocks.length - 1];
          if (last && last.type === message.block) {
            blocks[blocks.length - 1] = { ...last, text: last.text + message.delta };
          } else {
            blocks.push({ type: message.block, text: message.delta });
          }
          return { ...item, blocks };
        }),
      };
    case "assistant_end":
      return { ...state, items: updateLastAssistant(state.items, () => message.item) };
    case "tool_start":
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: "tool",
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            args: message.args,
            output: "",
            running: true,
          },
        ],
      };
    case "tool_update":
      return { ...state, items: updateTool(state.items, message.toolCallId, { output: message.text }) };
    case "tool_end":
      return {
        ...state,
        items: updateTool(state.items, message.toolCallId, {
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
    let socket: WebSocket;
    let retryTimer: number | undefined;
    let disposed = false;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => dispatch({ type: "connected" });
      socket.onmessage = (event) => {
        try {
          dispatch({ type: "server", message: JSON.parse(event.data as string) as ServerMessage });
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        dispatch({ type: "disconnected" });
        if (!disposed) retryTimer = window.setTimeout(connect, 1500);
      };
    }

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      socket.close();
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
  };
}
