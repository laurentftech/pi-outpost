/**
 * The agent's shell confined by a runner when `sandbox.bashShell` names PowerShell.
 *
 * The fake runner is node, as in `confinedBash.test.ts`: it records what it was asked and,
 * when the shell exists, runs it with the arguments it was given. The first tests name a
 * PowerShell that does not exist, to read what pi-outpost asks of the runner; the last run a
 * real PowerShell through it — `pwsh` (on the CI's Linux and Windows runners) and, on
 * Windows, `powershell.exe` 5.1 — for what a command sees and returns.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations, isPowerShell, POWERSHELL_SCRIPT_ARGS, powerShellScript } from "../src/confinedBash.ts";

const FAKE_RUNNER = `
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const policy = JSON.parse(fs.readFileSync(args[args.indexOf("-p") + 1], "utf8"));
const [shell, ...shellArgs] = args.slice(args.indexOf("--") + 1);
const script = shellArgs.at(-1);
fs.writeFileSync(path.join(path.dirname(process.env.TMPDIR), path.basename(process.env.TMPDIR) + ".ps-record.json"),
  JSON.stringify({ args, policy, shell, shellArgs, script: fs.readFileSync(script).toString("base64") }));
if (!fs.existsSync(shell)) { process.stdout.write("recorded"); process.exit(0); }
spawn(shell, shellArgs, { stdio: "inherit", env: process.env }).on("exit", (code) => process.exit(code ?? 1));
`;

/** A PowerShell on this host, by name, or undefined. */
function found(name: string): string | undefined {
  try {
    const where = process.platform === "win32" ? "where.exe" : "which";
    return execFileSync(where, [name], { encoding: "utf8" }).split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

describe("a confined PowerShell", () => {
  let base: string;
  let root: string;
  const ok = async () => ({ ok: true as const });

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "confined-powershell-"));
    root = path.join(base, "app");
    await mkdir(path.join(root, "out"), { recursive: true });
    await writeFile(path.join(root, "run"), FAKE_RUNNER);
  });
  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function operations(shell: string) {
    return confinedBashOperations({
      runner: process.execPath,
      shell,
      root,
      writableRoot: path.join(root, "out"),
      allowWrite: true,
      agentDir: path.join(base, "agent"),
      configFile: path.join(base, "config.json"),
      check: ok,
    });
  }

  async function lastRecord(): Promise<{ args: string[]; policy: { filesystem: Record<string, string[]> }; shell: string; shellArgs: string[]; script: Buffer }> {
    const records = (await readdir(tmpdir())).filter((name) => name.startsWith("pi-outpost-bash-") && name.endsWith(".ps-record.json"));
    const withTimes = await Promise.all(records.map(async (name) => ({ name, at: (await stat(path.join(tmpdir(), name))).mtimeMs })));
    const newest = withTimes.sort((a, b) => b.at - a.at)[0];
    assert.ok(newest, "the runner recorded nothing: it was never run");
    const record = JSON.parse(await readFile(path.join(tmpdir(), newest.name), "utf8"));
    await rm(path.join(tmpdir(), newest.name), { force: true });
    return { ...record, script: Buffer.from(record.script, "base64") };
  }

  async function exec(shell: string, command: string) {
    let output = "";
    const result = await operations(shell).exec(command, root, {
      onData: (data) => {
        output += data.toString();
      },
    });
    return { output, exitCode: result.exitCode };
  }

  test("PowerShell is recognised by its executable's name, whatever the folder or case", () => {
    for (const shell of ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "C:\\Program Files\\PowerShell\\7\\PWSH.EXE", "/usr/bin/pwsh"]) {
      assert.equal(isPowerShell(shell), true, shell);
    }
    for (const shell of ["C:\\tools\\sh.exe", "/bin/bash", "/opt/pwsh-tools/sh", undefined]) {
      assert.equal(isPowerShell(shell), false, String(shell));
    }
  });

  // openlore: scenario=APowerShellCommandRunsInsideTheRunner spec=sandbox-runner-bash
  test("APowerShellCommandRunsInsideTheRunner: a script, UTF-8 with a BOM, started without profile and with the policy given", async () => {
    const shell = path.join(base, "nowhere", "powershell.exe");
    const { output, exitCode } = await exec(shell, "Write-Output 'héllo'");
    assert.equal(exitCode, 0);
    assert.equal(output, "recorded");
    const record = await lastRecord();
    assert.equal(record.shell, shell, "the configured PowerShell runs the command");
    assert.deepEqual(record.shellArgs.slice(0, -1), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]);
    assert.equal(path.extname(record.shellArgs.at(-1)!), ".ps1", "PowerShell runs only a .ps1 with -File");
    assert.deepEqual([...record.script.subarray(0, 3)], [0xef, 0xbb, 0xbf], "the script starts with a UTF-8 byte-order mark");
    const text = record.script.toString("utf8");
    assert.ok(text.includes("Write-Output 'héllo'"), "the command is in the script, in UTF-8");
    assert.ok(text.indexOf("$ProgressPreference = 'SilentlyContinue'") < text.indexOf("héllo"), "progress is off before the command runs");
    // The same policy a confined bash gets.
    assert.ok(record.policy.filesystem.allowWrite.some((p) => p.replaceAll("\\", "/").endsWith("app/out")), "the writable zone is the sandbox's");
    const denied = record.policy.filesystem.denyRead.map((p) => p.replaceAll("\\", "/"));
    assert.ok(denied.some((p) => p.endsWith("/agent")) && denied.some((p) => p.endsWith("/config.json")), "the keys and the configuration are denied");
  });

  test("the exit trailer stands on its own lines, after a command ending in a comment", () => {
    const script = powerShellScript("Get-Date # a trailing comment");
    const lines = script.split("\n");
    const at = lines.indexOf("Get-Date # a trailing comment");
    assert.ok(at > 0);
    assert.ok(lines.slice(at + 1).some((line) => line.startsWith("if (-not $?)")), "the trailer was swallowed by the comment");
    assert.deepEqual(POWERSHELL_SCRIPT_ARGS.at(-1), "-File");
  });

  const shells = [
    ["pwsh", found("pwsh")],
    ...(process.platform === "win32" ? [["powershell.exe 5.1", found("powershell.exe")]] : []),
  ] as const;

  for (const [label, shell] of shells) {
    const skip = shell ? false : `${label} is not on this host`;
    const native = process.platform === "win32" ? "cmd.exe /c exit 5" : "sh -c 'exit 5'";

    // openlore: scenario=PowerShellExitStatusComesBack spec=sandbox-runner-bash
    test(`PowerShellExitStatusComesBack (${label}): exit, a failed native program, a failed cmdlet, success; both outputs`, { skip }, async () => {
      const explicit = await exec(shell!, "Write-Output 'to-out'; [Console]::Error.WriteLine('to-err'); exit 3");
      assert.equal(explicit.exitCode, 3);
      assert.match(explicit.output, /to-out/);
      assert.match(explicit.output, /to-err/);
      assert.equal((await exec(shell!, native)).exitCode, 5, "the native program's code");
      const cmdlet = await exec(shell!, "Get-Item -LiteralPath (Join-Path $PWD 'no-such-file')");
      assert.equal(cmdlet.exitCode, 1, "a failed cmdlet is a failure");
      assert.match(cmdlet.output, /no-such-file/, "and its error comes back");
      assert.equal((await exec(shell!, `${native}; Write-Output 'recovered'`)).exitCode, 0, "a later success wins");
    });

    // openlore: scenario=PowerShellOutputIsUtf8AndProgressIsOff spec=sandbox-runner-bash
    test(`PowerShellOutputIsUtf8AndProgressIsOff (${label})`, { skip }, async () => {
      const { output, exitCode } = await exec(shell!, "Write-Output 'été ✓ 東京'; Write-Output \"progress=$ProgressPreference\"");
      assert.equal(exitCode, 0, output);
      assert.match(output, /été ✓ 東京/);
      assert.match(output, /progress=SilentlyContinue/);
    });

    // openlore: scenario=PowerShellOutputCarriesNoEscapeCodes spec=sandbox-runner-bash
    test(`PowerShellOutputCarriesNoEscapeCodes (${label}): a table and an error, as plain text`, { skip }, async () => {
      // PowerShell 7 colours table headers and errors by default; the model read `[32;1m`.
      const { output } = await exec(shell!, "$PSVersionTable.PSVersion; Get-Item -LiteralPath (Join-Path $PWD 'no-such-file')");
      assert.match(output, /Major/);
      assert.match(output, /no-such-file/);
      assert.doesNotMatch(output, /\u001b\[/);
    });
  }
});
