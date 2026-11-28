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
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { WebSocket } from "ws";
import { confinedBashOperations, type ConfinedBashOptions } from "../src/confinedBash.ts";
import { buildTerminalConfinement } from "../src/confinementStatus.ts";
import { CONFINED_POWERSHELL_ARGS, TerminalManager } from "../src/terminalManager.ts";
import { checkRunner, windowsToolchains } from "../src/terminalSandbox.ts";

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
    // As the server sets the shell up (agentBashOptions): the sandbox cache and the toolchain homes.
    const toolchains = windowsToolchains({ cacheDir: path.join(base, "sandbox-cache"), serverEnv: process.env, home: homedir(), agentDir });
    const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir, toolchains, ...extra });
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
      buildTerminalConfinement({ runner: RUNNER!, root, allowWrite: true, agentDir, cacheDir: path.join(base, "sandbox-cache") }),
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

  // openlore: scenario=PowerShellLeavesNothingInTheProject spec=sandbox-runner-bash
  test("PowerShellLeavesNothingInTheProject: a command running long enough for PowerShell's module cache writes none in the root", async () => {
    // PowerShell writes the cache some seconds after starting: a dev server started by the agent
    // left `Microsoft\Windows\PowerShell\ModuleAnalysisCache` in the user's project (a real session).
    const dir = "module-cache-probe";
    await mkdir(path.join(root, dir), { recursive: true });
    // A name PowerShell cannot resolve at once makes it analyse the modules (to load one that might
    // hold it), and the cache follows. Inside the container Windows names no local application data:
    // [Environment]::GetFolderPath('LocalApplicationData') is "", so the cache went to the working directory.
    const { output } = await ps("nosuchcommand-pi-outpost 2>$null; Start-Sleep -Seconds 15; 'slept'", dir);
    assert.match(output, /slept/, output);
    assert.equal(existsSync(path.join(root, dir, "Microsoft")), false, "PowerShell wrote its module cache into the project");
    assert.deepEqual(await readdir(path.join(root, dir)), [], "nothing was left in the working directory");
  });

  // openlore: scenario=PythonsMessagesComeBackUndamaged spec=sandbox-runner-bash
  test("PythonsMessagesComeBackUndamaged: a Windows error Python prints reaches the agent as written", { skip: onPath("python") ? false : "no python on the search path" }, async () => {
    // Python writes to a pipe in the ANSI code page: the model read "Le fichier sp�cifi� est introuvable".
    const dir = "python-encoding-probe";
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, "fails.py"), 'import _winapi\n_winapi.WaitNamedPipe(r"\\\\.\\pipe\\nowhere-pi-outpost", 1)\n');
    // UTF-8 mode off, as on a default install (this machine's may have it on): the code page decides.
    const { output } = await ps("python -X utf8=0 fails.py", dir);
    assert.match(output, /FileNotFoundError: \[WinError 2\] /, output);
    assert.doesNotMatch(output, /�/, `the message came back damaged: ${output}`);
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

  /** A Go module with one dependency, in `dir` of the root. */
  async function goModule(dir: string): Promise<void> {
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, "go.mod"), "module probe/goapp\n\ngo 1.21\n\nrequire github.com/google/uuid v1.6.0\n");
    await writeFile(path.join(root, dir, "main.go"), 'package main\n\nimport (\n\t"fmt"\n\n\t"github.com/google/uuid"\n)\n\nfunc main() { _ = uuid.New(); fmt.Println("go ok") }\n');
  }

  // openlore: scenario=ADependencyIsDownloadedOnce spec=sandbox-runner-bash
  test("ADependencyIsDownloadedOnce: a Go dependency is downloaded by the first build only", { skip: onPath("go") ? false : "no go on the search path" }, async () => {
    await goModule("go1");
    const first = await ps("go mod tidy; go build -o app.exe .; if ($LASTEXITCODE -eq 0) { ./app.exe }", "go1");
    assert.equal(first.exitCode, 0, first.output);
    assert.match(first.output, /^go ok$/m);
    assert.match(first.output, /go: (downloading|finding).*google\/uuid/, "the first build downloads the dependency");
    const second = await ps("Remove-Item app.exe; go build -o app.exe .; if ($LASTEXITCODE -eq 0) { ./app.exe }", "go1");
    assert.equal(second.exitCode, 0, second.output);
    assert.match(second.output, /^go ok$/m);
    assert.doesNotMatch(second.output, /downloading/, "the second finds it in the sandbox cache");
  });

  // openlore: scenario=OnWindowsTheTerminalBuildsAGoModule spec=terminal
  test("OnWindowsTheTerminalBuildsAGoModule: go build then the program, in a confined terminal", { skip: onPath("go") ? false : "no go on the search path" }, async () => {
    await goModule("go2");
    const seen = await inTerminal("go", "cd go2 && go mod tidy && go build -o app.exe . && app.exe");
    assert.match(seen, /^go ok\s*$/m, seen);
  });

  // openlore: scenario=GradlesWrapperRunsConfined spec=sandbox-runner-bash
  test("GradlesWrapperRunsConfined: gradlew test passes twice, the distribution downloaded once", { skip: onPath("gradle") ? false : "no gradle on the search path to make the wrapper" }, async () => {
    const dir = path.join(root, "gradle-app");
    await mkdir(dir, { recursive: true });
    execFileSync(onPath("gradle")!, ["init", "--type", "java-application", "--dsl", "kotlin", "--test-framework", "junit-jupiter", "--project-name", "gradleapp", "--package", "probe", "--no-split-project", "--java-version", "21", "--no-incubating", "--overwrite", "-q"], { cwd: dir, shell: true, windowsHide: true });
    const first = await ps("./gradlew.bat test -q --console=plain", "gradle-app");
    assert.equal(first.exitCode, 0, first.output);
    const second = await ps("./gradlew.bat test -q --console=plain", "gradle-app");
    assert.equal(second.exitCode, 0, second.output);
    assert.doesNotMatch(second.output, /Downloading https:\/\/services\.gradle\.org/, "the wrapper's distribution is in the sandbox cache");
  });

  // openlore: scenario=NpmsGlobalPrefixIsNotInTheProject spec=sandbox-runner-bash
  test("NpmsGlobalPrefixIsNotInTheProject: npm's global root is a folder of the sandbox cache", { skip: onPath("npm") ? false : "no npm on the search path" }, async () => {
    const { output, exitCode } = await ps("npm root -g");
    assert.equal(exitCode, 0, output);
    assert.ok(output.toLowerCase().includes(path.join(base, "sandbox-cache").toLowerCase()), output);
    assert.equal(existsSync(path.join(root, "${APPDATA}")), false);
  });

  // openlore: scenario=OnWindowsCargoTestsConfined spec=sandbox-runner-bash
  // openlore: scenario=ToolsFoundWithoutPathStillRun spec=sandbox-runner-bash
  test("OnWindowsCargoTestsConfined: rustup's toolchain is found and a crate with a registry dependency tests", { skip: existsSync(path.join(homedir(), ".rustup")) && onPath("cargo") ? false : "no rustup toolchain for this user" }, async () => {
    const { output, exitCode } = await ps("cargo new -q --vcs none crate1; Set-Location crate1; cargo add -q itoa; cargo test -q");
    assert.doesNotMatch(output, /no default is configured/);
    assert.equal(exitCode, 0, output);
    assert.match(output, /test result: ok/);
  });

  // openlore: scenario=CargoCredentialsStayOut spec=sandbox-runner-bash
  test("CargoCredentialsStayOut: the user's Cargo home is not readable", { skip: existsSync(path.join(homedir(), ".cargo")) ? false : "no ~/.cargo here" }, async () => {
    const cargo = path.join(homedir(), ".cargo");
    const { output } = await ps(`try { Get-Content -LiteralPath "${path.join(cargo, "credentials.toml")}" -ErrorAction Stop | Out-Null; "READ" } catch { "NOT READ" }`);
    // ~\.cargo\bin is on PATH and readable; its home, with credentials.toml, is not. Its names may
    // be listed under the enumerated drive (microsoft/mxc#1461): the content is what must stay out.
    assert.match(output, /^NOT READ$/m, output);
  });

  // openlore: scenario=UvFindsTheUsersPythons spec=sandbox-runner-bash
  test("UvFindsTheUsersPythons: a uv project with no .venv uses a Python uv installed, downloading none", { skip: onPath("uv") && existsSync(path.join(process.env.APPDATA ?? "", "uv", "python")) ? false : "no uv-managed Python for this user" }, async () => {
    const { output, exitCode } = await ps("uv init -q --app uvproj; Set-Location uvproj; uv sync --managed-python; uv run --managed-python python -V");
    assert.doesNotMatch(output, /Downloading cpython/, output);
    assert.equal(exitCode, 0, output);
    assert.match(output, /^Python 3\.\d+/m);
  });

  const gitUsrBin = path.join(process.env.ProgramFiles ?? String.raw`C:\Program Files`, "Git", "usr", "bin");
  const strawberryPerl = String.raw`C:\Strawberry\perl\bin\perl.exe`;

  // openlore: scenario=OnWindowsPerlIsTheNativeOne spec=sandbox-runner-bash
  test("OnWindowsPerlIsTheNativeOne: with Git's usr\\bin first on PATH, perl is Strawberry's", { skip: existsSync(path.join(gitUsrBin, "msys-2.0.dll")) && existsSync(strawberryPerl) ? false : "needs Git for Windows' usr\\bin and Strawberry Perl" }, async () => {
    const saved = process.env.PATH;
    process.env.PATH = [gitUsrBin, path.dirname(strawberryPerl), saved].join(";");
    try {
      const { output, exitCode } = await ps(`perl -e "print qq(native perl \\n)"; (Get-Command perl).Source`);
      assert.equal(exitCode, 0, output);
      assert.match(output, /^native perl\s*$/m);
      assert.match(output, /Strawberry\\perl\\bin\\perl\.exe/i);
    } finally {
      process.env.PATH = saved;
    }
  });

  // openlore: scenario=AnMsysProgramNamedDirectlyIsExplained spec=sandbox-runner-bash
  test("AnMsysProgramNamedDirectlyIsExplained: an MSYS2 perl named by its path fails, and the note says why", { skip: existsSync(path.join(gitUsrBin, "perl.exe")) ? false : "no Git for Windows' usr\\bin\\perl.exe" }, async () => {
    const { output, exitCode } = await ps(`& "${path.join(gitUsrBin, "perl.exe")}" -e 1`);
    assert.notEqual(exitCode, 0);
    assert.match(output, /MSYS2 program.*none of them can start in this sandbox/s, output);
  });

  /** bun's version when it is on the search path and 1.4.5 or later (`bun run` gave up on unreadable ancestors before). */
  const bunReady = (() => {
    const bun = onPath("bun");
    if (!bun) return false;
    const [major = 0, minor = 0, patch = 0] = execFileSync(bun, ["--version"], { encoding: "utf8", windowsHide: true }).trim().split(".").map(Number);
    return major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch >= 5)));
  })();

  async function bunProject(dir: string): Promise<void> {
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, "package.json"), JSON.stringify({ name: dir, private: true, type: "module" }));
    await writeFile(path.join(root, dir, "index.ts"), 'console.log("bun ok");\n');
    await writeFile(path.join(root, dir, "math.test.ts"), 'import { expect, test } from "bun:test";\ntest("adds", () => { expect(1 + 1).toBe(2); });\n');
  }

  // openlore: scenario=OnWindowsBunRunsAndTests spec=sandbox-runner-bash
  test("OnWindowsBunRunsAndTests: bun run prints, bun test passes", { skip: bunReady ? false : "no bun 1.4.5 or later on the search path" }, async () => {
    await bunProject("bun1");
    const { output, exitCode } = await ps("bun run index.ts; if ($LASTEXITCODE -eq 0) { bun test }", "bun1");
    assert.equal(exitCode, 0, output);
    assert.match(output, /^bun ok$/m);
    assert.match(output, /1 pass/);
  });

  // openlore: scenario=BunInstallsFailureIsExplained spec=sandbox-runner-bash
  test("BunInstallsFailureIsExplained: bun add fails on the container's rename limit, and the note says to run it outside", { skip: bunReady ? false : "no bun 1.4.5 or later on the search path" }, async () => {
    await bunProject("bun2");
    const { output, exitCode } = await ps("bun add is-odd", "bun2");
    assert.notEqual(exitCode, 0, output);
    assert.match(output, /bun cannot install packages in this sandbox.*run the install outside the sandbox/s, output);
  });

  // openlore: scenario=AToolTheTableDoesNotNameKeepsItsCache spec=sandbox-runner-bash
  test("AToolTheTableDoesNotNameKeepsItsCache: a variable from sandbox.toolEnvironment points a tool into the sandbox cache", async () => {
    const cacheDir = path.join(base, "sandbox-cache");
    const toolchains = windowsToolchains({ cacheDir, serverEnv: process.env, home: homedir(), agentDir, toolEnvironment: { PROBE_TOOL_HOME: "${cache}/probe-tool" } });
    const write = await ps(`New-Item -ItemType Directory -Force $env:PROBE_TOOL_HOME | Out-Null; Set-Content (Join-Path $env:PROBE_TOOL_HOME kept.txt) kept`, ".", { toolchains });
    assert.equal(write.exitCode, 0, write.output);
    const read = await ps(`Get-Content (Join-Path $env:PROBE_TOOL_HOME kept.txt)`, ".", { toolchains });
    assert.equal(read.exitCode, 0, read.output);
    assert.match(read.output, /^kept\s*$/m, "a second command finds what the first left");
    assert.ok(existsSync(path.join(cacheDir, "probe-tool", "kept.txt")), "the file lies in the sandbox cache's probe-tool folder");
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
