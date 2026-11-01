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
import { closeSync, constants as fsConstants, existsSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/** Whether terminals can be confined, and if not, the reason a user is shown. */
export type RunnerCheck = { ok: true } | { ok: false; reason: string };

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
export async function checkRunner(runner: string, exec: Exec = defaultExec, platform: NodeJS.Platform = process.platform): Promise<RunnerCheck> {
  try {
    await access(runner, fsConstants.X_OK);
  } catch {
    return { ok: false, reason: `The terminal sandbox runner was not found or is not executable: ${runner}` };
  }
  if (runnerKind(runner) === "mxc") return checkMxcRunner(runner, exec, platform);
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
  if (/^wxc-exec(\.exe)?$/i.test(path.win32.basename(runner)) || isPosixMxc(runner)) return "mxc";
  return path.win32.basename(runner) === "sandbox-exec" ? "seatbelt" : "landstrip";
}

/** macOS' own Seatbelt runner, which `"seatbelt"` names. */
export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** Whether a runner is MXC's Linux executor (`lxc-exec`): Bubblewrap, not Windows' containers. */
export function isLinuxMxc(runner: string): boolean {
  return path.win32.basename(runner) === "lxc-exec";
}

/** Whether a runner is MXC's macOS executor (`mxc-exec-mac`): Seatbelt. */
export function isMacMxc(runner: string): boolean {
  return path.win32.basename(runner) === "mxc-exec-mac";
}

/** MXC on Linux or macOS: a POSIX shell's command line, and the same request but for the backend. */
export function isPosixMxc(runner: string): boolean {
  return isLinuxMxc(runner) || isMacMxc(runner);
}

/**
 * MXC's self-check: `wxc-exec --probe` names the tier it would pick.
 *
 * Only tier 1 (`base-container`, Windows 11 24H2 with the August 2026 update) is accepted.
 * The lower tiers emulate it with AppContainer ACLs stamped on every allowed tree at each
 * launch — and the terminal's policy allows a whole drive for reading (see
 * `mxcTerminalConfig`): that would rewrite the ACLs of the disk.
 */
async function checkMxcRunner(runner: string, exec: Exec, platform: NodeJS.Platform): Promise<RunnerCheck> {
  if (isLinuxMxc(runner)) {
    if (platform !== "linux") return { ok: false, reason: `MXC's lxc-exec confines commands on Linux only: ${runner}` };
    return checkPosixMxcRunner(runner, exec, "bubblewrap");
  }
  if (isMacMxc(runner)) {
    if (platform !== "darwin") return { ok: false, reason: `MXC's mxc-exec-mac confines commands on macOS only: ${runner}` };
    return checkPosixMxcRunner(runner, exec, "seatbelt");
  }
  if (platform !== "win32") return { ok: false, reason: `MXC's wxc-exec confines commands on Windows only — on Linux and macOS, "mxc" names that platform's executor: ${runner}` };
  let output: ExecFileResult;
  try {
    output = await exec(runner, ["--probe"], { timeout: RUNNER_CHECK_TIMEOUT_MS });
  } catch (error) {
    const detail = error as { stderr?: string; stdout?: string; message?: string };
    const said = (detail.stderr || detail.stdout || detail.message || "").trim();
    return { ok: false, reason: `MXC's executor failed its probe${said ? `: ${said}` : ""}` };
  }
  let probe: { tier?: unknown; probes?: { baseContainerSupportsDenyPaths?: unknown } };
  try {
    probe = JSON.parse(output.stdout);
  } catch {
    return { ok: false, reason: `MXC's executor answered its probe with something that is not JSON: ${output.stdout.trim().slice(0, 200)}` };
  }
  if (probe.tier !== "base-container") {
    return {
      ok: false,
      reason: `MXC would confine terminals with tier "${String(probe.tier)}"; a terminal needs "base-container" (Windows 11 24H2 or 25H2 with the August 2026 update or later)`,
    };
  }
  if (probe.probes?.baseContainerSupportsDenyPaths === false) {
    return { ok: false, reason: "This Windows build's sandbox cannot deny paths, which the terminal's policy needs" };
  }
  return { ok: true };
}

/**
 * MXC's Linux and macOS self-check: one confined `true` in its Bubblewrap or Seatbelt
 * backend, network open.
 *
 * `lxc-exec --available-backends` lists Bubblewrap wherever `bwrap` is installed, even in a
 * container that refuses it user namespaces; only a run tells. The network shape is the
 * most demanding one a command is given (slirp4netns, `/dev/net/tun`, iptables, `ip`), so a host
 * that passes runs both the open network and `sandbox.allowedHosts`' proxy. MXC says why it
 * cannot — namespaces, AppArmor, a missing tool — and that is the reason passed on.
 */
async function checkPosixMxcRunner(runner: string, exec: Exec, containment: "bubblewrap" | "seatbelt"): Promise<RunnerCheck> {
  const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-mxc-check-"));
  try {
    const mac = containment === "seatbelt";
    const request = {
      version: "1.0.0",
      containment,
      process: { commandLine: mac ? "/usr/bin/true" : "/bin/true", cwd: mac ? realPath(tmp) : tmp, env: ["PATH=/usr/bin:/bin"] },
      filesystem: { readwritePaths: [mac ? realPath(tmp) : tmp], readonlyPaths: mac ? macSystemTrees() : linuxSystemTrees() },
      network: { egress: { default: "allow" } },
    };
    const file = path.join(tmp, "check.json");
    await writeFile(file, JSON.stringify(request), { mode: 0o600 });
    try {
      await exec(runner, [file], { timeout: RUNNER_CHECK_TIMEOUT_MS });
      return { ok: true };
    } catch (error) {
      const detail = error as { stderr?: string; stdout?: string; message?: string };
      return { ok: false, reason: `MXC cannot confine commands on this host: ${mxcErrorMessage(`${detail.stdout ?? ""}${detail.stderr ?? ""}`) || detail.message || "it failed"}` };
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

/** landstrip's native policy, as much of it as a terminal uses. */
export interface TerminalPolicy {
  filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[] };
  network: { allowNetwork: boolean };
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
    },
    network: { allowNetwork: true },
  };
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
    | { egress: { default: "deny" }; ingress: { default: "allow"; hostLoopback: "allow" } };
  /** The only way out, with `egress` denied: MXC sets `HTTPS_PROXY` and `HTTP_PROXY` to it. */
  runtimeConfig?: { networkProxy: string };
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
  /** `sandbox.allowedHosts`' proxy: the network closed but for it. The agent's shell only. */
  networkProxy?: string;
  /**
   * Directories the user granted this command beyond the sandbox (`sandboxGrants.ts`): read
   * only, and read-write. A write grant holds even without `allowWrite`: the user asked for it.
   */
  grantedRead?: string[];
  grantedWrite?: string[];
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
  // A granted directory beside the root needs no change to `siblings`: the more specific allow wins.
  const readonlyPaths = unique([drive, input.root, ...shellDir, ...(input.readOnlyFiles ?? []), ...(input.grantedRead ?? [])].filter((p) => !readwritePaths.includes(p)));
  const allowed = new Set([...readwritePaths, ...readonlyPaths].map((p) => p.toLowerCase()));
  const deniedPaths = unique([...input.siblings, input.agentDir, input.configFile].filter((p): p is string => Boolean(p)))
    // Denying a path that is also allowed leaves which one wins to the sandbox: never ask.
    .filter((p) => !allowed.has(p.toLowerCase()));
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
    ...(input.networkProxy === undefined
      ? { network: { egress: { default: "allow" } } }
      : {
          network: { egress: { default: "deny" }, ingress: { default: "allow", hostLoopback: "allow" } },
          runtimeConfig: { networkProxy: input.networkProxy },
        }),
  };
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
  ]).filter((p) => !readwritePaths.includes(p) && !readwritePaths.some((rw) => isUnder(p, rw)));
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
export type MxcMacConfig = Omit<MxcLinuxConfig, "containment"> & { containment: "seatbelt" };

export interface MxcMacInput extends MxcLinuxInput {
  /** The developer tools' directory (`xcode-select -p`): git lives there. Default: asked once. */
  developerDir?: string | null;
  /** A path as Seatbelt sees it, symlinks resolved. A parameter for tests. */
  realPath?: (file: string) => string;
}

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
  ).filter((p) => !readwritePaths.includes(p) && !readwritePaths.some((rw) => isUnder(p, rw)));
  const deniedPaths = unique([input.agentDir, input.configFile].filter((p): p is string => Boolean(p)).map(real));
  return {
    version: "1.0.0",
    containment: "seatbelt",
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
  if (proxy) for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) env[name] = proxy;
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
    '    (global-name "com.apple.FSEvents"))',
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
  let stats;
  try {
    stats = lstatSync(entry);
  } catch {
    return false;
  }
  if (stats.isSymbolicLink()) return false; // Node reports junctions as symbolic links too.
  if (stats.isDirectory()) return true;
  // Only a regular file is opened to test it: opening a FIFO for reading blocks until a
  // writer comes — synchronously, forever (it hung CI's Linux job on a pipe in /tmp).
  // Sockets and devices are left out with it.
  if (!stats.isFile()) return false;
  try {
    closeSync(openSync(entry, process.platform === "win32" ? fsConstants.O_RDONLY | EXCLUSIVE_OPEN : "r"));
    return true;
  } catch {
    return false;
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
  options: { root: string; tmp: string; shell: string; platform?: NodeJS.Platform; gitConfig?: string },
): Record<string, string> {
  const windows = (options.platform ?? process.platform) === "win32";
  const env: Record<string, string> = {};
  for (const name of windows ? [...PASSED_THROUGH, ...WINDOWS_PASSED_THROUGH] : PASSED_THROUGH) {
    const value = serverEnv[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(serverEnv)) {
    if (name.startsWith("LC_") && value !== undefined) env[name] = value;
  }
  env.TERM ??= "xterm-256color";
  env.SHELL = options.shell;
  env.HOME = options.root;
  env.TMPDIR = options.tmp;
  // npm's cache defaults to the user's profile, which is out of reach: a writable one, and
  // a private one, in the temp. It goes with the terminal (or the command).
  env.npm_config_cache = path.join(options.tmp, "npm-cache");
  if (!windows) {
    // An interactive shell writes its history into HOME as it exits — the root, so the
    // user's project gained a .bash_history or .zsh_history after every terminal. Sent to
    // the private temp, as Windows sends the profile's data (below). zsh needs ZDOTDIR as
    // well: macOS's /etc/zshrc sets HISTFILE to ${ZDOTDIR:-$HOME}/.zsh_history over ours,
    // and with it zsh no longer reads startup files a project may carry in its root.
    env.HISTFILE = path.join(options.tmp, ".shell_history");
    env.ZDOTDIR = options.tmp;
  }
  if (options.gitConfig) env.GIT_CONFIG_GLOBAL = options.gitConfig;
  if (windows) {
    // The private temp, not the root: Windows and PowerShell keep a profile's data under
    // USERPROFILE (AppData\Roaming\…\PSReadLine history, the container's own
    // AppData\Local\Packages\sandbox.{…}), and in the root that lands in the user's project.
    env.USERPROFILE = options.tmp;
    env.TEMP = options.tmp;
    env.TMP = options.tmp;
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
  return { tmp, policyFile, ...(seatbelt ? { env: seatbelt.env } : {}), dispose: () => rm(tmp, { recursive: true, force: true }) };
}
