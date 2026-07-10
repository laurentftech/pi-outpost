/**
 * Standalone configuration for pi-interface.
 *
 * Loaded from PI_INTERFACE_CONFIG (path to a JSON file) or
 * `pi-interface.config.json` in the launch directory. Everything is optional:
 * without a config file the server behaves like a plain local pi (user's
 * ~/.pi/agent config, full toolset, no branding).
 *
 * Relative paths in the file are resolved against the config file's directory.
 */
import fs from "node:fs";
import path from "node:path";
import { THEMES, type Theme } from "@pi-interface/shared";

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
   * Disable when embedding pi-interface in a host app that drives the theme
   * itself (e.g. by posting `{ type: "pi-interface:set-theme", theme }`).
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
}

export interface AppConfig {
  /** Agent working directory. */
  cwd: string;
  /** Own config dir (models/auth/settings/sessions). Default: ~/.pi/agent. */
  agentDir?: string;
  /** File-scoped sandbox. When set, built-in tools are replaced by scoped ones. */
  sandbox?: SandboxConfig;
  /** Tool name allowlist (non-sandbox mode), e.g. ["read","grep","find","ls"]. */
  tools?: string[];
  /** Skip loading extensions entirely. */
  noExtensions: boolean;
  /** Explicit extension paths to load (in addition to defaults). */
  extensionPaths: string[];
  /**
   * Skip loading skills entirely. Needed for real isolation even with a custom
   * agentDir: skills also auto-load from ~/.agents/skills (hardcoded to the real
   * home directory, not agentDir) and from .agents/skills walked up from cwd to
   * the git root — neither is scoped by agentDir.
   */
  noSkills: boolean;
  /**
   * Skip auto-discovering prompt templates entirely (both agentDir and the
   * project's cwd/.pi/prompts). Like noSkills, cwd doubles as both the
   * agent's working directory and a resource-discovery root, so pointing
   * cwd at a real project pulls in that project's .pi/prompts too.
   */
  noPromptTemplates: boolean;
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
  port: number;
  host: string;
  /** Extra exact Origins allowed on the WebSocket (for embedding in another app). */
  allowedOrigins: string[];
  branding: BrandingConfig;
}

function fail(message: string): never {
  throw new Error(`[config] ${message}`);
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") fail(`"${key}" must be a non-empty string`);
  return value;
}

function optionalBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(`"${key}" must be a boolean`);
  return value;
}

function optionalStringArray(raw: Record<string, unknown>, key: string): string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fail(`"${key}" must be an array of strings`);
  }
  return value as string[];
}

function optionalModelList(
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

function asObject(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`"${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

export function loadConfig(baseCwd: string): AppConfig {
  const config: AppConfig = {
    cwd: baseCwd,
    noExtensions: false,
    extensionPaths: [],
    noSkills: false,
    noPromptTemplates: false,
    appendSystemPrompt: [],
    port: Number(process.env.PORT ?? 3141),
    host: "127.0.0.1",
    allowedOrigins: [],
    branding: {},
  };

  const explicitPath = process.env.PI_INTERFACE_CONFIG;
  const filePath = explicitPath ?? path.join(baseCwd, "pi-interface.config.json");
  if (!fs.existsSync(filePath)) {
    if (explicitPath) fail(`config file not found: ${explicitPath}`);
    return config;
  }

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

  if (raw.sandbox !== undefined) {
    const sandbox = asObject(raw.sandbox, "sandbox");
    const root = optionalString(sandbox, "root");
    const resolvedRoot = root ? resolve(root) : config.cwd;
    const allowWrite = optionalBoolean(sandbox, "allowWrite", false);
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
      allowBash: optionalBoolean(sandbox, "allowBash", false),
    };
    if (!fs.existsSync(config.sandbox.root)) {
      fail(`sandbox.root does not exist: ${config.sandbox.root}`);
    }
    if (config.sandbox.writableRoot && !fs.existsSync(config.sandbox.writableRoot)) {
      fail(`sandbox.writableRoot does not exist: ${config.sandbox.writableRoot}`);
    }
  }

  config.tools = optionalStringArray(raw, "tools");
  config.noExtensions = optionalBoolean(raw, "noExtensions", false);
  config.extensionPaths = (optionalStringArray(raw, "extensionPaths") ?? []).map(resolve);
  config.noSkills = optionalBoolean(raw, "noSkills", false);
  config.noPromptTemplates = optionalBoolean(raw, "noPromptTemplates", false);
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

  console.log(`[config] loaded ${filePath}`);
  return config;
}
