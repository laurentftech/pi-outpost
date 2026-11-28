/**
 * The agent's shell under MXC on Windows when Windows refuses the policy over the folders made
 * listable: `CreateProcessSecurityEnvironment` fails — HRESULT 0x80070005, as measured on a
 * domain-joined machine, where the enumeration layer names entries the machine cannot open — and
 * rejects the whole request, so every command is refused. The command is then replayed once without
 * the way down to the grants (the profile's folders); refused again, it is the command's error with the
 * reason — the whitelist has no looser shape — and the host is remembered at the level that ran.
 *
 * The SDK is faked: no host here runs MXC in process. What the real `mxc_ffi` confines is the real
 * suites' job (`confinedBashMxc.test.ts`).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { PassThrough } from "node:stream";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { buildTerminalConfinement, terminalVerdict } from "../src/confinementStatus.ts";
import { confinedLaunch } from "../src/terminalManager.ts";
import type { MxcSdk, SdkRequest } from "../src/mxcSdk.ts";
import { mxcEnumerateLevel, mxcTerminalConfig, noteMxcEnumerateLevel } from "../src/terminalSandbox.ts";

const REFUSAL =
  "MXC launcher: failed to create the process security environment: CreateProcessSecurityEnvironment failed (HRESULT = 0x80070005)";

// A project on L:, its tools on the same drive, but the shell and a grant on C:: the folders above
// them are listable (`enumeratePaths`) — the layer that broke on the user's machine. The grant's
// ancestors are dropped at level 1.
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

  // openlore: scenario=AHostWithoutEnumerationHasNoMxcShell spec=sandbox-runner-bash
  test("AHostWithoutEnumerationHasNoMxcShell: refused at level 0 then at level 1, the command is refused with the reason — no policy without enumeration, no pruned deny list", async () => {
    const { sdk, requests } = refusingSdk(2);
    await assert.rejects(exec(sdk), (error: Error) => /0x80070005/.test(error.message) && /bashRunner/.test(error.message));
    assert.equal(requests.length, 2, "level 0, then level 1, and no further");
    assert.ok(enumerated(requests[0]!).includes("C:\\grants"), "level 0 enumerates the grant's way down");
    assert.ok(!enumerated(requests[1]!).includes("C:\\grants"), "level 1 drops it");
    for (const request of requests) {
      assert.ok(enumerated(request).includes("C:\\") && enumerated(request).includes("L:\\"), "every request lists the drive roots");
      assert.deepEqual([...(request.filesystem.deniedPaths ?? [])].sort(), ["C:\\Users\\me\\.pi\\agent", "C:\\Users\\me\\pi-outpost.json"], "the same two denies, never pruned");
      assert.ok(!(request.filesystem.readonlyPaths ?? []).some((p) => /^[a-z]:\\?$/i.test(p)), "no drive readable");
    }
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
      searchPath: TOOL_PATH,
      grantedRead: [GRANT],
    });
    const paths = later.processContainer?.filesystem?.enumeratePaths ?? [];
    assert.ok(paths.some((p) => p.startsWith("C:\\Windows")), "a later policy keeps the shell's enumeration");
    assert.ok(!paths.includes("C:\\grants"), "and not the grant ancestors");
  });

  // openlore: scenario=AHostWithoutEnumerationHasNoMxcShell spec=sandbox-runner-bash
  test("a host known to take no enumeration runs nothing: the command is refused with the reason before any request", async () => {
    noteMxcEnumerateLevel(2);
    const { sdk, requests } = refusingSdk(0);
    await assert.rejects(exec(sdk), /cannot list folders.*bashRunner/);
    assert.equal(requests.length, 0, "nothing sent, nothing ran");
  });

  // openlore: scenario=AHostKnownWithoutEnumerationSendsNothing spec=sandbox-runner-bash
  test("AHostKnownWithoutEnumerationSendsNothing: the canary and the confined terminal report no shell, without launching", { skip: process.platform !== "win32" && "the confined launch checks the platform it runs on" }, async () => {
    noteMxcEnumerateLevel(2);
    const confine = buildTerminalConfinement({ runner: "C:\\mxc\\wxc-exec.exe", root: ROOT, allowWrite: true, agentDir: "C:\\Users\\me\\.pi\\agent" });
    const verdict = await terminalVerdict(confine, SHELL, "C:\\Users\\me\\.pi\\agent");
    assert.notEqual(verdict.state, "verified");
    assert.match("reason" in verdict ? (verdict.reason ?? "") : "", /cannot list folders.*bashRunner/);
    await assert.rejects(confinedLaunch(confine, SHELL, [], ROOT), /cannot list folders.*bashRunner/);
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
