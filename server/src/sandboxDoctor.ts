/**
 * `pi-outpost sandbox doctor` and the agent's `sandbox_doctor` tool (issue #573): the sandbox's own
 * state, read-only, paste-safe — identity (which backend/tier is active), the policy by class, the
 * link/junction resolution table, the env filter as names grouped by prefix, the running relays and
 * carried seeds, a probe battery whose results name the responsible layer, and the last recorded
 * refusals (the per-project rules store keeps the last 200, `sandboxRules.ts`).
 *
 * Paste-safe by construction: environment *values* never enter a snapshot — the filter section lists
 * key names only, grouped; refusals carry targets (host, directory), never file contents or
 * credentials. `assertPasteSafe` is what the tests use on a fixture full of secrets.
 */
import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SandboxConfig } from "./config.ts";
import { startedRegistryRelay } from "./registryRelay.ts";
import { rulesStoreFor, type RecordedRefusal } from "./sandboxRules.ts";
import {
  activeSigningShim,
  confinedEnvironment,
  defaultSandboxCache,
  mxcEnumerateLevel,
  mxcTerminalConfig,
  readableSearchEntries,
  runnerKind,
  siblingsToDeny,
  toolInstallations,
  windowsToolchains,
  type MxcTerminalConfig,
} from "./terminalSandbox.ts";

// ── Decision log ─────────────────────────────────────────────────────────────
// The per-project rules store already records every refusal (cap 200, with count and lastSeen);
// the doctor reads it rather than keeping a second log that could drift from what the agent was told.

export type { RecordedRefusal };

/** The recorded refusals of one project, newest last — the doctor's decision log. */
export async function decisionLog(agentDir: string, root: string, limit = 200): Promise<RecordedRefusal[]> {
  const refusals = await rulesStoreFor(agentDir, root).refusals();
  return refusals.slice(-limit);
}

// ── Snapshot types ───────────────────────────────────────────────────────────

export interface DoctorIdentity {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  runner?: string;
  runnerKind?: string;
  /** MXC on Windows: the enumeration level this host proved (0 full, 1 tools' ancestors, 2 none). */
  mxcEnumerateLevel?: 0 | 1 | 2;
  sandboxRoot?: string;
  generatedAt: string;
}

export interface PolicySummary {
  /** "mxc-processcontainer-windows", or another backend's kind with an unavailableReason. */
  backend: string;
  unavailableReason?: string;
  readwritePaths: string[];
  readonlyPaths: string[];
  denied: { path: string; reasonClass: string }[];
  enumeratePaths: string[];
}

export interface LinkEntry {
  link: string;
  target: string;
  targetReadable: boolean;
}

export interface EnvFilterGroup {
  /** The variable prefix ("UV_"), or "(other)". Names only — never values. */
  group: string;
  dropped: number;
  names: string[];
}

export interface RelayEntry {
  name: string;
  running: boolean;
  port?: number;
  detail: string;
}

export interface ProbeResult {
  name: string;
  status: "ok" | "warn" | "fail" | "skipped";
  /** The layer responsible for the result: policy, filesystem, network, env, relay. */
  layer: string;
  detail: string;
}

export interface SandboxSnapshot {
  identity: DoctorIdentity;
  policy: PolicySummary;
  links: LinkEntry[];
  network: {
    proxy: boolean;
    internetOpen: boolean;
    allowedHosts?: string[];
    privateNetwork: boolean;
    hostLoopback: boolean;
  };
  envFilter: EnvFilterGroup[];
  relays: RelayEntry[];
  seeds: string[];
  probes: ProbeResult[];
  decisions: RecordedRefusal[];
}

export interface DoctorInput {
  version: string;
  cwd: string;
  sandbox: SandboxConfig | undefined;
  agentDir?: string;
  configFile?: string;
  serverEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Run the confined probe battery (host CLI only). Off for the agent tool. */
  probes?: ProbeResult[];
  now?: () => Date;
}

// ── Policy, by class ─────────────────────────────────────────────────────────

type MxcRequest = MxcTerminalConfig & { processContainer?: { filesystem?: { enumeratePaths?: string[] } } };

/** The MXC request a command gets for this sandbox, built the way `confinedBash` builds it. */
function policyRequestFor(sandbox: SandboxConfig, root: string, agentDir: string | undefined, configFile: string | undefined, serverEnv: NodeJS.ProcessEnv, platform: NodeJS.Platform): MxcRequest {
  const env = confinedEnvironment(serverEnv, {
    root,
    tmp: path.join(os.tmpdir(), "pi-outpost-doctor"),
    shell: sandbox.bashShell ?? "",
    platform,
    containerProfileInTmp: true,
  });
  return mxcTerminalConfig({
    root,
    allowWrite: sandbox.allowWrite,
    ...(sandbox.writableRoot ? { writableRoot: sandbox.writableRoot } : {}),
    tmp: env.TMPDIR ?? path.join(os.tmpdir(), "pi-outpost-doctor"),
    shell: sandbox.bashShell ?? "",
    shellArgs: [],
    cwd: root,
    env,
    siblings: siblingsToDeny(root),
    searchPath: env.PATH,
    ...(serverEnv.USERPROFILE ? { home: serverEnv.USERPROFILE } : {}),
    ...(agentDir ? { agentDir } : {}),
    ...(configFile ? { configFile } : {}),
    readOnlyInside: sandbox.gitWritable ? [] : [path.join(root, ".git")],
    enumerateAncestors: true,
    enumerateGrants: true,
  }) as MxcRequest;
}

/** The request summarized by class, with each denied path's reason class. */
function summarizePolicy(request: MxcRequest, siblings: string[], agentDir: string | undefined, configFile: string | undefined): PolicySummary {
  const fs = request.filesystem;
  const enumeratePaths = request.processContainer?.filesystem?.enumeratePaths ?? [];
  const enumerated = new Set(enumeratePaths.map((p) => p.toLowerCase()));
  const siblingSet = new Set(siblings.map((p) => p.toLowerCase()));
  const denied = fs.deniedPaths.map((p) => ({
    path: p,
    reasonClass:
      agentDir !== undefined && p.toLowerCase() === agentDir.toLowerCase()
        ? "agent directory (the keys)"
        : configFile !== undefined && p.toLowerCase() === configFile.toLowerCase()
          ? "the configuration file"
          : siblingSet.has(p.toLowerCase())
            ? "sibling of the path to the root"
            : enumerated.has(p.toLowerCase())
              ? "on the way down (enumerated)"
              : "beside the way down",
  }));
  return { backend: "mxc-processcontainer-windows", readwritePaths: fs.readwritePaths, readonlyPaths: fs.readonlyPaths, denied, enumeratePaths };
}

/** Every link on the way down the policy resolved, with its target's readability. */
function linkTableFor(request: MxcRequest, serverEnv: NodeJS.ProcessEnv, root: string): LinkEntry[] {
  const readable = new Set(request.filesystem.readonlyPaths.map((p) => p.toLowerCase()));
  const tools = [...readableSearchEntries(serverEnv.PATH, { home: serverEnv.USERPROFILE }), ...toolInstallations({ root, searchPath: serverEnv.PATH, home: serverEnv.USERPROFILE })];
  const seen = new Set<string>();
  const links: LinkEntry[] = [];
  for (const tool of tools) {
    const key = tool.toLowerCase().replace(/[\\/]+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    let target: string | undefined;
    try {
      const stats = lstatSync(tool);
      if (stats.isSymbolicLink() || (stats.isDirectory() && realpathSync(tool).toLowerCase() !== key)) target = realpathSync(tool);
    } catch {
      target = undefined;
    }
    if (target === undefined) continue;
    links.push({ link: tool, target, targetReadable: readable.has(target.toLowerCase().replace(/[\\/]+$/, "")) });
  }
  return links;
}

// ── Env filter: names only ───────────────────────────────────────────────────

/** The variables the confined environment drops, grouped by prefix — names, never values. */
export function envFilterGroups(serverEnv: NodeJS.ProcessEnv, root: string, shell: string, platform: NodeJS.Platform): EnvFilterGroup[] {
  const confined = confinedEnvironment(serverEnv, { root, tmp: path.join(os.tmpdir(), "pi-outpost-doctor"), shell, platform, containerProfileInTmp: platform === "win32" });
  const groups = new Map<string, string[]>();
  for (const name of Object.keys(serverEnv)) {
    if (name in confined) continue;
    const prefix = /^[A-Z][A-Z0-9]*_/.exec(name)?.[0] ?? "(other)";
    const group = prefix === "(other)" ? prefix : `${prefix}*`;
    const list = groups.get(group) ?? [];
    list.push(name);
    groups.set(group, list);
  }
  return [...groups.entries()].map(([group, names]) => ({ group, dropped: names.length, names: names.sort() })).sort((a, b) => a.group.localeCompare(b.group));
}

// ── Collector ────────────────────────────────────────────────────────────────

export async function collectSandboxSnapshot(input: DoctorInput): Promise<SandboxSnapshot> {
  const serverEnv = input.serverEnv ?? process.env;
  const platform = input.platform ?? process.platform;
  const sandbox = input.sandbox;
  const root = sandbox ? await resolveRoot(sandbox.root) : input.cwd;
  const kind = sandbox?.bashRunner ? runnerKind(sandbox.bashRunner) : undefined;

  let policy: PolicySummary;
  let links: LinkEntry[] = [];
  if (platform === "win32" && sandbox?.bashRunner && sandbox.bashImage === undefined && kind === "mxc") {
    const request = policyRequestFor(sandbox, root, input.agentDir, input.configFile, serverEnv, platform);
    policy = summarizePolicy(request, siblingsToDeny(root), input.agentDir, input.configFile);
    links = linkTableFor(request, serverEnv, root);
  } else {
    policy = {
      backend: kind ?? "none",
      unavailableReason: kind === undefined ? "no sandbox runner is configured for this project" : `the ${kind} backend's policy is not introspectable by doctor v1`,
      readwritePaths: [],
      readonlyPaths: [],
      denied: [],
      enumeratePaths: [],
    };
  }

  const registry = startedRegistryRelay();
  const signingShim = activeSigningShim();
  const cacheDir = sandbox?.cacheDir ?? defaultSandboxCache(serverEnv);
  const toolchains = windowsToolchains({ cacheDir, serverEnv, home: serverEnv.USERPROFILE ?? os.homedir() });

  return {
    identity: {
      version: input.version,
      platform,
      arch: input.arch ?? process.arch,
      runner: sandbox?.bashRunner,
      runnerKind: kind,
      ...(platform === "win32" && kind === "mxc" ? { mxcEnumerateLevel: mxcEnumerateLevel() } : {}),
      sandboxRoot: sandbox ? root : undefined,
      generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    },
    policy,
    links,
    network: {
      proxy: sandbox?.allowedHosts !== undefined,
      internetOpen: sandbox?.allowedHosts === undefined,
      ...(sandbox?.allowedHosts !== undefined ? { allowedHosts: sandbox.allowedHosts } : {}),
      privateNetwork: sandbox?.privateNetwork === true,
      hostLoopback: sandbox?.hostLoopback !== false,
    },
    envFilter: sandbox?.bashRunner ? envFilterGroups(serverEnv, root, sandbox.bashShell ?? "", platform) : [],
    relays: [
      { name: "registry-relay", running: registry !== undefined, ...(registry ? { port: Number(/^http:\/\/127\.0\.0\.1:(\d+)$/.exec((await registry).url)?.[1]) || undefined } : {}), detail: registry ? `serves the carried registries' credentials at ${(await registry).url}` : "not started (no credential-bearing configuration carried)" },
      { name: "signing-relay", running: signingShim !== undefined, detail: signingShim ? `shim ${signingShim}` : "not started (no signed commits asked for, or no signer on the host)" },
    ],
    seeds: (toolchains.carried ?? []).map((carried) => carried.name),
    probes: input.probes ?? [],
    decisions: input.agentDir ? await decisionLog(input.agentDir, root) : [],
  };
}

async function resolveRoot(root: string): Promise<string> {
  try {
    const fs = await import("node:fs/promises");
    return await fs.realpath(root);
  } catch {
    return path.resolve(root);
  }
}

// ── Probe battery (host CLI, confined where a runner is available) ───────────

import { confinedBashOperations } from "./confinedBash.ts";
// Runtime-only import; the cycle sandbox.ts ↔ sandboxDoctor.ts is intentional (sandbox.ts imports the tool factory).
import { agentBashOptions } from "./sandbox.ts";

const PROBE_TOOLS = ["node", "npm", "python", "uv", "git"] as const;

/**
 * The battery, each result naming its layer: PATH resolution of the common tools (resolved / not found /
 * found-but-denied), a scratch write in the root, the full-path vs by-name asymmetry (the #572 symptom),
 * and relay reachability. Skipped with the reason when no runner can confine here.
 */
export async function runDoctorProbes(input: { sandbox: SandboxConfig | undefined; cwd: string; agentDir?: string; configFile?: string }): Promise<ProbeResult[]> {
  const platform = process.platform;
  if (!input.sandbox?.bashRunner) return [{ name: "probes", status: "skipped", layer: "policy", detail: "no sandbox runner is configured for this project" }];
  let ops;
  try {
    ops = confinedBashOperations(await agentBashOptions(input.sandbox, { agentDir: input.agentDir, configFile: input.configFile }));
  } catch (error) {
    return [{ name: "probes", status: "skipped", layer: "policy", detail: `the runner cannot start here: ${error instanceof Error ? error.message : String(error)}` }];
  }
  const win = platform === "win32";
  const run = async (command: string): Promise<{ exitCode: number | null; output: string }> => {
    let output = "";
    let exitCode: number | null = null;
    try {
      ({ exitCode } = await ops.exec(command, input.cwd, { onData: (d) => (output += d.toString()), timeout: 30_000 }));
    } catch (error) {
      output += String(error instanceof Error ? error.message : error);
    }
    return { exitCode, output };
  };
  const results: ProbeResult[] = [];
  const resolved: Record<string, string> = {};
  for (const tool of PROBE_TOOLS) {
    const command = win ? `Get-Command ${tool} | ForEach-Object Source` : `command -v ${tool}`;
    const { exitCode, output } = await run(command);
    if (output.includes("[pi-outpost]") && /refused|denied/i.test(output)) {
      results.push({ name: `PATH ${tool}`, status: "fail", layer: "policy", detail: "found on PATH but the sandbox refused it" });
    } else if (exitCode === 0 && output.trim() !== "") {
      const at = output.trim().split(/\r?\n/)[0]!;
      resolved[tool] = at;
      results.push({ name: `PATH ${tool}`, status: "ok", layer: "filesystem", detail: `resolved to ${at}` });
    } else {
      results.push({ name: `PATH ${tool}`, status: "warn", layer: "env", detail: "not found on the confined PATH" });
    }
  }
  // Scratch write in the root.
  const scratch = win ? `New-Item -ItemType File -Path (Join-Path $PWD '.pi-doctor-probe') -Value x | Out-Null; Remove-Item .pi-doctor-probe` : `touch .pi-doctor-probe && rm .pi-doctor-probe`;
  const write = await run(scratch);
  results.push({
    name: "scratch write in the root",
    status: write.exitCode === 0 ? "ok" : "fail",
    layer: "filesystem",
    detail: write.exitCode === 0 ? "writable" : `refused (exit ${write.exitCode})`,
  });
  // The asymmetry check: a tool resolved by name whose full path is refused is a policy problem (#572).
  const first = Object.entries(resolved)[0];
  if (first !== undefined) {
    const [tool, at] = first;
    const test = await run(win ? `Test-Path "${at.replaceAll('"', '`""')}"` : `test -e "${at}"`);
    results.push({
      name: `full-path vs by-name (${tool})`,
      status: test.exitCode === 0 && /true/i.test(test.output) ? "ok" : "fail",
      layer: test.exitCode === 0 && /true/i.test(test.output) ? "filesystem" : "policy",
      detail: test.exitCode === 0 && /true/i.test(test.output) ? `${at} opens by full path` : `${at} is refused by full path while ${tool} resolved by name — a policy gap`,
    });
  }
  // Relay reachability, when one runs.
  const registry = startedRegistryRelay();
  if (registry !== undefined) {
    const relay = await registry;
    const probe = await run(win ? `(Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "${relay.url}health").StatusCode` : `curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${relay.url}health"`);
    results.push({ name: "registry relay reachable", status: probe.exitCode === 0 ? "ok" : "fail", layer: probe.exitCode === 0 ? "relay" : "network", detail: probe.output.trim().slice(0, 120) || `exit ${probe.exitCode}` });
  }
  return results;
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** The full snapshot as text (the CLI's default) or JSON (`--json`). */
export function renderSnapshot(snapshot: SandboxSnapshot, options: { json?: boolean } = {}): string {
  if (options.json) return JSON.stringify(snapshot, null, 2);
  const lines: string[] = [];
  const id = snapshot.identity;
  lines.push(`pi-outpost ${id.version} · ${id.platform}/${id.arch} · generated ${id.generatedAt}`);
  lines.push(
    `backend: ${id.runnerKind ?? "none"}${id.runner ? ` (${id.runner})` : ""}${id.mxcEnumerateLevel !== undefined ? ` · MXC enumeration level ${id.mxcEnumerateLevel}` : ""}${id.sandboxRoot ? ` · root ${id.sandboxRoot}` : ""}`,
  );
  const net = snapshot.network;
  lines.push(
    `network: ${net.proxy ? `proxy only, allowed hosts: ${(net.allowedHosts ?? []).join(", ") || "(none)"}` : net.internetOpen ? "Internet open" : "closed"}${net.privateNetwork ? " · private network open" : " · private network closed"}${net.hostLoopback ? " · loopback open" : " · loopback closed"}`,
  );
  const policy = snapshot.policy;
  if (policy.unavailableReason) lines.push(`policy: ${policy.backend} — ${policy.unavailableReason}`);
  else
    lines.push(
      `policy (${policy.backend}): ${policy.readwritePaths.length} read-write, ${policy.readonlyPaths.length} read-only, ${policy.denied.length} denied, ${policy.enumeratePaths.length} enumerable`,
    );
  for (const link of snapshot.links) lines.push(`  link ${link.link} → ${link.target} (target ${link.targetReadable ? "readable" : "NOT readable"})`);
  for (const denied of policy.denied.slice(0, 20)) lines.push(`  denied ${denied.path} — ${denied.reasonClass}`);
  if (policy.denied.length > 20) lines.push(`  … ${policy.denied.length - 20} more denied`);
  for (const group of snapshot.envFilter) lines.push(`env filter: ${group.group} ${group.dropped} dropped (${group.names.join(", ")})`);
  for (const relay of snapshot.relays) lines.push(`relay: ${relay.name} ${relay.running ? `running${relay.port ? ` on 127.0.0.1:${relay.port}` : ""}` : "not running"} — ${relay.detail}`);
  if (snapshot.seeds.length > 0) lines.push(`seeds carried: ${snapshot.seeds.join(", ")}`);
  for (const probe of snapshot.probes) lines.push(`probe ${probe.name}: ${probe.status} (${probe.layer}) — ${probe.detail}`);
  lines.push(`decision log (last ${snapshot.decisions.length}):`);
  for (const decision of snapshot.decisions.slice(-20)) lines.push(`  ${decision.lastSeen} ${decision.kind} ${decision.target} ×${decision.count}`);
  return lines.join("\n") + "\n";
}

/** The agent's bounded summary: identity, network, policy counts, links, last decisions — size-capped. */
export function boundedAgentSummary(snapshot: SandboxSnapshot, maxChars = 4000): string {
  const full = renderSnapshot({ ...snapshot, probes: snapshot.probes.length > 0 ? snapshot.probes : [], policy: { ...snapshot.policy, denied: snapshot.policy.denied.slice(0, 10) }, decisions: snapshot.decisions.slice(-10) });
  const text = `sandbox snapshot (bounded; full: \`pi-outpost sandbox doctor\` on the host)\n${full}`;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/** Test helper: assert none of `secrets` appears in `text` — the paste-safety contract. */
export function assertPasteSafe(text: string, secrets: readonly string[]): string[] {
  return secrets.filter((secret) => secret.length > 0 && text.includes(secret));
}

// ── The agent's tool ─────────────────────────────────────────────────────────

import { Type, type TSchema } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

let doctorVersion = "dev";

/** Called once from `index.ts`, where the bundle's version is known. */
export function setDoctorVersion(version: string): void {
  doctorVersion = version;
}

/**
 * The `sandbox_doctor` tool: a bounded, paste-safe summary of the sandbox's state, for the agent to tell
 * a policy decision from an environment problem. Read-only; no probe run; no environment values.
 */
export function createSandboxDoctorToolDefinition(sandbox: SandboxConfig, root: string, neverReadable: { agentDir?: string; configFile?: string }): ToolDefinition {
  return {
    name: "sandbox_doctor",
    label: "Sandbox doctor",
    description:
      "A bounded, paste-safe snapshot of this sandbox's state: the active backend and MXC tier, network policy, " +
      "policy counts by class, the link/junction resolution table, dropped environment variable names (never values), " +
      "running relays and carried config seeds, and the last recorded refusals. Read-only. Use it to tell a sandbox " +
      "policy decision from an environment problem instead of guessing. For the full report with live probes, the user " +
      "runs `pi-outpost sandbox doctor` on the host.",
    parameters: Type.Object({}) as unknown as { required?: string[] } as TSchema,
    execute: async () => ({
      content: [
        {
          type: "text" as const,
          text: boundedAgentSummary(
            await collectSandboxSnapshot({ version: doctorVersion, cwd: root, sandbox, agentDir: neverReadable.agentDir, configFile: neverReadable.configFile }),
          ),
        },
      ],
      details: undefined,
    }),
  };
}
