/**
 * The confinement canary under MXC's real process container on Windows, with the sandbox root on
 * one drive and the system's temporary directory on another (issue #582): the policy makes the
 * foreign drive's way down readable (#572), but what lies beside it — the profile's
 * `AppData\Local`, the temporary directory included — must be denied by name, so the canary's
 * beside-root bait is refused, not reached, and the verdict is `verified`, not `leaking`.
 *
 * Only where `MXC_EXEC` names the executor and its probe reports tier 1: CI's `mxc-windows` job
 * (windows-11-arm) sets it, and so does a maintainer's Windows 11 machine (docs/development.md).
 * Skipped elsewhere, and where the root's drive and the system temp are the same drive — the
 * interesting shape needs two.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { runCanary } from "../src/confinementCanary.ts";

const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const RUNNER = process.env.MXC_EXEC;
const rootDrive = path.parse(process.cwd()).root;
const tmpDrive = path.parse(tmpdir()).root;
const skip =
  process.platform !== "win32"
    ? "MXC confines on Windows only"
    : !RUNNER
      ? "MXC_EXEC is not set (the path of wxc-exec.exe)"
      : rootDrive.toLowerCase() === tmpDrive.toLowerCase()
        ? "the root's drive and the system temp are the same drive here"
        : false;

describe("the canary under real MXC, root and system temp on different drives (issue #582)", { skip }, () => {
  let root: string;
  let agentDir: string;

  before(async () => {
    root = await mkdtemp(path.join(rootDrive, "pi-outpost-canary-root-"));
    agentDir = await mkdtemp(path.join(rootDrive, "pi-outpost-canary-agent-"));
  });

  after(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (agentDir) await rm(agentDir, { recursive: true, force: true });
  });

  // openlore: scenario=BesideTheForeignWayDownStaysDenied spec=sandbox-runner-bash
  test("beside-root and write-beside-root are refused when the temporary directory is on another drive than the root", async () => {
    const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir });
    const verdict = await runCanary({
      runner: "mxc",
      agentDir,
      root,
      powerShell: true,
      proxied: false,
      exec: async (command) => {
        let output = "";
        await ops.exec(command, root, { onData: (data) => (output += data.toString()), timeout: 60 });
        return output;
      },
    });
    assert.ok(verdict.state === "verified", `the canary must verify under real MXC, got ${JSON.stringify(verdict)}`);
    assert.ok(verdict.refused.includes("beside-root"), `beside-root must be refused, got ${JSON.stringify(verdict)}`);
    assert.ok(verdict.refused.includes("write-beside-root"), `write-beside-root must be refused, got ${JSON.stringify(verdict)}`);
  });
});
