/**
 * Pi-outpost server: bridges a pi AgentSession to WebSocket clients.
 *
 * SECURITY: binds to 127.0.0.1 only (protects against the network) and
 * validates the Origin header on WebSocket upgrades (protects against
 * malicious webpages in the user's own browser — WS is exempt from CORS).
 * The agent has bash/edit/write tools: never weaken either check.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fastifyStatic from "@fastify/static";
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
  type TreeNode,
  type WireImage,
} from "@pi-outpost/shared";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { assistantToItem, contentText, customMessageToItem, historyToItems, truncate } from "./convert.ts";
import { FileBrowserError, listDirectory, readFileForPreview, resolveBrowserRoot, resolveWritableRoot, searchFiles } from "./fileBrowser.ts";
import { createSandboxedTools, isWithin, realResolve } from "./sandbox.ts";
import { seaExtensionFactories } from "./sea-extensions.ts";

// npm workspace scripts run with cwd=server/ — INIT_CWD is where `npm run` was invoked
const BASE_CWD = process.env.PI_CWD ?? process.env.INIT_CWD ?? process.cwd();
const config = loadConfig(BASE_CWD);
const PORT = config.port;
const HOST = config.host;
const AGENT_CWD = config.cwd;
const AGENT_DIR = config.agentDir ?? getAgentDir();
// Own agentDir ⇒ own session store, fully separate from ~/.pi/agent
const SESSION_DIR = config.agentDir ? path.join(config.agentDir, "sessions") : undefined;

const sandboxedTools = config.sandbox ? await createSandboxedTools(config.sandbox) : undefined;
const BROWSER_ROOT = await resolveBrowserRoot(config);
const WRITABLE_ROOT = await resolveWritableRoot(config, BROWSER_ROOT);

// --- HTTP server ---------------------------------------------------------------
//
// Started now, before the AgentSessionRuntime below (which loads models, extensions,
// and skills, and can take a few seconds) — branding is pure config with no session
// dependency, so it must not wait behind that setup (that wait was showing up as a
// flash of default branding on every page load). /ws and /health stay stubbed out
// (WS connections are closed immediately, so the client's reconnect loop just
// retries) until the runtime is ready and wires up the real handlers below.

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

let handleWsConnection: (socket: WebSocket) => void = (socket) => {
  socket.close(1013, "starting up");
};
let getHealth: () => { ok: boolean; sessionId?: string } = () => ({ ok: false });

const app = Fastify({ logger: false });
await app.register(websocket);
app.get("/branding", () => config.branding);
app.get("/ws", { websocket: true }, (socket, req) => {
  const origin = req.headers.origin;
  if (origin !== undefined && !originAllowed(origin)) {
    console.warn(`[server] rejected ws connection from origin ${origin}`);
    socket.close(1008, "forbidden origin");
    return;
  }
  handleWsConnection(socket);
});
app.get("/health", () => getHealth());

// Serve the built web UI as a single deployable unit when present (`npm run build
// --workspace web` first) — /branding, /ws, /health above take priority over it
// regardless of registration order, since Fastify's router favors exact routes over
// this plugin's wildcard. Skipped silently in dev, where `npm run dev:web` (Vite,
// with HMR) serves the UI instead.
const WEB_DIST = path.resolve(import.meta.dirname, "../../web/dist");
const webDistExists = await fs
  .stat(WEB_DIST)
  .then((s) => s.isDirectory())
  .catch(() => false);
if (webDistExists) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  console.log(`[server] serving web UI from ${WEB_DIST}`);
}

await app.listen({ port: PORT, host: HOST });
console.log(`[server] http://${HOST}:${PORT}/`);

// --- Agent session runtime ---------------------------------------------------

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
      ...(config.noSkills ? { noSkills: true } : {}),
      ...(config.noPromptTemplates ? { noPromptTemplates: true } : {}),
      ...(config.systemPrompt !== undefined ? { systemPrompt: config.systemPrompt } : {}),
      ...(config.appendSystemPrompt.length > 0 ? { appendSystemPrompt: config.appendSystemPrompt } : {}),
      ...(seaExtensionFactories.length > 0 ? { extensionFactories: seaExtensionFactories } : {}),
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
  let models = runtime.services.modelRegistry.getAvailable();
  if (config.allowedModels) {
    const allowed = config.allowedModels;
    models = models.filter((m) => allowed.some((a) => a.provider === m.provider && a.id === m.id));
  }
  return models.map((model) => ({
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
    writableRoot: WRITABLE_ROOT,
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
      return { success: false, error: "Theme switching not supported in pi-outpost" };
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

/** Unblock any extension still awaiting a dialog/editor answer from a session about to be replaced. */
function cancelPendingExtensionRequests(): void {
  for (const pending of pendingExtensionRequests.values()) {
    pending.resolve({ type: "extension_ui_response", id: "", cancelled: true });
  }
  pendingExtensionRequests.clear();
}

/** (Re)bind the extension runtime — UI bridge, mode, error reporting — to the current session. */
async function bindExtensionsForSession(): Promise<void> {
  // runtime.session.bindExtensions() has been observed to never settle in some
  // process contexts (e.g. spawned under `concurrently` / Start-Process, where
  // stdout isn't a TTY). This warning surfaces that case instead of hanging silently.
  const stallWarning = setTimeout(() => {
    console.warn("[pi] bindExtensions has not resolved after 5s — extensions may be unavailable this session");
  }, 5000);
  try {
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
        console.warn("[pi] extension requested shutdown — ignored (pi-outpost is a persistent server)");
      },
      onError: (err) => {
        reportError(new Error(`[extension ${err.extensionPath}] ${err.error}`));
      },
    });
  } finally {
    clearTimeout(stallWarning);
  }
}

/** args of an in-flight edit/write call, captured at tool_execution_start and consumed at tool_execution_end. */
const pendingFileMutations = new Map<string, unknown>();

/**
 * Best-effort file-browser invalidation: if an edit/write tool touched a path inside
 * BROWSER_ROOT, tell clients so an expanded directory or open preview can refresh.
 * Not a security boundary — resolution failures or out-of-root paths are just skipped.
 */
async function announceFileChange(args: unknown): Promise<void> {
  const targetPath = (args as { path?: unknown } | null)?.path;
  if (typeof targetPath !== "string") return;
  try {
    const resolved = await realResolve(path.resolve(BROWSER_ROOT, targetPath));
    if (!isWithin(BROWSER_ROOT, resolved)) return;
    const relPath = path.relative(BROWSER_ROOT, resolved).split(path.sep).join("/");
    broadcast({ type: "file_changed", path: relPath });
  } catch {
    // Resolution failure (e.g. race with the tool call) — nothing to invalidate
  }
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
        if (event.toolName === "edit" || event.toolName === "write") {
          pendingFileMutations.set(event.toolCallId, event.args);
        }
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
        {
          const args = pendingFileMutations.get(event.toolCallId);
          pendingFileMutations.delete(event.toolCallId);
          // Only announce once the write has actually landed on disk — the client
          // may otherwise refetch a directory/file before the change is visible.
          if (args !== undefined && !event.isError) void announceFileChange(args);
        }
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
// Fire-and-forget: if this hangs (see the stall warning inside bindExtensionsForSession),
// it must not block app.listen() below — the server should still come up without extensions.
void bindExtensionsForSession().catch((err) => console.error(`[pi] bindExtensions failed: ${err}`));

/** After runtime.newSession()/switchSession(), runtime.session is a new object. */
async function rebindAndAnnounce(): Promise<void> {
  cancelPendingExtensionRequests();
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

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // of base64 text

/** Validate client-supplied attachments; reject anything that isn't a small image. */
function validImages(images: unknown): WireImage[] | undefined {
  if (images === undefined) return undefined;
  if (!Array.isArray(images) || images.length > MAX_IMAGES) return undefined;
  const valid: WireImage[] = [];
  for (const image of images) {
    const { data, mimeType } = (image ?? {}) as Partial<WireImage>;
    if (typeof data !== "string" || data.length === 0 || data.length > MAX_IMAGE_BYTES) return undefined;
    if (typeof mimeType !== "string" || !mimeType.startsWith("image/")) return undefined;
    valid.push({ data, mimeType });
  }
  return valid;
}

async function handlePrompt(text: string, images?: WireImage[]): Promise<void> {
  const session = runtime.session;
  const options = {
    // Echo the user message only once accepted (avoids ghost bubbles on reject)
    preflightResult: (accepted: boolean) => {
      if (accepted) broadcast({ type: "user", text, ...(images?.length ? { images } : {}) });
    },
    ...(images?.length ? { images: images.map((i) => ({ type: "image" as const, ...i })) } : {}),
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

// --- Fork / tree navigation -------------------------------------------------------

/** SDK tree node (structural subset — the SDK type isn't exported at the root). */
interface SdkTreeNode {
  entry: { type: string; id: string; message?: { role?: string; content?: unknown } };
  children: SdkTreeNode[];
  label?: string;
}

/**
 * Collapse the raw session tree (every entry is a node: assistant messages,
 * tool results, model changes…) down to user-message nodes only, so the UI
 * shows "the points you can return to". A node is `onPath` when the current
 * leaf lives in its subtree, i.e. it is on the active branch.
 */
function buildTree(): TreeNode[] {
  const manager = runtime.session.sessionManager;
  const leafId = manager.getLeafId();

  function subtreeHasLeaf(node: SdkTreeNode): boolean {
    return node.entry.id === leafId || node.children.some(subtreeHasLeaf);
  }

  function collapse(node: SdkTreeNode): TreeNode[] {
    const childNodes = node.children.flatMap(collapse);
    if (node.entry.type === "message" && node.entry.message?.role === "user") {
      const text = contentText(node.entry.message.content as never).split("\n")[0].slice(0, 100);
      return [
        {
          entryId: node.entry.id,
          text,
          onPath: subtreeHasLeaf(node),
          ...(node.label ? { label: node.label } : {}),
          children: childNodes,
        },
      ];
    }
    return childNodes;
  }

  return (manager.getTree() as SdkTreeNode[]).flatMap(collapse);
}

function sendTree(socket: WebSocket): void {
  send(socket, { type: "tree", roots: buildTree() });
}

/**
 * Move the current leaf to another node of the same session file (checkout of
 * an earlier/parallel branch). The transcript changes without a session
 * replacement, so clients get a fresh snapshot; the abandoned user message
 * comes back as composer prefill (same UX as pi's TUI).
 */
/** Fork/navigate targets must be user-message entries (the SDK throws on anything else). */
function isUserMessageEntry(entryId: string): boolean {
  const entry = runtime.session.sessionManager.getEntry(entryId) as
    | { type: string; message?: { role?: string } }
    | undefined;
  return entry?.type === "message" && entry.message?.role === "user";
}

async function navigateTree(socket: WebSocket, entryId: string): Promise<void> {
  if (runtime.session.isStreaming) {
    send(socket, { type: "error", message: "Cannot navigate the tree while the agent is running" });
    return;
  }
  if (!isUserMessageEntry(entryId)) {
    send(socket, { type: "error", message: "Unknown tree node" });
    return;
  }
  // Serialize against session replacement AND against a prompt sneaking in
  // during the SDK's async pre-navigation hooks (session_before_tree): the
  // flag closes the check-then-act window at the server boundary.
  if (replacingSession) {
    send(socket, { type: "error", message: "Session change already in progress" });
    return;
  }
  replacingSession = true;
  try {
    const { cancelled, editorText } = await runtime.session.navigateTree(entryId);
    if (cancelled) return;
    broadcast({ type: "session_replaced", ...snapshot() });
    if (editorText) send(socket, { type: "editor_prefill", text: editorText });
    broadcast({ type: "tree", roots: buildTree() });
  } finally {
    replacingSession = false;
  }
}

/** Fork a new session file starting just before the given user message. */
async function forkSession(socket: WebSocket, entryId: string): Promise<void> {
  if (!isUserMessageEntry(entryId)) {
    // Also protects replaceSession's recovery path: runtime.fork throws on
    // non-user entries BEFORE teardown, and recovery would needlessly swap
    // the healthy live session for a fresh one.
    send(socket, { type: "error", message: "Unknown tree node" });
    return;
  }
  let selectedText: string | undefined;
  await replaceSession(socket, async () => {
    const result = await runtime.fork(entryId);
    selectedText = result.selectedText;
    return result;
  });
  if (selectedText) send(socket, { type: "editor_prefill", text: selectedText });
  broadcast({ type: "tree", roots: buildTree() });
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

/** Composer's `@` mention autocomplete: recursive name search, confined to BROWSER_ROOT. */
async function handleSearchFiles(socket: WebSocket, query: string, requestId: string): Promise<void> {
  const results = await searchFiles(BROWSER_ROOT, query);
  send(socket, { type: "file_search_results", requestId, query, results });
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
      const images = validImages(message.images);
      if (message.images !== undefined && images === undefined) {
        // Never drop a message silently: the client already cleared its composer
        send(socket, { type: "error", message: "Attachments rejected (too large or invalid)" });
        return;
      }
      if (!text && !images?.length) return;
      handlePrompt(text || "(see attached images)", images).catch(reportError);
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
    case "search_files":
      if (typeof message.query !== "string" || typeof message.requestId !== "string") return;
      handleSearchFiles(socket, message.query, message.requestId).catch(reportError);
      break;
    case "list_tree":
      try {
        sendTree(socket);
      } catch (error) {
        reportError(error);
      }
      break;
    case "navigate_tree":
      if (typeof message.entryId !== "string") return;
      navigateTree(socket, message.entryId).catch(reportError);
      break;
    case "fork_session":
      if (typeof message.entryId !== "string") return;
      forkSession(socket, message.entryId).catch(reportError);
      break;
  }
}

// --- Wire up the real /ws and /health handlers, now that the runtime is ready ------

handleWsConnection = (socket) => {
  clients.add(socket);
  send(socket, { type: "hello", ...snapshot() });
  socket.on("message", (data: Buffer) => handleClientMessage(socket, data.toString()));
  socket.on("close", () => clients.delete(socket));
};
getHealth = () => ({ ok: true, sessionId: runtime.session.sessionId });

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

// --- Shutdown -------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  await runtime.dispose();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
