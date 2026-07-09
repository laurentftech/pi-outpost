/**
 * Pi-interface server: bridges a pi AgentSession to WebSocket clients.
 *
 * SECURITY: binds to 127.0.0.1 only (protects against the network) and
 * validates the Origin header on WebSocket upgrades (protects against
 * malicious webpages in the user's own browser — WS is exempt from CORS).
 * The agent has bash/edit/write tools: never weaken either check.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { WebSocket } from "ws";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  type ClientMessage,
  type CommandInfo,
  type ContextUsage,
  type ExtensionUIRequest,
  type ExtensionUIResponse,
  type ModelChoice,
  type ServerMessage,
  type SessionSnapshot,
  THINKING_LEVELS,
} from "@pi-interface/shared";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { assistantToItem, contentText, customMessageToItem, historyToItems, truncate } from "./convert.ts";
import { FileBrowserError, listDirectory, readFileForPreview, resolveBrowserRoot } from "./fileBrowser.ts";
import { createSandboxedTools } from "./sandbox.ts";

// npm workspace scripts run with cwd=server/ — INIT_CWD is where `npm run` was invoked
const BASE_CWD = process.env.PI_CWD ?? process.env.INIT_CWD ?? process.cwd();
const config = loadConfig(BASE_CWD);
const PORT = config.port;
const HOST = config.host;
const AGENT_CWD = config.cwd;
const AGENT_DIR = config.agentDir ?? getAgentDir();
// Own agentDir ⇒ own session store, fully separate from ~/.pi/agent
const SESSION_DIR = config.agentDir ? path.join(config.agentDir, "sessions") : undefined;

// --- Agent session runtime ---------------------------------------------------

const sandboxedTools = config.sandbox ? await createSandboxedTools(config.sandbox) : undefined;
const BROWSER_ROOT = await resolveBrowserRoot(config);

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({
    cwd,
    agentDir: config.agentDir,
    resourceLoaderOptions: {
      ...(config.noExtensions ? { noExtensions: true } : {}),
      ...(config.extensionPaths.length > 0
        ? { additionalExtensionPaths: config.extensionPaths }
        : {}),
    },
  });
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      // Sandbox replaces the built-in toolset with path-scoped equivalents
      ...(sandboxedTools ? { noTools: "builtin" as const, customTools: sandboxedTools } : {}),
      ...(!sandboxedTools && config.tools ? { tools: config.tools } : {}),
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: AGENT_CWD,
  agentDir: AGENT_DIR,
  sessionManager: SessionManager.create(AGENT_CWD, SESSION_DIR),
});

if (runtime.modelFallbackMessage) console.warn(`[pi] ${runtime.modelFallbackMessage}`);

function modelName(): string {
  const model = runtime.session.model as { provider?: string; id?: string } | undefined;
  return model ? `${model.provider}/${model.id}` : "unknown";
}

function contextUsage(): ContextUsage | undefined {
  return runtime.session.getContextUsage();
}

function availableModels(): ModelChoice[] {
  return runtime.services.modelRegistry.getAvailable().map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
  }));
}

/**
 * Slash commands the composer can autocomplete. session.prompt() understands
 * all three: extension commands run immediately, prompt templates and
 * /skill:name are expanded before being sent to the model.
 */
function availableCommands(): CommandInfo[] {
  const commands: CommandInfo[] = [];
  for (const command of runtime.session.extensionRunner.getRegisteredCommands()) {
    commands.push({
      name: command.invocationName,
      ...(command.description ? { description: command.description } : {}),
      source: "extension",
    });
  }
  const { prompts } = runtime.services.resourceLoader.getPrompts();
  for (const prompt of prompts) {
    commands.push({
      name: prompt.name,
      ...(prompt.description ? { description: prompt.description } : {}),
      ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
      source: "prompt",
    });
  }
  const { skills } = runtime.services.resourceLoader.getSkills();
  for (const skill of skills) {
    commands.push({
      name: `skill:${skill.name}`,
      ...(skill.description ? { description: skill.description } : {}),
      source: "skill",
    });
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Snapshot for `hello` / `session_replaced`. Mid-stream connects are covered:
 * the SDK pushes the partial assistant message into session.messages at
 * message_start, and historyToItems adds running tool cards for toolCalls
 * without a result yet.
 */
function snapshot(): SessionSnapshot {
  const session = runtime.session;
  return {
    branding: config.branding,
    sessionId: session.sessionId,
    model: modelName(),
    thinkingLevel: session.thinkingLevel,
    isStreaming: session.isStreaming,
    items: historyToItems(session.messages as never, session.isStreaming),
    models: availableModels(),
    commands: availableCommands(),
    contextUsage: contextUsage(),
  };
}

// --- WebSocket broadcast -------------------------------------------------------

const clients = new Set<WebSocket>();

function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

// --- Extension "Custom UI" bridge -----------------------------------------------
// See https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui
// Mirrors pi's own RPC-mode ExtensionUIContext (dialogs forwarded as JSON, client
// answers by id) but over the WebSocket instead of stdin/stdout, and broadcasts
// to every connected tab — whichever client answers first resolves the request.

type PendingExtensionRequest = { resolve: (response: ExtensionUIResponse) => void };
const pendingExtensionRequests = new Map<string, PendingExtensionRequest>();

/** Dialog helper: sends a request, resolves on the matching response, timeout, or abort. */
function createDialogPromise<T>(
  opts: { signal?: AbortSignal; timeout?: number } | undefined,
  defaultValue: T,
  request: Extract<ExtensionUIRequest, { method: "select" | "confirm" | "input" }>,
  parseResponse: (response: ExtensionUIResponse) => T,
): Promise<T> {
  if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
  const id = request.id;
  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      opts?.signal?.removeEventListener("abort", onAbort);
      pendingExtensionRequests.delete(id);
    };
    const onAbort = () => {
      cleanup();
      resolve(defaultValue);
    };
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts?.timeout) {
      timeoutId = setTimeout(() => {
        cleanup();
        resolve(defaultValue);
      }, opts.timeout);
    }
    pendingExtensionRequests.set(id, {
      resolve: (response) => {
        cleanup();
        resolve(parseResponse(response));
      },
    });
    broadcast(request);
  });
}

/**
 * Build the ExtensionUIContext bound to the current AgentSession. TUI-only
 * concerns (custom components, footers/headers, editor replacement, terminal
 * input, themes) have no web equivalent and are no-ops, same as pi's own RPC
 * mode — extensions relying on those still work in the pi CLI, just not here.
 */
function createExtensionUIContext() {
  return {
    select(title: string, options: string[], opts?: { signal?: AbortSignal; timeout?: number }) {
      const id = randomUUID();
      return createDialogPromise(opts, undefined, { type: "extension_ui_request", id, method: "select", title, options, timeout: opts?.timeout }, (r) =>
        "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
      );
    },
    confirm(title: string, message: string, opts?: { signal?: AbortSignal; timeout?: number }) {
      const id = randomUUID();
      return createDialogPromise(opts, false, { type: "extension_ui_request", id, method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
        "cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
      );
    },
    input(title: string, placeholder?: string, opts?: { signal?: AbortSignal; timeout?: number }) {
      const id = randomUUID();
      return createDialogPromise(
        opts,
        undefined,
        { type: "extension_ui_request", id, method: "input", title, placeholder, timeout: opts?.timeout },
        (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
      );
    },
    notify(message: string, notifyType?: "info" | "warning" | "error") {
      broadcast({ type: "extension_ui_request", id: randomUUID(), method: "notify", message, notifyType });
    },
    onTerminalInput() {
      // Raw terminal input has no web equivalent
      return () => {};
    },
    setStatus(statusKey: string, statusText: string | undefined) {
      broadcast({ type: "extension_ui_request", id: randomUUID(), method: "setStatus", statusKey, statusText });
    },
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget(
      widgetKey: string,
      content: string[] | undefined | ((...args: never[]) => unknown),
      options?: { placement?: "aboveEditor" | "belowEditor" },
    ) {
      // Component factories need a TUI to render into — only string arrays are supported here
      if (content === undefined || Array.isArray(content)) {
        broadcast({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey,
          widgetLines: content,
          widgetPlacement: options?.placement,
        });
      }
    },
    setFooter() {},
    setHeader() {},
    setTitle(title: string) {
      broadcast({ type: "extension_ui_request", id: randomUUID(), method: "setTitle", title });
    },
    async custom() {
      // Custom TUI components can't run in the browser
      return undefined;
    },
    pasteToEditor(text: string) {
      this.setEditorText(text);
    },
    setEditorText(text: string) {
      broadcast({ type: "extension_ui_request", id: randomUUID(), method: "set_editor_text", text });
    },
    getEditorText() {
      // Synchronous — can't wait on the client's current composer text
      return "";
    },
    editor(title: string, prefill?: string): Promise<string | undefined> {
      const id = randomUUID();
      return new Promise((resolve) => {
        pendingExtensionRequests.set(id, {
          resolve: (response) => {
            if ("cancelled" in response && response.cancelled) resolve(undefined);
            else if ("value" in response) resolve(response.value);
            else resolve(undefined);
          },
        });
        broadcast({ type: "extension_ui_request", id, method: "editor", title, prefill });
      });
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() {
      return undefined;
    },
    // Terminal ANSI theming has no web equivalent. Identity-returning stub (no
    // colors) rather than throwing, in case an extension reads it defensively.
    get theme() {
      const identity = (_color: unknown, text: string) => text;
      return {
        fg: identity,
        bg: identity,
        bold: (text: string) => text,
        italic: (text: string) => text,
        underline: (text: string) => text,
        inverse: (text: string) => text,
        strikethrough: (text: string) => text,
        getFgAnsi: () => "",
        getBgAnsi: () => "",
        getColorMode: () => "truecolor" as const,
        getThinkingBorderColor: () => (text: string) => text,
        getBashModeBorderColor: () => (text: string) => text,
      };
    },
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false, error: "Theme switching not supported in pi-interface" };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };
}

/** Resolve a pending dialog/editor request the client just answered. */
function handleExtensionUIResponse(response: ExtensionUIResponse): void {
  const pending = pendingExtensionRequests.get(response.id);
  if (!pending) return;
  pendingExtensionRequests.delete(response.id);
  pending.resolve(response);
}

/** (Re)bind the extension runtime — UI bridge, mode, error reporting — to the current session. */
async function bindExtensionsForSession(): Promise<void> {
  await runtime.session.bindExtensions({
    // Cast: structurally satisfies ExtensionUIContext (verified against the SDK's
    // own RPC-mode implementation); see the `theme` getter above for the one gap.
    uiContext: createExtensionUIContext() as any,
    mode: "rpc",
    // Extensions can call ctx.abort() themselves; no override needed here.
    // commandContextActions (fork/tree navigation) isn't wired up — out of scope for the UI bridge.
    shutdownHandler: () => {
      // Unlike pi's one-shot RPC subprocess, this server is long-lived and shared
      // across tabs/sessions — an extension asking to "shut down" shouldn't kill it.
      console.warn("[pi] extension requested shutdown — ignored (pi-interface is a persistent server)");
    },
    onError: (err) => {
      reportError(new Error(`[extension ${err.extensionPath}] ${err.error}`));
    },
  });
}

// --- SDK events -> wire events -------------------------------------------------

/** Event subscriptions attach to one AgentSession — rebind after replacement. */
function bindSession(): () => void {
  return runtime.session.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        broadcast({ type: "agent_start" });
        break;
      case "agent_end": {
        broadcast({ type: "agent_end" });
        const usage = contextUsage();
        if (usage) broadcast({ type: "context_usage", usage });
        break;
      }
      case "message_start":
        if (event.message.role === "assistant") {
          broadcast({ type: "assistant_start" });
        }
        break;
      case "message_update": {
        const e = event.assistantMessageEvent;
        if (e.type === "text_delta") {
          broadcast({ type: "block_delta", block: "text", contentIndex: e.contentIndex, delta: e.delta });
        } else if (e.type === "thinking_delta") {
          broadcast({ type: "block_delta", block: "thinking", contentIndex: e.contentIndex, delta: e.delta });
        }
        break;
      }
      case "message_end":
        if (event.message.role === "assistant") {
          // Full sync of the finished message (covers retries/partial rebuilds)
          broadcast({ type: "assistant_end", item: assistantToItem(event.message as never) });
        } else if (event.message.role === "custom" && (event.message as { display?: boolean }).display) {
          broadcast({ type: "custom_message", item: customMessageToItem(event.message as never) });
        }
        break;
      case "tool_execution_start":
        broadcast({
          type: "tool_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_update": {
        const text = contentText(event.partialResult?.content);
        if (text) {
          broadcast({ type: "tool_update", toolCallId: event.toolCallId, text: truncate(text) });
        }
        break;
      }
      case "tool_execution_end":
        broadcast({
          type: "tool_end",
          toolCallId: event.toolCallId,
          isError: event.isError,
          text: truncate(contentText(event.result?.content)),
        });
        break;
      case "queue_update":
        broadcast({ type: "queue", steering: [...event.steering], followUp: [...event.followUp] });
        break;
      case "thinking_level_changed":
        broadcast({ type: "thinking_changed", level: event.level });
        break;
      case "compaction_start":
        broadcast({ type: "compaction_start" });
        break;
      case "compaction_end": {
        broadcast({ type: "compaction_end", ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}) });
        const usage = contextUsage();
        if (usage) broadcast({ type: "context_usage", usage });
        break;
      }
      default:
        break;
    }
  });
}

let unsubscribe = bindSession();
await bindExtensionsForSession();

/** After runtime.newSession()/switchSession(), runtime.session is a new object. */
async function rebindAndAnnounce(): Promise<void> {
  unsubscribe();
  unsubscribe = bindSession();
  await bindExtensionsForSession();
  broadcast({ type: "session_replaced", ...snapshot() });
  console.log(`[pi] session ${runtime.session.sessionId}`);
}

// --- Client message handling -----------------------------------------------------

/**
 * Session replacement (new/switch) disposes the current AgentSession — never
 * run two concurrently, and never leave a disposed session wired on failure.
 */
let replacingSession = false;

async function replaceSession(socket: WebSocket, action: () => Promise<{ cancelled: boolean }>): Promise<void> {
  if (replacingSession) {
    send(socket, { type: "error", message: "Session change already in progress" });
    return;
  }
  replacingSession = true;
  try {
    const { cancelled } = await action();
    if (!cancelled) await rebindAndAnnounce();
  } catch (error) {
    reportError(error);
    // The old session may be disposed — land on a fresh one instead
    try {
      const { cancelled } = await runtime.newSession();
      if (!cancelled) await rebindAndAnnounce();
    } catch (recoveryError) {
      reportError(recoveryError);
    }
  } finally {
    replacingSession = false;
  }
}

async function handlePrompt(text: string): Promise<void> {
  const session = runtime.session;
  const options = {
    // Echo the user message only once accepted (avoids ghost bubbles on reject)
    preflightResult: (accepted: boolean) => {
      if (accepted) broadcast({ type: "user", text });
    },
    ...(session.isStreaming ? { streamingBehavior: "steer" as const } : {}),
  };
  await session.prompt(text, options);
}

/**
 * Session paths come from clients: only accept ones SessionManager.list
 * returns for this cwd (authoritative allowlist — no path traversal, and no
 * reading/persisting to attacker-chosen files via switch_session).
 */
async function isKnownSessionPath(path: string): Promise<boolean> {
  const sessions = await SessionManager.list(AGENT_CWD, SESSION_DIR);
  return sessions.some((info) => info.path === path);
}

/** Delete a saved session file (allowlisted path, never the live one). */
async function deleteSession(socket: WebSocket, path: string): Promise<void> {
  if (path === runtime.session.sessionFile) {
    send(socket, { type: "error", message: "Cannot delete the active session" });
    return;
  }
  if (!(await isKnownSessionPath(path))) {
    send(socket, { type: "error", message: "Unknown session" });
    return;
  }
  await fs.unlink(path);
  await listSessions(socket);
}

async function switchSession(socket: WebSocket, path: string): Promise<void> {
  if (!(await isKnownSessionPath(path))) {
    send(socket, { type: "error", message: "Unknown session" });
    return;
  }
  await replaceSession(socket, () => runtime.switchSession(path));
}

async function listSessions(socket: WebSocket): Promise<void> {
  const sessions = await SessionManager.list(AGENT_CWD, SESSION_DIR);
  send(socket, {
    type: "sessions",
    sessions: sessions
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .slice(0, 50)
      .map((info) => ({
        path: info.path,
        id: info.id,
        name: info.name,
        firstMessage: info.firstMessage.slice(0, 120),
        modified: info.modified.toISOString(),
        messageCount: info.messageCount,
      })),
  });
}

function reportError(error: unknown): void {
  broadcast({ type: "error", message: error instanceof Error ? error.message : String(error) });
}

/** File-browser sidebar: list a directory, confined to BROWSER_ROOT. */
async function handleListDirectory(socket: WebSocket, dirPath: string, requestId: string): Promise<void> {
  try {
    const entries = await listDirectory(BROWSER_ROOT, dirPath);
    send(socket, { type: "directory_listing", requestId, path: dirPath, entries });
  } catch (error) {
    const message = error instanceof FileBrowserError ? error.message : `Unexpected error: ${(error as Error).message}`;
    send(socket, { type: "file_browser_error", requestId, path: dirPath, message });
  }
}

/** File-browser sidebar: read a file for preview, confined to BROWSER_ROOT. */
async function handleReadFile(socket: WebSocket, filePath: string, requestId: string): Promise<void> {
  try {
    const { content, size } = await readFileForPreview(BROWSER_ROOT, filePath);
    send(socket, { type: "file_content", requestId, path: filePath, content, size });
  } catch (error) {
    const message = error instanceof FileBrowserError ? error.message : `Unexpected error: ${(error as Error).message}`;
    send(socket, { type: "file_browser_error", requestId, path: filePath, message });
  }
}

function handleClientMessage(socket: WebSocket, raw: string): void {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }
  // JSON.parse can yield null/primitives — never crash on a malformed frame
  if (typeof message !== "object" || message === null) return;
  switch (message.type) {
    case "prompt": {
      if (typeof message.text !== "string") return;
      const text = message.text.trim();
      if (!text) return;
      handlePrompt(text).catch(reportError);
      break;
    }
    case "abort":
      runtime.session.abort().catch(() => {});
      break;
    case "set_model": {
      if (typeof message.provider !== "string" || typeof message.id !== "string") return;
      const model = runtime.services.modelRegistry.find(message.provider, message.id);
      if (!model) {
        send(socket, { type: "error", message: `Unknown model ${message.provider}/${message.id}` });
        return;
      }
      runtime.session
        .setModel(model)
        .then(() => broadcast({ type: "model_changed", model: modelName(), reasoning: model.reasoning }))
        .catch(reportError);
      break;
    }
    case "set_thinking":
      if (!THINKING_LEVELS.includes(message.level)) return;
      try {
        runtime.session.setThinkingLevel(message.level);
        broadcast({ type: "thinking_changed", level: runtime.session.thinkingLevel });
      } catch (error) {
        reportError(error);
      }
      break;
    case "new_session":
      void replaceSession(socket, () => runtime.newSession());
      break;
    case "switch_session":
      if (typeof message.path !== "string") return;
      switchSession(socket, message.path).catch(reportError);
      break;
    case "delete_session":
      if (typeof message.path !== "string") return;
      deleteSession(socket, message.path).catch(reportError);
      break;
    case "list_sessions":
      listSessions(socket).catch(reportError);
      break;
    case "compact":
      // Failures surface via the compaction_end event (errorMessage) — avoid double-reporting.
      runtime.session.compact().catch(() => {});
      break;
    case "extension_ui_response":
      handleExtensionUIResponse(message);
      break;
    case "list_directory":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleListDirectory(socket, message.path, message.requestId).catch(reportError);
      break;
    case "read_file":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleReadFile(socket, message.path, message.requestId).catch(reportError);
      break;
  }
}

// --- HTTP server -------------------------------------------------------------------

const app = Fastify({ logger: false });
await app.register(websocket);

/**
 * WebSocket connections are exempt from the same-origin policy: any webpage
 * could otherwise connect to this localhost server and drive an agent that
 * has bash/write tools. Only accept browser connections from local dev
 * origins. Requests without an Origin header (non-browser clients: curl,
 * native tools) are allowed — a local process already has shell access.
 */
const ORIGIN_ALLOWLIST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Local dev origins always pass; config.allowedOrigins adds exact origins for embedding. */
function originAllowed(origin: string): boolean {
  return ORIGIN_ALLOWLIST.test(origin) || config.allowedOrigins.includes(origin);
}

app.get("/ws", { websocket: true }, (socket, req) => {
  const origin = req.headers.origin;
  if (origin !== undefined && !originAllowed(origin)) {
    console.warn(`[server] rejected ws connection from origin ${origin}`);
    socket.close(1008, "forbidden origin");
    return;
  }
  clients.add(socket);
  send(socket, { type: "hello", ...snapshot() });
  socket.on("message", (data: Buffer) => handleClientMessage(socket, data.toString()));
  socket.on("close", () => clients.delete(socket));
});

app.get("/health", () => ({ ok: true, sessionId: runtime.session.sessionId }));

await app.listen({ port: PORT, host: HOST });
console.log(`[pi] session ${runtime.session.sessionId}`);
console.log(`[pi] model ${modelName()} · cwd ${AGENT_CWD} · agentDir ${AGENT_DIR}`);
if (config.sandbox) {
  const extras = [
    config.sandbox.allowWrite ? "write" : "read-only",
    ...(config.sandbox.allowBash ? ["bash (UNCONFINED)"] : []),
  ].join(", ");
  console.log(`[pi] sandbox ${config.sandbox.root} · ${extras}`);
}
console.log(`[pi] file browser root ${BROWSER_ROOT}`);
console.log(`[server] ws://${HOST}:${PORT}/ws`);

// --- Shutdown -------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  await runtime.dispose();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
