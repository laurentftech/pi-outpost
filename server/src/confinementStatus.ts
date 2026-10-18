/**
 * The confinement canary, run for each surface the way that surface runs commands: the agent's
 * shell through `confinedBashOperations` with the options its tools are built with, the terminal
 * through the launch a terminal gets (`confinedLaunch`), without a pty. See `confinementCanary.ts`.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import type { ConfinementVerdict } from "@pi-outpost/shared";
import { confinedBashOperations, isPowerShell } from "./confinedBash.ts";
import { runCanary } from "./confinementCanary.ts";
import { agentBashOptions } from "./sandbox.ts";
import type { SandboxConfig } from "./config.ts";
import { confinedLaunch, type TerminalConfinement } from "./terminalManager.ts";
import {
  isPosixMxc,
  mxcPosixConfig,
  mxcTerminalConfig,
  runnerKind,
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
  const readOnlyFiles = gitConfig ? [gitConfig] : [];
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
            ? (terminal) => mxcTerminalConfig({ ...limits, ...terminal, siblings: siblingsToDeny(root) })
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
        return await new Promise<string>((resolve) =>
          execFile(launch.file, launch.args, { env: launch.env, cwd: launch.cwd, timeout: CANARY_TIMEOUT_MS, windowsHide: true }, (_error, stdout, stderr) =>
            resolve(`${stdout}${stderr}`),
          ),
        );
      } finally {
        await launch.files.dispose().catch(() => {});
      }
    },
  });
}
