/**
 * What a command of the agent's confined PowerShell reaches beside the root, under MXC's real
 * process container (Windows 11, tier 1): a tool installed beside the project (issue #553) and the
 * private network (issue #552).
 *
 * Only where `MXC_EXEC` names the runner: no CI runner has MXC tier 1.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations, type ConfinedBashOptions } from "../src/confinedBash.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const skip = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC is not set" : false;

describe("what a confined command reaches beside the root, under MXC", { skip }, () => {
  let base: string;
  let root: string;
  let agentDir: string;
  let toolBin: string;
  const savedPath = process.env.PATH;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "sandbox-reach-mxc-"));
    root = path.join(base, "app");
    agentDir = path.join(base, "agent");
    // A tool installed beside the project, as a global npm CLI is: a launcher on PATH running a
    // script of its own, under folders the command is otherwise refused (siblings of the root).
    const install = path.join(base, "dev", "nodejs", "current");
    toolBin = path.join(install, "bin");
    await mkdir(path.join(toolBin, "node_modules", "foo"), { recursive: true });
    await writeFile(path.join(toolBin, "node_modules", "foo", "foo.js"), `console.log("foo-ran " + require("node:fs").realpathSync(__filename));\n`);
    await writeFile(path.join(toolBin, "foo.ps1"), `node "$PSScriptRoot\\node_modules\\foo\\foo.js" @args\nexit $LASTEXITCODE\n`);
    // Beside the way down to the tool: never to be listed nor read.
    await mkdir(path.join(base, "dev", "other-project"), { recursive: true });
    await writeFile(path.join(base, "dev", "other-project", "secret.txt"), "other-secret");
    await writeFile(path.join(base, "dev", "notes.txt"), "notes-secret");
    await mkdir(root, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    process.env.PATH = `${toolBin};${savedPath}`;
  });

  after(async () => {
    process.env.PATH = savedPath;
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  async function ps(command: string, extra: Partial<ConfinedBashOptions> = {}) {
    const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir, ...extra });
    let output = "";
    const { exitCode } = await ops.exec(command, root, { onData: (data) => (output += data.toString()), timeout: 120 });
    return { output, exitCode };
  }

  // openlore: scenario=AToolBesideTheRootResolves spec=sandbox-runner-bash
  test("AToolBesideTheRootResolves: a script beside the root runs by its launcher on PATH, and what lies beside stays out", async () => {
    const run = await ps("foo");
    assert.equal(run.exitCode, 0, run.output);
    assert.match(run.output, /foo-ran .*foo\.js/, "Node resolved the script's real path through the folders above it");
    assert.doesNotMatch(run.output, /EPERM/);

    const beside = await ps(
      [
        `try { Get-Content -Raw "${path.join(base, "dev", "notes.txt")}" -ErrorAction Stop } catch { "notes: refused" }`,
        `try { Get-ChildItem -Name "${path.join(base, "dev", "other-project")}" -ErrorAction Stop } catch { "other: refused" }`,
        `try { Get-Content -Raw "${path.join(base, "dev", "other-project", "secret.txt")}" -ErrorAction Stop } catch { "secret: refused" }`,
      ].join("; "),
    );
    assert.match(beside.output, /notes: refused/, beside.output);
    assert.match(beside.output, /other: refused/, beside.output);
    assert.match(beside.output, /secret: refused/, beside.output);
    assert.doesNotMatch(beside.output, /notes-secret|other-secret|secret\.txt/);
  });

  /**
   * Another address of this machine's own subnet: what Windows counts as the private network is the
   * subnets the machine is on (and intranet ranges a policy names), not every RFC 1918 range. The
   * machine's own address will not do — Windows counts it as the host's loopback.
   */
  function neighbour(): string | undefined {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const a of addresses ?? []) {
        if (a.family !== "IPv4" || a.internal || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
        const parts = a.address.split(".");
        parts[3] = parts[3] === "254" ? "253" : "254";
        return parts.join(".");
      }
    }
    return undefined;
  }
  const peer = neighbour();

  /** A TCP connection to that address: the sandbox's refusal is WSAEACCES (10013), at once. */
  const PRIVATE = `$c = [Net.Sockets.TcpClient]::new(); try { [void]$c.ConnectAsync("${peer}", 9).Wait(3000); "private: not refused" } catch { $code = $_.Exception.InnerException.InnerException.ErrorCode; if ($code -eq 10013) { "private: refused by the sandbox" } else { "private: not refused ($code)" } }`;

  // openlore: scenario=TheIntranetIsReachable spec=sandbox-runner-bash
  test("TheIntranetIsReachable: the private network is not refused by default; privateNetwork false refuses it", { skip: peer ? false : "this machine is on no private IPv4 network" }, async () => {
    assert.match((await ps(PRIVATE)).output, /private: not refused/);
    assert.match((await ps(PRIVATE, { privateNetwork: false })).output, /private: refused by the sandbox/);
  });

  // openlore: scenario=ASandboxRefusalIsNamed spec=sandbox-runner-bash
  test("ASandboxRefusalIsNamed: a refused connection's output ends saying it was the sandbox, and which setting", { skip: peer ? false : "this machine is on no private IPv4 network" }, async () => {
    // The program's own words, as uv and Python print them: the error's message, in the user's language.
    const refused = await ps(`$c = [Net.Sockets.TcpClient]::new(); try { [void]$c.ConnectAsync("${peer}", 9).Wait(3000) } catch { $_.Exception.InnerException.InnerException.Message; exit 1 }`, { privateNetwork: false });
    assert.match(refused.output, /\[pi-outpost\] the sandbox refused a network connection \(WSAEACCES, 10013\)/, refused.output);
    assert.match(refused.output, /sandbox\.privateNetwork is false/);
    const open = await ps(`"connected or not, no refusal"`);
    assert.doesNotMatch(open.output, /the sandbox refused a network connection/);
  });
});
