/**
 * The repository's `.git` under each real runner this machine has (`git-dir-read-only`): MXC on
 * Windows (`MXC_EXEC`, PowerShell), MXC on Linux (`MXC_LXC_EXEC` with `MXC_LINUX_EXPECT=confined`),
 * MXC on macOS (`MXC_MAC_EXEC`), Seatbelt (`SEATBELT_EXEC`) and landstrip (`LANDSTRIP_BIN`). Every
 * outcome is read back from the disk, not from what the command printed.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { readdir } from "node:fs/promises";
import { confinedBashOperations, type ConfinedBashOptions } from "../src/confinedBash.ts";
import { runCanary } from "../src/confinementCanary.ts";
import { heldReadOnlyInside } from "../src/terminalSandbox.ts";

interface Runner {
  name: string;
  runner: string;
  shell?: string;
  /** Appends a line to `file`; prints "wrote" or "refused". */
  append(file: string): string;
  /** `git <args>` in the root, then its exit status as "exit N". */
  git(args: string): string;
}

const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const sh = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const posix = (name: string, runner: string | undefined): Runner | undefined =>
  runner
    ? {
        name,
        runner,
        append: (file) => `if (echo '# probe' >> ${sh(file)}) 2>/dev/null; then echo wrote; else echo refused; fi`,
        git: (args) => `git ${args} >/dev/null 2>&1; echo "exit $?"`,
      }
    : undefined;

const RUNNERS: Runner[] = [
  process.platform === "win32" && process.env.MXC_EXEC
    ? {
        name: "MXC on Windows",
        runner: process.env.MXC_EXEC,
        shell: POWERSHELL,
        append: (file: string) => `try { Add-Content -LiteralPath '${file}' -Value '# probe' -ErrorAction Stop; 'wrote' } catch { 'refused' }`,
        git: (args: string) => `git ${args} 2>&1 | Out-Null; "exit $LASTEXITCODE"`,
      }
    : undefined,
  posix("MXC on Linux", process.platform === "linux" && process.env.MXC_LINUX_EXPECT === "confined" ? process.env.MXC_LXC_EXEC : undefined),
  posix("MXC on macOS", process.platform === "darwin" ? process.env.MXC_MAC_EXEC : undefined),
  posix("Seatbelt", process.platform === "darwin" ? process.env.SEATBELT_EXEC : undefined),
  posix("landstrip", process.platform === "linux" ? process.env.LANDSTRIP_BIN : undefined),
].filter((runner): runner is Runner => runner !== undefined);

async function project(initialised = true) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "git-held-")));
  const root = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  await mkdir(root, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(root, "a.txt"), "a\n");
  if (initialised) {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: root });
  }
  return { base, root, agentDir, config: path.join(root, ".git", "config") };
}

async function run(runner: Runner, root: string, agentDir: string, command: string, extra: Partial<ConfinedBashOptions> = {}) {
  const ops = confinedBashOperations({ runner: runner.runner, ...(runner.shell ? { shell: runner.shell } : {}), root, allowWrite: true, agentDir, ...extra });
  let output = "";
  await ops.exec(command, root, { onData: (data: Buffer) => (output += data.toString()), timeout: 120 });
  return output;
}

const commit = (runner: Runner) => runner.git("-c user.email=t@t -c user.name=t commit -qam change");
const heads = (root: string) => execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

describe("the repository's .git under a real runner", { skip: RUNNERS.length === 0 ? "no real runner named (MXC_EXEC, MXC_LXC_EXEC, MXC_MAC_EXEC, SEATBELT_EXEC, LANDSTRIP_BIN)" : false }, () => {
  for (const runner of RUNNERS) {
    // openlore: scenario=AConfinedCommandCannotWriteTheRepositoryConfiguration spec=sandbox-approved-grants
    test(`AConfinedCommandCannotWriteTheRepositoryConfiguration (${runner.name}): .git refused, the root and git status as before, a commit refused`, async () => {
      const { base, root, agentDir, config } = await project();
      try {
        const before = await readFile(config, "utf8");
        await writeFile(path.join(root, "a.txt"), "changed\n");
        const output = await run(
          runner,
          root,
          agentDir,
          [runner.append(config), runner.append(path.join(root, ".git", "hooks", "pre-commit")), runner.append(path.join(root, "b.txt")), runner.git("status --porcelain"), commit(runner)].join("\n"),
        );
        assert.equal(await readFile(config, "utf8"), before, `.git/config unchanged: ${output}`);
        assert.equal(existsSync(path.join(root, ".git", "hooks", "pre-commit")), false, "no hook");
        assert.equal(existsSync(path.join(root, "b.txt")), true, "the root is still writable");
        assert.match(output, /exit 0/, `git status works: ${output}`);
        assert.equal(heads(root), "1", "the commit was refused");
      } finally {
        await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    });

    // openlore: scenario=ACommitAsksForAGrant spec=sandbox-approved-grants
    test(`ACommitAsksForAGrant (${runner.name}): with a write grant on .git, the commit is made`, async () => {
      const { base, root, agentDir } = await project();
      try {
        await writeFile(path.join(root, "a.txt"), "changed\n");
        const output = await run(runner, root, agentDir, commit(runner), { grants: () => ({ hosts: [], directories: [{ path: path.join(root, ".git"), access: "write" }] }) });
        assert.equal(heads(root), "2", `committed: ${output}`);
      } finally {
        await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    });

    test(`${runner.name}: with sandbox.gitWritable, .git is writable as before`, async () => {
      const { base, root, agentDir, config } = await project();
      try {
        await run(runner, root, agentDir, runner.append(config), { gitWritable: true });
        assert.match(await readFile(config, "utf8"), /# probe/);
      } finally {
        await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    });

    // openlore: scenario=TheCanarySeesAWritableGitDirectory spec=sandbox-approved-grants
    test(`${runner.name}: the canary tries .git with a file of its own, sees it refused, and leaves nothing there`, async () => {
      const { base, root, agentDir } = await project();
      try {
        const listed = await readdir(path.join(root, ".git"));
        const ops = confinedBashOperations({ runner: runner.runner, ...(runner.shell ? { shell: runner.shell } : {}), root, allowWrite: true, agentDir });
        const verdict = await runCanary({
          runner: runner.runner,
          agentDir,
          root,
          heldReadOnly: heldReadOnlyInside(root),
          powerShell: runner.shell !== undefined,
          proxied: false,
          exec: async (command) => {
            let output = "";
            await ops.exec(command, root, { onData: (data: Buffer) => (output += data.toString()), timeout: 120 });
            return output;
          },
        });
        assert.ok(verdict.state === "verified" || verdict.state === "partial", JSON.stringify(verdict));
        assert.ok(verdict.refused.includes("write-git-dir"), JSON.stringify(verdict));
        assert.deepEqual((await readdir(path.join(root, ".git"))).sort(), listed.sort(), "nothing left in .git");
      } finally {
        await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    });

    // openlore: scenario=AMissingGitDirectoryIsNotHeld spec=sandbox-approved-grants
    test(`AMissingGitDirectoryIsNotHeld (${runner.name}): a folder that is no repository runs its commands; the agent's git init works, and the next command finds .git held`, async () => {
      const { base, root, agentDir, config } = await project(false);
      try {
        const first = await run(runner, root, agentDir, runner.git("init -q"));
        assert.match(first, /exit 0/, `git init ran: ${first}`);
        assert.equal(existsSync(config), true, "the repository exists");
        const before = await readFile(config, "utf8");
        const second = await run(runner, root, agentDir, runner.append(config));
        assert.equal(await readFile(config, "utf8"), before, `held from the next command: ${second}`);
      } finally {
        await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    });
  }
});
