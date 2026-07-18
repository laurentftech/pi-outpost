/**
 * Standalone configuration for pi-outpost.
 *
 * One rule, everywhere: **flag > environment variable > config file > default**.
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
import { THEMES, type Theme } from "@pi-outpost/shared";

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
}

export interface AppConfig {
  /** The file this configuration was read from — the one of four locations that won. */
  configFile: string;
  /** Agent working directory. */
  cwd: string;
  /** Own config dir (models/auth/settings/sessions). Default: ~/.pi/agent. */
  agentDir?: string;
  /** File-scoped sandbox. When set, built-in tools are replaced by scoped ones. */
  sandbox?: SandboxConfig;
  /** Which sandbox fields the user's settings menu may not change. */
  sandboxLocks?: SandboxLocks;
  /** Tool name allowlist (non-sandbox mode), e.g. ["read","grep","find","ls"]. */
  tools?: string[];
  /** Skip loading extensions entirely. */
  noExtensions: boolean;
  /** Explicit extension paths to load (in addition to defaults). */
  extensionPaths: string[];
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
  /** Explicit skill paths to load (SKILL.md files or skill directories). */
  skillPaths: string[];
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
}

/** Launch-time options from the command line — the top of the precedence chain. */
export interface CliOptions {
  config?: string;
  profile?: string;
  cwd?: string;
  agentDir?: string;
  port?: number;
  host?: string;
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

export function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") fail(`"${key}" must be a non-empty string`);
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
): AppConfig {
  const filePath = findConfigFile(launchDir, flags, env);

  const config: AppConfig = {
    configFile: filePath,
    cwd: launchDir,
    noExtensions: false,
    extensionPaths: [],
    extensionScripts: [],
    noSkills: false,
    skillPaths: [],
    noPromptTemplates: false,
    promptPaths: [],
    appendSystemPrompt: [],
    webContext: true,
    port: 3141,
    host: "127.0.0.1",
    allowedOrigins: [],
    branding: {},
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
        ...(optionalStringArray(raw, "promptPaths") ?? []).map(resolve),
        ...(optionalStringArray(raw, "extensionPaths") ?? []).map(resolve),
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

  if (raw.sandboxLocks !== undefined) {
    const locks = asObject(raw.sandboxLocks, "sandboxLocks");
    config.sandboxLocks = {
      root: optionalBoolean(locks, "root", false),
      allowWrite: optionalBoolean(locks, "allowWrite", false),
      allowBash: optionalBoolean(locks, "allowBash", false),
      writableRoot: optionalBoolean(locks, "writableRoot", false),
    };
  }

  config.tools = optionalStringArray(raw, "tools");
  config.noExtensions = optionalBoolean(raw, "noExtensions", false);
  config.extensionPaths = (optionalStringArray(raw, "extensionPaths") ?? []).map(resolve);
  config.extensionScripts = (optionalStringArray(raw, "extensionScripts") ?? []).map(resolve);
  config.noSkills = optionalBoolean(raw, "noSkills", false);
  config.skillPaths = (optionalStringArray(raw, "skillPaths") ?? []).map(resolve);
  config.noPromptTemplates = optionalBoolean(raw, "noPromptTemplates", false);
  config.promptPaths = (optionalStringArray(raw, "promptPaths") ?? []).map(resolve);
  config.allowedModels = optionalModelList(raw, "allowedModels");

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

  applyRuntime(config, flags, env);
  requireTokenOffLoopback(config);

  console.log(`[config] loaded ${filePath}`);
  // The sandbox is the security boundary, and it is now reachable from a flag and a
  // variable as well as the file — so state what is actually enforced, every start.
  if (config.sandbox) {
    const { root, allowWrite, writableRoot, allowBash } = config.sandbox;
    const write = allowWrite ? (writableRoot ?? root) : "none";
    console.log(`[config] sandbox root=${root} write=${write} bash=${allowBash}`);
  } else {
    console.log(`[config] no sandbox: full toolset in ${config.cwd}`);
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

  if (flags.port !== undefined) config.port = flags.port;
  if (flags.host !== undefined) config.host = flags.host;
}
