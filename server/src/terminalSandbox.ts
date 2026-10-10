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
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
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
export async function checkRunner(runner: string, exec: Exec = defaultExec): Promise<RunnerCheck> {
  try {
    await access(runner, fsConstants.X_OK);
  } catch {
    return { ok: false, reason: `The terminal sandbox runner was not found or is not executable: ${runner}` };
  }
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
  const allowRead = [input.systemRoot, ...searchEntries(input.searchPath, path.win32), input.root, input.tmp]
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
    env.USERPROFILE = options.root;
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

/** Create the private directory and write the policy into it, readable by the owner only. */
export async function prepareConfinedTerminal(
  build: (tmp: string) => TerminalPolicy,
): Promise<ConfinedTerminalFiles> {
  const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-terminal-"));
  const policyFile = path.join(tmp, "policy.json");
  await writeFile(policyFile, JSON.stringify(build(tmp), null, 2), { mode: 0o600 });
  return { tmp, policyFile, dispose: () => rm(tmp, { recursive: true, force: true }) };
}
