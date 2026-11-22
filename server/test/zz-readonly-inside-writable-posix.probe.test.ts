// Probe, not a test of the product: can each POSIX runner hold a read-only directory inside a writable root?
// Prints facts; never fails on them (it fails only if the command could not run at all).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";

const RUNNERS = [
  { name: "MXC on Linux", runner: process.platform === "linux" && process.env.MXC_LINUX_EXPECT === "confined" ? process.env.MXC_LXC_EXEC : undefined },
  { name: "MXC on macOS", runner: process.platform === "darwin" ? process.env.MXC_MAC_EXEC : undefined },
  { name: "Seatbelt", runner: process.platform === "darwin" ? process.env.SEATBELT_EXEC : undefined },
].filter((entry) => entry.runner);

for (const { name, runner } of RUNNERS) {
  test(`probe: ${name}, .git read-only inside a writable root`, async () => {
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
      runner: runner!, root, allowWrite: true, agentDir,
      readOnlyGrant: async () => ({ hosts: [], directories: [{ path: path.join(root, ".git"), access: "read" as const }, { path: later, access: "read" as const }] }),
    });
    const q = (p: string) => `'${p.replace(/'/g, `'\''`)}'`;
    const script = [
      `if (echo b > ${q(path.join(root, "b.txt"))}) 2>/dev/null; then echo 'root write: yes'; else echo 'root write: no'; fi`,
      `if (echo '# x' >> ${q(path.join(root, ".git", "config"))}) 2>/dev/null; then echo 'git config write: yes'; else echo 'git config write: no'; fi`,
      `if (echo x > ${q(path.join(root, ".git", "hooks", "pre-commit"))}) 2>/dev/null; then echo 'hook create: yes'; else echo 'hook create: no'; fi`,
      `if cat ${q(path.join(root, ".git", "HEAD"))} >/dev/null 2>&1; then echo 'git HEAD read: yes'; else echo 'git HEAD read: no'; fi`,
      `if n=$(ls -A ${q(path.join(root, ".git"))} 2>/dev/null | wc -l); then echo "git dir list: $n entries"; else echo 'git dir list: no'; fi`,
      `out=$(git status --porcelain 2>&1); echo "git status exit: $?"; echo "git status out: $(echo $out | tr '\n' ' ')"`,
      `out=$(git -c user.email=t@t -c user.name=t commit -qam x 2>&1); echo "git commit exit: $?"; echo "git commit out: $(echo $out | head -c 200)"`,
      `if (mkdir -p ${q(later)} && echo x > ${q(path.join(later, "f"))}) 2>/dev/null; then echo 'later (read-only, absent at start) write: yes'; else echo 'later (read-only, absent at start) write: no'; fi`,
    ].join("\n");
    let output = "";
    const r = await ops.exec(script, root, { onData: (d: Buffer) => (output += d.toString()), timeout: 120 });
    console.log(`[${name}] exit: ${r.exitCode}`);
    for (const line of output.trim().split("\n")) console.log(`[${name}] ${line}`);
    console.log(`[${name}] ON DISK git config unchanged: ${(await readFile(path.join(root, ".git", "config"), "utf8")) === before}`);
    console.log(`[${name}] ON DISK hook exists: ${existsSync(path.join(root, ".git", "hooks", "pre-commit"))}`);
    console.log(`[${name}] ON DISK later/f exists: ${existsSync(path.join(later, "f"))}`);
    assert.match(output, /root write:/, "the command ran");
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
}
