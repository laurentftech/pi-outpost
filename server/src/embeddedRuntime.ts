/**
 * The default agent runtime: a Pi SDK `AgentSession` living in this process.
 *
 * Everything here was in index.ts before the runtime boundary existed, and the
 * translation it does is deliberately thin — the normalized event union and the
 * snapshot were derived *from* this backend, so any divergence would be a bug
 * rather than an adaptation. The RPC runtime is the one doing real work to match.
 */
import type { AgentSession, CreateAgentSessionRuntimeFactory, SessionManager } from "@earendil-works/pi-coding-agent";
import { createAgentSessionRuntime } from "@earendil-works/pi-coding-agent";
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
  CredentialCapability,
  PromptOptions,
  ProviderStatus,
  RenderCapability,
  RuntimeEntry,
  RuntimeEvent,
  RuntimeModel,
  RuntimeSnapshot,
  RuntimeTreeNode,
  TitleCapability,
} from "./agentRuntime.ts";
import { toolUpdateEvent } from "./agentRuntime.ts";
import { CredentialError, providerConfig, type ProviderDeclaration, storeApiKey, storeProvider } from "./credentials.ts";
import { ExtensionUiBridge } from "./extensionUiBridge.ts";
import { generateSessionTitle } from "./sessions.ts";

export interface EmbeddedRuntimeOptions {
  factory: CreateAgentSessionRuntimeFactory;
  cwd: string;
  agentDir: string;
  sessionManager: SessionManager;
  /** Where the SDK's own model fallback warning goes, if it made one. */
  onModelFallback?: (message: string) => void;
}

/**
 * How long a caller waits on `bindExtensions` before it stops holding the session
 * it has behind the extensions it does not have yet.
 *
 * Past it, startup serves the interface and a `/new` hands over its session; the
 * binding finishes behind either, and says so when it lands.
 */
const BIND_STALL_MS = 5000;

/** Total build time past which startup says where the time went, rather than only being slow. */
const SLOW_BUILD_MS = 2000;

/** How many events are held for a subscriber that has not arrived yet. */
const MAX_BUFFERED_EVENTS = 100;

/** One decimal is the resolution anyone acts on here. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function createEmbeddedRuntime(options: EmbeddedRuntimeOptions): Promise<AgentRuntime> {
  // AgentSessionRuntime keeps the factory it is constructed with for every later
  // new/resume/fork. Keep that factory indirect so a Settings update can replace
  // the sandboxed toolset before starting the replacement session.
  let currentFactory = options.factory;
  const sessionStartedAt = Date.now();
  const runtime = await createAgentSessionRuntime((factoryOptions) => currentFactory(factoryOptions), {
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager: options.sessionManager,
  });
  const loadMs = Date.now() - sessionStartedAt;
  if (runtime.modelFallbackMessage) options.onModelFallback?.(runtime.modelFallbackMessage);
  const embedded = new EmbeddedRuntime(runtime, options.agentDir, (factory) => {
    const previous = currentFactory;
    currentFactory = factory;
    return previous;
  });
  const bindStartedAt = Date.now();
  await embedded.bind();
  const bindMs = Date.now() - bindStartedAt;
  // A slow start was previously indistinguishable from a wedged one, and the two
  // halves fail for unrelated reasons: loading is the SDK compiling and evaluating
  // every extension, binding is those extensions' own `session_start` handlers —
  // a language server starting, a repository being indexed, a question nobody can
  // answer yet. Only the second can be served around, so name both.
  if (loadMs + bindMs >= SLOW_BUILD_MS) {
    console.warn(
      `[pi] agent runtime built in ${seconds(loadMs + bindMs)} — session and extension load ${seconds(loadMs)}, extension bind ${seconds(bindMs)}`,
    );
  }
  return embedded;
}

/**
 * Whether `work` settles within `ms`.
 *
 * A rejection inside the window is re-thrown, because that is the caller's failure
 * to handle exactly as if it had awaited directly. A rejection *after* the window
 * belongs to whoever kept the original promise: this must not leave a second,
 * unobserved promise rejecting on its own, so the race observes an outcome rather
 * than reproducing it.
 */
async function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  const observed = work.then(
    () => true as const,
    (error: unknown) => ({ error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Not unref'd: the timer is the only thing holding this wait together, and it is
  // always cleared below — an unref'd one lets a process with nothing else running
  // resolve its loop out from under the await.
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const outcome = await Promise.race([observed, timedOut]);
  if (timer) clearTimeout(timer);
  if (outcome === false) return false;
  if (outcome !== true) throw outcome.error;
  return true;
}

type SdkRuntime = Awaited<ReturnType<typeof createAgentSessionRuntime>>;

/**
 * Exported for the tests that drive one method against a stand-in session. Everything
 * else builds one through `createEmbeddedRuntime`, which needs a real SDK runtime.
 */
export class EmbeddedRuntime implements AgentRuntime {
  readonly kind = "embedded";
  readonly ok = true;

  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly bridge = new ExtensionUiBridge((request) => this.emit({ type: "extension_ui_request", request }));
  private unsubscribe: () => void = () => {};
  /**
   * Events emitted before anything subscribed.
   *
   * Binding starts inside `createEmbeddedRuntime`, before the server holds the
   * runtime it subscribes to — so an extension that asks a question from its
   * `session_start` handler emitted into an empty listener set and the dialog was
   * dropped. Its handler then waited on an answer nobody could be shown how to
   * give, and the whole startup stood behind that wait. Held here instead and
   * replayed to the first subscriber, which is the same moment any event arriving
   * a millisecond later would reach.
   */
  private readonly buffered: RuntimeEvent[] = [];
  /** Whether the replay has happened; after it, an empty listener set means nobody is listening. */
  private replayed = false;

  constructor(
    private readonly runtime: SdkRuntime,
    private readonly agentDir: string,
    private readonly replaceFactory?: (factory: CreateAgentSessionRuntimeFactory) => CreateAgentSessionRuntimeFactory,
  ) {}

  private get session(): AgentSession {
    return this.runtime.session;
  }

  private emit(event: RuntimeEvent): void {
    if (!this.replayed) {
      // Bounded: the buffer exists for a dialog and the handful of notifications
      // around it. A binding that emits more than this before anyone is listening
      // is not a stream anyone is going to read back.
      if (this.buffered.length < MAX_BUFFERED_EVENTS) this.buffered.push(event);
      return;
    }
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    if (!this.replayed) {
      this.replayed = true;
      for (const event of this.buffered.splice(0)) listener(event);
    }
    return () => this.listeners.delete(listener);
  }

  // --- state ---------------------------------------------------------------

  snapshot(): RuntimeSnapshot {
    const session = this.session;
    const model = session.model as { provider?: string; id?: string; name?: string; reasoning?: boolean } | undefined;
    // The SDK knows which levels this model honours; a missing method (older SDK)
    // or a throw degrades to "cannot say", and the client offers the full set.
    let acceptedLevels: unknown;
    try {
      acceptedLevels = (session as { getAvailableThinkingLevels?: () => unknown }).getAvailableThinkingLevels?.();
    } catch {
      acceptedLevels = undefined;
    }
    const thinkingLevels = normalizeThinkingLevels(acceptedLevels);
    return {
      sessionId: session.sessionId,
      sessionFile: session.sessionManager.getSessionFile(),
      ...(model?.provider && model.id
        ? { model: { provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning } }
        : {}),
      thinkingLevel: session.thinkingLevel as ThinkingLevel,
      ...(thinkingLevels ? { thinkingLevels } : {}),
      isStreaming: session.isStreaming,
      messages: session.messages as unknown[],
      models: this.models(),
      commands: this.commands(),
      resources: this.resources(),
      resourceCapabilities: { skills: "available", extensions: "available" },
      contextUsage: session.getContextUsage() as ContextUsage | undefined,
      providers: this.providers(),
      extensionPaths: session.extensionRunner.getExtensionPaths(),
      tools: this.tools(),
    };
  }

  private models(): ModelChoice[] {
    return this.runtime.services.modelRuntime.getAvailableSnapshot().map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
    }));
  }

  private tools(): { name: string; active: boolean }[] {
    const active = new Set(this.session.getActiveToolNames());
    return this.session
      .getAllTools()
      .map((tool) => ({ name: tool.name, active: active.has(tool.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Which providers can answer, and whether their credentials resolve. Kept apart
   * from the model list because "nothing is configured" (onboard the user) and
   * "configured, but `allowedModels` leaves nothing" are different problems.
   */
  private providers(): ProviderStatus[] {
    const modelRuntime = this.runtime.services.modelRuntime;
    const providers = new Map<string, ProviderStatus>();
    for (const provider of modelRuntime.getProviders()) {
      if (providers.has(provider.id)) continue;
      providers.set(provider.id, {
        id: provider.id,
        name: provider.name ?? provider.id,
        configured: modelRuntime.getProviderAuthStatus(provider.id).configured,
      });
    }
    return [...providers.values()];
  }

  /**
   * Slash commands the composer can autocomplete. `session.prompt()` understands
   * all three: extension commands run immediately, prompt templates and
   * `/skill:name` are expanded before being sent to the model.
   */
  private commands(): CommandInfo[] {
    const commands: CommandInfo[] = [];
    for (const command of this.session.extensionRunner.getRegisteredCommands()) {
      commands.push({
        name: command.invocationName,
        ...(command.description ? { description: command.description } : {}),
        source: "extension",
      });
    }
    const { prompts } = this.runtime.services.resourceLoader.getPrompts();
    for (const prompt of prompts) {
      commands.push({
        name: prompt.name,
        ...(prompt.description ? { description: prompt.description } : {}),
        ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
        source: "prompt",
      });
    }
    const { skills } = this.runtime.services.resourceLoader.getSkills();
    for (const skill of skills) {
      commands.push({
        name: `skill:${skill.name}`,
        ...(skill.description ? { description: skill.description } : {}),
        source: "skill",
      });
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  private resources(): AgentResourceInfo[] {
    const resources: AgentResourceInfo[] = [];
    const { skills } = this.runtime.services.resourceLoader.getSkills();
    for (const skill of skills) {
      const resourcePath = skill.filePath || skill.sourceInfo?.path;
      resources.push({
        id: `skill:${resourcePath || skill.name}`,
        kind: "skill",
        name: skill.name,
        origin: /built|bundled/i.test(skill.sourceInfo?.source ?? "") ? "built-in" : "runtime",
        ...(resourcePath ? { path: resourcePath } : { unavailableReason: "This runtime did not report a skill path" }),
      });
    }
    for (const extensionPath of this.session.extensionRunner.getExtensionPaths()) {
      const name = extensionPath.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/\.[^.]+$/, "") ?? extensionPath;
      resources.push({ id: `extension:${extensionPath}`, kind: "extension", name, origin: "runtime", path: extensionPath });
    }
    return resources.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  tree(): { roots: RuntimeTreeNode[]; leafId: string | null } {
    const manager = this.session.sessionManager;
    return { roots: manager.getTree() as RuntimeTreeNode[], leafId: manager.getLeafId() ?? null };
  }

  entries(): RuntimeEntry[] {
    return this.session.sessionManager.getEntries() as RuntimeEntry[];
  }

  contextEntries(): RuntimeEntry[] {
    return this.session.sessionManager.buildContextEntries() as RuntimeEntry[];
  }

  // --- binding -------------------------------------------------------------

  /**
   * Event subscriptions attach to one AgentSession — rebind after replacement.
   *
   * `graceMs` bounds how long the caller waits for the extensions themselves.
   * `bindExtensions` runs every extension's `session_start` handler, and there is
   * no bound on what one of those may do: start a language server, index a
   * repository, ask the user something. pi's own interactive mode renders and
   * subscribes before it awaits that call (`rebindCurrentSession({
   * renderBeforeBind: true })`); the server awaited it before it would serve at
   * all, so each of those seconds was a browser reconnecting against a socket
   * answering 1013 "starting up", with nothing in the log but the stall warning.
   *
   * The same bound covers a session replacement, where the identical wait sat
   * between `/new` and a usable session. The session object exists either way
   * before its extensions have finished starting up, and it is the session the
   * caller is waiting for: the tools were registered when the extensions loaded,
   * and what binding adds — contributed skills, a `session_start` handler's own
   * work — arrives afterwards through `extensions_bound`.
   */
  async bind(options?: { graceMs?: number }): Promise<void> {
    this.unsubscribe = this.session.subscribe((event: any) => this.translate(event));
    const bound = this.session;
    const startedAt = Date.now();
    const binding = this.bindExtensions();
    if (await settlesWithin(binding, options?.graceMs ?? BIND_STALL_MS)) return;
    console.warn(
      `[pi] extensions have not bound after ${seconds(options?.graceMs ?? BIND_STALL_MS)} — the session is usable now; they attach when they finish`,
    );
    void binding.then(
      () => {
        // A binding left behind by a session that has since been replaced has
        // nothing to announce: its skills went with it, and the snapshot the
        // announcement refreshes describes the session that took its place.
        if (this.session !== bound) return;
        this.emit({ type: "extensions_bound", elapsedMs: Date.now() - startedAt });
      },
      (error: unknown) => {
        // Not fatal the way a failure inside the grace is: the session is already
        // serving, so this is reported and the runtime keeps the tools it has.
        if (this.session !== bound) return;
        this.emit({ type: "error", message: `[extensions] ${error instanceof Error ? error.message : String(error)}` });
      },
    );
  }

  private translate(event: any): void {
    switch (event.type) {
      case "agent_start":
        this.emit({ type: "agent_start" });
        break;
      case "agent_end":
        this.emit({ type: "agent_end" });
        break;
      case "message_start":
        if (event.message.role === "assistant") this.emit({ type: "assistant_start" });
        break;
      case "message_update": {
        const delta = event.assistantMessageEvent;
        if (delta.type === "text_delta") {
          this.emit({ type: "block_delta", block: "text", contentIndex: delta.contentIndex, delta: delta.delta });
        } else if (delta.type === "thinking_delta") {
          this.emit({ type: "block_delta", block: "thinking", contentIndex: delta.contentIndex, delta: delta.delta });
        }
        break;
      }
      case "message_end":
        if (event.message.role === "assistant") {
          this.emit({ type: "assistant_end", message: event.message });
        } else if (event.message.role === "custom" && event.message.display) {
          this.emit({ type: "custom_message", message: event.message });
        }
        break;
      case "tool_execution_start":
        this.emit({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
        break;
      case "tool_execution_update":
        this.emit(toolUpdateEvent(event.toolCallId, event.partialResult));
        break;
      case "tool_execution_end":
        this.emit({
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName ?? "tool",
          content: event.result?.content,
          details: event.result?.details,
          isError: event.isError ?? false,
        });
        break;
      case "queue_update":
        this.emit({ type: "queue", steering: [...event.steering], followUp: [...event.followUp] });
        break;
      case "thinking_level_changed":
        this.emit({ type: "thinking_changed", level: event.level as ThinkingLevel });
        break;
      case "compaction_start":
        this.emit({ type: "compaction_start" });
        break;
      case "compaction_end":
        this.emit({ type: "compaction_end", ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}) });
        break;
      default:
        break;
    }
  }

  /**
   * (Re)bind the extension runtime — UI bridge, mode, error reporting — to the
   * current session.
   *
   * This has been observed never to settle: an extension whose `session_start`
   * handler asks a question waits for an answer, and until a client is listening
   * there is nobody to ask. Whether the caller waits for it is `bind()`'s decision.
   */
  private async bindExtensions(): Promise<void> {
    await this.session.bindExtensions({
      // Cast: structurally satisfies ExtensionUIContext (verified against the SDK's
      // own RPC-mode implementation); see the `theme` getter for the one gap.
      uiContext: this.bridge.createContext() as any,
      mode: "rpc",
      shutdownHandler: () => {
        // Unlike pi's one-shot RPC subprocess, this server is long-lived and shared
        // across tabs/sessions — an extension asking to "shut down" shouldn't kill it.
        console.warn("[pi] extension requested shutdown — ignored (pi-outpost is a persistent server)");
      },
      onError: (err) => {
        this.emit({ type: "error", message: `[extension ${err.extensionPath}] ${err.error}` });
      },
    });
  }

  /** After a session replacement, `runtime.session` is a new object — rewire everything to it. */
  private async rebind(): Promise<void> {
    this.bridge.cancelAll();
    this.unsubscribe();
    await this.bind();
    this.emit({ type: "session_replaced" });
  }

  // --- commands ------------------------------------------------------------

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    const session = this.session;
    const images = options?.images;
    await session.prompt(text, {
      preflightResult: (accepted: boolean) => options?.onAccepted?.(accepted),
      ...(images?.length ? { images: images.map((image) => ({ type: "image" as const, ...image })) } : {}),
      ...(session.isStreaming ? { streamingBehavior: "steer" as const } : {}),
    } as never);
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  async setModel(provider: string, id: string): Promise<RuntimeModel> {
    const model = this.runtime.services.modelRuntime.getModel(provider, id);
    if (!model) throw new Error(`Unknown model ${provider}/${id}`);
    await this.session.setModel(model);
    return { provider: model.provider, id: model.id, name: model.name, reasoning: model.reasoning };
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    this.session.setThinkingLevel(level as never);
  }

  /**
   * `setActiveToolsByName` rebuilds the system prompt around the new set, so a tool
   * withheld here is not described either — which is the point: the schema is what
   * costs, and it is sent on every request whether or not anything uses it.
   *
   * Idempotent, and silent about a name the session never registered: the caller is
   * describing what should be published, not asserting what exists.
   */
  setToolPublished(name: string, published: boolean): boolean {
    if (this.session.getToolDefinition(name) === undefined) return false;
    const active = new Set(this.session.getActiveToolNames());
    if (active.has(name) === published) return true;
    if (published) active.add(name);
    else active.delete(name);
    this.session.setActiveToolsByName([...active]);
    return true;
  }

  async compact(): Promise<void> {
    await this.session.compact();
  }

  async setSessionName(name: string): Promise<void> {
    this.session.setSessionName(name);
  }

  async newSession(): Promise<{ cancelled: boolean }> {
    const result = await this.runtime.newSession();
    if (!result.cancelled) await this.rebind();
    return result;
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const result = await this.runtime.switchSession(sessionPath);
    if (!result.cancelled) await this.rebind();
    return result;
  }

  async fork(entryId: string): Promise<{ cancelled: boolean; selectedText?: string }> {
    const result = await this.runtime.fork(entryId);
    if (!result.cancelled) await this.rebind();
    return result;
  }

  async navigateTree(entryId: string): Promise<{ cancelled: boolean; editorText?: string }> {
    return await this.session.navigateTree(entryId);
  }

  /**
   * Rebuild the toolset by starting a fresh session: the runtime factory reads the
   * sandbox configuration when it constructs a session, so a new one is what makes
   * an updated sandbox take effect.
   */
  async rebuildTools(factory?: CreateAgentSessionRuntimeFactory): Promise<{ cancelled: boolean }> {
    const previousSession = this.session;
    let previousFactory: CreateAgentSessionRuntimeFactory | undefined;
    if (factory) {
      if (!this.replaceFactory) throw new Error("This embedded runtime cannot replace its session factory");
      previousFactory = this.replaceFactory(factory);
    }
    try {
      const result = await this.newSession();
      // A session_before_switch extension veto leaves the current session alive.
      // Its retained factory must stay paired with that session too: otherwise a
      // later user-created session would unexpectedly adopt settings we refused.
      if (result.cancelled && previousFactory && this.replaceFactory) this.replaceFactory(previousFactory);
      return result;
    } catch (error) {
      // bindExtensions can throw after the SDK has already installed the new
      // session. In that case the replacement factory belongs to the live session
      // and must remain current for recovery and later user-created sessions.
      // Restore only when the switch failed before the session object changed.
      if (this.session === previousSession && previousFactory && this.replaceFactory) {
        this.replaceFactory(previousFactory);
      }
      throw error;
    }
  }

  answerExtensionUI(response: ExtensionUIResponse): void {
    this.bridge.answer(response);
  }

  cancelPendingExtensionRequests(): void {
    this.bridge.cancelAll();
  }

  // --- capabilities --------------------------------------------------------

  readonly renderers: RenderCapability = {
    getToolDefinition: (name: string) => this.session.getToolDefinition(name),
    getMessageRenderer: (customType: string) => this.session.extensionRunner.getMessageRenderer(customType),
  };

  readonly credentials: CredentialCapability = {
    storeApiKey: async (provider: string, apiKey: string, signal: AbortSignal) => {
      // Through the session's own ModelRuntime: the live registry reads its auth
      // through that instance, so a key written with any other one would sit on
      // disk while the agent still claims to have none.
      await storeApiKey(this.agentDir, provider, apiKey, this.runtime.services.modelRuntime, { signal });
    },
    declareProvider: async (provider: ProviderDeclaration) => {
      try {
        // Register *first*: it validates, and a declaration the registry rejects must
        // never reach models.json. The SDK falls back to built-in models only when that
        // file does not load — one bad entry would take the user's other providers with it.
        this.runtime.services.modelRuntime.registerProvider(provider.provider, providerConfig(provider));
        await storeProvider(this.agentDir, provider);
      } catch (error) {
        this.runtime.services.modelRuntime.unregisterProvider(provider.provider);
        throw error instanceof CredentialError ? error : new Error(String(error));
      }
    },
    refreshModels: async (signal: AbortSignal) => {
      return await this.runtime.services.modelRuntime.refresh({ signal });
    },
    adoptModel: async (model: RuntimeModel) => {
      const target = this.runtime.services.modelRuntime.getModel(model.provider, model.id);
      if (target) await this.session.setModel(target);
    },
  };

  readonly titles: TitleCapability = {
    generateTitle: async (exchange: string, signal: AbortSignal) => {
      const session = this.session;
      const model = session.model;
      if (!model) return undefined;
      const auth = await this.runtime.services.modelRuntime.getAuth(model);
      if (!auth) return undefined;
      return await generateSessionTitle({
        exchange,
        model,
        auth: {
          apiKey: auth.auth.apiKey,
          headers: auth.auth.headers as Record<string, string> | undefined,
          env: auth.env,
        },
        // Same stream function as a real turn: a provider whose key lives in the
        // environment (the registry never resolves those) still authenticates.
        streamFn: session.agent.streamFunction,
        signal,
      });
    },
  };

  async dispose(): Promise<void> {
    this.unsubscribe();
    this.bridge.cancelAll();
    await this.runtime.dispose();
  }
}
