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
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ConfinementVerdict } from "@pi-outpost/shared";

import type { SandboxConfig } from "./config.ts";
import { startedRegistryRelay } from "./registryRelay.ts";
import { rulesStoreFor, type RecordedRefusal } from "./sandboxRules.ts";
import {
  activeSigningShim,
  confinedEnvironment,
  defaultSandboxCache,
  enumerateLevelFlags,
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
  /** The target lies outside the sandbox root (a granted tool link can — issue #562). */
  outsideRoot?: boolean;
  /** The target is covered by the runtime policy's granted paths (read-write ∪ read-only ∪ enumerated). */
  granted?: boolean;
}

/** The canary verdict as the doctor shows it: attempt keys in words, the reason single-line capped. */
export interface ConfinementSection {
  state: ConfinementVerdict["state"];
  runner: string;
  checkedAt?: string;
  /** A leak's reached attempts, named in words (never a path's contents). */
  reached?: string[];
  /** A partial verdict's exposed variable names — names only, never values. */
  exposed?: string[];
  /** Single-line, length-capped. */
  reason?: string;
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
  /** The agent shell's canary verdict, as the interface shows it — a leak is visible here (issues #582/#585). */
  confinement?: ConfinementSection;
  policy: PolicySummary;
  /** MXC on Windows: the same policy at the enumeration level this host proved — what commands actually get (issue #585). */
  runtimePolicy?: PolicySummary;
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
  /** The agent shell's canary verdict. The CLI fills it via `shellVerdict()`; the agent tool from the settled verdict. */
  confinement?: ConfinementVerdict;
  now?: () => Date;
}

// ── Policy, by class ─────────────────────────────────────────────────────────

type MxcRequest = MxcTerminalConfig & { processContainer?: { filesystem?: { enumeratePaths?: string[] } } };

/** The MXC request a command gets for this sandbox, built the way `confinedBash` builds it. */
function policyRequestFor(sandbox: SandboxConfig, root: string, agentDir: string | undefined, configFile: string | undefined, serverEnv: NodeJS.ProcessEnv, platform: NodeJS.Platform, level?: 0 | 1 | 2): MxcRequest {
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
    // Full enumeration unless a level is given: the doctor's `policy` shows the wanted policy, the
    // `runtimePolicy` the one at the level this host proved it can build (issue #585).
    ...(level === undefined ? { enumerateAncestors: true, enumerateGrants: true } : enumerateLevelFlags(level)),
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

// ── Single-line rendering + the granted-path classifier (issues #582/#585) ────

/**
 * One line, capped after sanitizing: newlines, tabs and control characters become one space, so
 * captured error text can neither break a following value (a relay URL) across lines nor be cut
 * mid-URL by a line break.
 */
export function oneLine(text: string, cap = 300): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, cap);
}

/** The path math for the classifier, on the platform whose paths the policy carries. */
function pathKit(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizePath(wp: path.PlatformPath, p: string): string {
  return wp.normalize(p).replace(/[\\/]+$/, "").toLowerCase();
}

/** `child` is `dir` or under it (both already normalized). */
function underNormalized(wp: path.PlatformPath, child: string, dir: string): boolean {
  return child === dir || child.startsWith(dir + wp.sep.toLowerCase());
}

/**
 * The leak indicator: the path lies outside the sandbox root AND is not covered by any granted path
 * of the runtime policy (read-write ∪ read-only ∪ enumerated). A tool path beside the root that the
 * policy grants is by design (issue #562) and is not flagged; "outside the root" alone would cry leak
 * on every healthy grant.
 */
export function outsideRootAndUngranted(p: string, root: string, granted: readonly string[], platform: NodeJS.Platform = process.platform): boolean {
  const wp = pathKit(platform);
  const np = normalizePath(wp, p);
  if (underNormalized(wp, np, normalizePath(wp, root))) return false;
  return !granted.some((g) => underNormalized(wp, np, normalizePath(wp, g)));
}

/** The granted paths of an MXC request: read-write ∪ read-only ∪ enumerated (what commands may reach). */
export function grantedPathsOf(request: MxcRequest): string[] {
  const fs = request.filesystem;
  return [...fs.readwritePaths, ...fs.readonlyPaths, ...(request.processContainer?.filesystem?.enumeratePaths ?? [])];
}

/** A canary verdict as the snapshot's confinement section: attempts in words, reason one line. */
export async function confinementSectionFrom(verdict: ConfinementVerdict): Promise<ConfinementSection> {
  // Runtime-only import; the cycle sandboxDoctor → confinementStatus → sandbox → sandboxDoctor is the
  // same intentional one as sandbox.ts ↔ sandboxDoctor.ts below.
  const { describeConfinementAttempt } = await import("./confinementStatus.ts");
  switch (verdict.state) {
    case "checking":
      return { state: verdict.state, runner: verdict.runner };
    case "verified":
      return { state: verdict.state, runner: verdict.runner, checkedAt: verdict.checkedAt };
    case "partial":
      return { state: verdict.state, runner: verdict.runner, checkedAt: verdict.checkedAt, exposed: verdict.exposed };
    case "leaking":
      return { state: verdict.state, runner: verdict.runner, checkedAt: verdict.checkedAt, reached: verdict.reached.map(describeConfinementAttempt) };
    case "failed":
      return { state: verdict.state, runner: verdict.runner, checkedAt: verdict.checkedAt, reason: oneLine(verdict.reason) };
    case "unavailable":
      return { state: verdict.state, runner: verdict.runner, reason: oneLine(verdict.reason) };
    case "unconfined":
      return { state: verdict.state, runner: "", ...(verdict.reason ? { reason: oneLine(verdict.reason) } : {}) };
  }
}

/** Every link on the way down the policy resolved, with its target's readability and grant flags. */
function linkTableFor(request: MxcRequest, runtimeRequest: MxcRequest, serverEnv: NodeJS.ProcessEnv, root: string, platform: NodeJS.Platform): LinkEntry[] {
  const readable = new Set(request.filesystem.readonlyPaths.map((p) => p.toLowerCase()));
  const granted = grantedPathsOf(runtimeRequest);
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
    const wp = pathKit(platform);
    const nTarget = normalizePath(wp, target);
    const grantedHit = granted.some((g) => underNormalized(wp, nTarget, normalizePath(wp, g)));
    links.push({
      link: tool,
      target,
      targetReadable: readable.has(target.toLowerCase().replace(/[\\/]+$/, "")),
      outsideRoot: !underNormalized(wp, nTarget, normalizePath(wp, root)),
      granted: grantedHit,
    });
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
  let runtimePolicy: PolicySummary | undefined;
  let links: LinkEntry[] = [];
  if (platform === "win32" && sandbox?.bashRunner && sandbox.bashImage === undefined && kind === "mxc") {
    const request = policyRequestFor(sandbox, root, input.agentDir, input.configFile, serverEnv, platform);
    policy = summarizePolicy(request, siblingsToDeny(root), input.agentDir, input.configFile);
    // What commands actually get: the same policy at the enumeration level this host proved (issue #585).
    const runtimeRequest = policyRequestFor(sandbox, root, input.agentDir, input.configFile, serverEnv, platform, mxcEnumerateLevel());
    runtimePolicy = summarizePolicy(runtimeRequest, siblingsToDeny(root), input.agentDir, input.configFile);
    // The link flags compare against the runtime policy's granted paths, not the wanted one's.
    links = linkTableFor(request, runtimeRequest, serverEnv, root, platform);
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
    ...(input.confinement ? { confinement: await confinementSectionFrom(input.confinement) } : {}),
    policy,
    ...(runtimePolicy ? { runtimePolicy } : {}),
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
    // One line, capped after sanitizing: a multi-line error can neither break the rendered report nor
    // truncate a following value (a relay URL) mid-string (issues #582/#585).
    return { exitCode, output: oneLine(output, 4000) };
  };
  // The runtime policy's granted paths, to classify PATH resolutions against (a granted tool beside the
  // root is by design, #562; outside-root AND ungranted is a leak indicator).
  const root = await resolveRoot(input.sandbox.root);
  let granted: string[] | null = null;
  if (win && runnerKind(input.sandbox.bashRunner) === "mxc") {
    try {
      granted = grantedPathsOf(policyRequestFor(input.sandbox, root, input.agentDir, input.configFile, process.env, platform, mxcEnumerateLevel()));
    } catch {
      granted = null;
    }
  }
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
      results.push({ name: `PATH ${tool}`, ...(granted ? classifyResolution(at, root, granted, platform) : { status: "ok" as const, layer: "filesystem", detail: `resolved to ${at}` }) });
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
    const relayUrl = relay.url.replace(/\s+/g, "");
    const probe = await run(win ? `(Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "${relayUrl}health").StatusCode` : `curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${relayUrl}health"`);
    results.push({ name: "registry relay reachable", status: probe.exitCode === 0 ? "ok" : "fail", layer: probe.exitCode === 0 ? "relay" : "network", detail: probe.output.trim().slice(0, 120) || `exit ${probe.exitCode}` });
  }
  // The beside-root canary replay (issues #582/#585): the canary's bait is a marker in a fresh
  // directory under the host tmpdir — on the leaking hosts that tmpdir sat on a foreign drive, so a
  // same-drive sibling probe would answer "refused" on a leaking host. This replays the actual bait,
  // through the same runner (whose policy is built at the proven enumeration level).
  const kind = runnerKind(input.sandbox.bashRunner);
  if (!win || kind !== "mxc") {
    results.push({ name: "beside-root canary replay", status: "skipped", layer: "policy", detail: !win ? "MXC's enumeration level is a Windows concept" : `no proven enumeration level (backend ${kind})` });
  } else {
    const wp = pathKit(platform);
    const baitDir = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-outpost-doctor-beside-")));
    if (underNormalized(wp, normalizePath(wp, baitDir), normalizePath(wp, root))) {
      await rm(baitDir, { recursive: true, force: true });
      results.push({ name: "beside-root canary replay", status: "skipped", layer: "policy", detail: `the temporary directory (${oneLine(os.tmpdir())}) is inside the sandbox root` });
    } else {
      const marker = path.join(baitDir, "marker");
      await writeFile(marker, "canary", { mode: 0o600 });
      try {
        const read = await run(`Get-Content "${marker.replaceAll('"', '`"')}"`);
        results.push(besideRootProbeResult(read, mxcEnumerateLevel(), marker));
      } finally {
        await rm(baitDir, { recursive: true, force: true });
      }
    }
  }
  return results;
}

/** A PATH resolution against the granted paths: granted (even beside the root, #562) stays ok; outside-root AND ungranted fails as a policy leak indicator. */
export function classifyResolution(at: string, root: string, granted: readonly string[], platform: NodeJS.Platform = process.platform): Pick<ProbeResult, "status" | "layer" | "detail"> {
  if (!outsideRootAndUngranted(at, root, granted, platform)) return { status: "ok", layer: "filesystem", detail: `resolved to ${at}` };
  return { status: "fail", layer: "policy", detail: `resolves outside the root and is not a granted path: ${at}` };
}

/** The beside-root probe's verdict from the confined read: refused → ok, read → fail naming the bait path. */
export function besideRootProbeResult(read: { exitCode: number | null; output: string }, level: 0 | 1 | 2, marker: string): ProbeResult {
  const refused = read.exitCode !== 0 || (read.output.includes("[pi-outpost]") && /refused|denied/i.test(read.output));
  return refused
    ? { name: "beside-root canary replay", status: "ok", layer: "policy", detail: `refused at level ${level}: ${oneLine(marker)}` }
    : { name: "beside-root canary replay", status: "fail", layer: "policy", detail: `reached at level ${level}: ${oneLine(marker)} was read` };
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
  if (snapshot.confinement) {
    const c = snapshot.confinement;
    const parts = [
      c.runner ? `${c.state} (${c.runner})` : c.state,
      c.checkedAt ? `checked ${c.checkedAt}` : "",
      c.reached?.length ? `reached: ${c.reached.join(", ")}` : "",
      c.exposed?.length ? `exposed: ${c.exposed.join(", ")}` : "",
      c.reason ? `reason: ${c.reason}` : "",
    ].filter(Boolean);
    lines.push(`confinement: ${parts.join(" · ")}`);
  }
  const policy = snapshot.policy;
  if (policy.unavailableReason) lines.push(`policy: ${policy.backend} — ${policy.unavailableReason}`);
  else
    lines.push(
      `policy (${policy.backend}): ${policy.readwritePaths.length} read-write, ${policy.readonlyPaths.length} read-only, ${policy.denied.length} denied, ${policy.enumeratePaths.length} enumerable`,
    );
  if (snapshot.runtimePolicy) {
    const rp = snapshot.runtimePolicy;
    lines.push(
      `policy at level ${snapshot.identity.mxcEnumerateLevel ?? "?"} (what commands get): ${rp.readwritePaths.length} read-write, ${rp.readonlyPaths.length} read-only, ${rp.denied.length} denied, ${rp.enumeratePaths.length} enumerable`,
    );
  }
  for (const link of snapshot.links)
    lines.push(`  link ${link.link} → ${link.target} (target ${link.targetReadable ? "readable" : "NOT readable"}${link.outsideRoot && !link.granted ? " — OUTSIDE THE ROOT, NOT GRANTED" : ""})`);
  for (const denied of policy.denied.slice(0, 20)) lines.push(`  denied ${denied.path} — ${denied.reasonClass}`);
  if (policy.denied.length > 20) lines.push(`  … ${policy.denied.length - 20} more denied`);
  for (const group of snapshot.envFilter) lines.push(`env filter: ${group.group} ${group.dropped} dropped (${group.names.join(", ")})`);
  for (const relay of snapshot.relays) lines.push(`relay: ${relay.name} ${relay.running ? `running${relay.port ? ` on 127.0.0.1:${relay.port}` : ""}` : "not running"} — ${relay.detail}`);
  if (snapshot.seeds.length > 0) lines.push(`seeds carried: ${snapshot.seeds.join(", ")}`);
  for (const probe of snapshot.probes) lines.push(`probe ${probe.name}: ${probe.status} (${probe.layer}) — ${oneLine(probe.detail, 200)}`);
  lines.push(`decision log (last ${snapshot.decisions.length}):`);
  for (const decision of snapshot.decisions.slice(-20)) lines.push(`  ${oneLine(`${decision.lastSeen} ${decision.kind} ${decision.target}`, 200)} ×${decision.count}`);
  return lines.join("\n") + "\n";
}

/** The agent's bounded summary: identity, network, policy counts, links, last decisions — size-capped. */
export function boundedAgentSummary(snapshot: SandboxSnapshot, maxChars = 4000): string {
  const full = renderSnapshot({ ...snapshot, probes: snapshot.probes.length > 0 ? snapshot.probes : [], policy: { ...snapshot.policy, denied: snapshot.policy.denied.slice(0, 10) }, ...(snapshot.runtimePolicy ? { runtimePolicy: { ...snapshot.runtimePolicy, denied: snapshot.runtimePolicy.denied.slice(0, 10) } } : {}), decisions: snapshot.decisions.slice(-10) });
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
      "A bounded, paste-safe snapshot of this sandbox's state: the active backend and MXC tier, the canary verdict " +
      "(a leak is named here, in words), network policy, policy counts by class, the link/junction resolution table " +
      "(targets outside the root and not granted are flagged), dropped environment variable names (never values), " +
      "running relays and carried config seeds, and the last recorded refusals. Read-only. Use it to tell a sandbox " +
      "policy decision from an environment problem instead of guessing. For the full report with live probes, the user " +
      "runs `pi-outpost sandbox doctor` on the host.",
    parameters: Type.Object({}) as unknown as { required?: string[] } as TSchema,
    execute: async () => {
      // The settled verdict of this server process; `checking` while the canary has not answered yet.
      const { settledShellVerdict } = await import("./confinementStatus.ts");
      const confinement = settledShellVerdict(sandbox, neverReadable) ?? { state: "checking" as const, runner: sandbox.bashRunner ?? "" };
      return {
        content: [
          {
            type: "text" as const,
            text: boundedAgentSummary(
              await collectSandboxSnapshot({ version: doctorVersion, cwd: root, sandbox, agentDir: neverReadable.agentDir, configFile: neverReadable.configFile, confinement }),
            ),
          },
        ],
        details: undefined,
      };
    },
  };
}
