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
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { SandboxGrantOutcome } from "@pi-outpost/shared";
import { confinedBashOperations } from "../src/confinedBash.ts";
import type { EgressProxyOptions } from "../src/egressProxy.ts";

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

  test("a grant reaches the launch it was approved for, and the next launch without it is confined as before", async () => {
    const slashed = (paths: string[]) => paths.map((p) => p.replaceAll("\\", "/"));
    const beside = path.join(base, "beside");
    const notes = path.join(base, "notes");
    const ops = operations();
    const grant = { hosts: [], directories: [{ path: beside, access: "write" as const }, { path: notes, access: "read" as const }] };
    await ops.execWithGrant("0", root, { onData: () => {} }, grant);
    const granted = (await lastRecord()).policy.filesystem;
    assert.ok(slashed(granted.allowWrite).includes(slashed([beside])[0]), "the write grant is writable");
    assert.ok(slashed(granted.allowRead).includes(slashed([beside])[0]), "and readable");
    assert.ok(slashed(granted.allowRead).includes(slashed([notes])[0]), "the read grant is readable");
    assert.ok(!slashed(granted.allowWrite).includes(slashed([notes])[0]), "but not writable");

    await exec("0", { ops });
    const after = (await lastRecord()).policy.filesystem;
    for (const dir of slashed([beside, notes])) {
      assert.ok(!slashed(after.allowRead).includes(dir) && !slashed(after.allowWrite).includes(dir), `${dir} reached the next launch`);
    }
  });

  test("a session's grants reach every launch, read when each one starts", async () => {
    const slashed = (paths: string[]) => paths.map((p) => p.replaceAll("\\", "/"));
    const beside = path.join(base, "session-beside");
    let session = { hosts: [] as string[], directories: [] as Array<{ path: string; access: "read" | "write" }> };
    const ops = operations({ grants: () => session, allowWrite: false });
    await exec("0", { ops });
    assert.ok(!slashed((await lastRecord()).policy.filesystem.allowWrite).includes(slashed([beside])[0]));
    session = { hosts: [], directories: [{ path: beside, access: "write" }] };
    for (let i = 0; i < 2; i++) {
      await exec("0", { ops });
      // Writing off: the zone is gone, the user's grant is not.
      assert.ok(slashed((await lastRecord()).policy.filesystem.allowWrite).includes(slashed([beside])[0]), `launch ${i + 1}`);
    }
  });

  describe("with someone to ask, each command gets a proxy of its own that asks", () => {
    /** A proxy that records how it was started, and plays the connections given to it. */
    function proxies(connections: string[] = []) {
      const started: Array<{ allowedHosts: readonly string[]; closed: boolean }> = [];
      const start = async (proxyOptions: EgressProxyOptions) => {
        const entry = { allowedHosts: proxyOptions.allowedHosts, closed: false };
        started.push(entry);
        // The command connects while it runs: the proxy asks, as a real one would.
        for (const host of connections) await proxyOptions.ask?.(host);
        return { url: `http://127.0.0.1:${4000 + started.length}`, watchRefusals: () => () => {}, close: async () => void (entry.closed = true) };
      };
      return { started, start };
    }
    const base = { url: "http://127.0.0.1:3999", watchRefusals: () => () => {} };

    test("the list and the session's hosts, a proxy per command, closed after it", async () => {
      const spy = proxies();
      const ops = operations({ networkProxy: base, allowedHosts: ["registry.npmjs.org"], askHost: async () => "refused", startProxy: spy.start, grants: () => ({ hosts: ["github.com"], directories: [] }) });
      await exec("0", { ops });
      await exec("0", { ops });
      assert.deepEqual(spy.started, [
        { allowedHosts: ["registry.npmjs.org", "github.com"], closed: true },
        { allowedHosts: ["registry.npmjs.org", "github.com"], closed: true },
      ]);
    });

    test("each host asked about is named after the output with the user's answer; a refusal says not to retry", async () => {
      const asked: Array<{ command: string; host: string }> = [];
      const answers: Record<string, SandboxGrantOutcome> = { "example.com": "approved-once", "example.org": "refused" };
      const ops = operations({
        networkProxy: base,
        allowedHosts: [],
        askHost: async ({ command, host }) => (asked.push({ command, host }), answers[host]),
        startProxy: proxies(["example.com", "example.org", "127.0.0.1"]).start,
      });
      const { output } = await exec(`console.log("ran")`, { ops });
      assert.deepEqual(asked, [{ command: `console.log("ran")`, host: "example.com" }, { command: `console.log("ran")`, host: "example.org" }], "the forbidden one is never asked about");
      assert.match(output, /\[pi-outpost\] network: the user allowed example\.com for this command\./);
      assert.match(output, /\[pi-outpost\] network: the user refused example\.org\./);
      assert.match(output, /\[pi-outpost\] network: 127\.0\.0\.1 is never granted: a grant names a host by its name, never an IP address\./);
      assert.match(output, /Do not retry a refused host for this request: tell the user what it blocked\.\s*$/);
    });

    test("without someone to ask, the shared proxy refuses, and the note names the list", async () => {
      const spy = proxies();
      // The shared proxy refuses a host while the command runs: told to the launch's watcher.
      const shared = { url: base.url, watchRefusals: (listener: (host: string) => void) => (listener("example.com"), () => {}) };
      const ops = operations({ networkProxy: shared, allowedHosts: [], startProxy: spy.start });
      const { output } = await exec("0", { ops });
      assert.equal(spy.started.length, 0, "no proxy of its own");
      assert.match(output, /\[pi-outpost\] network refused: example\.com — not in sandbox\.allowedHosts\. Ask the user to add it there if the command needs it\.\s*$/);
    });
  });

  test("a working directory outside the root starts the command in the root", async () => {
    await exec(`0`, { cwd: base });
    // Compared resolved: the runner reads its directory back through the OS, which
    // answers with the real path — /private/var/… for /var/… on macOS.
    assert.equal(await realpath((await lastRecord()).cwd), await realpath(root));
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
