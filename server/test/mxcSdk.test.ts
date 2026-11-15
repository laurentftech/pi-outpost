/**
 * MXC through its SDK (`mxcSdk.ts`): pi-outpost's request documents in the SDK's model, proved
 * faithful by the SDK's own `prepareContainerRequest`, which turns them back into the document the
 * executor used to read; and the run, ended as the executor's was. What MXC then confines is the
 * real suites' (`…Mxc.test.ts`).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import { NO_TELEMETRY, runThroughSdk, sdkRequest, type MxcWireRequest } from "../src/mxcSdk.ts";
import { mxcWslcConfig } from "../src/confinedBash.ts";
import { mxcDiagnosticConfig, mxcPosixConfig, mxcTerminalConfig } from "../src/terminalSandbox.ts";

/** The SDK's own request builder: not exported by its package, read from its file. */
async function prepareContainerRequest(): Promise<(request: unknown) => Record<string, unknown>> {
  const manifest = createRequire(import.meta.url).resolve("@microsoft/mxc-sdk/package.json");
  const container = await import(pathToFileURL(path.join(path.dirname(manifest), "dist", "v1", "container.js")).href);
  return container.prepareContainerRequest;
}

type Doc = Record<string, unknown>;
const pick = (from: Doc, keys: string[]) => Object.fromEntries(keys.filter((key) => key in from).map((key) => [key, from[key]]));

/** What of the SDK's document the wire one speaks of: the SDK adds its own defaults beside them. */
function said(wire: MxcWireRequest, built: Doc) {
  return {
    containment: built.containment,
    process: pick(built.process as Doc, ["commandLine", "cwd", "env"]),
    filesystem: built.filesystem,
    network: built.network,
    ...(wire.runtimeConfig ? { runtimeConfig: built.runtimeConfig } : {}),
    ...(wire.ui ? { ui: built.ui } : {}),
    ...(wire.containerId ? { containerId: built.containerId } : {}),
    ...(wire.processContainer ? { captureDenials: (built.processContainer as Doc).captureDenials } : {}),
    ...(wire.seatbelt ? { extraMachLookups: (built.seatbelt as Doc).extraMachLookups } : {}),
    ...(wire.wslc ? { wslc: pick(built.wslc as Doc, ["image", "storagePath"]) } : {}),
  };
}

function expected(wire: MxcWireRequest) {
  return {
    containment: wire.containment,
    process: wire.process,
    filesystem: { readwritePaths: [], readonlyPaths: [], deniedPaths: [], ...wire.filesystem },
    network: wire.network,
    ...(wire.runtimeConfig ? { runtimeConfig: wire.runtimeConfig } : {}),
    ...(wire.ui ? { ui: wire.ui } : {}),
    ...(wire.containerId ? { containerId: wire.containerId } : {}),
    ...(wire.processContainer ? { captureDenials: wire.processContainer.captureDenials } : {}),
    ...(wire.seatbelt ? { extraMachLookups: wire.seatbelt.extraMachLookups } : {}),
    ...(wire.wslc ? { wslc: wire.wslc } : {}),
  };
}

const windowsInput = {
  root: "C:\\work\\app",
  allowWrite: true,
  writableRoot: "C:\\work\\app\\out",
  agentDir: "C:\\Users\\me\\.pi\\agent",
  configFile: "C:\\work\\app\\pi-outpost.json",
  tmp: "C:\\Users\\me\\AppData\\Local\\Temp\\pi-outpost-bash-1",
  shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  shellArgs: ["-File", "x.ps1"],
  cwd: "C:\\work\\app",
  env: { PATH: "C:\\Windows\\System32", EQ: "a=b" },
  siblings: ["C:\\work\\other"],
};
const posixInput = {
  root: "/work/app",
  allowWrite: true,
  writableRoot: "/work/app/out",
  agentDir: "/home/me/.pi/agent",
  tmp: "/tmp/pi-outpost-bash-1",
  shell: "/bin/bash",
  shellArgs: ["/tmp/x.sh"],
  cwd: "/work/app",
  env: { PATH: "/usr/bin:/bin" },
};
const windowsWire = () => mxcTerminalConfig(windowsInput) as MxcWireRequest;

describe("sdkRequest", () => {
  const cases: Array<[string, () => MxcWireRequest]> = [
    ["Windows, the network open", windowsWire],
    ["Windows, under sandbox.allowedHosts' proxy", () => mxcTerminalConfig({ ...windowsInput, networkProxy: "http://127.0.0.1:4100" }) as MxcWireRequest],
    [
      "Windows, a diagnosis",
      () => mxcDiagnosticConfig(mxcTerminalConfig(windowsInput), { root: windowsInput.root, agentDir: windowsInput.agentDir, configFile: windowsInput.configFile, reportPath: "C:\\srv\\d\\report.json" }) as MxcWireRequest,
    ],
    ["Linux, Bubblewrap", () => mxcPosixConfig("/opt/mxc/lxc-exec", posixInput) as MxcWireRequest],
    ["Linux, under a proxy", () => mxcPosixConfig("/opt/mxc/lxc-exec", { ...posixInput, networkProxy: "http://127.0.0.1:4100" }) as MxcWireRequest],
    ["macOS, Seatbelt", () => mxcPosixConfig("/opt/mxc/mxc-exec-mac", { ...posixInput, developerDir: null, realPath: (p: string) => p }) as MxcWireRequest],
    ["WSLC", () => mxcWslcConfig({ image: "ubuntu:24.04", root: "C:\\work\\app", allowWrite: true, tmp: "C:\\t\\b", script: "C:\\t\\b\\command.sh", cwd: "C:\\work\\app" }) as MxcWireRequest],
  ];
  for (const [name, build] of cases) {
    test(`${name}: the SDK's own builder turns it back into the same document`, async () => {
      const wire = build();
      const built = (await prepareContainerRequest())(sdkRequest(wire));
      assert.deepEqual(said(wire, built), expected(wire));
    });
  }

  test("the server's environment never reaches the command: only the document's", () => {
    const request = sdkRequest(windowsWire());
    assert.equal(request.inheritDefaultEnvironment, false);
    assert.equal(request.environment.EQ, "a=b", "split on the first '=' only");
  });
});

function fakeSdk(behaviour: { exitCode?: number; out?: string[]; err?: string[]; hang?: boolean } = {}) {
  const calls: unknown[] = [];
  let killed = false;
  const sdk = {
    async spawn(_request: unknown, options: unknown) {
      calls.push(options);
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let finish!: () => void;
      const done = new Promise<void>((resolve) => (finish = resolve));
      setImmediate(() => {
        for (const chunk of behaviour.out ?? []) stdout.write(chunk);
        for (const chunk of behaviour.err ?? []) stderr.write(chunk);
        if (!behaviour.hang) finish();
      });
      return {
        id: 1,
        standardOutput: stdout,
        standardError: stderr,
        outputMetadata: { captureDenials: { outputPath: "C:\\r.1_ab.json" } },
        async wait() {
          await done;
          stdout.end();
          stderr.end();
          return { exitCode: behaviour.exitCode ?? 0, timedOut: false };
        },
        kill() {
          killed = true;
          finish();
        },
      };
    },
    spawnWithPty: async () => assert.fail("no pty here"),
    probe: () => ({}),
  };
  return { sdk: sdk as never, calls, killed: () => killed };
}

describe("runThroughSdk", () => {
  test("both streams come back, the exit code and the metadata, and Microsoft's optional telemetry is asked off", async () => {
    const fake = fakeSdk({ exitCode: 3, out: ["to-out "], err: ["to-err"] });
    let output = "";
    const result = await runThroughSdk(fake.sdk, sdkRequest(windowsWire()), { onData: (data) => (output += data.toString()) });
    assert.equal(result.exitCode, 3);
    assert.match(output, /to-out/);
    assert.match(output, /to-err/);
    assert.equal(result.metadata?.captureDenials?.outputPath, "C:\\r.1_ab.json");
    assert.deepEqual(fake.calls, [NO_TELEMETRY]);
  });

  test("stderr goes where it is told, apart from stdout", async () => {
    const fake = fakeSdk({ out: ["o"], err: ["e"] });
    let out = "";
    let err = "";
    await runThroughSdk(fake.sdk, sdkRequest(windowsWire()), { onData: (d) => (out += d), stderr: (d) => (err += d) });
    assert.deepEqual([out, err], ["o", "e"]);
  });

  test("ended by the signal: killed, and 'aborted'", async () => {
    const fake = fakeSdk({ hang: true });
    const controller = new AbortController();
    const running = runThroughSdk(fake.sdk, sdkRequest(windowsWire()), { onData: () => {}, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await assert.rejects(running, /^Error: aborted$/);
    assert.equal(fake.killed(), true);
  });

  test("ended by the timeout: killed, and 'timeout:<seconds>' as pi's shell reads it", async () => {
    const fake = fakeSdk({ hang: true });
    await assert.rejects(runThroughSdk(fake.sdk, sdkRequest(windowsWire()), { onData: () => {}, timeoutMs: 30, timeout: 0.03 }), /^Error: timeout:0\.03$/);
    assert.equal(fake.killed(), true);
  });

  test("an already aborted signal runs nothing", async () => {
    const fake = fakeSdk();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runThroughSdk(fake.sdk, sdkRequest(windowsWire()), { onData: () => {}, signal: controller.signal }), /aborted/);
    assert.deepEqual(fake.calls, []);
  });
});
