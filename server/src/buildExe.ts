/**
 * Building the standalone executable, from the package that is already installed.
 *
 * Everything here exists because the manual procedure is a list of details whose
 * absence produces a failure nobody can read. A BOM in the config file: Node's JSON
 * parser dies on byte one. A missing `mainFormat`: the bundle loads as CommonJS and
 * fails on its first `import`. An output without `.exe`: Windows will not execute
 * it. A Mach-O whose signature no longer matches its bytes: the kernel kills it, and
 * says neither "signature" nor "codesign".
 *
 * So none of it is the operator's to get right. The config is generated to a
 * temporary path and removed again; what they type is one command.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundledMxcExecutor, MXC_EXECUTOR_NAME } from "./mxcExecutor.ts";

/** What `node --build-sea` needs, and the reason each field is here. */
export interface SeaConfig {
  /** The fully-inlined bundle: every dependency and the web UI, so nothing is read from disk. */
  main: string;
  output: string;
  /** The bundle is ESM. Without this Node loads it as CommonJS and it dies on its first import. */
  mainFormat: "module";
  disableExperimentalSEAWarning: true;
}

export function seaConfigFor(main: string, output: string): SeaConfig {
  return { main, output, mainFormat: "module", disableExperimentalSEAWarning: true };
}

/**
 * The config as bytes, written the one way Node will read back.
 *
 * `JSON.stringify` and UTF-8 with no byte order mark. PowerShell's `Out-File
 * -Encoding utf8` adds one, and that single detail is the difference between a build
 * and `SyntaxError: Unexpected token` pointing at a file that looks perfect in an
 * editor.
 */
export function seaConfigBytes(config: SeaConfig): Buffer {
  return Buffer.from(JSON.stringify(config, null, 2), "utf8");
}

/** What the platform will actually execute. */
export function executableName(base: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? `${base}.exe` : base;
}

/** The name a release artifact carries, so which one to download is legible from the name alone. */
export function releaseArtifactName(
  version: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  return executableName(`pi-outpost-${version}-${os}-${arch}`, platform);
}

/** `--build-sea` landed in Node 26; below it, the blob and postject are the way. */
export const MINIMUM_DIRECT_BUILD_MAJOR = 26;

export function majorOf(version: string): number {
  return Number(version.replace(/^v/, "").split(".")[0]);
}

export function canBuildDirectly(version: string = process.version): boolean {
  return majorOf(version) >= MINIMUM_DIRECT_BUILD_MAJOR;
}

/**
 * Where the pieces are, across the three layouts this can run from.
 *
 * The published package (bundle and blob beside the running file), a clone (they are
 * in cli/dist), and an executable already built (it has neither, and is told so
 * rather than left to fail on an ENOENT).
 */
export function findBuildInputs(from?: string): { bundle?: string; blob?: string } {
  from = from ?? import.meta.dirname;
  // A checkout's command starts from server/src, but its current SEA bundle lives
  // in server/dist. Prefer it over cli/dist, whose published-package bundle can be
  // from an earlier release and would silently discard the source changes just built.
  const candidates = [
    { root: from, bundle: "pi-outpost.sea.mjs" },
    { root: path.resolve(from, "../dist"), bundle: "bundle.mjs" },
    { root: path.resolve(from, "../../cli/dist"), bundle: "pi-outpost.sea.mjs" },
  ];
  const found: { bundle?: string; blob?: string } = {};
  for (const { root, bundle: bundleName } of candidates) {
    const bundle = path.join(root, bundleName);
    const blob = path.join(root, "sea-prep.blob");
    if (found.bundle === undefined && fs.existsSync(bundle)) found.bundle = bundle;
    if (found.blob === undefined && fs.existsSync(blob)) found.blob = blob;
  }
  return found;
}

export class BuildExeError extends Error {}

/**
 * The marker postject overwrites. A node built without single-executable support has none.
 *
 * Assembled at run time, never written out whole. This module is inlined into the
 * bundle that becomes the executable, so a literal here would put a second copy of
 * the sentinel inside the very binary Node is asked to inject into — and Node
 * refuses with "found more than one occurrence of sentinel", which is how this was
 * discovered: on three CI runners at once, by the feature that reads it.
 *
 * Joined through an array rather than concatenated, because a bundler folds adjacent
 * string literals back into one and the literal would reappear.
 */
const FUSE_PARTS = ["NODE", "SEA", "FUSE", "fce680ab2cc467b6", "e072b8b5df1996b2"];
export const SEA_SENTINEL_FUSE = `${FUSE_PARTS.slice(0, 3).join("_")}_${FUSE_PARTS.slice(3).join("")}`;

/**
 * Whether this `node` can host an injected blob at all.
 *
 * Not every build carries the sentinel — Homebrew's node@24 does not, and the
 * failure it produces is postject's "Could not find the sentinel ... in the binary",
 * which reads like a corrupt download rather than an unsupported runtime. Asked
 * before anything is copied, so the answer arrives as a sentence instead.
 *
 * Scanned in chunks with an overlap, because the file is a hundred megabytes and the
 * marker could straddle any boundary.
 */
export function carriesSeaSentinel(binary: string = process.execPath): boolean {
  const CHUNK = 1 << 20;
  const overlap = Buffer.byteLength(SEA_SENTINEL_FUSE);
  const handle = fs.openSync(binary, "r");
  try {
    const buffer = Buffer.alloc(CHUNK + overlap);
    let position = 0;
    let carried = 0;
    for (;;) {
      const read = fs.readSync(handle, buffer, carried, CHUNK, position);
      if (read === 0) return false;
      if (buffer.subarray(0, carried + read).includes(SEA_SENTINEL_FUSE)) return true;
      buffer.copy(buffer, 0, carried + read - overlap, carried + read);
      carried = overlap;
      position += read;
    }
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * One run of a tool, with its output kept for the message when it fails.
 *
 * `missing` is separate from `ok` on purpose: "the tool is not installed" and "the
 * tool ran and refused" need different sentences, and probing for presence by
 * running something like `--version` gets it wrong — `codesign --version` is not an
 * option codesign has, so a perfectly present tool reports itself absent.
 */
function run(command: string, args: string[]): { ok: boolean; output: string; missing: boolean } {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error !== undefined) {
    const missing = (result.error as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, output: result.error.message, missing };
  }
  return { ok: result.status === 0, output, missing: false };
}

/**
 * Sign the result, on the platform where an unsigned result does not run.
 *
 * Ad-hoc (`--sign -`) is enough to launch on the machine that built it. It is not a
 * distribution signature: Gatekeeper still warns on a downloaded file, which is a
 * separate problem with a separate cost and is not solved here.
 */
export function resignMacho(target: string): void {
  // Removing first: the signature that came with the node binary describes bytes
  // that are no longer there, and re-signing over it is refused.
  run("codesign", ["--remove-signature", target]);
  const signed = run("codesign", ["--sign", "-", target]);
  if (signed.missing) {
    throw new BuildExeError(
      "codesign is required on macOS to make the executable launchable — install the Xcode command line tools (xcode-select --install)",
    );
  }
  if (!signed.ok) throw new BuildExeError(`could not sign the executable: ${signed.output}`);
}

export interface BuildOptions {
  /** Where to write it. Defaults to the platform-correct name in the current directory. */
  out?: string;
  force?: boolean;
  cwd?: string;
  /** Overridable for tests; the real one is the Node running this. */
  nodeVersion?: string;
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
  /** Where to look for the bundle and the blob. Overridable so a test can point at neither. */
  inputsFrom?: string;
  /** Skips running the result. For a cross-built artifact, which by definition cannot run here. */
  skipSmokeTest?: boolean;
}

export interface BuildResult {
  path: string;
  /** Which path produced it — the two artifacts differ, and someone debugging needs to know. */
  method: "build-sea" | "postject";
  /** MXC's executor, placed beside a Windows executable so `"mxc"` finds it there. */
  mxcExecutor?: string;
}

/**
 * Put MXC's executor beside a Windows executable, where `"mxc"` looks for it.
 *
 * A standalone executable has no `node_modules`, so the executor the package ships would
 * stay behind on the build machine. Copied, not embedded: it is Microsoft's signed file,
 * and extracting a copy at run time would only add a writable place it could be swapped.
 * Nothing to copy (the optional install was skipped) is said, not refused: the executable
 * works without it, and `terminal.sandbox` can still name a path.
 */
export function placeMxcExecutor(
  target: string,
  options: { platform: NodeJS.Platform; force?: boolean; log: (line: string) => void; executor?: string | undefined },
): string | undefined {
  if (options.platform !== "win32") return undefined;
  const source = "executor" in options ? options.executor : bundledMxcExecutor({ platform: "win32" });
  const destination = path.join(path.dirname(target), MXC_EXECUTOR_NAME);
  if (source === undefined) {
    if (fs.existsSync(destination)) return destination;
    options.log(`[build-exe] MXC's executor is not installed: "mxc" will not resolve beside ${target}`);
    return undefined;
  }
  if (path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) return destination;
  if (fs.existsSync(destination) && options.force !== true) {
    options.log(`[build-exe] kept the ${MXC_EXECUTOR_NAME} already beside it — pass --force to replace it`);
    return destination;
  }
  fs.copyFileSync(source, destination);
  options.log(`[build-exe] placed MXC's executor beside it: ${destination}`);
  return destination;
}

/**
 * Run what was just produced, before calling it produced.
 *
 * "Wrote pi-outpost" for a file that segfaults on its first invocation is a lie the
 * operator discovers later and blames on the wrong thing. It costs one process to
 * find out here — and it does find things out: a runtime whose single-executable
 * support is broken on its own platform builds an artifact happily and crashes on
 * `--version`, which a hello-world reproduces and no amount of reading the config
 * would have revealed.
 */
export function producedExecutableRuns(target: string): { ok: boolean; detail: string } {
  const result = spawnSync(target, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (result.error !== undefined) return { ok: false, detail: result.error.message };
  if (result.signal !== null) return { ok: false, detail: `killed by ${result.signal}` };
  if (result.status !== 0) {
    return { ok: false, detail: `exited ${result.status}: ${`${result.stdout ?? ""}${result.stderr ?? ""}`.trim()}` };
  }
  return { ok: true, detail: (result.stdout ?? "").trim() };
}

/**
 * Produce the executable, or refuse in a way that says what to do.
 *
 * The refusals are the point as much as the build is: every one of them replaces a
 * failure that would otherwise surface later, on someone else's machine, as a native
 * assertion.
 */
export function buildExecutable(options: BuildOptions = {}): BuildResult {
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((line: string) => console.log(line));
  const version = options.nodeVersion ?? process.version;

  const target = path.resolve(cwd, options.out ?? executableName("pi-outpost", platform));
  if (fs.existsSync(target) && options.force !== true) {
    throw new BuildExeError(`${target} already exists — pass --force to replace it`);
  }

  const { bundle, blob } = findBuildInputs(options.inputsFrom);
  if (bundle === undefined && blob === undefined) {
    throw new BuildExeError(
      "no build inputs beside this installation — build an executable from an installed package (npm i pi-outpost) or a clone, not from an executable",
    );
  }

  if (canBuildDirectly(version) && bundle !== undefined) {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-outpost-sea-")), "sea-config.json");
    fs.writeFileSync(configPath, seaConfigBytes(seaConfigFor(bundle, target)));
    try {
      log(`[build-exe] building with node --build-sea (node ${version})`);
      const built = run(process.execPath, ["--build-sea", configPath]);
      if (!built.ok) throw new BuildExeError(`node --build-sea failed: ${built.output}`);
    } finally {
      fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
    }
    if (platform === "darwin") resignMacho(target);

    const verdict = options.skipSmokeTest === true ? { ok: true, detail: "" } : producedExecutableRuns(target);
    if (verdict.ok) return withMxcExecutor({ path: target, method: "build-sea" }, platform, options.force, log);

    // Evidence, not a platform guess: `--build-sea` is the newer path and on some
    // builds it produces an executable that segfaults on its first invocation, while
    // the blob this same package ships injects into the same runtime and runs.
    // Found on macOS x64 with Node 26.7, where a one-line hello-world reproduces it.
    // So the fallback is taken because this one failed, which cannot rot the way a
    // list of afflicted platforms would.
    if (blob === undefined || !carriesSeaSentinel()) {
      throw new BuildExeError(
        `built ${target} with node --build-sea but it does not run — ${verdict.detail}. ` +
          `This runtime's --build-sea is failing, not your configuration; a one-line hello-world built the same way fails the same way.`,
      );
    }
    log(`[build-exe] the direct build does not run here (${verdict.detail}) — falling back to the blob`);
    fs.rmSync(target, { force: true });
  }

  // The older path, and it says so: a blob injected into a copy of this node is not
  // byte-identical to a --build-sea result, and "which one do I have" is the first
  // question when one of them misbehaves.
  if (blob === undefined) {
    throw new BuildExeError(
      `node ${version} cannot build directly (needs ${MINIMUM_DIRECT_BUILD_MAJOR} or newer) and sea-prep.blob is missing from this installation`,
    );
  }
  if (!carriesSeaSentinel()) {
    throw new BuildExeError(
      `this node (${process.execPath}) was built without single-executable support, so a blob cannot be injected into it — ` +
        `install Node ${MINIMUM_DIRECT_BUILD_MAJOR} or newer and the executable is built directly, with no injection at all`,
    );
  }
  // The blob carries `mainFormat: "module"`, because the bundle is ESM and without the
  // field the runtime loads it as CommonJS and dies on its first `import`. A node that
  // predates the field asserts on it at startup instead — issue #14, from the other
  // direction. So the blob wants the same version `--build-sea` does, and there is no
  // version left where injecting it produces something that runs: refuse here rather
  // than hand over a binary that asserts, which is what "leaves nothing broken behind"
  // means when the fallback cannot help either.
  if (!canBuildDirectly(version)) {
    throw new BuildExeError(
      `node ${version} cannot build a standalone executable: --build-sea needs ${MINIMUM_DIRECT_BUILD_MAJOR} or newer, ` +
        `and sea-prep.blob declares a module format that a node older than that rejects at startup — ` +
        `install Node ${MINIMUM_DIRECT_BUILD_MAJOR} or newer`,
    );
  }
  fs.copyFileSync(process.execPath, target);
  // The copy inherits the mode, and a packaged node is commonly r-xr-xr-x — not
  // writable even by its owner, so postject fails with "Can't read and write to
  // target executable" on a file the operator can see perfectly well.
  fs.chmodSync(target, 0o755);
  const injected = run("npx", [
    "--yes",
    "postject",
    target,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    SEA_SENTINEL_FUSE,
    ...(platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
    "--overwrite",
  ]);
  if (!injected.ok) {
    fs.rmSync(target, { force: true });
    throw new BuildExeError(`postject failed: ${injected.output}`);
  }
  if (platform === "darwin") resignMacho(target);
  assertItRuns(target, "postject", options);
  return withMxcExecutor({ path: target, method: "postject" }, platform, options.force, log);
}

function withMxcExecutor(result: BuildResult, platform: NodeJS.Platform, force: boolean | undefined, log: (line: string) => void): BuildResult {
  const executor = placeMxcExecutor(result.path, { platform, force, log });
  return executor === undefined ? result : { ...result, mxcExecutor: executor };
}

/**
 * Refuse to call an executable produced when it does not run.
 *
 * The file is left in place rather than deleted: it is the evidence, and whoever is
 * debugging a runtime that builds unrunnable executables needs it.
 */
function assertItRuns(target: string, method: string, options: BuildOptions): void {
  if (options.skipSmokeTest === true) return;
  const verdict = producedExecutableRuns(target);
  if (verdict.ok) return;
  throw new BuildExeError(
    `built ${target} (${method}) but it does not run — ${verdict.detail}. ` +
      `The file is left in place. This is the runtime's single-executable support failing, not your configuration: ` +
      `a one-line hello-world built the same way will fail the same way, which is worth checking before looking further.`,
  );
}
