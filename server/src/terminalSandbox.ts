/**
 * The web terminal inside an OS sandbox.
 *
 * Without this, the terminal is the one part of pi-outpost that ignores the sandbox:
 * a shell with every right of the server's operating-system user. With
 * `terminal.sandbox` naming landstrip's runner, every terminal is spawned as
 * `<runner> run -p <policy> -- <shell>`, confined to its workspace by Landlock and
 * seccomp. Tested under Docker's default profile, where bubblewrap would not start.
 *
 * Three pieces, each with one job:
 * - `checkRunner` — is the runner there and usable on this host? Asked once at start.
 * - `terminalPolicy` — what one terminal may read and write, from the workspace's sandbox.
 * - `confinedEnvironment` — the variables a confined shell gets. Built, not filtered:
 *   a filter for secret-looking names misses the next provider's variable.
 *
 * On Windows 11 the runner may instead be MXC's executor (`wxc-exec.exe`, Microsoft
 * eXecution Containers), whose tier 1 has the OS apply the policy itself: `NUL`, git and
 * busybox work there, where landstrip's AppContainer refuses them. Its policy is a
 * different document (`mxcTerminalConfig`) and it carries the shell's command line. On
 * Linux it may be MXC's `lxc-exec` (Bubblewrap, `mxcLinuxConfig`), and on Apple-silicon
 * macOS `mxc-exec-mac` (Seatbelt, `mxcMacConfig`): the same document, another backend. On any
 * Mac, Intel included, it may be `/usr/bin/sandbox-exec` with a Seatbelt profile pi-outpost
 * writes in the shape MXC generates (`seatbeltPolicy`).
 */
import { execFile, execFileSync } from "node:child_process";
import { closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { ConfinementRemedy } from "@pi-outpost/shared";
import { linuxMxcExecutor, mxcMissingReason } from "./mxcExecutor.ts";
import { mxcSdk, runThroughSdk, sdkRequest, type MxcSdk, type MxcWireRequest } from "./mxcSdk.ts";
import { registryOrigin, registryRelay, type RegistryRelay, type RelayRoute } from "./registryRelay.ts";
import { startSigningRelay } from "./signingRelay.ts";

/** Whether terminals can be confined, and if not, the reason a user is shown. */
export type RunnerCheck = { ok: true } | { ok: false; reason: string; remedy?: ConfinementRemedy };

/** How long the runner's self-check may take before it counts as unusable. */
export const RUNNER_CHECK_TIMEOUT_MS = 5_000;

type ExecFileResult = { stdout: string; stderr: string };
type Exec = (file: string, args: string[], options: { timeout: number }) => Promise<ExecFileResult>;

const defaultExec: Exec = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout: String(stdout), stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });

/**
 * Ask the runner whether it can sandbox on this host (`landstrip doctor`).
 *
 * Every failure is a reason, never a throw: an unusable runner makes the terminal
 * unavailable, and the server must start regardless.
 */
export async function checkRunner(
  runner: string,
  exec: Exec = defaultExec,
  platform: NodeJS.Platform = process.platform,
  sdk: () => Promise<{ sdk: MxcSdk } | { reason: string }> = mxcSdk,
): Promise<RunnerCheck> {
  // MXC runs in process: there is no file to find, only its SDK to load.
  if (runnerKind(runner) === "mxc") return checkMxcRunner(runner, platform, sdk, exec);
  try {
    await access(runner, fsConstants.X_OK);
  } catch {
    return { ok: false, reason: `The terminal sandbox runner was not found or is not executable: ${runner}` };
  }
  if (runnerKind(runner) === "seatbelt") return checkSeatbeltRunner(runner, exec, platform);
  let output: ExecFileResult;
  try {
    output = await exec(runner, ["doctor"], { timeout: RUNNER_CHECK_TIMEOUT_MS });
  } catch (error) {
    const detail = (error as { stderr?: string; stdout?: string; message?: string });
    // A runner that refuses usually says why in its JSON report, exit status aside.
    const reported = lastJsonLine(detail.stdout ?? "")?.error;
    const said = (typeof reported === "string" ? reported : detail.stderr || detail.stdout || detail.message || "").trim();
    return { ok: false, reason: `The terminal sandbox runner failed its self-check${said ? `: ${said}` : ""}` };
  }
  const report = lastJsonLine(output.stdout);
  if (report?.ok === true) return { ok: true };
  const said = typeof report?.error === "string" ? report.error : output.stdout.trim() || output.stderr.trim();
  return { ok: false, reason: `The terminal sandbox runner reports this host cannot be sandboxed${said ? `: ${said}` : ""}` };
}

/** Which runner `terminal.sandbox` names: MXC's executor or macOS' `sandbox-exec` by its file name, landstrip otherwise. */
export type RunnerKind = "landstrip" | "mxc" | "seatbelt";

export function runnerKind(runner: string): RunnerKind {
  if (runner === MXC || /^wxc-exec(\.exe)?$/i.test(path.win32.basename(runner)) || isLinuxMxc(runner, "linux") || isMacMxc(runner, "darwin")) return "mxc";
  return path.win32.basename(runner) === "sandbox-exec" ? "seatbelt" : "landstrip";
}

/** macOS' own Seatbelt runner, which `"seatbelt"` names. */
export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** The runner value that names MXC, run in process through its SDK (`mxcSdk.ts`). */
export const MXC = "mxc";

/** Whether a runner is MXC on Linux — `"mxc"` there, or a path to its old executor (`lxc-exec`): Bubblewrap. */
export function isLinuxMxc(runner: string, platform: NodeJS.Platform = process.platform): boolean {
  return runner === MXC ? platform === "linux" : path.win32.basename(runner) === "lxc-exec";
}

/** Whether a runner is MXC on macOS — `"mxc"` there, or a path to its old executor (`mxc-exec-mac`): Seatbelt. */
export function isMacMxc(runner: string, platform: NodeJS.Platform = process.platform): boolean {
  return runner === MXC ? platform === "darwin" : path.win32.basename(runner) === "mxc-exec-mac";
}

/** MXC on Linux or macOS: a POSIX shell's command line, and the same request but for the backend. */
export function isPosixMxc(runner: string, platform: NodeJS.Platform = process.platform): boolean {
  return isLinuxMxc(runner, platform) || isMacMxc(runner, platform);
}

/**
 * The first build of each Windows 11 release whose process container MXC supports, and the update
 * that brings it — MXC's own table (docs/backends/process-container/os-version-support.md). Only
 * to word a refusal: the probe decides, since MXC says runtime probing is authoritative.
 */
const MXC_WINDOWS_BUILDS: Record<string, { ubr: number; update: string }> = {
  "26100": { ubr: 9278, update: "the August 2026 cumulative update (KB5120998) or later" },
  "26200": { ubr: 9278, update: "the August 2026 cumulative update (KB5120998) or later" },
  "26300": { ubr: 9550, update: "the September 2026 cumulative update (KB5124010) or later" },
  "28000": { ubr: 2804, update: "the August 2026 cumulative update (KB5120996) or later" },
};

/** The update a Windows build lacks for MXC's process container, when it is one this table knows. */
export function windowsUpdateRemedy(build: string, ubr: number): ConfinementRemedy | undefined {
  const known = MXC_WINDOWS_BUILDS[build];
  // Before 24H2 (23H2 is 22631) no cumulative update brings the process container: Windows itself
  // must move to 24H2 or later, and then take the update that brings it there.
  if (!known && Number(build) < 26100) {
    return { kind: "windows-update", build: `${build}.${ubr}`, needed: "26100.9278", update: "Windows 11 24H2 or later, with the August 2026 cumulative update (KB5120998)" };
  }
  if (!known || ubr >= known.ubr) return undefined;
  return { kind: "windows-update", build: `${build}.${ubr}`, needed: `${build}.${known.ubr}`, update: known.update.replace(/ or later$/, "") };
}

/** What a Windows build lacks for MXC's process container, in words a user can act on. */
export function windowsBuildAdvice(build: string, ubr: number): string {
  const here = `This machine is Windows build ${build}.${ubr}`;
  const known = MXC_WINDOWS_BUILDS[build];
  if (known) return ubr < known.ubr ? `${here}; MXC's process container needs ${build}.${known.ubr}: install ${known.update}` : here;
  if (Number(build) < 26100) return `${here}; MXC's process container needs Windows 11 24H2 (26100.9278) or later`;
  return here;
}

/** This machine's Windows build and update revision, from the registry; undefined when unreadable. */
async function windowsBuild(exec: Exec): Promise<{ build: string; ubr: number } | undefined> {
  // For the tests that show this refusal end to end: a build to word it with. It changes the words only.
  const told = /^(\d+)\.(\d+)$/.exec(process.env.PI_OUTPOST_TEST_WINDOWS_BUILD ?? "");
  if (told) return { build: told[1], ubr: Number(told[2]) };
  const key = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
  try {
    const [build, ubr] = await Promise.all(
      ["CurrentBuild", "UBR"].map(async (name) => (await exec("reg", ["query", key, "/v", name], { timeout: RUNNER_CHECK_TIMEOUT_MS })).stdout),
    );
    const buildValue = /CurrentBuild\s+REG_SZ\s+(\d+)/.exec(build)?.[1];
    const ubrValue = /UBR\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(ubr)?.[1];
    return buildValue && ubrValue ? { build: buildValue, ubr: Number.parseInt(ubrValue, 16) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * MXC's self-check, through its SDK: on Windows its probe names the tier it would pick; on Linux
 * and macOS one confined `true` in its Bubblewrap or Seatbelt backend, network open.
 *
 * Only tier 1 (`base-container`, Windows 11 24H2 with the August 2026 update) is accepted.
 * The lower tiers emulate it with AppContainer ACLs stamped on every allowed tree at each
 * launch — and the terminal's policy allows a whole drive for reading (see
 * `mxcTerminalConfig`): that would rewrite the ACLs of the disk.
 *
 * On Linux, Bubblewrap is listed wherever `bwrap` is installed, even in a container that refuses
 * it user namespaces; only a run tells. Its network shape is the most demanding one a command is
 * given (slirp4netns, `/dev/net/tun`, iptables, `ip`), so a host that passes runs both the open
 * network and `sandbox.allowedHosts`' proxy. MXC says why it cannot, and that is the reason.
 */
async function checkMxcRunner(runner: string, platform: NodeJS.Platform, load: () => Promise<{ sdk: MxcSdk } | { reason: string }>, exec: Exec): Promise<RunnerCheck> {
  const linux = isLinuxMxc(runner, platform);
  const mac = isMacMxc(runner, platform);
  const file = path.win32.basename(runner);
  if (runner !== MXC && file === "lxc-exec" && platform !== "linux") return { ok: false, reason: `MXC's Bubblewrap backend confines commands on Linux only: ${runner}` };
  if (runner !== MXC && file === "mxc-exec-mac" && platform !== "darwin") return { ok: false, reason: `MXC's Seatbelt backend confines commands on macOS only: ${runner}` };
  if (!linux && !mac && platform !== "win32") return { ok: false, reason: `MXC confines commands on Windows, Linux and macOS only, not ${platform}` };
  // Linux runs MXC's executor, not its SDK (`mxcRunsInProcess`): the check runs what a command will.
  if (linux) {
    const executor = linuxMxcExecutor(runner);
    if (executor === undefined) return { ok: false, reason: mxcMissingReason(platform, process.arch, process.execPath) };
    return checkPosixMxcRunner({ executor, exec }, "bubblewrap");
  }
  const loaded = await load();
  if ("reason" in loaded) return { ok: false, reason: loaded.reason };
  if (mac) return checkPosixMxcRunner({ sdk: loaded.sdk }, "seatbelt");
  let probe: { tier?: unknown; probes?: { baseContainerSupportsDenyPaths?: unknown; baseContainerSupportsEnumeratePaths?: unknown }; error?: unknown };
  try {
    probe = (await loaded.sdk.probe()) as typeof probe;
  } catch (error) {
    return { ok: false, reason: `MXC failed its probe: ${(error as Error).message}` };
  }
  // For the tests that show this refusal end to end: a tier the probe is taken to report. Only a tier
  // that refuses is taken — "base-container" is ignored — so it can make the check fail, never pass.
  const toldTier = process.env.PI_OUTPOST_TEST_MXC_TIER;
  if (toldTier && toldTier !== "base-container") probe = { ...probe, tier: toldTier };
  if (probe.tier !== "base-container") {
    const build = await windowsBuild(exec);
    const remedy = build ? windowsUpdateRemedy(build.build, build.ubr) : undefined;
    return {
      ok: false,
      reason:
        `MXC cannot confine commands on this Windows: its process container is not available here (MXC reports tier "${String(probe.tier ?? probe.error)}" and needs "base-container": Windows 11 24H2 or 25H2 with the August 2026 update or later)` +
        (build ? `. ${windowsBuildAdvice(build.build, build.ubr)}` : ""),
      ...(remedy ? { remedy } : {}),
    };
  }
  if (probe.probes?.baseContainerSupportsDenyPaths === false) {
    return { ok: false, reason: "This Windows build's sandbox cannot deny paths, which the terminal's policy needs" };
  }
  // Without it a request naming `enumeratePaths` is refused: the folders above a tool stay closed, as before.
  mxcEnumerates = probe.probes?.baseContainerSupportsEnumeratePaths !== false;
  return { ok: true };
}

/**
 * Whether this host's MXC can make a folder listable without making it readable
 * (`baseContainerSupportsEnumeratePaths`), as its last probe said: assumed until a probe says not.
 */
let mxcEnumerates = true;
/**
 * Whether this host also took the enumerated ancestors of the *grants* (the sandbox cache, the
 * toolchain homes — folders under the profile, whose entries a domain machine often ACLs away from
 * the account). Level 1 keeps enumeration for the search path's tools alone; level 2 drops all of it.
 */
let mxcEnumerateGrants = true;

/** The enumeration level this host proved it can build a policy with: 0 full, 1 tools only, 2 none. */
export function mxcEnumerateLevel(): 0 | 1 | 2 {
  return !mxcEnumerates ? 2 : mxcEnumerateGrants ? 0 : 1;
}

/** A policy's enumeration flags for a level: 0 full, 1 the tools' ancestors only, 2 none. */
export function enumerateLevelFlags(level: 0 | 1 | 2): { enumerateAncestors?: boolean; enumerateGrants?: boolean } {
  return level === 0 ? {} : level === 1 ? { enumerateAncestors: true, enumerateGrants: false } : { enumerateAncestors: false };
}

/**
 * The host's MXC refused a policy over the enumeration layer — Windows could not build the process
 * security environment over the paths it adds (`isSecurityEnvironmentRefusal`) — at `level`: 1 when
 * only the ancestors of the grants failed, 2 when any enumeration failed. Remembered, so no policy
 * built afterwards on this host asks past that level; 0 resets, for tests. Confinement is not
 * loosened: the siblings of the path to the root stay denied whatever the level.
 */
export function noteMxcEnumerateLevel(level: 0 | 1 | 2): void {
  mxcEnumerates = level < 2;
  mxcEnumerateGrants = level < 1;
}

/** MXC's Linux and macOS self-check: one confined `true`, network open — through the SDK on macOS, the executor on Linux. */
async function checkPosixMxcRunner(through: { sdk: MxcSdk } | { executor: string; exec: Exec }, containment: "bubblewrap" | "seatbelt"): Promise<RunnerCheck> {
  const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-mxc-check-"));
  try {
    const mac = containment === "seatbelt";
    const request: MxcWireRequest = {
      version: "1.0.0",
      containment,
      process: { commandLine: mac ? "/usr/bin/true" : "/bin/true", cwd: mac ? realPath(tmp) : tmp, env: ["PATH=/usr/bin:/bin"] },
      filesystem: { readwritePaths: [mac ? realPath(tmp) : tmp], readonlyPaths: mac ? macSystemTrees() : linuxSystemTrees() },
      network: { egress: { default: "allow" } },
      ...(mac ? { seatbelt: { extraMachLookups: [] } } : {}),
    };
    if ("executor" in through) {
      const file = path.join(tmp, "check.json");
      await writeFile(file, JSON.stringify(request), { mode: 0o600 });
      try {
        await through.exec(through.executor, [file], { timeout: RUNNER_CHECK_TIMEOUT_MS });
        return { ok: true };
      } catch (error) {
        const detail = error as { stderr?: string; stdout?: string; message?: string };
        return { ok: false, reason: `MXC cannot confine commands on this host: ${mxcErrorMessage(`${detail.stdout ?? ""}${detail.stderr ?? ""}`) || detail.message || "it failed"}` };
      }
    }
    let said = "";
    try {
      const { exitCode } = await runThroughSdk(through.sdk, sdkRequest(request), {
        onData: (data) => (said += data.toString()),
        timeoutMs: RUNNER_CHECK_TIMEOUT_MS,
        timeout: RUNNER_CHECK_TIMEOUT_MS / 1000,
      });
      return exitCode === 0 ? { ok: true } : { ok: false, reason: `MXC cannot confine commands on this host: ${mxcErrorMessage(said) || `exit ${exitCode}`}` };
    } catch (error) {
      return { ok: false, reason: `MXC cannot confine commands on this host: ${mxcErrorMessage((error as Error).message) || (error as Error).message}` };
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The Seatbelt runner's self-check: `/usr/bin/true` under the profile a command gets, network open.
 *
 * `sandbox-exec` says why it refuses (a profile it cannot parse, a system that dropped it) on
 * stderr, and that is the reason passed on.
 */
async function checkSeatbeltRunner(runner: string, exec: Exec, platform: NodeJS.Platform): Promise<RunnerCheck> {
  if (platform !== "darwin") return { ok: false, reason: `sandbox-exec confines commands on macOS only: ${runner}` };
  const tmp = realPath(await mkdtemp(path.join(tmpdir(), "pi-outpost-seatbelt-check-")));
  try {
    const { seatbelt } = seatbeltPolicy({
      root: tmp,
      allowWrite: true,
      tmp,
      shell: "/usr/bin/true",
      shellArgs: [],
      cwd: tmp,
      env: { PATH: "/usr/bin:/bin" },
      developerDir: null,
    });
    const file = path.join(tmp, "check.sb");
    await writeFile(file, seatbelt, { mode: 0o600 });
    try {
      await exec(runner, ["-f", file, "/usr/bin/true"], { timeout: RUNNER_CHECK_TIMEOUT_MS });
      return { ok: true };
    } catch (error) {
      const detail = error as { stderr?: string; stdout?: string; message?: string };
      const said = (detail.stderr || detail.stdout || detail.message || "").trim();
      return { ok: false, reason: `Seatbelt cannot confine commands on this host${said ? `: ${said}` : ""}` };
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** MXC's `{"error":{"message":…}}`, which it writes after a human line; else the text itself, trimmed. */
export function mxcErrorMessage(text: string): string {
  const at = text.lastIndexOf('{"error"');
  if (at >= 0) {
    try {
      const message = (JSON.parse(text.slice(at)) as { error?: { message?: unknown } }).error?.message;
      if (typeof message === "string") return message.trim();
    } catch {
      // Not the whole object: fall back to the text.
    }
  }
  return text.trim().slice(0, 500);
}

function lastJsonLine(text: string): Record<string, unknown> | undefined {
  for (const line of text.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Inside the writable zone, what the agent's commands may read but not write: the repository's
 * metadata (`.git`), whose configuration and hooks name commands git runs — for the user too, later,
 * outside any sandbox. Held only when it exists: Bubblewrap will not start on a missing read-only
 * path, and the command that creates it is the agent's own `git init` (measured on every runner).
 * `sandbox.gitWritable` leaves it writable; a write grant on it, for its command or the session, too.
 */
export function heldReadOnlyInside(
  writable: string | undefined,
  options: { gitWritable?: boolean; grantedWrite?: readonly string[]; exists?: (p: string) => boolean } = {},
): string[] {
  if (writable === undefined || options.gitWritable) return [];
  const git = path.join(writable, ".git");
  if (!(options.exists ?? existsSync)(git)) return [];
  // This host's paths, case aside on Windows: a grant on .git, or on a folder holding it, opens it.
  const norm = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const within = (child: string, parent: string) => {
    const rel = path.relative(norm(parent), norm(child));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  const granted = (options.grantedWrite ?? []).some((p) => within(git, p));
  return granted ? [] : [git];
}

/** landstrip's native policy, as much of it as a terminal uses. */
export interface TerminalPolicy {
  filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[]; denyWrite?: string[] };
  /**
   * Open, or — under `sandbox.allowedHosts` — closed but for the proxy's port: landstrip then
   * permits loopback TCP to that port alone, by its number on any loopback address (the proxy
   * holds it on `[::1]` too, `egressProxy.ts`). Local binding stays off: it would reopen the loopback.
   */
  network: { allowNetwork: true } | { allowNetwork: false; allowLocalBinding: false; httpProxyPort: number };
  /** Windows only: the AppContainer flavour. `standard`: `lpac` refuses even allowed tools such as git. */
  windows?: { appContainerMode: "standard" | "lpac" };
}

export interface TerminalPolicyInput {
  /** What the terminal may read: the workspace's sandbox root, or its project root. */
  root: string;
  /** Where it may write. Undefined with `allowWrite`: the whole root. */
  writableRoot?: string;
  /** False: nothing but its temporary directory and the tty devices is writable. */
  allowWrite: boolean;
  /** Holds provider credentials: never readable, even where it sits under a readable tree. */
  agentDir?: string;
  /** The configuration file: never readable. */
  configFile?: string;
  /** This terminal's private temporary directory. */
  tmp: string;
  /** The shell's search path: the programs it runs have to be readable. */
  searchPath?: string;
  /** Single files readable besides the trees: the user's git configuration (see `userGitConfig`). */
  readOnlyFiles?: string[];
  /**
   * Inside the writable zone, what stays read-only: the repository's metadata (`heldReadOnlyInside`).
   * The agent's shell only — a terminal is the user's own hand.
   */
  readOnlyInside?: string[];
  /** Whose rules: defaults to this host's. A parameter so both are tested everywhere. */
  platform?: NodeJS.Platform;
  /** Windows' system directory (`%SystemRoot%`), readable by every shell. */
  systemRoot?: string;
  /**
   * Windows: the user's profile (`%USERPROFILE%`). Search-path entries inside it are left out:
   * they hold per-user installs (global npm packages, Store aliases) whose trees AppContainer
   * re-grants on every launch — npm's alone made a terminal take thirteen seconds to appear.
   */
  userProfile?: string;
  /**
   * Directories the user granted this command beyond the sandbox (`sandboxGrants.ts`): read
   * only, and read-write. A write grant holds even without `allowWrite`: the user asked for it.
   */
  grantedRead?: string[];
  grantedWrite?: string[];
  /** `sandbox.allowedHosts`' proxy (`http://127.0.0.1:<port>`): the network closed but for it. Linux, the agent's shell only. */
  networkProxy?: string;
}

/**
 * What a shell needs to read to run at all: binaries, libraries, configuration, devices,
 * process information, and name resolution (`/etc/resolv.conf` links into `/run`).
 */
const SYSTEM_READ = ["/usr", "/etc", "/lib", "/lib32", "/lib64", "/libx32", "/bin", "/sbin", "/dev", "/proc", "/sys", "/run/systemd/resolve"];

/**
 * What one terminal may touch.
 *
 * Reading is an allowlist: `/` is denied and only the trees a shell needs are allowed
 * back, with the root and the private temporary directory. A tool installed outside
 * them is reached through the search path: an entry ending in `bin` allows its whole
 * installation (`/opt/node/bin` → `/opt/node`), since a binary needs its libraries.
 * The agent directory and the configuration are denied by name, which holds even when
 * they sit under an allowed tree. Paths are passed as given: the caller resolves them.
 */
export function terminalPolicy(input: TerminalPolicyInput): TerminalPolicy {
  if ((input.platform ?? process.platform) === "win32") return windowsTerminalPolicy(input);
  const denyRead = ["/"];
  if (input.agentDir) denyRead.push(input.agentDir);
  if (input.configFile) denyRead.push(input.configFile);
  const writable = input.allowWrite ? [input.writableRoot ?? input.root] : [];
  return {
    filesystem: {
      denyRead: unique(denyRead),
      allowRead: unique([...SYSTEM_READ, ...toolTrees(input.searchPath, path.posix), input.root, input.tmp, ...(input.readOnlyFiles ?? []), ...granted(input)]),
      allowWrite: unique([...writable, ...(input.grantedWrite ?? []), input.tmp, "/dev/null", "/dev/tty", "/dev/pts"]),
      ...(input.readOnlyInside?.length ? { denyWrite: unique(input.readOnlyInside) } : {}),
    },
    network: input.networkProxy === undefined ? { allowNetwork: true } : { allowNetwork: false, allowLocalBinding: false, httpProxyPort: proxyPort(input.networkProxy) },
  };
}

/** The port of the server's proxy URL; a URL without one is refused rather than guessed. */
function proxyPort(proxy: string): number {
  const port = Number(new URL(proxy).port);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`the network proxy ${proxy} names no port`);
  return port;
}

/**
 * The variables that send a command's HTTP clients to the server's proxy, for the runners that do
 * not set them themselves (Seatbelt, landstrip). MXC sets its own.
 */
export function proxyEnvironment(proxy: string): Record<string, string> {
  return Object.fromEntries(["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"].map((name) => [name, proxy]));
}

/**
 * The same allowlist, the way landstrip reads it on Windows (AppContainer).
 *
 * Paths are written with forward slashes, and reading is restricted only once a drive
 * root is denied: a policy without one is refused outright (`POLICY_UNRESTRICTED_READ`).
 * Every drive the policy names is denied and the allowed trees re-allowed inside it.
 * Tested on Windows 10: reads and writes stop where they do on Linux, and a process
 * outside the container cannot be killed from inside; the parent of the root can still
 * be listed (names, not contents).
 */
function windowsTerminalPolicy(input: TerminalPolicyInput): TerminalPolicy {
  // AppContainer could hold the proxy's port too, but nothing proves it here: refused, never ignored.
  if (input.networkProxy !== undefined) throw new Error("sandbox.allowedHosts is not enforced by landstrip on Windows: use MXC");
  const slash = (p: string) => p.replaceAll("\\", "/");
  // The search path's entries themselves, not their installations: AppContainer grants
  // access to every allowed tree on each launch, and whole installations (Git, Node,
  // Python) made a terminal take eleven seconds to appear.
  const profile = input.userProfile ? slash(input.userProfile).toLowerCase().replace(/\/+$/, "") + "/" : undefined;
  const tools = searchEntries(input.searchPath, path.win32).filter((entry) => !profile || !slash(entry).toLowerCase().startsWith(profile));
  const allowRead = [input.systemRoot, ...tools, input.root, input.tmp, ...(input.readOnlyFiles ?? []), ...granted(input)]
    .filter((entry): entry is string => Boolean(entry))
    .map(slash);
  const denyRead = [...new Set(allowRead.map((entry) => `${path.win32.parse(entry).root.replaceAll("\\", "/")}`))];
  if (input.agentDir) denyRead.push(slash(input.agentDir));
  if (input.configFile) denyRead.push(slash(input.configFile));
  const writable = input.allowWrite ? [input.writableRoot ?? input.root] : [];
  return {
    filesystem: {
      denyRead: unique(denyRead),
      allowRead: unique(allowRead),
      allowWrite: unique([...writable, ...(input.grantedWrite ?? []), input.tmp].map(slash)),
      ...(input.readOnlyInside?.length ? { denyWrite: unique(input.readOnlyInside.map(slash)) } : {}),
    },
    network: { allowNetwork: true },
    windows: { appContainerMode: "standard" },
  };
}

/** The installations a search path points into. Relative entries name nothing fixed: skipped. */
function toolTrees(searchPath: string | undefined, flavour: path.PlatformPath): string[] {
  if (!searchPath) return [];
  return searchPath
    .split(flavour === path.win32 ? ";" : ":")
    .filter((entry) => entry && flavour.isAbsolute(entry))
    .map((entry) => (flavour.basename(entry).toLowerCase() === "bin" ? flavour.dirname(entry) : entry))
    // A drive or filesystem root (a "/bin" entry's parent) would undo the whole allowlist.
    .filter((tree) => tree !== flavour.parse(tree).root);
}

/** A search path's absolute entries, roots excluded. */
function searchEntries(searchPath: string | undefined, flavour: path.PlatformPath): string[] {
  if (!searchPath) return [];
  return searchPath
    .split(flavour === path.win32 ? ";" : ":")
    .filter((entry) => entry && flavour.isAbsolute(entry))
    .map((entry) => entry.replace(/[\\/]+$/, "") || entry)
    .filter((entry) => entry !== flavour.parse(entry).root);
}

/** Every granted directory: a write grant is readable too. */
function granted(input: { grantedRead?: string[]; grantedWrite?: string[] }): string[] {
  return [...(input.grantedRead ?? []), ...(input.grantedWrite ?? [])];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** MXC's request document (schema 1.0.0), as much of it as a terminal uses. */
export interface MxcTerminalConfig {
  version: "1.0.0";
  containment: "processcontainer";
  process: { commandLine: string; cwd: string; env: string[] };
  filesystem: { readwritePaths: string[]; readonlyPaths: string[]; deniedPaths: string[] };
  /**
   * Win32k on: without it anything loading user32.dll (PowerShell, git) dies with 0xC0000142.
   * The user's desktop stays out of reach all the same: no clipboard, no keyboard or mouse input.
   */
  ui: { disable: false; clipboard: "none"; injection: false };
  /**
   * Open, or — under `sandbox.allowedHosts` — closed but for the proxy. MXC refuses a proxy
   * without inbound allowed and the host's loopback open; the loopback then reaches the proxy
   * alone (measured: another local service stays out of reach).
   */
  network:
    | { egress: { default: "allow" } }
    | { egress: { default: "allow" }; ingress: { default: "allow" | "deny"; hostLoopback?: "allow" } }
    | { egress: { default: "deny" }; ingress: { default: "allow"; hostLoopback: "allow" } }
    | { egress: { default: "deny" } };
  /** The only way out, with `egress` denied: MXC sets `HTTPS_PROXY` and `HTTP_PROXY` to it. */
  runtimeConfig?: { networkProxy: string };
  /**
   * `filesystem.enumeratePaths`: the folders above a readable one, which a command may list and
   * query but not read a file of (`ancestorsToEnumerate`). `captureDenials`: a diagnosis only
   * (`mxcDiagnosticConfig`), MXC's report of what it refused, enforcement kept.
   */
  processContainer?: {
    filesystem?: { enumeratePaths: string[] };
    captureDenials?: { mode: "block"; outputPath: string };
  };
}

/**
 * The request for a diagnosis of a command (`durable-sandbox-rules`): the command's own request
 * with things taken away, never added, and MXC asked to report what it refused.
 *
 * MXC reports only what its default deny refused, never a path named in `deniedPaths`, and every
 * sibling of the path to the root is named there because the drive is readable for Git
 * (microsoft/mxc#1464). Both go: the siblings alone would leave them readable through the drive.
 * The agent directory and the configuration file stay named — either can sit inside the root,
 * where only its name keeps it out. The network is closed, without a proxy. Built from a request
 * made without the user's grants, so none reaches a diagnosis.
 *
 * `block` only: `allow` lets through what it records. The report is written where `reportPath`
 * says — MXC adds `.<pid>_<hash>` before `.json` — in a directory the command cannot reach.
 */
export function mxcDiagnosticConfig(config: MxcTerminalConfig, keep: { root: string; agentDir?: string; configFile?: string; reportPath: string }): MxcTerminalConfig {
  const drive = path.win32.parse(keep.root).root.toLowerCase();
  const kept = new Set([keep.agentDir, keep.configFile].filter((p): p is string => Boolean(p)).map((p) => p.toLowerCase()));
  const { runtimeConfig: _proxy, ...rest } = config;
  return {
    ...rest,
    filesystem: {
      readwritePaths: [...config.filesystem.readwritePaths],
      readonlyPaths: config.filesystem.readonlyPaths.filter((p) => p.toLowerCase() !== drive),
      deniedPaths: config.filesystem.deniedPaths.filter((p) => kept.has(p.toLowerCase())),
    },
    network: { egress: { default: "deny" } },
    processContainer: { ...config.processContainer, captureDenials: { mode: "block", outputPath: keep.reportPath } },
  };
}

export interface MxcTerminalInput {
  root: string;
  writableRoot?: string;
  allowWrite: boolean;
  agentDir?: string;
  configFile?: string;
  tmp: string;
  shell: string;
  shellArgs: string[];
  cwd: string;
  /** The shell's whole environment: MXC passes the executor's own to nobody. */
  env: Record<string, string>;
  /** Everything beside the path down to the root, from `siblingsToDeny`. */
  siblings: string[];
  /** Single files readable besides the trees: the user's git configuration. */
  readOnlyFiles?: string[];
  /**
   * Inside the writable zone, what stays read-only: the repository's metadata (`heldReadOnlyInside`).
   * The agent's shell only — a terminal is the user's own hand.
   */
  readOnlyInside?: string[];
  /** `sandbox.allowedHosts`' proxy: the network closed but for it. The agent's shell only. */
  networkProxy?: string;
  /**
   * `sandbox.privateNetwork`, without a proxy: the private network reachable — a company's package
   * mirror, git server or proxy — only when the user set it true. Windows opens it in both directions only.
   */
  privateNetwork?: boolean;
  /**
   * `sandbox.hostLoopback`, without a proxy: the host's loopback open (default), so a process
   * reaches a port it listens on itself — Python's `socketpair()` and asyncio need it.
   */
  hostLoopback?: boolean;
  /**
   * The shell's search path: each folder it names is readable, so a program it finds can run —
   * a tool installed for the user (Python in `AppData\Local\Programs`) sits in the denied profile.
   */
  searchPath?: string;
  /** The user's home directory (`%USERPROFILE%`): a search-path entry this broad is left out. */
  home?: string;
  /**
   * Directories the user granted this command beyond the sandbox (`sandboxGrants.ts`): read
   * only, and read-write. A write grant holds even without `allowWrite`: the user asked for it.
   */
  grantedRead?: string[];
  grantedWrite?: string[];
  /** How the installations behind the search path are found (`toolInstallations`): the disk, or a test's. */
  toolReader?: ToolInstallationReader;
  /**
   * The folders above each readable one made listable (`ancestorsToEnumerate`). Unset, as this
   * host's MXC last probed (`baseContainerSupportsEnumeratePaths`): a request naming them where it
   * cannot would be refused.
   */
  enumerateAncestors?: boolean;
  /**
   * The folders above the *grants* (the sandbox cache, the toolchain homes) made listable too.
   * Unset, as this host last proved (`mxcEnumerateLevel`): level 1 enumerates the tools' ancestors
   * only — the profile's folders are the entries a domain machine most often refuses.
   */
  enumerateGrants?: boolean;
  /** What is in an enumerated folder, to deny by name (`deniableEntries`): the disk, or a test's. */
  besideEnumerated?: (dir: string) => string[];
}

/**
 * The folders of a Windows search path a command may read: every absolute entry but those that
 * would undo the sandbox — a drive's root, the home directory or a folder above it, a folder
 * holding the agent directory or the configuration. Compared without case, as Windows does.
 */
export function readableSearchEntries(searchPath: string | undefined, guard: { home?: string; agentDir?: string; configFile?: string }): string[] {
  const lower = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");
  const under = (child: string, parent: string) => lower(child) === lower(parent) || lower(child).startsWith(`${lower(parent)}\\`);
  return searchEntries(searchPath, path.win32).filter(
    (entry) =>
      !(guard.home && under(guard.home, entry)) &&
      !(guard.agentDir && under(guard.agentDir, entry)) &&
      !(guard.configFile && under(guard.configFile, entry)),
  );
}

/** What `toolInstallations` reads of the disk: the real one, or a test's. Each answers false or undefined rather than throw. */
export interface ToolInstallationReader {
  isFile(file: string): boolean;
  isDirectory(directory: string): boolean;
  /** A small text file's content (at most 64 KiB read), or undefined. */
  readText(file: string): string | undefined;
  /** The names in a directory, or none. */
  list(directory: string): string[];
  /** Whether a path is itself a symbolic link or a junction. */
  isLink(target: string): boolean;
  /** Where a link leads, or undefined. */
  resolveLink(target: string): string | undefined;
}

/** Two Windows paths are the same one, without case or a trailing separator. */
function samePath(a: string, b: string): boolean {
  const clean = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
  return clean(a) === clean(b);
}

const diskReader: ToolInstallationReader = {
  isFile: (file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  },
  isDirectory: (directory) => {
    try {
      return statSync(directory).isDirectory();
    } catch {
      return false;
    }
  },
  readText: (file) => {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(file, "r");
      const buffer = Buffer.alloc(64 * 1024);
      const length = readSync(descriptor, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, length).toString("utf8");
    } catch {
      return undefined;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  },
  list: (directory) => {
    try {
      return readdirSync(directory);
    } catch {
      return [];
    }
  },
  isLink: (target) => {
    try {
      const stats = lstatSync(target);
      if (stats.isSymbolicLink()) return true;
      // A junction (scoop's `current`): a directory that Node 24 does not flag as a link,
      // but whose real path is its target's, not its own.
      return stats.isDirectory() && !samePath(realpathSync(target), target);
    } catch {
      return false;
    }
  },
  resolveLink: (target) => {
    try {
      return realpathSync(target);
    } catch {
      return undefined;
    }
  },
};

/**
 * The search-path folders of MSYS2 programs: those holding `msys-2.0.dll` (Git's `usrin`, an MSYS2
 * install's `usrin`). None of their programs can start in MXC's container — the MSYS2 runtime
 * creates named objects in the global namespace a container may not use, and dies with `0xC0000142`
 * (microsoft/mxc#1061) — so they are left out of a confined command's search path, where they would
 * only shadow the native program of the same name (`perl`, `bash`, `find`).
 */
export function msysFolders(searchPath: string | undefined, reader: Pick<ToolInstallationReader, "isFile"> = diskReader): string[] {
  const found = (searchPath ?? "").split(";").filter((entry) => entry && path.win32.isAbsolute(entry) && reader.isFile(path.win32.join(entry, "msys-2.0.dll")));
  // Once each: a PATH often names Git's usr\bin several times, and the startup line listed it thrice.
  const seen = new Set<string>();
  return found.filter((entry) => {
    const key = entry.toLowerCase().replace(/[\\/]+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The MSYS2 program a command names by its path, if any: an `.exe` in a folder holding `msys-2.0.dll`,
 * or one in a search-path folder that does. For the note after its `0xC0000142`.
 */
export function msysProgramNamed(command: string, searchPath: string | undefined, reader: Pick<ToolInstallationReader, "isFile"> = diskReader): string | undefined {
  const folders = msysFolders(searchPath, reader).map((entry) => entry.toLowerCase().replace(/[\\/]+$/, ""));
  for (const match of command.matchAll(/[A-Za-z]:[\\/][^"'`<>|\r\n]*?\.exe\b/gi)) {
    const program = match[0].replaceAll("/", "\\");
    const folder = path.win32.dirname(program);
    if (folders.includes(folder.toLowerCase()) || reader.isFile(path.win32.join(folder, "msys-2.0.dll"))) return program;
  }
  return undefined;
}

/** What ends a command whose MSYS2 program could not start (`0xC0000142`). */
export function msysNote(program: string): string {
  return (
    `[pi-outpost] ${program} is an MSYS2 program (Git Bash's usr\\bin, MSYS2): none of them can start in this sandbox — ` +
    `their runtime needs named objects a container may not create (microsoft/mxc#1061). Use the native program instead: ` +
    `PowerShell or cmd for the shell, a native Perl (Strawberry) for perl, git itself for git.`
  );
}

/** A Windows search path without its MSYS2 folders (`msysFolders`). */
export function withoutMsysFolders(searchPath: string, reader: Pick<ToolInstallationReader, "isFile"> = diskReader): string {
  const dropped = new Set(msysFolders(searchPath, reader).map((entry) => entry.toLowerCase()));
  return searchPath.split(";").filter((entry) => !dropped.has(entry.toLowerCase())).join(";");
}

/** The sandbox cache's place when `sandbox.cacheDir` names none: beside the user's local data, the sandbox's own. */
export function defaultSandboxCache(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(env.LOCALAPPDATA || path.win32.join(homedir(), "AppData", "Local"), "pi-outpost", "sandbox-cache");
}

/** What a confined command under MXC on Windows gets for its toolchains (`windowsToolchains`). */
export interface WindowsToolchains {
  /** The sandbox cache: writable by confined commands, read by nothing unconfined. */
  cacheDir: string;
  /** Where each tool keeps its downloads, and where rustup and uv find what the user installed. */
  env: Record<string, string>;
  /** Toolchain homes that hold no credentials, readable, read only. */
  readable: string[];
  /** The user's package manager configuration, copied in at each launch without credentials (`carryUserConfigs`). */
  carried?: CarriedConfig[];
  /** How a command reaches the registry relay holding the credentials those name; none, and they are left out. */
  relayRoute?: RelayRoute;
}

/** A user's configuration file and where a confined command's tool reads it (`carryUserConfigs`). */
export interface CarriedConfig {
  name: "uv.toml" | "pip.ini" | ".npmrc" | "settings.xml" | "gradle.properties" | "config.toml" | "go env" | "NuGet.Config";
  from: string;
  to: string;
}

/** The first line of every copy: what it is, and that the original is the one to edit. */
const CARRIED_MARK = "# pi-outpost: carried from";
/** The same, in XML: Maven's settings.xml, NuGet's NuGet.Config. */
const CARRIED_XML_MARK = "<!-- pi-outpost: carried from";

/**
 * The user's own configuration of the package managers the sandbox sets up, where a confined command's
 * tool reads it: uv's `uv.toml`, Go's `env` and NuGet's `NuGet.Config` under the sandbox's `APPDATA`
 * (dotnet reads that variable for it, measured), Gradle's `gradle.properties`
 * and Cargo's `config.toml` in their homes in the sandbox cache, and pip's `pip.ini`, npm's `.npmrc` and
 * Maven's `settings.xml` where a variable names them (`windowsToolchains`). Without them a company's
 * mirror declared there is not seen, and every install goes to the public registry the company's
 * firewall refuses.
 */
export function userConfigsToCarry(input: {
  serverEnv: NodeJS.ProcessEnv;
  home?: string;
  cacheDir: string;
  sandboxAppData: string;
  /** Where the sandbox puts Gradle's and Cargo's homes (`GRADLE_USER_HOME`, `CARGO_HOME`). */
  gradleHome?: string;
  cargoHome?: string;
}): CarriedConfig[] {
  const win = path.win32;
  const env = input.serverEnv;
  const roaming = env.APPDATA || (input.home ? win.join(input.home, "AppData", "Roaming") : undefined);
  const inHome = (...parts: string[]) => (input.home ? win.join(input.home, ...parts) : undefined);
  const config = (name: CarriedConfig["name"], from: string | undefined, to: string | undefined): CarriedConfig[] => (from && to ? [{ name, from, to }] : []);
  const userConfig = (file: string) => win.join(input.cacheDir, "user-config", file);
  return [
    ...config("uv.toml", roaming && win.join(roaming, "uv", "uv.toml"), win.join(input.sandboxAppData, "uv", "uv.toml")),
    // pip asks Windows for the roaming folder rather than reading APPDATA: told where its copy is.
    ...config("pip.ini", roaming && win.join(roaming, "pip", "pip.ini"), userConfig("pip.ini")),
    ...config(".npmrc", env.npm_config_userconfig || env.NPM_CONFIG_USERCONFIG || inHome(".npmrc"), userConfig("npmrc")),
    ...config("settings.xml", inHome(".m2", "settings.xml"), userConfig("settings.xml")),
    ...config("gradle.properties", win.join(env.GRADLE_USER_HOME || inHome(".gradle") || "", "gradle.properties"), input.gradleHome && win.join(input.gradleHome, "gradle.properties")),
    ...config("config.toml", win.join(env.CARGO_HOME || inHome(".cargo") || "", "config.toml"), input.cargoHome && win.join(input.cargoHome, "config.toml")),
    // Go reads `go env -w`'s file under APPDATA, which is the sandbox's.
    ...config("go env", env.GOENV || (roaming && win.join(roaming, "go", "env")), win.join(input.sandboxAppData, "go", "env")),
    ...config("NuGet.Config", roaming && win.join(roaming, "NuGet", "NuGet.Config"), win.join(input.sandboxAppData, "NuGet", "NuGet.Config")),
  ].filter((carried) => win.isAbsolute(carried.from) && win.dirname(carried.from) !== win.parse(carried.from).root);
}

/** A key that authenticates, in a `.npmrc`, `gradle.properties`, Cargo's `config.toml` or Go's `env`. */
const SECRET_KEY: Record<CarriedConfig["name"], RegExp | undefined> = {
  "uv.toml": undefined,
  "pip.ini": undefined,
  ".npmrc": /^\s*(?:\/\/[^=]*:)?(?:_authToken|_auth|_password|password|username)\s*=/i,
  "settings.xml": undefined,
  "gradle.properties": /^\s*[^#!=:\s]*(?:password|passwd|pwd|secret|token|credential|apikey|api[._-]key|auth)[^=:\s]*\s*[=:]/i,
  "config.toml": /^\s*(?:token|secret-key|secret_key)\s*=/i,
  "go env": /^\s*GOAUTH\s*=/i,
  "NuGet.Config": undefined,
};

/**
 * A configuration with its credentials taken out: a user and password in any URL
 * (`https://user:pass@mirror/…`); every key that authenticates, by the file's own format — npm's
 * tokens, Gradle's `*Password` and `*Token` properties, Cargo's registry `token`, Go's `GOAUTH`; and in
 * Maven's `settings.xml` the `<servers>` section and every `<username>`, `<password>`, `<passphrase>`
 * and `<privateKey>`; in `NuGet.Config` the `<packageSourceCredentials>` section, and an account's key
 * wherever it stands. The mirror's address stays: one that asks for credentials answers 401, which says
 * what is missing.
 */
export function withoutCredentials(text: string, name: CarriedConfig["name"], relay?: RelayFor): { text: string; leftOut: boolean; relayed: boolean } {
  let leftOut = false;
  const relayedText = relay ? throughRelay(text, name, relay) : { text, relayed: false };
  let body = relayedText.text;
  if (name === "NuGet.Config") {
    const stripped = body
      .replace(/<packageSourceCredentials\b[\s\S]*?<\/packageSourceCredentials>/gi, "")
      .replace(/<add\b[^>]*\bkey\s*=\s*"(?:Username|Password|ClearTextPassword)"[^>]*\/>/gi, "");
    if (stripped !== body) leftOut = true;
    body = stripped;
  }
  if (name === "settings.xml") {
    const stripped = body
      .replace(/<servers\b[\s\S]*?<\/servers>/gi, "")
      .replace(/<servers\s*\/>/gi, "")
      .replace(/<(username|password|passphrase|privateKey)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    if (stripped !== body) leftOut = true;
    body = stripped;
  }
  const secret = SECRET_KEY[name];
  const lines = body.split(/\r?\n/).flatMap((line) => {
    if (secret?.test(line)) {
      leftOut = true;
      return [];
    }
    const cleaned = line.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"'#<>]+@/gi, "$1");
    if (cleaned !== line) leftOut = true;
    return [cleaned];
  });
  return { text: lines.join("\n"), leftOut: leftOut || relayedText.relayed, relayed: relayedText.relayed };
}

/** The base URL a command uses for a registry and its credentials (`RegistryRelay.register`), or none. */
export type RelayFor = (origin: string, authorization: string) => string | undefined;

const basicAuthorization = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
const xmlText = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const xmlAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** `url` at the relay, for that registry and those credentials; undefined when it cannot be relayed. */
function relayedUrl(url: string, authorization: string, relay: RelayFor): string | undefined {
  const origin = registryOrigin(url);
  if (!origin) return undefined;
  const base = relay(origin, authorization);
  if (!base) return undefined;
  const parsed = new URL(url);
  return base + `${parsed.pathname}${parsed.search}`.replace(/^\//, "");
}

/**
 * Each registry the file authenticates to, named at the relay instead (`registryRelay.ts`): the
 * credentials go to the server, the copy keeps none. By the file's own format — a `user:pass@` in a URL
 * anywhere; npm's `//registry/:_authToken`, `_auth`, `username` and `_password` for the `registry`
 * lines they cover; Maven's `<server>` for the `<mirror>`, `<repository>` and `<pluginRepository>` of
 * its id; NuGet's `<packageSourceCredentials>` for the source of its key. A credential this cannot
 * pair with a URL (an encrypted Maven or NuGet password, Gradle's properties, Cargo's tokens) stays
 * out of the copy, unrelayed.
 */
function throughRelay(text: string, name: CarriedConfig["name"], relay: RelayFor): { text: string; relayed: boolean } {
  let relayed = false;
  const swap = (url: string, authorization: string) => {
    const through = relayedUrl(url, authorization, relay);
    if (through) relayed = true;
    return through;
  };
  let out = text;
  if (name === ".npmrc") out = npmThroughRelay(out, swap);
  if (name === "settings.xml") {
    const servers = new Map<string, string>();
    for (const [, body] of out.matchAll(/<server>([\s\S]*?)<\/server>/gi)) {
      const id = /<id>\s*([^<]*?)\s*<\/id>/i.exec(body!)?.[1];
      const user = /<username>([^<]*)<\/username>/i.exec(body!)?.[1];
      const password = /<password>([^<]*)<\/password>/i.exec(body!)?.[1];
      // `{…}` is encrypted with the user's master password: nothing here can use it.
      if (id && user !== undefined && password !== undefined && !/^\{.*\}$/.test(password.trim())) servers.set(id, basicAuthorization(xmlText(user), xmlText(password)));
    }
    out = out.replace(/<(mirror|repository|pluginRepository)>([\s\S]*?)<\/\1>/gi, (block, _tag: string, body: string) => {
      const authorization = servers.get(/<id>\s*([^<]*?)\s*<\/id>/i.exec(body)?.[1] ?? "");
      if (!authorization) return block;
      return block.replace(/<url>\s*([^<]*?)\s*<\/url>/i, (whole, url: string) => {
        const through = swap(xmlText(url), authorization);
        return through ? `<url>${xmlAttribute(through)}</url>` : whole;
      });
    });
  }
  if (name === "NuGet.Config") {
    const credentials = new Map<string, string>();
    for (const [, section] of out.matchAll(/<packageSourceCredentials>([\s\S]*?)<\/packageSourceCredentials>/gi)) {
      for (const [, element, body] of section!.matchAll(/<([\w.:-]+)>([\s\S]*?)<\/\1>/g)) {
        const value = (key: string) => new RegExp(`<add\\s+key="${key}"\\s+value="([^"]*)"`, "i").exec(body!)?.[1];
        const user = value("Username");
        const password = value("ClearTextPassword");
        // A source's name is its element's, spaces written `_x0020_`. `Password` is DPAPI-encrypted: not usable here.
        const source = element!.replace(/_x([0-9a-f]{4})_/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        if (user !== undefined && password !== undefined) credentials.set(source.toLowerCase(), basicAuthorization(xmlText(user), xmlText(password)));
      }
    }
    out = out.replace(/<packageSources>([\s\S]*?)<\/packageSources>/gi, (sources) =>
      sources.replace(/<add\b([^>]*?)\/>/gi, (add, attributes: string) => {
        const key = /\bkey\s*=\s*"([^"]*)"/i.exec(attributes)?.[1];
        const url = /\bvalue\s*=\s*"([^"]*)"/i.exec(attributes)?.[1];
        const authorization = key && credentials.get(xmlText(key).toLowerCase());
        if (!authorization || url === undefined) return add;
        const through = swap(xmlText(url), authorization);
        if (!through) return add;
        // The relay speaks HTTP on the loopback; NuGet refuses an HTTP source unless told.
        const insecure = /allowInsecureConnections/i.test(attributes) ? "" : ' allowInsecureConnections="true"';
        return `<add${attributes.replace(/\bvalue\s*=\s*"[^"]*"/i, `value="${xmlAttribute(through)}"`).trimEnd()}${insecure} />`;
      }),
    );
  }
  // A user and password in a URL, in any of them: uv's indexes, pip's, Go's GOPROXY, a Maven URL.
  out = out.replace(/\bhttps?:\/\/[^\s/@"'#<>]+@[^\s"'<>,;]+/gi, (whole) => {
    if (!URL.canParse(whole)) return whole;
    const parsed = new URL(whole);
    if (!parsed.username && !parsed.password) return whole;
    const authorization = basicAuthorization(decodeURIComponent(parsed.username), decodeURIComponent(parsed.password));
    parsed.username = "";
    parsed.password = "";
    return swap(parsed.toString().replace(/\/$/, whole.endsWith("/") ? "/" : ""), authorization) ?? whole;
  });
  return { text: out, relayed };
}

/** npm's registries at the relay, with the credentials its `//registry/:…` keys give them. */
function npmThroughRelay(text: string, swap: (url: string, authorization: string) => string | undefined): string {
  const expand = (value: string) => value.trim().replace(/^"(.*)"$/, "$1").replace(/\$\{([^}]+)\}/g, (_m, variable: string) => process.env[variable] ?? "");
  const scoped = new Map<string, { token?: string; auth?: string; username?: string; password?: string }>();
  const top: { auth?: string; username?: string; password?: string } = {};
  for (const line of text.split(/\r?\n/)) {
    const keyed = /^\s*(\/\/[^=]+?):(_authToken|_auth|username|_password)\s*=\s*(.*)$/i.exec(line);
    if (keyed) {
      const entry = scoped.get(keyed[1]!) ?? {};
      const value = expand(keyed[3]!);
      const field = keyed[2]!.toLowerCase();
      if (field === "_authtoken") entry.token = value;
      else if (field === "_auth") entry.auth = value;
      else if (field === "username") entry.username = value;
      else entry.password = value;
      scoped.set(keyed[1]!, entry);
      continue;
    }
    const plain = /^\s*(_auth|username|_password)\s*=\s*(.*)$/i.exec(line);
    if (plain) {
      const field = plain[1]!.toLowerCase();
      if (field === "_auth") top.auth = expand(plain[2]!);
      else if (field === "username") top.username = expand(plain[2]!);
      else top.password = expand(plain[2]!);
    }
  }
  const authorizationFor = (url: string): string | undefined => {
    if (!URL.canParse(url)) return undefined;
    const parsed = new URL(url);
    const at = `//${parsed.host}${parsed.pathname}`.toLowerCase();
    const match = [...scoped.entries()].filter(([key]) => at.startsWith(key.toLowerCase().replace(/\/?$/, "/")) || at === key.toLowerCase()).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
    const entry = match ?? top;
    if ("token" in entry && entry.token) return `Bearer ${entry.token}`;
    if (entry.auth) return `Basic ${entry.auth}`;
    if (entry.username && entry.password) return basicAuthorization(entry.username, Buffer.from(entry.password, "base64").toString("utf8"));
    return undefined;
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const registry = /^(\s*(?:@[^:=\s]+:)?registry\s*=\s*)(\S+)\s*$/i.exec(line);
      if (!registry) return line;
      const authorization = authorizationFor(registry[2]!);
      const through = authorization ? swap(registry[2]!, authorization) : undefined;
      return through ? `${registry[1]}${through}` : line;
    })
    .join("\n");
}

/** The copy as written: its mark first, in the file's own comment syntax. */
function carriedCopy(config: CarriedConfig, text: string, leftOut: boolean, relayed = false): string {
  const said = `${config.from}${relayed ? ", its registries through pi-outpost's relay, which keeps the credentials" : leftOut ? ", credentials left out" : ""}; edit that one.`;
  if (config.name === "settings.xml" || config.name === "NuGet.Config") {
    // A comment may not precede the XML declaration: it goes, the document is UTF-8 either way.
    return `${CARRIED_XML_MARK} ${said.replaceAll("--", "- -")} -->\n${text.replace(/^﻿?\s*<\?xml[^>]*\?>\s*/i, "")}`;
  }
  return `${CARRIED_MARK} ${said}\n${text}`;
}

/**
 * Each configuration copied where the confined tool reads it, at each launch so an edit of the
 * original applies to the next command; the copy of one the user removed is removed. Only a file
 * bearing the copy's mark is ever replaced or removed: one a command wrote there is left alone.
 * Best effort: a configuration that cannot be copied leaves the tool on its defaults.
 */
export async function carryUserConfigs(carried: readonly CarriedConfig[], route?: RelayRoute, relayed: () => Promise<RegistryRelay> = registryRelay): Promise<void> {
  const fsp = await import("node:fs/promises");
  // The relay starts with the first configuration that authenticates to a registry.
  let relay: RegistryRelay | undefined;
  for (const config of carried) {
    try {
      const existing = await fsp.readFile(config.to, "utf8").catch(() => undefined);
      const ours = existing === undefined || existing.startsWith(CARRIED_MARK) || existing.startsWith(CARRIED_XML_MARK);
      const source = await fsp.readFile(config.from, "utf8").catch(() => undefined);
      if (source === undefined) {
        if (existing !== undefined && ours) await fsp.rm(config.to, { force: true });
        continue;
      }
      if (!ours) continue;
      let result = withoutCredentials(source, config.name);
      if (route && result.leftOut) {
        relay ??= await relayed();
        const through = relay;
        result = withoutCredentials(source, config.name, (origin, authorization) => through.register(origin, authorization, route));
      }
      const copy = carriedCopy(config, result.text, result.leftOut, result.relayed);
      if (copy === existing) continue;
      await fsp.mkdir(path.win32.dirname(config.to), { recursive: true });
      // Commands start side by side: each writes its own file and renames it into place.
      const temporary = `${config.to}.${process.pid}.${Math.random().toString(36).slice(2)}`;
      await fsp.writeFile(temporary, copy);
      await fsp.rename(temporary, config.to).catch(async () => fsp.rm(temporary, { force: true }));
    } catch {
      // The tool keeps its defaults.
    }
  }
}

/** For the startup line: which configurations are carried in, and which lose their credentials. */
export function carriedSummary(carried: readonly CarriedConfig[], read: (file: string) => string | undefined = diskReader.readText, route?: RelayRoute): string | undefined {
  const present = carried.flatMap((config) => {
    const text = read(config.from);
    if (text === undefined) return [];
    if (!withoutCredentials(text, config.name).leftOut) return [config.name];
    // Whether its registries would go through the relay: a stand-in relay that names every one.
    const relayed = route !== undefined && withoutCredentials(text, config.name, () => "http://relay/").relayed;
    return [`${config.name} (${relayed ? "credentials kept in the server, its registries relayed" : "credentials left out"})`];
  });
  return present.length === 0 ? undefined : `your ${present.join(", ")} carried in`;
}

/**
 * Where a confined command's tools keep their downloads, and the toolchains it may read.
 *
 * Each tool's cache or home is a folder of the sandbox cache, so a dependency is downloaded once per
 * user rather than once per command, and never into the user's own caches, which sit beside
 * credentials (`~\.cargo\credentials.toml`, `~\.m2\settings.xml`, `~\.gradle\gradle.properties`) and
 * whose packages run unconfined later. `APPDATA` too, so npm's global prefix and per-user state land
 * there and not in the project. rustup's home and the Pythons uv installed hold toolchains and no
 * credentials: they are read where they are, named in the environment, when they exist and pass the
 * search path's guard.
 */
export function windowsToolchains(
  input: {
    cacheDir: string;
    serverEnv: NodeJS.ProcessEnv;
    home?: string;
    agentDir?: string;
    configFile?: string;
    /** `sandbox.toolEnvironment`, checked at load: applied last, `${cache}` standing for `cacheDir`. */
    toolEnvironment?: Record<string, string>;
    /** How a command reaches the registry relay (`registryRelay.ts`): its proxy, or the host's loopback. */
    relayRoute?: RelayRoute;
  },
  reader: ToolInstallationReader = diskReader,
): WindowsToolchains {
  const win = path.win32;
  const at = (...parts: string[]) => win.join(input.cacheDir, ...parts);
  const env: Record<string, string> = {
    CARGO_HOME: at("cargo"),
    GRADLE_USER_HOME: at("gradle"),
    GOPATH: at("go"),
    GOMODCACHE: at("go", "pkg", "mod"),
    GOCACHE: at("go", "build"),
    MAVEN_OPTS: `-Dmaven.repo.local=${at("m2", "repository")}`,
    NUGET_PACKAGES: at("nuget", "packages"),
    DOTNET_CLI_HOME: at("dotnet"),
    // Its first-run banner (welcome, telemetry, certificate) is otherwise the first thing the agent reads.
    DOTNET_NOLOGO: "1",
    BUN_INSTALL_CACHE_DIR: at("bun", "install-cache"),
    // bun moves what it downloads from its temporary folder into its cache: the same volume.
    BUN_TMPDIR: at("bun", "tmp"),
    npm_config_cache: at("npm"),
    UV_CACHE_DIR: at("uv"),
    PIP_CACHE_DIR: at("pip"),
    APPDATA: at("appdata", "Roaming"),
  };
  const lower = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");
  const under = (child: string, parent: string) => lower(child) === lower(parent) || lower(child).startsWith(`${lower(parent)}\\`);
  const allowed = (folder: string) =>
    win.isAbsolute(folder) &&
    folder !== win.parse(folder).root &&
    !(input.home && under(input.home, folder)) &&
    ![input.agentDir, input.configFile].some((secret) => secret && (under(secret, folder) || under(folder, secret)));
  const readable: string[] = [];
  const home = (variable: string, fallback: string | undefined) => {
    const folder = input.serverEnv[variable] || fallback;
    if (folder === undefined || !allowed(folder) || !reader.isDirectory(folder)) return;
    readable.push(folder);
    env[variable] = folder;
  };
  const roaming = input.serverEnv.APPDATA || (input.home ? win.join(input.home, "AppData", "Roaming") : undefined);
  home("RUSTUP_HOME", input.home ? win.join(input.home, ".rustup") : undefined);
  home("UV_PYTHON_INSTALL_DIR", roaming ? win.join(roaming, "uv", "python") : undefined);
  // The user's package manager configuration, without credentials (`carryUserConfigs`): where each
  // confined tool reads it, or named to it.
  const carried = userConfigsToCarry({
    serverEnv: input.serverEnv,
    home: input.home,
    cacheDir: input.cacheDir,
    sandboxAppData: env.APPDATA!,
    gradleHome: env.GRADLE_USER_HOME,
    cargoHome: env.CARGO_HOME,
  });
  // Named only when the user's file exists: a MAVEN_ARGS pointing at no settings.xml breaks every mvn.
  const copyOf = (name: CarriedConfig["name"]) => {
    const found = carried.find((config) => config.name === name);
    return found && reader.isFile(found.from) ? found.to : undefined;
  };
  const npmrc = copyOf(".npmrc");
  if (npmrc) env.npm_config_userconfig = npmrc;
  const pipIni = copyOf("pip.ini");
  if (pipIni) env.PIP_CONFIG_FILE = pipIni;
  // Maven 3.9 and later read arguments from MAVEN_ARGS: the settings file is one.
  const mavenSettings = copyOf("settings.xml");
  if (mavenSettings) env.MAVEN_ARGS = `-s "${mavenSettings}"`;
  // The operator's own, for tools the table does not name or to replace its entries.
  for (const [name, value] of Object.entries(input.toolEnvironment ?? {})) env[name] = value.replaceAll("${cache}", input.cacheDir);
  return { cacheDir: input.cacheDir, env, readable, carried, ...(input.relayRoute ? { relayRoute: input.relayRoute } : {}) };
}

/** A search-path folder by one of these names is part of an installation, the folder above it. */
const INSTALLATION_FOLDERS = new Set(["bin", "cmd", "scripts", "sbin"]);

/** How many entries of one folder are looked at for launchers: a folder of links, not a system directory. */
const LAUNCHERS_LOOKED_AT = 400;

/**
 * The installations a Windows search path only points at, and the project's virtual environment
 * stands on: each made readable, read only, beside the search path's own folders.
 *
 * A folder on `PATH` often holds launchers whose program is elsewhere, so the folder alone runs
 * nothing: Git for Windows' `cmd\git.exe` starts `mingw64\bin\git.exe`; scoop's `shims\x.exe`
 * reads `x.shim` for the program's path; WinGet's `Links` and nvm-windows' folder are links. And a
 * virtual environment's `python.exe` (uv's, venv's) loads the interpreter its `pyvenv.cfg` names in
 * `home`. Each is followed one step to the installation it names, and taken only if it is one:
 * Git's own layout, a file the shim names, a link's target, a folder holding `python.exe` and `Lib`.
 *
 * `pyvenv.cfg` is in the project, which the agent writes: its `home` is taken only when that folder
 * is a Python installation, so it cannot name an arbitrary folder into the sandbox. Every folder
 * taken passes the search path's own guard: never the home directory or a folder above it, nor one
 * holding — or inside — the agent directory or the configuration, nor a drive's root.
 */
export function toolInstallations(
  input: { root: string; searchPath?: string; home?: string; agentDir?: string; configFile?: string },
  reader: ToolInstallationReader = diskReader,
): string[] {
  const win = path.win32;
  const lower = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");
  const under = (child: string, parent: string) => lower(child) === lower(parent) || lower(child).startsWith(`${lower(parent)}\\`);
  const allowed = (folder: string) =>
    win.isAbsolute(folder) &&
    folder !== win.parse(folder).root &&
    !(input.home && under(input.home, folder)) &&
    ![input.agentDir, input.configFile].some((secret) => secret && (under(secret, folder) || under(folder, secret)));
  const found: string[] = [];
  const take = (folder: string | undefined) => {
    if (folder === undefined) return;
    const clean = folder.replace(/[\\/]+$/, "");
    // One folder per installation: one already covered adds nothing, a wider one replaces those inside it.
    if (!allowed(clean) || found.some((known) => under(clean, known))) return;
    for (let i = found.length - 1; i >= 0; i--) if (under(found[i]!, clean)) found.splice(i, 1);
    found.push(clean);
  };

  for (const entry of readableSearchEntries(input.searchPath, input)) {
    const name = win.basename(entry).toLowerCase();
    const parent = win.dirname(entry);
    // An installation keeps the rest of itself beside the folder PATH names: gcc's libexec, CMake's
    // share, Maven's boot. Its folder above a bin, cmd, Scripts or sbin, under the same guard — and
    // never a folder directly in the home directory (~\.cargo holds credentials.toml, ~\.bun and ~\go
    // a user's own state), whose bin needs nothing beside it.
    if (INSTALLATION_FOLDERS.has(name) && !(input.home && lower(win.dirname(parent)) === lower(input.home))) take(parent);
    // Git for Windows: cmd\ and bin\ hold launchers for mingw64\bin\git.exe, which needs usr\bin
    // beside it; mingw64\bin and usr\bin on PATH are inside the same installation.
    const parentName = win.basename(parent).toLowerCase();
    const gitRoot = name === "cmd" ? parent : name === "bin" ? (parentName === "mingw64" || parentName === "usr" ? win.dirname(parent) : parent) : undefined;
    if (gitRoot !== undefined && reader.isFile(win.join(gitRoot, "mingw64", "bin", "git.exe"))) take(gitRoot);
    // The folder itself a link (nvm-windows' symlink to the active version): its target.
    if (reader.isLink(entry)) take(reader.resolveLink(entry));
    // Only folders of the user's own installs are looked into: links and shims live there, and a
    // system directory would be thousands of names read on every launch. And a folder named `shims`
    // anywhere: scoop installed globally, or for a machine, keeps them in `C:\…\scoop\shims` (#554).
    if (name !== "shims" && (!input.home || !under(entry, input.home))) continue;
    const names = reader.list(entry).slice(0, LAUNCHERS_LOOKED_AT);
    for (const file of names) {
      const full = win.join(entry, file);
      if (file.toLowerCase().endsWith(".shim")) {
        // scoop: `path = "C:\…\app.exe"`.
        const target = /^\s*path\s*=\s*"?([^"\r\n]+?)"?\s*$/im.exec(reader.readText(full) ?? "")?.[1];
        if (target !== undefined && win.isAbsolute(target) && reader.isFile(target)) take(win.dirname(target));
      } else if (reader.isLink(full)) {
        // WinGet's Links: each a link to the program in its package folder.
        const target = reader.resolveLink(full);
        if (target !== undefined && reader.isFile(target)) take(win.dirname(target));
      }
    }
  }

  // The project's virtual environment: its launcher loads the interpreter `home` names.
  const home = /^\s*home\s*=\s*(.+?)\s*$/im.exec(reader.readText(win.join(input.root, ".venv", "pyvenv.cfg")) ?? "")?.[1];
  if (home !== undefined && reader.isFile(win.join(home, "python.exe")) && reader.isDirectory(win.join(home, "Lib"))) take(home);
  return found;
}

/**
 * What one terminal may touch, as MXC's tier 1 reads it.
 *
 * The root's drive is readable and everything beside the path down to the root is denied
 * by name (`siblings`): Git for Windows finds its working directory by listing every
 * parent folder, because the sandbox cannot reach the Mount Manager to turn a handle back
 * into a `C:\` path (microsoft/mxc#1464). Without the drive, git cannot run a single
 * command that needs its work tree. A more specific allow wins over a deny, so the root,
 * the temporary directory (under the denied profile) and the shell's folder stay usable.
 *
 * The root is readable rather than only writable when no writable zone covers it: a
 * `readonlyPaths` folder cannot be listed nor be a working directory under tier 1, so
 * `cd` into a read-only subfolder is refused. That is the sandbox's, and it is documented.
 */
export function mxcTerminalConfig(input: MxcTerminalInput): MxcTerminalConfig {
  const drive = path.win32.parse(input.root).root;
  const writable = input.allowWrite ? [input.writableRoot ?? input.root] : [];
  const shellDir = path.win32.isAbsolute(input.shell) ? [path.win32.dirname(input.shell)] : [];
  const readwritePaths = unique([...writable, ...(input.grantedWrite ?? []), input.tmp]);
  // The search path's folders, and a granted directory beside the root, each a more specific
  // allow inside the denied siblings and profile: `siblings` needs no change.
  const reader = input.toolReader ?? diskReader;
  const linkTarget = (folder: string): string | undefined => {
    try {
      return reader.isLink(folder) ? reader.resolveLink(folder) : undefined;
    } catch {
      return undefined;
    }
  };
  const tools = [
    ...readableSearchEntries(input.searchPath, { home: input.home, agentDir: input.agentDir, configFile: input.configFile }),
    ...toolInstallations(input, reader),
  ];
  // A tool that is itself a link (scoop's `current` junction to the active version, nvm-windows'
  // folder): where it leads is readable like the link — resolving any path through the junction
  // needs the target allowed, never denied as beside the way down (issue #562).
  const toolKeys = new Set(tools.map((p) => p.toLowerCase()));
  for (let i = 0; i < tools.length; i++) {
    const target = linkTarget(tools[i]!);
    if (target === undefined) continue;
    const key = target.toLowerCase().replace(/[\\/]+$/, "");
    if (toolKeys.has(key)) continue;
    toolKeys.add(key);
    tools.push(target);
  }
  const readonlyPaths = unique([drive, input.root, ...shellDir, ...tools, ...(input.readOnlyFiles ?? []), ...(input.grantedRead ?? []), ...(input.readOnlyInside ?? [])].filter((p) => !readwritePaths.includes(p)));
  const allowed = new Set([...readwritePaths, ...readonlyPaths].map((p) => p.toLowerCase()));
  const enumeratePaths = !(input.enumerateAncestors ?? mxcEnumerates)
    ? []
    // What a command opens beside the root by path: the search path's tools and — at level 0 — the
    // grants. Not the temporary directory, under a profile of hundreds of entries each to deny, nor
    // git's single files.
    : ancestorsToEnumerate(
        [...shellDir, ...tools, ...((input.enumerateGrants ?? mxcEnumerateGrants) ? [...(input.grantedRead ?? []), ...(input.grantedWrite ?? [])] : [])],
        {
          root: input.root,
          siblings: input.siblings,
          readable: [...readwritePaths, ...readonlyPaths],
          agentDir: input.agentDir,
          configFile: input.configFile,
          linkTarget,
          ...(input.home ? { home: input.home } : {}),
        },
      );
  const enumerated = new Set(enumeratePaths.map((p) => p.toLowerCase()));
  // MXC enumerates a folder's whole subtree: what is beside the way down is denied by name in
  // each, as the siblings of the path to the root are, so a listing shows those names alone.
  const onTheWay = new Set([...allowed, ...enumerated].map((p) => p.replace(/[\\/]+$/, "")));
  const besideTheWay = enumeratePaths.flatMap((dir) => (input.besideEnumerated ?? deniableEntries)(dir).filter((entry) => !onTheWay.has(entry.toLowerCase())));
  const deniedPaths = unique([...input.siblings, ...besideTheWay, input.agentDir, input.configFile].filter((p): p is string => Boolean(p)))
    // Denying a path that is also allowed leaves which one wins to the sandbox: never ask.
    .filter((p) => !allowed.has(p.toLowerCase()) && !enumerated.has(p.toLowerCase()));
  return {
    version: "1.0.0",
    containment: "processcontainer",
    process: {
      commandLine: [input.shell, ...input.shellArgs].map(quoteWindowsArgument).join(" "),
      cwd: input.cwd,
      env: Object.entries(input.env).map(([name, value]) => `${name}=${value}`),
    },
    filesystem: { readwritePaths, readonlyPaths, deniedPaths },
    // MXC's defaults deny both today; written out so a change of default cannot open them.
    ui: { disable: false, clipboard: "none", injection: false },
    // Without a proxy, the host's loopback is open unless `sandbox.hostLoopback` is false:
    // Windows lets a contained process reach even its own listener only through it (measured,
    // mxc-sdk 1.1.0 on 10.0.26100: `socketpair()` hangs in `accept` under every other shape;
    // microsoft/mxc#1261). Other loopback services become reachable; the server is not, without
    // its token.
    // And the private network is closed unless the user opened it (`sandbox.privateNetwork: true`):
    // Windows refuses an outbound connection to it — the subnets this machine is on, and intranet
    // ranges a policy names — with WSAEACCES (10013) unless inbound from it is allowed too; an
    // egress allow rule naming the ranges does not do it (measured, same build; issue #552).
    // Opened, inbound passes the sandbox, not the firewall.
    ...(input.networkProxy === undefined
      ? {
          network: {
            egress: { default: "allow" },
            ...(input.hostLoopback === false && input.privateNetwork !== true
              ? {}
              : { ingress: { default: input.privateNetwork === true ? "allow" : "deny", ...(input.hostLoopback === false ? {} : { hostLoopback: "allow" }) } }),
          },
        }
      : {
          network: { egress: { default: "deny" }, ingress: { default: "allow", hostLoopback: "allow" } },
          runtimeConfig: { networkProxy: input.networkProxy },
        }),
    ...(enumeratePaths.length > 0 ? { processContainer: { filesystem: { enumeratePaths } } } : {}),
  };
}

/**
 * The folders above each readable one, up to (not including) its drive's root: listed and queried,
 * never read (MXC's `enumeratePaths`, `baseContainerSupportsEnumeratePaths`).
 *
 * A readable folder beside the root — a tool on `PATH` (`C:\dev\nodejs`), a grant — sits under a
 * folder the command may not touch: denied by name as a sibling of the path to the root, or under
 * no allow at all. Opening a file inside works (Windows does not check the folders above), but
 * resolving a path does not: Node's `realpathSync` `lstat`s every component from the drive down,
 * so any script or module outside the root died on `EPERM: lstat 'C:\dev'` (issue #553), and
 * PowerShell's and cmd's command lookup, which query the folder, found nothing there.
 *
 * Only a folder nothing else lets the command read: on another drive than the root's, or a sibling
 * of the path to the root (or inside one) — never one the root's readable drive already covers,
 * where enumeration, the more specific rule, would take reading away. Enumerating a folder shows the
 * names in its whole subtree and their metadata, never one byte of a file; `mxcTerminalConfig`
 * denies by name what lies beside the way down, so only those names show. The agent directory and
 * the configuration file are never enumerated, nor any folder inside them. Nor a folder directly in
 * the home but `AppData`, as `toolInstallations` never opens one: `~\.cargo` holds `credentials.toml`,
 * and a tool there is a program, which needs nothing above its folder — Node's CLIs live in `AppData`.
 *
 * A link on the way down (scoop's `current` junction to the active version) is never enumerated:
 * listing it would show its target's children, each then denied by name as beside the way. Its
 * target is readable where it was taken (`mxcTerminalConfig`), and the walk goes on above the link.
 */
export function ancestorsToEnumerate(
  opened: readonly string[],
  guard: {
    root: string;
    siblings: readonly string[];
    readable?: readonly string[];
    agentDir?: string;
    configFile?: string;
    home?: string;
    /** Where a folder on the way down leads when it is itself a link (a junction), if anywhere. */
    linkTarget?: (dir: string) => string | undefined;
  },
): string[] {
  const win = path.win32;
  const lower = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");
  const under = (child: string, parent: string) => child === parent || child.startsWith(`${parent}\\`);
  const secrets = [guard.agentDir, guard.configFile].filter((p): p is string => Boolean(p)).map(lower);
  const rootDrive = lower(win.parse(guard.root).root);
  const siblings = guard.siblings.map(lower);
  // Readable folders other than the drive: a folder inside one is read, not merely enumerated.
  const reading = (guard.readable ?? opened).filter((p) => win.isAbsolute(p) && lower(p) !== lower(win.parse(p).root)).map(lower);
  const covered = (key: string) =>
    reading.some((p) => under(key, p)) || (key.startsWith(rootDrive) && !siblings.some((sibling) => under(key, sibling)));
  const found: string[] = [];
  const seen = new Set<string>();
  for (const entry of opened) {
    if (!win.isAbsolute(entry)) continue;
    const drive = lower(win.parse(entry).root);
    let dir = win.dirname(entry.replace(/[\\/]+$/, ""));
    while (lower(dir) !== drive && lower(dir) !== lower(win.dirname(dir))) {
      const key = lower(dir);
      if (seen.has(key)) break; // Its own ancestors are already decided.
      seen.add(key);
      // A link on the way down is not enumerated (see above); the walk goes on above it.
      if (guard.linkTarget !== undefined && guard.linkTarget(dir) !== undefined) {
        dir = win.dirname(dir);
        continue;
      }
      const inTheHome = guard.home !== undefined && lower(win.dirname(dir)) === lower(guard.home) && win.basename(dir).toLowerCase() !== "appdata";
      if (!covered(key) && !inTheHome && !secrets.some((secret) => under(key, secret))) found.push(dir);
      dir = win.dirname(dir);
    }
  }
  return found;
}

/** The entries of a folder MXC can deny by name (`deniable`), or none when it cannot be listed. */
export function deniableEntries(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.map((name) => path.join(dir, name)).filter(deniable);
}

/**
 * MXC's request on Linux (schema 1.0.0), for its Bubblewrap backend: a namespace holding only
 * what is mounted into it. `/dev` and `/proc` are the sandbox's own (its processes alone).
 */
export interface MxcLinuxConfig {
  version: "1.0.0";
  containment: "bubblewrap";
  process: { commandLine: string; cwd: string; env: string[] };
  filesystem: { readwritePaths: string[]; readonlyPaths: string[]; deniedPaths: string[] };
  /**
   * Open, or — under `sandbox.allowedHosts` — closed but for the proxy. Unlike Windows,
   * Bubblewrap refuses inbound traffic beside a proxy: its namespace is reached through
   * slirp4netns, which forwards no port in.
   */
  network: { egress: { default: "allow" } } | { egress: { default: "deny" }; ingress: { default: "deny" } };
  /** The only way out, with `egress` denied: MXC rewrites `HTTPS_PROXY` to slirp's address for it. */
  runtimeConfig?: { networkProxy: string };
}

export interface MxcLinuxInput {
  root: string;
  writableRoot?: string;
  allowWrite: boolean;
  agentDir?: string;
  configFile?: string;
  tmp: string;
  shell: string;
  shellArgs: string[];
  cwd: string;
  /** The command's whole environment. The runner gets the same minimal one: `bwrap` shows its own inside. */
  env: Record<string, string>;
  /** The shell's search path: an installation it points into is mounted read-only. */
  searchPath?: string;
  /** Single files readable besides the trees: the user's git configuration. */
  readOnlyFiles?: string[];
  /**
   * Inside the writable zone, what stays read-only: the repository's metadata (`heldReadOnlyInside`).
   * The agent's shell only — a terminal is the user's own hand.
   */
  readOnlyInside?: string[];
  /** `sandbox.allowedHosts`' proxy: the network closed but for it. The agent's shell only. */
  networkProxy?: string;
  /** Which paths exist: only those are mounted. A parameter for tests. */
  exists?: (file: string) => boolean;
  /**
   * Directories the user granted this command beyond the sandbox (`sandboxGrants.ts`): read
   * only, and read-write. A write grant holds even without `allowWrite`: the user asked for it.
   */
  grantedRead?: string[];
  grantedWrite?: string[];
}

/** The system trees a Linux shell needs, those this host has. Not `/dev`, `/proc`: the sandbox's own. */
export function linuxSystemTrees(exists: (file: string) => boolean = existsSync): string[] {
  return ["/usr", "/etc", "/lib", "/lib32", "/lib64", "/libx32", "/bin", "/sbin", "/run/systemd/resolve"].filter((tree) => exists(tree));
}

/**
 * What one command or terminal may touch under MXC on Linux.
 *
 * An allowlist by construction: Bubblewrap's namespace holds the system trees, the tool
 * installations on the search path, the root and the temporary directory, mounted
 * read-only or writable, and nothing else — no other project, no home, no agent directory.
 * The agent directory and the configuration are still denied by name, which holds when
 * they sit under a mounted tree. A writable zone narrower than the root is a writable mount
 * inside the read-only root.
 */
export function mxcLinuxConfig(input: MxcLinuxInput): MxcLinuxConfig {
  const exists = input.exists ?? existsSync;
  const writable = input.allowWrite ? [input.writableRoot ?? input.root] : [];
  const readwritePaths = unique([...writable, ...(input.grantedWrite ?? []), input.tmp]);
  const shellDir = path.posix.isAbsolute(input.shell) ? [path.posix.dirname(input.shell)] : [];
  const readonlyPaths = unique([
    ...linuxSystemTrees(exists),
    ...toolTrees(input.searchPath, path.posix).filter((tree) => exists(tree)),
    ...shellDir,
    input.root,
    ...(input.readOnlyFiles ?? []),
    ...(input.grantedRead ?? []),
  ])
    .filter((p) => !readwritePaths.includes(p) && !readwritePaths.some((rw) => isUnder(p, rw)))
    // Inside the writable zone, held read-only on purpose: Bubblewrap's later read-only bind wins (measured).
    .concat(input.readOnlyInside ?? []);
  const deniedPaths = unique([input.agentDir, input.configFile].filter((p): p is string => Boolean(p)));
  return {
    version: "1.0.0",
    containment: "bubblewrap",
    process: {
      commandLine: [input.shell, ...input.shellArgs].map(quotePosixArgument).join(" "),
      cwd: input.cwd,
      env: Object.entries(input.env).map(([name, value]) => `${name}=${value}`),
    },
    filesystem: { readwritePaths, readonlyPaths, deniedPaths },
    ...(input.networkProxy === undefined
      ? { network: { egress: { default: "allow" } } }
      : { network: { egress: { default: "deny" }, ingress: { default: "deny" } }, runtimeConfig: { networkProxy: input.networkProxy } }),
  };
}

/** MXC's request on macOS: Linux's document, run by Seatbelt. */
export type MxcMacConfig = Omit<MxcLinuxConfig, "containment"> & { containment: "seatbelt"; seatbelt: { extraMachLookups: string[] } };

export interface MxcMacInput extends MxcLinuxInput {
  /** The developer tools' directory (`xcode-select -p`): git lives there. Default: asked once. */
  developerDir?: string | null;
  /** A path as Seatbelt sees it, symlinks resolved. A parameter for tests. */
  realPath?: (file: string) => string;
}

// SecureTransport verifies certificate chains through the system trust evaluation service.
// This lookup does not
// grant access to the user's Keychain (MXC's broader keychainAccess remains disabled).
const MAC_TRUST_SERVICES = ["com.apple.TrustEvaluationAgent"];

/** The system trees a macOS shell needs, those this host has. */
export function macSystemTrees(exists: (file: string) => boolean = existsSync): string[] {
  return ["/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/private/var/db/xcode_select_link", "/opt/homebrew"].filter((tree) => exists(tree));
}

/** A path with its symlinks resolved (`/tmp` → `/private/tmp`), or as given when it does not exist. */
function realPath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

let developerDirCache: string | null | undefined;

/** `xcode-select -p`: Xcode's `…/Contents/Developer`, or the Command Line Tools. Null without either. */
export function macDeveloperDir(): string | null {
  if (developerDirCache !== undefined) return developerDirCache;
  try {
    developerDirCache = execFileSync("xcode-select", ["-p"], { encoding: "utf8", timeout: RUNNER_CHECK_TIMEOUT_MS }).trim() || null;
  } catch {
    developerDirCache = null;
  }
  return developerDirCache;
}

/**
 * What one command or terminal may touch under MXC on macOS.
 *
 * Seatbelt's profile denies by default: the system trees, the search path's installations, the
 * developer tools, the root and the temporary directory are allowed read-only or writable, and
 * nothing else. Every path goes in resolved, as Seatbelt matches it (`/var/folders/…` is
 * `/private/var/folders/…`).
 *
 * `/usr/bin/git` is Apple's `xcrun` shim: refused a per-user temp and cache directory under
 * Seatbelt, it warns on every call and leaves a `Library/` cache in `HOME`. The developer
 * directory's own `git` goes first on the search path, so the shim never runs.
 */
export function mxcMacConfig(input: MxcMacInput): MxcMacConfig {
  const exists = input.exists ?? existsSync;
  const real = input.realPath ?? realPath;
  const developerDir = input.developerDir === undefined ? macDeveloperDir() : input.developerDir;
  const gitDir = developerDir ? path.posix.join(developerDir, "usr", "bin") : undefined;
  const gitFirst = gitDir && exists(path.posix.join(gitDir, "git")) ? gitDir : undefined;
  // Xcode's tools load from the whole bundle; the Command Line Tools sit under /Library already.
  const developerTree = developerDir?.endsWith("/Contents/Developer") ? developerDir.slice(0, -"/Contents/Developer".length) : developerDir;
  const env = { ...input.env };
  if (gitFirst) env.PATH = env.PATH ? `${gitFirst}:${env.PATH}` : gitFirst;
  const writable = input.allowWrite ? [input.writableRoot ?? input.root] : [];
  const readwritePaths = unique([...writable, ...(input.grantedWrite ?? []), input.tmp].map(real));
  const shellDir = path.posix.isAbsolute(input.shell) ? [path.posix.dirname(input.shell)] : [];
  const readonlyPaths = unique(
    [
      ...macSystemTrees(exists),
      ...toolTrees(input.searchPath, path.posix).filter((tree) => exists(tree)),
      ...(developerTree && exists(developerTree) ? [developerTree] : []),
      ...shellDir,
      input.root,
      ...(input.readOnlyFiles ?? []),
      ...(input.grantedRead ?? []),
    ].map(real),
  )
    .filter((p) => !readwritePaths.includes(p) && !readwritePaths.some((rw) => isUnder(p, rw)))
    // Inside the writable zone, held read-only on purpose: MXC's profile holds it (measured).
    .concat((input.readOnlyInside ?? []).map(real));
  const deniedPaths = unique([input.agentDir, input.configFile].filter((p): p is string => Boolean(p)).map(real));
  return {
    version: "1.0.0",
    containment: "seatbelt",
    seatbelt: { extraMachLookups: [...MAC_TRUST_SERVICES] },
    process: {
      commandLine: [input.shell, ...input.shellArgs].map(quotePosixArgument).join(" "),
      cwd: real(input.cwd),
      env: Object.entries(env).map(([name, value]) => `${name}=${value}`),
    },
    filesystem: { readwritePaths, readonlyPaths, deniedPaths },
    ...(input.networkProxy === undefined
      ? { network: { egress: { default: "allow" } } }
      : { network: { egress: { default: "deny" }, ingress: { default: "deny" } }, runtimeConfig: { networkProxy: input.networkProxy } }),
  };
}

/**
 * A macOS request that also asks MXC what Seatbelt refused (`durable-sandbox-rules`): the same
 * limits, enforced the same (`block`), and a report of each refusal written where `reportPath`
 * says — MXC adds `.<pid>_<hash>` before `.json`, and a `.verbose.json` beside it.
 *
 * Only MXC's development contract carries `seatbelt.captureDenials`, so the document changes
 * version and nothing else. Measured on an Apple M1 (`research.md`, "Measured on macOS"): what
 * Seatbelt refuses by default and what `deniedPaths` names are both reported, each file by its
 * own path, for about 50 ms a command — so every command asks, as landstrip reports on Linux.
 */
export function mxcMacCaptureRequest(config: MxcMacConfig, reportPath: string): Omit<MxcMacConfig, "version" | "seatbelt"> & {
  version: "1.1.0-alpha";
  seatbelt: MxcMacConfig["seatbelt"] & { captureDenials: { mode: "block"; outputPath: string } };
} {
  return { ...config, version: "1.1.0-alpha", seatbelt: { ...config.seatbelt, captureDenials: { mode: "block", outputPath: reportPath } } };
}

/** What `sandbox-exec` is given: the profile it applies, and the environment the command starts with. */
export interface SeatbeltPolicy {
  /** A Seatbelt profile (SBPL), written next to the command and passed with `-f`. */
  seatbelt: string;
  env: Record<string, string>;
}

/** A string in a Seatbelt profile: double-quoted, backslash and quote escaped. */
export function sbplString(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * The Seatbelt profile and environment for one command or terminal under `sandbox-exec`.
 *
 * What it may touch is `mxcMacConfig`'s answer, so both macOS runners hold the same limits; the
 * profile is the one MXC's `mxc-exec-mac` generates for that request (printed by its `--debug`):
 * deny by default; fork, exec, signals within the sandbox, sysctl reads, file metadata and a few
 * Mach services; `/` readable as data; the system trees, the standard devices and the tty; the
 * read-only paths, then the read-write ones, deeper rules after shallower so a writable zone in a
 * read-only root wins; the network; window server, pasteboard and input devices denied; the denied
 * paths last, overriding everything. Seatbelt applies the last matching rule.
 *
 * `sandbox-exec` hands the command its own environment: the one returned here, with the proxy's
 * variables under `sandbox.allowedHosts` (MXC sets those itself).
 */
export function seatbeltPolicy(input: MxcMacInput): SeatbeltPolicy {
  const request = mxcMacConfig(input);
  const env = Object.fromEntries(request.process.env.map((entry) => {
    const at = entry.indexOf("=");
    return [entry.slice(0, at), entry.slice(at + 1)];
  }));
  const proxy = request.runtimeConfig?.networkProxy;
  if (proxy) Object.assign(env, proxyEnvironment(proxy));
  const subpaths = (paths: string[]) => paths.map((p) => `    (subpath ${sbplString(p)})`).join("\n");
  const byDepth = (paths: string[]) => [...paths].sort((a, b) => a.split("/").length - b.split("/").length);
  const port = proxy ? new URL(proxy).port : undefined;
  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow file-read-metadata)",
    "(allow mach-lookup",
    '    (global-name "com.apple.system.notification_center")',
    '    (global-name "com.apple.system.logger")',
    '    (global-name "com.apple.distributed_notifications@Uv3")',
    '    (global-name "com.apple.CoreServices.coreservicesd")',
    '    (global-name "com.apple.FSEvents")',
    ...MAC_TRUST_SERVICES.map((name) => `    (global-name ${sbplString(name)})`),
    ")",
    '(allow file-read-data (literal "/"))',
    "(allow file-read*",
    subpaths(["/bin", "/sbin", "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/libexec", "/usr/share", "/System", "/Library", "/private/var/db/timezone", "/private/var/db/dyld", "/private/var/select", "/private/etc"]) + ")",
    '(allow file-read* file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom"))',
    '(allow file-read* file-write* file-ioctl (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))',
    '(allow file-read* (subpath "/dev/fd"))',
    "(allow pseudo-tty)",
    '(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))',
    ...(request.filesystem.readonlyPaths.length ? ["(allow file-read*", subpaths(byDepth(request.filesystem.readonlyPaths)) + ")"] : []),
    ...byDepth(request.filesystem.readwritePaths).map((p) => `(allow file-read* file-write* (subpath ${sbplString(p)}))`),
    // Inside the writable zone, held read-only: denied after the allows, as the last matching rule wins.
    ...(input.readOnlyInside ?? []).map((p) => `(deny file-write* (subpath ${sbplString(realPath(p))}))`),
    ...(port
      ? [`(allow network-outbound (remote ip ${sbplString(`localhost:${port}`)}))`]
      : ["(allow network-outbound)", "(allow network-bind (local ip))", "(allow system-socket)", '(deny network-outbound (remote ip "localhost:*"))']),
    "(deny mach-lookup",
    '    (global-name "com.apple.windowserver.active")',
    '    (global-name "com.apple.windowserver.session")',
    '    (global-name "com.apple.coreservices.launchservicesd")',
    '    (global-name "com.apple.pasteboard.1"))',
    '(deny iokit-open (iokit-user-client-class "IOHIDLibUserClient"))',
    ...(request.filesystem.deniedPaths.length ? ["(deny file-read* file-read-metadata file-write*", subpaths(request.filesystem.deniedPaths) + ")"] : []),
    "",
  ];
  return { seatbelt: lines.join("\n"), env };
}

/** MXC's request on Linux or macOS, for the executor `runner` names. */
export function mxcPosixConfig(runner: string, input: MxcMacInput): MxcLinuxConfig | MxcMacConfig {
  return isMacMxc(runner) ? mxcMacConfig(input) : mxcLinuxConfig(input);
}

/** Whether `child` is `parent` or inside it (POSIX paths, as given). */
function isUnder(child: string, parent: string): boolean {
  const rel = path.posix.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.posix.isAbsolute(rel));
}

/** One argument of a POSIX command line: bare when safe, else single-quoted. */
export function quotePosixArgument(argument: string): string {
  return /^[\w@%+=:,./-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", `'\\''`)}'`;
}

/** Top-level folders of a drive a shell needs: readable, never denied. */
const WINDOWS_SYSTEM_FOLDERS = new Set(["windows", "program files", "program files (x86)", "programdata"]);

/**
 * Every entry beside the path from the drive root down to `root`, for MXC to deny.
 *
 * The folders on the way down, and the system folders at the drive root, are left out.
 * So are two kinds of entry that make MXC reject the whole policy: junctions and
 * symbolic links (`0x8007010B` — the compatibility junctions such as `Application Data`
 * point at folders denied or system anyway) and files another process holds open, such as
 * a loaded `NTUSER.DAT` or a delete-on-close temp file (`0x80070020`, sharing violation).
 * Read when a terminal opens: an entry created later, or a file held open at that moment,
 * is not denied, which the documentation says.
 */
export function siblingsToDeny(root: string): string[] {
  // The host's own path rules: this walks the disk the server runs on (Windows for MXC,
  // whatever the tests run on), and Windows rules on a POSIX host make "\tmp\…", unlistable.
  const { root: drive } = path.parse(root);
  const parts = root.slice(drive.length).split(/[\\/]+/).filter(Boolean);
  const denied: string[] = [];
  let dir = drive;
  for (const part of parts) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      break; // A folder the server cannot list: nothing beside it to name.
    }
    for (const name of names) {
      if (name.toLowerCase() === part.toLowerCase()) continue;
      if (dir === drive && WINDOWS_SYSTEM_FOLDERS.has(name.toLowerCase())) continue;
      const entry = path.join(dir, name);
      if (deniable(entry)) denied.push(entry);
    }
    dir = path.join(dir, part);
  }
  return denied;
}

/**
 * libuv's exclusive open on Windows (no sharing at all). Node does not export it everywhere.
 *
 * MXC opens each denied file without sharing deletion, so a file another process holds
 * with delete access (a delete-on-close `.tmp`) fails the whole launch with a sharing
 * violation — while a plain open, which shares everything, succeeds. An exclusive open
 * fails whenever anything holds the file: stricter than MXC, never looser.
 */
const EXCLUSIVE_OPEN = (fsConstants as { UV_FS_O_EXLOCK?: number }).UV_FS_O_EXLOCK ?? 0x10000000;

function deniable(entry: string): boolean {
  let descriptor: number | undefined;
  try {
    const flags = process.platform === "win32"
      ? fsConstants.O_RDONLY | EXCLUSIVE_OPEN
      : fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW;
    descriptor = openSync(entry, flags);
    const opened = fstatSync(descriptor);
    if (opened.isDirectory()) {
      if (process.platform !== "win32") return true;
      const atPath = lstatSync(entry);
      return !atPath.isSymbolicLink() && atPath.dev === opened.dev && atPath.ino === opened.ino;
    }
    // O_NONBLOCK keeps FIFOs from hanging; sockets and devices are left out too.
    if (!opened.isFile()) return false;
    if (process.platform === "win32") {
      const atPath = lstatSync(entry);
      return !atPath.isSymbolicLink() && atPath.dev === opened.dev && atPath.ino === opened.ino;
    }
    return true;
  } catch {
    // Windows cannot open directory handles this way; retain directory entries, but
    // do the fallback metadata check only after the attempted open.
    if (process.platform === "win32") {
      // A plain open (full sharing) succeeds wherever reading is allowed, directories included
      // (libuv opens them with FILE_FLAG_BACKUP_SEMANTICS). One it fails on — access denied — is
      // never denied by name: MXC opens every denied path where it builds the security
      // environment, and a single one it cannot open fails the whole policy (0x80070005).
      let plain: number | undefined;
      try {
        plain = openSync(entry, fsConstants.O_RDONLY);
      } catch {
        return false;
      } finally {
        if (plain !== undefined) closeSync(plain);
      }
      try {
        const stats = lstatSync(entry);
        return !stats.isSymbolicLink() && stats.isDirectory();
      } catch {
        return false;
      }
    }
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** One argument of a Windows command line, quoted the way `CommandLineToArgvW` reads it back. */
export function quoteWindowsArgument(argument: string): string {
  if (argument !== "" && !/[\s"]/.test(argument)) return argument;
  // Backslashes are literal except before a quote, where they escape it: double those.
  return `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/** Variables a shell needs. Everything else of the server's stays out. */
const PASSED_THROUGH = ["PATH", "LANG", "TERM", "COLORTERM", "TZ"];

const USER_PROXY_VARIABLES = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "all_proxy", "no_proxy"];

/**
 * The user's proxy variables, for a confined command whose network is open: behind a company's
 * proxy nothing else reaches out, and without them every download timed out with no sign of why
 * (issue #554). A proxy URL naming a user or password is a credential, never passed: none of that
 * variable, and the server's log says so (`proxyCredentialsLeftOut`).
 */
export function userProxyEnvironment(serverEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of USER_PROXY_VARIABLES) {
    const value = serverEnv[name];
    if (value === undefined || value === "") continue;
    if (/^no_proxy$/i.test(name) || !carriesCredentials(value)) env[name] = value;
  }
  // The loopback never goes through the company's proxy: the registry relay is there (`registryRelay.ts`).
  if (Object.keys(env).some((name) => !/^no_proxy$/i.test(name))) {
    for (const name of ["NO_PROXY", "no_proxy"]) {
      const entries = (env[name] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
      for (const loopback of ["127.0.0.1", "localhost", "::1"]) if (!entries.includes(loopback)) entries.push(loopback);
      env[name] = entries.join(",");
    }
  }
  return env;
}

/** The proxy variables `userProxyEnvironment` leaves out because they carry a user or password. */
export function proxyCredentialsLeftOut(serverEnv: NodeJS.ProcessEnv): string[] {
  return USER_PROXY_VARIABLES.filter((name) => !/^no_proxy$/i.test(name) && serverEnv[name] && carriesCredentials(serverEnv[name]!));
}

function carriesCredentials(proxy: string): boolean {
  // `user:pass@host`, with or without a scheme: anything before an `@` in the authority.
  const authority = proxy.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? "";
  return authority.includes("@");
}

/**
 * What Windows itself needs on top — and what landstrip's runner needs to start an
 * AppContainer at all ("Windows ProgramData is unavailable" without it). Locations and
 * machine facts, no credentials.
 */
const WINDOWS_PASSED_THROUGH = [
  "SystemRoot", "windir", "SystemDrive", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
  "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432", "ComSpec", "PATHEXT",
  "OS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "NUMBER_OF_PROCESSORS",
  // Where the runner keeps its AppContainer profile: without it, launching fails with
  // os error 203. A location, outside the read allowlist: the shell cannot look in it.
  "LOCALAPPDATA",
];

/**
 * The user's own git configuration, when there is one: `~/.gitconfig` of the account the
 * server runs as.
 *
 * A confined shell's HOME is its root, so git would look for `<root>/.gitconfig` and find
 * no identity: every commit would stop on "Please tell me who you are". Passed instead as
 * `GIT_CONFIG_GLOBAL`, and readable on its own — read-only, the rest of the home stays
 * out. Files it includes (`include.path`) are not opened up.
 */
export function userGitConfig(home: string = homedir()): string | undefined {
  const file = path.join(home, ".gitconfig");
  return existsSync(file) ? file : undefined;
}

/**
 * The `*.gpgsign` keys the git configuration file sets to true (`[commit] gpgsign`, `[tag]
 * gpgsign`). GnuPG for Windows is built without ASLR, which MXC's container enforces, so signing
 * cannot run there; the private keys stay out of the sandbox anyway.
 */
export function gitSigningKeysEnabled(file: string, read: (file: string) => string | undefined = readTextFile): string[] {
  const text = read(file);
  if (!text) return [];
  const keys: string[] = [];
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      section = header[1]!.trim().toLowerCase();
      continue;
    }
    const entry = line.match(/^\s*([A-Za-z.]+)\s*=\s*(.*)$/);
    if (!entry || entry[1]!.toLowerCase() !== "gpgsign") continue;
    const value = entry[2]!.replace(/\s[;#].*$/, "").trim().toLowerCase();
    if (!["true", "yes", "on", "1"].includes(value)) continue;
    if (section === "commit" && !keys.includes("commit.gpgsign")) keys.push("commit.gpgsign");
    if (section === "tag" && !keys.includes("tag.gpgsign")) keys.push("tag.gpgsign");
  }
  return keys;
}

function readTextFile(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Whether `name` resolves on the server's own search path (on Windows, with its `PATHEXT`): gpg for
 * the signing relay, which runs unconfined on the host. Checked by path, not by running it.
 */
export function onServerPath(name: string, serverEnv: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  const pathValue = serverEnv.PATH;
  if (!pathValue) return false;
  const separator = platform === "win32" ? ";" : ":";
  const exts = platform === "win32" ? (serverEnv.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  return pathValue.split(separator).some((dir) => {
    if (dir === "") return false;
    return exts.some((ext) => existsSync(path.join(dir, name + ext)));
  });
}

/**
 * The `gpg.format` the git configuration file sets, lowercased (`openpgp` when unset). The signing
 * relay runs gpg's argument shape only: `ssh` (and anything else) names a different signer with
 * different arguments, so signing under it falls back to off in the sandbox.
 */
export function gitGpgFormat(file: string, read: (file: string) => string | undefined = readTextFile): string {
  const text = read(file);
  if (!text) return "openpgp";
  let section = "";
  let format = "openpgp";
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      section = header[1]!.trim().toLowerCase();
      continue;
    }
    const entry = line.match(/^\s*([A-Za-z.]+)\s*=\s*(.*)$/);
    if (!entry || section !== "gpg" || entry[1]!.toLowerCase() !== "format") continue;
    format = entry[2]!.replace(/\s[;#].*$/, "").trim().toLowerCase() || "openpgp";
  }
  return format;
}

/** The `gpg.program` the git configuration file sets, when it names one: the relay runs that, unconfined. */
export function gitGpgProgram(file: string, read: (file: string) => string | undefined = readTextFile): string | undefined {
  const text = read(file);
  if (!text) return undefined;
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      section = header[1]!.trim().toLowerCase();
      continue;
    }
    const entry = line.match(/^\s*([A-Za-z.]+)\s*=\s*(.*)$/);
    if (!entry || section !== "gpg" || entry[1]!.toLowerCase() !== "program") continue;
    const value = entry[2]!.replace(/\s[;#].*$/, "").trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) return value.slice(1, -1);
    return value || undefined;
  }
  return undefined;
}

/**
 * Whether the signing relay can serve this git configuration on this host: OpenPGP (not
 * `gpg.format=ssh`) and a signer to run — the user's own `gpg.program` when the file names one,
 * else `gpg` on the server's search path. The loopback is checked by the caller.
 */
export function signingRelayRunnable(gitConfig: string, serverEnv: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32" || gitGpgFormat(gitConfig) !== "openpgp") return false;
  const program = gitGpgProgram(gitConfig);
  if (program !== undefined) return path.isAbsolute(program) ? existsSync(program) : onServerPath(program, serverEnv, platform);
  return onServerPath("gpg", serverEnv, platform);
}

const sharedSigningRelays = new Map<string, Promise<string | undefined>>();

/**
 * The signing relay's shim for a confined shell under MXC's process container on Windows, when the
 * user's gitconfig asks for signed commits, gpg is on the server's search path, the relay's signer
 * is one it takes (OpenPGP, not `gpg.format=ssh`), and the host's loopback is open to the sandbox:
 * the relay starts once per sandbox cache and its shim path is returned for `gpg.program`
 * (`signingRelay.ts`). Undefined otherwise — the shell's env then turns the gpgsign keys off.
 */
export function signingShimFor(options: {
  cacheDir: string;
  gitConfig?: string;
  serverEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** `sandbox.hostLoopback !== false`: the shim reaches the relay on the host's loopback. */
  loopbackOpen?: boolean;
}): Promise<string | undefined> {
  const serverEnv = options.serverEnv ?? process.env;
  const platform = options.platform ?? process.platform;
  const loopbackOpen = options.loopbackOpen ?? true;
  const home = platform === "win32" ? serverEnv.USERPROFILE ?? serverEnv.HOME : serverEnv.HOME;
  const gitConfig = options.gitConfig ?? (home ? userGitConfig(home) : undefined);
  const key = `${options.cacheDir}\0${loopbackOpen}`;
  let shim = sharedSigningRelays.get(key);
  if (!shim) {
    shim =
      platform === "win32" &&
      loopbackOpen &&
      gitConfig !== undefined &&
      gitSigningKeysEnabled(gitConfig).length > 0 &&
      signingRelayRunnable(gitConfig, serverEnv, platform)
        ? startSigningRelay({ cacheDir: options.cacheDir, serverEnv, program: gitGpgProgram(gitConfig) }).then((relay) => relay.shim)
        : Promise.resolve(undefined);
    sharedSigningRelays.set(key, shim);
  }
  return shim;
}

/**
 * What a confined shell may read of the user's git setup: the configuration, and the files it
 * names for every repository — `core.excludesFile` (a global `.gitignore`) and
 * `core.attributesFile`. Unreadable, git warns "unable to access" on every call.
 *
 * Read from the file, not asked of git: git may not be on the server's search path (Windows).
 * Only those two keys, and only files that exist: a configuration cannot open a folder this way.
 */
export function gitReadOnlyFiles(gitConfig: string | undefined, home: string = homedir(), exists: (file: string) => boolean = existsSync): string[] {
  if (!gitConfig) return [];
  let text: string;
  try {
    text = readFileSync(gitConfig, "utf8");
  } catch {
    return [gitConfig];
  }
  const named: string[] = [];
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[\s*([^\]\s"]+)/.exec(line);
    if (header) {
      section = header[1].toLowerCase();
      continue;
    }
    const entry = /^(excludesfile|attributesfile)\s*=\s*(.*)$/i.exec(line);
    if (section !== "core" || !entry) continue;
    let value = entry[2].replace(/\s[;#].*$/, "").trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    if (value.startsWith("~/") || value.startsWith("~\\")) value = path.join(home, value.slice(2));
    if (value && path.isAbsolute(value) && exists(value)) named.push(value);
  }
  return [gitConfig, ...named];
}

/** The environment of a confined shell: a home in its root, its own temp (history included), no secrets. */
export function confinedEnvironment(
  serverEnv: NodeJS.ProcessEnv,
  options: {
    root: string;
    tmp: string;
    shell: string;
    platform?: NodeJS.Platform;
    gitConfig?: string;
    /**
     * On Windows, the signing relay's shim (`signingRelay.ts`): when set, the user's gpgsign keys
     * stay on and `gpg.program` is pointed here, so commits sign through the server. Unset, the
     * keys are turned off instead (no gpg can run in the container).
     */
    signingShim?: string;
    /**
     * MXC on Windows: its container keeps its profile — and the `TEMP` it sets — under the
     * `LOCALAPPDATA` it is given (`<LOCALAPPDATA>Packagessandbox.{…}ACTemp`), replacing ours.
     * The server's would put it under a folder the policy denies (`Packages` beside the root's
     * path, or all of `C:Users`): no temporary file could be created. The private temp instead.
     */
    containerProfileInTmp?: boolean;
    /**
     * The user's own proxy variables (`userProxyEnvironment`): when no `sandbox.allowedHosts` proxy
     * is the command's way out. Behind a company's proxy the network is reached only through it.
     */
    userProxy?: boolean;
  },
): Record<string, string> {
  const windows = (options.platform ?? process.platform) === "win32";
  const env: Record<string, string> = {};
  for (const name of windows ? [...PASSED_THROUGH, ...WINDOWS_PASSED_THROUGH] : PASSED_THROUGH) {
    const value = serverEnv[name];
    if (value !== undefined) env[name] = value;
  }
  if (options.userProxy) Object.assign(env, userProxyEnvironment(serverEnv));
  for (const [name, value] of Object.entries(serverEnv)) {
    if (name.startsWith("LC_") && value !== undefined) env[name] = value;
  }
  env.TERM ??= "xterm-256color";
  env.SHELL = options.shell;
  env.HOME = options.root;
  env.TMPDIR = options.tmp;
  // HOME (and on Windows USERPROFILE) is not the user's: where theirs is, for a `~/…` the user or a
  // document names (issue #549). A path, not an access — reading there still takes a grant.
  env.PI_OUTPOST_USER_HOME = (windows ? serverEnv.USERPROFILE : serverEnv.HOME) || homedir();
  // npm's cache defaults to the user's profile, which is out of reach: a writable one, and
  // a private one, in the temp. It goes with the terminal (or the command).
  env.npm_config_cache = path.join(options.tmp, "npm-cache");
  // uv's and pip's too: on Windows they find the profile's folders without USERPROFILE, and are
  // refused there; elsewhere theirs would be under HOME, the project. Never the user's own cache
  // made writable: a package left in it would later run unconfined, from any project.
  env.UV_CACHE_DIR = path.join(options.tmp, "uv-cache");
  env.PIP_CACHE_DIR = path.join(options.tmp, "pip-cache");
  if (!windows) {
    // An interactive shell writes its history into HOME as it exits — the root, so the
    // user's project gained a .bash_history or .zsh_history after every terminal. Sent to
    // the private temp, as Windows sends the profile's data (below). zsh needs ZDOTDIR as
    // well: macOS's /etc/zshrc sets HISTFILE to ${ZDOTDIR:-$HOME}/.zsh_history over ours,
    // and with it zsh no longer reads startup files a project may carry in its root.
    env.HISTFILE = path.join(options.tmp, ".shell_history");
    env.ZDOTDIR = options.tmp;
  }
  if (options.gitConfig) {
    env.GIT_CONFIG_GLOBAL = options.gitConfig;
    // On Windows the sandbox cannot run GnuPG (built without ASLR, which the container enforces),
    // and the private keys stay out of it anyway. Where the user's own configuration asks for
    // signed commits: with the signing relay up, point gpg.program at its shim — env entries win
    // over the file; without it, turn the gpgsign keys off so no commit fails on a missing gpg.
    // POSIX runners leave signing alone.
    const signing = windows ? gitSigningKeysEnabled(options.gitConfig) : [];
    if (signing.length > 0) {
      const entries: [string, string][] = options.signingShim
        ? [["gpg.program", options.signingShim]]
        : signing.map((key) => [key, "false"]);
      const base = Number.parseInt(env.GIT_CONFIG_COUNT ?? serverEnv.GIT_CONFIG_COUNT ?? "0", 10) || 0;
      env.GIT_CONFIG_COUNT = String(base + entries.length);
      entries.forEach(([key, value], index) => {
        env[`GIT_CONFIG_KEY_${base + index}`] = key;
        env[`GIT_CONFIG_VALUE_${base + index}`] = value;
      });
    }
  }
  if (windows) {
    // The private temp, not the root: Windows and PowerShell keep a profile's data under
    // USERPROFILE (AppData\Roaming\…\PSReadLine history, the container's own
    // AppData\Local\Packages\sandbox.{…}), and in the root that lands in the user's project.
    env.USERPROFILE = options.tmp;
    env.TEMP = options.tmp;
    env.TMP = options.tmp;
    // PowerShell writes its module cache a few seconds after it starts, to the folder Windows names
    // for local application data — asked of Windows, not of LOCALAPPDATA. In MXC's container that
    // folder does not exist, .NET answers "", and the cache landed in the working directory: a
    // `Microsoft\Windows\PowerShell\ModuleAnalysisCache` in the user's project (a real session).
    env.PSModuleAnalysisCachePath = path.win32.join(options.tmp, "PowerShell", "ModuleAnalysisCache");
    // Python writes to a pipe in the ANSI code page, read here as UTF-8: Windows' own messages came
    // to the model as `Le fichier sp�cifi� est introuvable`. Its output only; files keep their default.
    env.PYTHONIOENCODING ??= "utf-8";
    if (options.containerProfileInTmp) {
      env.LOCALAPPDATA = options.tmp;
      // No MSYS2 program starts in MXC's container: their folders would only shadow native ones.
      if (env.PATH) env.PATH = withoutMsysFolders(env.PATH);
    }
  }
  return env;
}

/** A terminal's private directory: its temp files and its policy, removed on close. */
export interface ConfinedTerminalFiles {
  tmp: string;
  policyFile: string;
  /** Under `sandbox-exec`: the environment the shell starts with, which the runner hands it as is. */
  env?: Record<string, string>;
  dispose(): Promise<void>;
  /** The policy itself: MXC's request, which its SDK takes as an object rather than a file. */
  policy: TerminalPolicy | MxcTerminalConfig | MxcLinuxConfig | MxcMacConfig | SeatbeltPolicy;
}

/** Create the private directory and write the policy (landstrip's, MXC's request, or a Seatbelt profile) into it, owner-only. */
export async function prepareConfinedTerminal(
  build: (tmp: string) => TerminalPolicy | MxcTerminalConfig | MxcLinuxConfig | MxcMacConfig | SeatbeltPolicy,
): Promise<ConfinedTerminalFiles> {
  const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-terminal-"));
  const policy = build(tmp);
  const seatbelt = "seatbelt" in policy && typeof policy.seatbelt === "string" ? (policy as SeatbeltPolicy) : undefined;
  const policyFile = path.join(tmp, seatbelt ? "policy.sb" : "policy.json");
  await writeFile(policyFile, seatbelt ? seatbelt.seatbelt : JSON.stringify(policy, null, 2), { mode: 0o600 });
  return { tmp, policyFile, policy, ...(seatbelt ? { env: seatbelt.env } : {}), dispose: () => rm(tmp, { recursive: true, force: true }) };
}
