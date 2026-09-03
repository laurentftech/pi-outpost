/**
 * Standalone configuration for pi-outpost.
 *
 * One rule, everywhere: **flag > environment variable > config file > default**.
 *
 * With one deliberate exception: settings the user changes in the interface are
 * written back into the file (see `persistEditableSettings`) as explicit values,
 * and explicit values are exactly what a flag or a variable can no longer move —
 * a sandbox root chosen in Settings must not be silently relocated by an
 * inherited PI_OUTPOST_CWD on the next start.
 *
 * The file itself is searched for in four places, and the first one found is the
 * only one read (see `findConfigFile`) — configs are never merged, so the file
 * you are looking at is the configuration that is running. Without any file the
 * server refuses to start: a permissive default (full toolset, bash, the launch
 * directory as workspace) is fine for someone who cloned the repo on purpose and
 * a nasty surprise for someone who typed `npx pi-outpost` in their home.
 *
 * Relative paths in the file are resolved against the config file's directory;
 * relative paths on the command line, against the current directory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeThinkingLevels, THEMES, type Theme, type ThinkingLevel } from "@pi-outpost/shared";
import { STRUCTURED_EXCHANGE_BYTES_CEILING } from "@pi-outpost/shared/structured-exchange/bounds";
import { OPEN_SHAPES, type OpenShape } from "./openBrowser.ts";

export interface BrandingConfig {
  /** Header title. Default: "π". */
  title?: string;
  /** Empty-state welcome line. */
  welcome?: string;
  /** CSS accent color (buttons, highlights), e.g. "#0ea5e9". */
  accentColor?: string;
  /** Theme applied when the client has no stored preference. Default: "system". */
  defaultTheme?: Theme;
  /**
   * Whether the UI shows a theme toggle button. Default: true.
   * Disable when embedding pi-outpost in a host app that drives the theme
   * itself (e.g. by posting `{ type: "pi-outpost:set-theme", theme }`).
   */
  allowThemeToggle?: boolean;
}

export interface SandboxConfig {
  /** Directory file tools are confined to (absolute after load) — the read-only zone. */
  root: string;
  /** Enable edit/write inside writableRoot (or the whole root). Default: false (read-only). */
  allowWrite: boolean;
  /**
   * Subdirectory of root that edit/write are further confined to — the read-write zone.
   * Must resolve inside root. Defaults to root itself (the whole sandbox is writable).
   * Ignored when allowWrite is false.
   */
  writableRoot?: string;
  /**
   * Enable the bash tool. Default: false — bash cannot be path-scoped, so
   * turning it on effectively disables the file sandbox. Explicit opt-in only.
   */
  allowBash: boolean;
  /**
   * Extra directories (absolute paths) that read tools (read/ls/grep/find) are
   * allowed to access in addition to `root`. Write tools are NOT affected — these
   * are read-only exceptions. Populated from `skillPaths`, `promptPaths`,
   * `extensionPaths` and `extensionScripts` so the agent can read files stored
   * outside the sandbox root.
   */
  readExceptions: string[];
}

export interface SandboxLocks {
  /** Whether sandbox.root is locked (not editable from UI). Default: false. */
  root?: boolean;
  /** Whether sandbox.allowWrite is locked. Default: false. */
  allowWrite?: boolean;
  /** Whether sandbox.allowBash is locked. Default: false. */
  allowBash?: boolean;
  /** Whether sandbox.writableRoot is locked. Default: false. */
  writableRoot?: boolean;
  /** Whether terminal.enabled is locked. Default: false. */
  terminal?: boolean;
}

export interface TerminalConfig {
  /**
   * Whether the integrated web terminal (PTY) is enabled. Default: false.
   * Explicit opt-in only.
   */
  enabled: boolean;
  /**
   * Path to the shell executable to spawn (e.g. "/bin/zsh", "bash.exe", "powershell.exe").
   * When unset, the platform default is automatically detected (Git Bash -> PowerShell -> cmd on Windows; $SHELL -> zsh -> bash on Unix).
   */
  shell?: string;
  /**
   * Arguments passed to the shell process (defaults to ["-l"] on Unix login shells).
   */
  shellArgs?: string[];
}

export interface DocxConfig {
  /**
   * Largest Word document the extraction tool will open, in bytes. Default: 25 MiB.
   * Same ceiling as PDFs, for the same reason: the 1 MiB preview limit is about
   * text previews, and says nothing useful about a document format.
   */
  maxBytes: number;
}

/** Default Word ceiling — 25 MiB, matching the PDF one. */
export const DEFAULT_DOCX_MAX_BYTES = 26_214_400;

export interface XlsxConfig {
  /**
   * Largest workbook the extraction tool will open, in bytes. Default: 25 MiB.
   * The same ceiling as PDFs and Word documents — a spreadsheet compresses far
   * better than either, so this bounds the file, and the row and character caps
   * in the reader bound what one call returns.
   */
  maxBytes: number;
}

/** Default spreadsheet ceiling — 25 MiB, matching the other two. */
export const DEFAULT_XLSX_MAX_BYTES = 26_214_400;

export interface PptxConfig {
  /**
   * Largest presentation the extraction tool will open, in bytes. Default: 25 MiB.
   * The same ceiling as the other document formats — a deck's size is mostly its
   * images, which this reader never turns into output, so the slide and character
   * caps in the reader are what bound one call.
   */
  maxBytes: number;
}

/** Default presentation ceiling — 25 MiB, matching the other three. */
export const DEFAULT_PPTX_MAX_BYTES = 26_214_400;

export interface FilesConfig {
  /**
   * Whether the server watches the directories the file browser has listed, so
   * the tree follows the workspace whoever changed it. Default: true.
   *
   * Off is for hosts where a watch is a liability rather than a feature: a
   * network mount or a container filesystem that emits no events anyway, or one
   * whose inotify budget is spent elsewhere. Watching is best-effort by
   * contract, which is why the tree's manual refresh exists either way.
   */
  watch: boolean;
}

export interface PdfConfig {
  /**
   * Largest PDF the raw-file route will serve, in bytes. Default: 25 MiB.
   * PDFs get their own ceiling because the 1 MiB preview limit excludes most
   * real documents; every other file keeps that limit.
   */
  maxBytes: number;
}

/** Default PDF ceiling — 25 MiB, well above the 1 MiB that governs other files. */
export const DEFAULT_PDF_MAX_BYTES = 26_214_400;

export interface StructuredExchangeConfig {
  /**
   * Largest structured-exchange document the viewer will fetch, in bytes.
   * Default: the contract's own byte ceiling.
   *
   * These documents get their own limit for the same reason PDFs do — the 1 MiB
   * preview limit is about *text previews*, and a diagram is not read as text —
   * but the reasoning stops somewhere different. A PDF's ceiling is a guess about
   * what people open; this one is published: version 1 of the contract bounds a
   * conforming document, and a deployment accepting more would be promising
   * something the schema does not.
   */
  maxBytes: number;
}

/** Default document ceiling — the contract's, so the viewer accepts what the schema does. */
export const DEFAULT_STRUCTURED_EXCHANGE_MAX_BYTES = STRUCTURED_EXCHANGE_BYTES_CEILING;

/**
 * Which workspace affordances a mounted widget presents.
 *
 * `settings` is the default and preserves the interface embeds have always had:
 * one project, its sandbox root editable through Settings alone. `root` adds a
 * compact chooser that moves that one workspace's sandbox root. `projects` shows
 * the open/switch/close controls the standalone app has.
 *
 * A presentation choice, not an authorization one: `workspaceLock`, the sandbox
 * locks and the runtime capability checks remain the enforcing boundaries, and
 * this setting can only ever narrow what is offered within them.
 */
export const EMBED_WORKSPACE_CONTROLS = ["settings", "root", "projects"] as const;
export type EmbedWorkspaceControls = (typeof EMBED_WORKSPACE_CONTROLS)[number];

/** Interface choices that apply to mounted widgets only. */
export interface EmbedConfig {
  workspaceControls: EmbedWorkspaceControls;
}

export const AGENT_RUNTIME_MODES = ["embedded", "rpc"] as const;
export type AgentRuntimeMode = (typeof AGENT_RUNTIME_MODES)[number];

/**
 * Which agent runtime serves the browser. `embedded` (the default) keeps a Pi SDK
 * session in this process; `rpc` supervises a `pi --mode rpc` child.
 *
 * The mode flag is pi-outpost's to pass, never the operator's: a configuration
 * that could put the child in a different mode would be a server that silently
 * stops serving. `args` is an argument *vector*, not a command line — no shell
 * parses it, so a value with spaces is one argument and nothing interpolates.
 */
export interface AgentRuntimeConfig {
  mode: AgentRuntimeMode;
  /** Pi executable to spawn. Required when mode is "rpc". */
  executable?: string;
  /** Extra fixed arguments, passed before pi-outpost's own `--mode rpc`. */
  args: string[];
  /** How long the child has to answer its first RPC command before startup fails. */
  startupTimeoutMs: number;
  /** How long one correlated RPC command may stay pending. */
  commandTimeoutMs: number;
  /** Grace period between asking the child to stop and killing it. */
  shutdownGraceMs: number;
}

/**
 * Arguments pi-outpost owns and an operator may not set.
 *
 * Two kinds, and both would break the contract rather than merely surprise:
 * anything that moves the child off RPC mode (it would stop answering the
 * protocol this server speaks), and the session directory (pi-outpost resolves it
 * from `agentDir`, and two answers would put the browser's session list and the
 * agent's own store in different places).
 */
const RESERVED_RPC_ARGS = new Map<string, string>([
  ["--mode", "pi-outpost always runs the child in RPC mode"],
  ["--print", "it would make the child process one prompt and exit instead of serving RPC"],
  ["-p", "it would make the child process one prompt and exit instead of serving RPC"],
  ["--export", "it would make the child export a session and exit instead of serving RPC"],
  ["--list-models", "it would make the child print models and exit instead of serving RPC"],
  ["--help", "it would make the child print help and exit instead of serving RPC"],
  ["-h", "it would make the child print help and exit instead of serving RPC"],
  ["--version", "it would make the child print its version and exit instead of serving RPC"],
  ["-v", "it would make the child print its version and exit instead of serving RPC"],
  ["--session-dir", 'pi-outpost derives the session directory from "agentDir"'],
  // These carry a *replacement* value rather than adding to a list, so a second one
  // on the line silently decides the toolset or the system prompt — and the config
  // key that appears to set them would be the one being ignored. Additive flags
  // (--skill, --extension, --prompt-template, --append-system-prompt) stay allowed:
  // one more of those is one more resource, not a different answer.
  ["--tools", 'pi-outpost derives the tool allowlist from "tools"'],
  ["-t", 'pi-outpost derives the tool allowlist from "tools"'],
  ["--system-prompt", 'pi-outpost derives the system prompt from "systemPrompt"'],
]);

/**
 * Flags whose value must never reach a log line.
 *
 * `--api-key` is pi's own. The rest are the names other agents and gateways use for
 * the same thing: the argument vector is the operator's, a fork is free to invent a
 * spelling, and a secret printed once at startup is a secret in the scrollback and
 * in whatever collects it. Matching by name is a guess, so it errs toward hiding.
 */
const SECRET_RPC_ARGS = new Set([
  "--api-key",
  "--apikey",
  "--token",
  "--auth",
  "--auth-token",
  "--access-token",
  "--secret",
  "--password",
]);

/** Loading models, extensions and skills takes seconds on a cold start; a minute is generous. */
export const DEFAULT_RPC_STARTUP_TIMEOUT_MS = 60_000;
/** A compaction is the slowest correlated command; anything past this is a hung child. */
export const DEFAULT_RPC_COMMAND_TIMEOUT_MS = 300_000;
/** How long the child gets to exit on its own before it is killed. */
export const DEFAULT_RPC_SHUTDOWN_GRACE_MS = 5_000;

/** The executable and its arguments, with any credential replaced by a placeholder. */
export function redactRpcCommand(runtime: AgentRuntimeConfig): string {
  const parts: string[] = [runtime.executable ?? ""];
  let redactNext = false;
  for (const arg of runtime.args) {
    if (redactNext) {
      parts.push("<redacted>");
      redactNext = false;
      continue;
    }
    const [name] = arg.split("=", 1);
    if (SECRET_RPC_ARGS.has(name)) {
      parts.push(arg.includes("=") ? `${name}=<redacted>` : arg);
      redactNext = !arg.includes("=");
      continue;
    }
    parts.push(arg);
  }
  return [...parts, "--mode", "rpc"].join(" ");
}

export interface AppConfig {
  /** The file this configuration was read from — the one of four locations that won. */
  configFile: string;
  /** Agent working directory. */
  cwd: string;
  /** Own config dir (models/auth/settings/sessions). Default: ~/.pi/agent. */
  agentDir?: string;
  /** Which agent runtime serves the browser. Defaults to the embedded SDK session. */
  agentRuntime: AgentRuntimeConfig;
  /** File-scoped sandbox. When set, built-in tools are replaced by scoped ones. */
  sandbox?: SandboxConfig;
  /** Which sandbox fields the user's settings menu may not change. */
  sandboxLocks?: SandboxLocks;
  /**
   * Projects held open, by resolved root. Written by the server when one is opened
   * or closed — not hand-authored: it is a record of what the user did, the way
   * `userSkillPaths` is, and belongs to the interface rather than the deployment.
   *
   * Empty or absent means the single-project server this has always been: `cwd`
   * alone, and no selector anywhere.
   */
  openProjects: string[];
  /**
   * Forbid opening, closing and switching projects, binding the server to one.
   * Follows the `sandboxLocks` convention: the deployment decides, and the
   * interface offers no affordance for what it forbids. This is what an embedding
   * host sets to pin its widget to a project.
   */
  workspaceLock?: boolean;
  /**
   * Forbid adding or removing extension paths from the interface. Follows the
   * `sandboxLocks` convention: the deployment decides, and the interface offers no
   * affordance for what it forbids.
   *
   * Its own setting rather than a sandbox lock, because an extension path is not a
   * field of the sandbox — and because loading code is a different act from pointing
   * the agent at more text to read. Skill paths stay editable under it.
   */
  extensionLock?: boolean;
  /**
   * How long an unused project stays alive before its session is released, in
   * milliseconds. 0 disables retirement entirely.
   *
   * "Unused" means no client subscribed AND no turn running — never age alone. A
   * project nobody is watching is the normal state here, since an agent is meant
   * to keep working there, so retiring on age would kill the very thing this
   * feature exists to allow.
   */
  workspaceIdleTimeoutMs: number;
  /** Tool name allowlist (non-sandbox mode), e.g. ["read","grep","find","ls"]. */
  tools?: string[];
  /** Skip loading extensions entirely. */
  noExtensions: boolean;
  /** Explicit extension paths to load (in addition to defaults). */
  extensionPaths: string[];
  /**
   * Extension paths added through Settings — the editable list, held apart from
   * `extensionPaths` exactly as `userSkillPaths` is held apart from `skillPaths`:
   * the deployment's are theirs, and an apply must never be able to drop one.
   *
   * A path here may be a directory. The SDK discovers what is inside it — a
   * `package.json` with a `pi.extensions` field, else `index.ts`/`index.js`, else
   * the loose `.ts`/`.js` files one level down — which is why the interface needs
   * no way to name an individual file.
   */
  userExtensionPaths: string[];
  /**
   * Extension script paths loaded at runtime via import(). Works in both dev
   * mode and bundled builds (esbuild preserves dynamic import()). Files must
   * be .mjs (or .ts in dev mode with tsx).
   *
   * Each script must default-export an ExtensionFactory function.
   */
  extensionScripts: string[];
  /**
   * Skip loading skills entirely. Needed for real isolation even with a custom
   * agentDir: skills also auto-load from ~/.agents/skills (hardcoded to the real
   * home directory, not agentDir) and from .agents/skills walked up from cwd to
   * the git root — neither is scoped by agentDir.
   */
  noSkills: boolean;
  /**
   * Explicit skill paths from the configuration file — the operator's own list.
   * The interface may show these but never rewrite or remove them: they are the
   * deployment's, not a user's, and a settings apply must not be able to take a
   * skill away from everyone who connects.
   */
  skillPaths: string[];
  /**
   * Skill paths added through Settings. Held apart from `skillPaths` for exactly
   * that reason — this is the list the interface owns, adds to, and removes from.
   * Both lists are loaded; see `allSkillPaths`.
   */
  userSkillPaths: string[];
  /**
   * Skip auto-discovering prompt templates entirely (both agentDir and the
   * project's cwd/.pi/prompts). Like noSkills, cwd doubles as both the
   * agent's working directory and a resource-discovery root, so pointing
   * cwd at a real project pulls in that project's .pi/prompts too.
   */
  noPromptTemplates: boolean;
  /** Explicit prompt template paths (.md files or directories). */
  promptPaths: string[];
  /**
   * Restrict the model switcher to exactly these provider/id pairs. Without
   * this, it lists every built-in model whose provider has configured auth —
   * often dozens of variants the deployment doesn't actually serve (e.g. an
   * air-gapped internal endpoint). Omit to keep the unrestricted list.
   */
  allowedModels?: { provider: string; id: string }[];
  /**
   * What thinking levels a model accepts, for a model the runtime cannot describe.
   *
   * An entry without `id` covers every model of that provider — an in-house endpoint
   * usually has one answer for all of them. Where both could apply, the entry naming
   * the model wins. A declaration is authoritative over whatever the runtime reports:
   * this setting exists because the runtime is guessing.
   */
  thinkingLevels?: { provider: string; id?: string; levels: ThinkingLevel[] }[];
  /** Replace pi's built-in system prompt entirely (tool guidelines are lost — write your own). */
  systemPrompt?: string;
  /** Extra text appended after the (built-in or custom) system prompt, one entry per paragraph. */
  appendSystemPrompt: string[];
  /**
   * Inject a web-UI context block into the system prompt (before
   * appendSystemPrompt entries) so the agent knows its output renders in this
   * web UI — markdown/math/mermaid, inline images, viewer links. Set false for
   * deployments with a tightly curated prompt.
   */
  webContext: boolean;
  /**
   * Keep the model runtime off the network. The SDK otherwise re-fetches remote
   * model catalogs whenever credentials change, and on a host that cannot reach
   * them — air-gapped, or behind a proxy that does not route them — that request
   * hangs until the server's own ceiling cuts it, stalling every credential
   * change by 20 s. Built-in and models.json-declared models still work: the
   * catalog only adds metadata for models the SDK already knows about.
   */
  offline: boolean;
  /**
   * Whether starting the server opens the interface in a browser.
   *
   * Left undefined by default rather than set: the decision then rests on whether a
   * browser can be shown at all (see openBrowser.ts), which is right on a desktop
   * and right on a headless host without either being configured. Set it to pin the
   * answer for a deployment — a kiosk that must open, a service that must not.
   */
  openBrowser?: boolean;
  /**
   * How the interface is presented once it is opened: in a window of its own, or
   * in the default browser as a tab.
   *
   * Separate from `openBrowser` on purpose. That one answers *whether* and is
   * tri-state; folding a shape into it would put two questions in one setting and
   * make `false` ambiguous against a shape. `openBrowser` still wins: asked not to
   * open, nothing opens, whatever shape was configured.
   */
  openIn: OpenShape;
  /**
   * Whether update checking may make a request. Tri-state on purpose.
   *
   * Left undefined it follows `offline`, which is the sensible default both ways: a
   * host that cannot reach the network is not helped by a request that hangs.
   *
   * Set explicitly it beats `offline` in both directions, because the two settings
   * name different networks. `offline` says remote *model catalogs* are unreachable,
   * and a deployment can be air-gapped from those while still reaching a package
   * registry through an internal proxy — which is exactly the host where knowing a
   * release exists matters most, updated rarely and by hand.
   */
  updateCheck?: boolean;
  /**
   * The registry update checks query, for a deployment whose registry is an internal
   * proxy. Unset, it is resolved from the package manager's own configuration and
   * failing that from the public default — so this only exists for the case npm
   * itself cannot answer.
   */
  updateRegistry?: string;
  /**
   * The git executable to run. Unset, git is resolved from `PATH` and then from the
   * platform's standard install locations — this exists for a deployment that keeps
   * git somewhere neither would find.
   */
  gitPath?: string;
  port: number;
  host: string;
  /** Extra exact Origins allowed on the WebSocket (for embedding in another app). */
  allowedOrigins: string[];
  /**
   * Shared secret required on the WebSocket and HTTP API when set. The
   * PI_OUTPOST_TOKEN env variable overrides it (keeps secrets out of config
   * files). Mandatory in practice when host is not loopback — use a long
   * random value, e.g. `openssl rand -hex 32`.
   */
  token?: string;
  branding: BrandingConfig;
  /** Interface choices that apply to mounted widgets only. */
  embed: EmbedConfig;
  /** File-browser behaviour (directory watching). */
  files: FilesConfig;
  /** PDF handling (size ceiling for the raw-file route). */
  pdf: PdfConfig;
  /** Word handling (size ceiling for the extraction tool). */
  docx: DocxConfig;
  xlsx: XlsxConfig;
  /** PowerPoint handling (size ceiling for the extraction tool). */
  pptx: PptxConfig;
  /** Structured-exchange documents opened as files (size ceiling for the viewer). */
  structuredExchange: StructuredExchangeConfig;
  /** Integrated interactive web terminal (PTY) configuration. */
  terminal: TerminalConfig;
}

/** Launch-time options from the command line — the top of the precedence chain. */
export interface CliOptions {
  config?: string;
  profile?: string;
  cwd?: string;
  agentDir?: string;
  port?: number;
  host?: string;
  offline?: boolean;
  /** Set by --open-in; leave it out and configuration decides the shape. */
  openIn?: OpenShape;
  /** Enable or disable the integrated web terminal. */
  terminal?: boolean;
}

/** Thrown when no config file exists anywhere: the CLI turns it into `init` advice. */
export class NoConfigError extends Error {
  constructor(readonly searched: string[]) {
    super("no configuration file found");
    this.name = "NoConfigError";
  }
}

export function fail(message: string): never {
  throw new Error(`[config] ${message}`);
}

/** `$XDG_CONFIG_HOME/pi-outpost`, or `~/.config/pi-outpost`. */
export function userConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "pi-outpost");
}

/** Profile names are file names, not paths — `../../../etc/evil` must not resolve. */
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function profilePath(name: string, env: NodeJS.ProcessEnv): string {
  if (!PROFILE_NAME.test(name)) {
    fail(`profile name "${name}" is not a name (letters, digits, ".", "_" and "-" only)`);
  }
  const resolved = path.join(userConfigDir(env), "profiles", `${name}.json`);
  if (!fs.existsSync(resolved)) fail(`profile "${name}" not found: ${resolved}`);
  return resolved;
}

/**
 * The one config file to read. Explicit answers (a flag, a profile, an env var)
 * must exist or the server stops — a typo in `--config` should never silently
 * fall through to a different file with different permissions.
 */
export function findConfigFile(
  launchDir: string,
  flags: CliOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Two flags naming the same thing is a mistake worth stopping for. An *inherited*
  // PI_OUTPOST_PROFILE is not: the whole point of "flag > env" is that an explicit
  // --config wins, so it silently outranks the variable rather than colliding with it.
  if (flags.config && flags.profile) {
    fail(`"--config" and "--profile" both name a configuration — pass only one`);
  }

  // Explicit paths resolve against the *current* directory — the one the user is
  // typing in. (The launch directory below is npm's INIT_CWD when the server runs
  // from a workspace script, which is a different thing.)
  if (flags.config) {
    const resolved = path.resolve(flags.config);
    if (!fs.existsSync(resolved)) fail(`config file not found: ${resolved}`);
    return resolved;
  }
  if (flags.profile) return profilePath(flags.profile, env);
  if (env.PI_OUTPOST_CONFIG) {
    const resolved = path.resolve(env.PI_OUTPOST_CONFIG);
    if (!fs.existsSync(resolved)) fail(`config file not found: ${env.PI_OUTPOST_CONFIG}`);
    return resolved;
  }
  if (env.PI_OUTPOST_PROFILE) return profilePath(env.PI_OUTPOST_PROFILE, env);

  const implicit = [
    path.join(launchDir, "pi-outpost.config.json"),
    path.join(userConfigDir(env), "config.json"),
  ];
  const found = implicit.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new NoConfigError(implicit);
  return found;
}

/** `label` names the setting the way the user wrote it, for keys nested under a block. */
export function optionalString(raw: Record<string, unknown>, key: string, label = key): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") fail(`"${label}" must be a non-empty string`);
  return value;
}

export function optionalBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(`"${key}" must be a boolean`);
  return value;
}

export function optionalStringArray(raw: Record<string, unknown>, key: string): string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fail(`"${key}" must be an array of strings`);
  }
  return value as string[];
}

export function optionalModelList(
  raw: Record<string, unknown>,
  key: string,
): { provider: string; id: string }[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`"${key}" must be an array`);
  return value.map((entry, i) => {
    const obj = asObject(entry, `${key}[${i}]`);
    const provider = optionalString(obj, "provider");
    const id = optionalString(obj, "id");
    if (!provider || !id) fail(`"${key}[${i}]" must have "provider" and "id" strings`);
    return { provider, id };
  });
}

/**
 * Declared thinking levels, normalised the way a runtime-reported list is.
 *
 * One normalisation for both sources, so a declared list and a reported one cannot
 * drift into meaning different things. An entry that normalises to nothing is refused
 * rather than kept: a model accepting no level at all cannot be asked for anything, so
 * it is far likelier to be a typo than an intention, and boot is when to say so.
 */
export function optionalThinkingLevels(
  raw: Record<string, unknown>,
  key: string,
): { provider: string; id?: string; levels: ThinkingLevel[] }[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`"${key}" must be an array`);
  return value.map((entry, i) => {
    const obj = asObject(entry, `${key}[${i}]`);
    const provider = optionalString(obj, "provider");
    if (!provider) fail(`"${key}[${i}]" must have a "provider" string`);
    const id = optionalString(obj, "id");
    if (!Array.isArray(obj.levels)) fail(`"${key}[${i}]" must have a "levels" array`);
    const levels = normalizeThinkingLevels(obj.levels);
    if (!levels) {
      fail(`"${key}[${i}]" lists no usable thinking level (got ${JSON.stringify(obj.levels)})`);
    }
    return { provider, ...(id ? { id } : {}), levels: levels! };
  });
}

/**
 * The levels declared for one model, or undefined when the deployment declares none.
 *
 * Most specific wins: an entry naming the model id is a more deliberate statement than
 * the provider-wide one it sits beside.
 */
export function declaredThinkingLevels(
  declarations: { provider: string; id?: string; levels: ThinkingLevel[] }[] | undefined,
  model: { provider: string; id: string } | undefined,
): ThinkingLevel[] | undefined {
  if (!declarations || !model) return undefined;
  const forProvider = declarations.filter((entry) => entry.provider === model.provider);
  return (forProvider.find((entry) => entry.id === model.id) ?? forProvider.find((entry) => entry.id === undefined))?.levels;
}

/** `label` names the setting the way the user wrote it (`"agentRuntime.commandTimeoutMs"`). */
export function positiveInteger(raw: Record<string, unknown>, key: string, fallback: number, label = key): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(`"${label}" must be a positive integer`);
  }
  return value;
}

export function asObject(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`"${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * @param launchDir directory the server was started from — where an implicit
 *   `pi-outpost.config.json` is looked for, and what the agent's cwd defaults to.
 */
export function loadConfig(
  launchDir: string,
  flags: CliOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  options: { quiet?: boolean } = {},
): AppConfig {
  const filePath = findConfigFile(launchDir, flags, env);

  const config: AppConfig = {
    configFile: filePath,
    cwd: launchDir,
    openProjects: [],
    // Half an hour: long enough that a project you step away from is still warm
    // when you come back, short enough that a forgotten one does not hold a
    // session and a watcher all day.
    workspaceIdleTimeoutMs: 30 * 60_000,
    agentRuntime: {
      mode: "embedded",
      args: [],
      startupTimeoutMs: DEFAULT_RPC_STARTUP_TIMEOUT_MS,
      commandTimeoutMs: DEFAULT_RPC_COMMAND_TIMEOUT_MS,
      shutdownGraceMs: DEFAULT_RPC_SHUTDOWN_GRACE_MS,
    },
    noExtensions: false,
    extensionPaths: [],
    userExtensionPaths: [],
    extensionScripts: [],
    noSkills: false,
    skillPaths: [],
    userSkillPaths: [],
    noPromptTemplates: false,
    promptPaths: [],
    appendSystemPrompt: [],
    webContext: true,
    offline: false,
    port: 3141,
    // A window of its own by default: the interface is an application that was
    // launched, not a page that was visited. Where no browser on the machine can
    // present one, opening falls back to what it always did.
    openIn: "window",
    host: "127.0.0.1",
    allowedOrigins: [],
    branding: {},
    // Absent means the interface embeds have always had: one project, no chooser.
    embed: { workspaceControls: "settings" },
    files: { watch: true },
    pdf: { maxBytes: DEFAULT_PDF_MAX_BYTES },
    docx: { maxBytes: DEFAULT_DOCX_MAX_BYTES },
    xlsx: { maxBytes: DEFAULT_XLSX_MAX_BYTES },
    pptx: { maxBytes: DEFAULT_PPTX_MAX_BYTES },
    structuredExchange: { maxBytes: DEFAULT_STRUCTURED_EXCHANGE_MAX_BYTES },
    terminal: { enabled: false },
  };

  let raw: Record<string, unknown>;
  try {
    raw = asObject(JSON.parse(fs.readFileSync(filePath, "utf8")), "config");
  } catch (error) {
    fail(`cannot parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const baseDir = path.dirname(path.resolve(filePath));
  const resolve = (p: string) => path.resolve(baseDir, p);

  const cwd = optionalString(raw, "cwd");
  if (cwd) config.cwd = resolve(cwd);
  const agentDir = optionalString(raw, "agentDir");
  if (agentDir) config.agentDir = resolve(agentDir);

  // The workspace the *file* describes, before any flag or variable moves it. The
  // sandbox is anchored here and nowhere else: `sandbox.root` defaults to the cwd,
  // so anchoring it to the overridden cwd would let anything outside the file —
  // an exported PI_OUTPOST_CWD in a shell profile, a CI job, a compose file —
  // silently widen a write/bash grant the file's author scoped to their project.
  const fileCwd = config.cwd;
  applyDirectories(config, flags, env);
  const cwdOverridden = config.cwd !== fileCwd;

  if (raw.sandbox !== undefined) {
    const sandbox = asObject(raw.sandbox, "sandbox");
    const root = optionalString(sandbox, "root");
    const allowWrite = optionalBoolean(sandbox, "allowWrite", false);
    const allowBash = optionalBoolean(sandbox, "allowBash", false);

    // A sandbox that only *reads* may follow the workspace the user just named —
    // that is what moving the workspace means. A sandbox that grants write or bash
    // may not: an inherited PI_OUTPOST_CWD would turn "write inside my project" into
    // "write inside /". Granting a scope demands naming it.
    if (root === undefined && cwdOverridden && (allowWrite || allowBash)) {
      fail(
        `"sandbox" grants ${allowWrite ? "write" : "bash"} but has no "root", so it would fall back ` +
          `to "cwd" — which was overridden from outside ${filePath}. Set "sandbox.root" explicitly.`,
      );
    }
    const resolvedRoot = root ? resolve(root) : cwdOverridden ? config.cwd : fileCwd;
    const writableRoot = optionalString(sandbox, "writableRoot");
    const resolvedWritableRoot = writableRoot ? resolve(writableRoot) : undefined;
    if (resolvedWritableRoot !== undefined) {
      if (!allowWrite) fail(`"sandbox.writableRoot" requires "sandbox.allowWrite" to be true`);
      const rel = path.relative(resolvedRoot, resolvedWritableRoot);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        fail(`"sandbox.writableRoot" must be inside "sandbox.root"`);
      }
    }
    config.sandbox = {
      root: resolvedRoot,
      allowWrite,
      writableRoot: resolvedWritableRoot,
      allowBash,
      readExceptions: [
        ...(optionalStringArray(raw, "skillPaths") ?? []).map(resolve),
        ...(optionalStringArray(raw, "userSkillPaths") ?? []).map(resolve),
        ...(optionalStringArray(raw, "promptPaths") ?? []).map(resolve),
        ...(optionalStringArray(raw, "extensionPaths") ?? []).map(resolve),
        ...(optionalStringArray(raw, "userExtensionPaths") ?? []).map(resolve),
        ...(optionalStringArray(raw, "extensionScripts") ?? []).map(resolve),
      ],
    };
    if (!fs.existsSync(config.sandbox.root)) {
      fail(`sandbox.root does not exist: ${config.sandbox.root}`);
    }
    if (config.sandbox.writableRoot && !fs.existsSync(config.sandbox.writableRoot)) {
      fail(`sandbox.writableRoot does not exist: ${config.sandbox.writableRoot}`);
    }
  }

  const openProjects = optionalStringArray(raw, "openProjects");
  if (openProjects !== undefined) {
    // Resolved against the config file's directory, like every other configured
    // path, so a relative entry means the same thing here as it does there.
    config.openProjects = openProjects.map((p) => path.resolve(path.dirname(filePath), p));
  }
  config.workspaceLock = optionalBoolean(raw, "workspaceLock", false);
  // Not positiveInteger: 0 is meaningful here — it turns retirement off — and that
  // helper rejects it, so accepting 0 has to be said explicitly.
  if (raw.workspaceIdleTimeoutMs !== undefined) {
    const value = raw.workspaceIdleTimeoutMs;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      fail(`"workspaceIdleTimeoutMs" must be 0 (never retire) or a positive integer`);
    }
    config.workspaceIdleTimeoutMs = value;
  }

  if (raw.sandboxLocks !== undefined) {
    const locks = asObject(raw.sandboxLocks, "sandboxLocks");
    config.sandboxLocks = {
      root: optionalBoolean(locks, "root", false),
      allowWrite: optionalBoolean(locks, "allowWrite", false),
      allowBash: optionalBoolean(locks, "allowBash", false),
      writableRoot: optionalBoolean(locks, "writableRoot", false),
      terminal: optionalBoolean(locks, "terminal", false),
    };
  }

  if (raw.agentRuntime !== undefined) {
    const runtime = asObject(raw.agentRuntime, "agentRuntime");
    const mode = optionalString(runtime, "mode", "agentRuntime.mode") ?? "embedded";
    if (!AGENT_RUNTIME_MODES.includes(mode as AgentRuntimeMode)) {
      fail(`"agentRuntime.mode" must be one of ${AGENT_RUNTIME_MODES.join(", ")} (got "${mode}")`);
    }
    config.agentRuntime.mode = mode as AgentRuntimeMode;

    // A relative executable is a path the operator typed, so it resolves against
    // their config file like every other path in it. A bare name (no separator)
    // is a PATH lookup and must stay one.
    const executable = optionalString(runtime, "executable", "agentRuntime.executable");
    if (executable !== undefined) {
      config.agentRuntime.executable = executable.includes("/") || executable.includes("\\") ? resolve(executable) : executable;
    }
    config.agentRuntime.args = optionalStringArray(runtime, "args") ?? [];
    for (const arg of config.agentRuntime.args) {
      const name = arg.split("=", 1)[0];
      const reason = RESERVED_RPC_ARGS.get(name);
      if (reason !== undefined) {
        fail(`"agentRuntime.args" must not contain "${name}": ${reason}`);
      }
    }
    const timeout = (key: "startupTimeoutMs" | "commandTimeoutMs" | "shutdownGraceMs") =>
      positiveInteger(runtime, key, config.agentRuntime[key], `agentRuntime.${key}`);
    config.agentRuntime.startupTimeoutMs = timeout("startupTimeoutMs");
    config.agentRuntime.commandTimeoutMs = timeout("commandTimeoutMs");
    config.agentRuntime.shutdownGraceMs = timeout("shutdownGraceMs");
  }
  // Checked after the block so an `executable` set with no `mode` (or the reverse)
  // is caught whether or not the operator wrote both keys.
  if (config.agentRuntime.mode === "rpc" && config.agentRuntime.executable === undefined) {
    fail(`"agentRuntime.executable" is required when "agentRuntime.mode" is "rpc"`);
  }
  /**
   * The sandbox is not a setting the agent obeys — it is a *replacement toolset*
   * this server builds and hands to the session (see the `sandboxedTools` branch
   * in index.ts). An RPC child builds its own tools from its own flags, and pi has
   * no path-confinement flag to forward, so the same config that confines the
   * embedded agent to one directory would leave the child with unrestricted read,
   * write and bash. Refusing the pair is the only honest answer: a sandbox that
   * silently does not apply is worse than no sandbox, because it is trusted.
   */
  if (config.agentRuntime.mode === "rpc" && config.sandbox !== undefined) {
    fail(
      `"sandbox" cannot be enforced when "agentRuntime.mode" is "rpc": the sandbox replaces this server's own file tools, ` +
        `and the RPC child builds its own. Use the embedded runtime, or confine the child by other means (a container, a dedicated user).`,
    );
  }

  config.tools = optionalStringArray(raw, "tools");
  config.noExtensions = optionalBoolean(raw, "noExtensions", false);
  config.extensionPaths = (optionalStringArray(raw, "extensionPaths") ?? []).map(resolve);
  config.userExtensionPaths = (optionalStringArray(raw, "userExtensionPaths") ?? []).map(resolve);
  if (raw.extensionLock !== undefined) config.extensionLock = optionalBoolean(raw, "extensionLock", false);
  config.extensionScripts = (optionalStringArray(raw, "extensionScripts") ?? []).map(resolve);
  config.noSkills = optionalBoolean(raw, "noSkills", false);
  config.skillPaths = (optionalStringArray(raw, "skillPaths") ?? []).map(resolve);
  config.userSkillPaths = (optionalStringArray(raw, "userSkillPaths") ?? []).map(resolve);
  config.noPromptTemplates = optionalBoolean(raw, "noPromptTemplates", false);
  config.promptPaths = (optionalStringArray(raw, "promptPaths") ?? []).map(resolve);
  config.allowedModels = optionalModelList(raw, "allowedModels");
  config.thinkingLevels = optionalThinkingLevels(raw, "thinkingLevels");

  const systemPrompt = optionalString(raw, "systemPrompt");
  const systemPromptFile = optionalString(raw, "systemPromptFile");
  if (systemPrompt !== undefined && systemPromptFile !== undefined) {
    fail(`"systemPrompt" and "systemPromptFile" are mutually exclusive`);
  }
  if (systemPromptFile !== undefined) {
    const resolvedFile = resolve(systemPromptFile);
    if (!fs.existsSync(resolvedFile)) fail(`systemPromptFile does not exist: ${resolvedFile}`);
    config.systemPrompt = fs.readFileSync(resolvedFile, "utf8");
  } else if (systemPrompt !== undefined) {
    config.systemPrompt = systemPrompt;
  }
  config.appendSystemPrompt = optionalStringArray(raw, "appendSystemPrompt") ?? [];
  config.webContext = optionalBoolean(raw, "webContext", true);
  config.offline = optionalBoolean(raw, "offline", false);
  if (raw.openBrowser !== undefined) config.openBrowser = optionalBoolean(raw, "openBrowser", true);
  const openIn = optionalString(raw, "openIn", "openIn");
  if (openIn !== undefined) {
    if (!OPEN_SHAPES.includes(openIn as OpenShape)) {
      fail(`"openIn" must be one of ${OPEN_SHAPES.join(", ")} (got "${openIn}")`);
    }
    config.openIn = openIn as OpenShape;
  }
  // Read only when present, or the tri-state collapses: a stored `false` is
  // indistinguishable from "not mentioned", and "not mentioned" is what lets
  // `offline` decide.
  if (raw.updateCheck !== undefined) config.updateCheck = optionalBoolean(raw, "updateCheck", true);
  if (raw.updateRegistry !== undefined) {
    const registry = optionalString(raw, "updateRegistry");
    if (registry !== undefined) {
      let parsed: URL;
      try {
        parsed = new URL(registry);
      } catch {
        fail(`"updateRegistry" must be a URL (got "${registry}")`);
      }
      // A registry that is not http(s) cannot be fetched, and finding that out at the
      // first check — in the background, silently — is the worst time to learn it.
      if (parsed!.protocol !== "http:" && parsed!.protocol !== "https:") {
        fail(`"updateRegistry" must be an http or https URL (got "${registry}")`);
      }
      config.updateRegistry = registry;
    }
  }

  if (raw.gitPath !== undefined) {
    const gitPath = optionalString(raw, "gitPath");
    // Only the shape is checked here. Whether it RUNS is a question for startup: this
    // function is synchronous, and an operator who mistyped a path should learn at
    // boot rather than the first time somebody opens a file tree.
    if (gitPath !== undefined) {
      if (gitPath.trim() === "") fail('"gitPath" must be a path to a git executable (got an empty string)');
      config.gitPath = gitPath;
    }
  }

  if (raw.server !== undefined) {
    const server = asObject(raw.server, "server");
    if (server.port !== undefined) {
      if (typeof server.port !== "number" || !Number.isInteger(server.port)) {
        fail(`"server.port" must be an integer`);
      }
      config.port = server.port;
    }
    const host = optionalString(server, "host");
    if (host) config.host = host;
    const origins = optionalStringArray(server, "allowedOrigins") ?? [];
    for (const origin of origins) {
      if (!/^https?:\/\/[^/]+$/.test(origin)) {
        fail(`"server.allowedOrigins" entries must be exact origins like "https://app.example.com" (got "${origin}")`);
      }
    }
    config.allowedOrigins = origins;
    config.token = optionalString(server, "token");
  }

  if (raw.files !== undefined) {
    const files = asObject(raw.files, "files");
    if (files.watch !== undefined) {
      if (typeof files.watch !== "boolean") {
        fail(`"files.watch" must be a boolean`);
      }
      config.files.watch = files.watch;
    }
  }

  if (raw.pdf !== undefined) {
    const pdf = asObject(raw.pdf, "pdf");
    if (pdf.maxBytes !== undefined) {
      if (typeof pdf.maxBytes !== "number" || !Number.isInteger(pdf.maxBytes) || pdf.maxBytes <= 0) {
        fail(`"pdf.maxBytes" must be a positive integer (bytes)`);
      }
      config.pdf.maxBytes = pdf.maxBytes;
    }
  }

  if (raw.docx !== undefined) {
    const docx = asObject(raw.docx, "docx");
    if (docx.maxBytes !== undefined) {
      if (typeof docx.maxBytes !== "number" || !Number.isInteger(docx.maxBytes) || docx.maxBytes <= 0) {
        fail(`"docx.maxBytes" must be a positive integer (bytes)`);
      }
      config.docx.maxBytes = docx.maxBytes;
    }
  }

  if (raw.xlsx !== undefined) {
    const xlsx = asObject(raw.xlsx, "xlsx");
    if (xlsx.maxBytes !== undefined) {
      if (typeof xlsx.maxBytes !== "number" || !Number.isInteger(xlsx.maxBytes) || xlsx.maxBytes <= 0) {
        fail(`"xlsx.maxBytes" must be a positive integer (bytes)`);
      }
      config.xlsx.maxBytes = xlsx.maxBytes;
    }
  }

  if (raw.pptx !== undefined) {
    const pptx = asObject(raw.pptx, "pptx");
    if (pptx.maxBytes !== undefined) {
      if (typeof pptx.maxBytes !== "number" || !Number.isInteger(pptx.maxBytes) || pptx.maxBytes <= 0) {
        fail(`"pptx.maxBytes" must be a positive integer (bytes)`);
      }
      config.pptx.maxBytes = pptx.maxBytes;
    }
  }

  if (raw.structuredExchange !== undefined) {
    const structuredExchange = asObject(raw.structuredExchange, "structuredExchange");
    if (structuredExchange.maxBytes !== undefined) {
      if (
        typeof structuredExchange.maxBytes !== "number" ||
        !Number.isInteger(structuredExchange.maxBytes) ||
        structuredExchange.maxBytes <= 0
      ) {
        fail(`"structuredExchange.maxBytes" must be a positive integer (bytes)`);
      }
      // Clamped rather than refused, matching what `effectiveLimit` already does
      // with the contract's byte bound: a deployment may only be more careful than
      // the published ceiling, never less. Without this the server would serve a
      // document the browser's own bound then refuses, and the reader would be
      // shown raw JSON with nothing said about why.
      config.structuredExchange.maxBytes = Math.min(structuredExchange.maxBytes, STRUCTURED_EXCHANGE_BYTES_CEILING);
    }
  }

  if (raw.branding !== undefined) {
    const branding = asObject(raw.branding, "branding");
    const defaultTheme = optionalString(branding, "defaultTheme");
    if (defaultTheme !== undefined && !THEMES.includes(defaultTheme as Theme)) {
      fail(`"branding.defaultTheme" must be one of ${THEMES.join(", ")}`);
    }
    config.branding = {
      title: optionalString(branding, "title"),
      welcome: optionalString(branding, "welcome"),
      accentColor: optionalString(branding, "accentColor"),
      defaultTheme: defaultTheme as Theme | undefined,
      allowThemeToggle: optionalBoolean(branding, "allowThemeToggle", true),
    };
  }

  if (raw.embed !== undefined) {
    const embed = asObject(raw.embed, "embed");
    const workspaceControls = optionalString(embed, "workspaceControls", "embed.workspaceControls");
    if (workspaceControls !== undefined) {
      if (!EMBED_WORKSPACE_CONTROLS.includes(workspaceControls as EmbedWorkspaceControls)) {
        fail(`"embed.workspaceControls" must be one of ${EMBED_WORKSPACE_CONTROLS.join(", ")} (got "${workspaceControls}")`);
      }
      config.embed.workspaceControls = workspaceControls as EmbedWorkspaceControls;
    }
  }

  if (raw.terminal !== undefined) {
    const terminal = asObject(raw.terminal, "terminal");
    const shell = optionalString(terminal, "shell", "terminal.shell");
    config.terminal = {
      enabled: optionalBoolean(terminal, "enabled", false),
      shell: shell !== undefined && (shell.includes("/") || shell.includes("\\")) ? resolve(shell) : shell,
      shellArgs: optionalStringArray(terminal, "shellArgs"),
    };
  }
  if (flags.terminal !== undefined) {
    config.terminal.enabled = flags.terminal;
  } else if (env.PI_OUTPOST_TERMINAL !== undefined) {
    const val = env.PI_OUTPOST_TERMINAL.toLowerCase();
    config.terminal.enabled = val === "1" || val === "true";
  }

  applyRuntime(config, flags, env);
  requireTokenOffLoopback(config);

  // `quiet` is for the validation load in persistEditableSettings: it reads a
  // temporary file that is not the running configuration, and announcing it as
  // one would name a path that exists for a few milliseconds.
  const announce = (line: string) => {
    if (!options.quiet) console.log(line);
  };
  announce(`[config] loaded ${filePath}`);
  // The runtime decides what actually executes on this host, so say it every start —
  // with the command redacted, since an argument vector can carry an API key.
  announce(
    config.agentRuntime.mode === "rpc"
      ? `[config] agent runtime rpc: ${redactRpcCommand(config.agentRuntime)}`
      : `[config] agent runtime embedded`,
  );
  if (config.terminal.enabled) {
    announce(`[config] terminal enabled`);
  }
  // The sandbox is the security boundary, and it is now reachable from a flag and a
  // variable as well as the file — so state what is actually enforced, every start.
  if (config.sandbox) {
    const { root, allowWrite, writableRoot, allowBash } = config.sandbox;
    const write = allowWrite ? (writableRoot ?? root) : "none";
    announce(`[config] sandbox root=${root} write=${write} bash=${allowBash}`);
  } else {
    announce(`[config] no sandbox: full toolset in ${config.cwd}`);
  }
  return config;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

/**
 * Off loopback, the agent's bash and edit tools are reachable by anything that can
 * route to the host. The WebSocket accepts connections with no Origin header (a
 * local process already has shell access, so the check would be theatre), and an
 * unset token makes every request valid — so a bind address alone must not be able
 * to hand an unauthenticated LAN the agent. Now that `--host` and PI_OUTPOST_HOST
 * exist, that address is one word away; the token stops being advice.
 */
export function requireTokenOffLoopback(config: AppConfig): void {
  if (LOOPBACK.has(config.host) || config.token) return;
  fail(
    `refusing to listen on ${config.host} without an auth token: the agent's tools would be ` +
      `reachable by anyone who can route to this host. Set PI_OUTPOST_TOKEN (or "server.token") ` +
      `to a long random secret, e.g. \`openssl rand -hex 32\`.`,
  );
}

/**
 * Both layers above the file, for the two directories — applied early, since the
 * sandbox's default root is the agent's cwd, and a `--cwd` landing after it would
 * leave the sandbox pinned to the directory the user just overrode.
 *
 * Relative paths here resolve against the current directory, like any other path a
 * user types; paths *inside* a config file resolve against that file, which is why
 * these do not go through the file's `resolve`.
 */
export function applyDirectories(config: AppConfig, flags: CliOptions, env: NodeJS.ProcessEnv): void {
  if (env.PI_OUTPOST_CWD) config.cwd = path.resolve(env.PI_OUTPOST_CWD);
  if (env.PI_OUTPOST_AGENT_DIR) config.agentDir = path.resolve(env.PI_OUTPOST_AGENT_DIR);
  if (flags.cwd !== undefined) config.cwd = path.resolve(flags.cwd);
  if (flags.agentDir !== undefined) config.agentDir = path.resolve(flags.agentDir);
}

/**
 * Port, host and token: environment beats the file, flags beat the environment.
 * The environment winning is what lets a container set the port and be obeyed
 * rather than silently overridden by a baked-in file — and it makes the token's
 * long-standing behaviour (the secret stays off disk) the rule, not an exception.
 * There is deliberately no token flag: argv is readable by any process listing.
 */
export function applyRuntime(config: AppConfig, flags: CliOptions, env: NodeJS.ProcessEnv): void {
  // Same precedence as the rest: file, then environment, then flag. PI_OFFLINE is
  // the SDK's own variable — honouring it here keeps one spelling for both layers.
  if (env.PI_OFFLINE !== undefined && env.PI_OFFLINE !== "") config.offline = true;
  if (flags.offline) config.offline = true;

  // Bare PORT is honoured too: PaaS hosts inject it, and it costs one `??`.
  const port = env.PI_OUTPOST_PORT ?? env.PORT;
  if (port !== undefined && port !== "") {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      fail(`PI_OUTPOST_PORT must be a port number (got "${port}")`);
    }
    config.port = parsed;
  }
  if (env.PI_OUTPOST_HOST) config.host = env.PI_OUTPOST_HOST;

  const token = env.PI_OUTPOST_TOKEN;
  if (token !== undefined) {
    if (token === "") fail(`PI_OUTPOST_TOKEN must not be empty`);
    config.token = token;
  }

  if (flags.openIn !== undefined) config.openIn = flags.openIn;
  if (flags.port !== undefined) config.port = flags.port;
  if (flags.host !== undefined) config.host = flags.host;
}

// --- Persisting what the interface changed ---------------------------------------------

/**
 * The runtime settings the Settings menu may change, in the shape the protocol
 * carries them. Deliberately narrow: this is the projection of `AppConfig` that
 * an authenticated browser client is allowed to write back to disk.
 */
export interface EditableSettings {
  sandbox?: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string };
  /**
   * Skill paths the interface manages (absolute). Absent leaves them untouched.
   * The operator's `skillPaths` are never written here and never removed.
   */
  userSkillPaths?: string[];
  /**
   * Extension paths the interface manages (absolute). Absent leaves them untouched.
   * The operator's `extensionPaths` are never written here and never removed.
   */
  userExtensionPaths?: string[];
  /** Projects held open (absolute, resolved). Absent leaves them untouched. */
  openProjects?: string[];
}

/**
 * Every explicit skill path the session should load: the deployment's, then the
 * ones added from Settings. Order matters — the loader keeps the first skill it
 * meets under a given name, so the configuration file wins a name collision
 * against a directory someone added from the interface.
 */
export function allSkillPaths(config: AppConfig): string[] {
  return [...config.skillPaths, ...config.userSkillPaths];
}

/**
 * Every explicit extension path the session should load: the deployment's, then
 * the ones added from Settings. Same order and same reason as `allSkillPaths`.
 */
export function allExtensionPaths(config: AppConfig): string[] {
  return [...config.extensionPaths, ...config.userExtensionPaths];
}

/** A settings write that never happened — the loaded configuration file is unchanged. */
export class ConfigWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigWriteError";
  }
}

/**
 * Write accepted settings back to the configuration file the server loaded, so a
 * restart finds them.
 *
 * Three properties the callers depend on:
 *
 * - **Unrelated keys survive.** The file is re-read and the managed keys are
 *   replaced in the parsed object, rather than a fresh object being serialized
 *   from `AppConfig` — which would silently drop everything the loader turns
 *   into defaults (`branding`, `server`, an operator's comments-as-keys) and
 *   rewrite every relative path as absolute.
 * - **The merged file is validated before it replaces anything.** A configuration
 *   that cannot load is a server that will not start on next boot, and the user
 *   who caused it has closed the settings menu by then. The candidate is loaded
 *   through `loadConfig` itself — not a lookalike check — so the boot that matters
 *   is the one that was rehearsed.
 * - **The replacement is atomic.** The candidate is written beside the target and
 *   renamed over it, so a crash mid-write leaves the previous file, not half of
 *   the new one.
 *
 * Paths are written absolute: they were chosen against the server's filesystem,
 * and a relative path in the file means "relative to the file", which is a
 * different place as soon as the config moves.
 */
export function persistEditableSettings(
  config: AppConfig,
  update: EditableSettings,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = config.configFile;
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(target, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`its top level is not an object`);
    }
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    throw new ConfigWriteError(
      `cannot read ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (update.sandbox) {
    const existing =
      typeof raw.sandbox === "object" && raw.sandbox !== null && !Array.isArray(raw.sandbox)
        ? { ...(raw.sandbox as Record<string, unknown>) }
        : {};
    // `root` is always written, even when it equals the current effective value:
    // an absent root falls back to `cwd`, which PI_OUTPOST_CWD and --cwd can move.
    // Writing it is what makes an accepted Settings change outrank those on the
    // next start (see ConfigPrecedence) instead of quietly following them.
    existing.root = path.resolve(update.sandbox.root);
    existing.allowWrite = update.sandbox.allowWrite;
    existing.allowBash = update.sandbox.allowBash;
    if (update.sandbox.writableRoot === undefined) delete existing.writableRoot;
    else existing.writableRoot = path.resolve(update.sandbox.writableRoot);
    raw.sandbox = existing;
  }
  // Written under its own key: `skillPaths` belongs to whoever wrote the file, and
  // an apply must never be able to drop one of theirs.
  if (update.userSkillPaths) raw.userSkillPaths = update.userSkillPaths.map((p) => path.resolve(p));
  // Same reasoning one kind over: `extensionPaths` and `extensionLock` belong to
  // whoever wrote the file, and neither is read or rewritten here. Only the keys
  // named in this function are touched; everything else survives the write as it was.
  if (update.userExtensionPaths) {
    raw.userExtensionPaths = update.userExtensionPaths.map((p) => path.resolve(p));
  }
  // The last project cannot be closed, so an empty array never reaches here — but
  // it is written rather than deleted if it does, since "no projects open" and "this
  // key was never set" mean the same thing to the loader.
  if (update.openProjects) raw.openProjects = update.openProjects.map((p) => path.resolve(p));

  const serialized = `${JSON.stringify(raw, null, 2)}\n`;
  const candidate = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    // Keep the target's permissions: a config file holding a token is often 0600,
    // and a rename carries the *candidate's* mode onto it.
    let mode: number | undefined;
    try {
      mode = fs.statSync(target).mode & 0o777;
    } catch {
      mode = undefined;
    }
    fs.writeFileSync(candidate, serialized, mode === undefined ? undefined : { mode });
    // Rehearse the next boot. `--config` outranks every other way of finding a
    // file, so this loads the candidate and nothing else.
    loadConfig(config.cwd, { config: candidate }, env, { quiet: true });
    fs.renameSync(candidate, target);
  } catch (error) {
    try {
      fs.rmSync(candidate, { force: true });
    } catch {
      // The stale candidate is noise, not a failure to report over the one below.
    }
    throw new ConfigWriteError(
      `cannot save ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
