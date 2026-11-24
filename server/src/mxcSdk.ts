/**
 * MXC, run in process through its SDK (`@microsoft/mxc-sdk/v1`), as Microsoft recommends: the
 * agent's shell, the terminal and the self-check, on Windows (ProcessContainer, WSLC), Linux
 * (Bubblewrap) and macOS (Seatbelt). No executor of MXC's runs.
 *
 * pi-outpost builds MXC's request documents itself (`mxcTerminalConfig`, `mxcPosixConfig`,
 * `mxcWslcConfig`): they say exactly what a command may touch, and their tests pin it. This module
 * re-expresses one in the SDK's model, field for field — the SDK's own `prepareContainerRequest`
 * turns the result back into the same document (`mxcSdk.test.ts`) — and runs it.
 *
 * The SDK loads a native library through `koffi`. Installed from npm, both are in `node_modules`;
 * in the standalone executable they are beside it (`buildExe.ts`), and `MXC_FFI_DIR` points the
 * SDK there. Where it cannot load, `"mxc"` is refused with the reason.
 */
import path from "node:path";
import { Readable } from "node:stream";

/** One of MXC's request documents, as pi-outpost builds them (schema 1.0.0). */
export interface MxcWireRequest {
  version: "1.0.0";
  containment: "processcontainer" | "bubblewrap" | "seatbelt" | "wslc";
  containerId?: string;
  process: { commandLine: string; cwd: string; env: string[] };
  filesystem: { readwritePaths?: string[]; readonlyPaths?: string[]; deniedPaths?: string[] };
  network: { egress: { default: "allow" | "deny" }; ingress?: { default: "allow" | "deny"; hostLoopback?: "allow" | "deny" } };
  runtimeConfig?: { networkProxy: string };
  ui?: { disable: boolean; clipboard?: "none" | "read" | "write" | "readwrite"; injection?: boolean };
  processContainer?: { filesystem?: { enumeratePaths: string[] }; captureDenials?: { mode: "block"; outputPath: string } };
  seatbelt?: { extraMachLookups: string[] };
  wslc?: { image: string; storagePath?: string };
}

/** The SDK's `ContainerRequest`, as much of it as pi-outpost uses. */
export interface SdkRequest {
  command: string;
  workingDirectory: string;
  environment: Record<string, string>;
  inheritDefaultEnvironment: false;
  filesystem: { readwritePaths?: string[]; readonlyPaths?: string[]; deniedPaths?: string[] };
  network: { egress: { default: "allow" | "deny" }; ingress?: { default: "allow" | "deny"; hostLoopback?: "allow" | "deny" }; runtimeConfig?: { networkProxy: string } };
  ui?: { disable: boolean; clipboard?: "none" | "read" | "write" | "readwrite"; allowInputInjection?: boolean };
  timeoutMs?: number;
  containerName?: string;
  containment:
    | { type: "processcontainer"; config?: { filesystem?: { enumeratePaths: string[] }; captureDenials?: { mode: "block"; outputPath: string } } }
    | { type: "bubblewrap" }
    | { type: "seatbelt"; config: { extraMachLookups: string[] } }
    | { type: "wslc"; config: { image: string; storagePath?: string } };
}

export interface SdkProcess {
  readonly id: number;
  readonly standardOutput: Readable | null;
  readonly standardError: Readable | null;
  readonly outputMetadata: SdkMetadata | undefined;
  wait(): Promise<{ exitCode: number; timedOut: boolean }>;
  kill(): void;
}
export type SdkMetadata = { captureDenials?: { outputPath: string }; captureDenialsError?: { message: string } };

/** The SDK's `MxcPtyProcess`: one merged output stream, an input stream, and its size. */
export interface SdkPtyProcess {
  readonly id: number;
  readonly input: NodeJS.WritableStream;
  readonly output: Readable;
  resize(size: { rows: number; columns: number }): void;
  wait(): Promise<{ exitCode: number; timedOut: boolean }>;
  kill(): void;
}

/**
 * Microsoft's telemetry, asked for off on every call. MXC's optional telemetry needs a request's
 * opt-in, MXC's stored consent and an allowing policy: pi-outpost never opts in and never asks
 * for consent. MXC's four Required events (ExecutionStart, ExecutionEnd, Error, ProcessExited:
 * random identifiers, backend, outcome, exit code, duration, no free text) are emitted on
 * eligible Windows builds whatever is asked — no setting, registry key or policy of MXC's turns
 * them off (MXC's docs/telemetry.md). Said in docs/sandboxing.md, not hidden.
 */
export const NO_TELEMETRY = { telemetry: { enabled: false } } as const;

/** The entry points pi-outpost uses, as `@microsoft/mxc-sdk/v1` exports them. */
export interface MxcSdk {
  spawn(request: SdkRequest, options: typeof NO_TELEMETRY): Promise<SdkProcess>;
  spawnWithPty(request: SdkRequest, options: typeof NO_TELEMETRY & { size?: { rows: number; columns: number } }): Promise<SdkPtyProcess>;
  probe(): Promise<unknown> | unknown;
  /**
   * A request document sent as written (`@microsoft/mxc-sdk/v1/dev`): the only way to MXC's
   * development contract, which alone carries Seatbelt's report of what it refused
   * (`mxcMacCaptureRequest`). `experimental` is the authorisation that contract asks for.
   */
  spawnJson(json: string, options: { experimental: boolean }): Promise<SdkProcess>;
}

/**
 * The SDK, or why it cannot load here.
 * In the standalone executable `MXC_FFI_DIR` is pointed at
 * the executable's directory first, where `build-exe` put the native library.
 */
export async function loadMxcSdk(): Promise<{ sdk: MxcSdk } | { reason: string }> {
  if (isStandalone()) process.env.MXC_FFI_DIR ??= path.dirname(process.execPath);
  try {
    // A literal, so the standalone executable's bundle carries the SDK's JavaScript; the npm
    // package keeps it external (cli/scripts/build.mjs), beside its native library.
    const [stable, dev] = await Promise.all([import("@microsoft/mxc-sdk/v1"), import("@microsoft/mxc-sdk/v1/dev")]);
    return { sdk: { ...(stable as unknown as Omit<MxcSdk, "spawnJson">), spawnJson: (dev as unknown as Pick<MxcSdk, "spawnJson">).spawnJson } };
  } catch (error) {
    return { reason: `MXC's SDK cannot load here: ${(error as Error).message.split("\n")[0]}` };
  }
}

function isStandalone(): boolean {
  try {
    return (process as unknown as { getBuiltinModule?: (id: string) => { isSea?: () => boolean } | undefined }).getBuiltinModule?.("node:sea")?.isSea?.() ?? false;
  } catch {
    return false;
  }
}

let loaded: Promise<{ sdk: MxcSdk } | { reason: string }> | undefined;
/** The SDK, loaded once for the life of the server. */
export function mxcSdk(): Promise<{ sdk: MxcSdk } | { reason: string }> {
  return (loaded ??= loadMxcSdk());
}

/** One of pi-outpost's request documents in the SDK's model. Pure: every field comes from `wire`. */
export function sdkRequest(wire: MxcWireRequest, timeoutMs?: number): SdkRequest {
  const environment: Record<string, string> = {};
  for (const entry of wire.process.env) {
    const at = entry.indexOf("=", 1);
    if (at > 0) environment[entry.slice(0, at)] = entry.slice(at + 1);
  }
  const containment: SdkRequest["containment"] =
    wire.containment === "processcontainer"
      ? {
          type: "processcontainer",
          ...(wire.processContainer
            ? {
                config: {
                  ...(wire.processContainer.filesystem ? { filesystem: { enumeratePaths: [...wire.processContainer.filesystem.enumeratePaths] } } : {}),
                  ...(wire.processContainer.captureDenials ? { captureDenials: { ...wire.processContainer.captureDenials } } : {}),
                },
              }
            : {}),
        }
      : wire.containment === "seatbelt"
        ? { type: "seatbelt", config: { extraMachLookups: [...(wire.seatbelt?.extraMachLookups ?? [])] } }
        : wire.containment === "wslc"
          ? { type: "wslc", config: { image: wire.wslc!.image, ...(wire.wslc!.storagePath ? { storagePath: wire.wslc!.storagePath } : {}) } }
          : { type: "bubblewrap" };
  return {
    command: wire.process.commandLine,
    workingDirectory: wire.process.cwd,
    environment,
    inheritDefaultEnvironment: false,
    filesystem: {
      ...(wire.filesystem.readwritePaths ? { readwritePaths: [...wire.filesystem.readwritePaths] } : {}),
      ...(wire.filesystem.readonlyPaths ? { readonlyPaths: [...wire.filesystem.readonlyPaths] } : {}),
      ...(wire.filesystem.deniedPaths ? { deniedPaths: [...wire.filesystem.deniedPaths] } : {}),
    },
    network: {
      egress: { ...wire.network.egress },
      ...(wire.network.ingress ? { ingress: { ...wire.network.ingress } } : {}),
      ...(wire.runtimeConfig ? { runtimeConfig: { ...wire.runtimeConfig } } : {}),
    },
    ...(wire.ui ? { ui: { disable: wire.ui.disable, ...(wire.ui.clipboard ? { clipboard: wire.ui.clipboard } : {}), ...(wire.ui.injection !== undefined ? { allowInputInjection: wire.ui.injection } : {}) } } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(wire.containerId ? { containerName: wire.containerId } : {}),
    containment,
  };
}

/** The SDK did not start a request document sent as written: nothing ran, so the caller may send another. */
export class SdkDocumentRefused extends Error {}

/**
 * The SDK could not build the process security environment for a request: Windows refuses the whole
 * policy when one path in it cannot be opened or resolved where the environment is built — measured
 * HRESULTs: 0x80070005 (a path this account cannot open, seen on a domain-joined machine),
 * 0x80070020 (a file another process holds open), 0x8007010B (a junction or symlink), 0x80070003 (a
 * parent that does not exist). Nothing ran, so the caller may send a narrower policy and try again.
 */
export function isSecurityEnvironmentRefusal(error: unknown): boolean {
  return error instanceof Error && /security ?environment/i.test(error.message) && /0x[0-9a-f]{8}/i.test(error.message);
}

/**
 * Runs one request through the SDK as the executor ran it (`confinedBash.ts`'s `run`) — in the
 * SDK's model, or a request document sent as written (`json`, the development contract): stdout and
 * stderr as they come, ended by the signal or the timeout — which then throw `aborted` or
 * `timeout:<seconds>`, as pi's shell expects — and the result's metadata (a diagnosis' report).
 */
export async function runThroughSdk(
  sdk: MxcSdk,
  request: SdkRequest | { json: string },
  options: { onData: (data: Buffer) => void; stderr?: (data: Buffer) => void; signal?: AbortSignal; timeoutMs?: number; timeout?: number },
): Promise<{ exitCode: number | null; metadata: SdkMetadata | undefined }> {
  if (options.signal?.aborted) throw new Error("aborted");
  const proc =
    "json" in request
      ? await sdk.spawnJson(request.json, { experimental: true }).catch((error: Error) => {
          throw new SdkDocumentRefused(error.message);
        })
      : await sdk.spawn(request, NO_TELEMETRY);
  let timedOut = false;
  const end = () => proc.kill();
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    end();
  }, options.timeoutMs);
  const toBuffer = (data: Buffer | string) => (typeof data === "string" ? Buffer.from(data) : data);
  const streamsDone = [proc.standardOutput, proc.standardError].map(
    (stream, index) =>
      new Promise<void>((resolve) => {
        if (!stream) return resolve();
        stream.on("data", (data: Buffer | string) => (index === 1 && options.stderr ? options.stderr : options.onData)(toBuffer(data)));
        stream.once("end", resolve);
        stream.once("close", resolve);
        stream.once("error", () => resolve());
      }),
  );
  if (options.signal?.aborted) end();
  else options.signal?.addEventListener("abort", end, { once: true });
  try {
    const { exitCode } = await proc.wait();
    // What was written before the exit, read to its end.
    await Promise.race([Promise.all(streamsDone), new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (options.signal?.aborted) throw new Error("aborted");
    if (timedOut) throw new Error(`timeout:${options.timeout}`);
    return { exitCode, metadata: proc.outputMetadata };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", end);
  }
}

/** As much of node-pty's `IPty` as the terminal uses, so a confined terminal is driven the same way. */
export interface PtyLike {
  readonly pid: number;
  readonly process: string;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

/**
 * A terminal confined by MXC, through the SDK's pseudo-terminal: node-pty's shape over
 * `spawnWithPty`. The terminal's input goes to it as typed, its output comes back as text, and
 * its exit is told once.
 */
export async function mxcPty(sdk: MxcSdk, request: SdkRequest, cols: number, rows: number, shell: string): Promise<PtyLike> {
  const proc = await sdk.spawnWithPty(request, { ...NO_TELEMETRY, size: { rows, columns: cols } });
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number }) => void>();
  // Taken before `wait()`: the SDK ends an input nobody took when its wait begins, and the shell
  // reads that as the end of its input — it exits at once, a `^D` in its output.
  const input = proc.input;
  proc.output.setEncoding("utf8");
  proc.output.on("data", (data: string) => {
    for (const listener of dataListeners) listener(data);
  });
  let exited: { exitCode: number } | undefined;
  void proc.wait().then(
    ({ exitCode }) => {
      exited = { exitCode };
      for (const listener of exitListeners) listener(exited);
    },
    () => {
      exited = { exitCode: 1 };
      for (const listener of exitListeners) listener(exited);
    },
  );
  return {
    pid: proc.id,
    process: path.basename(shell),
    onData(listener) {
      dataListeners.add(listener);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      if (exited) queueMicrotask(() => listener(exited!));
      return { dispose: () => exitListeners.delete(listener) };
    },
    write(data) {
      if (!exited) input.write(data);
    },
    resize(columns, rowCount) {
      if (!exited) proc.resize({ rows: rowCount, columns });
    },
    kill() {
      if (!exited) proc.kill();
    },
  };
}
