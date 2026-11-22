// Probe, not a test of the product: can MXC on Windows hold a read-only directory inside a writable root?
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";

const RUNNER = process.env.MXC_EXEC;
const PS = path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

test("probe: MXC on Windows, .git read-only inside a writable root", { skip: !RUNNER }, async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ro-probe-")));
  const root = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  await mkdir(root, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  await writeFile(path.join(root, "a.txt"), "a\n");
  const before = await readFile(path.join(root, ".git", "config"), "utf8");
  const later = path.join(root, "later");
  const ops = confinedBashOperations({
    runner: RUNNER!, shell: PS, root, allowWrite: true, agentDir,
    readOnlyGrant: async () => ({ hosts: [], directories: [{ path: path.join(root, ".git"), access: "read" as const }, { path: later, access: "read" as const }] }),
  });
  const script = [
    `try { Set-Content -LiteralPath '${path.join(root, "b.txt")}' -Value b -ErrorAction Stop; 'root write: yes' } catch { 'root write: no' }`,
    `try { Add-Content -LiteralPath '${path.join(root, ".git", "config")}' -Value '# x' -ErrorAction Stop; 'git config write: yes' } catch { 'git config write: no' }`,
    `try { Set-Content -LiteralPath '${path.join(root, ".git", "hooks", "pre-commit")}' -Value x -ErrorAction Stop; 'hook create: yes' } catch { 'hook create: no' }`,
    `try { Get-Content -LiteralPath '${path.join(root, ".git", "HEAD")}' -ErrorAction Stop | Out-Null; 'git HEAD read: yes' } catch { 'git HEAD read: no' }`,
    `try { (Get-ChildItem -Force -LiteralPath '${path.join(root, ".git")}' -ErrorAction Stop | Measure-Object).Count | % { "git dir list: yes ($_ entries)" } } catch { 'git dir list: no' }`,
    `$s = git status --porcelain 2>&1; "git status exit: $LASTEXITCODE"; "git status out: $($s -join ' | ')"`,
    `$c = git -c user.email=t@t -c user.name=t commit -qam x 2>&1; "git commit exit: $LASTEXITCODE"; "git commit out: $($c -join ' | ')"`,
    `try { New-Item -ItemType Directory -Path '${later}' -ErrorAction Stop | Out-Null; Set-Content -LiteralPath '${path.join(later, "f")}' -Value x -ErrorAction Stop; 'later (read-only, absent at start) write: yes' } catch { "later (read-only, absent at start) write: no ($($_.Exception.Message))" }`,
  ].join("\n");
  let output = "";
  try {
    const r = await ops.exec(script, root, { onData: (d: Buffer) => (output += d.toString()), timeout: 120 });
    console.log("exit:", r.exitCode);
  } catch (e) {
    console.log("exec failed:", (e as Error).message.slice(0, 400));
  }
  console.log(output.trim());
  console.log("ON DISK git config unchanged:", (await readFile(path.join(root, ".git", "config"), "utf8")) === before);
  console.log("ON DISK hook exists:", existsSync(path.join(root, ".git", "hooks", "pre-commit")));
  console.log("ON DISK later/f exists:", existsSync(path.join(later, "f")));
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
