import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { bootstrapToken, storedToken, storeToken } from "./authToken";
import { repoForPath } from "./util/gitRepos";
import type {
  AgentResourceInventory,
  AgentResourceRepositoryPreview,
  AgentResourceUpdateResult,
  Branding,
  ChatItem,
  ClientMessage,
  CommandInfo,
  ContextUsage,
  CredentialStatus,
  DirEntry,
  EmbedWorkspaceControls,
  ExtensionUIRequest,
  FileOperation,
  FileSearchEntry,
  GitFileLogEntry,
  GitFileState,
  GitLogEntry,
  GitRepoStatus,
  GitRevision,
  GitUnavailable,
  ModelChoice,
  ProviderCompat,
  ServerDirEntry,
  ServerMessage,
  SessionSummary,
  ThinkingLevel,
  TreeNode,
  WorkspaceInfo,
  WorkspaceOutcome,
  WireImage,
  WorkPlan,
} from "@pi-outpost/shared";
import { UPLOADS_DIRECTORY, UploadError } from "./uploads";
import { isImageFile, isPdfFile } from "./util/workspacePath";

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

export type TerminalDataListener = (data: string) => void;
export type TerminalCwdListener = (cwd: string) => void;
export type TerminalExitListener = (exitCode?: number) => void;
export type TerminalErrorListener = (message: string) => void;

interface TerminalListeners {
  onData: Set<TerminalDataListener>;
  onCwd: Set<TerminalCwdListener>;
  onExit: Set<TerminalExitListener>;
  onError: Set<TerminalErrorListener>;
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
      /** Created from the tree just now: the viewer opens straight into edit mode. */
      justCreated?: boolean;
      /**
       * Why this file failed the structured-exchange schema it declares, from the
       * reference validator. Present only for a document that claims the contract
       * and does not meet it; the browser's own check answers yes or no and has no
       * reason to give.
       */
      documentIssues?: { rule: string; path: string; message: string }[];
      /**
       * In-flight background re-read (`file_changed` / `directory_changed`), if any.
       *
       * Kept on the "loaded" variant instead of flipping to "loading", the same
       * choice `dir_list_started`'s `preserveEntries` makes for the tree: the file
       * that changed underneath the viewer is still the best answer to "what does
       * this file contain" until the new read lands, and blanking it would unmount
       * the rendered markdown for no reason the user did anything to deserve.
       */
      refreshRequestId?: string;
    }
  | { status: "error"; path: string; message: string };

/** Composer `@` mention autocomplete: results for the most recently issued search. */
export type FileSearch = { status: "loading" | "loaded"; query: string; requestId: string; results: FileSearchEntry[] };

export type FileOperationState =
  | { status: "pending"; operation: FileOperation; path: string; requestId: string }
  | { status: "succeeded"; operation: FileOperation; path: string; resultPath: string; requestId: string }
  | { status: "error"; operation: FileOperation; path: string; message: string; requestId: string };

/** Session menu search: results for the most recently issued query (matched server-side, transcripts included). */
export type SessionSearch = {
  status: "loading" | "loaded";
  query: string;
  requestId: string;
  results: SessionSummary[];
};

/**
 * The last commit log answered, and which repository answered it.
 *
 * A workspace holds several, so entries alone are not enough: rendered under
 * another repository's chip they read as that repository's history, and clicking one
 * would ask for a commit id the named repository has never heard of.
 */
export interface GitLogState {
  repo: string;
  entries: GitLogEntry[];
}

/** Latest git working-tree status; null until the first git_status answer. */
export interface GitStatusState {
  /** Every repository serving the workspace, each with its own branch. */
  repos: GitRepoStatus[];
  /** Browser-root-relative path → state, across all of them. */
  files: Record<string, GitFileState>;
}

export type OutcomeState =
  | { status: "loading"; requestId: string; workspaceRoot: string | null; sessionId: string }
  | { status: "loaded"; requestId: string; workspaceRoot: string | null; sessionId: string; outcome: WorkspaceOutcome }
  | { status: "error"; requestId: string; workspaceRoot: string | null; sessionId: string; message: string };

export type GitDiffState =
  | { path: string; before: string; after: string }
  | { path: string; error: string };

export interface GitShowState {
  sha: string;
  patch: string;
  truncated: boolean;
}

/** The open file's commit history; null when the history pane is closed. */
export interface GitFileHistoryState {
  path: string;
  status: "loading" | "loaded" | "error";
  entries: GitFileLogEntry[];
  error?: string;
  requestId: string;
}

/**
 * The diff between the two selected revisions. `beforeText`/`afterText` survive a
 * reload so the pane can dim the previous diff instead of flashing empty.
 */
export interface GitFileDiffState {
  base: GitRevision;
  target: GitRevision;
  status: "loading" | "loaded" | "error";
  beforeText: string;
  afterText: string;
  error?: string;
  requestId: string;
}

/** The directory a browser-root-relative path sits in; "" for a path at the root. */
function parentDirectory(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash < 0 ? "" : path.slice(0, lastSlash);
}

/** Two revision pairs are the same request when both sides match, side for side. */
function samePair(a: { base: GitRevision; target: GitRevision }, b: { base: GitRevision; target: GitRevision }): boolean {
  return a.base.rev === b.base.rev && a.base.path === b.base.path && a.target.rev === b.target.rev && a.target.path === b.target.path;
}

/**
 * The Settings path picker's current listing. One at a time: the picker is a
 * modal step inside the settings menu, so a second browse replaces the first
 * rather than accumulating (the requestId is what discards a stale answer).
 */
export interface ServerBrowseState {
  status: "loading" | "loaded" | "error";
  path: string;
  parent: string | null;
  entries: ServerDirEntry[];
  error?: string;
  requestId: string;
}

/**
 * The in-flight settings apply, so the menu can stay open on a refusal and show
 * why. Cleared by the acknowledgement, which only arrives after the server has
 * persisted the change — "applied" here means "on disk", not "sent".
 */
export type SettingsApplyState = { status: "applying" } | { status: "error"; message: string };

export interface AgentResourceOperationState {
  clonePath: { requestId: string; status: "loading" | "ready" | "error"; path?: string; message?: string } | null;
  preview: { requestId: string; status: "loading" | "ready" | "error"; preview?: AgentResourceRepositoryPreview; message?: string } | null;
  enrollment: { requestId: string; status: "loading" | "ready" | "error"; message?: string } | null;
  refresh: { requestId: string; repositoryId?: string; status: "loading" | "ready" | "error"; message?: string } | null;
  updates: Record<string, { requestId: string; status: "loading" | "ready" | "error"; result?: AgentResourceUpdateResult; message?: string }>;
}

function emptyAgentResourceOperations(): AgentResourceOperationState {
  return { clonePath: null, preview: null, enrollment: null, refresh: null, updates: {} };
}

export interface AgentState {
  connected: boolean;
  /**
   * The project this connection is bound to; null on a single-project server,
   * where no selector is offered.
   */
  workspace: WorkspaceInfo | null;
  /** Every open project with its activity. Empty on a single-project server. */
  workspaces: WorkspaceInfo[];
  /** Opening, closing and switching are forbidden by the server's configuration. */
  workspaceLocked: boolean;
  /**
   * Which workspace affordances a mounted widget presents. `settings` when the
   * server says nothing, which is what every server said before the setting
   * existed. Read only by the embedded app; the standalone one ignores it.
   */
  embedWorkspaceControls: EmbedWorkspaceControls;
  /** A switch is in flight: the conversation fades rather than emptying. */
  switching: boolean;
  /** The server refused our token (WS close 4401): show the token screen, stop reconnecting. */
  authRequired: boolean;
  /** The independent branding request has settled, so an embed may paint without a default-brand flash. */
  brandingReady: boolean;
  branding: Branding;
  sessionId: string;
  model: string;
  thinkingLevel: string;
  modelSupportsReasoning: boolean;
  /** The levels the current model accepts; undefined means offer the full set. */
  thinkingLevels?: ThinkingLevel[];
  models: ModelChoice[];
  commands: CommandInfo[];
  sessions: SessionSummary[] | null;
  /** Active session search; null when the menu shows the plain list. */
  sessionSearch: SessionSearch | null;
  /** Conversation tree (fork/branch navigation); null until list_tree is answered. */
  tree: TreeNode[] | null;
  isStreaming: boolean;
  items: ChatItem[];
  /**
   * A prompt this client has sent and the server has not echoed back yet.
   *
   * The authoritative bubble arrives on `user`, which the server broadcasts only
   * once the runtime *accepts* the prompt — after session creation, runtime
   * start-up and, on a loaded provider, the wait for the request to be taken.
   * Those seconds used to show nothing at all: the composer emptied and the
   * transcript did not move, which reads as a lost message.
   *
   * Kept out of `items` deliberately. `user_entries` pairs bubbles to persisted
   * entry ids counting from the end, so an unsent bubble sitting in that list
   * would take the previous message's id — and editing it would rewind the wrong
   * turn.
   */
  pendingPrompt: { text: string; images?: WireImage[] } | null;
  workPlan: WorkPlan | null;
  /** Latest workspace Outcome request/result; null until the drawer is opened. */
  outcome: OutcomeState | null;
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
  /** Latest list request per directory; older replies must not restore stale entries. */
  directoryRequests: Record<string, string>;
  openFile: OpenFile | null;
  /** Cache-buster for raw image/PDF previews whose workspace path did not change. */
  previewRevision: number;
  /** Writable zone in the file browser; see SessionSnapshot.writableRoot. */
  writableRoot?: string | null;
  /** Which providers can answer; drives the onboarding screen. Never carries a key. */
  credentials: CredentialStatus | null;
  fileSearch: FileSearch | null;
  /** Refusal of the last creation request, for the tree row that asked for it. */
  createError: { path: string; message: string } | null;
  /**
   * Path the last creation actually produced. The tree needs a definite answer:
   * "the name is in the listing" is also true when the name was already taken,
   * which is the refusal it must not mistake for success.
   */
  created: string | null;
  /** Latest tree lifecycle request, so controls close only on a real acknowledgement and retain errors. */
  fileOperation: FileOperationState | null;
  /**
   * Extension files the runtime reported loading, or null when it cannot report an
   * inventory at all. Null is not the empty list: an RPC child builds its own
   * extensions, and drawing "none loaded" there states a fact nobody supplied.
   */
  extensionPaths: string[] | null;
  /** Extension paths from the configuration file — shown, never editable here. */
  configuredExtensionPaths: string[];
  /** Extension paths added through Settings — the list the user may edit. */
  userExtensionPaths: string[];
  /** Whether the deployment forbids editing extension paths from the interface. */
  extensionLock: boolean;
  tools: { name: string; active: boolean }[];
  sandbox: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string } | null;
  /** Terminal configuration — whether the terminal is enabled and locked. */
  terminal?: { enabled: boolean; locked?: boolean } | null;
  /**
   * Skill paths added through Settings — the list the user may add to and remove
   * from. The configuration file's own `skillPaths` are not carried into the UI:
   * they load regardless, and nothing here may touch them.
   */
  userSkillPaths: string[];
  /** Open server-directory listing for a Settings path field; null when no picker is open. */
  serverBrowse: ServerBrowseState | null;
  /** Outcome of the settings apply the user is waiting on; null when none is in flight. */
  settingsApply: SettingsApplyState | null;
  agentResources: AgentResourceInventory | null;
  agentResourceOperations: AgentResourceOperationState;
  versions: { piOutpost: string; piSdk?: string; agent?: string } | null;
  gitAvailable: boolean;
  /** Why git is unavailable, when it is. Null whenever it is available. */
  gitUnavailable: GitUnavailable | null;
  gitStatus: GitStatusState | null;
  /** Worktree-vs-HEAD contents for the viewer's diff toggle. */
  gitDiff: GitDiffState | null;
  /** The last commit log, with the repository it belongs to — see `GitLogState`. */
  gitLog: GitLogState | null;
  gitShow: GitShowState | null;
  /** The open file's history, and the diff between the two revisions picked in it. */
  gitFileHistory: GitFileHistoryState | null;
  gitFileDiff: GitFileDiffState | null;
}

const initialState: AgentState = {
  connected: false,
  workspace: null,
  workspaces: [],
  workspaceLocked: false,
  embedWorkspaceControls: "settings",
  switching: false,
  authRequired: false,
  brandingReady: false,
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
  pendingPrompt: null,
  workPlan: null,
  outcome: null,
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
  directoryRequests: {},
  openFile: null,
  previewRevision: 0,
  fileSearch: null,
  createError: null,
  created: null,
  fileOperation: null,
  extensionPaths: null,
  configuredExtensionPaths: [],
  userExtensionPaths: [],
  extensionLock: false,
  tools: [],
  sandbox: null,
  terminal: null,
  userSkillPaths: [],
  serverBrowse: null,
  settingsApply: null,
  agentResources: null,
  agentResourceOperations: emptyAgentResourceOperations(),
  versions: null,
  gitAvailable: false,
  gitUnavailable: null,
  credentials: null,
  gitStatus: null,
  gitDiff: null,
  gitLog: null,
  gitShow: null,
  gitFileHistory: null,
  gitFileDiff: null,
};

type Action =
  | { type: "connected" }
  | { type: "workspace_switching" }
  | { type: "disconnected" }
  | { type: "auth_required" }
  | { type: "auth_retrying" }
  | { type: "server"; message: ServerMessage }
  | { type: "prompt_sent"; text: string; images?: WireImage[] }
  | { type: "dismiss_notification"; id: string }
  | { type: "dialog_answered" }
  | { type: "dir_list_started"; path: string; requestId: string; preserveEntries?: boolean }
  | { type: "raw_preview_changed"; path: string }
  | { type: "file_read_started"; path: string; requestId: string; preserveContent?: boolean }
  | { type: "file_save_started"; path: string; requestId: string; content: string }
  | { type: "close_file_preview" }
  | { type: "file_create_started" }
  | { type: "file_operation_started"; operation: FileOperation; path: string; requestId: string }
  | { type: "file_search_started"; query: string; requestId: string }
  | { type: "file_search_cleared" }
  | { type: "session_search_started"; query: string; requestId: string }
  | { type: "session_search_cleared" }
  | { type: "git_diff_started"; path: string; requestId: string }
  | { type: "git_diff_cleared" }
  | { type: "git_show_cleared" }
  | { type: "git_file_history_started"; path: string; requestId: string }
  | { type: "git_file_history_closed" }
  | { type: "git_file_diff_started"; base: GitRevision; target: GitRevision; requestId: string }
  | { type: "git_file_diff_cleared" }
  | { type: "server_browse_started"; path: string; requestId: string }
  | { type: "server_browse_closed" }
  | { type: "settings_apply_started" }
  | { type: "resource_clone_path_started"; requestId: string }
  | { type: "resource_preview_started"; requestId: string }
  | { type: "resource_enrollment_started"; requestId: string }
  | { type: "resource_refresh_started"; requestId: string; repositoryId?: string }
  | { type: "resource_update_started"; requestId: string; repositoryId: string }
  | { type: "outcome_started"; requestId: string; workspaceRoot: string | null; sessionId: string }
  | { type: "branding_settled" }
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
  if (
    message.type !== "hello" &&
    message.type !== "session_replaced" &&
    message.type !== "update_config_ack" &&
    message.type !== "workspace_switched"
  )
    return state;
  const current = message.models.find((m) => `${m.provider}/${m.id}` === message.model);
  return {
    ...state,
    connected: true,
    brandingReady: true,
    workspace: message.workspace ?? null,
    workspaces: message.workspaces ?? [],
    // Absent means unlocked: the server sends the flag only when configuration
    // forbids opening, closing and switching. Defaulting to locked hid the
    // selector on every unconfigured server — the bench caught it, the unit
    // suites could not, since none of them had two projects on a real wire.
    workspaceLocked: message.workspaceLocked === true,
    // Absent means "settings" for the same reason: the policy narrows what an
    // embed offers, and saying nothing has to mean the interface it always had.
    embedWorkspaceControls: message.embedWorkspaceControls ?? "settings",
    switching: false,
    branding: message.branding,
    sessionId: message.sessionId,
    model: message.model,
    thinkingLevel: message.thinkingLevel,
    thinkingLevels: message.thinkingLevels,
    modelSupportsReasoning: current?.reasoning ?? false,
    models: message.models,
    commands: message.commands,
    isStreaming: message.isStreaming,
    items: message.items,
    // A snapshot is the authority on what this conversation contains. A prompt
    // still waiting for its echo when one arrives — a reconnect, a session
    // switch — either made it into these items or never landed at all.
    pendingPrompt: null,
    workPlan: message.workPlan ?? null,
    // An Outcome is a claim about one workspace and one session. Correlation
    // discards a late response; this discards one already on screen, which the
    // drawer would otherwise render under whichever session or workspace the
    // snapshot brings until a refresh lands.
    outcome: null,
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
    // The file tree is cached per BROWSER_ROOT — a replaced session may have a different root.
    fileTree: {},
    directoryRequests: {},
    fileOperation: null,
    writableRoot: message.writableRoot,
    gitAvailable: message.gitAvailable === true,
    gitUnavailable: message.gitUnavailable ?? null,
    credentials: message.credentials ?? null,
    extensionPaths: message.extensionPaths ?? null,
    configuredExtensionPaths: message.configuredExtensionPaths ?? [],
    userExtensionPaths: message.userExtensionPaths ?? [],
    extensionLock: message.extensionLock === true,
    tools: message.tools ?? [],
    sandbox: message.sandbox ?? null,
    terminal: message.terminal ?? null,
    userSkillPaths: message.userSkillPaths ?? [],
    serverBrowse: null,
    settingsApply: null,
    versions: message.versions ?? null,
    agentResources: message.agentResources ?? null,
    agentResourceOperations: emptyAgentResourceOperations(),
  };
}

function reduce(state: AgentState, action: Action): AgentState {
  if (action.type === "connected") return { ...state, connected: true, authRequired: false };
  if (action.type === "workspace_switching") return { ...state, switching: true };
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
    const outcome = state.outcome?.status === "loading" ? { ...state.outcome, status: "error" as const, message: "Connection lost while loading Outcome." } : state.outcome;
    return { ...state, connected: false, openFile, outcome };
  }
  // Fetched independently of the WS "hello" so it renders before the session is ready
  // (see the /branding fetch below); "hello" still wins if it arrives with a different value.
  if (action.type === "branding_settled") return { ...state, brandingReady: true };
  if (action.type === "branding_loaded") return { ...state, brandingReady: true, branding: action.branding };
  if (action.type === "prompt_sent") {
    return { ...state, pendingPrompt: { text: action.text, ...(action.images?.length ? { images: action.images } : {}) } };
  }
  if (action.type === "dismiss_notification") {
    return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) };
  }
  if (action.type === "dialog_answered") return { ...state, dialogQueue: state.dialogQueue.slice(1) };
  if (action.type === "dir_list_started") {
    const current = state.fileTree[action.path];
    return {
      ...state,
      fileTree: {
        ...state.fileTree,
        [action.path]: action.preserveEntries && Array.isArray(current) ? current : "loading",
      },
      directoryRequests: { ...state.directoryRequests, [action.path]: action.requestId },
    };
  }
  if (action.type === "raw_preview_changed") {
    if (state.openFile?.path !== action.path) return state;
    return { ...state, previewRevision: state.previewRevision + 1 };
  }
  if (action.type === "file_read_started") {
    const current = state.openFile;
    // A background refresh of the file already on screen: keep showing it — see
    // `refreshRequestId` on the "loaded" variant.
    if (action.preserveContent && current?.status === "loaded" && current.path === action.path) {
      return { ...state, openFile: { ...current, refreshRequestId: action.requestId } };
    }
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
  if (action.type === "file_create_started") return { ...state, createError: null, created: null };
  if (action.type === "file_operation_started") {
    return { ...state, fileOperation: { status: "pending", operation: action.operation, path: action.path, requestId: action.requestId } };
  }
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
  if (action.type === "git_file_history_started") {
    return {
      ...state,
      gitFileHistory: { path: action.path, status: "loading", entries: [], requestId: action.requestId },
      gitFileDiff: null,
    };
  }
  if (action.type === "git_file_history_closed") return { ...state, gitFileHistory: null, gitFileDiff: null };
  if (action.type === "git_file_diff_started") {
    return {
      ...state,
      gitFileDiff: {
        base: action.base,
        target: action.target,
        status: "loading",
        // Keep the previous texts so the pane dims the old diff instead of flashing empty
        beforeText: state.gitFileDiff?.beforeText ?? "",
        afterText: state.gitFileDiff?.afterText ?? "",
        requestId: action.requestId,
      },
    };
  }
  if (action.type === "git_file_diff_cleared") return { ...state, gitFileDiff: null };
  if (action.type === "server_browse_started") {
    return {
      ...state,
      serverBrowse: {
        status: "loading",
        // The directory *on screen*, which is still the previous one until the
        // answer lands — path, parent and entries move together or not at all.
        // Moving the path early would put one directory's name over another's
        // contents, and leave a refused path selectable when the answer is an error.
        path: state.serverBrowse?.path ?? action.path,
        parent: state.serverBrowse?.parent ?? null,
        entries: state.serverBrowse?.entries ?? [],
        requestId: action.requestId,
      },
    };
  }
  if (action.type === "server_browse_closed") return { ...state, serverBrowse: null };
  if (action.type === "settings_apply_started") return { ...state, settingsApply: { status: "applying" } };
  if (action.type === "resource_clone_path_started") {
    return { ...state, agentResourceOperations: { ...state.agentResourceOperations, clonePath: { requestId: action.requestId, status: "loading" } } };
  }
  if (action.type === "resource_preview_started") {
    return { ...state, agentResourceOperations: { ...state.agentResourceOperations, preview: { requestId: action.requestId, status: "loading" } } };
  }
  if (action.type === "resource_enrollment_started") {
    return { ...state, agentResourceOperations: { ...state.agentResourceOperations, enrollment: { requestId: action.requestId, status: "loading" } } };
  }
  if (action.type === "resource_refresh_started") {
    return {
      ...state,
      agentResourceOperations: {
        ...state.agentResourceOperations,
        refresh: { requestId: action.requestId, status: "loading", ...(action.repositoryId ? { repositoryId: action.repositoryId } : {}) },
      },
    };
  }
  if (action.type === "resource_update_started") {
    return {
      ...state,
      agentResourceOperations: {
        ...state.agentResourceOperations,
        updates: {
          ...state.agentResourceOperations.updates,
          [action.repositoryId]: { requestId: action.requestId, status: "loading" },
        },
      },
    };
  }
  if (action.type === "outcome_started") {
    return { ...state, outcome: { status: "loading", requestId: action.requestId, workspaceRoot: action.workspaceRoot, sessionId: action.sessionId } };
  }

  const message = action.message;
  switch (message.type) {
    case "hello":
    case "session_replaced":
    case "update_config_ack":
    case "workspace_switched":
      // The view is deliberately not carried across a switch: coming back to a
      // project shows its conversation, not the screen it was left on. The
      // composer draft is the one exception and lives outside this reducer.
      return {
        ...applySnapshot(state, message),
        openFile: null,
        gitDiff: null,
        // The other project's tree, cached under paths that mean something else
        // there. Dropped rather than reused, the way a session replace already does.
        fileTree: {},
        directoryRequests: {},
      };
    case "workspace_activity":
      // Activity only — no conversation content, and deliberately accepted while
      // bound elsewhere: that is what makes background work visible at all.
      return {
        ...state,
        workspaces: message.workspaces,
        workspace: message.workspaces.find((w) => w.root === state.workspace?.root) ?? state.workspace,
      };
    case "agent_resource_clone_path": {
      const pending = state.agentResourceOperations.clonePath;
      if (pending?.requestId !== message.requestId) return state;
      return {
        ...state,
        agentResourceOperations: { ...state.agentResourceOperations, clonePath: { ...pending, status: "ready", path: message.path } },
      };
    }
    case "agent_resource_preview": {
      const pending = state.agentResourceOperations.preview;
      if (pending?.requestId !== message.requestId) return state;
      return {
        ...state,
        agentResourceOperations: { ...state.agentResourceOperations, preview: { ...pending, status: "ready", preview: message.preview } },
      };
    }
    case "agent_resource_enrolled": {
      const pending = state.agentResourceOperations.enrollment;
      if (pending?.requestId !== message.requestId) return state;
      return {
        ...state,
        agentResources: message.inventory,
        agentResourceOperations: {
          ...state.agentResourceOperations,
          preview: null,
          enrollment: { ...pending, status: "ready" },
        },
      };
    }
    case "agent_resource_assessments": {
      const pending = state.agentResourceOperations.refresh;
      if (pending?.requestId !== message.requestId || !state.agentResources) return state;
      const assessments = new Map(message.assessments.map((assessment) => [assessment.repositoryId, assessment]));
      return {
        ...state,
        agentResources: {
          ...state.agentResources,
          repositories: state.agentResources.repositories.map((repository) => ({
            ...repository,
            assessment: assessments.get(repository.id) ?? repository.assessment,
          })),
        },
        agentResourceOperations: { ...state.agentResourceOperations, refresh: { ...pending, status: "ready" } },
      };
    }
    case "agent_resource_inventory":
      return { ...state, agentResources: message.inventory };
    case "agent_resource_update_result": {
      const repositoryId = message.result.repositoryId;
      if (!repositoryId) return state;
      const pending = state.agentResourceOperations.updates[repositoryId];
      if (pending?.requestId !== message.requestId) return state;
      return {
        ...state,
        agentResources: message.inventory,
        agentResourceOperations: {
          ...state.agentResourceOperations,
          updates: {
            ...state.agentResourceOperations.updates,
            [repositoryId]: { ...pending, status: "ready", result: message.result },
          },
        },
      };
    }
    case "agent_resource_error": {
      const fail = <T extends { requestId: string }>(pending: T | null): (T & { status: "error"; message: string }) | null =>
        pending?.requestId === message.requestId ? { ...pending, status: "error", message: message.message } : null;
      const clonePath = fail(state.agentResourceOperations.clonePath);
      const preview = fail(state.agentResourceOperations.preview);
      const enrollment = fail(state.agentResourceOperations.enrollment);
      const refresh = fail(state.agentResourceOperations.refresh);
      const updateEntry = Object.entries(state.agentResourceOperations.updates).find(([, value]) => value.requestId === message.requestId);
      if (!clonePath && !preview && !enrollment && !refresh && !updateEntry) return state;
      const updates = updateEntry
        ? { ...state.agentResourceOperations.updates, [updateEntry[0]]: { ...updateEntry[1], status: "error" as const, message: message.message } }
        : state.agentResourceOperations.updates;
      return {
        ...state,
        agentResourceOperations: {
          ...state.agentResourceOperations,
          ...(clonePath ? { clonePath } : {}),
          ...(preview ? { preview } : {}),
          ...(enrollment ? { enrollment } : {}),
          ...(refresh ? { refresh } : {}),
          updates,
        },
      };
    }
    case "workspace_error":
      return { ...state, switching: false, errors: [...state.errors, message.message] };
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
      return {
        ...state,
        model: message.model,
        modelSupportsReasoning: message.reasoning,
        // Replace outright — a message with no set means "offer the full set".
        thinkingLevels: message.thinkingLevels,
      };
    case "credentials_changed": {
      // Onboarding landed: new models, new status, same session — so nothing else here
      // is touched (a snapshot would wipe live extension dialogs and widgets).
      const current = message.models.find((choice) => `${choice.provider}/${choice.id}` === message.model);
      return {
        ...state,
        models: message.models,
        model: message.model,
        modelSupportsReasoning: current?.reasoning ?? false,
        // The model may have changed here; the old model's accepted set no longer
        // applies. Fall back to the full set until a snapshot or model_changed says
        // otherwise — this message does not carry the new one.
        thinkingLevels: undefined,
        credentials: message.credentials,
        // errors stay: the "credentials stored, but allowedModels leaves no model"
        // case sends an error *and* this message — clearing them would eat it
      };
    }
    case "thinking_changed":
      return { ...state, thinkingLevel: message.level };
    case "work_plan_changed":
      return { ...state, workPlan: message.workPlan };
    case "workspace_outcome": {
      const pending = state.outcome;
      if (pending === null || pending.requestId !== message.requestId) return state;
      if (pending.sessionId !== state.sessionId || message.outcome.sessionId !== state.sessionId) return state;
      if (pending.workspaceRoot !== null && message.outcome.workspaceRoot !== pending.workspaceRoot) return state;
      return { ...state, outcome: { ...pending, status: "loaded", outcome: message.outcome } };
    }
    case "user":
      return {
        ...state,
        // Ours or another client's: either way the placeholder has served its
        // purpose, and leaving it would double the bubble.
        pendingPrompt: null,
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
        items: upsertTool(state.items, message.toolCallId, "tool", {
          output: message.text,
          // Only when this update carried one — a text-only update leaves the
          // last reported fraction in place.
          ...(typeof message.progress === "number" ? { progress: message.progress } : {}),
        }),
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
          structured: message.structured,
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
      return {
        ...state,
        errors: [...state.errors, message.message],
        // A prompt the server refused — a session change in flight, attachments it
        // would not take — is answered with an error and never with a `user`. The
        // placeholder must go with it, or it stands there as a message that was
        // never sent. Nothing is lost by clearing it on an unrelated error either:
        // an accepted prompt has already been replaced by its real bubble.
        pendingPrompt: null,
        // An apply is a modal wait on one answer, and the server answers a refused
        // one with exactly this. Attributing the first error that lands during the
        // wait keeps the menu open on the message that explains the refusal.
        settingsApply: state.settingsApply?.status === "applying" ? { status: "error", message: message.message } : state.settingsApply,
      };
    case "server_directory":
      if (state.serverBrowse?.requestId !== message.requestId) return state;
      return {
        ...state,
        serverBrowse: {
          status: "loaded",
          path: message.path,
          parent: message.parent,
          entries: message.entries,
          requestId: message.requestId,
        },
      };
    case "server_directory_error":
      if (state.serverBrowse?.requestId !== message.requestId) return state;
      return {
        ...state,
        /**
         * The directory that was on screen stays *whole* — path and entries both.
         * Keeping the entries while moving `path` to the one that failed was worse
         * than either: the picker then showed one directory's contents under
         * another's name, and "Use this directory" would have selected the path the
         * server had just refused to read. The refusal is in `error`, which is
         * where it names the path.
         */
        serverBrowse: {
          ...state.serverBrowse,
          status: "error",
          error: message.message,
        },
      };
    case "directory_listing":
      if (message.requestId.startsWith("dir:") && state.directoryRequests[message.path] !== message.requestId) {
        return state;
      }
      return {
        ...state,
        fileTree: { ...state.fileTree, [message.path]: message.entries },
        // A listing answered under a creation request id *is* the creation's answer.
        ...(message.requestId.startsWith("create:") ? { created: message.path, createError: null } : {}),
      };
    case "file_content": {
      // Ignore stale responses from a since-superseded read (user opened another file
      // meanwhile) — either the initial-open "loading" request, or a background refresh
      // ("loaded" the whole time, correlated by `refreshRequestId` instead).
      const file = state.openFile;
      const answersLoad = file?.status === "loading" && file.requestId === message.requestId;
      const answersRefresh = file?.status === "loaded" && file.refreshRequestId === message.requestId;
      if (!answersLoad && !answersRefresh) return state;
      return {
        ...state,
        openFile: {
          status: "loaded",
          path: message.path,
          content: message.content,
          size: message.size,
          mtimeMs: message.mtimeMs,
          ...(message.documentIssues === undefined ? {} : { documentIssues: message.documentIssues }),
        },
      };
    }
    case "file_written": {
      if (message.requestId.startsWith("create:")) {
        // A file that did not exist a moment ago: open it, empty, in edit mode.
        // Its size and mtime come with the answer, so the editor can save without
        // reading it back first.
        return {
          ...state,
          createError: null,
          created: message.path,
          openFile: {
            status: "loaded",
            path: message.path,
            content: "",
            size: message.size,
            mtimeMs: message.mtimeMs,
            justCreated: true,
          },
        };
      }
      const file = state.openFile;
      if (file?.status !== "loaded" || file.pendingSave?.requestId !== message.requestId) return state;
      return {
        ...state,
        openFile: { status: "loaded", path: file.path, content: file.pendingSave.content, size: message.size, mtimeMs: message.mtimeMs },
      };
    }
    case "file_operation_result": {
      if (state.fileOperation?.status !== "pending" || state.fileOperation.requestId !== message.requestId) return state;
      const previousPath = message.previousPath ?? message.path;
      const openFile =
        message.operation === "delete_file" && state.openFile?.path === message.path
          ? null
          : state.openFile?.path === previousPath
            ? { ...state.openFile, path: message.path }
            : state.openFile;
      const affectsHistory = state.gitFileHistory?.path === previousPath || state.gitFileHistory?.path === message.path;
      const affectsDiff = state.gitDiff?.path === previousPath || state.gitDiff?.path === message.path;
      return {
        ...state,
        openFile,
        gitFileHistory: affectsHistory ? null : state.gitFileHistory,
        gitFileDiff: affectsHistory ? null : state.gitFileDiff,
        gitDiff: affectsDiff ? null : state.gitDiff,
        fileOperation: {
          status: "succeeded",
          operation: message.operation,
          path: state.fileOperation.path,
          resultPath: message.path,
          requestId: message.requestId,
        },
      };
    }
    case "file_browser_error": {
      if (message.requestId.startsWith("dir:")) {
        if (state.directoryRequests[message.path] !== message.requestId) {
          return state;
        }
        return { ...state, fileTree: { ...state.fileTree, [message.path]: { error: message.message } } };
      }
      if (message.requestId.startsWith("create:")) {
        return { ...state, createError: { path: message.path, message: message.message } };
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
      if (message.requestId.startsWith("fileop:")) {
        if (state.fileOperation?.status !== "pending" || state.fileOperation.requestId !== message.requestId) return state;
        return {
          ...state,
          fileOperation: {
            status: "error",
            operation: state.fileOperation.operation,
            path: state.fileOperation.path,
            message: message.message,
            requestId: message.requestId,
          },
        };
      }
      if (state.openFile?.status === "loading" && state.openFile.requestId === message.requestId) {
        return { ...state, openFile: { status: "error", path: message.path, message: message.message } };
      }
      if (state.openFile?.status === "loaded" && state.openFile.refreshRequestId === message.requestId) {
        // A background refresh failed — e.g. the read raced a write mid-way through.
        // What is on screen is still the last good read; keep it rather than replace
        // a shown file with an error banner over something the user did not do.
        return { ...state, openFile: { ...state.openFile, refreshRequestId: undefined } };
      }
      return state;
    }
    case "file_search_results":
      // Ignore stale responses from a since-superseded (or since-cleared) search
      if (state.fileSearch?.requestId !== message.requestId) return state;
      return { ...state, fileSearch: { ...state.fileSearch, status: "loaded", results: message.results } };
    case "git_status": {
      const files: Record<string, GitFileState> = {};
      for (const file of message.files) files[file.path] = file.status;
      const previous = state.gitStatus;
      // A full sweep is authoritative: it is also how a repository that appeared or
      // vanished enters and leaves the list
      if (message.repo === undefined || previous === null) return { ...state, gitStatus: { repos: message.repos, files } };
      // A scoped answer speaks for one repository only — drop that repository's old
      // files, keep everyone else's, and refresh its branch in place
      const kept: Record<string, GitFileState> = {};
      for (const [path, status] of Object.entries(previous.files)) {
        if (repoForPath(previous.repos, path)?.repo !== message.repo) kept[path] = status;
      }
      const repos = previous.repos.map((repo) => message.repos.find((one) => one.repo === repo.repo) ?? repo);
      return { ...state, gitStatus: { repos, files: { ...kept, ...files } } };
    }
    case "git_repositories_changed":
      // A workspace that has lost its last repository keeps no status to show: the
      // badges and the branch chip would otherwise go on describing what is gone
      return {
        ...state,
        gitAvailable: message.available,
        gitUnavailable: message.available ? null : (message.unavailable ?? null),
        gitStatus: message.available ? state.gitStatus : null,
      };
    case "git_diff":
      return { ...state, gitDiff: { path: message.path, before: message.before, after: message.after } };
    case "git_log":
      return { ...state, gitLog: { repo: message.repo, entries: message.entries } };
    case "git_show":
      return { ...state, gitShow: { sha: message.sha, patch: message.patch, truncated: message.truncated } };
    case "git_file_log":
      // The pane may have closed, or moved to another file, since we asked
      if (state.gitFileHistory?.requestId !== message.requestId) return state;
      return { ...state, gitFileHistory: { ...state.gitFileHistory, status: "loaded", entries: message.entries } };
    case "git_file_diff":
      // Drop a reply the selection has already moved past
      if (state.gitFileDiff === null || !samePair(state.gitFileDiff, message)) return state;
      return {
        ...state,
        gitFileDiff: { ...state.gitFileDiff, status: "loaded", beforeText: message.beforeText, afterText: message.afterText },
      };
    case "git_error":
      // Diff failures belong in the viewer's diff pane (the error banner renders
      // under the full-pane overlay where nobody can see it)
      if (message.requestId.startsWith("gitdiff:")) {
        return { ...state, gitDiff: state.openFile ? { path: state.openFile.path, error: message.message } : null };
      }
      // Same reasoning for the history pane: its failures belong inside it
      if (message.requestId === state.gitFileHistory?.requestId) {
        return { ...state, gitFileHistory: { ...state.gitFileHistory, status: "error", error: message.message } };
      }
      if (message.requestId === state.gitFileDiff?.requestId) {
        return { ...state, gitFileDiff: { ...state.gitFileDiff, status: "error", error: message.message } };
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
function wsUrlFor(serverUrl: string, token: string | null, workspace?: string): string {
  const base = serverUrl
    ? `${serverUrl.replace(/^http/, "ws")}/ws`
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  // Browsers cannot set headers on WebSockets — the token rides a query parameter,
  // and so does the project an embedding host binds its widget to. A root the
  // server does not have open falls back to the default there rather than
  // failing: a project closed server-side should leave a working widget, not a
  // dead socket.
  const query = new URLSearchParams();
  if (token) query.set("token", token);
  if (workspace) query.set("workspace", workspace);
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}

/**
 * How long an upload may go unanswered before the composer gives up on it.
 * Generous: a 25 MB file over a slow link is a real case, and a false timeout
 * costs the user the attachment.
 */
const UPLOAD_TIMEOUT_MS = 120_000;

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
export function useAgent(serverUrl = "", explicitToken?: string, embedded = false, workspaceRoot?: string) {
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
  // An upload is the one file-browser request whose caller needs an answer rather
  // than a state update: the composer cannot attach a path it has not been told.
  // Waiters live outside the reducer for that reason, keyed by the same requestId
  // correlation every other file-browser request uses.
  const uploadWaitersRef = useRef(new Map<string, { resolve: (path: string) => void; reject: (error: UploadError) => void }>());
  const writableRootRef = useRef(state.writableRoot);
  useEffect(() => {
    writableRootRef.current = state.writableRoot;
  }, [state.writableRoot]);
  // Set once the browser root has been asked for at all (the sidebar's first
  // open, or a manual refresh). From then on the connection-driven effect below
  // keeps the root listed across reconnects and snapshots — see its comment.
  const rootListingRequestedRef = useRef(false);
  const terminalListenersRef = useRef(new Map<string, TerminalListeners>());
  const outcomeIdentityRef = useRef({ workspaceRoot: state.workspace?.root ?? null, sessionId: state.sessionId });
  useEffect(() => {
    outcomeIdentityRef.current = { workspaceRoot: state.workspace?.root ?? null, sessionId: state.sessionId };
  }, [state.workspace?.root, state.sessionId]);

  const sendMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const outcomeActiveRef = useRef(false);
  const outcomeInFlightRef = useRef<string | null>(null);
  const outcomeQueuedRef = useRef(false);
  const requestOutcomeRef = useRef<() => void>(() => {});
  const requestOutcome = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (outcomeInFlightRef.current !== null) {
      outcomeQueuedRef.current = true;
      return;
    }
    const requestId = `outcome:${crypto.randomUUID()}`;
    outcomeInFlightRef.current = requestId;
    const identity = outcomeIdentityRef.current;
    dispatch({ type: "outcome_started", requestId, ...identity });
    sendMessage({ type: "get_outcome", requestId });
  }, [sendMessage]);
  requestOutcomeRef.current = requestOutcome;
  const invalidateOutcome = useCallback(() => {
    if (outcomeActiveRef.current) requestOutcomeRef.current();
  }, []);
  const setOutcomeActive = useCallback((active: boolean) => {
    outcomeActiveRef.current = active;
    if (active) requestOutcome();
    else outcomeQueuedRef.current = false;
  }, [requestOutcome]);

  const requestDirectory = useCallback(
    (path: string, preserveEntries = false) => {
      if (path === "") rootListingRequestedRef.current = true;
      const requestId = `dir:${crypto.randomUUID()}`;
      dispatch({ type: "dir_list_started", path, requestId, preserveEntries });
      sendMessage({ type: "list_directory", path, requestId });
    },
    [sendMessage],
  );

  // Git status refetches are event-driven (connect, file_changed, agent_end) and can
  // burst — coalesce to one in flight with a single trailing rerun. Coalescing is per
  // scope: a workspace holding thirty repositories would otherwise let one project's
  // refresh swallow another's, and they are answers to different questions.
  const gitAvailableRef = useRef(false);
  /** The repository list as of the last status, for attributing a changed path. */
  const gitReposRef = useRef<GitRepoStatus[]>([]);
  useEffect(() => {
    gitReposRef.current = state.gitStatus?.repos ?? [];
  }, [state.gitStatus]);
  const gitStatusInFlight = useRef(new Set<string>());
  const gitStatusQueued = useRef(new Set<string>());
  /** requestId → scope, so an error (which carries no repo) settles the right one. */
  const gitStatusScopes = useRef(new Map<string, string>());
  const refreshGitStatus = useCallback(
    (repo?: string) => {
      if (!gitAvailableRef.current) return;
      const scope = repo ?? "";
      if (gitStatusInFlight.current.has(scope)) {
        gitStatusQueued.current.add(scope);
        return;
      }
      gitStatusInFlight.current.add(scope);
      const requestId = `git:${crypto.randomUUID()}`;
      gitStatusScopes.current.set(requestId, scope);
      sendMessage({ type: "git_status", ...(repo === undefined ? {} : { repo }), requestId });
    },
    [sendMessage],
  );
  const gitStatusSettled = useCallback(
    (requestId: string) => {
      const scope = gitStatusScopes.current.get(requestId) ?? "";
      gitStatusScopes.current.delete(requestId);
      gitStatusInFlight.current.delete(scope);
      if (gitStatusQueued.current.delete(scope)) refreshGitStatus(scope === "" ? undefined : scope);
    },
    [refreshGitStatus],
  );

  /**
   * Re-list a directory — but only one the tree is actually holding.
   *
   * The server watches every directory that was ever listed, including ones the
   * user has since collapsed. A directory nothing displays has nothing to
   * refresh, so this is where that is decided rather than on the wire.
   */
  const relistDirectory = useCallback(
    (path: string) => {
      const held = fileTreeRef.current[path];
      if (held === undefined) return;
      // Only announce loading when there is nothing to keep showing. Blanking a
      // directory that already has entries unmounts its rows, and a row's
      // expanded state is the row's own — so re-listing the root would silently
      // collapse every branch under it and throw away where the user was. The
      // old entries stay on screen until the new ones land; the listing replaces
      // them wholesale either way.
      requestDirectory(path, true);
    },
    [requestDirectory],
  );

  /**
   * Re-list everything the tree is holding, in one action.
   *
   * The manual counterpart to directory watching, and deliberately not
   * conditional on it: `fs.watch` is best-effort by contract, and a filesystem
   * that emits no events — a network mount, a spent inotify budget, watching
   * turned off — is indistinguishable from a workspace that did not change.
   *
   * The browser root is re-listed unconditionally, not through `relistDirectory`:
   * a tree that came up empty — a reconnect delivered a fresh `hello`, which
   * clears `fileTree`, before the sidebar could re-request the root — holds no
   * keys to iterate, and this button is exactly where someone reaches for a way
   * out of an empty tree. Everything else still goes through `relistDirectory`,
   * which skips directories nothing is showing.
   */
  const refreshFileTree = useCallback(() => {
    requestDirectory("", true);
    for (const path of Object.keys(fileTreeRef.current)) {
      if (path !== "") relistDirectory(path);
    }
  }, [relistDirectory, requestDirectory]);

  /**
   * Keep the file-browser root listed for as long as a connection needs it.
   *
   * The root used to be requested once, from the sidebar's mount effect. But
   * every WebSocket (re)connect answers with a `hello`, and `applySnapshot`
   * clears `fileTree` — so a drop while the sidebar was open left the tree
   * permanently empty, and the refresh button (which only re-lists what the tree
   * already holds) could not bring it back. A browser reload was the only way
   * out.
   *
   * Once the root has been asked for even once (`rootListingRequestedRef`), this
   * re-requests it on every (re)connect that comes back without it — first
   * connect, reconnect, `hello`, `workspace_switched`, `update_config_ack`, all
   * in one place. Kept lazy: a session whose Files panel is never opened still
   * lists nothing. `dir_list_started` then sets the entry to `"loading"`, so this
   * fires at most once per gap.
   */
  useEffect(() => {
    if (!state.connected || !rootListingRequestedRef.current) return;
    if (fileTreeRef.current[""] !== undefined) return;
    requestDirectory("");
  }, [state.connected, state.fileTree, requestDirectory]);

  /**
   * The same gap, for an Outcome drawer left open across a dropped connection:
   * the socket that owed it an answer is gone, the close handler cleared what was
   * in flight, and the snapshot that follows the reconnect clears the result. With
   * nobody asking again the panel sits on "Loading Outcome…" for as long as it
   * stays open. Asking on every (re)connect also refreshes what the gap may have
   * changed, which is the truthful thing to render anyway.
   */
  useEffect(() => {
    if (!state.connected || !outcomeActiveRef.current) return;
    if (outcomeInFlightRef.current !== null) return;
    requestOutcomeRef.current();
  }, [state.connected]);

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
        if (!cancelled) dispatch(branding ? { type: "branding_loaded", branding } : { type: "branding_settled" });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "branding_settled" });
      });
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authNonce]);

  useEffect(() => {
    let retryTimer: number | undefined;
    let disposed = false;

    function connect() {
      const socket = new WebSocket(wsUrlFor(serverUrl, tokenRef.current, workspaceRoot));
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
        if (message.type === "terminal_data") {
          const listeners = terminalListenersRef.current.get(message.terminalId);
          if (listeners) {
            for (const listener of listeners.onData) listener(message.data);
          }
          return;
        }
        if (message.type === "terminal_cwd") {
          const listeners = terminalListenersRef.current.get(message.terminalId);
          if (listeners) {
            for (const listener of listeners.onCwd) listener(message.cwd);
          }
          return;
        }
        if (message.type === "terminal_exit") {
          const listeners = terminalListenersRef.current.get(message.terminalId);
          if (listeners) {
            for (const listener of listeners.onExit) listener(message.exitCode);
          }
          return;
        }
        if (message.type === "terminal_error") {
          const listeners = terminalListenersRef.current.get(message.terminalId);
          if (listeners) {
            for (const listener of listeners.onError) listener(message.message);
          }
          return;
        }
        if (message.type === "file_uploaded") {
          const waiter = uploadWaitersRef.current.get(message.requestId);
          if (waiter) {
            uploadWaitersRef.current.delete(message.requestId);
            waiter.resolve(message.path);
          }
          return;
        }
        if (message.type === "file_browser_error" && uploadWaitersRef.current.has(message.requestId)) {
          const waiter = uploadWaitersRef.current.get(message.requestId)!;
          uploadWaitersRef.current.delete(message.requestId);
          waiter.reject(new UploadError(message.message, message.reason));
          return;
        }
        if (message.type === "file_changed") {
          invalidateOutcome();
          relistDirectory(parentDirectory(message.path));
          const openFile = openFileRef.current;
          if (openFile?.status === "loaded" && openFile.path === message.path) {
            const requestId = `file:${crypto.randomUUID()}`;
            dispatch({ type: "file_read_started", path: message.path, requestId, preserveContent: true });
            sendMessage({ type: "read_file", path: message.path, requestId });
          }
          // An open "± diff" pane for this file would silently go stale otherwise
          if (gitDiffPathRef.current === message.path) {
            sendMessage({ type: "git_diff", path: message.path, requestId: `gitdiff:${crypto.randomUUID()}` });
          }
          // One file moved: only its repository has anything new to say. Re-reading
          // thirty of them to learn that is thirty processes for one fact.
          refreshGitStatus(repoForPath(gitReposRef.current, message.path)?.repo);
          return;
        }
        if (message.type === "directory_changed") {
          invalidateOutcome();
          relistDirectory(message.path);
          // The watcher reports the directory, not the entry, so anything living
          // in it may be what moved. Re-reading the open file is one read and
          // cannot lose work: the editor's draft is its own state, and a file
          // that changed underneath an edit already surfaces as a save conflict.
          const openFile = openFileRef.current;
          if (openFile !== null && parentDirectory(openFile.path) === message.path) {
            if (isImageFile(openFile.path) || isPdfFile(openFile.path)) {
              dispatch({ type: "raw_preview_changed", path: openFile.path });
            } else if (openFile.status === "loaded") {
              const requestId = `file:${crypto.randomUUID()}`;
              dispatch({ type: "file_read_started", path: openFile.path, requestId, preserveContent: true });
              sendMessage({ type: "read_file", path: openFile.path, requestId });
            }
          }
          const gitDiffPath = gitDiffPathRef.current;
          if (gitDiffPath !== null && parentDirectory(gitDiffPath) === message.path) {
            sendMessage({ type: "git_diff", path: gitDiffPath, requestId: `gitdiff:${crypto.randomUUID()}` });
          }
          refreshGitStatus();
          return;
        }
        if (message.type === "hello" || message.type === "session_replaced") {
          gitAvailableRef.current = message.gitAvailable === true;
          if (message.type === "hello") refreshGitStatus();
        }
        // Bash commands can change git state without any file_changed broadcast
        if (message.type === "agent_end") {
          refreshGitStatus();
          invalidateOutcome();
        }
        if (message.type === "git_repositories_changed") {
          invalidateOutcome();
          // The gate this ref holds is why the message exists: a client told at
          // connect that there was no repository here would otherwise never ask again
          gitAvailableRef.current = message.available;
          if (message.available) refreshGitStatus();
        }
        if (message.type === "git_status" || (message.type === "git_error" && message.requestId.startsWith("git:"))) {
          gitStatusSettled(message.requestId);
        }
        if (message.type === "work_plan_changed") invalidateOutcome();
        if (message.type === "workspace_outcome" && outcomeInFlightRef.current === message.requestId) {
          outcomeInFlightRef.current = null;
          if (outcomeQueuedRef.current) {
            outcomeQueuedRef.current = false;
            queueMicrotask(() => requestOutcomeRef.current());
          }
        }
        if (message.type === "file_operation_result") {
          // `file_changed` notifications follow the acknowledgement immediately.
          // Keep the event-handler ref in step before React's next effect so an
          // old-path notification cannot reread a file that was renamed/deleted.
          const previousPath = message.previousPath ?? message.path;
          const openFile = openFileRef.current;
          if (message.operation === "delete_file" && openFile?.path === message.path) {
            openFileRef.current = null;
          } else if (openFile?.path === previousPath) {
            openFileRef.current = { ...openFile, path: message.path };
          }
        }
        dispatch({ type: "server", message });
        // A replaced session may have a different sandbox root — reload the root listing
        if (message.type === "session_replaced") {
          requestDirectory("");
        }
      };
      socket.onclose = (event) => {
        // Superseded sockets must not flip the indicator (StrictMode remount, reconnect races)
        if (socketRef.current !== socket) return;
        // An in-flight git_status will never be answered on this socket — clear the
        // coalescing flags or the branch chip/badges freeze until a page reload
        gitStatusInFlight.current.clear();
        gitStatusQueued.current.clear();
        gitStatusScopes.current.clear();
        outcomeInFlightRef.current = null;
        outcomeQueuedRef.current = false;
        // Same reasoning, but a stuck upload is worse than a stale badge: the
        // composer blocks submission while one is in flight, so an unanswered
        // promise would wedge the whole editor rather than one indicator.
        for (const waiter of uploadWaitersRef.current.values()) {
          waiter.reject(new UploadError("The connection dropped before the upload finished"));
        }
        uploadWaitersRef.current.clear();
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
  }, [sendMessage, serverUrl, refreshGitStatus, gitStatusSettled, relistDirectory, requestDirectory, invalidateOutcome, authNonce, workspaceRoot]);

  return {
    state,
    /** Keep the server-derived Outcome fresh only while its drawer is visible. */
    setOutcomeActive,
    refreshOutcome: requestOutcome,
    /** Current auth token (null when none) — for building /files/raw image URLs. */
    authToken: tokenRef.current,
    /**
     * Bind this client to another open project.
     *
     * The conversation fades rather than emptying while the answer is in flight —
     * a blank pane makes a switch read as a page reload. The open file, scroll
     * position and diff pane are deliberately NOT preserved; the composer draft is,
     * because losing typed text destroys work rather than resetting a view.
     */
    switchWorkspace: (root: string) => {
      if (root === state.workspace?.root) return;
      dispatch({ type: "workspace_switching" });
      sendMessage({ type: "switch_workspace", root });
    },
    /** Open a directory as a project, from the server-side directory picker. */
    openProject: (root: string) => {
      dispatch({ type: "workspace_switching" });
      sendMessage({ type: "open_project", root });
    },
    /** Close an open project. Refused server-side while its agent is streaming. */
    closeProject: (root: string) => sendMessage({ type: "close_project", root }),
    /** TokenGate submission: persist the token and reconnect with it. */
    submitToken: (token: string) => {
      storeToken(token);
      tokenRef.current = token;
      dispatch({ type: "auth_retrying" });
      setAuthNonce((n) => n + 1);
    },
    prompt: (text: string, images?: WireImage[]) => {
      // Shown immediately, before the server has accepted anything: the round
      // trip is long enough at the start of a conversation to read as a failure.
      dispatch({ type: "prompt_sent", text, ...(images?.length ? { images } : {}) });
      sendMessage({ type: "prompt", text, ...(images?.length ? { images } : {}) });
    },
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
    listDirectory: (path: string) => requestDirectory(path),
    /** Re-list every directory the tree is holding (the tree's manual refresh). */
    refreshFileTree,
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
    /**
     * Create an empty file and open it. Deliberately not writeFile: `write_file`
     * refuses a path that does not exist, and that refusal is the guard against
     * clobbering a file that moved.
     */
    createFile: (path: string) => {
      dispatch({ type: "file_create_started" });
      sendMessage({ type: "create_file", path, requestId: `create:${crypto.randomUUID()}` });
    },
    /**
     * Copy a file supplied from outside the workspace into the uploads directory,
     * resolving with the path the server wrote. A read-only sandbox is refused
     * here rather than over the wire: the client already knows there is no
     * writable zone, and a round trip would only delay the same answer.
     */
    uploadFile: (name: string, contentBase64: string): Promise<string> => {
      const writableRoot = writableRootRef.current;
      if (writableRoot === null) {
        return Promise.reject(new UploadError("the workspace is read-only", "denied"));
      }
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new UploadError("not connected to the server"));
      }
      const destinationDirectory = writableRoot ? `${writableRoot}/${UPLOADS_DIRECTORY}` : UPLOADS_DIRECTORY;
      const requestId = `upload:${crypto.randomUUID()}`;
      return new Promise<string>((resolve, reject) => {
        // A dropped socket already rejects every waiter. This covers the other
        // shape: the socket stays up and the answer never comes. Without it the
        // promise never settles, the pending chip never clears, and submission
        // stays disabled — the composer is wedged until the page is reloaded,
        // which is a worse failure than the one the guard exists to prevent.
        const timer = window.setTimeout(() => {
          if (!uploadWaitersRef.current.delete(requestId)) return;
          reject(new UploadError("the upload timed out"));
        }, UPLOAD_TIMEOUT_MS);
        const settle = <T,>(run: (value: T) => void) => (value: T) => {
          clearTimeout(timer);
          run(value);
        };
        uploadWaitersRef.current.set(requestId, { resolve: settle(resolve), reject: settle(reject) });
        sendMessage({ type: "upload_file", destinationDirectory, name, contentBase64, requestId });
      });
    },
    /** Create one directory; answered with its (empty) listing. */
    createDirectory: (path: string) => {
      dispatch({ type: "file_create_started" });
      sendMessage({ type: "create_directory", path, requestId: `create:${crypto.randomUUID()}` });
    },
    openNative: (path: string) => {
      const requestId = `fileop:${crypto.randomUUID()}`;
      dispatch({ type: "file_operation_started", operation: "open_native", path, requestId });
      sendMessage({ type: "open_native", path, requestId });
    },
    renameFile: (path: string, name: string) => {
      const requestId = `fileop:${crypto.randomUUID()}`;
      dispatch({ type: "file_operation_started", operation: "rename_file", path, requestId });
      sendMessage({ type: "rename_file", path, name, requestId });
    },
    deleteFile: (path: string) => {
      const requestId = `fileop:${crypto.randomUUID()}`;
      dispatch({ type: "file_operation_started", operation: "delete_file", path, requestId });
      sendMessage({ type: "delete_file", path, requestId });
    },
    moveFile: (path: string, destinationDirectory: string) => {
      const requestId = `fileop:${crypto.randomUUID()}`;
      dispatch({ type: "file_operation_started", operation: "move_file", path, requestId });
      sendMessage({ type: "move_file", path, destinationDirectory, requestId });
    },
    copyFile: (path: string, destinationDirectory: string) => {
      const requestId = `fileop:${crypto.randomUUID()}`;
      dispatch({ type: "file_operation_started", operation: "copy_file", path, requestId });
      sendMessage({ type: "copy_file", path, destinationDirectory, requestId });
    },
    /** Search file/directory names for the composer's `@` mention autocomplete. */
    searchFiles: (query: string) => {
      const requestId = `search:${crypto.randomUUID()}`;
      dispatch({ type: "file_search_started", query, requestId });
      sendMessage({ type: "search_files", query, requestId });
    },
    clearFileSearch: () => dispatch({ type: "file_search_cleared" }),
    /** Manual git status refresh (event-driven refreshes are automatic). */
    fetchGitStatus: () => refreshGitStatus(),
    /** Worktree-vs-HEAD contents for one file (answers land in state.gitDiff). */
    fetchGitDiff: (path: string) => {
      const requestId = `gitdiff:${crypto.randomUUID()}`;
      dispatch({ type: "git_diff_started", path, requestId });
      sendMessage({ type: "git_diff", path, requestId });
    },
    clearGitDiff: () => dispatch({ type: "git_diff_cleared" }),
    fetchGitLog: (repo: string, limit?: number) =>
      sendMessage({ type: "git_log", repo, ...(limit ? { limit } : {}), requestId: `gitlog:${crypto.randomUUID()}` }),
    fetchGitShow: (repo: string, sha: string) => sendMessage({ type: "git_show", repo, sha, requestId: `gitshow:${crypto.randomUUID()}` }),
    clearGitShow: () => dispatch({ type: "git_show_cleared" }),
    /** Open the history pane for one file (answers land in state.gitFileHistory). */
    fetchGitFileHistory: (path: string, limit?: number) => {
      const requestId = `gitfilelog:${crypto.randomUUID()}`;
      dispatch({ type: "git_file_history_started", path, requestId });
      sendMessage({ type: "git_file_log", path, ...(limit ? { limit } : {}), requestId });
    },
    closeGitFileHistory: () => dispatch({ type: "git_file_history_closed" }),
    /** Contents of one file at two revisions (answers land in state.gitFileDiff). */
    fetchGitFileDiff: (base: GitRevision, target: GitRevision) => {
      const requestId = `gitfilediff:${crypto.randomUUID()}`;
      dispatch({ type: "git_file_diff_started", base, target, requestId });
      sendMessage({ type: "git_file_diff", base, target, requestId });
    },
    clearGitFileDiff: () => dispatch({ type: "git_file_diff_cleared" }),
    /** Onboarding: store an API key for a provider the server already knows. */
    setCredential: (provider: string, apiKey: string) => sendMessage({ type: "set_credential", provider, apiKey }),
    /** Onboarding: declare an OpenAI-compatible endpoint (corporate gateway, vLLM, Ollama…). */
    declareProvider: (declaration: { provider: string; baseUrl: string; apiKey: string; models: string[]; compat?: ProviderCompat }) =>
      sendMessage({ type: "declare_provider", ...declaration }),
    /** List the directories under one server-side path, for a Settings path field. */
    browseServerDirectory: (path: string) => {
      const requestId = `serverdir:${crypto.randomUUID()}`;
      dispatch({ type: "server_browse_started", path, requestId });
      sendMessage({ type: "browse_server_directory", path, requestId });
    },
    closeServerBrowser: () => dispatch({ type: "server_browse_closed" }),
    suggestAgentResourceClonePath: (repositoryUrl: string) => {
      const requestId = `resource-clone-path:${crypto.randomUUID()}`;
      dispatch({ type: "resource_clone_path_started", requestId });
      sendMessage({ type: "suggest_agent_resource_clone_path", repositoryUrl, requestId });
    },
    cloneAgentResourceRepository: (repositoryUrl: string, destinationPath: string) => {
      const requestId = `resource-preview:${crypto.randomUUID()}`;
      dispatch({ type: "resource_preview_started", requestId });
      sendMessage({ type: "clone_agent_resource_repository", repositoryUrl, destinationPath, requestId });
    },
    enrollAgentResourceRepository: (previewToken: string, skillRoots: string[], extensionRoots: string[]) => {
      const requestId = `resource-enroll:${crypto.randomUUID()}`;
      dispatch({ type: "resource_enrollment_started", requestId });
      sendMessage({ type: "enroll_agent_resource_repository", previewToken, skillRoots, extensionRoots, requestId });
    },
    refreshAgentResourceRepositories: (repositoryId?: string) => {
      const requestId = `resource-refresh:${crypto.randomUUID()}`;
      dispatch({ type: "resource_refresh_started", requestId, ...(repositoryId ? { repositoryId } : {}) });
      sendMessage({ type: "refresh_agent_resource_repositories", ...(repositoryId ? { repositoryId } : {}), requestId });
    },
    updateAgentResourceRepository: (
      repositoryId: string,
      assessmentToken: string,
      localRevision: string,
      upstreamRevision: string,
      allowExecutableChanges = false,
    ) => {
      const requestId = `resource-update:${crypto.randomUUID()}`;
      dispatch({ type: "resource_update_started", requestId, repositoryId });
      sendMessage({
        type: "update_agent_resource_repository",
        repositoryId,
        assessmentToken,
        localRevision,
        upstreamRevision,
        ...(allowExecutableChanges ? { allowExecutableChanges: true } : {}),
        requestId,
      });
    },
    /**
     * Apply the editable runtime settings. The server persists them before it
     * acknowledges, so `settingsApply` clears only once they are on disk.
     */
    updateConfig: (update: {
      sandbox?: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string };
      userSkillPaths?: string[];
      userExtensionPaths?: string[];
    }) => {
      dispatch({ type: "settings_apply_started" });
      sendMessage({ type: "update_config", ...update });
    },
    openTerminal: (terminalId: string, cwd?: string, cols?: number, rows?: number) =>
      sendMessage({ type: "terminal_open", terminalId, cwd, cols, rows }),
    sendTerminalInput: (terminalId: string, data: string) =>
      sendMessage({ type: "terminal_input", terminalId, data }),
    getTerminalCwd: (terminalId: string) =>
      sendMessage({ type: "terminal_get_cwd", terminalId }),
    resizeTerminal: (terminalId: string, cols: number, rows: number) =>
      sendMessage({ type: "terminal_resize", terminalId, cols, rows }),
    closeTerminal: (terminalId: string) => {
      sendMessage({ type: "terminal_close", terminalId });
      terminalListenersRef.current.delete(terminalId);
    },
    subscribeTerminal: (
      terminalId: string,
      callbacks: {
        onData?: TerminalDataListener;
        onCwd?: TerminalCwdListener;
        onExit?: TerminalExitListener;
        onError?: TerminalErrorListener;
      },
    ) => {
      let entry = terminalListenersRef.current.get(terminalId);
      if (!entry) {
        entry = { onData: new Set(), onCwd: new Set(), onExit: new Set(), onError: new Set() };
        terminalListenersRef.current.set(terminalId, entry);
      }
      if (callbacks.onData) entry.onData.add(callbacks.onData);
      if (callbacks.onCwd) entry.onCwd.add(callbacks.onCwd);
      if (callbacks.onExit) entry.onExit.add(callbacks.onExit);
      if (callbacks.onError) entry.onError.add(callbacks.onError);
      return () => {
        if (callbacks.onData) entry?.onData.delete(callbacks.onData);
        if (callbacks.onCwd) entry?.onCwd.delete(callbacks.onCwd);
        if (callbacks.onExit) entry?.onExit.delete(callbacks.onExit);
        if (callbacks.onError) entry?.onError.delete(callbacks.onError);
      };
    },
  };
}
