/**
 * Wire protocol between server and web UI — single source of truth.
 * Lean events: SDK events are transformed server-side to keep frames small
 * (raw message_update events carry the full partial message on every delta).
 */

/** Image attachment on the wire (raw base64, no data: prefix). */
export type {
  OutcomeAvailability,
  OutcomeEntry,
  OutcomeSection,
  OutcomeStatus,
  OutcomeTarget,
  OutcomeVerification,
  WorkspaceOutcome,
  WorkPlanProgress,
} from "./outcome.ts";
export { outcomeVerification, workPlanProgress } from "./outcome.ts";
import type { WorkspaceOutcome } from "./outcome.ts";

export interface WireImage {
  data: string;
  mimeType: string;
}

/** Chat item as displayed by the UI (also used to serialize history). */
export type ChatItem =
  | {
      kind: "user";
      text: string;
      images?: WireImage[];
      /** Session entry id — lets the UI re-send an edited version as a new branch. */
      entryId?: string;
    }
  | {
      kind: "assistant";
      blocks: AssistantBlock[];
      errorMessage?: string;
      /** True for the in-flight message included in `hello` during streaming. */
      streaming?: boolean;
      /**
       * What this turn cost. Absent while streaming — the provider reports it with
       * the finished message — and absent on replayed history the provider never
       * priced.
       */
      usage?: TurnUsage;
    }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      args: unknown;
      output: string;
      isError?: boolean;
      running?: boolean;
      /**
       * Completion fraction in `0..1` the running tool last reported, or absent
       * when it reported none. Shown as a determinate bar only while `running`;
       * never rebuilt from history, so a replayed tool call has none.
       */
      progress?: number;
      /** HTML from pi's renderResult (re-invoked server-side). */
      outputHtml?: string;
      /** Collapsed preview when it differs from outputHtml. */
      outputHtmlCollapsed?: string;
      /** HTML from pi's renderCall (re-invoked server-side). */
      callHtml?: string;
      /**
       * A structured-exchange document the tool declared for itself, exactly as it
       * arrived. Carried separately from `output` because it is not display text
       * and never reaches the model — the SDK's own `details` channel is defined
       * as metadata the LLM does not see.
       *
       * Kept as the raw serialized form rather than a parsed object: an approved
       * proposal has to be handed on exactly as validated, and a value that has been
       * through a parse and a re-serialise is no longer the document that was
       * validated and shown.
       */
      structured?: string;
    }
  | {
      /** Extension-defined message (pi.sendMessage() with a customType) — see extensions.md#message-and-entry-rendering. */
      kind: "custom";
      customType: string;
      text: string;
      /** Extension-specific structured data, shown only when expanded (avoid a wall of JSON by default). */
      details?: unknown;
      /** HTML from pi's MessageRenderer (re-invoked server-side). */
      contentHtml?: string;
      /** Collapsed preview when it differs from contentHtml. */
      contentHtmlCollapsed?: string;
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
  /** Excerpt of the transcript around the match — search results only. */
  snippet?: string;
}

/**
 * Shortest session-search query worth sending: matching scans every saved
 * transcript server-side, and one letter matches everything anyway. The server
 * enforces it too — this is here so the client doesn't bother asking.
 */
export const MIN_SESSION_QUERY_LENGTH = 2;

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * The thinking levels a model accepts, as a runtime reports them, sanitised for
 * the wire: only names this build knows, in the canonical `THINKING_LEVELS`
 * order, with `off` always a stop — thinking can be turned off whatever the
 * model's effort tiers are. An input that names nothing recognisable (an empty
 * list, or a runtime that could not answer) yields `undefined`, which a client
 * reads as "offer the full set".
 */
export function normalizeThinkingLevels(levels: unknown): ThinkingLevel[] | undefined {
  if (!Array.isArray(levels)) return undefined;
  const known = new Set(
    levels.filter((l): l is ThinkingLevel => typeof l === "string" && (THINKING_LEVELS as readonly string[]).includes(l)),
  );
  if (known.size === 0) return undefined;
  return THINKING_LEVELS.filter((l) => l === "off" || known.has(l));
}

/**
 * The level to keep when a model does not accept the current one — after a model
 * change, where the level the session carries may not be on the new model's scale.
 *
 * It steps *down* in effort first: a session on `high` moving to a model that tops
 * out at `low` should think as hard as that model can, and a silent step up would
 * bill the user for effort nobody asked for. Only when nothing below is on offer
 * does it step up, and `off` is always the floor.
 */
export function clampThinkingLevel(level: ThinkingLevel, levels: readonly ThinkingLevel[]): ThinkingLevel {
  if (levels.includes(level)) return level;
  const index = THINKING_LEVELS.indexOf(level);
  for (let i = index - 1; i >= 0; i--) {
    if (levels.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  for (let i = index + 1; i < THINKING_LEVELS.length; i++) {
    if (levels.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  return levels[0] ?? "off";
}

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

/**
 * What one assistant turn consumed and cost, as the provider billed it.
 *
 * Distinct from ContextUsage below, which is a *level* — how full the window is
 * right now. This is a *flow*: what this turn added. Both are needed, and only
 * this one accumulates into a session total.
 *
 * Cost is the provider's own figure in USD, not a local estimate. It is absent
 * when the provider does not report one, which is why every consumer has to
 * treat an unpriced turn as unknown rather than as zero.
 */
export interface TurnUsage {
  /** Fresh input tokens — a cache miss, the expensive kind. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Subset of `output`, when the provider breaks reasoning out. */
  reasoning?: number;
  totalTokens: number;
  /** USD, provider-reported. Absent when the provider prices nothing. */
  cost?: number;
}

/** Context window usage, for the compaction button. */
export interface ContextUsage {
  /** Estimated context tokens, or null if unknown (e.g. right after compaction). */
  tokens: number | null;
  contextWindow: number;
  /** Usage as a percentage of the context window, or null if tokens is unknown. */
  percent: number | null;
}

export type {
  WorkPlan,
  WorkPlanEvidence,
  WorkPlanEvidenceResult,
  WorkPlanResource,
  WorkPlanStatus,
  WorkPlanTask,
} from "./workPlan.ts";
import type { WorkPlan } from "./workPlan.ts";

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

/**
 * One directory on the server host, for the settings path picker. Carries its
 * absolute path as well as its name: the picker selects a server-side path, and
 * rebuilding one by joining names client-side would guess at the separator.
 */
export interface ServerDirEntry {
  name: string;
  path: string;
}

/** Failure kinds of file-browser operations; carried on file_browser_error. */
export type FileBrowserErrorReason =
  | "outside-root"
  | "not-found"
  | "too-large"
  | "binary"
  | "denied"
  | "conflict"
  | "launcher-failed"
  /** The request itself is malformed — a name that is a path, an undecodable body. */
  | "invalid";

/** Mutating/opening operation acknowledged by file_operation_result. */
export type FileOperation = "open_native" | "rename_file" | "delete_file" | "move_file" | "copy_file";

/**
 * Why git is unavailable, when it is.
 *
 * Three states, because they call for three different things from the reader: a
 * directory that holds no repository is ordinary and needs nothing, while an
 * executable that cannot be run and a repository git refuses are both setup faults
 * somebody can fix. `message` carries git's own words where there are any — "detected
 * dubious ownership in repository at …" names the directory AND the remedy, and
 * paraphrasing it would lose both.
 */
export type GitUnavailable =
  | { reason: "no-executable"; message: string }
  | { reason: "no-repository" }
  | { reason: "refused"; message: string };

/** Working-tree state of one file, scoped to the browser root. */
export type GitFileState = "modified" | "added" | "deleted" | "untracked" | "conflicted";

export interface GitFileStatus {
  /** Path relative to the browser root (posix separators). */
  path: string;
  status: GitFileState;
}

/**
 * Branch state of one repository serving the workspace.
 *
 * A workspace holds a set of repositories - a directory of independently
 * versioned projects has one per child - so there is no single branch to report.
 * The client attributes a file to a repository by longest matching `repo`, the
 * same rule the server resolves with.
 */
export interface GitRepoStatus {
  /** Path from the browser root to the repository (posix); "" for the root itself or an ancestor. */
  repo: string;
  branch: string;
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  sha: string;
  author: string;
  /** ISO 8601 author date. */
  date: string;
  subject: string;
}

/** One commit touching a single file, with what the graph needs to draw it. */
export interface GitFileLogEntry extends GitLogEntry {
  /**
   * Parent commit ids, pruned to the commits present in the same response — git
   * hides commits that did not touch the file, so raw parents would point at
   * commits the client cannot draw.
   */
  parents: string[];
  /** The file's path (relative to the browser root) at this commit; differs across a rename. */
  path: string;
  added: number;
  deleted: number;
}

/** The working tree, as a revision the user can pick alongside any commit. */
export const WORKTREE_REVISION = "worktree";

/**
 * One side of a two-point file diff: a commit id (or the working-tree marker) plus
 * the path the file had there, so a diff across a rename compares the right blobs.
 */
export interface GitRevision {
  /** A commit id matching /^[0-9a-f]{7,40}$/i, or exactly WORKTREE_REVISION. */
  rev: string;
  /** Path relative to the browser root (posix separators). */
  path: string;
}

/** One match from a recursive file-name search (composer's `@` mention autocomplete). */
export interface FileSearchEntry {
  /** Path relative to the browser root (posix separators). */
  path: string;
  type: DirEntry["type"];
}

/**
 * One node of the conversation tree (fork/branch navigation). Only user
 * messages are nodes — assistant/tool entries are collapsed into their
 * preceding user turn — so the tree reads as "the points you can return to".
 */
export interface TreeNode {
  /** Session entry id (navigation/fork target): navigating here rewinds to *before* this message. */
  entryId: string;
  /**
   * Last entry of this turn's reply (the state right *after* the exchange).
   * Navigating here restores the full transcript, reply included. Absent when
   * the turn has no reply yet, or when the reply forks ambiguously.
   */
  tipId?: string;
  /** First line of the user message (truncated server-side). */
  text: string;
  /** True when this node is an ancestor of (or is) the current leaf. */
  onPath: boolean;
  /** Branch summary label, when the SDK generated one for an abandoned branch. */
  label?: string;
  children: TreeNode[];
}

/**
 * What a project is doing, for the selector to show without subscribing to it.
 *
 * Deliberately six named states rather than a pair of booleans: "stopped" and
 * "idle" differ in whether a session exists, "working" and "waiting" differ in
 * whether anyone must act, and a client that had to infer those from flags would
 * have to encode the same rules the server already applies.
 */
export type WorkspaceActivity =
  /** Open, but its session has been released after inactivity. Rebuilt on next open. */
  | "stopped"
  /** Session, sandbox and tools are being built. */
  | "starting"
  /** Ready, nothing running. */
  | "idle"
  /** A turn is in flight — including while nobody is looking at it. */
  | "working"
  /** A turn is blocked on a question only the user can answer. */
  | "waiting"
  /** Inactive, with an authoritative Work Plan whose completed result awaits review. */
  | "ready-for-review";

/**
 * One open project, as the selector sees it. Carries no conversation: a client
 * hears about every project's activity, and about only its own project's content.
 */
export interface WorkspaceInfo {
  /**
   * Resolved project directory. The workspace's identity on the wire too — there
   * is no separate id to keep in step with it.
   */
  root: string;
  /** Directory basename, for the selector's row. The path disambiguates two alike. */
  name: string;
  activity: WorkspaceActivity;
  /** Whether this workspace needs user attention, either to answer or to review. */
  needsAttention?: boolean;
}

/**
 * Which workspace affordances a mounted widget presents.
 *
 * `settings`: one project, its sandbox root editable through Settings alone.
 * `root`: a compact chooser in the header that moves that one workspace's
 * sandbox root. `projects`: the open/switch/close controls.
 */
export type EmbedWorkspaceControls = "settings" | "root" | "projects";

/** Snapshot of session state, sent on connect and after session replacement. */
export interface SessionSnapshot {
  /**
   * The project this snapshot describes — the one the connection is bound to.
   *
   * Absent on a server holding a single unnamed workspace, which is what keeps an
   * existing client working against a new server: no project selector appears
   * where there is nothing to select.
   */
  workspace?: WorkspaceInfo;
  /**
   * Opening, closing and switching are forbidden by configuration. The client
   * offers no affordance for them — this is what pins an embedded widget.
   */
  workspaceLocked?: boolean;
  /**
   * Which workspace affordances a mounted widget presents. Absent means
   * `"settings"`, the default and the interface embeds have always had — so a
   * client that does not know the field behaves as it always did.
   *
   * Presentation, not authorization: `workspaceLocked` above and the sandbox
   * locks remain the enforcing boundaries, and this can only narrow what is
   * offered within them. The standalone interface ignores it.
   */
  embedWorkspaceControls?: EmbedWorkspaceControls;
  /**
   * Every open project, this one included. Absent for the same reason as above.
   * Kept current by `workspace_activity`, which reaches every client regardless of
   * what it is bound to.
   */
  workspaces?: WorkspaceInfo[];
  branding: Branding;
  sessionId: string;
  model: string;
  thinkingLevel: string;
  /**
   * The ordered thinking levels the current model accepts. Absent when the
   * runtime cannot report them (an RPC dialect with no command for it); a client
   * then offers the full `THINKING_LEVELS` set.
   */
  thinkingLevels?: ThinkingLevel[];
  isStreaming: boolean;
  items: ChatItem[];
  models: ModelChoice[];
  commands: CommandInfo[];
  contextUsage?: ContextUsage;
  /** Agent-owned, session-persistent plan; null when this session has none. */
  workPlan?: WorkPlan | null;
  /**
   * File-browser writable zone, relative to the browser root (posix separators):
   * absent when no sandbox is configured (nothing to distinguish), `null` when the
   * sandbox is entirely read-only, or the writable subtree's path ("" = the whole root).
   */
  writableRoot?: string | null;
  /** Whether the browser root is inside a git work tree (and git is installed). */
  gitAvailable?: boolean;
  /** Present only when `gitAvailable` is false: why, so the absence can be acted on. */
  gitUnavailable?: GitUnavailable;
  /** Which providers are usable, and whether the agent can answer at all. Never carries a key. */
  credentials?: CredentialStatus;
  /**
   * Absolute paths of loaded extension files — an inventory of what the runtime
   * actually loaded, not what was configured.
   *
   * Absent means the runtime cannot report one, which is not the same as loading
   * none: an RPC child builds its own extensions and this server never sees them.
   * A reader must show those two cases differently, or it states as fact something
   * it was never told.
   */
  extensionPaths?: string[];
  /**
   * Extension paths from the server's configuration file. Shown by the settings
   * menu, never editable there — the same arrangement as `skillPaths`.
   */
  configuredExtensionPaths?: string[];
  /**
   * Extension paths added through Settings — the editable list.
   *
   * A path here may be a directory: the agent runtime discovers the extensions
   * inside it, which is why the interface offers no way to name a single file.
   */
  userExtensionPaths?: string[];
  /**
   * Whether the deployment forbids changing extension paths from the interface.
   * When true a client offers no control for them — and the server refuses the
   * change anyway, because a client is not a trust boundary.
   */
  extensionLock?: boolean;
  /**
   * Skill paths from the server's configuration file. Shown by the settings menu,
   * never editable there: they belong to the deployment, and an apply must not be
   * able to take one away from everyone who connects.
   */
  skillPaths?: string[];
  /**
   * Skill paths added through Settings — the editable list. Built-in skills are
   * in neither list: they are inventory, and arrive as `commands` with source
   * `"skill"`.
   */
  userSkillPaths?: string[];
  /** Tools the active agent session can call; `active` means the model receives it in its prompt. */
  tools?: { name: string; active: boolean }[];
  /**
   * Versions for the settings display: exactly one of `piSdk` and `agent`, naming
   * whatever is actually answering prompts.
   *
   * Embedded reports `piSdk`, the SDK running the conversation in this process.
   * RPC reports `agent` instead (e.g. `"little-coder 0.83.0"`) and omits `piSdk`:
   * the bundled SDK still reads the session store there, but a version line that a
   * reader takes for the agent's, and that is not, is worse than no line at all.
   */
  versions?: { piOutpost: string; piSdk?: string; agent?: string };
  /** Sandbox configuration — absent when no sandbox is configured. */
  sandbox?: {
    root: string;
    allowWrite: boolean;
    allowBash: boolean;
    writableRoot?: string;
    /** Which fields the settings menu must not allow editing — set from config.sandboxLocks. */
    locks?: { root?: boolean; allowWrite?: boolean; allowBash?: boolean; writableRoot?: boolean; terminal?: boolean };
  };
  /** Terminal configuration — whether the integrated web terminal is enabled and whether it is locked. */
  terminal?: {
    enabled: boolean;
    locked?: boolean;
  };
}

/**
 * What the client needs to decide between "you have not set up a provider yet"
 * (onboarding) and "your providers are fine, but no model is left" (a config
 * problem — `allowedModels` filtering everything out, say). Conflating the two
 * sends a configured user to a screen asking for a key he already gave.
 */
export interface CredentialStatus {
  /** Provider ids the registry knows, with whether each has usable auth. */
  providers: { id: string; name: string; configured: boolean }[];
  /** A model with usable credentials exists — the agent can answer. */
  usableModel: boolean;
  /**
   * Where credentials belong, for the onboarding screen to say so. Sent *only* while
   * no model is usable: it is an absolute server-side path (it names the OS account),
   * and a configured server has no reason to hand that to every client, embed hosts
   * included.
   */
  agentDir?: string;
}

/** Server -> client */
export type ServerMessage =
  | ({ type: "hello" } & SessionSnapshot)
  | ({ type: "session_replaced" } & SessionSnapshot)
  | { type: "sessions"; sessions: SessionSummary[] }
  /** Answer to search_sessions — sent only to the client that asked. */
  | { type: "session_search_results"; requestId: string; query: string; sessions: SessionSummary[] }
  /** `thinkingLevels` is the new model's accepted set; absent means "offer the full set". */
  | { type: "model_changed"; model: string; reasoning: boolean; thinkingLevels?: ThinkingLevel[] }
  /**
   * A credential was stored or a provider declared: the model list and the credential
   * status changed, nothing else did. Deliberately *not* a session snapshot — the
   * session is the one the user was already in, and a snapshot would make clients drop
   * live extension dialogs, notifications, statuses and widgets the server still holds.
   */
  | { type: "credentials_changed"; models: ModelChoice[]; model: string; credentials: CredentialStatus }
  | { type: "thinking_changed"; level: string }
  | { type: "user"; text: string; images?: WireImage[] }
  /**
   * User messages persisted on the current branch, oldest first. Sent once a turn
   * lands, so the client's optimistically echoed bubbles pick up their entryId and
   * become editable. The text travels along because the echo and the persisted
   * entries are NOT 1:1 — an extension slash command or a steer that was aborted
   * before delivery echoes a bubble that never becomes an entry — so the client
   * pairs from the end and stops at the first text mismatch (fail safe: no id, no
   * edit) instead of blindly aligning by position.
   */
  | { type: "user_entries"; entries: { entryId: string; text: string }[] }
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
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown; callHtml?: string }
  /**
   * `progress` is a completion fraction in `0..1` the running tool volunteered on
   * this update; absent when it reported none. It is a hint, shown only while the
   * tool runs, and is never persisted to session history.
   */
  | { type: "tool_update"; toolCallId: string; text: string; progress?: number }
  | {
      type: "tool_end";
      toolCallId: string;
      isError: boolean;
      text: string;
      outputHtml?: string;
      outputHtmlCollapsed?: string;
      /** Serialized structured-exchange document, when the tool declared one. */
      structured?: string;
    }
  | { type: "queue"; steering: string[]; followUp: string[] }
  | { type: "context_usage"; usage: ContextUsage }
  | { type: "work_plan_changed"; workPlan: WorkPlan | null }
  | { type: "workspace_outcome"; requestId: string; outcome: WorkspaceOutcome }
  | { type: "compaction_start" }
  | { type: "compaction_end"; errorMessage?: string }
  | { type: "error"; message: string }
  | { type: "directory_listing"; requestId: string; path: string; entries: DirEntry[] }
  /**
   * A file the browser asked to read.
   *
   * `documentIssues` is present only when the content declares a supported
   * structured-exchange schema and does not satisfy it. It carries the reference
   * validator's diagnosis — the browser's own check is a verdict without a reason
   * (deliberately: the diagnostics are 22 KB it does not otherwise need), and the
   * one person able to tell the producer what is wrong is the reader looking at
   * the file. Shaped like `StructuredExchangeIssue`, restated here because this
   * module deliberately imports nothing.
   */
  | {
      type: "file_content";
      requestId: string;
      path: string;
      content: string;
      size: number;
      mtimeMs: number;
      documentIssues?: { rule: string; path: string; message: string }[];
    }
  | { type: "file_written"; requestId: string; path: string; size: number; mtimeMs: number }
  /**
   * An upload landed. `path` is what the server actually wrote, which is not
   * always what was asked for — a taken name is disambiguated server-side, and
   * the client must reference the answer rather than its own request.
   */
  | { type: "file_uploaded"; requestId: string; path: string }
  | {
      type: "file_operation_result";
      requestId: string;
      operation: FileOperation;
      /** Resulting path; deletion echoes the deleted path. */
      path: string;
      /** Previous path for rename and move, so clients can update active views. */
      previousPath?: string;
    }
  | {
      type: "file_browser_error";
      requestId: string;
      path: string;
      message: string;
      /** Machine-readable failure kind — absent for unexpected errors. */
      reason?: FileBrowserErrorReason;
    }
  | { type: "file_changed"; path: string }
  /**
   * The workspace's repository set changed on disk — one was cloned, initialised or
   * removed. `available` is the new `gitAvailable`.
   *
   * Broadcast rather than waited for: a client told at connect that the workspace has
   * no repository stops asking about git entirely, so nothing short of being told
   * would ever bring the surface back.
   */
  | { type: "git_repositories_changed"; available: boolean; unavailable?: GitUnavailable }
  /**
   * A watched directory's entries changed on disk, whatever caused it — this
   * server, the agent through bash, or nothing in this process at all.
   *
   * Distinct from `file_changed` on purpose: that one names a file the server
   * knows it touched, while a watcher's honest unit of observation is the
   * directory (`fs.watch` reports the entry name only sometimes, and on a rename
   * names one of the two sides). The client decides what a changed directory
   * implies — re-list it if the tree holds it, re-read the preview if the open
   * file lives there.
   */
  | { type: "directory_changed"; path: string }
  | { type: "file_search_results"; requestId: string; query: string; results: FileSearchEntry[] }
  | { type: "tree"; roots: TreeNode[] }
  | { type: "editor_prefill"; text: string }
  /**
   * `files` spans every repository in the workspace and `repos` carries each one's
   * branch — unless `repo` echoes a scoped request, in which case both describe that
   * repository alone and replace only its slice of what the client holds.
   */
  | { type: "git_status"; requestId: string; repo?: string; repos: GitRepoStatus[]; files: GitFileStatus[] }
  | { type: "git_diff"; requestId: string; path: string; before: string; after: string }
  /** `repo` is echoed: a log rendered under another repository's chip is a lie. */
  | { type: "git_log"; requestId: string; repo: string; entries: GitLogEntry[] }
  | { type: "git_show"; requestId: string; sha: string; patch: string; truncated: boolean }
  | { type: "git_file_log"; requestId: string; path: string; entries: GitFileLogEntry[] }
  /** Both revisions are echoed so the client can drop a reply its selection has moved past. */
  | { type: "git_file_diff"; requestId: string; base: GitRevision; target: GitRevision; beforeText: string; afterText: string }
  | { type: "git_error"; requestId: string; message: string }
  /**
   * Directories immediately beneath one server-side path, for a settings path
   * picker. Unrelated to `directory_listing`: that one is confined to the
   * workspace and lists files too, this one starts at `/` and lists directories.
   */
  | { type: "server_directory"; requestId: string; path: string; parent: string | null; entries: ServerDirEntry[] }
  | { type: "server_directory_error"; requestId: string; path: string; message: string }
  /**
   * Editable runtime settings were persisted and the session rebuilt from them —
   * carries the full new snapshot. Sent only after a successful write: a client
   * that gets this may tell the user the change survived a restart.
   */
  | ({ type: "update_config_ack" } & SessionSnapshot)
  /**
   * A project's activity changed. The one message that deliberately reaches every
   * client, whatever it is bound to: background work is invisible otherwise, and
   * that visibility is the point of holding several projects at once.
   *
   * Carries no conversation content — only what the selector draws.
   */
  | { type: "workspace_activity"; workspaces: WorkspaceInfo[] }
  /**
   * The connection is now bound to another project, and this is that project's
   * state. A full snapshot because it replaces everything the client was showing —
   * except the view, which the client resets on its own (an open file and a scroll
   * position do not survive a switch; an unsent draft does).
   */
  | ({ type: "workspace_switched" } & SessionSnapshot)
  | { type: "workspace_error"; message: string }
  | { type: "terminal_data"; terminalId: string; data: string }
  | { type: "terminal_cwd"; terminalId: string; cwd: string }
  | { type: "terminal_exit"; terminalId: string; exitCode?: number }
  | { type: "terminal_error"; terminalId: string; message: string }
  | ExtensionUIRequest;

/** Client -> server */
export type ClientMessage =
  /**
   * Bind this connection to another open project.
   *
   * `root` must name a project already open — a client cannot open one by naming a
   * path here. Switching disturbs nothing: no other workspace is cancelled, paused
   * or rebuilt, and a turn running in the project being left runs to completion.
   */
  | { type: "switch_workspace"; root: string }
  /**
   * Open a directory as a project. The path comes from the same picker the sandbox
   * root uses (`browse_server_directory`), so the boundary is the configured lock
   * rather than an enumeration of allowed roots — exactly as it already is for
   * moving the sandbox.
   */
  | { type: "open_project"; root: string }
  /**
   * Close an open project: its workspace stops, it leaves the open set, and its
   * session history on disk is untouched. Refused while its agent is streaming,
   * and refused for the last remaining project.
   */
  | { type: "close_project"; root: string }
  | { type: "prompt"; text: string; images?: WireImage[] }
  | { type: "abort" }
  | { type: "set_model"; provider: string; id: string }
  | { type: "set_thinking"; level: ThinkingLevel }
  | { type: "new_session" }
  | { type: "switch_session"; path: string }
  | { type: "delete_session"; path: string }
  | { type: "list_sessions" }
  /** Set a session's display name (any saved session, live or not). Empty name clears it. */
  | { type: "rename_session"; path: string; name: string }
  /** Find sessions by name, first message or transcript content (matched server-side). */
  | { type: "search_sessions"; query: string; requestId: string }
  | { type: "compact" }
  | { type: "list_directory"; path: string; requestId: string }
  | { type: "read_file"; path: string; requestId: string }
  | {
      type: "write_file";
      path: string;
      content: string;
      /** mtimeMs from the file_content that populated the editor; the server refuses to overwrite a file that changed since. */
      expectedMtimeMs: number;
      /** Skip the mtime conflict check (user explicitly chose to overwrite a concurrent change). */
      force?: boolean;
      requestId: string;
    }
  /**
   * Create an empty file. Deliberately not a flag on `write_file`: that message
   * refuses a path that no longer exists, which is how a concurrent move is
   * caught — a boolean suspending it would be a guard with an off switch.
   */
  | { type: "create_file"; path: string; requestId: string }
  /** Create one directory (not a chain of missing parents). */
  | { type: "create_directory"; path: string; requestId: string }
  /**
   * Store a file the user supplied from outside the workspace (a drop, the
   * composer's attach button). Base64 because the payload is binary: a UTF-8 body
   * cannot carry a PDF or an image unchanged.
   *
   * Distinct from `write_file` (no mtime precondition, creates rather than
   * replaces) and from `create_file` (carries content, and may create the
   * destination directory). `name` is one path segment; `destinationDirectory` is
   * browser-root-relative. Answered by `file_uploaded` with the written path.
   */
  | { type: "upload_file"; destinationDirectory: string; name: string; contentBase64: string; requestId: string }
  /** Ask the host OS to open an existing confined file in its associated application. */
  | { type: "open_native"; path: string; requestId: string }
  /** Rename a regular file within its current directory. `name` is one path segment. */
  | { type: "rename_file"; path: string; name: string; requestId: string }
  /** Permanently delete one regular file. UI confirmation happens before this message. */
  | { type: "delete_file"; path: string; requestId: string }
  /** Move one regular file into an existing directory, preserving its basename. */
  | { type: "move_file"; path: string; destinationDirectory: string; requestId: string }
  /** Copy one confined regular file into an existing writable directory, preserving its basename. */
  | { type: "copy_file"; path: string; destinationDirectory: string; requestId: string }
  | { type: "search_files"; query: string; requestId: string }
  | { type: "list_tree" }
  | { type: "navigate_tree"; entryId: string }
  | { type: "fork_session"; entryId: string }
  /**
   * Re-send a user message with edited text: rewinds to just before `entryId`
   * and prompts again, so the answer starts a new branch of the same session
   * (the old exchange stays reachable through the tree).
   */
  | { type: "edit_prompt"; entryId: string; text: string; images?: WireImage[] }
  | { type: "get_outcome"; requestId: string }
  /** `repo` reads one repository instead of sweeping every one of them. */
  | { type: "git_status"; repo?: string; requestId: string }
  /** `repo` names which repository of the workspace to read, as `GitRepoStatus.repo` does. */
  | { type: "git_log"; repo: string; limit?: number; requestId: string }
  | { type: "git_diff"; path: string; requestId: string }
  /** `sha` is resolved only against `repo`; there is no fallback to another. */
  | { type: "git_show"; repo: string; sha: string; requestId: string }
  /** Commits touching one file, renames followed; limit clamped to [1, 200] server-side. */
  | { type: "git_file_log"; path: string; limit?: number; requestId: string }
  | { type: "git_file_diff"; base: GitRevision; target: GitRevision; requestId: string }
  /**
   * Store an API key for a known provider. Carries no auth of its own: it rides the
   * token check that already guards /ws, and the server refuses to bind off-loopback
   * without a token — so this write is never reachable unauthenticated from a network.
   */
  | { type: "set_credential"; provider: string; apiKey: string }
  /** Declare an OpenAI-compatible endpoint (a corporate gateway, vLLM, Ollama…). */
  | { type: "declare_provider"; provider: string; baseUrl: string; apiKey: string; models: string[]; compat?: ProviderCompat }
  /** List the directories under one server-side path (absolute; `/` is the top). */
  | { type: "browse_server_directory"; path: string; requestId: string }
  /**
   * Update the editable runtime settings — the server persists them to the
   * configuration file it loaded, then replaces the session so the new toolset
   * and skills take effect. Each field is optional: a deployment with no sandbox
   * can still change its skill paths.
   */
  | {
      type: "update_config";
      sandbox?: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string };
      /**
       * The Settings-managed skill paths, replacing that list. Absent leaves it
       * untouched. The configuration file's own `skillPaths` are not addressable
       * from here — they cannot be rewritten or removed by a client.
       */
      userSkillPaths?: string[];
      /**
       * The Settings-managed extension paths, replacing that list. Absent leaves
       * it untouched, and an empty array is a removal. Refused outright when the
       * deployment sets `extensionLock`.
       */
      userExtensionPaths?: string[];
    }
  | { type: "terminal_open"; terminalId: string; cwd?: string; cols?: number; rows?: number }
  | { type: "terminal_input"; terminalId: string; data: string }
  | { type: "terminal_resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal_get_cwd"; terminalId: string }
  | { type: "terminal_close"; terminalId: string }
  | ExtensionUIResponse;

/**
 * Flags an OpenAI-compatible server may need. They are not cosmetic: a gateway that
 * rejects the `developer` role or `reasoning_effort` fails on *every* turn, and the
 * error never says so — which is why the UI asks rather than letting the user guess.
 */
export interface ProviderCompat {
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
}
