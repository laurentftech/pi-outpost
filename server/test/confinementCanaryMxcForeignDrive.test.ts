/**
 * The confinement canary under MXC's real process container on Windows, with the sandbox root on
 * one drive and the system's temporary directory on another (issue #582): the policy makes the
 * foreign drive's way down readable (#572), but what lies beside it — the profile's
 * `AppData\Local`, the temporary directory included — must be denied by name, so the canary's
 * beside-root bait is refused, not reached, and the verdict is `verified`, not `leaking`.
 *
 * Only where `MXC_EXEC` names the executor and its probe reports tier 1: CI's `mxc-windows` job
 * (windows-11-arm) sets it, and so does a maintainer's Windows 11 machine (docs/development.md).
 * Skipped elsewhere. Where the checkout and the system temp are already on different drives the
 * runner's layout is used; otherwise a second drive is made with `subst` (the way #572 was
 * reproduced on a single-disk machine).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { runCanary } from "../src/confinementCanary.ts";

const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const RUNNER = process.env.MXC_EXEC;
const skip = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC is not set (the path of wxc-exec.exe)" : false;

/** A drive letter that does not exist yet, for `subst`. */
function freeDriveLetter(): string {
  for (const letter of "ZYXWVUTSRQPONMLKJIHGFEDCBA") {
    if (!existsSync(`${letter}:\\`)) return `${letter}:`;
  }
  throw new Error("no free drive letter");
}

describe("the canary under real MXC, root and system temp on different drives (issue #582)", { skip }, () => {
  let root: string;
  let agentDir: string;
  let substLetter: string | undefined;
  let substTarget: string | undefined;

  before(async () => {
    let rootDrive = path.parse(process.cwd()).root;
    const tmpDrive = path.parse(tmpdir()).root;
    if (rootDrive.toLowerCase() === tmpDrive.toLowerCase()) {
      // The runner checks out on the same drive as the system temp (windows-11-arm: `C:\a\…`):
      // make a second drive, as the #572 reproduction did with `subst D:`.
      substLetter = freeDriveLetter();
      substTarget = await mkdtemp(path.join(rootDrive, "pi-outpost-subst-"));
      execFileSync("subst", [`${substLetter}\\`, substTarget], { stdio: "pipe" });
      rootDrive = `${substLetter}\\`;
    }
    root = await mkdtemp(path.join(rootDrive, "pi-outpost-canary-root-"));
    agentDir = await mkdtemp(path.join(rootDrive, "pi-outpost-canary-agent-"));
  });

  after(async () => {
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
    if (agentDir) await rm(agentDir, { recursive: true, force: true }).catch(() => {});
    if (substLetter) {
      try {
        execFileSync("subst", [`${substLetter}\\`, "/d"], { stdio: "pipe" });
      } catch {}
      if (substTarget) await rm(substTarget, { recursive: true, force: true }).catch(() => {});
    }
  });

  // openlore: scenario=BesideTheForeignWayDownStaysDenied spec=sandbox-runner-bash
  test("beside-root and write-beside-root are refused when the temporary directory is on another drive than the root", async () => {
    assert.notEqual(path.parse(root).root.toLowerCase(), path.parse(tmpdir()).root.toLowerCase(), "the test needs the root and the system temp on different drives");
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
