/**
 * The agent's `powershell` under MXC's real executor (Windows 11, tier 1) and Windows
 * PowerShell 5.1 — nothing installed beside MXC.
 *
 * `confinedPowerShell.test.ts` fakes the runner; this one runs the operations pi-outpost
 * hands to pi's `powershell` through `wxc-exec.exe`, and checks from the command's side
 * that it is confined like a `bash`, and that git, exit statuses and progress work there.
 *
 * Only where `MXC_EXEC` names the executor and the probe reports tier 1: no CI runner has
 * Windows 11 with the August 2026 update yet.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const skip = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC (wxc-exec.exe) is not set" : false;

describe("the agent's powershell under MXC's real executor", { skip }, () => {
  let base: string;
  let root: string;
  let out: string;
  let agentDir: string;
  const savedKey = process.env.OPENAI_API_KEY;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "confined-powershell-mxc-"));
    root = path.join(base, "app");
    out = path.join(root, "out");
    agentDir = path.join(base, "agent");
    await mkdir(out, { recursive: true });
    await mkdir(path.join(base, "other"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(base, "other", "secret.txt"), "other-secret");
    await writeFile(path.join(agentDir, "auth.json"), '{"key":"sk-agent-secret"}');
    execFileSync("git", ["init", "-q", root]);
    process.env.OPENAI_API_KEY = "sk-server-secret";
  });

  after(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  async function ps(command: string, options: { writableRoot?: string } = {}) {
    const ops = confinedBashOperations({
      runner: RUNNER!,
      shell: POWERSHELL,
      root,
      ...(options.writableRoot ? { writableRoot: options.writableRoot } : {}),
      allowWrite: true,
      agentDir,
    });
    let output = "";
    const { exitCode } = await ops.exec(command, root, {
      onData: (data) => {
        output += data.toString();
      },
    });
    return { output, exitCode };
  }
  const quoted = (p: string) => `'${p.replaceAll("'", "''")}'`;

  test("reads outside the root are refused, and nothing of them comes back", async () => {
    const sibling = await ps(`Get-Content -LiteralPath ${quoted(path.join(base, "other", "secret.txt"))}`);
    assert.notEqual(sibling.exitCode, 0);
    assert.doesNotMatch(sibling.output, /other-secret/);
    const keys = await ps(`Get-Content -LiteralPath ${quoted(path.join(agentDir, "auth.json"))}`);
    assert.notEqual(keys.exitCode, 0);
    assert.doesNotMatch(keys.output, /sk-agent-secret/);
  });

  test("writes land in the writable zone and are refused elsewhere in the root", async () => {
    const zone = await ps(`Set-Content -LiteralPath ${quoted(path.join(out, "a.txt"))} -Value inside`, { writableRoot: out });
    assert.equal(zone.exitCode, 0, zone.output);
    assert.equal((await readFile(path.join(out, "a.txt"), "utf8")).trim(), "inside");
    const elsewhere = await ps(`Set-Content -LiteralPath ${quoted(path.join(root, "b.txt"))} -Value outside`, { writableRoot: out });
    assert.notEqual(elsewhere.exitCode, 0);
    await assert.rejects(readFile(path.join(root, "b.txt")));
  });

  test("both outputs, exit statuses, UTF-8, progress and git work", async () => {
    const result = await ps(
      "Write-Output 'to-out'; [Console]::Error.WriteLine('to-err'); Write-Output 'été ✓'; " +
        "Write-Output \"progress=$ProgressPreference\"; git rev-parse --is-inside-work-tree; " +
        "Invoke-WebRequest -Uri 'http://127.0.0.1:9' -TimeoutSec 1 -ErrorAction SilentlyContinue | Out-Null; exit 3",
    );
    assert.equal(result.exitCode, 3, result.output);
    assert.match(result.output, /to-out/);
    assert.match(result.output, /to-err/);
    assert.match(result.output, /été ✓/);
    assert.match(result.output, /progress=SilentlyContinue/);
    assert.match(result.output, /^true\r?$/m, "git found its work tree");
    assert.equal((await ps("cmd.exe /c exit 5")).exitCode, 5);
    assert.equal((await ps("Get-Item -LiteralPath 'no-such-file'")).exitCode, 1);
    assert.equal((await ps("Write-Output fine")).exitCode, 0);
  });

  test("the server's keys are not in the command's environment", async () => {
    const result = await ps("Get-ChildItem Env: | ForEach-Object { \"$($_.Name)=$($_.Value)\" }");
    assert.equal(result.exitCode, 0, result.output);
    assert.doesNotMatch(result.output, /OPENAI_API_KEY|sk-server-secret/);
  });
});
