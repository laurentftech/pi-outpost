/**
 * `sandbox.bashRunner: "auto"` and `"none"`.
 *
 * `"auto"` is the default whenever the configuration says nothing about the sandbox: the
 * platform's runner — MXC's executor on Windows and Linux, Seatbelt on macOS — earns the
 * agent's shell only once its self-check and the confinement canary have passed. Until then a
 * command waits; if they fail, every command is refused with the reason, and nothing runs
 * unconfined. `"none"` is the deliberate way back to an unconfined shell, written in the file.
 */
import { BUNDLED_MXC, mxcSdkInstalled, mxcSdkMissingReason } from "./mxcExecutor.ts";
import { SANDBOX_EXEC } from "./terminalSandbox.ts";

/** The value of `sandbox.bashRunner` that asks the server to choose a runner. */
export const AUTO_RUNNER = "auto";

/** The value of `sandbox.bashRunner` that runs the agent's shell unconfined. */
export const NO_RUNNER = "none";

/** The one runner `"auto"` tries on a platform: its path, and the name a person knows it by. */
export type PlatformRunner = { runner: string; label: string } | { reason: string };

export interface PlatformRunnerLookup {
  platform?: NodeJS.Platform;
  arch?: string;
  execPath?: string;
  /** `"mxc"` where MXC can run in process, else undefined; a parameter for tests. */
  mxcExecutor?: () => string | undefined;
}

/**
 * The runner `"auto"` would take here, or why there is none. One candidate per platform, so a
 * refusal is always about one runner: landstrip is a separate install and is never guessed.
 */
export function platformRunner(lookup: PlatformRunnerLookup = {}): PlatformRunner {
  const platform = lookup.platform ?? process.platform;
  if (platform === "darwin") return { runner: SANDBOX_EXEC, label: "Seatbelt" };
  if (platform !== "win32" && platform !== "linux") return { reason: `no sandbox runner confines commands on ${platform}` };
  // MXC runs in process through its SDK: `"mxc"` is the runner, once its native parts are there.
  const installed = (lookup.mxcExecutor ?? (() => (mxcSdkInstalled({ platform, ...(lookup.arch ? { arch: lookup.arch } : {}) }) ? BUNDLED_MXC : undefined)))();
  if (installed === undefined) {
    return { reason: mxcSdkMissingReason(platform, lookup.arch ?? process.arch, lookup.execPath ?? process.execPath) };
  }
  return { runner: installed, label: "MXC" };
}

/** The configuration line that confines an unconfined shell, and the command that writes it after checking. */
export const CONFINE_SUGGESTION = `run "pi-outpost config --confine" (it checks this machine, then sets "sandbox.bashRunner": "auto")`;
