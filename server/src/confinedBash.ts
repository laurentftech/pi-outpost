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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import {
  checkRunner,
  confinedEnvironment,
  mxcTerminalConfig,
  runnerKind,
  siblingsToDeny,
  terminalPolicy,
  type RunnerCheck,
} from "./terminalSandbox.ts";

export interface ConfinedBashOptions {
  /** `sandbox.bashRunner`: MXC's executor or landstrip's binary. */
  runner: string;
  /** `sandbox.bashShell`. Default `/bin/bash`; Windows has none that works by default. */
  shell?: string;
  /** The sandbox root: what a command may read, and where it starts. */
  root: string;
  /** Where it may write; undefined with `allowWrite`: the whole root. */
  writableRoot?: string;
  allowWrite: boolean;
  /** Never readable: the provider keys. */
  agentDir?: string;
  /** Never readable. */
  configFile?: string;
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

export function confinedBashOperations(options: ConfinedBashOptions): BashOperations {
  const platform = options.platform ?? process.platform;
  const windows = platform === "win32";
  const kind = runnerKind(options.runner);
  const shell = options.shell ?? (windows ? undefined : "/bin/bash");
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      const timeoutMs = timeoutInMs(timeout);
      if (signal?.aborted) throw new Error("aborted");
      const check = await (options.check ?? cachedCheck)(options.runner);
      if (!check.ok) throw new Error(`bash is confined by ${options.runner}, which cannot run it: ${check.reason}`);
      if (!shell) {
        throw new Error(
          `bash is confined by ${options.runner}, but "sandbox.bashShell" names no shell. On Windows, Git Bash cannot start in a sandbox: name busybox-w32's sh.exe.`,
        );
      }

      const tmp = await mkdtemp(path.join(tmpdir(), "pi-outpost-bash-"));
      try {
        const script = path.join(tmp, "command.sh");
        await writeFile(script, command, { mode: 0o600 });
        // A start outside the root could not be entered from inside it.
        const startIn = isInside(cwd, options.root) ? cwd : options.root;
        const env = confinedEnvironment(process.env, { root: options.root, tmp, shell, platform });
        const policyFile = path.join(tmp, "policy.json");
        let args: string[];
        if (kind === "mxc") {
          const request = mxcTerminalConfig({
            root: options.root,
            writableRoot: options.writableRoot,
            allowWrite: options.allowWrite,
            agentDir: options.agentDir,
            configFile: options.configFile,
            tmp,
            shell,
            shellArgs: [script],
            cwd: startIn,
            env,
            siblings: siblingsToDeny(options.root),
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
            platform,
          });
          await writeFile(policyFile, JSON.stringify(policy), { mode: 0o600 });
          args = ["run", "-p", policyFile, "--", shell, script];
        }
        return await run(options.runner, args, { cwd: startIn, env, onData, signal, timeoutMs, timeout, windows });
      } finally {
        await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
      }
    },
  };
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
