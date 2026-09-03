/**
 * Pi-outpost server: bridges a pi AgentSession to WebSocket clients.
 *
 * SECURITY: binds to 127.0.0.1 only (protects against the network) and
 * validates the Origin header on WebSocket upgrades (protects against
 * malicious webpages in the user's own browser — WS is exempt from CORS).
 * The agent has bash/edit/write tools: never weaken either check.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  type SessionInfo,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  type ClientMessage,
  type ContextUsage,
  type CredentialStatus,
  type ExtensionUIResponse,
  type GitRevision,
  type ModelChoice,
  type ServerMessage,
  type SessionSnapshot,
  type WorkspaceActivity,
  type WorkspaceInfo,
  type SessionSummary,
  THINKING_LEVELS,
  type ThinkingLevel,
  type TreeNode,
  type WireImage,
  type WorkPlan,
  WORKTREE_REVISION,
} from "@pi-outpost/shared";
import { rewriteMentionedPaths } from "@pi-outpost/shared/mentions";
import { readStructuredExchangeDocument } from "@pi-outpost/shared/structured-exchange/document";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { isWorkPlanReadyForReview, validateWorkPlan } from "@pi-outpost/shared/work-plan";
import { describeProviderError } from "@pi-outpost/shared/provider-error";
import { composeWorkspaceOutcome, evidenceContributor, repositoryContributor, workPlanContributor } from "./outcome.ts";
import {
  type AgentRuntime,
  type RuntimeEvent,
  type RuntimeTreeNode,
  RuntimeUnsupportedError,
} from "./agentRuntime.ts";
import { createEmbeddedRuntime } from "./embeddedRuntime.ts";
import { createRpcRuntime } from "./rpcRuntime.ts";
import { rpcResourceArgs, resolveToolsExtension } from "./rpcResourceArgs.ts";
import { TOOLS_ENV_VAR, type PiOutpostToolsSettings } from "./piOutpostTools.ts";
import { readInstalledPiSdkVersion } from "./piSdkVersion.ts";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CliError, helpText, parseCli, readSecret, runInit } from "./cli.ts";
import { bindFailureMessage, holdConsoleIfOwned } from "./startupFailure.ts";
import { BuildExeError, buildExecutable } from "./buildExe.ts";
import { TerminalManager } from "./terminalManager.ts";
import { browsableUrl, openBrowser, shouldOpenBrowser } from "./openBrowser.ts";
import { runStartupUpdateNotice, runUpdateCommand, updateCheckEnabled, whyCheckingDisabled } from "./update.ts";
import {
  allExtensionPaths,
  allSkillPaths,
  ConfigWriteError,
  declaredThinkingLevels,
  type EditableSettings,
  loadConfig,
  NoConfigError,
  persistEditableSettings,
} from "./config.ts";
import { listServerDirectories, ServerDirectoryError } from "./serverDirectories.ts";
import {
  CredentialError,
  CredentialSyncError,
  knownProviders,
  type ProviderDeclaration,
  providerConfig,
  storeApiKey,
  storeProvider,
  tlsHint,
  validBaseUrl,
  validProviderId,
} from "./credentials.ts";
import { assistantToItem, contentText, customMessageToItem, historyToItems, structuredExchangeField, toProgressFraction, truncate } from "./convert.ts";

import { isStackExhaustion, noteCompaction, noteToolOutcome, noteTurnOutcome, recordTurnFailure } from "./turnFailureLog.ts";
import {
  assertWithinRoot,
  createDirectoryFromBrowser,
  createFileFromBrowser,
  copyFileFromBrowser,
  deleteFileFromBrowser,
  FileBrowserError,
  isPdfPath,
  listDirectory,
  MAX_PREVIEW_BYTES,
  MAX_UPLOAD_BASE64_LENGTH,
  moveFileFromBrowser,
  openFileNative,
  readFileForPreview,
  readFileRaw,
  renameFileFromBrowser,
  resolveConfined,
  searchFiles,
  uploadFileFromBrowser,
  writeFileFromBrowser,
} from "./fileBrowser.ts";
import {
  GitError,
  gitFileLog,
  gitHeadContent,
  gitLog,
  gitRevisionContent,
  gitShow,
  gitStatus,
  repoFor,
  resolveGitExecutable,
  useGitExecutable,
  type GitRepo,
} from "./git.ts";
import { createDocxExtractToolDefinition } from "./docxTool.ts";
import { createXlsxExtractToolDefinition } from "./xlsxTool.ts";
import { createPptxExtractToolDefinition } from "./pptxTool.ts";
import { createStructuredExchangeToolDefinition } from "./structuredExchangeTool.ts";
import { createStructuredExchangeFigureToolDefinition } from "./structuredExchangeFigureTool.ts";
import { createWorkPlanToolDefinition } from "./workPlanTool.ts";
import { copyWorkPlan, deleteWorkPlan, loadWorkPlan, sameSessionFile } from "./workPlanStore.ts";
import { composeAppendSystemPrompt } from "./systemPrompt.ts";
import { createPdfExtractToolDefinition } from "./pdfTool.ts";
import { Workspace, shouldRetireWorkspace, type WorkspaceOptions, type WorkspaceSettings } from "./workspace.ts";
import { WorkspaceRegistry } from "./workspaceRegistry.ts";
import { deriveWorkspaceActivity, workspaceActivityNeedsAttention } from "./workspaceActivity.ts";
import { isWithin, realResolve } from "./sandbox.ts";
import {
  firstExchange,
  generateSessionTitle,
  hasBeenNamed,
  MAX_NAME_LENGTH,
  MAX_QUERY_LENGTH,
  sanitizeName,
  searchSessions,
  toSummary,
} from "./sessions.ts";
import { seaExtensionFactories } from "./sea-extensions.ts";
// Generated at build time (cli/scripts/build.mjs, server/scripts/build-sea.mjs).
// Empty map in dev — see the comment at the static-serving block below.
import { EMBEDDED_WEB } from "./embedded-web.ts";
import { cacheControlFor } from "./webAssetCache.ts";

// Replaced at bundle time; `typeof` on an undeclared name is safe, so a source run says "dev".
declare const __PI_OUTPOST_VERSION__: string;
const VERSION = typeof __PI_OUTPOST_VERSION__ === "string" ? __PI_OUTPOST_VERSION__ : "dev";

// Resolved at bundle time (not from the SDK's runtime VERSION, which walks up
// from __dirname for package.json and resolves the wrong file inside a SEA
// bundle). Outside a bundle the define is absent and the version is read from the
// installed package: a source run used to report "dev", which is the one situation
// where knowing the SDK version matters most.
declare const __PI_SDK_VERSION__: string;
const PI_SDK_VERSION =
  typeof __PI_SDK_VERSION__ === "string" ? __PI_SDK_VERSION__ : readInstalledPiSdkVersion();

// npm workspace scripts run with cwd=server/ — INIT_CWD is where `npm run` was invoked
const LAUNCH_DIR = process.env.INIT_CWD ?? process.cwd();

/** `[config] …` messages already carry their own tag — don't stack a second one. */
function complain(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith("[") ? message : `[pi] ${message}`);
}

const cli = await (async () => {
  try {
    return parseCli(process.argv.slice(2));
  } catch (error) {
    complain(error);
    // A shortcut with a mistyped flag is still a double-click: hold the window.
    await holdConsoleIfOwned();
    process.exit(2);
  }
})();

if (cli.command === "help") {
  console.log(helpText());
  process.exit(0);
}
if (cli.command === "version") {
  console.log(VERSION);
  process.exit(0);
}
if (cli.command === "init") {
  try {
    // The same directory discovery will search — writing where a later start won't
    // look would be a cruel joke under any `npm run` wrapper.
    const written = runInit(LAUNCH_DIR, cli.init);
    console.log(`[pi] wrote ${written}\n[pi] edit it, then run: pi-outpost`);
    process.exit(0);
  } catch (error) {
    complain(error);
    process.exit(1);
  }
}

// Before the configuration is loaded, deliberately: building an executable has
// nothing to do with how a server would be configured, and refusing to build one
// because no config file exists would be an obstacle invented for its own sake.
if (cli.command === "build-exe") {
  try {
    const built = buildExecutable({ out: cli.buildExe.out, force: cli.buildExe.force, cwd: LAUNCH_DIR });
    console.log(`[pi] wrote ${built.path} (${built.method})\n[pi] run it: ${built.path}`);
    process.exit(0);
  } catch (error) {
    if (error instanceof BuildExeError) {
      console.error(`[pi] ${error.message}`);
      process.exit(1);
    }
    complain(error);
    process.exit(1);
  }
}

// Like build-exe, before the configuration is loaded — but not *without* it. The
// settings that can turn checking off live in that file, so a refusal has to be able
// to name them; equally, refusing to look for a newer version because the operator
// has not written a config yet would be an obstacle invented for its own sake. So the
// file is read when there is one, and its absence is simply no settings.
if (cli.command === "update") {
  const settings = (() => {
    try {
      const loaded = loadConfig(LAUNCH_DIR, cli.flags);
      return {
        updateCheck: loaded.updateCheck,
        offline: loaded.offline,
        registry: loaded.updateRegistry,
        agentDir: loaded.agentDir,
      };
    } catch (error) {
      // Only *absence* is tolerated, and only because refusing to say what the newest
      // version is until the operator has written a config would be an obstacle
      // invented for its own sake. Everything else is reported and stops here: a
      // `--config` path that does not exist, or an invalid `updateCheck`, means the
      // operator asked for settings this command would then have ignored — and
      // ignoring them could mean making a request they had switched off.
      if (error instanceof NoConfigError) return {};
      complain(error);
      process.exit(1);
    }
  })();

  const enabled = updateCheckEnabled(settings);
  process.exit(
    await runUpdateCommand({
      version: VERSION,
      checkOnly: cli.update.check,
      ...(enabled ? {} : { checkingDisabled: true, disabledReason: whyCheckingDisabled(settings) }),
      ...(settings.registry !== undefined ? { registry: settings.registry } : {}),
    }),
  );
}

const config = await (async () => {
  try {
    return loadConfig(LAUNCH_DIR, cli.flags);
  } catch (error) {
    if (error instanceof NoConfigError) {
      console.error(
        [
          "[pi] no configuration file found. Looked in:",
          ...error.searched.map((candidate) => `      ${candidate}`),
          "",
          "      Create one with:  pi-outpost init          (here)",
          "                        pi-outpost init --global (for every directory)",
          "      Or point at one:  pi-outpost --config <path>",
        ].join("\n"),
      );
      // The likeliest failure of a first double-click, and the one whose window
      // vanished before this: hold it so the instructions above can be read.
      await holdConsoleIfOwned();
      process.exit(1);
    }
    complain(error);
    await holdConsoleIfOwned();
    process.exit(1);
  }
})();
// Find git once, before anything asks for it. `PATH` alone is not enough: git is
// installed on every machine that has a working VS Code, and is routinely absent from
// the PATH a server process inherits — which used to remove the entire git surface
// with no message at all.
try {
  useGitExecutable(await resolveGitExecutable(config.gitPath));
} catch (error) {
  // A CONFIGURED path that cannot run is an operator mistake, and startup is where
  // they should hear about it. No git anywhere is not a reason to refuse to start:
  // the server runs, and the git surface now says why it is missing.
  if (config.gitPath !== undefined) {
    complain(error);
    await holdConsoleIfOwned();
    process.exit(1);
  }
}

// Answers "which of the four files am I actually running, and who won each setting"
// without starting anything. The token is the one thing never echoed back.
if (cli.command === "config") {
  const { token, ...rest } = config;
  console.log(JSON.stringify({ ...rest, token: token ? "<set>" : undefined }, null, 2));
  process.exit(0);
}

const PORT = config.port;
const HOST = config.host;
const AGENT_DIR = config.agentDir ?? getAgentDir();
// Own agentDir ⇒ own session store, fully separate from ~/.pi/agent
const SESSION_DIR = config.agentDir ? path.join(config.agentDir, "sessions") : undefined;

// Store a key where *this* configuration will look for it, then leave: an isolated
// agentDir starts with no auth.json, and copying one in by hand was the only way.
if (cli.command === "login") {
  try {
    if (!validProviderId(cli.login.provider)) {
      throw new CliError("login needs a provider: pi-outpost login --provider anthropic");
    }
    // A typo would otherwise store a key nothing reads, and say "stored" — leaving a
    // server that still reports no credentials, for no visible reason.
    const known = await knownProviders(AGENT_DIR);
    if (!known.includes(cli.login.provider)) {
      throw new CliError(`unknown provider "${cli.login.provider}" — known: ${known.join(", ")}`);
    }
    const key = await readSecret(`API key for ${cli.login.provider} (not echoed): `);
    const written = await storeApiKey(AGENT_DIR, cli.login.provider, key);
    console.log(`[pi] stored ${cli.login.provider} credentials in ${written}\n[pi] run: pi-outpost`);
    process.exit(0);
  } catch (error) {
    complain(error);
    process.exit(1);
  }
}

/**
 * Reads nothing and writes nothing: it validates a document the agent composed and
 * hands it to the interface. There is no path argument to confine, so unlike every
 * other custom tool it is the same tool on both sides of the sandbox.
 */
const structuredExchangeTool = createStructuredExchangeToolDefinition();
const workPlanTool = createWorkPlanToolDefinition();

/**
 * Everything a workspace needs that is the server's rather than the project's:
 * limits, whether to watch, the unconfined tools, and where its file changes go.
 *
 * One factory so a project opened at runtime is built exactly like the one the
 * server booted with — a second construction site is where the two would drift.
 *
 * A sandbox is inherited when the project declares none: a sandboxed server must
 * not open an unsandboxed project, and the inherited settings are rooted at the
 * new project, never at the one the server started in.
 */
function workspaceOptions(settings: WorkspaceSettings): Omit<WorkspaceOptions, "createRuntime"> {
  const sandbox = settings.sandbox ?? (config.sandbox ? { ...config.sandbox, root: settings.cwd, writableRoot: undefined } : undefined);
  return {
    settings: { cwd: settings.cwd, ...(sandbox ? { sandbox } : {}) },
    limits: {
      pdfMaxBytes: config.pdf.maxBytes,
      docxMaxBytes: config.docx.maxBytes,
      xlsxMaxBytes: config.xlsx.maxBytes,
      pptxMaxBytes: config.pptx.maxBytes,
      structuredExchangeMaxBytes: config.structuredExchange.maxBytes,
    },
    watchFiles: config.files.watch,
    unconfinedTools: [structuredExchangeTool, workPlanTool],
    // Bound to the workspace being built, so a tree change reaches the clients
    // watching THAT project and no others.
    onDirectoryChanged: () => {},
  };
}

/**
 * The project this server booted with, and everything rooted at it.
 *
 * Its runtime is attached below rather than built here: the HTTP server
 * deliberately starts before the agent, so a workspace whose resources are ready
 * and whose session is not yet built is a real state. A project opened later takes
 * the shorter path — Workspace.open builds both at once.
 */
const workspace = await Workspace.create({
  ...workspaceOptions({ cwd: config.cwd, ...(config.sandbox ? { sandbox: config.sandbox } : {}) }),
  onDirectoryChanged: (relPath) => {
    workspace.noteDirectoryChange();
    broadcast(workspace, { type: "directory_changed", path: relPath });
  },
  onRepositoriesChanged: () =>
        broadcast(workspace, {
          type: "git_repositories_changed",
          available: workspace.repos.length > 0 && workspace.gitUnavailable === undefined,
          ...(workspace.gitUnavailable ? { unavailable: workspace.gitUnavailable } : {}),
        }),
  createRuntime: () => {
    throw new Error("the boot workspace's runtime is built in index.ts and attached");
  },
});

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

/**
 * Timing-safe shared-token check. Hashing both sides first sidesteps
 * timingSafeEqual's equal-length requirement without an early return that
 * would leak the token's length.
 */
const expectedTokenDigest =
  config.token !== undefined ? createHash("sha256").update(config.token).digest() : undefined;

function tokenValid(candidate: unknown): boolean {
  if (expectedTokenDigest === undefined) return true;
  if (typeof candidate !== "string") return false;
  const actual = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedTokenDigest, actual);
}

/** WS close code for a bad/missing token (app-reserved range): tells the client to show the token screen instead of retrying. */
const WS_CLOSE_UNAUTHORIZED = 4401;

let handleWsConnection: (socket: WebSocket, workspaceRoot?: string) => void = (socket) => {
  socket.close(1013, "starting up");
};
let getHealth: () => { ok: boolean; sessionId?: string } = () => ({ ok: false });

/**
 * How long a browser may reuse a preflight answer.
 *
 * Short on purpose. The round trip it saves is a localhost one in the common
 * case, and a long cache means a corrected `allowedOrigins` keeps being ignored
 * by every browser that already asked.
 */
const PREFLIGHT_MAX_AGE_SECONDS = 60;

/**
 * Let a browser on an allowed origin read the response we already decided to send.
 *
 * `allowedOrigins` has always gated the WebSocket — which drives an agent that
 * reads the workspace and, when configured, writes files and runs bash — while
 * every HTTP route answered without a CORS header, so a cross-origin widget got
 * a 200 the browser then discarded. The same predicate decides both here.
 *
 * SECURITY: this grants no authority. Every route keeps its token check, its
 * path confinement and its Host check; CORS only decides whether the browser
 * hands the page a response the server had already produced. The origin is
 * echoed exactly and never `*`, which would extend to origins the configuration
 * never named. An origin we do not allow gets no allow-origin header and no
 * status/body difference: withholding the header already stops the browser,
 * and changing the status as well would tell any page which origins a server
 * is configured for. Every response still declares the Origin cache dimension,
 * including requests that omit Origin entirely.
 */
function appendVary(reply: FastifyReply, field: string): void {
  const current = reply.getHeader("Vary");
  const fields: string[] = [];
  for (const value of current === undefined ? [] : Array.isArray(current) ? current : [current]) {
    fields.push(
      ...String(value)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }
  if (fields.includes("*") || fields.some((part) => part.toLowerCase() === field.toLowerCase())) return;
  reply.header("Vary", [...fields, field].join(", "));
}

function applyCors(req: FastifyRequest, reply: FastifyReply): boolean {
  // Absence, refusal and acceptance are three Origin-dependent variants. If a
  // cache stored the no-Origin response without Vary, it could later reuse it
  // for an allowed origin and hide the header that makes the response readable.
  appendVary(reply, "Origin");
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  if (!originAllowed(origin)) return false;
  reply.header("Access-Control-Allow-Origin", origin);
  return true;
}

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // of base64 text

const app = Fastify({ logger: false });
// An exceeded frame limit *closes the socket* rather than answering, and a torn-down
// connection reports nothing the client can show the user — so the limit is stated
// here next to every cap it has to clear, rather than inherited from ws's 100 MB
// default and left to quietly fall under one of them.
//
// Two messages set the floor and they are not the same size: an upload is one
// base64 body, while a prompt may carry MAX_IMAGES of MAX_IMAGE_BYTES each — six
// images is the larger number by a wide margin. Taking the max of both (rather
// than the upload alone) is what keeps a multi-image prompt the *server's own
// validator accepts* from being dropped by the transport underneath it.
await app.register(websocket, {
  options: { maxPayload: Math.max(MAX_UPLOAD_BASE64_LENGTH, MAX_IMAGES * MAX_IMAGE_BYTES) + 65_536 },
});

// A hook rather than a call in each handler: a per-route list is one a future
// route joins by being remembered, and this one cannot be half-applied.
//
// The other side of that: every route added below inherits cross-origin
// exposure without anyone deciding it. A new route that returns something an
// allowed origin should not read has to say so itself — uniformity is what makes
// the rule statable, and this is what it costs.
app.addHook("onRequest", async (req, reply) => {
  const allowed = applyCors(req, reply);
  if (req.method !== "OPTIONS") return;

  // A preflight is a question about permission, not the request it describes:
  // it carries no token by design, so requiring one would refuse every
  // authenticated cross-origin call before it was ever made. Answered here,
  // before routing, so it never reaches a handler and never touches state.
  if (allowed) {
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    // Echo what was asked for rather than a fixed list: the client sends
    // `Authorization` when the server is token-protected, and that header is
    // what makes the browser preflight in the first place.
    const asked = req.headers["access-control-request-headers"];
    reply.header("Access-Control-Allow-Headers", asked ?? "Authorization, Content-Type");
    // The value above is derived from the request. Keep distinct preflight
    // variants apart in shared caches just as we do for Origin.
    appendVary(reply, "Access-Control-Request-Headers");
    reply.header("Access-Control-Max-Age", String(PREFLIGHT_MAX_AGE_SECONDS));
  }
  await reply.code(allowed ? 204 : 403).send();
});
app.get("/branding", (req, reply) => {
  const auth = req.headers.authorization;
  if (!tokenValid(auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined)) {
    console.warn(`[server] rejected /branding request with bad or missing token from ${req.ip}`);
    return reply.code(401).send({ error: "unauthorized" });
  }
  return config.branding;
});
app.get("/ws", { websocket: true }, (socket, req) => {
  const origin = req.headers.origin;
  if (origin !== undefined && !originAllowed(origin)) {
    console.warn(`[server] rejected ws connection from origin ${origin}`);
    socket.close(1008, "forbidden origin");
    return;
  }
  // Browsers cannot set headers on WebSockets, so the token rides a query
  // parameter. Close AFTER the handshake with an app code — a pre-handshake
  // rejection reads as an opaque 1006 that the client can't act on.
  const url = new URL(req.url ?? "/ws", "http://localhost");
  const token = url.searchParams.get("token");
  if (!tokenValid(token ?? undefined)) {
    console.warn(`[server] rejected ws connection with bad or missing token from ${req.ip}`);
    socket.close(WS_CLOSE_UNAUTHORIZED, "unauthorized");
    return;
  }
  // Which project this connection watches. An unknown or absent name lands on the
  // default rather than failing: a client from before this existed names nothing,
  // and an embed host pinned to a project that has since closed should still get a
  // working widget instead of a dead socket.
  handleWsConnection(socket, url.searchParams.get("workspace") ?? undefined);
});
app.get("/health", (req, reply) => {
  const health = getHealth();
  // During startup (getHealth stub returns { ok: false }), return 503 so
  // callers don't mistake the HTTP 200 for readiness — the real handler
  // (wired after createAgentSessionRuntime resolves) returns { ok: true }.
  if (!health.ok) return reply.code(503).send({ ok: false });
  // With auth enabled, the public health probe must not leak the session id
  return config.token !== undefined ? { ok: health.ok } : health;
});

/** Only these render inline; SVG additionally gets a scripts-off CSP below. */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

/**
 * DNS-rebinding guard for token-less servers: a malicious page can rebind its
 * hostname to 127.0.0.1 and read workspace files through /files/raw — the
 * browser then sends the attacker's Host header, which this rejects. With a
 * token configured the auth check already stops that attacker, and strict Host
 * matching would break reverse-proxy setups, so the guard only arms without one.
 */
function hostAllowed(hostHeader: string | undefined): boolean {
  if (config.token !== undefined) return true;
  if (hostHeader === undefined) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
  if (hostname === HOST) return true;
  return config.allowedOrigins.some((origin) => {
    try {
      return new URL(origin).hostname === hostname;
    } catch {
      return false;
    }
  });
}

// Raw bytes for workspace files referenced in assistant messages (inline
// images). `<img>` cannot send headers, so the token rides the query string —
// same trade-off as the WebSocket.
app.get("/files/raw", async (req, reply) => {
  const query = req.query as Record<string, unknown>;
  if (!hostAllowed(req.headers.host)) {
    console.warn(`[server] rejected /files/raw request with foreign host ${req.headers.host} from ${req.ip}`);
    return reply.code(403).send({ error: "forbidden" });
  }
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
  const queryToken = typeof query.token === "string" ? query.token : undefined;
  if (!tokenValid(bearer) && !tokenValid(queryToken)) {
    console.warn(`[server] rejected /files/raw request with bad or missing token from ${req.ip}`);
    return reply.code(401).send({ error: "unauthorized" });
  }
  const relPath = typeof query.path === "string" ? query.path : undefined;
  if (!relPath) return reply.code(400).send({ error: "missing path" });
  try {
    // PDFs are measured against their own ceiling; everything else keeps 1 MB.
    const bytes = await readFileRaw(workspace.browserRoot, relPath, config.pdf.maxBytes);
    reply.header("X-Content-Type-Options", "nosniff");
    // Workspace content may be stale seconds later (agent regenerates a plot)
    reply.header("Cache-Control", "no-store");
    const contentType = IMAGE_CONTENT_TYPES[path.extname(relPath).toLowerCase()];
    if (contentType !== undefined) {
      if (contentType === "image/svg+xml") {
        // <img> rasterizes SVG without scripts, but a direct navigation to this
        // URL would run them on our origin — the CSP closes that hole
        reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      }
      return reply.header("Content-Type", contentType).send(bytes);
    }
    // Anything else (HTML above all) must never execute or render on this origin
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", "attachment")
      .send(bytes);
  } catch (error) {
    if (error instanceof FileBrowserError) {
      if (error.reason === "too-large") {
        // The viewer names the limit it hit, and the limit depends on the type
        const limit = isPdfPath(relPath) ? config.pdf.maxBytes : MAX_PREVIEW_BYTES;
        return reply.code(413).send({ error: error.reason, limit });
      }
      return reply.code(404).send({ error: error.reason });
    }
    throw error;
  }
});

// Serve the built web UI as a single deployable unit when present (`npm run build
// --workspace web` first) — /branding, /ws, /health above take priority over it
// regardless of registration order, since Fastify's router favors exact routes over
// this plugin's wildcard. Skipped silently in dev, where `npm run dev:web` (Vite,
// with HMR) serves the UI instead.
// Three layouts must resolve: the published npm package (the UI ships beside the
// bundle as dist/web/), the clone, and the SEA bundle — which mirrors the clone's
// depth on purpose (see docs/sea-packaging.md).
//
// The packaged layout goes first, and not for elegance: from
// node_modules/pi-outpost/dist/, `../../web/dist` is `node_modules/web/dist` — and
// `web` is a real name on npm (this repo's own UI workspace is called that). A
// consumer who happens to depend on some `web` package would otherwise have us
// serve *its* dist as the chat UI. Each candidate must carry an index.html, so an
// empty or half-built directory doesn't shadow a good one either.
const hasIndexHtml = (candidate: string) =>
  fs
    .stat(path.join(candidate, "index.html"))
    .then((s) => s.isFile())
    .catch(() => false);
/**
 * Skills that ship with the product, found the same way the web UI is.
 *
 * A tool without the skill that explains it is a mechanism with no instructions:
 * the agent can call `present_structure` and has nothing telling it what a valid
 * document looks like. The user's own skill paths come after, so anything they
 * configure can still override what we bundle.
 */
const skillRoots = [path.resolve(import.meta.dirname, "./skills"), path.resolve(import.meta.dirname, "../../skills")];
/**
 * One entry per skill rather than the directory holding them.
 *
 * The loader accepts either — it recurses into a directory that has no SKILL.md of
 * its own — so this is a preference, not a requirement, and an earlier comment here
 * claiming the parent "silently finds nothing" was simply wrong. Naming each skill
 * keeps the non-skill files that live beside them (a README) from being read as
 * candidates and reported as skills missing a description.
 *
 * Proven to load, and to stay off under noSkills, by server/test/bundledSkill.test.ts.
 *
 * A skill does surface as a slash command — `skill:<name>`. An earlier note here said
 * the opposite, and was wrong: the skill was absent from the palette because the
 * palette showed only the first dozen matches alphabetically, not because it had
 * failed to load. Two wrong conclusions from one symptom, and the second one nearly
 * became a documented limitation.
 */
const BUNDLED_SKILLS: string[] = [];
for (const root of skillRoots) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skill = path.join(root, entry.name);
    if (await fs.stat(path.join(skill, "SKILL.md")).then((file) => file.isFile()).catch(() => false)) {
      BUNDLED_SKILLS.push(skill);
    }
  }
  if (BUNDLED_SKILLS.length > 0) break;
}

const webDistCandidates = process.env.PI_OUTPOST_WEB_DIST
  ? [path.resolve(process.env.PI_OUTPOST_WEB_DIST)]
  : [
      // Prefer the production build (Vite output) over the source web/ directory,
      // which contains a Vite-dev index.html referencing /src/main.tsx — that file
      // would be served as application/octet-stream and fail ESM module loading.
      path.resolve(import.meta.dirname, "./web/dist"),
      path.resolve(import.meta.dirname, "./web"),
      path.resolve(import.meta.dirname, "../../web/dist"),
    ];
let WEB_DIST: string | undefined;
for (const candidate of webDistCandidates) {
  if (await hasIndexHtml(candidate)) {
    WEB_DIST = candidate;
    break;
  }
}

// Prefer the inlined UI (self-contained SEA/npm bundle) — no web/ folder needed
// next to the executable. Falls back to fastifyStatic from disk for dev/npm
// builds that don't embed it.
if (EMBEDDED_WEB && Object.keys(EMBEDDED_WEB).length > 0) {
  const serveAsset = (reply: any, url: string) => {
    const asset = EMBEDDED_WEB[url];
    if (!asset) {
      reply.code(404);
      return reply.send("Not found");
    }
    reply.header("Content-Type", asset.type);
    reply.header("Cache-Control", cacheControlFor(url));
    reply.send(Buffer.from(asset.b64, "base64"));
  };
  app.get("/*", async (req: any, reply: any) => {
    const url = (req.params["*"] as string) || "";
    if (url === "" || url.endsWith("/")) {
      return serveAsset(reply, "/index.html");
    }
    return serveAsset(reply, "/" + url);
  });
  console.log(`[server] serving web UI from embedded bundle (${Object.keys(EMBEDDED_WEB).length} assets)`);
} else if (WEB_DIST !== undefined) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  console.log(`[server] serving web UI from ${WEB_DIST}`);
}

/**
 * The one startup step that used to fail without a sentence.
 *
 * Everything else in this file reports through `complain()` and an exit code; this
 * threw into an unhandled rejection, and the operator got a stack trace. Held open
 * afterwards where the console belongs to this process — a double-clicked executable
 * has no terminal behind it, so exiting would close the window and take the only
 * copy of the message with it. `holdConsoleIfOwned()` is the same hold the config
 * and flag failures above now do, for the same reason.
 */
try {
  await app.listen({ port: PORT, host: HOST });
} catch (error) {
  complain(bindFailureMessage(error, HOST, PORT));
  await holdConsoleIfOwned();
  process.exit(1);
}

/**
 * Land the operator in the interface they just started.
 *
 * The address comes from what was bound, not from what was asked for: `port: 0`
 * means the operating system chose, and the configured value is then a number
 * nobody is listening on. Opening here rather than earlier is the whole point —
 * a browser sent before `listen` resolves shows a connection error, and the
 * operator concludes the thing is broken.
 */
{
  const bound = app.server.address();
  // Printed from what was bound, not from what was asked for: with `port: 0` the
  // configured value is a number nobody is listening on, and this line was saying
  // `http://127.0.0.1:0/` — which is the whole of what an operator gets when no
  // browser opens.
  const url = typeof bound === "object" && bound !== null ? browsableUrl(bound) : `http://${HOST}:${PORT}/`;
  console.log(`[server] ${url}`);
  // A server with no interface of its own has nothing to open: in development the
  // UI comes from Vite on another port, and a tab on this one shows a 404. It is
  // also what a backend for an embedded widget looks like, which is the other case
  // where a browser is the wrong answer.
  const servesTheInterface = (EMBEDDED_WEB && Object.keys(EMBEDDED_WEB).length > 0) || WEB_DIST !== undefined;
  if (servesTheInterface && shouldOpenBrowser({ explicit: cli.open, configured: config.openBrowser })) {
    // Not awaited for its outcome beyond a line of output: a browser that will not
    // start is not a reason for a server to stop.
    void openBrowser(url, process.platform, config.openIn).then((opened) => {
      if (!opened) console.log(`[server] could not open a browser — open ${url} yourself`);
    });
  }

  // Scheduled rather than fired inline, and the timer is unref'd. Three separate
  // things are being kept true: the check starts only after the server is answering,
  // nothing on this path is awaited, and a request still in flight must not be the
  // reason Ctrl-C leaves a process behind. The third is the one that only shows up in
  // production, which is why it is a timer and not a bare call.
  const noticeTimer = setTimeout(() => {
    void runStartupUpdateNotice({
      version: VERSION,
      ...(config.agentDir !== undefined ? { agentDir: config.agentDir } : {}),
      settings: { updateCheck: config.updateCheck, offline: config.offline },
      ...(config.updateRegistry !== undefined ? { registry: config.updateRegistry } : {}),
      log: (line) => console.log(line),
    });
  }, 0);
  noticeTimer.unref?.();
}

// --- Agent session runtime ---------------------------------------------------

const DEBUG = process.env.PI_OUTPOST_DEBUG ? console.log : () => {};

/**
 * The SDK's session factory, bound to ONE project's toolset.
 *
 * A factory per project rather than one reading a module binding: the sandboxed
 * tools are the confinement, so a factory that fetched them from elsewhere would
 * hand project B tools rooted at project A — an agent able to read and write
 * outside its own sandbox. The toolset arrives as an argument so that cannot be
 * spelled.
 */
const makeCreateRuntime =
  (sandboxedTools: ToolDefinition[] | undefined): CreateAgentSessionRuntimeFactory =>
  async ({ cwd, sessionManager, sessionStartEvent }) => {
  const appendSystemPrompt = composeAppendSystemPrompt(config);

  const extraFactories = [...seaExtensionFactories];
  // extensionScripts are loaded via the SDK's jiti-based loader (same as
  // extensionPaths), which uses createRequire under the hood — this works
  // inside SEA blobs where native import() can only resolve built-in modules.
  const allExtPaths = [
    ...allExtensionPaths(config),
    ...config.extensionScripts,
  ];
  const services = await createAgentSessionServices({
    cwd,
    agentDir: config.agentDir,
    resourceLoaderOptions: {
      ...(config.noExtensions ? { noExtensions: true } : {}),
      ...(allExtPaths.length > 0
        ? { additionalExtensionPaths: allExtPaths }
        : {}),
      ...(config.noSkills ? { noSkills: true } : {}),
      /**
       * The user's paths first: the loader keeps the first skill it meets under a
       * given name, so anything they configure has to come before what we bundle for
       * "override" to mean anything.
       *
       * Under noSkills, theirs still go and ours do not. The SDK merges
       * additionalSkillPaths even in that mode — see server/test/bundledSkill.test.ts
       * — so passing the bundled ones regardless would quietly defeat a switch that
       * exists to get real isolation. But dropping *everything* was the opposite
       * mistake, made while fixing the first: noSkills turns off discovery of what we
       * supply, and a path the user named explicitly is not discovery. Naming a skill
       * and being given nothing is a worse surprise than either.
       */
      ...(() => {
        const paths = [...allSkillPaths(config), ...(config.noSkills ? [] : BUNDLED_SKILLS)];
        return paths.length > 0 ? { additionalSkillPaths: paths } : {};
      })(),
      ...(config.noPromptTemplates ? { noPromptTemplates: true } : {}),
      ...(config.promptPaths.length > 0
        ? { additionalPromptTemplatePaths: config.promptPaths }
        : {}),
      ...(config.systemPrompt !== undefined ? { systemPrompt: config.systemPrompt } : {}),
      ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt } : {}),
      ...(extraFactories.length > 0 ? { extensionFactories: extraFactories } : {}),
    },
  });
  const extResult = services.resourceLoader.getExtensions();
  if (extResult.errors.length > 0) {
    for (const err of extResult.errors) {
      console.error("[pi-outpost] Extension error:", err.path, err.error);
    }
  } else {
    DEBUG("[pi-outpost] No extension errors. Loaded:", extResult.extensions.length, "extensions");
  }
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      // Sandbox replaces the built-in toolset with path-scoped equivalents
      ...(sandboxedTools ? { noTools: "builtin" as const, customTools: sandboxedTools } : {}),
      ...(!sandboxedTools && config.tools ? { tools: config.tools } : {}),
      // No sandbox: the built-in toolset stands, and pdf_extract joins it — it is
      // not one of pi's built-ins, so nothing else would supply it. It stays
      // confined to the workspace, which is the only root there is to name here.
      ...(sandboxedTools
        ? {}
        : {
            customTools: [
              createPdfExtractToolDefinition({
                cwd,
                allowedRoots: [await fs.realpath(cwd)],
                maxBytes: config.pdf.maxBytes,
                // No sandbox: anything under the workspace is writable, the same
                // rule writeFileFromBrowser applies to the browser's own writes.
                writableRoot: await fs.realpath(cwd),
              }),
              createDocxExtractToolDefinition({
                cwd,
                allowedRoots: [await fs.realpath(cwd)],
                maxBytes: config.docx.maxBytes,
                writableRoot: await fs.realpath(cwd),
              }),
              createXlsxExtractToolDefinition({
                cwd,
                allowedRoots: [await fs.realpath(cwd)],
                maxBytes: config.xlsx.maxBytes,
                writableRoot: await fs.realpath(cwd),
              }),
              createPptxExtractToolDefinition({
                cwd,
                allowedRoots: [await fs.realpath(cwd)],
                maxBytes: config.pptx.maxBytes,
                writableRoot: await fs.realpath(cwd),
              }),
              createStructuredExchangeFigureToolDefinition({
                cwd,
                allowedRoots: [await fs.realpath(cwd)],
                maxBytes: config.structuredExchange.maxBytes,
                writableRoot: await fs.realpath(cwd),
              }),
              structuredExchangeTool,
              workPlanTool,
            ],
          }),
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

// The SDK decides this once, when it constructs its ModelRuntime — it reads
// `process.env.PI_OFFLINE` there and keeps the answer — so the variable has to be
// set before the runtime exists, not merely present in our config object.
if (config.offline) process.env.PI_OFFLINE = "1";

/**
 * The one agent-runtime boundary (see agentRuntime.ts). `embedded` keeps the SDK
 * session in this process; `rpc` supervises a `pi --mode rpc` child. Both answer
 * the same WebSocket protocol, and a startup failure here is fatal on purpose —
 * falling back to the other runtime would silently run something the operator did
 * not configure.
 */
/**
 * Build an agent runtime rooted at one project.
 *
 * Takes its cwd rather than reading the server's: this is what a second project
 * calls to get a session of its own. Everything else it needs — extensions,
 * skills, prompt templates, the tool allowlist — is server-wide configuration and
 * is the same for every project.
 */
async function buildRuntimeFor(target: Workspace): Promise<AgentRuntime> {
  const cwd = target.settings.cwd;
  if (config.agentRuntime.mode === "rpc") {
    // The child builds its own toolset, so everything the embedded runtime hands
    // to the SDK has to be said on the command line instead: the same skills,
    // extensions, prompt templates, tool allowlist and system prompt — plus
    // pi-outpost's own tools, which exist nowhere else and travel as an extension.
    const toolsExtension = await resolveToolsExtension();
    return await createRpcRuntime({
      settings: config.agentRuntime,
      cwd,
      agentDir: AGENT_DIR,
      sessionDir: SESSION_DIR,
      resourceArgs: [
        ...rpcResourceArgs(config, {
          bundledSkills: config.noSkills ? [] : BUNDLED_SKILLS,
          appendSystemPrompt: composeAppendSystemPrompt(config),
        }),
        "--extension",
        toolsExtension,
      ],
      env: {
        [TOOLS_ENV_VAR]: JSON.stringify({
          cwd,
          maxBytes: {
            pdf: config.pdf.maxBytes,
            docx: config.docx.maxBytes,
            xlsx: config.xlsx.maxBytes,
            pptx: config.pptx.maxBytes,
            structuredExchange: config.structuredExchange.maxBytes,
          },
        } satisfies PiOutpostToolsSettings),
      },
    });
  }
  return await createEmbeddedRuntime({
    factory: makeCreateRuntime(target.sandboxedTools),
    cwd,
    agentDir: AGENT_DIR,
    sessionManager: SessionManager.create(cwd, SESSION_DIR),
    onModelFallback: (message) => console.warn(`[pi] ${message}`),
  });
}

/**
 * The server's own project. A failure here is fatal on purpose — falling back to
 * the other runtime would silently run something the operator did not configure —
 * whereas a failure opening a *second* project is reported to the client that
 * asked and leaves the server running.
 */
const builtRuntime: AgentRuntime = await (async () => {
  try {
    return await buildRuntimeFor(workspace);
  } catch (error) {
    complain(error);
    await app.close();
    process.exit(1);
  }
})();

// The session exists now, so the workspace is whole. Everything below reaches the
// agent through it: there is no second name for the runtime, which is what stops a
// handler from driving the wrong project once the server holds more than one.
workspace.attachRuntime(builtRuntime);

/**
 * The open projects. One today — the registry is what the second one arrives into,
 * and what makes "already open" a lookup rather than a duplicate.
 */
const workspaces = new WorkspaceRegistry();
// Nothing to race with at boot: this is the first, so it is its own winner — and
// the default, which is what an unnamed connection and a pinned embed both get.
workspaces.add(workspace);

/**
 * Projects opened in an earlier run. Their resources are built, their sessions are
 * not: startup time must not grow with the number of open projects, and a project
 * nobody opens in this run should never cost a model, extension and skill load.
 *
 * A project that has gone missing is dropped with a warning rather than being
 * fatal: a server must still start when a directory was moved or unmounted, and
 * the one it booted with is always there.
 */
for (const root of config.openProjects) {
  if (workspaces.get(root)) continue;
  try {
    const restored = await Workspace.create({
      ...workspaceOptions({ cwd: root }),
      onDirectoryChanged: (relPath) => {
        restored.noteDirectoryChange();
        broadcast(restored, { type: "directory_changed", path: relPath });
      },
      onRepositoriesChanged: () =>
        broadcast(restored, {
          type: "git_repositories_changed",
          available: restored.repos.length > 0 && restored.gitUnavailable === undefined,
          ...(restored.gitUnavailable ? { unavailable: restored.gitUnavailable } : {}),
        }),
      createRuntime: () => { throw new Error("unused: runtimes are built through ensureStarted"); },
    });
    workspaces.add(restored);
  } catch (error) {
    console.warn(`[pi] could not reopen ${root}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

workspace.workPlan = await loadWorkPlan(workspace.agent.snapshot().sessionFile);
workspace.workPlanSessionFile = workspace.agent.snapshot().sessionFile;

/**
 * Session replacement events are synchronous, while their sidecar reads are not.
 * Keep those reads ordered so a fork can wait for the replacement snapshot before
 * copying and announcing its inherited plan. Without the queue, a late ENOENT read
 * could overwrite the copied plan with null.
 */
function queueWorkPlanSessionSync(workspace: Workspace): Promise<void> {
  const sessionFile = workspace.agent.snapshot().sessionFile;
  workspace.workPlanSync = workspace.workPlanSync.catch(() => {}).then(async () => {
    const inheritanceSource = workspace.workPlanInheritanceSource;
    const inherited =
      inheritanceSource !== undefined && !sameSessionFile(inheritanceSource, sessionFile);
    let plan: WorkPlan | null = null;
    try {
      if (inherited) await copyWorkPlan(inheritanceSource, sessionFile);
      plan = await loadWorkPlan(sessionFile);
    } catch (error) {
      reportError(error);
    }
    if (!sameSessionFile(workspace.agent.snapshot().sessionFile, sessionFile)) return;
    workspace.workPlan = plan;
    workspace.workPlanSessionFile = sessionFile;
    broadcast(workspace, { type: "session_replaced", ...snapshot(workspace) });
    if (inherited) broadcast(workspace, { type: "work_plan_changed", workPlan: plan });
    announceWorkspaceActivity();
    console.log(`[pi] session ${workspace.agent.snapshot().sessionId}`);
  });
  workspace.workPlanSync.catch(reportError);
  return workspace.workPlanSync;
}

function queueWorkPlanToolSync(workspace: Workspace, sessionFile: string, changed: boolean): void {
  workspace.workPlanSync = workspace.workPlanSync.catch(() => {}).then(async () => {
    let plan: WorkPlan | null;
    try {
      plan = await loadWorkPlan(sessionFile);
    } catch (error) {
      reportError(error);
      return;
    }
    if (!sameSessionFile(workspace.agent.snapshot().sessionFile, sessionFile)) return;
    workspace.workPlan = plan;
    workspace.workPlanSessionFile = sessionFile;
    if (changed) {
      broadcast(workspace, { type: "work_plan_changed", workPlan: plan });
      announceWorkspaceActivity();
    }
  });
  workspace.workPlanSync.catch(reportError);
}

function modelName(workspace: Workspace): string {
  const model = workspace.agent.snapshot().model;
  return model ? `${model.provider}/${model.id}` : "unknown";
}

/**
 * The thinking levels to report for a workspace's current model.
 *
 * A deployment's declaration wins over the runtime's: this setting exists because the
 * runtime is guessing, and for a model it does not recognise its guess is the full set
 * — a slider offering levels the model cannot honour, snapping back with no reason
 * given. Undefined when neither has anything to say, which a client reads as "offer
 * everything", exactly as before.
 */
function acceptedThinkingLevels(workspace: Workspace): ThinkingLevel[] | undefined {
  const state = workspace.agent.snapshot();
  return declaredThinkingLevels(config.thinkingLevels, state.model) ?? state.thinkingLevels;
}

function contextUsage(workspace: Workspace): ContextUsage | undefined {
  return workspace.agent.snapshot().contextUsage;
}

function availableModels(workspace: Workspace): ModelChoice[] {
  const models = workspace.agent.snapshot().models;
  if (!config.allowedModels) return models;
  const allowed = config.allowedModels;
  return models.filter((m) => allowed.some((a) => a.provider === m.provider && a.id === m.id));
}

/**
 * Which providers can actually answer, and where their credentials live.
 *
 * The client needs "no provider is configured" (onboard the user) apart from
 * "providers are configured but no model survives `allowedModels`" (a config
 * problem) — hence `providers` *and* `usableModel`, rather than an empty model
 * list, which conflates the two.
 */
function credentialStatus(workspace: Workspace, ): CredentialStatus {
  const usableModel = availableModels(workspace).length > 0;
  return {
    providers: workspace.agent.snapshot().providers,
    usableModel,
    // Only while onboarding needs it: an absolute path names the server's OS account,
    // and there is no reason for a working server to tell every client where it lives.
    ...(usableModel ? {} : { agentDir: AGENT_DIR }),
  };
}

/**
 * Snapshot for `hello` / `session_replaced`. Mid-stream connects are covered:
 * the runtime keeps the partial assistant message in its message list from
 * message_start, and historyToItems adds running tool cards for toolCalls
 * without a result yet.
 */
/** User messages persisted on the current branch, oldest first — lets the UI edit a past prompt. */
function branchUserEntries(workspace: Workspace): { entryId: string; text: string }[] {
  return workspace.agent
    .contextEntries()
    .filter((e) => e.type === "message" && e.message?.role === "user")
    .map((e) => ({ entryId: e.id, text: contentText(e.message!.content as never) }));
}

/**
 * How a project appears in the selector.
 *
 * `activity` is derived, never stored: a stored copy is a second source of truth
 * that drifts the first time a turn ends without anyone updating it.
 */
function workspaceInfo(target: Workspace): WorkspaceInfo {
  const activity = workspaceActivity(target);
  return {
    root: target.root,
    name: path.basename(target.root),
    activity,
    ...(workspaceActivityNeedsAttention(activity) ? { needsAttention: true } : {}),
  };
}

function workspaceWorkPlanReadyForReview(target: Workspace): boolean {
  return target.started
    && target.workPlanSessionFile !== undefined
    && sameSessionFile(target.agent.snapshot().sessionFile, target.workPlanSessionFile)
    && isWorkPlanReadyForReview(target.workPlan);
}

/** The four extension UI methods that block a turn until the user answers. */
const BLOCKING_UI_METHODS = new Set(["select", "confirm", "input", "editor"]);

function workspaceActivity(target: Workspace): WorkspaceActivity {
  const started = target.started;
  return deriveWorkspaceActivity({
    // Building right now is checked before `started`, which remains false for the
    // build: otherwise starting would be announced and immediately read stopped.
    starting: starting.has(target.root),
    started,
    waiting: target.needsAttention,
    busy: target.isBusy(),
    workPlanReadyForReview: workspaceWorkPlanReadyForReview(target),
  });
}

/**
 * Bind a connection to a workspace and tell it everything about where it now is.
 *
 * One function rather than four call sites, because the second half is the part
 * that gets forgotten: a dialog is sent once, to whoever was watching when it was
 * raised. A client that arrives afterwards — switching back, reconnecting, or
 * moved here because the project it was on closed — would otherwise see a project
 * reported as waiting and have no way to answer it, and the turn would stay
 * blocked forever.
 */
function bindClient(socket: WebSocket, target: Workspace, kind: "hello" | "workspace_switched"): void {
  // Binding happens after `ensureStarted`, and a client can close while a cold
  // workspace is still building. Its close handler has already forgotten it by
  // then, and no second close will come — so binding it here would leave a dead
  // socket in `clients`, and a workspace nobody is watching would count as
  // watched forever and never be retired.
  if (socket.readyState !== socket.OPEN) {
    clients.delete(socket);
    return;
  }
  clients.set(socket, target);
  send(socket, { type: kind, ...snapshot(target) });
  for (const request of target.pendingDialogs.values()) send(socket, request);
}

function workspaceInfos(): WorkspaceInfo[] {
  return [...workspaces.all()].map(workspaceInfo);
}

/**
 * Tell every client what each project is doing — including the clients bound
 * elsewhere, which is the whole point: an agent working in a project nobody is
 * watching is invisible otherwise.
 *
 * Sent whatever the number open. It used to be silent below two, on the grounds that
 * there was no selector to feed — and there was not, until the interface started
 * naming the single project too. A control that shows an activity and never hears it
 * change is worse than one that shows none: it reports "idle" through a whole turn.
 */
function announceWorkspaceActivity(): void {
  broadcastServerWide({ type: "workspace_activity", workspaces: workspaceInfos() });
}

/** Sandbox paths to announce after updating. */
let lastAnnouncedSandbox: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string } | undefined;

/**
 * Describe one project's state for a client bound to it.
 *
 * Takes its workspace rather than reading the module binding: a snapshot is the
 * answer to "what is THIS connection looking at", and the two come apart as soon
 * as the server holds a second project.
 */
function snapshot(workspace: Workspace): SessionSnapshot {
  const state = workspace.agent.snapshot();
  return {
    branding: config.branding,
    // Always, whatever the number open. A selector's first job is to say where the
    // user is; choosing is its second. Below two these were omitted, so a client had
    // no name to show even when it wanted to — and the interface changed shape as
    // the count crossed the threshold.
    workspace: workspaceInfo(workspace),
    workspaces: workspaceInfos(),
    ...(config.workspaceLock ? { workspaceLocked: true } : {}),
    // Absent means "settings", so a client that predates the setting — or one
    // that is not embedded — sees exactly what it saw before.
    ...(config.embed.workspaceControls !== "settings"
      ? { embedWorkspaceControls: config.embed.workspaceControls }
      : {}),
    sessionId: state.sessionId,
    model: modelName(workspace),
    thinkingLevel: state.thinkingLevel,
    ...((): { thinkingLevels?: ThinkingLevel[] } => {
      const levels = acceptedThinkingLevels(workspace);
      return levels ? { thinkingLevels: levels } : {};
    })(),
    isStreaming: state.isStreaming,
    items: historyToItems(
      state.messages as never,
      state.isStreaming,
      branchUserEntries(workspace).map((entry) => entry.entryId),
      workspace.browserRoot,
      workspace.renderer,
    ),
    models: availableModels(workspace),
    commands: state.commands,
    contextUsage: state.contextUsage,
    // A runtime replacement is synchronous but its sidecar read is not. Never
    // combine the new transcript/session id with the previous session's plan.
    workPlan: sameSessionFile(state.sessionFile, workspace.workPlanSessionFile) ? workspace.workPlan : null,
    writableRoot: workspace.writableRoot,
    // Not merely "a repository was found on disk": one git will actually read
    gitAvailable: workspace.repos.length > 0 && workspace.gitUnavailable === undefined,
    ...(workspace.gitUnavailable ? { gitUnavailable: workspace.gitUnavailable } : {}),
    credentials: credentialStatus(workspace),
    // Omitted, not emptied, when the runtime cannot report an inventory: "none
    // loaded" and "this runtime never sees them" are different facts, and only one
    // of them is ours to state.
    ...(state.extensionPaths ? { extensionPaths: state.extensionPaths } : {}),
    // What is configured, not what got loaded — built-in skills reach the menu
    // through `commands` instead. The two lists are separate because only one of
    // them is the user's to edit.
    skillPaths: config.skillPaths,
    userSkillPaths: config.userSkillPaths,
    configuredExtensionPaths: config.extensionPaths,
    userExtensionPaths: config.userExtensionPaths,
    ...(config.extensionLock ? { extensionLock: true } : {}),
    tools: state.tools,
    // One line for what answers prompts: the SDK in this process, or the child.
    versions: {
      piOutpost: VERSION,
      ...(workspace.agent.agentLabel ? { agent: workspace.agent.agentLabel } : { piSdk: PI_SDK_VERSION }),
    },
    sandbox: (() => {
      const v = config.sandbox
        ? {
            root: config.sandbox.root,
            allowWrite: config.sandbox.allowWrite ?? false,
            allowBash: config.sandbox.allowBash ?? false,
            writableRoot: config.sandbox.writableRoot,
            locks: config.sandboxLocks,
          }
        : undefined;
      console.log("[snapshot] sandbox =", JSON.stringify(v));
      return v;
    })(),
    terminal: {
      enabled: config.terminal?.enabled ?? false,
      ...(config.sandboxLocks?.terminal ? { locked: true } : {}),
    },
  };
}

// --- WebSocket broadcast -------------------------------------------------------

/**
 * Every connected client, and the workspace it is bound to.
 *
 * A set before this: one workspace meant one audience, so "connected" and
 * "interested in this project" were the same fact. They stop being the same fact
 * as soon as the server holds a second project, and a message that reaches a
 * client bound elsewhere is the failure this map exists to make unstatable.
 */
const clients = new Map<WebSocket, Workspace>();
const terminalManager = new TerminalManager();

const WS_LOG_PATH = process.env.WS_LOG_PATH ? path.resolve(process.env.WS_LOG_PATH) : undefined;

function sendToSockets(sockets: Iterable<WebSocket>, message: ServerMessage): void {
  const data = JSON.stringify(message);
  // Optional file logging for debugging WebSocket payloads
  if (WS_LOG_PATH) {
    // Best-effort write; don't block the event loop on failures
    fs.appendFile(WS_LOG_PATH, data + "\n").catch(() => {});
  }
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}

/**
 * Tell the clients watching THIS workspace. The default shape, and the one that
 * takes its audience as an argument: a message carrying one project's content has
 * no business reaching a client looking at another.
 */
function broadcast(workspace: Workspace, message: ServerMessage): void {
  const sockets: WebSocket[] = [];
  for (const [socket, bound] of clients) if (bound === workspace) sockets.push(socket);
  sendToSockets(sockets, message);
}

/**
 * Tell every client on the server, whatever it is bound to.
 *
 * Deliberately the longer name. A server-wide send is the exception — it is for
 * facts about the server rather than about a project — and naming it plainly is
 * what makes a wrong choice visible at the call site instead of in a bug report.
 *
 * No call site yet, and that is the finding rather than an oversight: every message
 * broadcast today carries one project's content. The one that looked server-wide,
 * `credentials_changed`, mixes a server-wide fact (which providers are configured)
 * with a project-scoped one (`modelName(workspace)`, this session's model) — sending it to
 * every client would tell one project's viewer that another project changed model.
 * Splitting that payload is a protocol change, not a routing choice.
 *
 * What this is waiting for is workspace activity and attention: the spec requires
 * those to reach clients bound elsewhere, which is exactly a fact about the server.
 */
function broadcastServerWide(message: ServerMessage): void {
  sendToSockets(clients.keys(), message);
}

function send(socket: WebSocket, message: ServerMessage): void {
  const data = JSON.stringify(message);
  if (WS_LOG_PATH) {
    fs.appendFile(WS_LOG_PATH, data + "\n").catch(() => {});
  }
  if (socket.readyState === socket.OPEN) socket.send(data);
}

// --- Extension "Custom UI" bridge -----------------------------------------------
//
// Requests reach the browser the same way whichever runtime produced them: the
// embedded session drives them through ExtensionUiBridge, an RPC child emits them
// on stdout, and both surface as an `extension_ui_request` runtime event that this
// file broadcasts. Answers travel back through workspace.agent.answerExtensionUI.

/** Wire extension TUI renderers into the HTML bridge used by the web UI. */
function refreshExtensionRender(workspace: Workspace): void {
  const renderers = workspace.agent.renderers;
  // This project's renderers, on this project's object: two open projects each
  // dress their own cards, with their own extensions and their own cwd.
  workspace.renderer.configure({
    // An RPC child cannot hand its renderer objects across the pipe, so tool cards
    // fall back to the built-in rendering rather than an extension-supplied one.
    getToolDefinition: (name) => renderers?.getToolDefinition(name) as never,
    getMessageRenderer: (customType) => renderers?.getMessageRenderer(customType) as never,
    cwd: workspace.settings.cwd,
    themeName: "dark",
  });
}

/** args of an in-flight edit/write call, captured at tool_execution_start and consumed at tool_execution_end. */
const pendingFileMutations = new Map<string, unknown>();

/**
 * Best-effort file-browser invalidation: if an edit/write tool touched a path inside
 * the browser root, tell clients so an expanded directory or open preview can refresh.
 * Not a security boundary — resolution failures or out-of-root paths are just skipped.
 */
async function announceFileChange(workspace: Workspace, args: unknown): Promise<void> {
  const targetPath = (args as { path?: unknown } | null)?.path;
  console.log("[announceFileChange] args type=", typeof args, "targetPath=", targetPath);
  if (typeof targetPath !== "string") return;
  try {
    const resolved = await realResolve(path.resolve(workspace.browserRoot, targetPath));
    if (!isWithin(workspace.browserRoot, resolved)) {
      console.log("[announceFileChange] not within the browser root, skipping");
      return;
    }
    const relPath = path.relative(workspace.browserRoot, resolved).split(path.sep).join("/");
    console.log("[announceFileChange] broadcasting file_changed path=", relPath);
    broadcast(workspace, { type: "file_changed", path: relPath });
  } catch (e) {
    console.log("[announceFileChange] error:", e);
    // Resolution failure (e.g. race with the tool call) — nothing to invalidate
  }
}

// --- Runtime events -> wire events ---------------------------------------------

/**
 * The one place a runtime event becomes a browser message. Both runtimes emit the
 * same normalized union (agentRuntime.ts), so nothing below may branch on which
 * one is running — a divergence here is what "the frontend is unaware of the
 * runtime" would cost.
 */
/**
 * Route one project's runtime events to the clients watching it.
 *
 * Takes its workspace rather than closing over the server's: a second project's
 * session emits through this too, and a closure over the boot workspace would send
 * its stream to the wrong audience — or to nobody.
 */
function onRuntimeEvent(workspace: Workspace, event: RuntimeEvent): void {
  switch (event.type) {
    case "agent_start":
      broadcast(workspace, { type: "agent_start" });
      // The selector shows a project working while the client is looking elsewhere;
      // without this it would only learn at the next sweep, or never.
      announceWorkspaceActivity();
      break;
    case "agent_end": {
      // Nothing is blocked once the turn is over: a cancelled or failed turn leaves
      // no question to answer, and a badge that cannot be cleared is worse than
      // no badge at all.
      workspace.pendingDialogs.clear();
      broadcast(workspace, { type: "agent_end" });
      // Unconditional: the project just went from working to idle, which the
      // selector must show whether or not anything was blocked.
      announceWorkspaceActivity();
      const usage = contextUsage(workspace);
      if (usage) broadcast(workspace, { type: "context_usage", usage });
      // The turn is persisted now: hand the client the entries so the bubbles it
      // echoed optimistically become editable (edit_prompt targets an entry id).
      broadcast(workspace, { type: "user_entries", entries: branchUserEntries(workspace) });
      broadcast(workspace, { type: "tree", roots: buildTree(workspace) });
      // Off the prompt path on purpose: a slow title must never delay a reply
      void maybeNameSession(workspace);
      break;
    }
    case "assistant_start":
      broadcast(workspace, { type: "assistant_start" });
      break;
    case "block_delta":
      broadcast(workspace, { type: "block_delta", block: event.block, contentIndex: event.contentIndex, delta: event.delta });
      break;
    case "assistant_end": {
      // Full sync of the finished message (covers retries/partial rebuilds)
      broadcast(workspace, { type: "assistant_end", item: assistantToItem(event.message as never) });
      // A turn that died of stack exhaustion arrives here as a message and no
      // stack: every provider's catch keeps `error.message` and drops the Error.
      // Record the input instead, while the branch that produced it is still
      // the branch on screen — see turnFailureLog.ts.
      const failure = (event.message as { errorMessage?: unknown } | null)?.errorMessage;
      if (typeof failure === "string" && isStackExhaustion(failure)) {
        recordTurnFailure(AGENT_DIR, {
          source: "assistant",
          message: failure,
          assistantMessage: event.message,
          entries: workspace.agent.contextEntries(),
          contextUsage: contextUsage(workspace),
        });
      }
      // After the census, so a turn does not appear in its own run-up: every
      // reported occurrence followed a cut request, and the cut is the context
      // the overflow is missing.
      noteTurnOutcome(event.message);
      break;
    }
    case "custom_message":
      broadcast(workspace, { type: "custom_message", item: customMessageToItem(event.message as never, workspace.renderer) });
      break;
    case "tool_start": {
      const callHtml = workspace.renderer.renderToolCallHtml(event.toolCallId, event.toolName, event.args);
      broadcast(workspace, {
        type: "tool_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        ...(callHtml ? { callHtml } : {}),
      });
      if (event.toolName === "edit" || event.toolName === "write") {
        pendingFileMutations.set(event.toolCallId, event.args);
      }
      break;
    }
    case "tool_update": {
      const text = contentText(event.content as never);
      const progress = toProgressFraction(event.progress);
      // A progress-only update carries no text; still send it so the bar can move.
      if (text || progress !== undefined) {
        broadcast(workspace, {
          type: "tool_update",
          toolCallId: event.toolCallId,
          text: truncate(text),
          ...(progress !== undefined ? { progress } : {}),
        });
      }
      break;
    }
    case "tool_end": {
      // The reported run-up opens with a red tool card; its name and the weight
      // of what it returned are the two facts that survive into the census.
      noteToolOutcome(event.toolName, event.isError, event.content);
      const rendered = workspace.renderer.renderToolResultHtml(
        event.toolCallId,
        event.toolName,
        event.content as never,
        event.details,
        event.isError,
      );
      broadcast(workspace, {
        type: "tool_end",
        toolCallId: event.toolCallId,
        isError: event.isError,
        text: truncate(contentText(event.content as never)),
        ...(rendered ? { outputHtml: rendered.expanded, outputHtmlCollapsed: rendered.collapsed } : {}),
        ...structuredExchangeField(event.details),
      });
      const args = pendingFileMutations.get(event.toolCallId);
      pendingFileMutations.delete(event.toolCallId);
      // Only announce once the write has actually landed on disk — the client
      // may otherwise refetch a directory/file before the change is visible.
      if (args !== undefined && !event.isError) void announceFileChange(workspace, args);
      const workPlanDetails = event.details as
        | { type?: unknown; sessionFile?: unknown; plan?: WorkPlan | null; changed?: unknown }
        | undefined;
      if (
        event.toolName === "work_plan" &&
        !event.isError &&
        workPlanDetails?.type === "work_plan" &&
        typeof workPlanDetails.sessionFile === "string" &&
        sameSessionFile(workPlanDetails.sessionFile, workspace.agent.snapshot().sessionFile)
      ) {
        try {
          // Reject malformed tool details at the runtime boundary, then reload
          // the sidecar: persistence, not an extension-supplied event payload,
          // is the authoritative state that must survive resume/compaction.
          if (workPlanDetails.plan !== null) validateWorkPlan(workPlanDetails.plan);
          queueWorkPlanToolSync(workspace, workPlanDetails.sessionFile as string, workPlanDetails.changed === true);
        } catch (error) {
          reportError(new Error(`Ignoring invalid Work Plan tool result: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
      break;
    }
    case "queue":
      broadcast(workspace, { type: "queue", steering: event.steering, followUp: event.followUp });
      break;
    case "thinking_changed":
      broadcast(workspace, { type: "thinking_changed", level: event.level });
      break;
    case "compaction_start":
      broadcast(workspace, { type: "compaction_start" });
      noteCompaction("start");
      break;
    case "compaction_end": {
      broadcast(workspace, { type: "compaction_end", ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}) });
      // Compaction summarizes the branch with a model call of its own, so it
      // fails the same ways a turn does — and reaches the same red list.
      if (event.errorMessage && isStackExhaustion(event.errorMessage)) {
        recordTurnFailure(AGENT_DIR, {
          source: "compaction",
          message: event.errorMessage,
          entries: workspace.agent.contextEntries(),
          contextUsage: contextUsage(workspace),
        });
      }
      noteCompaction("end", event.errorMessage);
      const usage = contextUsage(workspace);
      if (usage) broadcast(workspace, { type: "context_usage", usage });
      break;
    }
    case "session_replaced":
      // The runtime has already rebound itself; renderers may belong to a new
      // extension runner, so refresh the HTML bridge before the snapshot goes out.
      refreshExtensionRender(workspace);
      void queueWorkPlanSessionSync(workspace);
      break;
    case "extension_ui_request":
      // Only the four dialog methods block a turn. notify, setStatus, setWidget,
      // setTitle and set_editor_text are one-way — badging those would report a
      // project as waiting for an answer nobody can give.
      if (BLOCKING_UI_METHODS.has(event.request.method)) {
        workspace.pendingDialogs.set(event.request.id, event.request);
        announceWorkspaceActivity();
      }
      broadcast(workspace, event.request);
      break;
    case "error":
      // Same treatment as an assistant turn's own failure: a provider reached
      // through a proxy answers with an HTML page, and the reader gets markup.
      broadcast(workspace, { type: "error", message: describeProviderError(event.message) });
      if (isStackExhaustion(event.message)) {
        recordTurnFailure(AGENT_DIR, {
          source: "runtime",
          message: event.message,
          entries: workspace.agent.contextEntries(),
          contextUsage: contextUsage(workspace),
        });
      }
      break;
    case "runtime_failed":
      // Fail closed: /health already reports unready, and this is the one visible
      // notice. No restart, no replay — a prompt or tool may have had side effects.
      console.error(`[pi] agent runtime failed: ${event.message}`);
      broadcast(workspace, { type: "error", message: `Agent runtime failed: ${event.message}` });
      // Fail-closed means nothing runs after this, so the census is written
      // synchronously or not at all.
      if (isStackExhaustion(event.message)) {
        recordTurnFailure(AGENT_DIR, { source: "runtime_failed", message: event.message });
      }
      break;
  }
}

workspace.agent.subscribe((event) => onRuntimeEvent(workspace, event));
refreshExtensionRender(workspace);

// --- Client message handling -----------------------------------------------------

/**
 * Session replacement (new/switch) disposes the current AgentSession — never
 * run two concurrently, and never leave a disposed session wired on failure.
 */

async function replaceSession(workspace: Workspace, socket: WebSocket, action: () => Promise<{ cancelled: boolean }>): Promise<void> {
  if (workspace.replacingSession) {
    send(socket, { type: "error", message: "Session change already in progress" });
    return;
  }
  workspace.replacingSession = true;
  try {
    // The runtime rebinds and emits `session_replaced` itself; this only has to
    // decide whether a replacement happened at all.
    const result = await action();
    if (!result.cancelled) await workspace.workPlanSync;
  } catch (error) {
    reportError(error);
    // The old session may be disposed — land on a fresh one instead. A runtime that
    // has failed closed cannot supply one, so don't ask it to.
    if (!workspace.agent.ok) return;
    try {
      await workspace.agent.newSession();
    } catch (recoveryError) {
      reportError(recoveryError);
    }
  } finally {
    workspace.replacingSession = false;
  }
}

/**
 * A dialog answer is only one of three shapes — validate it before it becomes a
 * record on the agent's stdin.
 *
 * The ceiling matters as much as the shape. Writes to the child are serialized, so
 * one oversized record holds up every command behind it until the command timeout
 * fires and fails the runtime permanently. An editor dialog can legitimately carry
 * a long answer, so the limit is generous rather than tight.
 */
const MAX_DIALOG_ANSWER_CHARS = 1_000_000;

function extensionUiAnswer(message: { id: string } & Record<string, unknown>): ExtensionUIResponse | undefined {
  const { id } = message;
  if (message.cancelled === true) return { type: "extension_ui_response", id, cancelled: true };
  if (typeof message.confirmed === "boolean") return { type: "extension_ui_response", id, confirmed: message.confirmed };
  if (typeof message.value === "string" && message.value.length <= MAX_DIALOG_ANSWER_CHARS) {
    return { type: "extension_ui_response", id, value: message.value };
  }
  return undefined;
}

/** Refuse a browser command the selected runtime cannot serve, saying which one refused. */
function refuseUnsupported(socket: WebSocket, error: unknown): boolean {
  if (!(error instanceof RuntimeUnsupportedError)) return false;
  send(socket, { type: "error", message: error.message });
  return true;
}

/**
 * Store an API key, then make the agent usable *now*: the live session was built
 * against a model with no auth, so a refreshed registry alone would not help it.
 * Rebuilding through replaceSession is what turns the onboarding screen into a
 * working chat without a restart or even a reload.
 */
/** How long onboarding waits on the SDK before it reports what it has. */
const CREDENTIAL_SYNC_TIMEOUT_MS = 20_000;

async function handleSetCredential(workspace: Workspace, socket: WebSocket, provider: string, apiKey: string): Promise<void> {
  const credentials = workspace.agent.credentials;
  if (!credentials) {
    send(socket, { type: "error", message: new RuntimeUnsupportedError("Storing credentials", workspace.agent.kind).message });
    return;
  }
  // Neither of the two SDK calls below carries a deadline of its own. Onboarding is a
  // user pressing Save and watching a spinner, so give each one a ceiling: past it,
  // announce what we have rather than leaving the UI waiting forever.
  //
  // A ceiling *each*, not one shared between them: with a single signal, a first step
  // that burns the whole budget leaves the second none, and the second would abort
  // instantly for a reason that has nothing to do with it.
  const stalled = (step: string, detail: unknown) =>
    console.warn(
      `[pi] ${provider} key stored, but ${step} did not finish within ${CREDENTIAL_SYNC_TIMEOUT_MS / 1000}s: ${
        detail instanceof Error ? detail.message : String(detail)
      }`,
    );

  try {
    await credentials.storeApiKey(provider, apiKey, AbortSignal.timeout(CREDENTIAL_SYNC_TIMEOUT_MS));
  } catch (error) {
    // A key that never reached disk is a failed login. One that reached disk but not
    // the live runtime is not: it works on the next start, and the snapshot below
    // still tells the client where things stand.
    if (!(error instanceof CredentialSyncError)) {
      send(socket, { type: "error", message: error instanceof CredentialError ? error.message : String(error) });
      return;
    }
    stalled("the live model runtime", error);
  }

  try {
    // refresh() reaches the network unless PI_OFFLINE is set: it re-fetches remote
    // model catalogs, and that request is what hangs on a constrained host.
    //
    // It also *swallows* an abort — it resolves with `{ aborted: true }` instead of
    // throwing — so the catch below never sees one. Read the flag, or a refresh cut
    // short at the ceiling passes for a clean one and the warning never fires.
    const result = await credentials.refreshModels(AbortSignal.timeout(CREDENTIAL_SYNC_TIMEOUT_MS));
    if (result?.aborted) stalled("the model refresh", "aborted at the ceiling");
  } catch (error) {
    stalled("the model refresh", error);
  }
  await adoptUsableModel(workspace, socket);
}

/**
 * Apply the editable runtime settings: persist them, then rebuild the session so
 * the new toolset and skills take effect.
 *
 * Persist *first*, and give up on the whole thing if the write fails. The old
 * order — mutate the live config, rebuild, and never write anything — meant a
 * change the user watched take effect vanished at the next restart, and there was
 * no moment at which the two disagreed visibly enough to notice. Writing first
 * also makes the failure honest: a configuration that cannot be saved leaves the
 * running server exactly as it was, and says so.
 *
 * The running turn (if any) continues under the old sandbox.
 */
async function handleUpdateConfig(
  workspace: Workspace,
  socket: WebSocket,
  update: {
    sandbox?: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string };
    userSkillPaths?: string[];
    userExtensionPaths?: string[];
  },
): Promise<void> {
  if (workspace.replacingSession) {
    send(socket, { type: "error", message: "Session change already in progress" });
    return;
  }
  const rebuildTools = workspace.agent.rebuildTools;
  if (!rebuildTools) {
    // These settings describe resources this server builds. An RPC child builds its
    // own, so accepting the change would leave the UI showing a boundary nothing
    // enforces and skills the child never loaded.
    send(socket, { type: "error", message: new RuntimeUnsupportedError("Changing runtime settings", workspace.agent.kind).message });
    return;
  }
  if (update.sandbox && config.sandbox === undefined) {
    send(socket, { type: "error", message: "No sandbox configured — cannot update" });
    return;
  }
  // Refused here rather than merged away like a locked sandbox field: the interface
  // draws no control for this, so a request carrying one did not come from the
  // interface, and silently applying the rest of it would tell that client its
  // extension change succeeded. Nothing is persisted and no session is replaced.
  if (update.userExtensionPaths !== undefined && config.extensionLock) {
    send(socket, {
      type: "error",
      message: "Extension paths are locked by this deployment's configuration",
    });
    return;
  }

  // Paths typed into Settings resolve like paths written in the config file —
  // against the file's own directory — since that file is where they are going.
  const configDir = path.dirname(config.configFile);
  const resolve = (p: string) => path.resolve(configDir, p);

  // Enforce locks from config: locked fields keep their current value
  const locks = config.sandboxLocks ?? {};
  const current = config.sandbox;
  const mergedSandbox =
    update.sandbox && current
      ? {
          root: locks.root ? current.root : resolve(update.sandbox.root),
          allowWrite: locks.allowWrite ? current.allowWrite : update.sandbox.allowWrite,
          allowBash: locks.allowBash ? current.allowBash : update.sandbox.allowBash,
          writableRoot: locks.writableRoot
            ? current.writableRoot
            : update.sandbox.writableRoot === undefined
              ? undefined
              : resolve(update.sandbox.writableRoot),
        }
      : undefined;
  const mergedSkillPaths = update.userSkillPaths?.map(resolve);
  const mergedExtensionPaths = update.userExtensionPaths?.map(resolve);

  const persisted: EditableSettings = {
    ...(mergedSandbox ? { sandbox: mergedSandbox } : {}),
    ...(mergedSkillPaths ? { userSkillPaths: mergedSkillPaths } : {}),
    ...(mergedExtensionPaths ? { userExtensionPaths: mergedExtensionPaths } : {}),
  };
  try {
    persistEditableSettings(config, persisted);
  } catch (error) {
    // Nothing has been touched: the live configuration, the browser roots and the
    // session are all still the ones the user is looking at.
    reportError(error);
    send(socket, {
      type: "error",
      message: error instanceof ConfigWriteError ? error.message : `Could not save settings: ${String(error)}`,
    });
    return;
  }

  workspace.replacingSession = true;
  try {
    if (mergedSkillPaths) config.userSkillPaths = mergedSkillPaths;
    if (mergedExtensionPaths) config.userExtensionPaths = mergedExtensionPaths;
    if (mergedSandbox) {
      config.sandbox = {
        root: mergedSandbox.root,
        allowWrite: mergedSandbox.allowWrite,
        allowBash: mergedSandbox.allowBash,
        writableRoot: mergedSandbox.writableRoot,
        readExceptions: [],
      };
    }
    if (config.sandbox) {
      // Recomputed rather than carried over: skill and extension paths are read-only
      // exceptions to the sandbox (see loadConfig), so a directory added outside the
      // root would otherwise hold a skill — or an extension — the agent is forbidden
      // to read.
      config.sandbox.readExceptions = [
        ...allSkillPaths(config),
        ...config.promptPaths,
        ...allExtensionPaths(config),
        ...config.extensionScripts,
      ];
    }
    // Roots, git, watcher and toolset in one call: every watched path was relative
    // to the root that just moved, and the workspace rebuilds them together or not
    // at all — a half-applied boundary is the failure this used to risk.
    // This workspace's own cwd, not the server's: Settings edits the project the
    // connection is looking at. `config.sandbox` stays the server's default, which
    // is what a project opened later inherits.
    await workspace.rebuildResources({ cwd: workspace.settings.cwd, ...(config.sandbox ? { sandbox: config.sandbox } : {}) });
    // Replace the current session so the new runtime picks up the updated tools
    // and re-runs skill discovery over the new paths.
    await rebuildTools.call(workspace.agent);
    await workspace.workPlanSync;
    // Only now: the settings are on disk and the session in front of the user was
    // built from them.
    send(socket, { type: "update_config_ack", ...snapshot(workspace) });
  } catch (error) {
    reportError(error);
    send(socket, { type: "error", message: `Settings saved, but the session could not be rebuilt: ${error instanceof Error ? error.message : String(error)}` });
    try {
      await rebuildTools.call(workspace.agent);
    } catch (recoveryError) {
      reportError(recoveryError);
    }
  } finally {
    workspace.replacingSession = false;
  }
}


/**
 * Open a directory as a project.
 *
 * Persist before building, and give up on the whole thing if the write fails: a
 * project the user watched appear must still be there at the next start, and a set
 * that cannot be saved leaves the server exactly as it was. Same order, and the
 * same reason, as handleUpdateConfig.
 */
async function handleOpenProject(socket: WebSocket, rawRoot: string): Promise<void> {
  if (config.workspaceLock) {
    send(socket, { type: "workspace_error", message: "This server is pinned to one project" });
    return;
  }
  let root: string;
  try {
    root = await fs.realpath(path.resolve(rawRoot));
    const stats = await fs.stat(root);
    if (!stats.isDirectory()) throw new Error("not a directory");
  } catch (error) {
    send(socket, { type: "workspace_error", message: `Cannot open ${rawRoot}: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }

  // Already open is a lookup, not a duplicate: two workspaces sharing a root would
  // share a session store while believing they did not.
  const already = workspaces.get(root);
  if (already) {
    await ensureStarted(already);
    bindClient(socket, already, "workspace_switched");
    return;
  }

  try {
    persistEditableSettings(config, { openProjects: [...config.openProjects, root] });
  } catch (error) {
    reportError(error);
    send(socket, {
      type: "workspace_error",
      message: error instanceof ConfigWriteError ? error.message : `Could not save the open projects: ${String(error)}`,
    });
    return;
  }
  config.openProjects = [...config.openProjects, root];

  let opened: Workspace;
  try {
    // Resources only. The session comes from ensureStarted below, which is the one
    // place that builds one — so a project opened here and a project restored from
    // the persisted set start the same way, and share the same in-flight guard.
    opened = await Workspace.create({
      ...workspaceOptions({ cwd: root }),
      onDirectoryChanged: (relPath) => {
        opened.noteDirectoryChange();
        broadcast(opened, { type: "directory_changed", path: relPath });
      },
      onRepositoriesChanged: () =>
        broadcast(opened, {
          type: "git_repositories_changed",
          available: opened.repos.length > 0 && opened.gitUnavailable === undefined,
          ...(opened.gitUnavailable ? { unavailable: opened.gitUnavailable } : {}),
        }),
      createRuntime: () => { throw new Error("unused: runtimes are built through ensureStarted"); },
    });
  } catch (error) {
    // The set on disk now names a project that would not build. Put it back rather
    // than leaving a server that fails the same way at every start.
    config.openProjects = config.openProjects.filter((p) => p !== root);
    try {
      persistEditableSettings(config, { openProjects: config.openProjects });
    } catch (writeError) {
      reportError(writeError);
    }
    reportError(error);
    send(socket, { type: "workspace_error", message: `Could not open ${root}: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }

  // A concurrent open of the same directory may have won while this one built.
  const registered = workspaces.add(opened);
  if (registered !== opened) await opened.stop();
  try {
    await ensureStarted(registered);
  } catch (error) {
    // Bind only once there is a session to bind to. A socket left pointing at a
    // runtime-less workspace would reach `agent` on its next command and throw,
    // taking the handler with it — the client keeps the project it had.
    reportError(error);
    send(socket, { type: "workspace_error", message: `Opened ${path.basename(root)}, but its session could not start: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  bindClient(socket, registered, "workspace_switched");
  announceWorkspaceActivity();
}

/**
 * Close an open project. Its sessions on disk are left alone, so reopening the
 * same directory finds them again.
 */
async function handleCloseProject(socket: WebSocket, rawRoot: string): Promise<void> {
  if (config.workspaceLock) {
    send(socket, { type: "workspace_error", message: "This server is pinned to one project" });
    return;
  }
  const target = workspaces.get(path.resolve(rawRoot));
  if (!target) {
    send(socket, { type: "workspace_error", message: `No open project at ${rawRoot}` });
    return;
  }
  if (workspaces.size < 2) {
    send(socket, { type: "workspace_error", message: "The last open project cannot be closed" });
    return;
  }
  // Refused rather than queued behind the turn: cancelling someone's work to
  // satisfy a close is worse than asking them to stop it first.
  if (target.isBusy()) {
    send(socket, { type: "workspace_error", message: `${path.basename(target.root)} is working — stop the turn before closing it` });
    return;
  }

  const remaining = config.openProjects.filter((p) => p !== target.root);
  try {
    persistEditableSettings(config, { openProjects: remaining });
  } catch (error) {
    reportError(error);
    send(socket, {
      type: "workspace_error",
      message: error instanceof ConfigWriteError ? error.message : `Could not save the open projects: ${String(error)}`,
    });
    return;
  }
  config.openProjects = remaining;
  workspaces.remove(target.root);

  // Move anyone watching it before the session goes: a client left bound to a
  // stopped workspace would reach `agent` and throw on its next message.
  const fallback = workspaces.default;
  if (fallback) {
    await ensureStarted(fallback);
    for (const [socketOnIt, bound] of clients) {
      if (bound !== target) continue;
      bindClient(socketOnIt, fallback, "workspace_switched");
    }
  }
  await target.stop();
  announceWorkspaceActivity();
}


/**
 * Make sure a project has a session, building it on first use.
 *
 * This is the lazy start: a project restored from the persisted set has its
 * resources but no runtime, so startup cost does not grow with the number of open
 * projects. Whoever is about to show that project pays for the session instead —
 * and only once.
 *
 * Concurrent callers share one build rather than racing two sessions onto the same
 * directory, which would mean two writers on one session store.
 */
const starting = new Map<string, Promise<void>>();

async function ensureStarted(target: Workspace): Promise<void> {
  if (target.started) return;
  const inFlight = starting.get(target.root);
  if (inFlight) return inFlight;
  const build = (async () => {
    // A retired project released its watcher along with its session; rebuild both,
    // so reopening one is indistinguishable from never having retired it.
    if (target.retired) await target.rebuildResources(target.settings);
    const runtime = await buildRuntimeFor(target);
    target.attachRuntime(runtime);
    runtime.subscribe((event) => onRuntimeEvent(target, event));
    // A project opened or restored after startup gets its renderers here. Only the
    // boot workspace is refreshed at module level, so without this every other
    // project rendered plain cards until something happened to replace its session.
    refreshExtensionRender(target);
    target.workPlan = await loadWorkPlan(runtime.snapshot().sessionFile);
    target.workPlanSessionFile = runtime.snapshot().sessionFile;
    target.lastUsedAt = Date.now();
  })();
  starting.set(target.root, build);
  // Tell everyone it is starting, and again when it is ready or failed.
  announceWorkspaceActivity();
  try {
    await build;
  } finally {
    starting.delete(target.root);
    announceWorkspaceActivity();
  }
}

/** Directory listing for a Settings path picker — directories only, from `/`. */
async function handleBrowseServerDirectory(socket: WebSocket, requestedPath: string, requestId: string): Promise<void> {
  try {
    const listing = await listServerDirectories(requestedPath);
    send(socket, { type: "server_directory", requestId, ...listing });
  } catch (error) {
    send(socket, {
      type: "server_directory_error",
      requestId,
      path: error instanceof ServerDirectoryError ? error.path : requestedPath,
      message: error instanceof ServerDirectoryError ? error.message : `Cannot list "${requestedPath}": ${String(error)}`,
    });
  }
}

/** Declare an OpenAI-compatible endpoint: live for this session, and persisted for the next. */
async function handleDeclareProvider(workspace: Workspace, socket: WebSocket, declaration: ProviderDeclaration): Promise<void> {
  const credentials = workspace.agent.credentials;
  if (!credentials) {
    send(socket, { type: "error", message: new RuntimeUnsupportedError("Declaring a provider", workspace.agent.kind).message });
    return;
  }
  try {
    await credentials.declareProvider(declaration);
  } catch (error) {
    send(socket, { type: "error", message: error instanceof CredentialError ? error.message : String(error) });
    return;
  }
  await adoptUsableModel(workspace, socket);
}

/**
 * Move the live session onto a model that can actually answer, and tell every client.
 *
 * The session itself is fine — it was only pointed at a model with no auth — so this
 * re-points it rather than rebuilding it, and the conversation (empty on a first run,
 * but not necessarily: credentials can also expire mid-session) survives untouched.
 *
 * Which is also why clients get `credentials_changed` and not a snapshot: a snapshot
 * means "this is a different session", and clients answer it by dropping every live
 * extension dialog, notification, status and widget — state this server still holds,
 * and a pending dialog the agent is still waiting on.
 */
async function adoptUsableModel(workspace: Workspace, socket: WebSocket): Promise<void> {
  const announce = () =>
    broadcast(workspace, { type: "credentials_changed", models: availableModels(workspace), model: modelName(workspace), credentials: credentialStatus(workspace) });

  const choices = availableModels(workspace);
  if (choices.length === 0) {
    send(socket, {
      type: "error",
      message: `Credentials stored in ${AGENT_DIR}, but no model is available — check "allowedModels" in your configuration.`,
    });
    announce();
    return;
  }
  const current = workspace.agent.snapshot().model;
  const usable = choices.some((choice) => choice.provider === current?.provider && choice.id === current?.id);
  if (!usable) await workspace.agent.credentials?.adoptModel(choices[0]);
  announce();
}

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

/**
 * Makes an `@`-mentioned path unambiguous before the model ever reads it.
 *
 * The composer sends `@ui/src/App.tsx` — a path relative to the browser root,
 * which is also the agent's own sandbox root. That should be enough, but the
 * model resolves it itself (there is no structured wire field for a mention,
 * just text it reads and acts on), and a bash tool call earlier in the turn
 * can leave it assuming a different current directory. An absolute path has
 * no "relative to what" left to get wrong.
 *
 * Left untouched, not failed, when a mention doesn't resolve — a name that
 * isn't a real path (an email-shaped "@work.md" typo, `@someone` in prose) is
 * exactly as informative to the model as it always was; this only removes
 * ambiguity from a mention that already named something real.
 *
 * `resolveConfined` alone is not enough to decide that: it resolves the
 * existing prefix of a path and is deliberately fine with a nonexistent tail
 * (a save destination isn't there yet either), so on its own it would turn
 * "@someone" into a confident-looking absolute path under the root for a file
 * that was never there — worse than leaving it alone, since it now reads as
 * resolved. `fs.stat` is the one extra check that keeps this to mentions of
 * something that actually exists.
 */
async function absolutizeMentions(workspace: Workspace, text: string): Promise<string> {
  return rewriteMentionedPaths(text, async (relPath) => {
    try {
      const absolute = await resolveConfined(workspace.browserRoot, relPath);
      await fs.stat(absolute);
      return absolute;
    } catch {
      return undefined;
    }
  });
}

async function handlePrompt(workspace: Workspace, text: string, images?: WireImage[]): Promise<void> {
  const promptText = await absolutizeMentions(workspace, text);
  await workspace.agent.prompt(promptText, {
    ...(images?.length ? { images } : {}),
    // Echo the user message only once accepted (avoids ghost bubbles on reject).
    // The *original* text, not promptText: the absolute path is for the model,
    // never for what the user sees — see historyToItems for the reload side of
    // the same rule.
    onAccepted: (accepted) => {
      if (accepted) broadcast(workspace, { type: "user", text, ...(images?.length ? { images } : {}) });
    },
  });
  // The entries and tree are announced when the turn settles, not here: an RPC
  // prompt resolves at *acceptance* (that is Pi's contract — a failure after
  // acceptance reports through the event stream, never as a second result), so
  // reading the conversation at this point would read it before the turn ran.
}

/**
 * Re-send a past user message with edited text: rewind to just before it, then
 * prompt again. The new answer becomes a sibling branch — the original exchange
 * stays reachable in the tree (that's the whole point of editing here).
 */
async function editPrompt(workspace: Workspace, socket: WebSocket, entryId: string, text: string, images?: WireImage[]): Promise<void> {
  const navigate = workspace.agent.navigateTree;
  if (!navigate) {
    // Editing rewinds the leaf to just before a past message. Pi RPC forks and
    // clones but does not move the leaf, so there is no equivalent to offer.
    send(socket, { type: "error", message: new RuntimeUnsupportedError("Editing a past message", workspace.agent.kind).message });
    return;
  }
  if (workspace.agent.snapshot().isStreaming) {
    send(socket, { type: "error", message: "Cannot edit a message while the agent is running" });
    return;
  }
  if (!isUserMessageEntry(workspace, entryId)) {
    send(socket, { type: "error", message: "Unknown message" });
    return;
  }
  if (workspace.replacingSession) {
    send(socket, { type: "error", message: "Session change already in progress" });
    return;
  }
  workspace.replacingSession = true;
  try {
    const { cancelled } = await navigate.call(workspace.agent, entryId);
    if (cancelled) {
      // An extension vetoed the rewind — say so: the client already dropped the draft
      send(socket, { type: "error", message: "Edit cancelled — the conversation was not rewound" });
      return;
    }
    broadcast(workspace, { type: "session_replaced", ...snapshot(workspace) });
  } finally {
    workspace.replacingSession = false;
  }
  await handlePrompt(workspace, text, images);
}

/**
 * Session paths come from clients: only accept ones SessionManager.list
 * returns for this cwd (authoritative allowlist — no path traversal, and no
 * reading/persisting to attacker-chosen files via switch_session).
 */
async function isKnownSessionPath(workspace: Workspace, path: string): Promise<boolean> {
  const sessions = await SessionManager.list(workspace.settings.cwd, SESSION_DIR);
  return sessions.some((info) => info.path === path);
}

/** Delete a saved session file (allowlisted path, never the live one). */
async function deleteSession(workspace: Workspace, socket: WebSocket, path: string): Promise<void> {
  const live = liveSessionMatch(workspace, path);
  if (live === "live") {
    send(socket, { type: "error", message: "Cannot delete the active session" });
    return;
  }
  if (live === "unknown") {
    send(socket, { type: "error", message: `${UNKNOWN_LIVE_SESSION} — deleting it could remove the running conversation` });
    return;
  }
  if (!(await isKnownSessionPath(workspace, path))) {
    send(socket, { type: "error", message: "Unknown session" });
    return;
  }
  await fs.unlink(path);
  await deleteWorkPlan(path);
  invalidateSessionScan(workspace);
  await listSessions(workspace, socket);
}

async function switchSession(workspace: Workspace, socket: WebSocket, path: string): Promise<void> {
  if (!(await isKnownSessionPath(workspace, path))) {
    send(socket, { type: "error", message: "Unknown session" });
    return;
  }
  await replaceSession(workspace, socket, () => workspace.agent.switchSession(path));
}

const SESSION_LIST_LIMIT = 50;
/**
 * `SessionManager.list` reads every session file, transcripts included — and the
 * session search fires one per (debounced) keystroke. Reuse the scan for a moment:
 * a session the user is typing about does not change between two keystrokes.
 */
const SESSION_SCAN_TTL_MS = 1000;
/**
 * Keyed by project root, not one cache for the server: a shared entry would answer
 * project B's listing with project A's sessions — their paths, their names and
 * their search snippets — for as long as the entry stays warm.
 */
const sessionScans = new Map<string, { at: number; sessions: SessionInfo[] }>();

async function scanSessions(workspace: Workspace, ): Promise<SessionInfo[]> {
  const cached = sessionScans.get(workspace.root);
  if (cached && Date.now() - cached.at < SESSION_SCAN_TTL_MS) return cached.sessions;
  const sessions = await SessionManager.list(workspace.settings.cwd, SESSION_DIR);
  sessionScans.set(workspace.root, { at: Date.now(), sessions });
  return sessions;
}

/** Anything that writes to a session file (rename, title, delete) must drop the scan. */
function invalidateSessionScan(workspace: Workspace): void {
  sessionScans.delete(workspace.root);
}

async function sessionList(workspace: Workspace, ): Promise<SessionSummary[]> {
  const sessions = await scanSessions(workspace);
  return [...sessions]
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, SESSION_LIST_LIMIT)
    .map((info) => toSummary(info));
}

async function listSessions(workspace: Workspace, socket: WebSocket): Promise<void> {
  send(socket, { type: "sessions", sessions: await sessionList(workspace) });
}

/** A name change is visible to everyone: all clients watch the same agent. */
async function broadcastSessions(workspace: Workspace): Promise<void> {
  broadcast(workspace, { type: "sessions", sessions: await sessionList(workspace) });
}

/**
 * Set (or clear, with an empty name) a session's display name. Any saved session
 * can be renamed, not just the live one — but the path comes from a client, so it
 * goes through the same allowlist as switch/delete: no writing to arbitrary files.
 */
async function renameSession(workspace: Workspace, socket: WebSocket, path: string, rawName: string): Promise<void> {
  if (!(await isKnownSessionPath(workspace, path))) {
    send(socket, { type: "error", message: "Unknown session" });
    return;
  }
  const name = sanitizeName(rawName);
  const live = liveSessionMatch(workspace, path);
  if (live === "unknown") {
    send(socket, { type: "error", message: `${UNKNOWN_LIVE_SESSION} — renaming could corrupt the running conversation` });
    return;
  }
  if (live === "live") {
    // Through the live runtime, so the running session and its file agree. A second
    // SessionManager over the live file would be a disaster: opening one can rewrite
    // the file wholesale (version migration), racing the live appends.
    await workspace.agent.setSessionName(name);
  } else {
    SessionManager.open(path, SESSION_DIR, workspace.settings.cwd).appendSessionInfo(name);
  }
  invalidateSessionScan(workspace);
  await broadcastSessions(workspace);
}

/**
 * Is this path the session the agent is running right now?
 *
 * Three answers, not two. Standard Pi reports `sessionFile` in its state, but a
 * fork may not, and `--no-session` means there is no file at all — and the old
 * two-valued version read "we don't know" as "not the live one". That is the wrong
 * way to be wrong: `deleteSession` would unlink the file the agent is appending to,
 * and `renameSession` would take the `SessionManager.open()` branch over it, which
 * can rewrite the file wholesale while the agent writes to it.
 *
 * Both sides are resolved: they come from different normalizers.
 */
function liveSessionMatch(workspace: Workspace, candidate: string): "live" | "not-live" | "unknown" {
  const live = workspace.agent.snapshot().sessionFile;
  if (live === undefined) return "unknown";
  return path.resolve(candidate) === path.resolve(live) ? "live" : "not-live";
}

/** The refusal for a runtime that will not say which file it is writing to. */
const UNKNOWN_LIVE_SESSION = "The agent runtime does not report which session file it is using, so this cannot be done safely";

/** Match against the name, the first message and the whole transcript (server-side — see sessions.ts). */
async function handleSearchSessions(workspace: Workspace, socket: WebSocket, query: string, requestId: string): Promise<void> {
  send(socket, {
    type: "session_search_results",
    requestId,
    query,
    sessions: searchSessions(await scanSessions(workspace), query, SESSION_LIST_LIMIT),
  });
}

// --- Automatic session naming ------------------------------------------------------

const TITLE_TIMEOUT_MS = 30_000;

/** Session files with a title request in flight — keyed, not global: two sessions can be named in parallel. */
const namingSessions = new Set<string>();

/**
 * Title a session from its first exchange, once, after the turn has landed — the
 * session menu should list topics, not opening lines. Best-effort on purpose: a
 * failing model (or no credentials) leaves the session unnamed, the UI falls back
 * to the first message, and no error ever reaches the client.
 *
 * "Once" means once *ever*, and the signal is the `session_info` entry rather than
 * the name: a user who clears a name reads back as unnamed, and re-titling what
 * they just erased on their next turn would be the opposite of helpful.
 */
async function maybeNameSession(workspace: Workspace, ): Promise<void> {
  // Titling needs one direct model call with the session's own credentials. Only the
  // embedded runtime can make it; under RPC the session keeps the UI's fallback (its
  // first message) unless the user renames it by hand.
  const titles = workspace.agent.titles;
  if (!titles) return;
  const file = workspace.agent.snapshot().sessionFile;
  if (file === undefined || namingSessions.has(file)) return;
  if (hasBeenNamed(workspace.agent.entries() as never)) return;
  const exchange = firstExchange(workspace.agent.contextEntries() as never);
  if (!exchange) return;
  namingSessions.add(file);
  try {
    const title = await titles.generateTitle(exchange, AbortSignal.timeout(TITLE_TIMEOUT_MS));
    if (!title) return;
    // While the model answered, the session may have been named by hand — or replaced.
    // `workspace.replacingSession` covers the window where the old session is already disposed
    // but the runtime still reports it: writing there would emit into a torn-down
    // extension runner.
    if (workspace.replacingSession || workspace.agent.snapshot().sessionFile !== file) return;
    if (hasBeenNamed(workspace.agent.entries() as never)) return;
    await workspace.agent.setSessionName(title);
    invalidateSessionScan(workspace);
    await broadcastSessions(workspace);
  } catch (error) {
    console.warn(`[pi] session title failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    namingSessions.delete(file);
  }
}

function reportError(error: unknown): void {
  // A TLS-inspecting proxy surfaces as a bare "fetch failed", with the real cause
  // nested in `cause` — say what broke and how to fix it, rather than leaving the
  // user to guess that their employer's proxy is in the way.
  const message = tlsHint(error) ?? (error instanceof Error ? error.message : String(error));
  // Server-wide: this reports failures that have no project of their own (a config
  // write, a shutdown), and announcing one into a single project's conversation
  // would put it in front of whoever happens to be looking at that project.
  broadcastServerWide({ type: "error", message });
}

// --- Fork / tree navigation -------------------------------------------------------

/**
 * Collapse the raw session tree (every entry is a node: assistant messages,
 * tool results, model changes…) down to user-message nodes only, so the UI
 * shows "the points you can return to". A node is `onPath` when the current
 * leaf lives in its subtree, i.e. it is on the active branch.
 */
function buildTree(workspace: Workspace, ): TreeNode[] {
  const { roots, leafId } = workspace.agent.tree();

  function subtreeHasLeaf(node: RuntimeTreeNode): boolean {
    return node.entry.id === leafId || node.children.some(subtreeHasLeaf);
  }

  function isUserNode(node: RuntimeTreeNode): boolean {
    return node.entry.type === "message" && node.entry.message?.role === "user";
  }

  /**
   * End of this turn's reply: descend through the entries answering the message
   * (assistant text, tool results…) and stop at the next user turn. Navigating
   * there restores the exchange in full — navigating to the user message itself
   * rewinds to *before* it (the SDK hands the text back as editor prefill and
   * the reply disappears from the transcript).
   *
   * Only a non-user `message` entry is a valid tip: the SDK treats custom_message
   * targets exactly like user messages (leaf = parent, content → editor prefill),
   * so stopping on one would rewind a step short and paste an extension's internal
   * message into the composer. Undefined when the turn has no reply yet, or when
   * the replies fork (ambiguous — the user node stays the safe fallback).
   */
  function replyTip(node: RuntimeTreeNode): string | undefined {
    let current = node;
    let tip: RuntimeTreeNode | undefined;
    for (;;) {
      const replies = current.children.filter((child) => !isUserNode(child));
      if (replies.length !== 1) break;
      current = replies[0];
      if (current.entry.type === "message") tip = current;
    }
    return tip?.entry.id;
  }

  function collapse(node: RuntimeTreeNode): TreeNode[] {
    const childNodes = node.children.flatMap(collapse);
    if (isUserNode(node)) {
      const text = contentText(node.entry.message!.content as never).split("\n")[0].slice(0, 100);
      const tipId = replyTip(node);
      return [
        {
          entryId: node.entry.id,
          ...(tipId ? { tipId } : {}),
          text,
          onPath: subtreeHasLeaf(node),
          ...(node.label ? { label: node.label } : {}),
          children: childNodes,
        },
      ];
    }
    return childNodes;
  }

  return roots.flatMap(collapse);
}

/** Every entry id the tree exposes as a navigation target (user turns + their reply tips). */
function treeNavigationTargets(roots: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(nodes: TreeNode[]): void {
    for (const node of nodes) {
      ids.add(node.entryId);
      if (node.tipId) ids.add(node.tipId);
      walk(node.children);
    }
  }
  walk(roots);
  return ids;
}

function sendTree(workspace: Workspace, socket: WebSocket): void {
  send(socket, { type: "tree", roots: buildTree(workspace) });
}

/** Fork targets must be user-message entries (both runtimes reject anything else). */
function isUserMessageEntry(workspace: Workspace, entryId: string): boolean {
  const entry = workspace.agent.entries().find((candidate) => candidate.id === entryId);
  return entry?.type === "message" && entry.message?.role === "user";
}

/**
 * Move the current leaf to another node of the same session file (checkout of an
 * earlier/parallel branch). The transcript changes without a session replacement,
 * so clients get a fresh snapshot. Two kinds of target: a user message (rewind to
 * before it — the SDK hands its text back as composer prefill, same UX as pi's
 * TUI) or a reply tip (restore that exchange in full, reply included).
 */
async function navigateTree(workspace: Workspace, socket: WebSocket, entryId: string): Promise<void> {
  const navigate = workspace.agent.navigateTree;
  if (!navigate) {
    send(socket, { type: "error", message: new RuntimeUnsupportedError("Tree navigation", workspace.agent.kind).message });
    return;
  }
  if (workspace.agent.snapshot().isStreaming) {
    send(socket, { type: "error", message: "Cannot navigate the tree while the agent is running" });
    return;
  }
  const roots = buildTree(workspace);
  if (!treeNavigationTargets(roots).has(entryId)) {
    send(socket, { type: "error", message: "Unknown tree node" });
    return;
  }
  // Serialize against session replacement AND against a prompt sneaking in
  // during the SDK's async pre-navigation hooks (session_before_tree): the
  // flag closes the check-then-act window at the server boundary.
  if (workspace.replacingSession) {
    send(socket, { type: "error", message: "Session change already in progress" });
    return;
  }
  workspace.replacingSession = true;
  try {
    const { cancelled, editorText } = await navigate.call(workspace.agent, entryId);
    if (cancelled) return;
    broadcast(workspace, { type: "session_replaced", ...snapshot(workspace) });
    if (editorText) send(socket, { type: "editor_prefill", text: editorText });
    broadcast(workspace, { type: "tree", roots: buildTree(workspace) });
  } finally {
    workspace.replacingSession = false;
  }
}

/** Fork a new session file starting just before the given user message. */
async function forkSession(workspace: Workspace, socket: WebSocket, entryId: string): Promise<void> {
  if (!isUserMessageEntry(workspace, entryId)) {
    // Also protects replaceSession's recovery path: workspace.agent.fork throws on
    // non-user entries BEFORE teardown, and recovery would needlessly swap
    // the healthy live session for a fresh one.
    send(socket, { type: "error", message: "Unknown tree node" });
    return;
  }
  let selectedText: string | undefined;
  const sourceSessionFile = workspace.agent.snapshot().sessionFile;
  let ownsInheritance = false;
  try {
    await replaceSession(workspace, socket, async () => {
      // `replaceSession` calls this action only after acquiring the global
      // replacement lock. A concurrent rejected fork must never clear the
      // inheritance marker owned by this invocation.
      workspace.workPlanInheritanceSource = sourceSessionFile;
      ownsInheritance = true;
      try {
        const result = await workspace.agent.fork(entryId);
        selectedText = result.selectedText;
        return result;
      } catch (error) {
        workspace.workPlanInheritanceSource = undefined;
        ownsInheritance = false;
        throw error;
      }
    });
  } finally {
    if (ownsInheritance) workspace.workPlanInheritanceSource = undefined;
  }
  if (selectedText) send(socket, { type: "editor_prefill", text: selectedText });
  broadcast(workspace, { type: "tree", roots: buildTree(workspace) });
}

/** File-browser sidebar: list a directory, confined to workspace.browserRoot. */
async function handleListDirectory(workspace: Workspace, socket: WebSocket, dirPath: string, requestId: string): Promise<void> {
  try {
    const entries = await listDirectory(workspace.browserRoot, dirPath);
    // After a *successful* listing, so "watched" still means exactly "displayed
    // somewhere" — a directory the client was refused is one it is not showing, and
    // watching it would announce changes nobody can act on.
    //
    // But before the reply, and awaited. The client treats the listing as the moment
    // the directory became watched; arming afterwards left a window — one realpath
    // wide, and wider on a loaded host — in which a change made right after opening a
    // folder was never announced at all. That gap is invisible until it isn't: it is
    // what made the watcher tests time out on CI while passing on every developer's
    // machine. Watching stays best-effort, so a failure to arm never turns a good
    // listing into an error.
    await workspace.fileWatcher?.watch(dirPath).catch(() => {});
    send(socket, { type: "directory_listing", requestId, path: dirPath, entries });
  } catch (error) {
    const message = error instanceof FileBrowserError ? error.message : `Unexpected error: ${(error as Error).message}`;
    send(socket, { type: "file_browser_error", requestId, path: dirPath, message });
  }
}

/**
 * The reference validator's diagnosis of a file that claims to be a
 * structured-exchange document and is not one.
 *
 * Undefined for everything else, including a document that validates: the field
 * exists to say what is wrong, and "nothing" is said by its absence. The browser
 * decides for itself whether to render — it has its own check — and this only
 * supplies the reason, which its check does not have.
 */
function documentIssuesFor(content: string): { rule: string; path: string; message: string }[] | undefined {
  const verdict = readStructuredExchangeDocument(content, checkStructuredExchangeSchema);
  if (verdict.status !== "invalid") return undefined;
  return verdict.issues.map((issue) => ({ rule: issue.rule, path: issue.path, message: issue.message }));
}

/** File-browser sidebar: read a file for preview, confined to workspace.browserRoot. */
async function handleReadFile(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
  try {
    const { content, size, mtimeMs } = await readFileForPreview(workspace.browserRoot, filePath, config.structuredExchange.maxBytes);
    const documentIssues = documentIssuesFor(content);
    send(socket, {
      type: "file_content",
      requestId,
      path: filePath,
      content,
      size,
      mtimeMs,
      ...(documentIssues === undefined ? {} : { documentIssues }),
    });
  } catch (error) {
    const message = error instanceof FileBrowserError ? error.message : `Unexpected error: ${(error as Error).message}`;
    send(socket, { type: "file_browser_error", requestId, path: filePath, message });
  }
}

/** File viewer's editor: save a buffer back, confined to the writable zone. */
async function handleWriteFile(workspace: Workspace, 
  socket: WebSocket,
  filePath: string,
  content: string,
  expectedMtimeMs: number,
  force: boolean,
  requestId: string,
): Promise<void> {
  try {
    const { size, mtimeMs } = await writeFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, content, expectedMtimeMs, force);
    send(socket, { type: "file_written", requestId, path: filePath, size, mtimeMs });
    broadcast(workspace, { type: "file_changed", path: filePath });
  } catch (error) {
    if (error instanceof FileBrowserError) {
      send(socket, { type: "file_browser_error", requestId, path: filePath, message: error.message, reason: error.reason });
    } else {
      send(socket, { type: "file_browser_error", requestId, path: filePath, message: `Unexpected error: ${(error as Error).message}` });
    }
  }
}

/**
 * Create an empty file. Answered like a write, so the client can open the new
 * file straight into its editor without a second round trip.
 */
async function handleCreateFile(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
  try {
    const { size, mtimeMs } = await createFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath);
    send(socket, { type: "file_written", requestId, path: filePath, size, mtimeMs });
    broadcast(workspace, { type: "file_changed", path: filePath });
  } catch (error) {
    sendFileBrowserError(socket, requestId, filePath, error);
  }
}

/**
 * Create one directory. Answered with its listing — empty, but it tells the tree
 * the directory exists and lets it expand without asking again.
 */
async function handleCreateDirectory(workspace: Workspace, socket: WebSocket, dirPath: string, requestId: string): Promise<void> {
  try {
    await createDirectoryFromBrowser(workspace.browserRoot, workspace.writableRoot, dirPath);
    const entries = await listDirectory(workspace.browserRoot, dirPath);
    send(socket, { type: "directory_listing", requestId, path: dirPath, entries });
    broadcast(workspace, { type: "file_changed", path: dirPath });
  } catch (error) {
    sendFileBrowserError(socket, requestId, dirPath, error);
  }
}

async function handleOpenNative(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
  try {
    await openFileNative(workspace.browserRoot, filePath);
    send(socket, { type: "file_operation_result", requestId, operation: "open_native", path: filePath });
  } catch (error) {
    sendFileBrowserError(socket, requestId, filePath, error);
  }
}

async function handleRenameFile(workspace: Workspace, socket: WebSocket, filePath: string, name: string, requestId: string): Promise<void> {
  try {
    const renamedPath = await renameFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, name);
    send(socket, { type: "file_operation_result", requestId, operation: "rename_file", path: renamedPath, previousPath: filePath });
    broadcast(workspace, { type: "file_changed", path: filePath });
    broadcast(workspace, { type: "file_changed", path: renamedPath });
  } catch (error) {
    sendFileBrowserError(socket, requestId, filePath, error);
  }
}

async function handleDeleteFile(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
  try {
    await deleteFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath);
    send(socket, { type: "file_operation_result", requestId, operation: "delete_file", path: filePath });
    broadcast(workspace, { type: "file_changed", path: filePath });
  } catch (error) {
    sendFileBrowserError(socket, requestId, filePath, error);
  }
}

async function handleMoveFile(workspace: Workspace, socket: WebSocket, filePath: string, destinationDirectory: string, requestId: string): Promise<void> {
  try {
    const movedPath = await moveFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, destinationDirectory);
    send(socket, { type: "file_operation_result", requestId, operation: "move_file", path: movedPath, previousPath: filePath });
    broadcast(workspace, { type: "file_changed", path: filePath });
    broadcast(workspace, { type: "file_changed", path: movedPath });
  } catch (error) {
    sendFileBrowserError(socket, requestId, filePath, error);
  }
}

/**
 * Store a file supplied from outside the workspace. Answered with the path the
 * server wrote — a collision is disambiguated here, so the client cannot assume
 * the name it asked for survived.
 */
async function handleUploadFile(workspace: Workspace, 
  socket: WebSocket,
  destinationDirectory: string,
  name: string,
  contentBase64: string,
  requestId: string,
): Promise<void> {
  const requestedPath = destinationDirectory ? `${destinationDirectory}/${name}` : name;
  try {
    const writtenPath = await uploadFileFromBrowser(workspace.browserRoot, workspace.writableRoot, destinationDirectory, name, contentBase64);
    send(socket, { type: "file_uploaded", requestId, path: writtenPath });
    broadcast(workspace, { type: "file_changed", path: writtenPath });
  } catch (error) {
    sendFileBrowserError(socket, requestId, requestedPath, error);
  }
}

async function handleCopyFile(workspace: Workspace, socket: WebSocket, filePath: string, destinationDirectory: string, requestId: string): Promise<void> {
  try {
    const copiedPath = await copyFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, destinationDirectory);
    send(socket, { type: "file_operation_result", requestId, operation: "copy_file", path: copiedPath });
    broadcast(workspace, { type: "file_changed", path: copiedPath });
  } catch (error) {
    sendFileBrowserError(socket, requestId, filePath, error);
  }
}

function sendFileBrowserError(socket: WebSocket, requestId: string, targetPath: string, error: unknown): void {
  if (error instanceof FileBrowserError) {
    send(socket, { type: "file_browser_error", requestId, path: targetPath, message: error.message, reason: error.reason });
  } else {
    send(socket, { type: "file_browser_error", requestId, path: targetPath, message: `Unexpected error: ${(error as Error).message}` });
  }
}

// --- Git (read-only, confined to workspace.browserRoot via `-- .` pathspec) --------------

function gitErrorMessage(error: unknown): string {
  return error instanceof GitError || error instanceof FileBrowserError
    ? error.message
    : `Unexpected error: ${(error as Error).message}`;
}

/**
 * The repository owning a path.
 *
 * A file under no repository is not an error of the client's making — a workspace
 * can hold both versioned projects and loose notes — but it has no HEAD, no history
 * and no branch, so a request naming one has nothing to answer with.
 */
function repoForPath(workspace: Workspace, relPath: string): GitRepo {
  const repo = repoFor(workspace.repos, relPath);
  if (repo === null) throw new GitError(`"${relPath}" is not in a git repository`);
  return repo;
}

/**
 * The repository a client named, by the same id `git_status` reported it under.
 *
 * Never falls back to another: a commit id from one repository resolved against a
 * second would answer with somebody else's history, and silently.
 */
function repoById(workspace: Workspace, id: string): GitRepo {
  const repo = workspace.repos.find((candidate) => candidate.id === id);
  if (repo === undefined) throw new GitError(`No repository at "${id === "" ? "." : id}"`);
  return repo;
}

async function handleGitStatus(workspace: Workspace, socket: WebSocket, scope: string | undefined, requestId: string): Promise<void> {
  if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
  try {
    const { repos, files, missing } = await gitStatus(workspace.repos, scope === undefined ? undefined : repoById(workspace, scope));
    send(socket, { type: "git_status", requestId, ...(scope === undefined ? {} : { repo: scope }), repos, files });
    // A repository that cannot answer has usually stopped being one, and did so
    // without touching a directory any client had listed - `rm -rf proj/.git` changes
    // `proj`, which nobody expanded, so the watcher heard nothing at all. Look again,
    // and announce it if the set really did change.
    if (missing.length > 0) void workspace.rediscoverRepos();
  } catch (error) {
    send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
    // The same signal, from the other side: a sweep where EVERY repository failed
    // throws rather than returning, and a workspace down to its last repository
    // reaches exactly that path when it loses it.
    void workspace.rediscoverRepos();
  }
}

/** Compose only from the workspace bound to this socket; never broadcast Outcome content. */
async function handleGetOutcome(workspace: Workspace, socket: WebSocket, requestId: string): Promise<void> {
  await workspace.workPlanSync;
  const snapshot = workspace.agent.snapshot();
  const plan = sameSessionFile(snapshot.sessionFile, workspace.workPlanSessionFile) ? workspace.workPlan : null;
  const outcome = await composeWorkspaceOutcome(
    { workspaceRoot: workspace.root, sessionId: snapshot.sessionId },
    [workPlanContributor(plan), evidenceContributor(plan), repositoryContributor({ repos: workspace.repos, gitUnavailable: workspace.gitUnavailable })],
  );
  send(socket, { type: "workspace_outcome", requestId, outcome });
}

/** Worktree-vs-HEAD contents of one file; missing sides (untracked/deleted) are "". */
async function handleGitDiff(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
  if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
  try {
    let after = "";
    try {
      after = (await readFileForPreview(workspace.browserRoot, filePath)).content;
    } catch (error) {
      // A deleted file legitimately has no worktree side; confinement/size/binary still refuse
      if (!(error instanceof FileBrowserError) || error.reason !== "not-found") throw error;
    }
    const before = await gitHeadContent(repoForPath(workspace, filePath), filePath);
    if (before.includes("\0")) throw new FileBrowserError("binary", "Binary file — diff not supported");
    if (Buffer.byteLength(before, "utf8") > 1_048_576) {
      throw new FileBrowserError("too-large", "HEAD version is larger than the 1 MB limit");
    }
    send(socket, { type: "git_diff", requestId, path: filePath, before, after });
  } catch (error) {
    send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
  }
}

async function handleGitLog(workspace: Workspace, socket: WebSocket, repo: string, limit: number, requestId: string): Promise<void> {
  if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
  try {
    send(socket, { type: "git_log", requestId, repo, entries: await gitLog(repoById(workspace, repo), limit) });
  } catch (error) {
    send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
  }
}

function isGitRevision(value: unknown): value is GitRevision {
  const revision = value as GitRevision | undefined;
  return typeof revision?.rev === "string" && typeof revision.path === "string";
}

/** Commits touching one file, for the history graph. */
async function handleGitFileLog(workspace: Workspace, socket: WebSocket, filePath: string, limit: number, requestId: string): Promise<void> {
  if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
  try {
    // Confine before spawning: this path goes straight into a pathspec. Only
    // confinement applies — a deleted or oversized file still has a history.
    await assertWithinRoot(workspace.browserRoot, filePath);
    const entries = await gitFileLog(repoForPath(workspace, filePath), filePath, limit);
    send(socket, { type: "git_file_log", requestId, path: filePath, entries });
  } catch (error) {
    send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
  }
}

/**
 * One side of a two-point file diff. The working tree is read from disk; every
 * other revision goes through git. Both sides obey the file browser's confinement
 * and its size and binary limits, so a pair can never smuggle out an oversized
 * blob or a path outside the browser root.
 */
async function readRevisionSide(workspace: Workspace, revision: GitRevision): Promise<string> {
  if (revision.rev === WORKTREE_REVISION) {
    try {
      return (await readFileForPreview(workspace.browserRoot, revision.path)).content;
    } catch (error) {
      // A file deleted since that commit legitimately has no worktree side
      if (error instanceof FileBrowserError && error.reason === "not-found") return "";
      throw error;
    }
  }
  // Confine before spawning: the path becomes part of a `<rev>:<path>` argument
  await assertWithinRoot(workspace.browserRoot, revision.path);
  const content = await gitRevisionContent(repoForPath(workspace, revision.path), revision.rev, revision.path);
  if (content.includes("\0")) throw new FileBrowserError("binary", "Binary file — diff not supported");
  if (Buffer.byteLength(content, "utf8") > MAX_PREVIEW_BYTES) {
    throw new FileBrowserError("too-large", `${revision.rev.slice(0, 7)} is larger than the 1 MB limit`);
  }
  return content;
}

async function handleGitFileDiff(workspace: Workspace, socket: WebSocket, base: GitRevision, target: GitRevision, requestId: string): Promise<void> {
  if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
  try {
    const [beforeText, afterText] = await Promise.all([readRevisionSide(workspace, base), readRevisionSide(workspace, target)]);
    send(socket, { type: "git_file_diff", requestId, base, target, beforeText, afterText });
  } catch (error) {
    send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
  }
}

async function handleGitShow(workspace: Workspace, socket: WebSocket, repo: string, sha: string, requestId: string): Promise<void> {
  if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
  try {
    const { patch, truncated } = await gitShow(repoById(workspace, repo), sha);
    send(socket, { type: "git_show", requestId, sha, patch, truncated });
  } catch (error) {
    send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
  }
}

/** Composer's `@` mention autocomplete: recursive name search, confined to workspace.browserRoot. */
async function handleSearchFiles(workspace: Workspace, socket: WebSocket, query: string, requestId: string): Promise<void> {
  const results = await searchFiles(workspace.browserRoot, query);
  send(socket, { type: "file_search_results", requestId, query, results });
}

/**
 * Browser messages that need a working agent workspace.agent. Everything absent from this
 * set — the file browser, git, session listing and search — keeps working after a
 * runtime failure, because none of it goes through the agent.
 */
const AGENT_COMMANDS = new Set<ClientMessage["type"]>([
  "prompt",
  "abort",
  "set_model",
  "set_thinking",
  "new_session",
  "switch_session",
  "compact",
  "rename_session",
  "navigate_tree",
  "fork_session",
  "edit_prompt",
  "list_tree",
  "extension_ui_response",
  "set_credential",
  "declare_provider",
  "update_config",
]);

function handleClientMessage(socket: WebSocket, raw: string): void {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }
  // JSON.parse can yield null/primitives — never crash on a malformed frame
  if (typeof message !== "object" || message === null) return;
  /**
   * The project THIS connection is bound to, shadowing the module-level binding for
   * the whole handler. Every case below therefore drives the sender's project
   * rather than the server's first one — the shadowing is the mechanism, so a case
   * added later cannot forget to ask.
   */
  const workspace = clients.get(socket) ?? workspaces.default;
  // A frame from a socket that is no longer registered: it closed mid-flight.
  if (!workspace) return;
  // Fail closed. A prompt sent to a dead runtime must be refused where the user can
  // see it, not queued for a process that is never coming back.
  if (!workspace.agent.ok && AGENT_COMMANDS.has(message.type)) {
    send(socket, { type: "error", message: `Agent runtime unavailable: ${workspace.agent.failure ?? "the runtime stopped"}` });
    return;
  }
  switch (message.type) {
    case "switch_workspace": {
      if (typeof message.root !== "string") return;
      if (config.workspaceLock) {
        send(socket, { type: "workspace_error", message: "This server is pinned to one project" });
        return;
      }
      const target = workspaces.get(message.root);
      // Only a project already open. A path named here must never open one: that is
      // open_project's job, and it persists the open set before anything is built.
      if (!target) {
        send(socket, { type: "workspace_error", message: `No open project at ${message.root}` });
        return;
      }
      // Rebinding is the whole switch. Nothing else is touched: the project being
      // left keeps its session, its watcher and any turn in flight — which is what
      // lets an agent keep working while the user looks somewhere else.
      const leaving = clients.get(socket);
      ensureStarted(target)
        .then(() => {
          // The project just left starts its idle clock now, not at the next sweep:
          // one that had been watched for longer than the timeout would otherwise be
          // retired on the very next pass, before its idle delay had elapsed at all.
          if (leaving && leaving !== target && ![...clients.values()].includes(leaving)) {
            leaving.lastUsedAt = Date.now();
          }
          bindClient(socket, target, "workspace_switched");
        })
        .catch((error: unknown) => {
          reportError(error);
          send(socket, { type: "workspace_error", message: `Could not start ${path.basename(target.root)}: ${error instanceof Error ? error.message : String(error)}` });
        });
      return;
    }
    case "open_project":
      if (typeof message.root !== "string") return;
      handleOpenProject(socket, message.root).catch(reportError);
      return;
    case "close_project":
      if (typeof message.root !== "string") return;
      handleCloseProject(socket, message.root).catch(reportError);
      return;
    case "prompt": {
      if (typeof message.text !== "string") return;
      // A prompt landing mid-navigation would append under the OLD leaf, and the
      // navigation would then overwrite the running turn's message state
      if (workspace.replacingSession) {
        send(socket, { type: "error", message: "Session change already in progress" });
        return;
      }
      const text = message.text.trim();
      const images = validImages(message.images);
      if (message.images !== undefined && images === undefined) {
        // Never drop a message silently: the client already cleared its composer
        send(socket, { type: "error", message: "Attachments rejected (too large or invalid)" });
        return;
      }
      if (!text && !images?.length) return;
      handlePrompt(workspace, text || "(see attached images)", images).catch(reportError);
      break;
    }
    case "abort":
      workspace.agent.abort().catch(() => {});
      break;
    case "set_model": {
      if (typeof message.provider !== "string" || typeof message.id !== "string") return;
      const { provider, id } = message;
      workspace.agent
        .setModel(provider, id)
        .then((model) => {
          const levels = acceptedThinkingLevels(workspace);
          broadcast(workspace, {
            type: "model_changed",
            model: modelName(workspace),
            reasoning: model.reasoning ?? false,
            ...(levels ? { thinkingLevels: levels } : {}),
          });
        })
        .catch((error) => {
          if (!refuseUnsupported(socket, error)) {
            send(socket, { type: "error", message: error instanceof Error ? error.message : String(error) });
          }
        });
      break;
    }
    case "set_thinking": {
      if (!THINKING_LEVELS.includes(message.level)) return;
      // A deployment that has stated what its model accepts is stating a fact about
      // that model. The control already offers only those levels; this is for every
      // other way the message arrives — an embedded widget, a client reconnecting with
      // a level since narrowed away, a script.
      const declared = declaredThinkingLevels(config.thinkingLevels, workspace.agent.snapshot().model);
      if (declared && !declared.includes(message.level)) return;
      const level = message.level;
      workspace.agent
        .setThinkingLevel(level)
        // The runtime is the authority on what it settled at — a model without the
        // requested level lands elsewhere, and the UI must show what it landed on.
        .then(() => broadcast(workspace, { type: "thinking_changed", level: workspace.agent.snapshot().thinkingLevel }))
        .catch(reportError);
      break;
    }
    case "new_session":
      void replaceSession(workspace, socket, () => workspace.agent.newSession());
      break;
    case "switch_session":
      if (typeof message.path !== "string") return;
      switchSession(workspace, socket, message.path).catch(reportError);
      break;
    case "delete_session":
      if (typeof message.path !== "string") return;
      deleteSession(workspace, socket, message.path).catch(reportError);
      break;
    case "list_sessions":
      listSessions(workspace, socket).catch(reportError);
      break;
    case "rename_session":
      if (typeof message.path !== "string" || typeof message.name !== "string") return;
      if (message.name.length > MAX_NAME_LENGTH * 4) return;
      renameSession(workspace, socket, message.path, message.name).catch(reportError);
      break;
    case "search_sessions":
      if (typeof message.query !== "string" || typeof message.requestId !== "string") return;
      // A search scans every transcript: don't let a client do it with a novel
      if (message.query.length > MAX_QUERY_LENGTH) return;
      handleSearchSessions(workspace, socket, message.query, message.requestId).catch(reportError);
      break;
    case "compact":
      // Failures surface via the compaction_end event (errorMessage) — avoid double-reporting.
      workspace.agent.compact().catch(() => {});
      break;
    case "extension_ui_response": {
      // Every other case here checks its fields; this one used to pass the parsed
      // frame straight through to the child's stdin. The type is pinned by the
      // switch, but the rest is a client's to invent: an unbounded `value` stalls
      // every later command behind the write chain until the command timeout fires
      // and kills the runtime for good.
      if (typeof message.id !== "string") return;
      const answer = extensionUiAnswer(message);
      if (answer === undefined) return;
      workspace.agent.answerExtensionUI(answer);
      // Only the dialog that was actually answered. A stale or unknown id is
      // ignored by the runtime, and one answer out of several pending questions
      // leaves the turn still blocked — clearing the badge on either would stop
      // showing a project that genuinely still needs the user.
      if (workspace.pendingDialogs.delete(answer.id)) announceWorkspaceActivity();
      break;
    }
    case "list_directory":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleListDirectory(workspace, socket, message.path, message.requestId).catch(reportError);
      break;
    case "read_file":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleReadFile(workspace, socket, message.path, message.requestId).catch(reportError);
      break;
    case "write_file":
      if (
        typeof message.path !== "string" ||
        typeof message.content !== "string" ||
        typeof message.expectedMtimeMs !== "number" ||
        typeof message.requestId !== "string"
      ) {
        return;
      }
      handleWriteFile(workspace, socket, message.path, message.content, message.expectedMtimeMs, message.force === true, message.requestId).catch(
        reportError,
      );
      break;
    case "create_file":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleCreateFile(workspace, socket, message.path, message.requestId).catch(reportError);
      break;
    case "create_directory":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleCreateDirectory(workspace, socket, message.path, message.requestId).catch(reportError);
      break;
    case "upload_file":
      if (
        typeof message.destinationDirectory !== "string" ||
        typeof message.name !== "string" ||
        typeof message.contentBase64 !== "string" ||
        typeof message.requestId !== "string"
      ) {
        return;
      }
      handleUploadFile(workspace, socket, message.destinationDirectory, message.name, message.contentBase64, message.requestId).catch(reportError);
      break;
    case "open_native":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleOpenNative(workspace, socket, message.path, message.requestId).catch(reportError);
      break;
    case "rename_file":
      if (typeof message.path !== "string" || typeof message.name !== "string" || typeof message.requestId !== "string") return;
      handleRenameFile(workspace, socket, message.path, message.name, message.requestId).catch(reportError);
      break;
    case "delete_file":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleDeleteFile(workspace, socket, message.path, message.requestId).catch(reportError);
      break;
    case "move_file":
      if (
        typeof message.path !== "string" ||
        typeof message.destinationDirectory !== "string" ||
        typeof message.requestId !== "string"
      ) {
        return;
      }
      handleMoveFile(workspace, socket, message.path, message.destinationDirectory, message.requestId).catch(reportError);
      break;
    case "copy_file":
      if (
        typeof message.path !== "string" ||
        typeof message.destinationDirectory !== "string" ||
        typeof message.requestId !== "string"
      ) {
        return;
      }
      handleCopyFile(workspace, socket, message.path, message.destinationDirectory, message.requestId).catch(reportError);
      break;
    case "search_files":
      if (typeof message.query !== "string" || typeof message.requestId !== "string") return;
      handleSearchFiles(workspace, socket, message.query, message.requestId).catch(reportError);
      break;
    case "list_tree":
      try {
        sendTree(workspace, socket);
      } catch (error) {
        reportError(error);
      }
      break;
    case "navigate_tree":
      if (typeof message.entryId !== "string") return;
      navigateTree(workspace, socket, message.entryId).catch(reportError);
      break;
    case "fork_session":
      if (typeof message.entryId !== "string") return;
      forkSession(workspace, socket, message.entryId).catch(reportError);
      break;
    case "edit_prompt": {
      if (typeof message.entryId !== "string" || typeof message.text !== "string") return;
      const editText = message.text.trim();
      const editImages = validImages(message.images);
      if (message.images !== undefined && editImages === undefined) {
        send(socket, { type: "error", message: "Attachments rejected (too large or invalid)" });
        return;
      }
      if (!editText && !editImages?.length) return;
      editPrompt(workspace, socket, message.entryId, editText || "(see attached images)", editImages).catch(reportError);
      break;
    }
    case "git_status":
      if (typeof message.requestId !== "string") return;
      if (message.repo !== undefined && typeof message.repo !== "string") return;
      handleGitStatus(workspace, socket, message.repo, message.requestId).catch(reportError);
      break;
    case "get_outcome":
      if (typeof message.requestId !== "string") return;
      handleGetOutcome(workspace, socket, message.requestId).catch(reportError);
      break;
    case "git_diff":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleGitDiff(workspace, socket, message.path, message.requestId).catch(reportError);
      break;
    case "git_log":
      if (typeof message.requestId !== "string" || typeof message.repo !== "string") return;
      if (message.limit !== undefined && typeof message.limit !== "number") return;
      handleGitLog(workspace, socket, message.repo, message.limit ?? 30, message.requestId).catch(reportError);
      break;
    case "git_show":
      if (typeof message.sha !== "string" || typeof message.requestId !== "string") return;
      if (typeof message.repo !== "string") return;
      handleGitShow(workspace, socket, message.repo, message.sha, message.requestId).catch(reportError);
      break;
    case "git_file_log":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      if (message.limit !== undefined && typeof message.limit !== "number") return;
      handleGitFileLog(workspace, socket, message.path, message.limit ?? 100, message.requestId).catch(reportError);
      break;
    case "git_file_diff":
      if (typeof message.requestId !== "string") return;
      if (!isGitRevision(message.base) || !isGitRevision(message.target)) return;
      handleGitFileDiff(workspace, socket, message.base, message.target, message.requestId).catch(reportError);
      break;
    case "set_credential":
      if (!validProviderId(message.provider) || typeof message.apiKey !== "string" || message.apiKey.trim() === "") return;
      handleSetCredential(workspace, socket, message.provider, message.apiKey).catch(reportError);
      break;
    case "declare_provider":
      if (!validProviderId(message.provider) || !validBaseUrl(message.baseUrl)) return;
      if (typeof message.apiKey !== "string" || message.apiKey.trim() === "") return;
      if (!Array.isArray(message.models) || message.models.length === 0) return;
      handleDeclareProvider(workspace, socket, {
        provider: message.provider,
        baseUrl: message.baseUrl,
        apiKey: message.apiKey,
        models: message.models,
        ...(message.compat ? { compat: message.compat } : {}),
      }).catch(reportError);
      break;
    case "browse_server_directory":
      if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
      handleBrowseServerDirectory(socket, message.path, message.requestId).catch(reportError);
      break;
    case "update_config": {
      if (message.sandbox !== undefined) {
        if (
          typeof message.sandbox.root !== "string" ||
          typeof message.sandbox.allowWrite !== "boolean" ||
          typeof message.sandbox.allowBash !== "boolean" ||
          (message.sandbox.writableRoot !== undefined && typeof message.sandbox.writableRoot !== "string")
        ) {
          send(socket, { type: "error", message: "Invalid sandbox config" });
          return;
        }
      }
      if (message.userSkillPaths !== undefined) {
        if (!Array.isArray(message.userSkillPaths) || message.userSkillPaths.some((p) => typeof p !== "string" || p.trim() === "")) {
          send(socket, { type: "error", message: "Invalid skill paths" });
          return;
        }
      }
      if (message.userExtensionPaths !== undefined) {
        if (!Array.isArray(message.userExtensionPaths) || message.userExtensionPaths.some((p) => typeof p !== "string" || p.trim() === "")) {
          send(socket, { type: "error", message: "Invalid extension paths" });
          return;
        }
      }
      if (
        message.sandbox === undefined &&
        message.userSkillPaths === undefined &&
        message.userExtensionPaths === undefined
      ) {
        send(socket, { type: "error", message: "Nothing to update" });
        return;
      }
      handleUpdateConfig(workspace, socket, {
        ...(message.sandbox ? { sandbox: message.sandbox } : {}),
        ...(message.userSkillPaths ? { userSkillPaths: message.userSkillPaths } : {}),
        ...(message.userExtensionPaths ? { userExtensionPaths: message.userExtensionPaths } : {}),
      }).catch(reportError);
      break;
    }
    case "terminal_open": {
      if (typeof message.terminalId !== "string") return;
      if (!config.terminal?.enabled) {
        send(socket, {
          type: "terminal_error",
          terminalId: message.terminalId,
          message: "Terminal access is disabled by server configuration.",
        });
        return;
      }
      const allowBash = workspace.settings.sandbox ? workspace.settings.sandbox.allowBash : true;
      if (!allowBash) {
        send(socket, {
          type: "terminal_error",
          terminalId: message.terminalId,
          message: "Terminal access is disabled in the current sandbox. Set sandbox.allowBash: true to enable terminal.",
        });
        return;
      }
      const termCwd = message.cwd && typeof message.cwd === "string" ? message.cwd : workspace.settings.cwd;
      terminalManager.open(
        socket,
        message.terminalId,
        termCwd,
        message.cols ?? 80,
        message.rows ?? 24,
        (termId, data) => send(socket, { type: "terminal_data", terminalId: termId, data }),
        (termId, exitCode) => send(socket, { type: "terminal_exit", terminalId: termId, exitCode }),
        { ...config.terminal, gitPath: config.gitPath },
      ).catch((error) => {
        send(socket, {
          type: "terminal_error",
          terminalId: message.terminalId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
      break;
    }
    case "terminal_input": {
      if (typeof message.terminalId !== "string" || typeof message.data !== "string") return;
      terminalManager.write(socket, message.terminalId, message.data);
      break;
    }
    case "terminal_resize": {
      if (typeof message.terminalId !== "string" || typeof message.cols !== "number" || typeof message.rows !== "number") return;
      terminalManager.resize(socket, message.terminalId, message.cols, message.rows);
      break;
    }
    case "terminal_get_cwd": {
      if (typeof message.terminalId !== "string") return;
      terminalManager.getCwd(socket, message.terminalId).then((cwd) => {
        if (cwd) {
          send(socket, { type: "terminal_cwd", terminalId: message.terminalId, cwd });
        }
      }).catch(() => {});
      break;
    }
    case "terminal_close": {
      if (typeof message.terminalId !== "string") return;
      terminalManager.close(socket, message.terminalId);
      break;
    }
  }
}

// --- Wire up the real /ws and /health handlers, now that the runtime is ready ------

handleWsConnection = (socket, workspaceRoot) => {
  const bound = (workspaceRoot ? workspaces.get(workspaceRoot) : undefined) ?? workspaces.default ?? workspace;
  clients.set(socket, bound);
  // A named project restored from the persisted set has no session yet. Build it
  // before the snapshot, which is what asks the runtime for its state.
  ensureStarted(bound)
    .then(() => bindClient(socket, bound, "hello"))
    .catch((error: unknown) => {
      reportError(error);
      send(socket, { type: "workspace_error", message: `Could not start ${path.basename(bound.root)}: ${error instanceof Error ? error.message : String(error)}` });
    });
  socket.on("message", (data: Buffer) => handleClientMessage(socket, data.toString()));
  socket.on("close", () => {
    terminalManager.closeAllForSocket(socket);
    const bound = clients.get(socket);
    clients.delete(socket);
    // The idle clock starts when the last watcher leaves, not at the next sweep.
    if (bound && ![...clients.values()].includes(bound)) bound.lastUsedAt = Date.now();
    // Nobody left to answer a dialog. An extension blocked on one holds its command
    // open, and for `prompt` that command's timeout is deliberately suspended while
    // a dialog is up — so without this the child waits on a question no one can see,
    // with no watchdog left to end it, and the way out (a new session) is itself a
    // command to the blocked child.
    // No clients ON THE SERVER, not on this workspace. Under multi-project a
    // workspace nobody is watching is the normal state — an agent is meant to keep
    // working there — so cancelling on "nobody is looking at this one" would
    // discard the very requests the attention badge exists to surface. Only when
    // the last client of the whole server leaves is there truly nobody who could
    // ever answer, and then every workspace's pending requests go.
    // `started` guards the access: a retired project has no runtime, and it can
    // hold no pending dialog either — reaching `agent` there would throw out of a
    // socket close callback.
    if (clients.size === 0) {
      for (const open of workspaces.all()) {
        if (!open.started) continue;
        open.agent.cancelPendingExtensionRequests();
        open.pendingDialogs.clear();
      }
      announceWorkspaceActivity();
    }
  });
};
// A failed runtime reports unready: /health answers 503 and the operator's probe
// sees the process is no longer serving an agent, even though HTTP still answers.
getHealth = () => (workspace.agent.ok ? { ok: true, sessionId: workspace.agent.snapshot().sessionId } : { ok: false });

console.log(`[pi] session ${workspace.agent.snapshot().sessionId}`);
console.log(`[pi] agent runtime ${workspace.agent.kind}`);
console.log(`[pi] model ${modelName(workspace)} · cwd ${workspace.settings.cwd} · agentDir ${AGENT_DIR}`);
const runtimeTools = workspace.agent.snapshot().tools;
if (runtimeTools) {
  console.log(`[pi] tools active: ${runtimeTools.filter((tool) => tool.active).map((tool) => tool.name).join(", ") || "(none)"}`);
  console.log(`[pi] tools inactive: ${runtimeTools.filter((tool) => !tool.active).map((tool) => tool.name).join(", ") || "(none)"}`);
}
const runtimeSkills = workspace.agent.snapshot().commands.filter((command) => command.source === "skill").map((command) => command.name);
console.log(`[pi] skills: ${runtimeSkills.join(", ") || "(none)"}`);
if (config.sandbox) {
  const extras = [
    config.sandbox.allowWrite ? "write" : "read-only",
    ...(config.sandbox.allowBash ? ["bash (UNCONFINED)"] : []),
  ].join(", ");
  console.log(`[pi] sandbox ${config.sandbox.root} · ${extras}`);
}
console.log(`[pi] file browser root ${workspace.browserRoot}`);
// Worth a line: it changes where models come from, and its absence is what makes
// credential changes hang for 20 s on a host that cannot reach the catalogs.
if (config.offline) console.log("[pi] offline — model catalogs are not fetched");
// The old warning ("No models available") named neither the cause nor a way out, and
// the failure only surfaced on the user's first message. Say it at startup, name the
// directory the credentials are missing from, and point at both ways to supply them.
if (!credentialStatus(workspace).usableModel) {
  const configured = credentialStatus(workspace).providers.some((provider) => provider.configured);
  console.warn(
    configured
      ? `[pi] no model available — providers are configured, but "allowedModels" leaves nothing to choose from`
      : `[pi] no credentials in ${AGENT_DIR} — open the UI to set one up, or run "pi-outpost login --provider <name>" (provider environment variables work too)`,
  );
}


/**
 * Release projects nobody is using.
 *
 * Two conditions, and both are required: no client subscribed, and no turn
 * running. Age alone is never enough — under multi-project a workspace nobody is
 * watching is the *normal* state, because an agent is meant to keep working there,
 * so retiring on age would kill the one thing this whole feature exists to allow.
 *
 * The default project is never retired: it is what an unnamed connection gets, and
 * rebuilding it on every fresh connection would trade a warm session for nothing.
 */
function sweepIdleWorkspaces(): void {
  const timeout = config.workspaceIdleTimeoutMs;
  const now = Date.now();
  const watched = new Set(clients.values());
  for (const open of workspaces.all()) {
    if (open === workspaces.default) continue;
    if (!open.started) continue;
    const isWatched = watched.has(open);
    const isBusy = open.isBusy();
    if (isWatched) {
      open.lastUsedAt = now;
      continue;
    }
    if (isBusy) {
      // A long turn keeps its project alive however long it runs. This is the line
      // that makes "unused" mean unused rather than unwatched.
      open.lastUsedAt = now;
      continue;
    }
    // Retention follows the authoritative plan fact, not the projected activity:
    // `waiting` deliberately masks review readiness in the selector but must not
    // make that review-ready workspace eligible for retirement.
    const readyForReview = workspaceWorkPlanReadyForReview(open);
    if (!shouldRetireWorkspace({ timeoutMs: timeout, now, lastUsedAt: open.lastUsedAt, watched: isWatched, busy: isBusy, readyForReview })) continue;
    console.log(`[pi] retiring ${path.basename(open.root)} after ${Math.round((now - open.lastUsedAt) / 1000)}s idle`);
    void open
      .retire()
      .then(() => announceWorkspaceActivity())
      .catch(reportError);
  }
}

// A minute is fine granularity for a timeout measured in tens of minutes, and it
// costs one pass over a handful of projects. A timeout SHORTER than the sweep is
// sampled at the sweep's rate, not its own — a configured 30s would then mean
// anything up to 90s — so the sweep follows it down when it is set that low.
const SWEEP_INTERVAL_MS = Math.max(
  1_000,
  Math.min(60_000, config.workspaceIdleTimeoutMs > 0 ? config.workspaceIdleTimeoutMs : 60_000),
);
const idleSweep = setInterval(sweepIdleWorkspaces, SWEEP_INTERVAL_MS);
idleSweep.unref?.();

// --- Shutdown -------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  // Every open project, not just the one the server booted with: a second project's
  // session, watcher and child process would otherwise outlive the signal that was
  // meant to end them.
  await Promise.allSettled([...workspaces.all()].map((open) => open.stop()));
  await app.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
