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
 * different document (`mxcTerminalConfig`) and it carries the shell's command line.
 */
import { execFile } from "node:child_process";
import { closeSync, constants as fsConstants, lstatSync, openSync, readdirSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/** Which runner `terminal.sandbox` names: MXC's executor by its file name, landstrip otherwise. */
export type RunnerKind = "landstrip" | "mxc";

export function runnerKind(runner: string): RunnerKind {
  return /^wxc-exec(\.exe)?$/i.test(path.win32.basename(runner)) ? "mxc" : "landstrip";
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
  if (platform !== "win32") return { ok: false, reason: `MXC's executor confines terminals on Windows only: ${runner}` };
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
      allowRead: unique([...SYSTEM_READ, ...toolTrees(input.searchPath, path.posix), input.root, input.tmp]),
      allowWrite: unique([...writable, input.tmp, "/dev/null", "/dev/tty", "/dev/pts"]),
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
  const allowRead = [input.systemRoot, ...tools, input.root, input.tmp]
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
      allowWrite: unique([...writable, input.tmp].map(slash)),
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** MXC's request document (schema 1.0.0), as much of it as a terminal uses. */
export interface MxcTerminalConfig {
  version: "1.0.0";
  containment: "processcontainer";
  process: { commandLine: string; cwd: string; env: string[] };
  filesystem: { readwritePaths: string[]; readonlyPaths: string[]; deniedPaths: string[] };
  /** Win32k on: without it anything loading user32.dll (PowerShell, git) dies with 0xC0000142. */
  ui: { disable: false };
  network: { egress: { default: "allow" } };
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
  const readwritePaths = unique([...writable, input.tmp]);
  const readonlyPaths = unique([drive, input.root, ...shellDir].filter((p) => !readwritePaths.includes(p)));
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
    ui: { disable: false },
    network: { egress: { default: "allow" } },
  };
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
  const { root: drive } = path.win32.parse(root);
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
      const entry = path.win32.join(dir, name);
      if (deniable(entry)) denied.push(entry);
    }
    dir = path.win32.join(dir, part);
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

/** The environment of a confined shell: a home in its root, its own temp, no secrets. */
export function confinedEnvironment(
  serverEnv: NodeJS.ProcessEnv,
  options: { root: string; tmp: string; shell: string; platform?: NodeJS.Platform },
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
  dispose(): Promise<void>;
}

/** Create the private directory and write the policy (landstrip's, or MXC's request) into it, owner-only. */
export async function prepareConfinedTerminal(
  build: (tmp: string) => TerminalPolicy | MxcTerminalConfig,
): Promise<ConfinedTerminalFiles> {
  const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-terminal-"));
  const policyFile = path.join(tmp, "policy.json");
  await writeFile(policyFile, JSON.stringify(build(tmp), null, 2), { mode: 0o600 });
  return { tmp, policyFile, dispose: () => rm(tmp, { recursive: true, force: true }) };
}
