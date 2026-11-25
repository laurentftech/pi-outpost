/**
 * The agent's shell under MXC on Windows when Windows refuses the policy over the folders made
 * listable: `CreateProcessSecurityEnvironment` fails — HRESULT 0x80070005, as measured on a
 * domain-joined machine, where the enumeration layer names entries the machine cannot open — and
 * rejects the whole request, so every command is refused. The command is then replayed at a lower
 * enumeration level — first without the ancestors of the grants (the profile's folders), then
 * without any listable folder, the policy sent before the layer — confined the same, never
 * unconfined, and the host is remembered at the level that ran.
 *
 * The SDK is faked: no host here runs MXC in process. What the real `mxc_ffi` confines is the real
 * suites' job (`confinedBashMxc.test.ts`).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { PassThrough } from "node:stream";
import { confinedBashOperations } from "../src/confinedBash.ts";
import type { MxcSdk, SdkRequest } from "../src/mxcSdk.ts";
import { mxcEnumerateLevel, mxcTerminalConfig, noteMxcEnumerateLevel } from "../src/terminalSandbox.ts";

const REFUSAL =
  "MXC launcher: failed to create the process security environment: CreateProcessSecurityEnvironment failed (HRESULT = 0x80070005)";

// A project on L:, its tools on the same drive, but the shell and a grant on C:: the folders above
// them are on another drive than the root's, so the policy makes them listable (`enumeratePaths`) —
// the layer that broke on the user's machine. (A tool on another drive than the root's is no longer
// listable but readable since #572's fix: see `AToolOnAnotherDriveThanTheRootsResolves` in
// `terminalSandbox.test.ts`.) The grant's ancestors are dropped at level 1.
const ROOT = "L:\\Python\\isai_oper";
const SHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const TOOL_PATH = "L:\\Tools\\bin";
const GRANT = "C:\\grants\\tool-home";

/** An SDK that refuses the security environment `refuseTimes` times, records every request, then runs. */
function refusingSdk(refuseTimes = 1) {
  const requests: SdkRequest[] = [];
  let refusalsLeft = refuseTimes;
  const sdk: MxcSdk = {
    async spawn(request: SdkRequest) {
      requests.push(request);
      if (refusalsLeft > 0) {
        refusalsLeft -= 1;
        throw new Error(REFUSAL);
      }
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      setImmediate(() => {
        stdout.end("ran\n");
        stderr.end();
      });
      return {
        id: 1,
        standardOutput: stdout,
        standardError: stderr,
        outputMetadata: undefined,
        wait: async () => ({ exitCode: 0, timedOut: false }),
        kill: () => {},
      };
    },
    spawnWithPty: async () => assert.fail("no pty here"),
    probe: () => ({}),
    spawnJson: async () => assert.fail("no document here"),
  };
  return { sdk, requests };
}

describe("the shell's MXC request when Windows refuses the security environment", () => {
  const savedPath = process.env.PATH;
  before(() => {
    process.env.PATH = TOOL_PATH;
  });
  after(() => {
    process.env.PATH = savedPath;
  });
  // The remembered level is process-wide: each test starts from a host that takes full enumeration.
  beforeEach(() => {
    noteMxcEnumerateLevel(0);
  });

  function operations(sdk: MxcSdk) {
    return confinedBashOperations({
      runner: "C:\\mxc\\wxc-exec.exe",
      platform: "win32",
      shell: SHELL,
      root: ROOT,
      allowWrite: true,
      agentDir: "C:\\Users\\me\\.pi\\agent",
      configFile: "C:\\Users\\me\\pi-outpost.json",
      check: async () => ({ ok: true as const }),
      mxcSdk: async () => ({ sdk }),
      grants: () => ({ hosts: [], directories: [{ path: GRANT, access: "read" as const }] }),
    });
  }

  async function exec(sdk: MxcSdk) {
    let output = "";
    const { exitCode } = await operations(sdk).exec("Write-Output hi", ROOT, { onData: (data) => (output += data.toString()) });
    return { output, exitCode };
  }

  const enumerated = (request: SdkRequest) =>
    request.containment.type === "processcontainer" ? (request.containment.config?.filesystem?.enumeratePaths ?? []) : [];

  test("a refusal steps the enumeration down one level at a time: grants first, then all of it, and runs", async () => {
    const { sdk, requests } = refusingSdk(2);
    const { output, exitCode } = await exec(sdk);
    assert.equal(exitCode, 0);
    assert.equal(output, "ran\n");
    assert.equal(requests.length, 3, "level 0, then level 1, then level 2");
    assert.ok(enumerated(requests[0]!).includes("C:\\grants"), "level 0 enumerates the grant's ancestors");
    assert.ok(enumerated(requests[0]!).some((p) => p.startsWith("C:\\Windows")), "level 0 enumerates the shell's ancestors");
    assert.ok(!enumerated(requests[1]!).includes("C:\\grants"), "level 1 drops the grant ancestors");
    assert.ok(enumerated(requests[1]!).some((p) => p.startsWith("C:\\Windows")), "level 1 keeps the shell's ancestors");
    assert.deepEqual(enumerated(requests[2]!), [], "level 2 asks for no enumeration");
    // The sibling denies — the confinement — are still there, and the writable zone too.
    assert.ok((requests[2]!.filesystem.deniedPaths ?? []).length > 0, "the agent directory and the configuration stay denied");
    assert.deepEqual(requests[2]!.filesystem.readwritePaths, requests[0]!.filesystem.readwritePaths);
    // The host is remembered at level 2: a policy built afterwards asks for no enumeration.
    assert.equal(mxcEnumerateLevel(), 2);
    const later = mxcTerminalConfig({
      root: ROOT,
      allowWrite: true,
      tmp: "C:\\Users\\me\\AppData\\Local\\Temp\\pi-outpost-bash-1",
      shell: SHELL,
      shellArgs: [],
      cwd: ROOT,
      env: {},
      siblings: [],
      searchPath: TOOL_PATH,
      grantedRead: [GRANT],
    });
    assert.equal(later.processContainer?.filesystem, undefined);
  });

  test("when only the grant ancestors fail, level 1 runs and the host stays there", async () => {
    const { sdk, requests } = refusingSdk(1);
    const { exitCode } = await exec(sdk);
    assert.equal(exitCode, 0);
    assert.equal(requests.length, 2, "level 0 refused, level 1 ran");
    assert.ok(enumerated(requests[1]!).length > 0, "level 1 still enumerates the shell's ancestors");
    assert.ok(!enumerated(requests[1]!).includes("C:\\grants"), "level 1 dropped the grant ancestors");
    assert.equal(mxcEnumerateLevel(), 1);
    const later = mxcTerminalConfig({
      root: ROOT,
      allowWrite: true,
      tmp: "C:\\Users\\me\\AppData\\Local\\Temp\\pi-outpost-bash-1",
      shell: SHELL,
      shellArgs: [],
      cwd: ROOT,
      env: {},
      siblings: [],
      searchPath: TOOL_PATH,
      grantedRead: [GRANT],
    });
    const paths = later.processContainer?.filesystem?.enumeratePaths ?? [];
    assert.ok(paths.some((p) => p.startsWith("C:\\Windows")), "a later policy keeps the shell's enumeration");
    assert.ok(!paths.includes("C:\\grants"), "and not the grant ancestors");
  });

  test("a refusal with nothing enumerated is not replayed: the error is the command's", async () => {
    // The shell and the root share C:, the tools are on L: (readable since #572): nothing is made listable, so the refusal is not the layer's.
    const { sdk, requests } = refusingSdk();
    const ops = confinedBashOperations({
      runner: "C:\\mxc\\wxc-exec.exe",
      platform: "win32",
      shell: SHELL,
      root: "C:\\work\\app",
      allowWrite: true,
      agentDir: "C:\\Users\\me\\.pi\\agent",
      check: async () => ({ ok: true as const }),
      mxcSdk: async () => ({ sdk }),
    });
    await assert.rejects(ops.exec("Write-Output hi", "C:\\work\\app", { onData: () => {} }), /0x80070005/);
    assert.equal(requests.length, 1);
    assert.deepEqual(enumerated(requests[0]!), []);
  });

  test("a failure that is not the security environment is not replayed either", async () => {
    const requests: SdkRequest[] = [];
    const sdk: MxcSdk = {
      async spawn(request: SdkRequest) {
        requests.push(request);
        throw new Error("backend_unavailable");
      },
      spawnWithPty: async () => assert.fail("no pty here"),
      probe: () => ({}),
      spawnJson: async () => assert.fail("no document here"),
    };
    await assert.rejects(exec(sdk), /backend_unavailable/);
    assert.equal(requests.length, 1);
  });
});
