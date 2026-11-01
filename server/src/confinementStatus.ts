/**
 * The confinement canary, run for each surface the way that surface runs commands: the agent's
 * shell through `confinedBashOperations` with the options its tools are built with, the terminal
 * through the launch a terminal gets (`confinedLaunch`), without a pty. See `confinementCanary.ts`.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import type { ConfinementVerdict } from "@pi-outpost/shared";
import { CONFINE_SUGGESTION, platformRunner, type PlatformRunner } from "./autoRunner.ts";
import { cachedCheck, confinedBashOperations, isPowerShell } from "./confinedBash.ts";
import { runCanary } from "./confinementCanary.ts";
import { agentBashOptions } from "./sandbox.ts";
import type { SandboxConfig } from "./config.ts";
import { confinedLaunch, type TerminalConfinement } from "./terminalManager.ts";
import {
  gitReadOnlyFiles,
  isPosixMxc,
  mxcPosixConfig,
  mxcTerminalConfig,
  runnerKind,
  type RunnerCheck,
  seatbeltPolicy,
  siblingsToDeny,
  terminalPolicy,
  userGitConfig,
} from "./terminalSandbox.ts";

/**
 * How a terminal is confined by `runner`: the same root and writable zone as the agent's
 * sandbox (the project root without one), and never the agent directory — the provider keys —
 * nor the configuration. The terminal and the canary both build theirs here.
 */
export function buildTerminalConfinement(input: {
  runner: string;
  root: string;
  writableRoot?: string;
  allowWrite: boolean;
  agentDir?: string;
  configFile?: string;
}): TerminalConfinement {
  const { runner, root, writableRoot, allowWrite, agentDir, configFile } = input;
  const kind = runnerKind(runner);
  // git's identity: the user's ~/.gitconfig, readable on its own (see userGitConfig).
  const gitConfig = userGitConfig();
  const readOnlyFiles = gitReadOnlyFiles(gitConfig);
  const limits = { root, writableRoot, allowWrite, agentDir, configFile, readOnlyFiles };
  return {
    runner,
    kind,
    root,
    ...(gitConfig ? { gitConfig } : {}),
    policy:
      kind === "seatbelt"
        ? (terminal) => seatbeltPolicy({ ...limits, ...terminal, searchPath: terminal.env.PATH })
        : kind === "mxc" && isPosixMxc(runner)
          ? (terminal) => mxcPosixConfig(runner, { ...limits, ...terminal, searchPath: terminal.env.PATH })
          : kind === "mxc"
            ? (terminal) =>
                mxcTerminalConfig({
                  ...limits,
                  ...terminal,
                  siblings: siblingsToDeny(root),
                  searchPath: terminal.env.PATH,
                  ...(process.env.USERPROFILE ? { home: process.env.USERPROFILE } : {}),
                })
            : ({ tmp }) => terminalPolicy({ ...limits, tmp, searchPath: process.env.PATH, systemRoot: process.env.SystemRoot, userProfile: process.env.USERPROFILE }),
  };
}

/** How long the canary may take, through a runner that starts slowly. */
export const CANARY_TIMEOUT_MS = 60_000;

/**
 * Whether the agent has a confined shell to judge: bash allowed, run by a runner, not handed to an
 * extension. Without bash there is no shell — and no lock to show for it.
 */
export function shellIsConfined(sandbox: SandboxConfig | undefined): sandbox is SandboxConfig & { bashRunner: string } {
  return Boolean(sandbox?.allowBash && sandbox.bashRunner && sandbox.bashFrom === undefined);
}

/** The agent's shell: exactly what its `bash` (or `powershell`) tool runs with. */
export async function agentShellVerdict(sandbox: SandboxConfig, neverReadable: { agentDir?: string; configFile?: string }): Promise<ConfinementVerdict> {
  const runner = sandbox.bashRunner!;
  try {
    const options = await agentBashOptions(sandbox, neverReadable);
    const ops = confinedBashOperations(options);
    return await runCanary({
      runner,
      agentDir: neverReadable.agentDir,
      root: options.root,
      ...(options.writableRoot ? { writableRoot: options.writableRoot } : {}),
      powerShell: isPowerShell(sandbox.bashShell),
      proxied: sandbox.allowedHosts !== undefined,
      exec: async (command) => {
        let output = "";
        await ops.exec(command, options.root, { onData: (data) => (output += data.toString()), timeout: CANARY_TIMEOUT_MS / 1000 });
        return output;
      },
    });
  } catch (error) {
    return { state: "failed", runner, checkedAt: new Date().toISOString(), reason: (error as Error).message };
  }
}

/** The terminal: its runner and policy, the shell a terminal opens, the canary passed as its command. */
export async function terminalVerdict(confine: TerminalConfinement, shell: string, agentDir: string | undefined, writableRoot?: string): Promise<ConfinementVerdict> {
  const name = path.win32.basename(shell).toLowerCase();
  const powerShell = name === "powershell.exe" || name === "pwsh.exe" || name === "pwsh";
  if (name === "cmd.exe") {
    return { state: "failed", runner: confine.runner, checkedAt: new Date().toISOString(), reason: `the canary speaks POSIX sh and PowerShell, not ${path.win32.basename(shell)}` };
  }
  return runCanary({
    runner: confine.runner,
    agentDir,
    root: confine.root,
    ...(writableRoot ? { writableRoot } : {}),
    powerShell,
    proxied: false,
    exec: async (command) => {
      const oneLine = command.split(/\r?\n/).filter(Boolean).join("; ");
      const shellArgs = powerShell ? ["-NoProfile", "-NonInteractive", "-Command", oneLine] : ["-c", oneLine];
      const launch = await confinedLaunch(confine, shell, shellArgs, confine.root);
      try {
        return await new Promise<string>((resolve) => {
          const child = execFile(launch.file, launch.args, { env: launch.env, cwd: launch.cwd, timeout: CANARY_TIMEOUT_MS, windowsHide: true }, (_error, stdout, stderr) =>
            resolve(`${stdout}${stderr}`),
          );
          // Nothing to type: a shell or runner that reads its input gets its end, not a wait.
          child.stdin?.end();
        });
      } finally {
        await launch.files.dispose().catch(() => {});
      }
    },
  });
}

/**
 * The agent shell's verdict, computed once per sandbox and shared: the lock the interface shows
 * and the gate an `"auto"` runner's commands wait at are the same canary run. A verdict that could
 * not be reached (`failed`) is forgotten once known, so the next command asks again.
 */
const sharedVerdicts = new Map<string, Promise<ConfinementVerdict>>();
/** The last verdict each sandbox reached — kept across a retry, until the retry answers. */
const settledVerdicts = new Map<string, ConfinementVerdict>();
const settleListeners = new Set<(verdict: ConfinementVerdict) => void>();

const verdictKey = (sandbox: SandboxConfig, neverReadable: { agentDir?: string; configFile?: string }) =>
  JSON.stringify([sandbox, neverReadable.agentDir ?? null, neverReadable.configFile ?? null]);

/** Called whenever a shared verdict settles, a retry's included: what the interface shows follows it. */
export function onShellVerdictSettled(listener: (verdict: ConfinementVerdict) => void): () => void {
  settleListeners.add(listener);
  return () => settleListeners.delete(listener);
}

/** The last verdict reached for this sandbox, or undefined while none has been. */
export function settledShellVerdict(sandbox: SandboxConfig, neverReadable: { agentDir?: string; configFile?: string }): ConfinementVerdict | undefined {
  return settledVerdicts.get(verdictKey(sandbox, neverReadable));
}

export function sharedShellVerdict(
  sandbox: SandboxConfig,
  neverReadable: { agentDir?: string; configFile?: string },
  verdict: typeof agentShellVerdict = agentShellVerdict,
): Promise<ConfinementVerdict> {
  const key = verdictKey(sandbox, neverReadable);
  const known = sharedVerdicts.get(key);
  if (known) return known;
  const pending = verdict(sandbox, neverReadable);
  sharedVerdicts.set(key, pending);
  void pending.then((result) => {
    if (result.state === "failed" && sharedVerdicts.get(key) === pending) sharedVerdicts.delete(key);
    settledVerdicts.set(key, result);
    for (const listener of settleListeners) listener(result);
  });
  return pending;
}

/** What the canary attempts, as the refusal of an `"auto"` shell names them. */
const ATTEMPT_WORDS: Record<string, string> = {
  "agent-directory": "read the agent directory (the provider keys)",
  "beside-root": "read a file beside the root",
  "write-beside-root": "write beside the root",
  "signal-process": "signal another process of the server's user",
  "server-environment": "inherit the server's environment",
  "server-process-environment": "read the server's process environment",
  "unlisted-host": "reach a host not in sandbox.allowedHosts",
  "direct-connection": "connect around the proxy",
};

/** The way back to an unconfined shell, named in every refusal of an `"auto"` one. */
export const UNCONFINED_ESCAPE = `To run the shell unconfined instead, set "sandbox.bashRunner": "none" in the configuration file.`;

/**
 * Why an `"auto"` runner may not run the agent's shell, from its verdict; undefined once the canary
 * saw every attempt refused. Anything short of that refuses: the server chose this runner, so it
 * runs nothing it has not shown it confines.
 */
export function autoVerdictRefusal(verdict: ConfinementVerdict): string | undefined {
  const why = (() => {
    switch (verdict.state) {
      case "verified":
        return undefined;
      case "checking":
        return "its confinement has not been checked yet";
      case "failed":
        return verdict.reason;
      case "leaking":
        return `its confinement check got through — a command could ${verdict.reached.map((attempt) => ATTEMPT_WORDS[attempt] ?? attempt).join(", ")}`;
      case "partial":
        return `a command could read the server's process environment, which holds ${verdict.exposed.join(", ")}: move these out of the server's environment`;
      default:
        return "it is not a confined shell";
    }
  })();
  if (why === undefined) return undefined;
  return `The agent's shell is unavailable: ${verdict.runner ? `${path.basename(verdict.runner)} ` : ""}cannot confine it on this machine — ${why}. ${UNCONFINED_ESCAPE}`;
}

/** The refusal of an `"auto"` shell whose platform has no runner at all. */
export function autoUnavailableRefusal(reason: string): string {
  return `The agent's shell is unavailable: nothing can confine it on this machine — ${reason}. ${UNCONFINED_ESCAPE}`;
}

/** The gate an `"auto"` runner's commands wait at: the shared verdict, read as a refusal or nothing. */
export async function autoShellRefusal(
  sandbox: SandboxConfig,
  neverReadable: { agentDir?: string; configFile?: string },
  verdict: typeof agentShellVerdict = agentShellVerdict,
): Promise<string | undefined> {
  return autoVerdictRefusal(await sharedShellVerdict(sandbox, neverReadable, verdict));
}

/**
 * What an `"auto"` shell's verdict means for the interface: checked and holding, or still being
 * checked, as the canary said; anything else, a shell that refuses every command, and why.
 */
export function autoShown(verdict: ConfinementVerdict): ConfinementVerdict {
  if (verdict.state === "verified" || verdict.state === "checking") return verdict;
  return { state: "unavailable", runner: verdict.runner ?? "", reason: autoVerdictRefusal(verdict) ?? "" };
}

/**
 * An unconfined shell's verdict: whether this machine's runner passes its self-check, so the
 * shell could be confined (the nudge), or why it cannot. The self-check only — no canary: it is
 * enough to say a runner would work, and `config --confine` runs the canary before writing.
 */
export async function unconfinedShellVerdict(
  candidate: PlatformRunner = platformRunner(),
  check: (runner: string) => Promise<RunnerCheck> = cachedCheck,
): Promise<ConfinementVerdict> {
  if ("reason" in candidate) return { state: "unconfined", reason: candidate.reason };
  const result = await check(candidate.runner);
  return result.ok
    ? { state: "unconfined", available: { runner: candidate.runner, label: candidate.label } }
    : { state: "unconfined", reason: result.reason };
}

/** Whether the agent's own shell runs unconfined: bash on, no runner, nothing chosen for it, not an extension's. */
export function shellIsUnconfined(sandbox: SandboxConfig | undefined): boolean {
  return Boolean(sandbox?.allowBash && !sandbox.bashRunner && sandbox.autoRunner === undefined && sandbox.bashFrom === undefined);
}

/**
 * The agent shell's verdict, awaited — what `doctor` reports: the canary's for a runner, its
 * `"auto"` reading, the refusal of an `"auto"` shell with no runner, or the nudge for an
 * unconfined one. Undefined with no shell of pi-outpost's own.
 */
export async function shellVerdict(
  sandbox: SandboxConfig | undefined,
  neverReadable: { agentDir?: string; configFile?: string },
): Promise<ConfinementVerdict | undefined> {
  if (!sandbox?.allowBash || sandbox.bashFrom !== undefined) return undefined;
  if (sandbox.autoRunner?.unavailable !== undefined) {
    return { state: "unavailable", runner: "", reason: autoUnavailableRefusal(sandbox.autoRunner.unavailable) };
  }
  if (shellIsConfined(sandbox)) {
    const verdict = await sharedShellVerdict(sandbox, neverReadable);
    return sandbox.autoRunner ? autoShown(verdict) : verdict;
  }
  return unconfinedShellVerdict();
}

/** What the startup log and `doctor` say of an unconfined shell this machine could confine; undefined otherwise. */
export function confineSuggestion(verdict: ConfinementVerdict | undefined): string | undefined {
  if (verdict?.state !== "unconfined" || !verdict.available) return undefined;
  return `the agent's shell runs unconfined, and ${verdict.available.label} can confine it on this machine: ${CONFINE_SUGGESTION}`;
}
