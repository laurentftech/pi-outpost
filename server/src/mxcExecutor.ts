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
 *
 * On Linux the same package ships `lxc-exec`, which `"mxc"` names there: its Bubblewrap
 * backend takes the same request document (see `mxcLinuxConfig`). On macOS it ships
 * `mxc-exec-mac`, Seatbelt, for Apple silicon only (see `mxcMacConfig`).
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** The value of `sandbox.bashRunner` and `terminal.sandbox` that names the executor pi-outpost ships. */
export const BUNDLED_MXC = "mxc";

/** The Windows executor's file name, in the package and beside a standalone executable. */
export const MXC_EXECUTOR_NAME = "wxc-exec.exe";

/** The Linux executor's file name: Bubblewrap and LXC backends, the same request document. */
export const MXC_LINUX_EXECUTOR_NAME = "lxc-exec";

/** The macOS executor's file name: Seatbelt, the same request document, `bin/arm64` only. */
export const MXC_MAC_EXECUTOR_NAME = "mxc-exec-mac";

/** The executor for a platform: Windows', Linux's or macOS'; none elsewhere. */
export function mxcExecutorName(platform: NodeJS.Platform): string | undefined {
  return platform === "win32"
    ? MXC_EXECUTOR_NAME
    : platform === "linux"
      ? MXC_LINUX_EXECUTOR_NAME
      : platform === "darwin"
        ? MXC_MAC_EXECUTOR_NAME
        : undefined;
}

/** Whether MXC ships an executor for this platform and architecture: macOS' is Apple silicon only. */
export function mxcSupportsArch(platform: NodeJS.Platform, arch: string): boolean {
  return platform === "darwin" ? arch === "arm64" : arch === "x64" || arch === "arm64";
}

export interface MxcExecutorLookup {
  /** Default `process.platform`: which executor. */
  platform?: NodeJS.Platform;
  /** Default `process.arch`. The package carries `x64` and `arm64` only. */
  arch?: string;
  /** Default `process.execPath`: the standalone executable, or node. */
  execPath?: string;
  /** Where the installed package's manifest is, if it is installed. */
  packageManifest?: () => string | undefined;
  exists?: (file: string) => boolean;
}

/** Why `"mxc"` found no executor: none for this platform or architecture, or the package not installed. */
export function mxcMissingReason(platform: NodeJS.Platform, arch: string, execPath: string): string {
  const name = mxcExecutorName(platform);
  if (name === undefined) return `MXC has no executor for ${platform}: it confines on Windows, Linux and macOS only`;
  if (!mxcSupportsArch(platform, arch)) {
    return platform === "darwin"
      ? `MXC has no executor for ${platform} on ${arch}: on macOS it ships for Apple silicon (arm64) only`
      : `MXC has no executor for ${platform} on ${arch}: it ships for x64 and arm64`;
  }
  return `MXC's executor is not installed for ${arch}: reinstall pi-outpost with its optional dependencies, or put ${name} beside ${execPath}`;
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
  const platform = lookup.platform ?? process.platform;
  const name = mxcExecutorName(platform);
  if (!mxcSupportsArch(platform, arch) || name === undefined) return undefined;
  const exists = lookup.exists ?? existsSync;
  const manifest = (lookup.packageManifest ?? installedPackageManifest)();
  const candidates = [
    ...(manifest ? [path.join(path.dirname(manifest), "bin", arch, name)] : []),
    path.join(path.dirname(lookup.execPath ?? process.execPath), name),
  ];
  return candidates.find((candidate) => exists(candidate));
}

/** MXC's native library, which its SDK loads in process (`mxcSdk.ts`), per platform. */
export const MXC_FFI_NAMES: Partial<Record<NodeJS.Platform, string>> = { win32: "mxc_ffi.dll", linux: "libmxc_ffi.so", darwin: "libmxc_ffi.dylib" };

/** The files MXC needs beside a standalone executable, which has no `node_modules` (`buildExe.ts`). */
export function mxcBesideExecutable(platform: NodeJS.Platform, arch: string): string[] {
  const ffi = MXC_FFI_NAMES[platform];
  return ffi ? [ffi, path.join("node_modules", "koffi", "package.json"), path.join("node_modules", "@koromix", `koffi-${platform}-${arch}`, "package.json")] : [];
}

/**
 * Whether MXC can run in process here: its SDK installed with the native library for this
 * platform and architecture, or — in a standalone executable — that library and koffi beside it.
 * A file check, synchronous, for the configuration's load; the SDK itself is loaded on first use.
 */
export function mxcSdkInstalled(lookup: MxcExecutorLookup = {}): boolean {
  const platform = lookup.platform ?? process.platform;
  const arch = lookup.arch ?? process.arch;
  const ffi = MXC_FFI_NAMES[platform];
  if (ffi === undefined || !mxcSupportsArch(platform, arch)) return false;
  const exists = lookup.exists ?? existsSync;
  const manifest = (lookup.packageManifest ?? installedPackageManifest)();
  if (manifest && exists(path.join(path.dirname(manifest), "bin", arch, ffi))) return true;
  const beside = path.dirname(lookup.execPath ?? process.execPath);
  return mxcBesideExecutable(platform, arch).every((file) => exists(path.join(beside, file)));
}

/** Whether a runner path names one of MXC's executors, which `"mxc"` replaces. */
export function isMxcExecutorPath(runner: string): boolean {
  return /^(wxc-exec(\.exe)?|lxc-exec|mxc-exec-mac)$/i.test(path.win32.basename(runner)) && runner !== BUNDLED_MXC;
}

/** Why MXC cannot run in process here, in words a user can act on. */
export function mxcSdkMissingReason(platform: NodeJS.Platform, arch: string, execPath: string): string {
  if (MXC_FFI_NAMES[platform] === undefined) return `MXC confines on Windows, Linux and macOS only, not ${platform}`;
  if (!mxcSupportsArch(platform, arch)) {
    return platform === "darwin" ? `MXC does not run on ${platform} ${arch}: on macOS, Apple silicon (arm64) only` : `MXC does not run on ${arch}: x64 and arm64 only`;
  }
  return `MXC's SDK is not installed for ${arch}: reinstall pi-outpost with its optional dependencies, or rebuild the executable beside ${execPath} where it is installed`;
}

/**
 * Whether MXC runs in process here, through its SDK. Everywhere but Linux.
 *
 * On Linux the SDK's native library forks `bwrap` from the server's own process, which hands it
 * the server's whole environment, keys included. That process is visible inside the sandbox, and
 * a command reads them from `/proc/<pid>/environ`. The SDK has no option for the environment
 * `bwrap` itself starts with (microsoft/mxc#1783). So Linux keeps MXC's executor (`lxc-exec`), started with the
 * command's own minimal environment: `bwrap` inherits that, and holds nothing to read.
 */
export function mxcRunsInProcess(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "linux";
}

/** Whether MXC can run here: its SDK where it runs in process, its executor on Linux. */
export function mxcInstalled(lookup: MxcExecutorLookup = {}): boolean {
  return mxcRunsInProcess(lookup.platform ?? process.platform) ? mxcSdkInstalled(lookup) : bundledMxcExecutor(lookup) !== undefined;
}

/** Why MXC cannot run here, in words a user can act on. */
export function mxcNotInstalledReason(platform: NodeJS.Platform, arch: string, execPath: string): string {
  return mxcRunsInProcess(platform) ? mxcSdkMissingReason(platform, arch, execPath) : mxcMissingReason(platform, arch, execPath);
}

/**
 * The executor a runner value names on Linux: the one pi-outpost ships for `"mxc"`, or the
 * `lxc-exec` a path names. Undefined when `"mxc"` finds none.
 */
export function linuxMxcExecutor(runner: string, lookup: MxcExecutorLookup = {}): string | undefined {
  return runner === BUNDLED_MXC ? bundledMxcExecutor({ ...lookup, platform: "linux" }) : runner;
}
