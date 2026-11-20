/**
 * Toolchains under MXC's real executor (Windows 11, tier 1): what the agent's confined shell and a
 * confined terminal need for a build to run — a temporary directory that exists, the installation
 * behind each search-path folder, a sandbox cache, toolchain homes (`windows-toolchains-in-sandbox`).
 *
 * Only where `MXC_EXEC` names the executor. A test whose tool is not installed here is skipped,
 * saying which; none of them runs in CI, which has no MXC tier 1.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { WebSocket } from "ws";
import { confinedBashOperations, type ConfinedBashOptions } from "../src/confinedBash.ts";
import { buildTerminalConfinement } from "../src/confinementStatus.ts";
import { CONFINED_POWERSHELL_ARGS, TerminalManager } from "../src/terminalManager.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const CMD = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
const skip = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC (wxc-exec.exe) is not set" : false;

/** The first program of that name on the search path, or undefined. */
export function onPath(name: string): string | undefined {
  try {
    return execFileSync("where.exe", [name], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

describe("toolchains under MXC's real executor", { skip }, () => {
  let base: string;
  let root: string;
  let agentDir: string;
  const manager = new TerminalManager();
  const socket = {} as WebSocket;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "toolchains-mxc-"));
    root = path.join(base, "app");
    agentDir = path.join(base, "agent");
    await mkdir(root, { recursive: true });
    await mkdir(agentDir, { recursive: true });
  });

  after(async () => {
    manager.closeAllForSocket(socket);
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  /** A command in the agent's confined PowerShell, from `cwd` (relative to the root). */
  async function ps(command: string, cwd = ".", extra: Partial<ConfinedBashOptions> = {}) {
    const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir, ...extra });
    let output = "";
    const { exitCode } = await ops.exec(command, path.join(root, cwd), { onData: (data) => (output += data.toString()), timeout: 600 });
    return { output, exitCode };
  }

  /** One line in a terminal confined as the server confines it, under cmd; everything it printed. */
  async function inTerminal(id: string, line: string, shell: { shell: string; shellArgs: string[] } = { shell: CMD, shellArgs: [] }): Promise<string> {
    let output = "";
    let exitCode: number | undefined;
    await manager.open(
      socket,
      id,
      root,
      160,
      40,
      (_id, data) => {
        output += data;
      },
      (_id, code) => {
        exitCode = code ?? -1;
      },
      shell,
      buildTerminalConfinement({ runner: RUNNER!, root, allowWrite: true, agentDir }),
    );
    const tag = `M${Math.random().toString(36).slice(2, 8)}`;
    manager.write(socket, id, shell.shell === CMD ? `${line} & echo ${tag}-E\r` : `${line}; echo ${tag}-E\r`);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (exitCode !== undefined) throw new Error(`the confined shell exited (${exitCode}): ${output}`);
      const seen = output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
      const end = seen.lastIndexOf(`${tag}-E`);
      if (end !== -1 && seen.indexOf(`${tag}-E`) !== end && seen.length > end + tag.length + 2) return seen;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`no answer to ${line}: ${output}`);
  }

  // openlore: scenario=OnWindowsATemporaryFileCanBeCreated spec=sandbox-runner-bash
  test("OnWindowsATemporaryFileCanBeCreated: TEMP exists, is writable, and lies in the command's private temp", async () => {
    const { output, exitCode } = await ps(
      `[IO.File]::WriteAllText((Join-Path $env:TEMP "probe.txt"), "x"); "written"; [IO.Path]::GetTempFileName(); "TEMP=$env:TEMP"; "TMPDIR=$env:TMPDIR"`,
    );
    assert.equal(exitCode, 0, output);
    assert.match(output, /^written$/m);
    const temp = /^TEMP=(.+)$/m.exec(output)?.[1]?.trim();
    const tmpDir = /^TMPDIR=(.+)$/m.exec(output)?.[1]?.trim();
    assert.ok(temp && tmpDir && temp.toLowerCase().startsWith(tmpDir.toLowerCase()), `TEMP ${temp} is not inside ${tmpDir}`);
    assert.match(output, /\.tmp$/m, "GetTempFileName returned a file");
  });

  // openlore: scenario=OnWindowsTheTerminalHasAWritableTemp spec=terminal
  test("OnWindowsTheTerminalHasAWritableTemp: a file is created in %TEMP%, inside the terminal's private temp", async () => {
    const seen = await inTerminal("temp", `echo TEMP=[%TEMP%] & echo TMPDIR=[%TMPDIR%] & echo written> "%TEMP%\\probe.txt" && type "%TEMP%\\probe.txt"`);
    assert.doesNotMatch(seen, /(Access is denied|Accès refusé|cannot find the path|chemin d.accès spécifié)/i, seen);
    const temp = /^TEMP=\[(.+?)\]/m.exec(seen)?.[1];
    const tmpDir = /^TMPDIR=\[(.+?)\]/m.exec(seen)?.[1];
    assert.ok(temp && tmpDir && /pi-outpost-terminal-/i.test(tmpDir), seen);
    assert.equal(temp, tmpDir, "TEMP is the terminal's private directory");
    assert.match(seen, /^written\s*$/m, "the file was created and read back");
  });

  // openlore: scenario=OnWindowsTheTerminalHasAWritableTemp spec=terminal
  test("OnWindowsTheTerminalHasAWritableTemp: under PowerShell, the confined terminal's default shell, too", async () => {
    const seen = await inTerminal(
      "temp-ps",
      `"TEMP=[$env:TEMP]"; "TMPDIR=[$env:TMPDIR]"; Set-Content (Join-Path $env:TEMP probe.txt) written; Get-Content (Join-Path $env:TEMP probe.txt)`,
      { shell: POWERSHELL, shellArgs: CONFINED_POWERSHELL_ARGS },
    );
    const temp = /^TEMP=\[(.+?)\]/m.exec(seen)?.[1];
    const tmpDir = /^TMPDIR=\[(.+?)\]/m.exec(seen)?.[1];
    assert.ok(temp && tmpDir && /pi-outpost-terminal-/i.test(tmpDir), seen);
    assert.equal(temp, tmpDir);
    assert.match(seen, /^written\s*$/m, seen);
  });

  // openlore: scenario=OnWindowsCmakeFindsItsModules spec=sandbox-runner-bash
  test("OnWindowsCmakeFindsItsModules: CMake configures and builds, finding its modules beside its bin", { skip: onPath("cmake") && onPath("mingw32-make") ? false : "no cmake and mingw32-make on the search path" }, async () => {
    await mkdir(path.join(root, "cm"), { recursive: true });
    await writeFile(path.join(root, "cm", "hello.c"), '#include <stdio.h>\nint main(void){puts("cmake ok");return 0;}\n');
    await writeFile(path.join(root, "cm", "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.10)\nproject(hello C)\nadd_executable(hello hello.c)\n");
    const { output, exitCode } = await ps('cmake -S . -B build -G "MinGW Makefiles"; if ($LASTEXITCODE -eq 0) { cmake --build build }; if ($LASTEXITCODE -eq 0) { ./build/hello.exe }', "cm");
    assert.doesNotMatch(output, /Modules directory not found/);
    assert.equal(exitCode, 0, output);
    assert.match(output, /^cmake ok$/m);
  });

  // openlore: scenario=OnWindowsMavenStarts spec=sandbox-runner-bash
  test("OnWindowsMavenStarts: mvn starts, reading its boot folder", { skip: onPath("mvn") ? false : "no mvn on the search path" }, async () => {
    const { output, exitCode } = await ps("mvn -v");
    assert.doesNotMatch(output, /-classpath requires class path specification/);
    assert.equal(exitCode, 0, output);
    assert.match(output, /Apache Maven \d/);
  });

  // openlore: scenario=OnWindowsGccCompiles spec=sandbox-runner-bash
  test("OnWindowsGccCompiles: gcc compiles and the program runs", { skip: onPath("gcc") ? false : "no gcc on the search path" }, async () => {
    await mkdir(path.join(root, "c"), { recursive: true });
    await writeFile(path.join(root, "c", "hello.c"), '#include <stdio.h>\nint main(void){puts("c ok");return 0;}\n');
    const { output, exitCode } = await ps("gcc hello.c -o hello.exe; if ($LASTEXITCODE -eq 0) { ./hello.exe }", "c");
    assert.doesNotMatch(output, /Cannot create temporary file/);
    assert.equal(exitCode, 0, output);
    assert.match(output, /^c ok$/m);
  });
});
