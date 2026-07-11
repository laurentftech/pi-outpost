import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  Branding,
  ChatItem,
  ClientMessage,
  CommandInfo,
  ContextUsage,
  DirEntry,
  ExtensionUIRequest,
  FileSearchEntry,
  ModelChoice,
  ServerMessage,
  SessionSummary,
  ThinkingLevel,
  TreeNode,
  WireImage,
} from "@pi-outpost/shared";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;
type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** Extension "Custom UI" dialog requests — need a client answer (select/confirm/input/editor). */
export type DialogRequest = Extract<ExtensionUIRequest, { method: "select" | "confirm" | "input" | "editor" }>;
export interface ExtensionNotification {
  id: string;
  message: string;
  notifyType?: "info" | "warning" | "error";
}
export interface ExtensionWidget {
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

/** File-browser sidebar: one entry per directory path ("" = root), keyed flat (not nested). */
export type DirState = DirEntry[] | "loading" | { error: string };
export type OpenFile =
  | { status: "loading"; path: string; requestId: string }
  | { status: "loaded"; path: string; content: string; size: number }
  | { status: "error"; path: string; message: string };

/** Composer `@` mention autocomplete: results for the most recently issued search. */
export type FileSearch = { status: "loading" | "loaded"; query: string; requestId: string; results: FileSearchEntry[] };

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
  /** Conversation tree (fork/branch navigation); null until list_tree is answered. */
  tree: TreeNode[] | null;
  isStreaming: boolean;
  items: ChatItem[];
  queue: { steering: string[]; followUp: string[] };
  errors: string[];
  contextUsage: ContextUsage | null;
  isCompacting: boolean;
  dialogQueue: DialogRequest[];
  notifications: ExtensionNotification[];
  statuses: Record<string, string>;
  widgets: Record<string, ExtensionWidget>;
  extensionTitle?: string;
  editorPrefill: { text: string; nonce: number } | null;
  fileTree: Record<string, DirState>;
  openFile: OpenFile | null;
  /** Writable zone in the file browser; see SessionSnapshot.writableRoot. */
  writableRoot?: string | null;
  fileSearch: FileSearch | null;
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
  tree: null,
  isStreaming: false,
  items: [],
  queue: { steering: [], followUp: [] },
  errors: [],
  contextUsage: null,
  isCompacting: false,
  dialogQueue: [],
  notifications: [],
  statuses: {},
  widgets: {},
  editorPrefill: null,
  fileTree: {},
  openFile: null,
  fileSearch: null,
};

type Action =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "server"; message: ServerMessage }
  | { type: "dismiss_notification"; id: string }
  | { type: "dialog_answered" }
  | { type: "dir_list_started"; path: string }
  | { type: "file_read_started"; path: string; requestId: string }
  | { type: "close_file_preview" }
  | { type: "file_search_started"; query: string; requestId: string }
  | { type: "file_search_cleared" }
  | { type: "branding_loaded"; branding: Branding };

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
    contextUsage: message.contextUsage ?? null,
    isCompacting: false,
    // The old session's extensions (and any dialogs/toasts/status/widgets they
    // set) are gone once the session is replaced — nothing survives a switch.
    dialogQueue: [],
    notifications: [],
    statuses: {},
    widgets: {},
    extensionTitle: undefined,
    editorPrefill: null,
    // Stale after any snapshot: navigate_tree re-sends it, session switches invalidate it
    tree: null,
    writableRoot: message.writableRoot,
  };
}

function reduce(state: AgentState, action: Action): AgentState {
  if (action.type === "connected") return { ...state, connected: true };
  if (action.type === "disconnected") return { ...state, connected: false };
  // Fetched independently of the WS "hello" so it renders before the session is ready
  // (see the /branding fetch below); "hello" still wins if it arrives with a different value.
  if (action.type === "branding_loaded") return { ...state, branding: action.branding };
  if (action.type === "dismiss_notification") {
    return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) };
  }
  if (action.type === "dialog_answered") return { ...state, dialogQueue: state.dialogQueue.slice(1) };
  if (action.type === "dir_list_started") {
    return { ...state, fileTree: { ...state.fileTree, [action.path]: "loading" } };
  }
  if (action.type === "file_read_started") {
    return { ...state, openFile: { status: "loading", path: action.path, requestId: action.requestId } };
  }
  if (action.type === "close_file_preview") return { ...state, openFile: null };
  if (action.type === "file_search_started") {
    return { ...state, fileSearch: { status: "loading", query: action.query, requestId: action.requestId, results: [] } };
  }
  if (action.type === "file_search_cleared") return { ...state, fileSearch: null };

  const message = action.message;
  switch (message.type) {
    case "hello":
    case "session_replaced":
      return applySnapshot(state, message);
    case "sessions":
      return { ...state, sessions: message.sessions };
    case "tree":
      return { ...state, tree: message.roots };
    case "editor_prefill":
      return {
        ...state,
        editorPrefill: { text: message.text, nonce: state.editorPrefill ? state.editorPrefill.nonce + 1 : 1 },
      };
    case "model_changed":
      return { ...state, model: message.model, modelSupportsReasoning: message.reasoning };
    case "thinking_changed":
      return { ...state, thinkingLevel: message.level };
    case "user":
      return {
        ...state,
        items: [
          ...state.items,
          { kind: "user", text: message.text, ...(message.images ? { images: message.images } : {}) },
        ],
      };
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
    case "custom_message":
      return { ...state, items: [...state.items, message.item] };
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
    case "context_usage":
      return { ...state, contextUsage: message.usage };
    case "compaction_start":
      return { ...state, isCompacting: true };
    case "compaction_end":
      return {
        ...state,
        isCompacting: false,
        errors: message.errorMessage ? [...state.errors, message.errorMessage] : state.errors,
      };
    case "error":
      return { ...state, errors: [...state.errors, message.message] };
    case "directory_listing":
      return { ...state, fileTree: { ...state.fileTree, [message.path]: message.entries } };
    case "file_content":
      // Ignore stale responses from a since-superseded read (user opened another file meanwhile)
      if (state.openFile?.status !== "loading" || state.openFile.requestId !== message.requestId) return state;
      return { ...state, openFile: { status: "loaded", path: message.path, content: message.content, size: message.size } };
    case "file_browser_error":
      if (message.requestId.startsWith("dir:")) {
        return { ...state, fileTree: { ...state.fileTree, [message.path]: { error: message.message } } };
      }
      if (state.openFile?.status !== "loading" || state.openFile.requestId !== message.requestId) return state;
      return { ...state, openFile: { status: "error", path: message.path, message: message.message } };
    case "file_search_results":
      // Ignore stale responses from a since-superseded (or since-cleared) search
      if (state.fileSearch?.requestId !== message.requestId) return state;
      return { ...state, fileSearch: { ...state.fileSearch, status: "loaded", results: message.results } };
    case "extension_ui_request":
      switch (message.method) {
        case "select":
        case "confirm":
        case "input":
        case "editor":
          return { ...state, dialogQueue: [...state.dialogQueue, message] };
        case "notify":
          return {
            ...state,
            notifications: [
              ...state.notifications,
              { id: message.id, message: message.message, notifyType: message.notifyType },
            ],
          };
        case "setStatus": {
          const statuses = { ...state.statuses };
          if (message.statusText === undefined) delete statuses[message.statusKey];
          else statuses[message.statusKey] = message.statusText;
          return { ...state, statuses };
        }
        case "setWidget": {
          const widgets = { ...state.widgets };
          if (message.widgetLines === undefined) delete widgets[message.widgetKey];
          else widgets[message.widgetKey] = { lines: message.widgetLines, placement: message.widgetPlacement ?? "aboveEditor" };
          return { ...state, widgets };
        }
        case "setTitle":
          return { ...state, extensionTitle: message.title };
        case "set_editor_text":
          return { ...state, editorPrefill: { text: message.text, nonce: state.editorPrefill ? state.editorPrefill.nonce + 1 : 1 } };
        default:
          return state;
      }
    default:
      return state;
  }
}

/** `serverUrl.replace(/^http/, "ws") + "/ws"`, or same-origin `/ws` when unset. */
function wsUrlFor(serverUrl: string): string {
  if (serverUrl) return `${serverUrl.replace(/^http/, "ws")}/ws`;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}/ws`;
}

/**
 * `serverUrl` is the pi-outpost backend's origin (e.g. "https://api.example.com"),
 * used by the embeddable widget (`embed/src/mount.tsx`) whose page isn't served by
 * that backend. Defaults to "" — same-origin, the standalone app's behavior.
 */
export function useAgent(serverUrl = "") {
  const [state, dispatch] = useReducer(reduce, initialState);
  const socketRef = useRef<WebSocket | null>(null);
  // Mirrors of state read from inside the stable onmessage closure below (which
  // must not be recreated per-render, so it can't close over fresh `state`).
  const fileTreeRef = useRef(state.fileTree);
  const openFileRef = useRef(state.openFile);
  useEffect(() => {
    fileTreeRef.current = state.fileTree;
  }, [state.fileTree]);
  useEffect(() => {
    openFileRef.current = state.openFile;
  }, [state.openFile]);

  const sendMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  // Branding is pure config (no session dependency) and served as soon as the process
  // starts — fetch it directly instead of waiting on the WS "hello", which only arrives
  // once the (slower) AgentSession runtime is ready.
  useEffect(() => {
    let cancelled = false;
    fetch(`${serverUrl}/branding`)
      .then((res) => (res.ok ? (res.json() as Promise<Branding>) : null))
      .then((branding) => {
        if (!cancelled && branding) dispatch({ type: "branding_loaded", branding });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  useEffect(() => {
    let retryTimer: number | undefined;
    let disposed = false;

    function connect() {
      const socket = new WebSocket(wsUrlFor(serverUrl));
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        dispatch({ type: "connected" });
      };
      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return; // ignore malformed frames
        }
        if (message.type === "file_changed") {
          const lastSlash = message.path.lastIndexOf("/");
          const parentPath = lastSlash < 0 ? "" : message.path.slice(0, lastSlash);
          if (fileTreeRef.current[parentPath] !== undefined) {
            dispatch({ type: "dir_list_started", path: parentPath });
            sendMessage({ type: "list_directory", path: parentPath, requestId: `dir:${crypto.randomUUID()}` });
          }
          const openFile = openFileRef.current;
          if (openFile?.status === "loaded" && openFile.path === message.path) {
            const requestId = `file:${crypto.randomUUID()}`;
            dispatch({ type: "file_read_started", path: message.path, requestId });
            sendMessage({ type: "read_file", path: message.path, requestId });
          }
          return;
        }
        dispatch({ type: "server", message });
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
  }, [sendMessage, serverUrl]);

  return {
    state,
    prompt: (text: string, images?: WireImage[]) =>
      sendMessage({ type: "prompt", text, ...(images?.length ? { images } : {}) }),
    abort: () => sendMessage({ type: "abort" }),
    setModel: (provider: string, id: string) => sendMessage({ type: "set_model", provider, id }),
    setThinking: (level: ThinkingLevel) => sendMessage({ type: "set_thinking", level }),
    newSession: () => sendMessage({ type: "new_session" }),
    switchSession: (path: string) => sendMessage({ type: "switch_session", path }),
    deleteSession: (path: string) => sendMessage({ type: "delete_session", path }),
    listSessions: () => sendMessage({ type: "list_sessions" }),
    listTree: () => sendMessage({ type: "list_tree" }),
    navigateTree: (entryId: string) => sendMessage({ type: "navigate_tree", entryId }),
    forkSession: (entryId: string) => sendMessage({ type: "fork_session", entryId }),
    compact: () => sendMessage({ type: "compact" }),
    /** Answer the dialog at the head of the queue and pop it locally. */
    respondToDialog: (response: { id: string; value: string } | { id: string; confirmed: boolean } | { id: string; cancelled: true }) => {
      sendMessage({ type: "extension_ui_response", ...response });
      dispatch({ type: "dialog_answered" });
    },
    dismissNotification: (id: string) => dispatch({ type: "dismiss_notification", id }),
    /** List a directory's children (path is relative to the browser root; "" = root). */
    listDirectory: (path: string) => {
      dispatch({ type: "dir_list_started", path });
      sendMessage({ type: "list_directory", path, requestId: `dir:${crypto.randomUUID()}` });
    },
    /** Open a file's read-only preview. */
    readFile: (path: string) => {
      const requestId = `file:${crypto.randomUUID()}`;
      dispatch({ type: "file_read_started", path, requestId });
      sendMessage({ type: "read_file", path, requestId });
    },
    closeFilePreview: () => dispatch({ type: "close_file_preview" }),
    /** Search file/directory names for the composer's `@` mention autocomplete. */
    searchFiles: (query: string) => {
      const requestId = `search:${crypto.randomUUID()}`;
      dispatch({ type: "file_search_started", query, requestId });
      sendMessage({ type: "search_files", query, requestId });
    },
    clearFileSearch: () => dispatch({ type: "file_search_cleared" }),
  };
}
