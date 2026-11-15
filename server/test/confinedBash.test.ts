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
import type { Refusal } from "../src/sandboxRefusals.ts";

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
  async function lastRecord(): Promise<{ args: string[]; env: Record<string, string>; cwd: string; policy: { filesystem: Record<string, string[]>; network?: unknown }; script: string }> {
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

  test("the always-allow directories reach every launch, read when each one starts", async () => {
    const slashed = (p: string) => p.replaceAll("\\", "/");
    const ruled = path.join(base, "ruled");
    let directories: Array<{ path: string; access: "read" | "write" }> = [{ path: ruled, access: "read" }];
    const ops = operations({ ruleGrant: async () => ({ hosts: [], directories }) });
    await exec("0", { ops });
    let policy = (await lastRecord()).policy.filesystem;
    assert.ok(policy.allowRead.map(slashed).includes(slashed(ruled)), "given");
    assert.ok(!policy.allowWrite.map(slashed).includes(slashed(ruled)), "read only");
    directories = [];
    await exec("0", { ops });
    policy = (await lastRecord()).policy.filesystem;
    assert.ok(!policy.allowRead.map(slashed).includes(slashed(ruled)), "a revoked rule is gone from the next launch");
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

  // openlore: scenario=ARefusedFileIsRecordedAgainstItsDirectory spec=sandbox-durable-rules
  test("landstrip's refusals are told once each, a file as its directory, while the agent still reads them in words", async () => {
    const told: Refusal[] = [];
    const line = JSON.stringify({ kind: "filesystem", code: "FILESYSTEM_DENIED", state: "info", operation: "read", path: "/home/u/other/secret.txt" });
    const command = `process.stderr.write(${JSON.stringify(`${line}\n${line}\n`)})`;
    const { output } = await exec(command, { ops: operations({ platform: "linux", onRefusal: (refusal) => told.push(refusal) }) });
    assert.deepEqual(told, [{ kind: "directory", target: "/home/u/other", access: "read", command }]);
    assert.match(output, /\[sandbox\] refused read \/home\/u\/other\/secret\.txt/);
    assert.doesNotMatch(output, /FILESYSTEM_DENIED/);
  });

  // openlore: scenario=TheOutputNamesTheRefusedDirectory spec=sandbox-durable-rules
  test("a command landstrip refused directories ends naming each one and its access, once", async () => {
    const line = (operation: string, file: string) => JSON.stringify({ kind: "filesystem", code: "FILESYSTEM_DENIED", state: "info", operation, path: file });
    const lines = [line("read", "/home/u/other/a.txt"), line("read", "/home/u/other/b.txt"), line("write", "/srv/data/out.txt")].join("\n");
    const { output } = await exec(`process.stderr.write(${JSON.stringify(`${lines}\n`)}); process.exit(1)`, { ops: operations({ platform: "linux" }) });
    assert.match(
      output,
      /\n\[pi-outpost\] the sandbox refused reading \/home\/u\/other\.\n\[pi-outpost\] the sandbox refused writing to \/srv\/data\.\n\[pi-outpost\] If the task needs one of these, ask run_with_grant for exactly it; judge the command by its exit status and output\.\n$/,
    );
    const quiet = await exec("process.exit(1)", { ops: operations({ platform: "linux" }) });
    assert.doesNotMatch(quiet.output, /the sandbox refused/, "nothing refused, nothing said");
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
    // landstrip holds a proxy on Linux only (on Windows the policy refuses one): the plumbing is
    // the same on every host, so it is played with the Linux policy everywhere.
    const LINUX_POLICY = { platform: "linux" as const };

    test("the list and the session's hosts, a proxy per command, closed after it", async () => {
      const spy = proxies();
      const ops = operations({ ...LINUX_POLICY, networkProxy: base, allowedHosts: ["registry.npmjs.org"], askHost: async () => "refused", startProxy: spy.start, grants: () => ({ hosts: ["github.com"], directories: [] }) });
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
        ...LINUX_POLICY,
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

    // openlore: scenario=ARefusedHostIsRecorded spec=sandbox-durable-rules
    test("each host refused is told once as a refusal: by the user, by the shared proxy, or as information when no rule could name it", async () => {
      const told: Refusal[] = [];
      const ops = operations({
        ...LINUX_POLICY,
        networkProxy: base,
        allowedHosts: [],
        askHost: async ({ host }) => (host === "example.com" ? "approved-once" : "refused"),
        startProxy: proxies(["example.com", "example.org", "Example.org", "127.0.0.1"]).start,
        onRefusal: (refusal) => told.push(refusal),
      });
      await exec(`console.log("ran")`, { ops });
      assert.deepEqual(told, [
        { kind: "host", target: "example.org", command: `console.log("ran")` },
        { kind: "info", target: "127.0.0.1", detail: "network: a grant names a host by its name, never an IP address", command: `console.log("ran")` },
      ]);

      const unasked: Refusal[] = [];
      const shared = { url: base.url, watchRefusals: (listener: (host: string) => void) => (listener("example.net"), listener("example.net"), () => {}) };
      await exec("0", { ops: operations({ ...LINUX_POLICY, networkProxy: shared, allowedHosts: [], onRefusal: (refusal) => unasked.push(refusal) }) });
      assert.deepEqual(unasked, [{ kind: "host", target: "example.net", command: "0" }]);
    });

    // openlore: scenario=ARefusedHostIsRefusedAtOnce spec=sandbox-durable-rules
    // openlore: scenario=AnAllowedHostIsNotAskedAbout spec=sandbox-durable-rules
    test("the user's rules answer before anyone is asked: refuse names the rule, allow lets it through unsaid; the forbidden stays forbidden", async () => {
      const asked: string[] = [];
      const decisions: Record<string, "allow" | "refuse"> = { "refused.example.com": "refuse", "allowed.example.com": "allow", "127.0.0.1": "allow" };
      const ops = operations({
        ...LINUX_POLICY,
        networkProxy: base,
        allowedHosts: [],
        askHost: async ({ host }) => (asked.push(host), "approved-once"),
        hostRule: async (host) => decisions[host],
        startProxy: proxies(["refused.example.com", "allowed.example.com", "asked.example.com", "127.0.0.1"]).start,
      });
      const { output } = await exec(`console.log("ran")`, { ops });
      assert.deepEqual(asked, ["asked.example.com"], "only the host no rule names is asked about");
      assert.match(output, /\[pi-outpost\] network: a rule of the user's always refuses refused\.example\.com: it is refused without asking, until the user revokes the rule\./);
      assert.doesNotMatch(output, /allowed\.example\.com/, "a host a rule allows is not mentioned");
      assert.match(output, /127\.0\.0\.1 is never granted/, "a rule cannot open what is never granted");
      assert.match(output, /Do not retry a refused host/);
    });

    // openlore: scenario=ARevokedRuleAsksAgain spec=sandbox-durable-rules
    test("a host rule revoked between two commands: the first is let through unasked, the next is asked again", async () => {
      const asked: string[] = [];
      let rule: "allow" | undefined = "allow";
      const ops = operations({
        ...LINUX_POLICY,
        networkProxy: base,
        allowedHosts: [],
        askHost: async ({ host }) => (asked.push(host), "refused"),
        hostRule: async () => rule,
        startProxy: proxies(["example.com"]).start,
      });
      await exec("0", { ops });
      assert.deepEqual(asked, [], "the rule answered");
      rule = undefined;
      await exec("0", { ops });
      assert.deepEqual(asked, ["example.com"], "revoked: asked, as before the rule existed");
    });

    test("without someone to ask, the shared proxy refuses, and the note names the list", async () => {
      const spy = proxies();
      // The shared proxy refuses a host while the command runs: told to the launch's watcher.
      const shared = { url: base.url, watchRefusals: (listener: (host: string) => void) => (listener("example.com"), () => {}) };
      const ops = operations({ ...LINUX_POLICY, networkProxy: shared, allowedHosts: [], startProxy: spy.start });
      const { output } = await exec("0", { ops });
      assert.equal(spy.started.length, 0, "no proxy of its own");
      assert.match(output, /\[pi-outpost\] network refused: example\.com — not in sandbox\.allowedHosts\. Ask the user to add it there if the command needs it\.\s*$/);
    });
  });

  test("under a proxy, landstrip's policy holds the network to its port and the command is told where it is", async () => {
    const spy: string[] = [];
    const start = async () => {
      spy.push("dedicated");
      return { url: "http://127.0.0.1:4101", watchRefusals: () => () => {}, close: async () => {} };
    };
    const shared = { url: "http://127.0.0.1:4100", watchRefusals: () => () => {} };
    // No one to ask: the shared proxy's port.
    await exec("0", { ops: operations({ platform: "linux", networkProxy: shared, allowedHosts: [], startProxy: start }) });
    let record = await lastRecord();
    assert.deepEqual(record.policy.network, { allowNetwork: false, allowLocalBinding: false, httpProxyPort: 4100 });
    // The fake runner reads its environment back through process.env, case-insensitive on Windows.
    const names = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", ...(process.platform === "win32" ? [] : ["https_proxy", "http_proxy", "all_proxy"])];
    for (const name of names) assert.equal(record.env[name], "http://127.0.0.1:4100", name);
    // Someone to ask: the command's own proxy, and its port alone.
    await exec("0", { ops: operations({ platform: "linux", networkProxy: shared, allowedHosts: [], askHost: async () => "refused", startProxy: start }) });
    record = await lastRecord();
    assert.deepEqual(spy, ["dedicated"]);
    assert.deepEqual(record.policy.network, { allowNetwork: false, allowLocalBinding: false, httpProxyPort: 4101 });
    assert.equal(record.env.HTTPS_PROXY, "http://127.0.0.1:4101");
    // No list: the network open and no proxy variable, as before.
    await exec("0", { ops: operations({ platform: "linux" }) });
    record = await lastRecord();
    assert.deepEqual(record.policy.network, { allowNetwork: true });
    assert.equal(record.env.HTTPS_PROXY, undefined);
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
    // Not one of MXC's executors: a path to one of those is read as "mxc", which runs in process.
    const missing = path.join(base, "nowhere", "landstrip.exe");
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
