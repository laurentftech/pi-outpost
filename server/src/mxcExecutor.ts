/**
 * MXC's executor as pi-outpost ships it.
 *
 * `wxc-exec.exe` comes with `@microsoft/mxc-sdk`, an optional dependency: signed by
 * Microsoft, MIT, and the only thing a Windows 11 deployment needs beside pi-outpost to
 * confine the terminal and the agent's shell. `"mxc"` in `sandbox.bashRunner` or
 * `terminal.sandbox` names it, so a configuration does not carry a path into
 * `node_modules` that changes with every installation.
 *
 * A standalone executable has no `node_modules`: there, the executor is the
 * `wxc-exec.exe` beside it, where `build-exe` puts it. The executor runs alone — the
 * package's DLLs serve its Node bindings, not the executable.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** The value of `sandbox.bashRunner` and `terminal.sandbox` that names the executor pi-outpost ships. */
export const BUNDLED_MXC = "mxc";

/** The executor's file name, in the package and beside a standalone executable. */
export const MXC_EXECUTOR_NAME = "wxc-exec.exe";

export interface MxcExecutorLookup {
  /** Default `process.arch`. The package carries `x64` and `arm64` only. */
  arch?: string;
  /** Default `process.execPath`: the standalone executable, or node. */
  execPath?: string;
  /** Where the installed package's manifest is, if it is installed. */
  packageManifest?: () => string | undefined;
  exists?: (file: string) => boolean;
}

/** Where the installed `@microsoft/mxc-sdk` is: absent when the optional install was skipped or failed. */
function installedPackageManifest(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve("@microsoft/mxc-sdk/package.json");
  } catch {
    return undefined;
  }
}

/**
 * The executor pi-outpost ships, for this architecture: the installed package's, else the
 * one beside the running executable. Undefined when neither is there.
 */
export function bundledMxcExecutor(lookup: MxcExecutorLookup = {}): string | undefined {
  const arch = lookup.arch ?? process.arch;
  if (arch !== "x64" && arch !== "arm64") return undefined;
  const exists = lookup.exists ?? existsSync;
  const manifest = (lookup.packageManifest ?? installedPackageManifest)();
  const candidates = [
    ...(manifest ? [path.join(path.dirname(manifest), "bin", arch, MXC_EXECUTOR_NAME)] : []),
    path.join(path.dirname(lookup.execPath ?? process.execPath), MXC_EXECUTOR_NAME),
  ];
  return candidates.find((candidate) => exists(candidate));
}
