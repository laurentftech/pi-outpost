/**
 * The agent's `bash` through a sandbox runner, against a fake runner.
 *
 * The fake runner is node itself: asked `run -p <policy> -- <shell> <script>`, node runs
 * the file named `run` in its working directory — the root — which records what it was
 * given and runs the "shell" (node again) on the script. So the command is JavaScript,
 * and every host, Windows included, can play the runner. What the real runners confine is
 * the real tests' job (`confinedBashMxc.test.ts`); this proves what pi-outpost asks of
 * them, and how it treats their answer.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";

const FAKE_RUNNER = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const policy = JSON.parse(fs.readFileSync(args[args.indexOf("-p") + 1], "utf8"));
const [shell, script] = args.slice(args.indexOf("--") + 1);
fs.writeFileSync(process.env.TMPDIR + "/../" + require("node:path").basename(process.env.TMPDIR) + ".record.json",
  JSON.stringify({ args, env: process.env, cwd: process.cwd(), policy, script: fs.readFileSync(script, "utf8") }));
const child = spawn(shell, [script], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
`;

describe("confinedBashOperations", () => {
  let base: string;
  let root: string;
  const ok = async () => ({ ok: true as const });

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "confined-bash-"));
    root = path.join(base, "app");
    await mkdir(path.join(root, "out"), { recursive: true });
    await writeFile(path.join(root, "run"), FAKE_RUNNER);
  });
  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function operations(overrides: Partial<Parameters<typeof confinedBashOperations>[0]> = {}) {
    return confinedBashOperations({
      runner: process.execPath,
      shell: process.execPath,
      root,
      writableRoot: path.join(root, "out"),
      allowWrite: true,
      agentDir: path.join(base, "agent"),
      configFile: path.join(base, "config.json"),
      check: ok,
      ...overrides,
    });
  }

  /** What the fake runner recorded for the last command: its temp dir sits in the OS temp dir. */
  async function lastRecord(): Promise<{ args: string[]; env: Record<string, string>; cwd: string; policy: { filesystem: Record<string, string[]> }; script: string }> {
    const { readdir, stat } = await import("node:fs/promises");
    const records = (await readdir(tmpdir())).filter((name) => name.startsWith("pi-outpost-bash-") && name.endsWith(".record.json"));
    const withTimes = await Promise.all(records.map(async (name) => ({ name, at: (await stat(path.join(tmpdir(), name))).mtimeMs })));
    const newest = withTimes.sort((a, b) => b.at - a.at)[0];
    assert.ok(newest, "the runner recorded nothing: it was never run");
    const record = JSON.parse(await readFile(path.join(tmpdir(), newest.name), "utf8"));
    await rm(path.join(tmpdir(), newest.name), { force: true });
    return record;
  }

  async function exec(command: string, options: { signal?: AbortSignal; timeout?: number; ops?: ReturnType<typeof operations>; cwd?: string } = {}) {
    let output = "";
    const result = await (options.ops ?? operations()).exec(command, options.cwd ?? root, {
      onData: (data) => {
        output += data.toString();
      },
      signal: options.signal,
      timeout: options.timeout,
    });
    return { output, exitCode: result.exitCode };
  }

  // openlore: scenario=OutputAndExitStatusComeBack spec=sandbox-runner-bash
  test("both outputs and the exit status come back, through the runner, with the terminal's policy", async () => {
    const { output, exitCode } = await exec(`process.stdout.write("to-out "); process.stderr.write("to-err"); process.exit(3);`);
    assert.equal(exitCode, 3);
    assert.match(output, /to-out/);
    assert.match(output, /to-err/);
    const record = await lastRecord();
    assert.deepEqual(record.args.slice(0, 2), ["-p", record.args[1]], "landstrip is asked to run under a policy file");
    assert.equal(record.args.at(-2), process.execPath, "the configured shell runs the command");
    assert.match(record.script, /to-out/, "the command reached the shell in a script file, unquoted");
    assert.ok(record.policy.filesystem.allowWrite.some((p) => p.replaceAll("\\", "/").endsWith("app/out")), "the writable zone is the sandbox's");
    const denied = record.policy.filesystem.denyRead.map((p) => p.replaceAll("\\", "/"));
    assert.ok(denied.some((p) => p.endsWith("/agent")) && denied.some((p) => p.endsWith("/config.json")), "the keys and the configuration are denied");
  });

  // openlore: scenario=KeysDoNotReachTheAgentsCommands spec=sandbox-runner-bash
  test("the server's keys do not reach the command; its home is the root", async () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-server-secret";
    try {
      const { output } = await exec(`console.log(JSON.stringify({ key: process.env.OPENAI_API_KEY ?? null, home: process.env.HOME }))`);
      const seen = JSON.parse(output.trim());
      assert.equal(seen.key, null);
      assert.equal(seen.home, root);
      assert.equal((await lastRecord()).env.OPENAI_API_KEY, undefined, "nor the runner's");
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = saved;
    }
  });

  test("a working directory outside the root starts the command in the root", async () => {
    await exec(`0`, { cwd: base });
    assert.equal(path.resolve((await lastRecord()).cwd), path.resolve(root));
  });

  // openlore: scenario=CancellingACommandEndsIt spec=sandbox-runner-bash
  test("an abort or a timeout ends the command and its runner, with pi's errors", async () => {
    const pidFile = path.join(root, "out", "sleeper.pid");
    const sleeper = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000);`;
    const controller = new AbortController();
    const started = Date.now();
    const aborted = exec(sleeper, { signal: controller.signal });
    while (!(await readFile(pidFile, "utf8").catch(() => ""))) await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await assert.rejects(aborted, /^Error: aborted$/);
    assert.ok(Date.now() - started < 20_000, "the call ended promptly");
    const pid = Number(await readFile(pidFile, "utf8"));
    // The shell under the runner, not only the runner, is gone.
    for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(pid), false, "the confined command still runs");
    await rm(pidFile);

    await assert.rejects(exec(sleeper, { timeout: 1 }), /^Error: timeout:1$/);
  });

  // openlore: scenario=AMissingRunnerRefusesTheCommand spec=sandbox-runner-bash
  test("a missing runner refuses the command with a reason naming it; nothing runs", async () => {
    const missing = path.join(base, "nowhere", "wxc-exec.exe");
    const marker = path.join(root, "out", "ran.txt");
    // The real self-check, not the fake: it is what finds the runner missing.
    await assert.rejects(
      exec(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`, { ops: operations({ runner: missing, check: undefined }) }),
      (error: Error) => error.message.includes(missing),
    );
    await assert.rejects(readFile(marker), "the command must not have run");
  });

  // openlore: scenario=AFailedSelfCheckRefusesTheCommand spec=sandbox-runner-bash
  test("a failed self-check refuses the command with the runner's reason; nothing runs", async () => {
    const marker = path.join(root, "out", "ran.txt");
    await assert.rejects(
      exec(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`, {
        ops: operations({ check: async () => ({ ok: false, reason: "landlock is not available" }) }),
      }),
      /landlock is not available/,
    );
    await assert.rejects(readFile(marker));
  });

  test("on Windows, no shell named is a refusal saying which one works", async () => {
    await assert.rejects(exec("0", { ops: operations({ shell: undefined, platform: "win32" }) }), /sandbox\.bashShell.*busybox/);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
