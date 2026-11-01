/**
 * The agent's `bash`, every command run inside a sandbox runner.
 *
 * pi's `bash` lets its caller replace how a command runs (`BashOperations`). With
 * `sandbox.bashRunner` set, pi-outpost's own `bash` keeps pi's tool — schema, prompt,
 * rendering, truncation — and runs each command through the runner instead of a local
 * shell, with the policy a confined terminal gets in the same workspace
 * (`terminalSandbox.ts`). One launch per command: pi's `bash` keeps no shell between
 * calls either.
 *
 * Fail closed: an unusable runner refuses every command with its reason, and nothing
 * ever runs unconfined.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import type { SandboxGrantOutcome } from "@pi-outpost/shared";
import { startEgressProxy, type EgressProxy, type EgressProxyOptions } from "./egressProxy.ts";
import { EMPTY_GRANT, forbiddenHost, isEmptyGrant, mergeGrants, type Grant } from "./sandboxGrants.ts";
import {
  checkRunner,
  confinedEnvironment,
  gitReadOnlyFiles,
  isPosixMxc,
  mxcPosixConfig,
  seatbeltPolicy,
  mxcTerminalConfig,
  runnerKind,
  siblingsToDeny,
  terminalPolicy,
  type RunnerCheck,
} from "./terminalSandbox.ts";

export interface ConfinedBashOptions {
  /** `sandbox.bashRunner`: MXC's executor or landstrip's binary. */
  runner: string;
  /**
   * `sandbox.bashShell`. Default `/bin/bash`; Windows has none that works by default.
   * PowerShell (see `isPowerShell`) runs the command as a `.ps1` script instead.
   */
  shell?: string;
  /**
   * `sandbox.bashImage`, experimental: with MXC, run each command in this Linux image
   * through the WSLC backend instead (see `mxcWslcConfig`).
   */
  image?: string;
  /** The sandbox root: what a command may read, and where it starts. */
  root: string;
  /** Where it may write; undefined with `allowWrite`: the whole root. */
  writableRoot?: string;
  allowWrite: boolean;
  /** Never readable: the provider keys. */
  agentDir?: string;
  /** Never readable. */
  configFile?: string;
  /** The user's git configuration, read-only inside: git's identity (see `userGitConfig`). */
  gitConfig?: string;
  /**
   * `sandbox.allowedHosts`' proxy (`egressProxy.ts`): MXC's process container only. The
   * hosts it refuses while a command runs are named after the command's output.
   */
  networkProxy?: Pick<EgressProxy, "url" | "watchRefusals">;
  /** `sandbox.allowedHosts` itself, which a command's own proxy starts from. */
  allowedHosts?: readonly string[];
  /**
   * Asks the user about a host the list does not name, while the command's connection to it
   * waits (`sandboxGrantBroker.ts`). With it, each command gets a proxy of its own — the list
   * and the session's hosts — that asks, and is closed after the command. Absent: an unlisted
   * host is refused at once, by the shared proxy.
   */
  askHost?: (request: { command: string; host: string; signal?: AbortSignal }) => Promise<SandboxGrantOutcome>;
  /** How a command's own proxy is started. A parameter for tests. */
  startProxy?: (options: EgressProxyOptions) => Promise<EgressProxy>;
  /** Whose rules. A parameter so the Windows path is tested everywhere. */
  platform?: NodeJS.Platform;
  /** The runner's self-check. A parameter for tests; cached per runner otherwise. */
  check?: (runner: string) => Promise<RunnerCheck>;
  /**
   * The session's grants (`sandboxGrants.ts`), read at each launch: what the user allowed every
   * command of this session beyond the sandbox. Absent: none.
   */
  grants?: () => Grant;
}

type ExecOptions = Parameters<BashOperations["exec"]>[2];

/** pi's `BashOperations`, and one command run with a grant the user approved for it alone. */
export interface ConfinedBashOperations extends BashOperations {
  execWithGrant(command: string, cwd: string, options: ExecOptions, grant: Grant): ReturnType<BashOperations["exec"]>;
}

/** What ends a command whose hosts the proxy refused without anyone to ask: which ones, and the way through. */
export function refusalNote(hosts: string[]): string {
  const them = hosts.length > 1 ? "them" : "it";
  return `[pi-outpost] network refused: ${hosts.join(", ")} — not in sandbox.allowedHosts. Ask the user to add ${them} there if the command needs ${them}.`;
}

/** What the user answered about a host a command connected to, or why nobody was asked. */
export type HostAnswer = SandboxGrantOutcome | { forbidden: string };

/** How an answer reads, in the proxy's refusal and in the note after the command. */
export function hostAnswerText(host: string, answer: HostAnswer): string {
  if (typeof answer === "object") return `${host} is never granted: ${answer.forbidden}`;
  switch (answer) {
    case "approved-once":
      return `the user allowed ${host} for this command`;
    case "approved-session":
      return `the user allowed ${host} for the rest of the session`;
    case "refused":
      return `the user refused ${host}`;
    case "expired":
      return `nobody answered about ${host} in time`;
    case "aborted":
      return `the question about ${host} was cancelled with the turn or the session`;
    case "unattended":
      return `no one was connected to approve ${host}`;
  }
}

/** What ends a command that connected to hosts the list does not name, the user asked about each. */
export function networkNote(answers: ReadonlyMap<string, HostAnswer>): string {
  const lines = [...answers].map(([host, answer]) => `[pi-outpost] network: ${hostAnswerText(host, answer)}.`);
  const refused = [...answers.values()].some((answer) => answer !== "approved-once" && answer !== "approved-session");
  if (refused) lines.push("[pi-outpost] Do not retry a refused host for this request: tell the user what it blocked.");
  return lines.join("\n");
}

/** A grant's directories as the policies take them: read only, and read-write. */
function grantedDirectories(grant: Grant): { grantedRead: string[]; grantedWrite: string[] } {
  return {
    grantedRead: grant.directories.filter((directory) => directory.access === "read").map((directory) => directory.path),
    grantedWrite: grant.directories.filter((directory) => directory.access === "write").map((directory) => directory.path),
  };
}

/** One self-check per runner path, for the life of the server: asked on first use. */
const checks = new Map<string, Promise<RunnerCheck>>();

function cachedCheck(runner: string): Promise<RunnerCheck> {
  let check = checks.get(runner);
  if (!check) {
    check = checkRunner(runner);
    checks.set(runner, check);
  }
  return check;
}

/** The longest timeout pi's `bash` accepts, in seconds. */
const MAX_TIMEOUT_SECONDS = 24 * 60 * 60;

/** Whether a configured shell is PowerShell, which takes a `.ps1` script and gets pi's `powershell` tool. */
export function isPowerShell(shell: string | undefined): boolean {
  if (!shell) return false;
  const name = path.win32.basename(shell).toLowerCase();
  return name === "powershell.exe" || name === "pwsh.exe" || name === "pwsh" || name === "powershell";
}

/**
 * How PowerShell starts on a command's script. No profile: the user's is outside the
 * sandbox, and a command must not depend on it. The execution policy is given for the
 * process because it cannot be read inside the sandbox (the registry is refused), and
 * every script — this one too — would otherwise fail "AuthorizationManager".
 */
export const POWERSHELL_SCRIPT_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

/**
 * The command as a PowerShell script. Written with a byte-order mark: Windows PowerShell
 * 5.1 reads UTF-8 without one in the ANSI code page. Progress display off: drawing a bar
 * reads the console buffer back, which the sandbox refuses, and the command dies with
 * it. Output in UTF-8, as pi's own `powershell` does.
 *
 * `-File` reports 0 for a script that ends without `exit`, whatever failed; the trailer
 * gives what `-Command` (pi's local tool) gives instead — the native program's code, or
 * 1 for a failed cmdlet. It runs only when the command did not `exit` itself, and on its
 * own lines so a comment ending the command cannot swallow it.
 *
 * The command's output goes through `Out-Default` before that `exit`: the implicit formatter
 * holds a table back while it waits for more objects of its type, and an `exit` right after
 * drops it — `'a'; Get-Location; 'b'` printed `a` alone, exit 0. The command is dot-sourced, so
 * its variables stay in the script's scope, and its `$?` is taken inside the block, right after
 * it: after the pipe it would be `Out-Default`'s. A command that itself exits (or throws) right
 * after a table still loses it: PowerShell does that under `-Command` too, pi's own tool included.
 */
export function powerShellScript(command: string): string {
  return [
    "\uFEFF$ProgressPreference = 'SilentlyContinue'",
    "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}",
    // PowerShell 7 colours tables and errors by default; the model reads escape codes.
    "try { $PSStyle.OutputRendering = 'PlainText' } catch {}",
    // Under sandbox.allowedHosts MXC sets HTTPS_PROXY, which Windows PowerShell's web
    // cmdlets ignore: they would go direct, and be refused.
    "if ($env:HTTPS_PROXY) { $PSDefaultParameterValues['Invoke-WebRequest:Proxy'] = $env:HTTPS_PROXY; $PSDefaultParameterValues['Invoke-RestMethod:Proxy'] = $env:HTTPS_PROXY }",
    // Windows PowerShell parses a page with Internet Explorer's engine unless told not to, and
    // in the sandbox that ends in "not in interactive mode": every plain Invoke-WebRequest failed.
    // PowerShell 7 takes the switch and ignores it.
    "$PSDefaultParameterValues['Invoke-WebRequest:UseBasicParsing'] = $true",
    "$global:LASTEXITCODE = $null",
    // A command that returns at its top level ends the block with nothing failed.
    "$global:PiOutpostCommandOk = $true",
    ". {",
    command,
    "",
    "$global:PiOutpostCommandOk = $?",
    "} | Out-Default",
    "if (-not $global:PiOutpostCommandOk) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }",
    "exit 0",
    "",
  ].join("\n");
}

export function confinedBashOperations(options: ConfinedBashOptions): ConfinedBashOperations {
  const platform = options.platform ?? process.platform;
  const windows = platform === "win32";
  const kind = runnerKind(options.runner);
  const wslc = options.image !== undefined && kind === "mxc";
  const shell = wslc ? "/bin/bash" : (options.shell ?? (windows ? undefined : "/bin/bash"));
  const powerShell = !wslc && isPowerShell(shell);
  const launchCommand = async (command: string, cwd: string, { onData, signal, timeout }: ExecOptions, extra: Grant) => {
    const timeoutMs = timeoutInMs(timeout);
    if (signal?.aborted) throw new Error("aborted");
    const check = await (options.check ?? cachedCheck)(options.runner);
    if (!check.ok) throw new Error(`bash is confined by ${options.runner}, which cannot run it: ${check.reason}`);
    if (!shell) {
      throw new Error(
        `bash is confined by ${options.runner}, but "sandbox.bashShell" names no shell. On Windows, Git Bash cannot start in a sandbox: name powershell.exe, or busybox-w32's sh.exe.`,
      );
    }

    const session = options.grants?.() ?? EMPTY_GRANT;
    const grant = mergeGrants(session, extra);
    if (wslc && grant.directories.length > 0) {
      throw new Error("a directory grant cannot reach bash in a WSLC container: its mounts are fixed when it starts");
    }
    const directories = grantedDirectories(grant);
    // A host the list does not name is asked about while the connection waits — by a proxy of
    // this command's own, so that what it asks is this command's, and closed after it. The shared
    // proxy of the list is left as it is, for every other command and session using it.
    let networkProxy = options.networkProxy;
    let dedicated: EgressProxy | undefined;
    const answers = new Map<string, HostAnswer>();
    const askHost = options.askHost;
    if (networkProxy !== undefined && askHost !== undefined && !wslc) {
      dedicated = await (options.startProxy ?? startEgressProxy)({
        allowedHosts: [...(options.allowedHosts ?? []), ...session.hosts],
        ask: async (host) => {
          const forbidden = forbiddenHost(host);
          const answer: HostAnswer = forbidden ? { forbidden } : await askHost({ command, host, ...(signal ? { signal } : {}) });
          answers.set(host, answer);
          return answer === "approved-once" || answer === "approved-session" ? { allowed: true } : { allowed: false, why: hostAnswerText(host, answer) };
        },
      });
      networkProxy = dedicated;
    }

    const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-bash-"));
    try {
      const script = path.join(tmp, powerShell ? "command.ps1" : "command.sh");
      await writeFile(script, powerShell ? powerShellScript(command) : command, { mode: 0o600 });
      const shellArgs = powerShell ? [...POWERSHELL_SCRIPT_ARGS, script] : [script];
      // A start outside the root could not be entered from inside it.
      const startIn = isInside(cwd, options.root) ? cwd : options.root;
      const env = confinedEnvironment(process.env, { root: options.root, tmp, shell, platform, gitConfig: options.gitConfig });
      const readOnlyFiles = gitReadOnlyFiles(options.gitConfig);
      const policyFile = path.join(tmp, "policy.json");
      let args: string[];
      // sandbox-exec hands the command its own environment: the one its policy says.
      let runnerEnv = env;
      if (kind === "seatbelt") {
        const policy = seatbeltPolicy({
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          ...directories,
          agentDir: options.agentDir,
          configFile: options.configFile,
          tmp,
          shell,
          shellArgs,
          cwd: startIn,
          env,
          searchPath: env.PATH,
          readOnlyFiles,
          ...(networkProxy === undefined ? {} : { networkProxy: networkProxy.url }),
        });
        const profileFile = path.join(tmp, "policy.sb");
        await writeFile(profileFile, policy.seatbelt, { mode: 0o600 });
        args = ["-f", profileFile, shell, ...shellArgs];
        runnerEnv = policy.env;
      } else if (wslc) {
        const request = mxcWslcConfig({
          image: options.image!,
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          tmp,
          script,
          cwd: startIn,
        });
        await writeFile(policyFile, JSON.stringify(request), { mode: 0o600 });
        args = ["--config", policyFile];
      } else if (kind === "mxc" && isPosixMxc(options.runner)) {
        const request = mxcPosixConfig(options.runner, {
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          ...directories,
          agentDir: options.agentDir,
          configFile: options.configFile,
          tmp,
          shell,
          shellArgs,
          cwd: startIn,
          env,
          searchPath: env.PATH,
          readOnlyFiles,
          ...(networkProxy === undefined ? {} : { networkProxy: networkProxy.url }),
        });
        await writeFile(policyFile, JSON.stringify(request), { mode: 0o600 });
        args = [policyFile];
      } else if (kind === "mxc") {
        const request = mxcTerminalConfig({
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          ...directories,
          agentDir: options.agentDir,
          configFile: options.configFile,
          tmp,
          shell,
          shellArgs,
          cwd: startIn,
          env,
          siblings: siblingsToDeny(options.root),
          readOnlyFiles,
          ...(networkProxy === undefined ? {} : { networkProxy: networkProxy.url }),
        });
        await writeFile(policyFile, JSON.stringify(request), { mode: 0o600 });
        args = [policyFile];
      } else {
        const policy = terminalPolicy({
          root: options.root,
          writableRoot: options.writableRoot,
          allowWrite: options.allowWrite,
          ...directories,
          agentDir: options.agentDir,
          configFile: options.configFile,
          tmp,
          searchPath: env.PATH,
          systemRoot: process.env.SystemRoot,
          userProfile: process.env.USERPROFILE,
          readOnlyFiles,
          platform,
        });
        await writeFile(policyFile, JSON.stringify(policy), { mode: 0o600 });
        args = ["run", "-p", policyFile, "--", shell, ...shellArgs];
      }
      const launch = () => run(options.runner, args, { cwd: startIn, env: runnerEnv, onData, signal, timeoutMs, timeout, windows });
      // curl, git and PowerShell print only "403" for a refused tunnel: the model is told which
      // host, and why. Commands of the agent's shell run one at a time, so these are this one's.
      const refused = new Set<string>();
      const unwatch = wslc ? undefined : networkProxy?.watchRefusals((host) => refused.add(host));
      try {
        return await (wslc ? oneWslcAtATime(launch) : launch());
      } finally {
        unwatch?.();
        // With someone to ask, every unlisted host was asked about: what each answer was. Without,
        // the hosts refused, and that the list is where they would go.
        if (answers.size > 0) onData(Buffer.from(`\n${networkNote(answers)}\n`));
        else if (refused.size > 0) onData(Buffer.from(`\n${refusalNote([...refused])}\n`));
      }
    } finally {
      await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
      await dedicated?.close().catch(() => {});
    }
  };
  return {
    exec: (command, cwd, execOptions) => launchCommand(command, cwd, execOptions, EMPTY_GRANT),
    execWithGrant: (command, cwd, execOptions, grant) => launchCommand(command, cwd, execOptions, isEmptyGrant(grant) ? EMPTY_GRANT : grant),
  };
}

/** A Windows path as MXC's WSLC backend mounts it in the container: `C:\a\b` → `/mnt/c/a/b`. */
export function wslcPath(windowsPath: string): string {
  const { root } = path.win32.parse(windowsPath);
  const rest = windowsPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  return [`/mnt/${root.slice(0, 1).toLowerCase()}`, ...rest].join("/");
}

/**
 * One command in a Linux container, through MXC's WSLC backend. Experimental.
 *
 * Only what is mounted exists inside: the root (read-only, or writable with `allowWrite`)
 * and the command's temporary folder. Nothing else of the host — no profile, no keys, no
 * configuration — so there is nothing to deny. The environment is the container's own,
 * not the server's.
 *
 * Two limits of the backend, found by running it: a writable folder inside a read-only
 * mount stays read-only (the parent shadows it), so the writable zone is the whole root
 * or nothing; and the network is all or nothing — bridged with the host's loopback, or
 * isolated. Bridged here: git and package managers need it.
 *
 * Every run gets its own container name, so a turn's parallel calls never share a session.
 * Before mxc-sdk 1.0.1 it was also required: without one MXC named the session `CLI`, which
 * WSLC refused (`WSLC_E_INVALID_SESSION_NAME`, microsoft/mxc#1484).
 */
export function mxcWslcConfig(input: {
  image: string;
  root: string;
  writableRoot?: string;
  allowWrite: boolean;
  tmp: string;
  script: string;
  cwd: string;
}) {
  if (input.allowWrite && input.writableRoot !== undefined && input.writableRoot !== input.root) {
    throw new Error(
      `bash runs in a WSLC container, which cannot make a folder inside a read-only mount writable: remove "sandbox.writableRoot", or give up "sandbox.bashImage"`,
    );
  }
  return {
    version: "1.0.0",
    containment: "wslc",
    containerId: `pioutpost${randomBytes(6).toString("hex")}`,
    // The image store MXC defaults to under %TEMP% — which, for the runner, is this
    // command's temporary folder: every command would pull the image again.
    wslc: { image: input.image, storagePath: path.join(tmpdir(), "mxc-wslc-sessions") },
    process: {
      commandLine: `/bin/bash ${wslcPath(input.script)}`,
      cwd: input.cwd,
      env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/root", "LANG=C.UTF-8", "TERM=dumb"],
    },
    filesystem: {
      readwritePaths: input.allowWrite ? [input.root, input.tmp] : [input.tmp],
      readonlyPaths: input.allowWrite ? [] : [input.root],
    },
    network: { egress: { default: "allow" }, ingress: { default: "allow", hostLoopback: "allow" } },
  };
}

/**
 * WSLC runs one after another. pi runs a turn's tool calls in parallel, and two runs
 * sharing the image store fail on it (`WslcListSessionImages`, a sharing violation) —
 * found with three of four commands of one turn refused.
 */
let wslcTail: Promise<unknown> = Promise.resolve();
export function oneWslcAtATime<T>(launch: () => Promise<T>): Promise<T> {
  const next = wslcTail.then(launch, launch);
  wslcTail = next.catch(() => {});
  return next;
}

function timeoutInMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid timeout: must be a finite number of seconds");
  if (timeout > MAX_TIMEOUT_SECONDS) throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
  return timeout * 1000;
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Signal numbers for the 128 + n convention, where Node names a signal but gives no code. */
const SIGNAL_NUMBERS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Spawn the runner, stream its output, and end it — tree and all — on abort or timeout. pi's semantics. */
async function run(
  runner: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    onData: (data: Buffer) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
    timeout?: number;
    windows: boolean;
  },
): Promise<{ exitCode: number | null }> {
  const child = spawn(runner, args, {
    cwd: options.cwd,
    env: options.env,
    // Its own process group outside Windows, so the whole tree can be ended at once.
    detached: !options.windows,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let timedOut = false;
  const end = () => killTree(child, options.windows);
  const onAbort = () => end();
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    end();
  }, options.timeoutMs);
  child.stdout?.on("data", options.onData);
  child.stderr?.on("data", options.onData);
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (options.signal?.aborted) throw new Error("aborted");
    if (timedOut) throw new Error(`timeout:${options.timeout}`);
    return { exitCode: code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] ?? 0) : 1) };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** End the runner and what it supervises. On Windows, ending MXC's executor ends its container. */
function killTree(child: ChildProcess, windows: boolean): void {
  if (!child.pid || child.exitCode !== null) return;
  if (windows) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).once("error", () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
