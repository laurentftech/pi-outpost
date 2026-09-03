/**
 * The server's agent-runtime boundary.
 *
 * pi-outpost speaks one typed WebSocket protocol to the browser and, behind this
 * interface, either an embedded Pi SDK `AgentSession` (the default) or a
 * supervised `pi --mode rpc` child process. The browser never learns which.
 *
 * The shape is dictated by what the WebSocket handlers actually observe, not by
 * either backend: a *synchronous normalized snapshot* (so `hello` and
 * `session_replaced` never wait on a round trip), a normalized event stream, and
 * a set of commands. An RPC adapter keeps that snapshot current by bootstrapping
 * from Pi and folding events into it; the embedded adapter reads it straight off
 * the live session.
 *
 * Capabilities that only one backend can honour (storing credentials, titling a
 * session with a model call, rebuilding the toolset) are `undefined` on the
 * other rather than silently no-op: a browser command that lands on a missing
 * capability is refused with a message naming the runtime, never dropped.
 */
import type {
  AgentResourceInfo,
  CommandInfo,
  ContextUsage,
  ExtensionUIRequest,
  ExtensionUIResponse,
  ModelChoice,
  ThinkingLevel,
  WireImage,
} from "@pi-outpost/shared";
import type { ProviderDeclaration } from "./credentials.ts";

/** Provider identity + whether credentials resolve for it, for the onboarding screen. */
export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
}

/** The selected model, as both backends can describe it. */
export interface RuntimeModel {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
}

/**
 * Raw session-tree node. Deliberately the SDK's own shape — Pi's `get_tree`
 * response uses the same one — so `buildTree` collapses either without a branch.
 */
export interface RuntimeTreeNode {
  entry: { type: string; id: string; message?: { role?: string; content?: unknown } };
  children: RuntimeTreeNode[];
  label?: string;
}

/** A session entry, as far as the server cares (naming, fork validation). */
export interface RuntimeEntry {
  type: string;
  id: string;
  message?: { role?: string; content?: unknown };
}

/**
 * Everything `snapshot()` in index.ts needs, read without I/O.
 *
 * `messages` and `entries` are SDK/Pi `AgentMessage`/`SessionEntry` values passed
 * straight through to `convert.ts`, which has always treated them structurally.
 */
export interface RuntimeSnapshot {
  sessionId: string;
  /** Path of the session file, when the runtime persists one. */
  sessionFile?: string;
  model?: RuntimeModel;
  thinkingLevel: ThinkingLevel;
  /**
   * The ordered levels the current model actually accepts — a subset of
   * `THINKING_LEVELS`. Absent when the runtime cannot say (an RPC dialect with no
   * command for it), and a client then offers the full set.
   */
  thinkingLevels?: ThinkingLevel[];
  isStreaming: boolean;
  /** Conversation history on the active branch, oldest first. */
  messages: unknown[];
  /** Every model the runtime would accept in `setModel`, before `allowedModels` filtering. */
  models: ModelChoice[];
  commands: CommandInfo[];
  /** Resource provenance known by this runtime; absent entries are never inferred. */
  resources?: AgentResourceInfo[];
  resourceCapabilities?: { skills: "available" | "unavailable"; extensions: "available" | "unavailable" };
  contextUsage?: ContextUsage;
  providers: ProviderStatus[];
  /**
   * Extension files this runtime loaded. Absent when the runtime cannot say — an
   * RPC child builds its own extensions and never reports them — which the
   * interface must show differently from having loaded none.
   */
  extensionPaths?: string[];
  /** Tools registered by the runtime, with their current model visibility. */
  tools?: { name: string; active: boolean }[];
}

/**
 * Normalized runtime event. The union is the subset of Pi's event stream the web
 * UI observes; `assistant`/`custom` message payloads stay structural because both
 * backends emit the same `AgentMessage` shape.
 */
export type RuntimeEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "assistant_start" }
  | { type: "block_delta"; block: "text" | "thinking"; contentIndex: number; delta: string }
  | { type: "assistant_end"; message: unknown }
  | { type: "custom_message"; message: unknown }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  // `progress` is whatever the tool put in `partialResult.details.progress` — a
  // completion fraction, in principle `0..1`. Carried raw and sanitised once, at
  // the broadcast boundary in index.ts, so both runtimes stay pass-through.
  | { type: "tool_update"; toolCallId: string; content: unknown; progress?: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; content: unknown; details: unknown; isError: boolean }
  | { type: "queue"; steering: string[]; followUp: string[] }
  | { type: "thinking_changed"; level: ThinkingLevel }
  | { type: "compaction_start" }
  | { type: "compaction_end"; errorMessage?: string }
  /** The runtime replaced its session object and has finished re-binding to it. */
  | { type: "session_replaced" }
  /** An extension asked the user something; the answer comes back via `answerExtensionUI`. */
  | { type: "extension_ui_request"; request: ExtensionUIRequest }
  /** Something went wrong but the runtime is still usable (an extension threw, a command failed). */
  | { type: "error"; message: string }
  /** Fail-closed: the runtime is unusable from here on. Reported once. */
  | { type: "runtime_failed"; message: string };

/**
 * Build a `tool_update` event from a tool's partial result, the same way for
 * both runtimes — the RPC record and the SDK event differ around it but not in
 * this shape. Everything is read defensively: a partial with no `details`, or no
 * partial at all, yields an event with no `progress` rather than a throw. The
 * fraction is carried raw and sanitised once, at the broadcast boundary.
 */
export function toolUpdateEvent(
  toolCallId: string,
  partial: { content?: unknown; details?: { progress?: unknown } } | undefined,
): Extract<RuntimeEvent, { type: "tool_update" }> {
  return { type: "tool_update", toolCallId, content: partial?.content, progress: partial?.details?.progress };
}

export interface PromptOptions {
  images?: WireImage[];
  /**
   * Called once, as soon as the runtime has accepted or rejected the prompt and
   * before the turn streams. Lets the server echo the user bubble only for a
   * prompt that was actually taken.
   */
  onAccepted?: (accepted: boolean) => void;
}

/**
 * Credential and provider management. Embedded only: it mutates the model
 * registry the live session resolves auth through, and Pi RPC exposes no command
 * that would reach the child's own registry.
 */
export interface CredentialCapability {
  storeApiKey(provider: string, apiKey: string, signal: AbortSignal): Promise<void>;
  declareProvider(declaration: ProviderDeclaration): Promise<void>;
  /** Re-fetch remote model catalogs. Resolves `aborted` when it hit its deadline. */
  refreshModels(signal: AbortSignal): Promise<{ aborted?: boolean } | undefined>;
  /** Point the live session at a model that can answer. */
  adoptModel(model: RuntimeModel): Promise<void>;
}

/**
 * Renderers extensions contribute for tool cards. Embedded only — they are
 * in-process JS objects, and an RPC child cannot hand them across the pipe.
 */
export interface RenderCapability {
  getToolDefinition(name: string): unknown;
  getMessageRenderer(customType: string): unknown;
}

/** Everything needed to title a session from its opening exchange with one model call. */
export interface TitleCapability {
  generateTitle(exchange: string, signal: AbortSignal): Promise<string | undefined>;
}

/**
 * Why a browser command cannot be served. Carries the runtime's name so the
 * message the user sees says which runtime refused, not just "unsupported".
 */
export class RuntimeUnsupportedError extends Error {
  constructor(feature: string, runtime: string) {
    super(`${feature} is not available with the ${runtime} agent runtime`);
    this.name = "RuntimeUnsupportedError";
  }
}

/** The runtime stopped and will not be restarted; every later command is refused. */
export class RuntimeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeFailedError";
  }
}

export interface AgentRuntime {
  /** `"embedded"` or `"rpc"` — used in messages, logs and health only. */
  readonly kind: string;

  /**
   * The harness actually answering prompts, e.g. `"little-coder 0.83.0"`, for the
   * settings panel. Undefined on the embedded runtime, where the SDK version
   * pi-outpost already reports is the honest answer.
   */
  readonly agentLabel?: string;

  /** Current normalized state. Never performs I/O. */
  snapshot(): RuntimeSnapshot;
  /** Session tree, collapsed by the caller. */
  tree(): { roots: RuntimeTreeNode[]; leafId: string | null };
  /** Session entries in append order, for naming and fork validation. */
  entries(): RuntimeEntry[];
  /** Entries on the active branch (post-compaction context), for the user-message list. */
  contextEntries(): RuntimeEntry[];

  /** False once the runtime has failed; `/health` reports it and commands are refused. */
  readonly ok: boolean;
  /** Why the runtime failed, when it has. */
  readonly failure?: string;

  subscribe(listener: (event: RuntimeEvent) => void): () => void;

  prompt(text: string, options?: PromptOptions): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, id: string): Promise<RuntimeModel>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  /**
   * Publish or withhold one already-registered tool for the rest of this session,
   * and say whether it took.
   *
   * A runtime that cannot change its published toolset returns `false` rather than
   * pretending: the RPC dialect has no command for it, so a child there publishes
   * everything it was registered with. Callers report that, they do not work around
   * it — the embedded SDK runtime is the supported target.
   */
  setToolPublished(name: string, published: boolean): boolean;
  compact(): Promise<void>;
  setSessionName(name: string): Promise<void>;

  newSession(): Promise<{ cancelled: boolean }>;
  switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
  fork(entryId: string): Promise<{ cancelled: boolean; selectedText?: string }>;
  /**
   * Move the leaf to another node of the same session file. Absent when the
   * backend has no equivalent — Pi RPC exposes fork and clone, not navigation.
   */
  navigateTree?(entryId: string): Promise<{ cancelled: boolean; editorText?: string }>;

  answerExtensionUI(response: ExtensionUIResponse): void;
  /** Drop every dialog an about-to-be-replaced session left an extension waiting on. */
  cancelPendingExtensionRequests(): void;

  readonly credentials?: CredentialCapability;
  readonly renderers?: RenderCapability;
  readonly titles?: TitleCapability;
  /**
   * Rebuild the agent's toolset from the current sandbox configuration and start
   * a fresh session. Embedded only: an RPC child owns its own tools.
   */
  rebuildTools?(): Promise<{ cancelled: boolean }>;

  dispose(): Promise<void>;
}
