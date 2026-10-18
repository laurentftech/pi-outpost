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
import type { EgressProxy } from "./egressProxy.ts";
import {
  checkRunner,
  confinedEnvironment,
  isLinuxMxc,
  mxcLinuxConfig,
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
  /** Whose rules. A parameter so the Windows path is tested everywhere. */
  platform?: NodeJS.Platform;
  /** The runner's self-check. A parameter for tests; cached per runner otherwise. */
  check?: (runner: string) => Promise<RunnerCheck>;
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
    "$global:LASTEXITCODE = $null",
    command,
    "",
    "if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }",
    "exit 0",
    "",
  ].join("\n");
}

export function confinedBashOperations(options: ConfinedBashOptions): BashOperations {
  const platform = options.platform ?? process.platform;
  const windows = platform === "win32";
  const kind = runnerKind(options.runner);
  const wslc = options.image !== undefined && kind === "mxc";
  const shell = wslc ? "/bin/bash" : (options.shell ?? (windows ? undefined : "/bin/bash"));
  const powerShell = !wslc && isPowerShell(shell);
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      const timeoutMs = timeoutInMs(timeout);
      if (signal?.aborted) throw new Error("aborted");
      const check = await (options.check ?? cachedCheck)(options.runner);
      if (!check.ok) throw new Error(`bash is confined by ${options.runner}, which cannot run it: ${check.reason}`);
      if (!shell) {
        throw new Error(
          `bash is confined by ${options.runner}, but "sandbox.bashShell" names no shell. On Windows, Git Bash cannot start in a sandbox: name powershell.exe, or busybox-w32's sh.exe.`,
        );
      }

      const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-bash-"));
      try {
        const script = path.join(tmp, powerShell ? "command.ps1" : "command.sh");
        await writeFile(script, powerShell ? powerShellScript(command) : command, { mode: 0o600 });
        const shellArgs = powerShell ? [...POWERSHELL_SCRIPT_ARGS, script] : [script];
        // A start outside the root could not be entered from inside it.
        const startIn = isInside(cwd, options.root) ? cwd : options.root;
        const env = confinedEnvironment(process.env, { root: options.root, tmp, shell, platform, gitConfig: options.gitConfig });
        const readOnlyFiles = options.gitConfig ? [options.gitConfig] : [];
        const policyFile = path.join(tmp, "policy.json");
        let args: string[];
        if (wslc) {
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
        } else if (kind === "mxc" && isLinuxMxc(options.runner)) {
          const request = mxcLinuxConfig({
            root: options.root,
            writableRoot: options.writableRoot,
            allowWrite: options.allowWrite,
            agentDir: options.agentDir,
            configFile: options.configFile,
            tmp,
            shell,
            shellArgs,
            cwd: startIn,
            env,
            searchPath: env.PATH,
            readOnlyFiles,
            ...(options.networkProxy === undefined ? {} : { networkProxy: options.networkProxy.url }),
          });
          await writeFile(policyFile, JSON.stringify(request), { mode: 0o600 });
          args = [policyFile];
        } else if (kind === "mxc") {
          const request = mxcTerminalConfig({
            root: options.root,
            writableRoot: options.writableRoot,
            allowWrite: options.allowWrite,
            agentDir: options.agentDir,
            configFile: options.configFile,
            tmp,
            shell,
            shellArgs,
            cwd: startIn,
            env,
            siblings: siblingsToDeny(options.root),
            readOnlyFiles,
            ...(options.networkProxy === undefined ? {} : { networkProxy: options.networkProxy.url }),
          });
          await writeFile(policyFile, JSON.stringify(request), { mode: 0o600 });
          args = [policyFile];
        } else {
          const policy = terminalPolicy({
            root: options.root,
            writableRoot: options.writableRoot,
            allowWrite: options.allowWrite,
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
        const launch = () => run(options.runner, args, { cwd: startIn, env, onData, signal, timeoutMs, timeout, windows });
        // curl, git and PowerShell print only "403" for a refused tunnel: the model is told which
        // host, and why. Commands of the agent's shell run one at a time, so these are this one's.
        const refused = new Set<string>();
        const unwatch = wslc ? undefined : options.networkProxy?.watchRefusals((host) => refused.add(host));
        try {
          return await (wslc ? oneWslcAtATime(launch) : launch());
        } finally {
          unwatch?.();
          if (refused.size > 0) {
            const hosts = [...refused].join(", ");
            onData(Buffer.from(`\n[pi-outpost] network refused: ${hosts} — not in sandbox.allowedHosts. Ask the user to add ${refused.size > 1 ? "them" : "it"} there if the command needs ${refused.size > 1 ? "them" : "it"}.\n`));
          }
        }
      } finally {
        await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
      }
    },
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
