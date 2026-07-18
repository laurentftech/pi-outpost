import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { bootstrapToken, storedToken, storeToken } from "./authToken";
import type {
  Branding,
  ChatItem,
  ClientMessage,
  CommandInfo,
  ContextUsage,
  CredentialStatus,
  DirEntry,
  ExtensionUIRequest,
  FileSearchEntry,
  GitFileState,
  GitLogEntry,
  ModelChoice,
  ProviderCompat,
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
  | {
      status: "loaded";
      path: string;
      content: string;
      size: number;
      /** Disk mtime of `content`; echoed back on save so the server can refuse to clobber concurrent changes. */
      mtimeMs: number;
      /** In-flight write_file request — its content becomes `content` on file_written. */
      pendingSave?: { requestId: string; content: string };
      saveError?: { message: string; conflict: boolean };
    }
  | { status: "error"; path: string; message: string };

/** Composer `@` mention autocomplete: results for the most recently issued search. */
export type FileSearch = { status: "loading" | "loaded"; query: string; requestId: string; results: FileSearchEntry[] };

/** Session menu search: results for the most recently issued query (matched server-side, transcripts included). */
export type SessionSearch = {
  status: "loading" | "loaded";
  query: string;
  requestId: string;
  results: SessionSummary[];
};

/** Latest git working-tree status; null until the first git_status answer. */
export interface GitStatusState {
  branch: string;
  ahead: number;
  behind: number;
  /** Browser-root-relative path → state. */
  files: Record<string, GitFileState>;
}

export type GitDiffState =
  | { path: string; before: string; after: string }
  | { path: string; error: string };

export interface GitShowState {
  sha: string;
  patch: string;
  truncated: boolean;
}

export interface AgentState {
  connected: boolean;
  /** The server refused our token (WS close 4401): show the token screen, stop reconnecting. */
  authRequired: boolean;
  branding: Branding;
  sessionId: string;
  model: string;
  thinkingLevel: string;
  modelSupportsReasoning: boolean;
  models: ModelChoice[];
  commands: CommandInfo[];
  sessions: SessionSummary[] | null;
  /** Active session search; null when the menu shows the plain list. */
  sessionSearch: SessionSearch | null;
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
  /** Which providers can answer; drives the onboarding screen. Never carries a key. */
  credentials: CredentialStatus | null;
  fileSearch: FileSearch | null;
  extensionPaths: string[];
  sandbox: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string } | null;
  gitAvailable: boolean;
  gitStatus: GitStatusState | null;
  /** Worktree-vs-HEAD contents for the viewer's diff toggle. */
  gitDiff: GitDiffState | null;
  gitLog: GitLogEntry[] | null;
  gitShow: GitShowState | null;
}

const initialState: AgentState = {
  connected: false,
  authRequired: false,
  branding: {},
  sessionId: "",
  model: "",
  thinkingLevel: "off",
  modelSupportsReasoning: false,
  models: [],
  commands: [],
  sessions: null,
  sessionSearch: null,
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
  extensionPaths: [],
  sandbox: null,
  gitAvailable: false,
  credentials: null,
  gitStatus: null,
  gitDiff: null,
  gitLog: null,
  gitShow: null,
};

type Action =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "auth_required" }
  | { type: "auth_retrying" }
  | { type: "server"; message: ServerMessage }
  | { type: "dismiss_notification"; id: string }
  | { type: "dialog_answered" }
  | { type: "dir_list_started"; path: string }
  | { type: "file_read_started"; path: string; requestId: string }
  | { type: "file_save_started"; path: string; requestId: string; content: string }
  | { type: "close_file_preview" }
  | { type: "file_search_started"; query: string; requestId: string }
  | { type: "file_search_cleared" }
  | { type: "session_search_started"; query: string; requestId: string }
  | { type: "session_search_cleared" }
  | { type: "git_diff_started"; path: string; requestId: string }
  | { type: "git_diff_cleared" }
  | { type: "git_show_cleared" }
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
  if (message.type !== "hello" && message.type !== "session_replaced" && message.type !== "update_config_ack") return state;
  console.log("[applySnapshot] sandbox from message:", message.sandbox, "type:", message.type, "sessionId:", message.sessionId);
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
    gitAvailable: message.gitAvailable === true,
    credentials: message.credentials ?? null,
    extensionPaths: message.extensionPaths ?? [],
    sandbox: message.sandbox ?? null,
  };
}

function reduce(state: AgentState, action: Action): AgentState {
  if (action.type === "connected") return { ...state, connected: true, authRequired: false };
  if (action.type === "auth_required") return { ...state, connected: false, authRequired: true };
  if (action.type === "auth_retrying") return { ...state, authRequired: false };
  if (action.type === "disconnected") {
    // An in-flight save will never be answered on this socket — surface a retryable
    // error instead of leaving the editor stuck on "saving…"
    const file = state.openFile;
    const openFile =
      file?.status === "loaded" && file.pendingSave !== undefined
        ? { ...file, pendingSave: undefined, saveError: { message: "Connection lost while saving — try again", conflict: false } }
        : state.openFile;
    return { ...state, connected: false, openFile };
  }
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
  if (action.type === "file_save_started") {
    const file = state.openFile;
    // A save while disconnected would never be answered (sendMessage drops the frame)
    if (!state.connected || file?.status !== "loaded" || file.path !== action.path) return state;
    return {
      ...state,
      openFile: { ...file, pendingSave: { requestId: action.requestId, content: action.content }, saveError: undefined },
    };
  }
  if (action.type === "close_file_preview") return { ...state, openFile: null };
  if (action.type === "file_search_started") {
    return { ...state, fileSearch: { status: "loading", query: action.query, requestId: action.requestId, results: [] } };
  }
  if (action.type === "file_search_cleared") return { ...state, fileSearch: null };
  if (action.type === "session_search_started") {
    return {
      ...state,
      sessionSearch: { status: "loading", query: action.query, requestId: action.requestId, results: [] },
    };
  }
  if (action.type === "session_search_cleared") return { ...state, sessionSearch: null };
  if (action.type === "git_diff_started") return { ...state, gitDiff: null };
  if (action.type === "git_diff_cleared") return { ...state, gitDiff: null };
  if (action.type === "git_show_cleared") return { ...state, gitShow: null, gitLog: state.gitLog };

  const message = action.message;
  switch (message.type) {
    case "hello":
    case "session_replaced":
    case "update_config_ack":
      return applySnapshot(state, message);
    case "sessions":
      return { ...state, sessions: message.sessions };
    case "session_search_results":
      // Ignore stale answers: the user has typed on since this search was issued
      if (state.sessionSearch?.requestId !== message.requestId) return state;
      return { ...state, sessionSearch: { ...state.sessionSearch, status: "loaded", results: message.sessions } };
    case "tree":
      return { ...state, tree: message.roots };
    case "editor_prefill":
      return {
        ...state,
        editorPrefill: { text: message.text, nonce: state.editorPrefill ? state.editorPrefill.nonce + 1 : 1 },
      };
    case "model_changed":
      return { ...state, model: message.model, modelSupportsReasoning: message.reasoning };
    case "credentials_changed": {
      // Onboarding landed: new models, new status, same session — so nothing else here
      // is touched (a snapshot would wipe live extension dialogs and widgets).
      const current = message.models.find((choice) => `${choice.provider}/${choice.id}` === message.model);
      return {
        ...state,
        models: message.models,
        model: message.model,
        modelSupportsReasoning: current?.reasoning ?? false,
        credentials: message.credentials,
        // errors stay: the "credentials stored, but allowedModels leaves no model"
        // case sends an error *and* this message — clearing them would eat it
      };
    }
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
    case "user_entries": {
      // Pair from the end (compaction drops a prefix of the history) and STOP at the
      // first text mismatch: a bubble the server never persisted — an extension slash
      // command, a steer aborted before delivery — shifts the alignment, and pairing
      // past it would hand a bubble the previous message's id (editing it would then
      // silently rewind the wrong turn). Unpaired bubbles lose their id: no ✎, no harm.
      const { entries } = message;
      const userIndexes = state.items.flatMap((item, i) => (item.kind === "user" ? [i] : []));
      const paired = new Map<number, string>();
      for (let i = userIndexes.length - 1, k = entries.length - 1; i >= 0 && k >= 0; i--, k--) {
        const item = state.items[userIndexes[i]];
        if (item.kind !== "user" || item.text !== entries[k].text) break;
        paired.set(userIndexes[i], entries[k].entryId);
      }
      return {
        ...state,
        items: state.items.map((item, i) => {
          if (item.kind !== "user") return item;
          const entryId = paired.get(i);
          if (entryId === item.entryId) return item;
          if (entryId === undefined) {
            const { entryId: _dropped, ...rest } = item;
            return rest;
          }
          return { ...item, entryId };
        }),
      };
    }
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
          callHtml: message.callHtml,
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
          outputHtml: message.outputHtml,
          outputHtmlCollapsed: message.outputHtmlCollapsed,
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
      return {
        ...state,
        openFile: { status: "loaded", path: message.path, content: message.content, size: message.size, mtimeMs: message.mtimeMs },
      };
    case "file_written": {
      const file = state.openFile;
      if (file?.status !== "loaded" || file.pendingSave?.requestId !== message.requestId) return state;
      return {
        ...state,
        openFile: { status: "loaded", path: file.path, content: file.pendingSave.content, size: message.size, mtimeMs: message.mtimeMs },
      };
    }
    case "file_browser_error": {
      if (message.requestId.startsWith("dir:")) {
        return { ...state, fileTree: { ...state.fileTree, [message.path]: { error: message.message } } };
      }
      if (message.requestId.startsWith("write:")) {
        const file = state.openFile;
        if (file?.status !== "loaded" || file.pendingSave?.requestId !== message.requestId) return state;
        return {
          ...state,
          openFile: {
            ...file,
            pendingSave: undefined,
            saveError: { message: message.message, conflict: message.reason === "conflict" },
          },
        };
      }
      if (state.openFile?.status !== "loading" || state.openFile.requestId !== message.requestId) return state;
      return { ...state, openFile: { status: "error", path: message.path, message: message.message } };
    }
    case "file_search_results":
      // Ignore stale responses from a since-superseded (or since-cleared) search
      if (state.fileSearch?.requestId !== message.requestId) return state;
      return { ...state, fileSearch: { ...state.fileSearch, status: "loaded", results: message.results } };
    case "git_status": {
      const files: Record<string, GitFileState> = {};
      for (const file of message.files) files[file.path] = file.status;
      return { ...state, gitStatus: { branch: message.branch, ahead: message.ahead, behind: message.behind, files } };
    }
    case "git_diff":
      return { ...state, gitDiff: { path: message.path, before: message.before, after: message.after } };
    case "git_log":
      return { ...state, gitLog: message.entries };
    case "git_show":
      return { ...state, gitShow: { sha: message.sha, patch: message.patch, truncated: message.truncated } };
    case "git_error":
      // Diff failures belong in the viewer's diff pane (the error banner renders
      // under the full-pane overlay where nobody can see it)
      if (message.requestId.startsWith("gitdiff:")) {
        return { ...state, gitDiff: state.openFile ? { path: state.openFile.path, error: message.message } : null };
      }
      return { ...state, errors: [...state.errors, `git: ${message.message}`] };
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
function wsUrlFor(serverUrl: string, token: string | null): string {
  const base = serverUrl
    ? `${serverUrl.replace(/^http/, "ws")}/ws`
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  // Browsers cannot set headers on WebSockets — the token rides a query parameter
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/** WS close code the server sends for a bad/missing token (see WS_CLOSE_UNAUTHORIZED server-side). */
const WS_CLOSE_UNAUTHORIZED = 4401;

/**
 * `serverUrl` is the pi-outpost backend's origin (e.g. "https://api.example.com"),
 * used by the embeddable widget (`embed/src/mount.tsx`) whose page isn't served by
 * that backend. Defaults to "" — same-origin, the standalone app's behavior.
 *
 * `explicitToken` (embed hosts) wins over the ?token=/localStorage flow.
 *
 * `embedded` disables URL capture: the host page's ?token= parameter and
 * history belong to the host app, the widget must not consume or rewrite them.
 */
export function useAgent(serverUrl = "", explicitToken?: string, embedded = false) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const socketRef = useRef<WebSocket | null>(null);
  // Bumped when the user submits a token on the TokenGate — re-runs the connect effect
  const [authNonce, setAuthNonce] = useState(0);
  const tokenRef = useRef<string | null>(null);
  if (authNonce === 0 && tokenRef.current === null) {
    tokenRef.current = explicitToken ?? (embedded ? storedToken() : bootstrapToken());
  }
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
  const gitDiffPathRef = useRef<string | null>(null);
  useEffect(() => {
    gitDiffPathRef.current = state.gitDiff?.path ?? null;
  }, [state.gitDiff]);

  const sendMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  // Git status refetches are event-driven (connect, file_changed, agent_end) and can
  // burst — coalesce to one in flight with a single trailing rerun.
  const gitAvailableRef = useRef(false);
  const gitStatusInFlight = useRef(false);
  const gitStatusQueued = useRef(false);
  const refreshGitStatus = useCallback(() => {
    if (!gitAvailableRef.current) return;
    if (gitStatusInFlight.current) {
      gitStatusQueued.current = true;
      return;
    }
    gitStatusInFlight.current = true;
    sendMessage({ type: "git_status", requestId: `git:${crypto.randomUUID()}` });
  }, [sendMessage]);
  const gitStatusSettled = useCallback(() => {
    gitStatusInFlight.current = false;
    if (gitStatusQueued.current) {
      gitStatusQueued.current = false;
      refreshGitStatus();
    }
  }, [refreshGitStatus]);

  // Branding is pure config (no session dependency) and served as soon as the process
  // starts — fetch it directly instead of waiting on the WS "hello", which only arrives
  // once the (slower) AgentSession runtime is ready.
  useEffect(() => {
    let cancelled = false;
    fetch(`${serverUrl}/branding`, {
      headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {},
    })
      .then((res) => (res.ok ? (res.json() as Promise<Branding>) : null))
      .then((branding) => {
        if (!cancelled && branding) dispatch({ type: "branding_loaded", branding });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authNonce]);

  useEffect(() => {
    let retryTimer: number | undefined;
    let disposed = false;

    function connect() {
      const socket = new WebSocket(wsUrlFor(serverUrl, tokenRef.current));
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
          // An open "± diff" pane for this file would silently go stale otherwise
          if (gitDiffPathRef.current === message.path) {
            sendMessage({ type: "git_diff", path: message.path, requestId: `gitdiff:${crypto.randomUUID()}` });
          }
          refreshGitStatus();
          return;
        }
        if (message.type === "hello" || message.type === "session_replaced") {
          gitAvailableRef.current = message.gitAvailable === true;
          if (message.type === "hello") refreshGitStatus();
        }
        // Bash commands can change git state without any file_changed broadcast
        if (message.type === "agent_end") refreshGitStatus();
        if (message.type === "git_status" || (message.type === "git_error" && message.requestId.startsWith("git:"))) {
          gitStatusSettled();
        }
        dispatch({ type: "server", message });
      };
      socket.onclose = (event) => {
        // Superseded sockets must not flip the indicator (StrictMode remount, reconnect races)
        if (socketRef.current !== socket) return;
        // An in-flight git_status will never be answered on this socket — clear the
        // coalescing flags or the branch chip/badges freeze until a page reload
        gitStatusInFlight.current = false;
        gitStatusQueued.current = false;
        if (event.code === WS_CLOSE_UNAUTHORIZED) {
          // Bad token: retrying is pointless — show the token screen instead
          dispatch({ type: "auth_required" });
          return;
        }
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
  }, [sendMessage, serverUrl, refreshGitStatus, gitStatusSettled, authNonce]);

  return {
    state,
    /** Current auth token (null when none) — for building /files/raw image URLs. */
    authToken: tokenRef.current,
    /** TokenGate submission: persist the token and reconnect with it. */
    submitToken: (token: string) => {
      storeToken(token);
      tokenRef.current = token;
      dispatch({ type: "auth_retrying" });
      setAuthNonce((n) => n + 1);
    },
    prompt: (text: string, images?: WireImage[]) =>
      sendMessage({ type: "prompt", text, ...(images?.length ? { images } : {}) }),
    abort: () => sendMessage({ type: "abort" }),
    setModel: (provider: string, id: string) => sendMessage({ type: "set_model", provider, id }),
    setThinking: (level: ThinkingLevel) => sendMessage({ type: "set_thinking", level }),
    newSession: () => sendMessage({ type: "new_session" }),
    switchSession: (path: string) => sendMessage({ type: "switch_session", path }),
    deleteSession: (path: string) => sendMessage({ type: "delete_session", path }),
    listSessions: () => sendMessage({ type: "list_sessions" }),
    /** Set a session's display name; an empty name clears it (back to its first message). */
    renameSession: (path: string, name: string) => sendMessage({ type: "rename_session", path, name }),
    /** Find sessions by name, first message or transcript content. */
    searchSessions: (query: string) => {
      const requestId = `sessions:${crypto.randomUUID()}`;
      dispatch({ type: "session_search_started", query, requestId });
      sendMessage({ type: "search_sessions", query, requestId });
    },
    clearSessionSearch: () => dispatch({ type: "session_search_cleared" }),
    listTree: () => sendMessage({ type: "list_tree" }),
    navigateTree: (entryId: string) => sendMessage({ type: "navigate_tree", entryId }),
    forkSession: (entryId: string) => sendMessage({ type: "fork_session", entryId }),
    /** Re-send a past user message with edited text — the answer branches off, the original stays in the tree. */
    editPrompt: (entryId: string, text: string, images?: WireImage[]) =>
      sendMessage({ type: "edit_prompt", entryId, text, ...(images?.length ? { images } : {}) }),
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
    /** Save the editor buffer back to disk; answered by file_written or a "write:" file_browser_error. */
    writeFile: (path: string, content: string, expectedMtimeMs: number, force = false) => {
      const requestId = `write:${crypto.randomUUID()}`;
      dispatch({ type: "file_save_started", path, requestId, content });
      sendMessage({ type: "write_file", path, content, expectedMtimeMs, ...(force ? { force } : {}), requestId });
    },
    /** Search file/directory names for the composer's `@` mention autocomplete. */
    searchFiles: (query: string) => {
      const requestId = `search:${crypto.randomUUID()}`;
      dispatch({ type: "file_search_started", query, requestId });
      sendMessage({ type: "search_files", query, requestId });
    },
    clearFileSearch: () => dispatch({ type: "file_search_cleared" }),
    /** Manual git status refresh (event-driven refreshes are automatic). */
    fetchGitStatus: refreshGitStatus,
    /** Worktree-vs-HEAD contents for one file (answers land in state.gitDiff). */
    fetchGitDiff: (path: string) => {
      const requestId = `gitdiff:${crypto.randomUUID()}`;
      dispatch({ type: "git_diff_started", path, requestId });
      sendMessage({ type: "git_diff", path, requestId });
    },
    clearGitDiff: () => dispatch({ type: "git_diff_cleared" }),
    fetchGitLog: (limit?: number) => sendMessage({ type: "git_log", ...(limit ? { limit } : {}), requestId: `gitlog:${crypto.randomUUID()}` }),
    fetchGitShow: (sha: string) => sendMessage({ type: "git_show", sha, requestId: `gitshow:${crypto.randomUUID()}` }),
    clearGitShow: () => dispatch({ type: "git_show_cleared" }),
    /** Onboarding: store an API key for a provider the server already knows. */
    setCredential: (provider: string, apiKey: string) => sendMessage({ type: "set_credential", provider, apiKey }),
    /** Onboarding: declare an OpenAI-compatible endpoint (corporate gateway, vLLM, Ollama…). */
    declareProvider: (declaration: { provider: string; baseUrl: string; apiKey: string; models: string[]; compat?: ProviderCompat }) =>
      sendMessage({ type: "declare_provider", ...declaration }),
    /** Update sandbox config at runtime. */
    updateConfig: (sandbox: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string }) =>
      sendMessage({ type: "update_config", sandbox }),
  };
}
