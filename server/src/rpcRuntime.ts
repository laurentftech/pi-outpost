/**
 * The optional agent runtime: a supervised `pi --mode rpc` child process.
 *
 * Where the embedded runtime reads live objects, this one keeps a *normalized
 * snapshot* and folds Pi's event stream into it. That is what lets `hello` answer
 * a browser that connected one millisecond after startup without a round trip —
 * and why the runtime is not ready until the bootstrap below has completed: a
 * session file can hold a long prior conversation, and a client that connected
 * first would otherwise be told the conversation was empty.
 *
 * Fail-closed is the other half. A child exit, a malformed record, or a command
 * that never answers puts this adapter in a terminal failed state: no restart, no
 * replay, no fallback to the embedded runtime. The prompt or tool call in flight
 * may already have written files or spent money, and doing it again silently is
 * worse than stopping.
 */
import type {
  AgentResourceInfo,
  CommandInfo,
  ContextUsage,
  ExtensionUIRequest,
  ExtensionUIResponse,
  ModelChoice,
  ThinkingLevel,
} from "@pi-outpost/shared";
import { normalizeThinkingLevels } from "@pi-outpost/shared";
import type {
  AgentRuntime,
  PromptOptions,
  RuntimeEntry,
  RuntimeEvent,
  RuntimeModel,
  RuntimeSnapshot,
  RuntimeTreeNode,
} from "./agentRuntime.ts";
import { toolUpdateEvent } from "./agentRuntime.ts";
import type { AgentRuntimeConfig } from "./config.ts";
import { PiRpcProcess, probeAgentLabel, type RpcIncoming } from "./piRpcProcess.ts";
import { explainRejectedFlags } from "./rpcResourceArgs.ts";

export interface RpcRuntimeOptions {
  settings: AgentRuntimeConfig;
  cwd: string;
  agentDir: string;
  sessionDir?: string;
  /**
   * The resource configuration as pi flags (see rpcResourceArgs.ts). Separate
   * from `settings.args` because those are the operator's own additions, while
   * these are derived from the rest of the configuration — and they go *after*,
   * so a hand-written argument cannot displace the configured skill set.
   */
  resourceArgs?: string[];
  /** Extra environment for the child, e.g. the tools extension's settings. */
  env?: Record<string, string>;
}

/** Dialog methods block an extension until the client answers; the rest are fire-and-forget. */
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

export async function createRpcRuntime(options: RpcRuntimeOptions): Promise<AgentRuntime> {
  const runtime = new RpcRuntime(options);
  await runtime.start();
  return runtime;
}

interface RpcModel {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
}

class RpcRuntime implements AgentRuntime {
  readonly kind = "rpc";
  /** Filled once the child is up; see probeAgentLabel. */
  agentLabel: string | undefined;

  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private process!: PiRpcProcess;
  private failed: string | undefined;

  // Normalized state, kept current by bootstrap + events.
  private sessionId = "";
  private sessionFile: string | undefined;
  private model: RpcModel | undefined;
  private thinkingLevel: ThinkingLevel = "off";
  /** The levels the current model accepts; undefined when the child has no command for it. */
  private acceptedThinkingLevels: ThinkingLevel[] | undefined;
  private streaming = false;
  private messages: unknown[] = [];
  private sessionEntries: RuntimeEntry[] = [];
  private treeRoots: RuntimeTreeNode[] = [];
  private leafId: string | null = null;
  private availableModels: ModelChoice[] = [];
  private availableCommands: CommandInfo[] = [];
  private availableResources: AgentResourceInfo[] = [];
  private usage: ContextUsage | undefined;
  /** Standard Pi names this operation `fork`; OMP's compatible dialect names it `branch`. */
  private forkCommand: "fork" | "branch" = "fork";
  /** Standard Pi settles after maintenance; OMP's dialect terminates directly at `agent_end`. */
  private completionEvent: "agent_settled" | "agent_end" = "agent_settled";

  /** Assistant message being streamed, assembled from deltas so a mid-stream connect sees it. */
  private partial: { role: "assistant"; content: unknown[]; timestamp: number } | undefined;
  /** Dialog requests Pi is blocked on, so a session replacement can release them. */
  private openDialogs = new Set<string>();
  /** Serializes record handling: a refresh must not interleave with the next event. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: RpcRuntimeOptions) {}

  get ok(): boolean {
    return this.failed === undefined;
  }

  get failure(): string | undefined {
    return this.failed;
  }

  // --- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    const { settings, cwd, agentDir, sessionDir } = this.options;
    if (!settings.executable) throw new Error(`[pi] agentRuntime.mode is "rpc" but no executable is configured`);
    this.process = new PiRpcProcess({
      executable: settings.executable,
      args: [...settings.args, ...(this.options.resourceArgs ?? [])],
      cwd,
      agentDir,
      sessionDir,
      ...(this.options.env ? { env: this.options.env } : {}),
      commandTimeoutMs: settings.commandTimeoutMs,
      shutdownGraceMs: settings.shutdownGraceMs,
      onRecord: (record) => this.enqueue(() => this.onRecord(record)),
      onFailure: (message, detail) => this.onFailure(message, detail),
    });
    try {
      await this.bootstrap(settings.startupTimeoutMs);
    } catch (error) {
      // Never leave a half-started child behind: the operator gets an actionable
      // startup error and no orphaned process holding their session file open.
      await this.process.stop().catch(() => {});
      // The child's own output, not just the cause: this error goes to the console
      // and stops startup, so nothing is leaked to a browser by including it — and
      // the flag a fork rejected is only ever named in there. Reading `this.failed`
      // instead meant scanning a string that cannot contain a flag name, so the hint
      // below could never fire.
      const detail = this.process.failureWithOutput ?? this.failed ?? (error instanceof Error ? error.message : String(error));
      // A child that rejects a flag names the flag; the operator wrote a setting.
      const hint = explainRejectedFlags(detail);
      throw new Error(`[pi] the Pi RPC runtime failed to start: ${detail}${hint ? ` ${hint}` : ""}`);
    }
    // After the runtime is usable, never before: naming the harness is a nicety and
    // must not add its own way for startup to fail or to hang.
    this.agentLabel = await probeAgentLabel(settings.executable, cwd).catch(() => undefined);
  }

  /**
   * Ask Pi for everything the snapshot needs *before* declaring the runtime usable.
   * `get_state` doubles as the readiness probe: it is the first command the child
   * answers, so its timeout is the startup timeout rather than the command one.
   */
  private async bootstrap(startupTimeoutMs: number): Promise<void> {
    const state = (await this.process.command("get_state", {}, startupTimeoutMs)) as Record<string, unknown>;
    this.applyState(state);
    await this.refreshCatalog();
    await this.refreshConversation();
  }

  private async refreshCatalog(): Promise<void> {
    const models = (await this.process.command("get_available_models")) as { models?: unknown[] } | undefined;
    this.availableModels = (models?.models ?? []).flatMap((entry) => {
      const model = entry as RpcModel & { name?: string };
      if (typeof model?.provider !== "string" || typeof model.id !== "string") return [];
      return [{ provider: model.provider, id: model.id, name: model.name ?? model.id, reasoning: model.reasoning ?? false }];
    });
    let commands: { commands?: unknown[] } | undefined;
    try {
      commands = (await this.process.command("get_commands")) as { commands?: unknown[] } | undefined;
    } catch (error) {
      if (!isUnknownCommand(error, "get_commands")) throw error;
      // OMP calls the same optional catalog `get_available_commands`.
      try {
        commands = (await this.process.command("get_available_commands")) as { commands?: unknown[] } | undefined;
      } catch (fallbackError) {
        // Chat remains complete without slash autocomplete, but only tolerate an
        // explicit lack of both known catalog names. Transport errors still fail.
        if (!isUnknownCommand(fallbackError, "get_available_commands")) throw fallbackError;
        commands = { commands: [] };
      }
    }
    const resourceById = new Map<string, AgentResourceInfo>();
    this.availableCommands = (commands?.commands ?? []).flatMap((entry) => {
      const command = entry as {
        name?: unknown;
        description?: unknown;
        source?: unknown;
        sourceInfo?: { path?: unknown; source?: unknown };
        argumentHint?: unknown;
        input?: { hint?: unknown };
      };
      if (typeof command.name !== "string") return [];
      const source = command.source === "prompt" || command.source === "skill" ? command.source : "extension";
      if (source !== "prompt") {
        const resourcePath = typeof command.sourceInfo?.path === "string" ? command.sourceInfo.path : undefined;
        const kind = source === "skill" ? "skill" : "extension";
        const resourceName = source === "skill" ? command.name.replace(/^skill:/, "") : command.name;
        const id = `${kind}:${resourcePath ?? resourceName}`;
        if (!resourceById.has(id)) {
          resourceById.set(id, {
            id,
            kind,
            name: resourceName,
            origin: /built|bundled/i.test(String(command.sourceInfo?.source ?? "")) ? "built-in" : "runtime",
            ...(resourcePath ? { path: resourcePath } : { unavailableReason: "This RPC runtime did not report a source path" }),
          });
        }
      }
      return [
        {
          name: command.name,
          ...(typeof command.description === "string" ? { description: command.description } : {}),
          ...(typeof command.argumentHint === "string"
            ? { argumentHint: command.argumentHint }
            : typeof command.input?.hint === "string"
              ? { argumentHint: command.input.hint }
              : {}),
          source,
        } satisfies CommandInfo,
      ];
    });
    this.availableResources = [...resourceById.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    await this.refreshThinkingLevels();
  }

  /**
   * Which thinking levels the current model accepts. Optional: a dialect without
   * `get_available_thinking_levels` (OMP) leaves it undefined, and the client
   * offers the full set. Depends on the model, so it is refreshed on every
   * catalog refresh and after a `set_model`.
   */
  /** The level the child actually holds — it clamps on a model change, silently. */
  private async refreshThinkingLevel(): Promise<void> {
    const state = (await this.process.command("get_state")) as Record<string, unknown> | undefined;
    if (typeof state?.thinkingLevel === "string") this.thinkingLevel = state.thinkingLevel as ThinkingLevel;
  }

  private async refreshThinkingLevels(): Promise<void> {
    try {
      const answer = (await this.process.command("get_available_thinking_levels")) as { levels?: unknown } | undefined;
      this.acceptedThinkingLevels = normalizeThinkingLevels(answer?.levels);
    } catch (error) {
      if (!isUnknownCommand(error, "get_available_thinking_levels")) throw error;
      this.acceptedThinkingLevels = undefined;
    }
  }

  /** History, entries, tree and context usage — everything a finished turn can change. */
  private async refreshConversation(): Promise<void> {
    const messages = (await this.process.command("get_messages")) as { messages?: unknown[] } | undefined;
    this.messages = messages?.messages ?? [];
    // The authoritative history has landed; any partial we assembled is now stale.
    this.partial = undefined;
    try {
      const tree = (await this.process.command("get_tree")) as { tree?: unknown[]; leafId?: unknown } | undefined;
      this.treeRoots = (tree?.tree ?? []) as RuntimeTreeNode[];
      this.leafId = typeof tree?.leafId === "string" ? tree.leafId : null;
      try {
        const entries = (await this.process.command("get_entries")) as { entries?: unknown[] } | undefined;
        this.sessionEntries = (entries?.entries ?? []) as RuntimeEntry[];
      } catch (error) {
        if (!isUnknownCommand(error, "get_entries")) throw error;
        this.sessionEntries = flattenEntries(this.treeRoots);
      }
      this.forkCommand = "fork";
      this.completionEvent = "agent_settled";
    } catch (error) {
      if (!isUnknownCommand(error, "get_tree")) throw error;
      // OMP exposes the authoritative active-branch user entries, but not the
      // off-branch tree. Project them as one linear branch: every visible entry
      // keeps its real id, so branching/forking remains valid and deterministic.
      const branch = (await this.process.command("get_branch_messages")) as
        | { messages?: Array<{ entryId?: unknown; text?: unknown }> }
        | undefined;
      const projected = (branch?.messages ?? []).flatMap((item) =>
        typeof item.entryId === "string" && typeof item.text === "string"
          ? [{ type: "message", id: item.entryId, message: { role: "user", content: item.text } } satisfies RuntimeEntry]
          : [],
      );
      this.sessionEntries = projected;
      this.treeRoots = linearTree(projected);
      this.leafId = projected.at(-1)?.id ?? null;
      this.forkCommand = "branch";
      this.completionEvent = "agent_end";
    }
    const stats = (await this.process.command("get_session_stats")) as { contextUsage?: unknown } | undefined;
    this.usage = isContextUsage(stats?.contextUsage) ? stats.contextUsage : undefined;
  }

  private applyState(state: Record<string, unknown>): void {
    if (typeof state.sessionId === "string") this.sessionId = state.sessionId;
    this.sessionFile = typeof state.sessionFile === "string" ? state.sessionFile : undefined;
    this.model = toModel(state.model);
    if (typeof state.thinkingLevel === "string") this.thinkingLevel = state.thinkingLevel as ThinkingLevel;
    if (typeof state.isStreaming === "boolean") this.streaming = state.isStreaming;
  }

  /**
   * Everything after a session replacement: fresh state, catalog and conversation.
   *
   * Runs at the same serialization point as incoming records — see `queued`. A
   * session is replaced by a *command*, whose response arrives through correlation
   * rather than through the record queue, so calling this directly let it interleave
   * with the events of the turn being abandoned: two refreshes in flight, a
   * `message_end` appending to `messages` between them, and whichever `get_messages`
   * landed last deciding the snapshot. "New session" mid-turn could therefore be
   * announced to every tab carrying the previous conversation.
   */
  private rebootstrap(): Promise<void> {
    return this.queued(async () => {
      this.releaseDialogs();
      this.applyState((await this.process.command("get_state")) as Record<string, unknown>);
      await this.refreshCatalog();
      await this.refreshConversation();
      this.emit({ type: "session_replaced" });
    });
  }

  private onFailure(message: string, detail?: string): void {
    if (this.failed !== undefined) return;
    this.failed = message;
    // The operator gets the child's own output; the browsers get the cause.
    if (detail !== undefined && detail !== message) console.error(`[pi] ${detail}`);
    this.emit({ type: "runtime_failed", message });
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /**
   * Records are handled one at a time: a refresh must complete before the next event.
   *
   * A rejection here is a runtime failure, not a warning. Handling a record means
   * asking the child questions, and if one of those comes back `success: false` the
   * work after it does not happen — including the terminal `agent_end`. Logged and
   * swallowed, that left every browser locked in "the agent is running" for good,
   * with no error shown and `/health` still reporting ok: the worst of both, since
   * nothing was working and nothing said so.
   */
  private enqueue(work: () => Promise<void> | void): void {
    this.queue = this.queue.then(work).catch((error) => {
      this.onFailure(`the Pi RPC runtime could not keep its state in step: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Run command-driven work at that same point, and let the caller await it.
   *
   * The queue keeps going either way; a rejection both reaches the caller — the
   * browser asked for this — and fails the runtime, because work that leaves the
   * cached snapshot half-refreshed has made it untrustworthy.
   */
  private queued<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => {},
      (error) => {
        this.onFailure(`the Pi RPC runtime could not keep its state in step: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
    return result;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- incoming records ----------------------------------------------------

  private async onRecord(record: RpcIncoming): Promise<void> {
    switch (record.type) {
      case "agent_start":
        this.streaming = true;
        this.emit({ type: "agent_start" });
        break;
      case "agent_settled":
        // `agent_end` fires per low-level run and may be followed by a retry, a
        // compaction, or a queued follow-up. `agent_settled` is the one that means
        // "nothing more is coming", which is what the UI's running state tracks.
        if (this.completionEvent === "agent_settled") await this.completeTurn();
        break;
      case "agent_end":
        // OMP's compatible RPC dialect does not emit Pi's later
        // `agent_settled` event. Its `agent_end` is therefore authoritative.
        if (this.completionEvent === "agent_end") await this.completeTurn();
        break;
      case "message_start":
        this.onMessageStart(record);
        break;
      case "message_update":
        this.onMessageUpdate(record);
        break;
      case "message_end":
        this.onMessageEnd(record);
        break;
      case "tool_execution_start":
        this.emit({
          type: "tool_start",
          toolCallId: String(record.toolCallId),
          toolName: String(record.toolName),
          args: record.args,
        });
        break;
      case "tool_execution_update":
        this.emit(
          toolUpdateEvent(
            String(record.toolCallId),
            record.partialResult as { content?: unknown; details?: { progress?: unknown } } | undefined,
          ),
        );
        break;
      case "tool_execution_end": {
        const result = record.result as { content?: unknown; details?: unknown } | undefined;
        this.emit({
          type: "tool_end",
          toolCallId: String(record.toolCallId),
          toolName: typeof record.toolName === "string" ? record.toolName : "tool",
          content: result?.content,
          details: result?.details,
          isError: record.isError === true,
        });
        break;
      }
      case "queue_update":
        this.emit({
          type: "queue",
          steering: toStringArray(record.steering),
          followUp: toStringArray(record.followUp),
        });
        break;
      case "compaction_start":
        this.emit({ type: "compaction_start" });
        break;
      case "compaction_end": {
        const errorMessage = typeof record.errorMessage === "string" ? record.errorMessage : undefined;
        try {
          await this.refreshConversation();
        } finally {
          // The terminal event goes out even if the refresh failed, or the client
          // stays in the compacting state for good. The rejection still reaches the
          // queue, which fails the runtime — so the user is told, and not stuck.
          this.emit({ type: "compaction_end", ...(errorMessage ? { errorMessage } : {}) });
        }
        break;
      }
      case "extension_error":
        this.emit({ type: "error", message: `[extension ${String(record.extensionPath)}] ${String(record.error)}` });
        break;
      case "extension_ui_request":
        this.onExtensionUiRequest(record);
        break;
      default:
        // Auto-retry and summarization-retry events have no browser equivalent; the
        // turn they belong to still reports through the message and event stream.
        break;
    }
  }

  private async completeTurn(): Promise<void> {
    this.streaming = false;
    try {
      await this.refreshConversation();
    } finally {
      // Unconditional: `agent_end` is what releases the composer. A refresh that
      // fails must still end the turn — the queue turns the rejection into a visible
      // runtime failure, which is a far better outcome than a UI that never unlocks.
      this.emit({ type: "agent_end" });
    }
  }

  private onMessageStart(record: RpcIncoming): void {
    const message = record.message as { role?: string } | undefined;
    if (message?.role !== "assistant") return;
    // Assemble the streaming message ourselves: `message_update` carries deltas
    // only, and a client connecting mid-turn must still see the reply so far.
    this.partial = { role: "assistant", content: [], timestamp: Date.now() };
    this.messages = [...this.messages, this.partial];
    this.emit({ type: "assistant_start" });
  }

  private onMessageUpdate(record: RpcIncoming): void {
    const delta = record.assistantMessageEvent as Record<string, unknown> | undefined;
    if (delta === undefined || typeof delta.type !== "string") return;
    const index = typeof delta.contentIndex === "number" ? delta.contentIndex : 0;
    const content = this.partial?.content;
    switch (delta.type) {
      case "text_start":
        if (content) content[index] = { type: "text", text: "" };
        break;
      case "text_delta":
        if (content) {
          // `??=` alone was not enough: a reused contentIndex can already hold the
          // tool-call object a previous `toolcall_end` put there, and appending to its
          // absent `.text` writes the literal "undefined" into the transcript. The
          // block has to be the right *kind*, not merely present.
          const block = (content[index] = asBlock(content[index], "text", { type: "text", text: "" })) as { text: string };
          block.text += String(delta.delta ?? "");
        }
        this.emit({ type: "block_delta", block: "text", contentIndex: index, delta: String(delta.delta ?? "") });
        break;
      case "thinking_start":
        if (content) content[index] = { type: "thinking", thinking: "" };
        break;
      case "thinking_delta":
        if (content) {
          const block = (content[index] = asBlock(content[index], "thinking", { type: "thinking", thinking: "" })) as {
            thinking: string;
          };
          block.thinking += String(delta.delta ?? "");
        }
        this.emit({ type: "block_delta", block: "thinking", contentIndex: index, delta: String(delta.delta ?? "") });
        break;
      case "toolcall_end":
        if (content && delta.toolCall !== undefined) content[index] = delta.toolCall;
        break;
      default:
        break;
    }
  }

  private onMessageEnd(record: RpcIncoming): void {
    const message = record.message as { role?: string; display?: boolean } | undefined;
    if (message?.role === "assistant") {
      // The finished message is authoritative — swap it in for whatever we assembled.
      if (this.partial !== undefined) {
        const at = this.messages.lastIndexOf(this.partial);
        if (at !== -1) this.messages = this.messages.with(at, message);
        else this.messages = [...this.messages, message];
        this.partial = undefined;
      } else {
        this.messages = [...this.messages, message];
      }
      this.emit({ type: "assistant_end", message });
      return;
    }
    if (message === undefined) return;
    if (message.role === "custom") {
      this.messages = [...this.messages, message];
      if (message.display) this.emit({ type: "custom_message", message });
      return;
    }
    // User, tool-result and bash-execution messages: history only, no browser event
    // (the browser already echoed its own prompt, and tool cards come from the
    // tool_execution_* events).
    this.messages = [...this.messages, message];
  }

  private onExtensionUiRequest(record: RpcIncoming): void {
    const id = typeof record.id === "string" ? record.id : undefined;
    const method = typeof record.method === "string" ? record.method : undefined;
    if (id === undefined || method === undefined) return;
    if (DIALOG_METHODS.has(method)) {
      this.openDialogs.add(id);
      this.process.suspendCommandTimeout("prompt");
    }
    // The wire type mirrors Pi's own RPC shape (see shared/src/protocol.ts), so the
    // request travels to the browser unchanged rather than being rebuilt field by field.
    this.emit({ type: "extension_ui_request", request: record as unknown as ExtensionUIRequest });
  }

  // --- state readers -------------------------------------------------------

  snapshot(): RuntimeSnapshot {
    return {
      sessionId: this.sessionId,
      ...(this.sessionFile ? { sessionFile: this.sessionFile } : {}),
      ...(this.model ? { model: this.model } : {}),
      thinkingLevel: this.thinkingLevel,
      ...(this.acceptedThinkingLevels ? { thinkingLevels: this.acceptedThinkingLevels } : {}),
      isStreaming: this.streaming,
      messages: this.messages,
      models: this.availableModels,
      commands: this.availableCommands,
      resources: this.availableResources,
      resourceCapabilities: {
        skills: this.availableResources.some((resource) => resource.kind === "skill") ? "available" : "unavailable",
        // Standard RPC has no independent extension inventory. Commands provide
        // provenance for command-bearing extensions only, never a complete list.
        extensions: "unavailable",
      },
      contextUsage: this.usage,
      // Pi RPC exposes no provider or credential inventory, so onboarding cannot be
      // driven from here. `usableModel` still answers correctly off the model list.
      providers: [],
      // Nor the loaded extension paths. Omitted rather than empty: the child may well
      // have loaded several, and reporting none would state as fact something this
      // server was never told.
    };
  }

  tree(): { roots: RuntimeTreeNode[]; leafId: string | null } {
    return { roots: this.treeRoots, leafId: this.leafId };
  }

  entries(): RuntimeEntry[] {
    return this.sessionEntries;
  }

  /**
   * Entries on the active branch, root to leaf.
   *
   * The embedded runtime gets this from `buildContextEntries()`; Pi RPC has no such
   * command, so it is derived from the tree — which is what "the active branch"
   * means. Unlike the SDK's version this does not drop pre-compaction history, so a
   * heavily compacted session lists a few more editable prompts than embedded would.
   */
  contextEntries(): RuntimeEntry[] {
    const leaf = this.leafId;
    if (leaf === null) return [];
    const path: RuntimeEntry[] = [];
    const walk = (node: RuntimeTreeNode): boolean => {
      path.push(node.entry);
      if (node.entry.id === leaf) return true;
      for (const child of node.children) {
        if (walk(child)) return true;
      }
      path.pop();
      return false;
    };
    for (const root of this.treeRoots) {
      if (walk(root)) return path;
    }
    return [];
  }

  // --- commands ------------------------------------------------------------

  private async command(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (this.failed !== undefined) throw new Error(this.failed);
    return await this.process.command(type, payload);
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    const images = options?.images;
    const payload: Record<string, unknown> = {
      message: text,
      ...(images?.length ? { images: images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType })) } : {}),
      // Pi refuses a prompt sent while it is streaming unless the caller says what to
      // do with it. Steering matches the embedded runtime's behaviour exactly.
      ...(this.streaming ? { streamingBehavior: "steer" } : {}),
    };
    try {
      await this.command("prompt", payload);
    } catch (error) {
      // Rejected *before* acceptance — the initiating client is told, and no user
      // bubble is echoed. A failure after acceptance never arrives here; it shows up
      // in the streamed events instead.
      options?.onAccepted?.(false);
      throw error;
    }
    // An accepted prompt means the child is busy now, whatever the event stream has
    // caught up to. `streaming` is otherwise set from the queued `agent_start`, which
    // can sit behind a four-round-trip refresh — and for those hundreds of
    // milliseconds the next prompt would go out with no `streamingBehavior` and be
    // rejected outright. The embedded runtime reads `isStreaming` synchronously and
    // never has that window.
    this.streaming = true;
    options?.onAccepted?.(true);
  }

  async abort(): Promise<void> {
    await this.command("abort");
  }

  async setModel(provider: string, id: string): Promise<RuntimeModel> {
    const data = await this.command("set_model", { provider, modelId: id });
    // A dialect that answers `set_model` with nothing, or with a model missing
    // `reasoning`, must not cost the model its thinking control: the catalog already
    // says whether it reasons, and the answer does not change with the selection.
    const answered = toModel(data);
    const known = this.availableModels.find((choice) => choice.provider === provider && choice.id === id);
    const model = {
      ...(answered ?? { provider, id, ...(known?.name ? { name: known.name } : {}) }),
      ...(answered?.reasoning === undefined && known ? { reasoning: known.reasoning } : {}),
    };
    this.model = model;
    // A different model accepts a different set of thinking levels.
    await this.refreshThinkingLevels();
    // ...and the child clamps the session's level to the new model inside `set_model`
    // without any record to say so — RPC pushes no thinking-level event. Re-read the
    // state, or this mirror keeps reporting the previous model's level for a model
    // that never accepted it.
    await this.refreshThinkingLevel();
    return model;
  }

  /**
   * Not expressible: the RPC dialect has no command for the active toolset, so the
   * child publishes everything it was launched with. Saying so is the contract —
   * emulating it here would mean lying about what the agent can see.
   */
  setToolPublished(): boolean {
    return false;
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.command("set_thinking_level", { level });
    this.thinkingLevel = level;
  }

  async compact(): Promise<void> {
    await this.command("compact");
  }

  async setSessionName(name: string): Promise<void> {
    await this.command("set_session_name", { name });
  }

  async newSession(): Promise<{ cancelled: boolean }> {
    const data = (await this.command("new_session")) as { cancelled?: boolean } | undefined;
    const cancelled = data?.cancelled === true;
    if (!cancelled) await this.rebootstrap();
    return { cancelled };
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const data = (await this.command("switch_session", { sessionPath })) as { cancelled?: boolean } | undefined;
    const cancelled = data?.cancelled === true;
    if (!cancelled) await this.rebootstrap();
    return { cancelled };
  }

  async fork(entryId: string): Promise<{ cancelled: boolean; selectedText?: string }> {
    const data = (await this.command(this.forkCommand, { entryId })) as { cancelled?: boolean; text?: unknown } | undefined;
    const cancelled = data?.cancelled === true;
    if (!cancelled) await this.rebootstrap();
    return { cancelled, ...(typeof data?.text === "string" ? { selectedText: data.text } : {}) };
  }

  // `navigateTree` is deliberately absent: Pi RPC forks and clones but has no
  // command that moves the leaf within a session. index.ts refuses the browser's
  // navigate_tree and edit_prompt with a message naming this runtime, rather than
  // dropping them.

  answerExtensionUI(response: ExtensionUIResponse): void {
    // Only an id we are actually waiting on. Anything else is a client answering a
    // question nobody asked — the embedded bridge checks the same thing — and
    // forwarding it would write an unsolicited record onto the child's stdin.
    if (!this.openDialogs.has(response.id)) return;
    this.openDialogs.delete(response.id);
    void this.process
      .notify(response as unknown as Record<string, unknown>)
      .then(() => {
        if (this.openDialogs.size === 0) this.process.resumeCommandTimeout("prompt");
      })
      .catch(() => {});
  }

  cancelPendingExtensionRequests(): void {
    this.releaseDialogs();
  }

  /** Answer every blocked dialog with a cancellation so no extension is left waiting. */
  private releaseDialogs(): void {
    for (const id of this.openDialogs) {
      void this.process.notify({ type: "extension_ui_response", id, cancelled: true }).catch(() => {});
    }
    this.openDialogs.clear();
    this.process.resumeCommandTimeout("prompt");
  }

  // No `credentials`: Pi RPC has no command that would reach the child's own model
  // registry, so a key written here would sit on disk while the running agent still
  // reported none. No `renderers`: extension renderers are in-process objects. No
  // `titles`: titling needs one direct model call with the session's credentials.
  // No `rebuildTools`: the child owns its toolset. index.ts refuses each of these
  // explicitly rather than accepting the command and doing nothing.

  async dispose(): Promise<void> {
    await this.process.stop();
  }
}

function toModel(value: unknown): RpcModel | undefined {
  const model = value as { provider?: unknown; id?: unknown; name?: unknown; reasoning?: unknown } | null | undefined;
  if (!model || typeof model.provider !== "string" || typeof model.id !== "string") return undefined;
  return {
    provider: model.provider,
    id: model.id,
    ...(typeof model.name === "string" ? { name: model.name } : {}),
    ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function flattenEntries(roots: RuntimeTreeNode[]): RuntimeEntry[] {
  const entries: RuntimeEntry[] = [];
  const visit = (node: RuntimeTreeNode) => {
    entries.push(node.entry);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return entries;
}

function linearTree(entries: RuntimeEntry[]): RuntimeTreeNode[] {
  let children: RuntimeTreeNode[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    children = [{ entry: entries[index], children }];
  }
  return children;
}

function isContextUsage(value: unknown): value is ContextUsage {
  const usage = value as ContextUsage | undefined;
  return (
    typeof usage === "object" &&
    usage !== null &&
    typeof usage.contextWindow === "number" &&
    (usage.tokens === null || typeof usage.tokens === "number")
  );
}

/**
 * Did the child say it has no such command, or did something else go wrong?
 *
 * The distinction decides between degrading gracefully and failing closed, and the
 * only evidence is prose an agent wrote. Pi says `Unknown command: get_tree`; a fork
 * is free to say `Unknown command 'get_tree'` or `unsupported command: get_tree`,
 * and matching one exact sentence turned an intended degradation into a hard
 * bootstrap failure. So: the command's own name must appear, next to a word that
 * means "we do not have this" — both, so an unrelated error mentioning the command
 * is not mistaken for absence.
 */
const ABSENT_COMMAND_WORDS = /\b(unknown|unrecognized|unrecognised|unsupported|unimplemented|not\s+(?:a\s+)?(?:known|supported|implemented|recognized|recognised))\b/;

/** The block at this index if it is of the wanted kind, otherwise a fresh one. */
function asBlock(existing: unknown, kind: string, fresh: unknown): unknown {
  return typeof existing === "object" && existing !== null && (existing as { type?: unknown }).type === kind ? existing : fresh;
}

function isUnknownCommand(error: unknown, command: string): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes(command.toLowerCase()) && ABSENT_COMMAND_WORDS.test(message);
}
