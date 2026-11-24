/**
 * The agent's shell under MXC on Windows when Windows refuses the policy over the folders made
 * listable: `CreateProcessSecurityEnvironment` fails — HRESULT 0x80070005, as measured on a
 * domain-joined machine, where the enumeration layer names entries the machine cannot open — and
 * rejects the whole request, so every command is refused. The command is then run once more on the
 * policy without that layer — confined the same, never unconfined — and the host is remembered as
 * not taking it, so no policy built afterwards asks for it.
 *
 * The SDK is faked: no host here runs MXC in process. What the real `mxc_ffi` confines is the real
 * suites' job (`confinedBashMxc.test.ts`).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { PassThrough } from "node:stream";
import { confinedBashOperations } from "../src/confinedBash.ts";
import type { MxcSdk, SdkRequest } from "../src/mxcSdk.ts";
import { mxcTerminalConfig } from "../src/terminalSandbox.ts";

const REFUSAL =
  "MXC launcher: failed to create the process security environment: CreateProcessSecurityEnvironment failed (HRESULT = 0x80070005)";

// A project on L:, a tool on C:: the folders above the tool are on another drive than the root's,
// so the policy makes them listable (`enumeratePaths`) — the layer that broke on the user's machine.
const ROOT = "L:\\Python\\isai_oper";
const SHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const TOOL_PATH = "C:\\Tools\\bin";

/** An SDK that refuses the security environment once, records every request, then runs. */
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
    });
  }

  async function exec(sdk: MxcSdk) {
    let output = "";
    const { exitCode } = await operations(sdk).exec("Write-Output hi", ROOT, { onData: (data) => (output += data.toString()) });
    return { output, exitCode };
  }

  const enumerated = (request: SdkRequest) =>
    request.containment.type === "processcontainer" ? (request.containment.config?.filesystem?.enumeratePaths ?? []) : [];

  test("a refusal over the enumerated folders replays the command once on the policy without them, and runs", async () => {
    const { sdk, requests } = refusingSdk();
    const { output, exitCode } = await exec(sdk);
    assert.equal(exitCode, 0);
    assert.equal(output, "ran\n");
    assert.equal(requests.length, 2, "the refused request, then the narrower one");
    assert.ok(enumerated(requests[0]!).length > 0, "the first request made folders listable");
    assert.deepEqual(enumerated(requests[1]!), [], "the replay asks for no enumeration");
    // The sibling denies — the confinement — are still there, and the writable zone too.
    assert.ok((requests[1]!.filesystem.deniedPaths ?? []).length > 0, "the agent directory and the configuration stay denied");
    assert.deepEqual(requests[1]!.filesystem.readwritePaths, requests[0]!.filesystem.readwritePaths);
    // The host is remembered: a policy built afterwards on it asks for no enumeration.
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
    });
    assert.equal(later.processContainer?.filesystem, undefined);
  });

  test("a refusal with nothing enumerated is not replayed: the error is the command's", async () => {
    // The root on the tool's drive: nothing is made listable, so the refusal is not the layer's.
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
