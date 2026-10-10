/**
 * The agent's `bash` under MXC's real executor (Windows 11, tier 1) and busybox-w32.
 *
 * `confinedBash.test.ts` fakes the runner; this one runs the operations pi-outpost hands
 * to pi's `bash` through `wxc-exec.exe`, with busybox as `sandbox.bashShell`, and checks
 * from the command's side what the scenarios promise.
 *
 * Only where `MXC_EXEC` names the executor and `MXC_SHELL` busybox's `sh.exe`, and the
 * probe reports tier 1: no CI runner has Windows 11 with the August 2026 update yet.
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
const SHELL = process.env.MXC_SHELL;
const skip =
  process.platform !== "win32"
    ? "MXC confines on Windows only"
    : !RUNNER || !SHELL
      ? "MXC_EXEC (wxc-exec.exe) and MXC_SHELL (busybox-w32's sh.exe) are not both set"
      : false;

describe("the agent's bash under MXC's real executor", { skip }, () => {
  let base: string;
  let root: string;
  let out: string;
  let agentDir: string;
  const savedKey = process.env.OPENAI_API_KEY;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "confined-bash-mxc-"));
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

  async function bash(command: string, options: { writableRoot?: string; signal?: AbortSignal; timeout?: number; gitConfig?: string } = {}) {
    const ops = confinedBashOperations({
      runner: RUNNER!,
      shell: SHELL!,
      root,
      ...(options.writableRoot ? { writableRoot: options.writableRoot } : {}),
      allowWrite: true,
      agentDir,
      ...(options.gitConfig ? { gitConfig: options.gitConfig } : {}),
    });
    let output = "";
    const { exitCode } = await ops.exec(command, root, {
      onData: (data) => {
        output += data.toString();
      },
      signal: options.signal,
      timeout: options.timeout,
    });
    return { output, exitCode };
  }
  const slash = (p: string) => p.replaceAll("\\", "/");

  // openlore: scenario=ACommandCannotReadOutsideTheRoot spec=sandbox-runner-bash
  test("reads outside the root are refused, and nothing of them comes back", async () => {
    const sibling = await bash(`cat "${slash(path.join(base, "other", "secret.txt"))}"`);
    assert.notEqual(sibling.exitCode, 0);
    assert.match(sibling.output, /Permission denied/);
    assert.doesNotMatch(sibling.output, /other-secret/);
    const keys = await bash(`cat "${slash(path.join(agentDir, "auth.json"))}"`);
    assert.notEqual(keys.exitCode, 0);
    assert.doesNotMatch(keys.output, /sk-agent-secret/);
  });

  // openlore: scenario=ACommandWritesOnlyInTheWritableZone spec=sandbox-runner-bash
  test("writes land in the writable zone and are refused elsewhere in the root", async () => {
    const zone = await bash(`echo inside > "${slash(path.join(out, "a.txt"))}" && echo wrote`, { writableRoot: out });
    assert.equal(zone.exitCode, 0, zone.output);
    assert.equal((await readFile(path.join(out, "a.txt"), "utf8")).trim(), "inside");
    const elsewhere = await bash(`echo outside > "${slash(path.join(root, "b.txt"))}"`, { writableRoot: out });
    assert.notEqual(elsewhere.exitCode, 0);
    await assert.rejects(readFile(path.join(root, "b.txt")));
  });

  // openlore: scenario=OutputAndExitStatusComeBack spec=sandbox-runner-bash
  test("both outputs and the exit status come back; pipes, /dev/null and git work", async () => {
    const result = await bash(`echo to-out; echo to-err >&2; ls missing 2>/dev/null; printf 'b\\na\\n' | sort | head -1; git rev-parse --is-inside-work-tree; exit 3`);
    assert.equal(result.exitCode, 3);
    assert.match(result.output, /to-out/);
    assert.match(result.output, /to-err/);
    assert.match(result.output, /^a$/m, "a pipe ran");
    assert.match(result.output, /^true$/m, "git found its work tree");
  });

  // openlore: scenario=CancellingACommandEndsIt spec=sandbox-runner-bash
  test("an abort or a timeout ends the confined command promptly", async () => {
    const shells = () => execFileSync("tasklist", ["/FI", "IMAGENAME eq sh.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" }).split(/\r?\n/).filter((l) => l.includes("sh.exe")).length;
    const before = shells();
    const controller = new AbortController();
    const started = Date.now();
    const running = bash("sleep 60", { signal: controller.signal });
    setTimeout(() => controller.abort(), 1500);
    await assert.rejects(running, /^Error: aborted$/);
    assert.ok(Date.now() - started < 15_000, "the call ended promptly");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(shells(), before, "a confined sh.exe outlived its call");
    await assert.rejects(bash("sleep 60", { timeout: 2 }), /^Error: timeout:2$/);
  });

  // openlore: scenario=TheAgentsCommitsCarryTheUsersIdentity spec=sandbox-runner-bash
  test("git commits with the user's identity, read from their .gitconfig, which stays unwritable; npm has a cache", async () => {
    // Outside the root, like the real ~/.gitconfig: readable on its own, nothing beside it.
    const gitConfig = path.join(base, "user.gitconfig");
    await writeFile(gitConfig, "[user]\n\tname = Sandbox Tester\n\temail = tester@example.com\n[commit]\n\tgpgsign = false\n");
    const gc = slash(gitConfig);
    const result = await bash(
      `git commit -q --allow-empty -m from-the-sandbox && git log -1 --format='author=%an <%ae>'; ` +
        `echo tampered >> "${gc}"; echo "append-exit=$?"; cat "${slash(path.join(base, "other", "secret.txt"))}" >/dev/null 2>&1; echo "beside-exit=$?"; ` +
        `echo "cache=$(npm config get cache)"`,
      { gitConfig },
    );
    assert.match(result.output, /^author=Sandbox Tester <tester@example\.com>$/m, result.output);
    assert.match(result.output, /^append-exit=[1-9]/m, "the git configuration was writable");
    assert.doesNotMatch(await readFile(gitConfig, "utf8"), /tampered/);
    assert.match(result.output, /^beside-exit=[1-9]/m, "opening the git configuration opened its folder");
    assert.match(result.output, /^cache=.*pi-outpost-bash-.*npm-cache$/m, "npm's cache is not in the private temp");
  });

  // openlore: scenario=KeysDoNotReachTheAgentsCommands spec=sandbox-runner-bash
  test("the server's keys are not in the command's environment", async () => {
    const result = await bash(`env`);
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.output, /OPENAI_API_KEY|sk-server-secret/);
    assert.match(result.output, new RegExp(`^HOME=${slash(root).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "mi"));
  });
});
