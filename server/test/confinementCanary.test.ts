/**
 * The confinement canary: what it tries, how it judges, and that it tells a confined runner from
 * one that confines nothing. The real-runner half runs where `SEATBELT_EXEC` (macOS) or
 * `MXC_LXC_EXEC` with `MXC_LINUX_EXPECT=confined` (the Linux container) names one.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { canaryScript, expectedAttempts, prepareBait, readCanary, runCanary } from "../src/confinementCanary.ts";

const base = { runner: "/r", checkedAt: "2026-10-18T00:00:00.000Z", notChecked: [] };

describe("readCanary", () => {
  const expected = ["agent-directory", "beside-root", "write-beside-root", "signal-process", "server-environment"] as const;
  const lines = (outcome: string) => expected.map((attempt) => `PI_OUTPOST_CANARY ${attempt} ${outcome}`).join("\n");

  test("every attempt refused is verified, in order", () => {
    const verdict = readCanary(lines("refused"), expected, {}, base);
    assert.deepEqual(verdict, { state: "verified", ...base, refused: [...expected], notChecked: [] });
  });

  test("one attempt through is leaking, and names it", () => {
    const output = lines("refused").replace("agent-directory refused", "agent-directory reached");
    const verdict = readCanary(output, expected, {}, base);
    assert.equal(verdict.state, "leaking");
    assert.deepEqual(verdict.state === "leaking" && verdict.reached, ["agent-directory"]);
  });

  test("the host decides the write and the signal, whatever the command said", () => {
    const fooled = readCanary(lines("refused"), expected, { wroteBeside: true, victimAlive: false }, base);
    assert.deepEqual(fooled.state === "leaking" && fooled.reached, ["write-beside-root", "signal-process"]);
    // Bubblewrap may accept a write in its private tmpfs: the host saw nothing land.
    const tmpfs = readCanary(lines("reached").replace(/agent-directory reached|beside-root reached|server-environment reached/g, (m) => m.replace("reached", "refused")), expected, { wroteBeside: false, victimAlive: true }, base);
    assert.equal(tmpfs.state, "verified");
  });

  test("a missing report fails the canary instead of passing it", () => {
    const verdict = readCanary(lines("refused").replace(/.*server-environment.*/, "bash: something broke"), expected, {}, base);
    assert.equal(verdict.state, "failed");
    assert.match(verdict.state === "failed" ? verdict.reason : "", /did not report "server-environment".*something broke/);
  });

  test("an attempt the shell cannot make is not checked, not refused", () => {
    const verdict = readCanary("PI_OUTPOST_CANARY server-environment refused\nPI_OUTPOST_CANARY unlisted-host unchecked", ["server-environment", "unlisted-host"], {}, base);
    assert.equal(verdict.state, "verified");
    assert.deepEqual(verdict.state === "verified" && verdict.notChecked.map((n) => n.attempt), ["unlisted-host"]);
  });
});

describe("prepareBait", () => {
  test("bait in the agent directory and beside the root, removed afterwards", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "canary-agent-"));
    const root = await mkdtemp(path.join(tmpdir(), "canary-root-"));
    try {
      const bait = await prepareBait({ agentDir: home, root });
      assert.ok(bait.agentMarker && existsSync(bait.agentMarker));
      assert.ok(bait.besideDir && existsSync(path.join(bait.besideDir, "marker")));
      assert.equal(process.env[bait.envName], bait.envValue);
      assert.deepEqual(bait.notChecked, []);
      await bait.cleanup();
      assert.ok(!existsSync(bait.agentMarker!));
      assert.ok(!existsSync(bait.besideDir!));
      assert.equal(process.env[bait.envName], undefined);
      assert.deepEqual(await readdir(home), [], "nothing left in the agent directory");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a root holding the system's temporary directory leaves the beside-the-root attempts not checked", async () => {
    const bait = await prepareBait({ root: path.parse(tmpdir()).root });
    try {
      assert.equal(bait.besideDir, undefined);
      assert.deepEqual(bait.notChecked.map((n) => n.attempt), ["agent-directory", "beside-root", "write-beside-root"]);
      assert.deepEqual(expectedAttempts(bait, { proxied: false }), ["signal-process", "server-environment"]);
    } finally {
      await bait.cleanup();
    }
  });
});

// openlore: scenario=ALeakOpensTheLockAndSaysWhat spec=sandbox-runner-bash
describe("a runner that confines nothing", { skip: process.platform === "win32" && "a POSIX shell" }, () => {
  test("ALeakOpensTheLockAndSaysWhat: every attempt is reached, and named", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "canary-agent-"));
    const root = await mkdtemp(path.join(tmpdir(), "canary-root-"));
    try {
      // The command runs as the server would run it unconfined: its environment included.
      const exec = (command: string) =>
        new Promise<string>((resolve) => execFile("/bin/sh", ["-c", command], { env: process.env, cwd: root }, (_error, stdout) => resolve(stdout)));
      const verdict = await runCanary({ runner: "/bin/sh", agentDir: home, root, powerShell: false, proxied: false, exec });
      assert.equal(verdict.state, "leaking", JSON.stringify(verdict));
      assert.deepEqual(verdict.state === "leaking" && verdict.reached, ["agent-directory", "beside-root", "write-beside-root", "signal-process", "server-environment"]);
      assert.deepEqual(await readdir(home), [], "the bait was removed");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the PowerShell canary reports the same attempts", () => {
    const script = canaryScript({ id: "x", agentMarker: "/a/m", besideDir: "/b", envName: "PI_OUTPOST_CANARY_X", envValue: "v", notChecked: [], cleanup: async () => {} }, { powerShell: true, proxied: true, serverPid: 1 });
    for (const attempt of ["agent-directory", "beside-root", "write-beside-root", "server-environment", "unlisted-host", "direct-connection"]) {
      assert.match(script, new RegExp(`^R ${attempt} `, "m"), attempt);
    }
  });
});

const SEATBELT = process.platform === "darwin" ? process.env.SEATBELT_EXEC : undefined;
const LXC = process.platform === "linux" && process.env.MXC_LINUX_EXPECT === "confined" ? process.env.MXC_LXC_EXEC : undefined;
const REAL = SEATBELT ?? LXC;

// openlore: scenario=AVerifiedRunnerEarnsTheLock spec=sandbox-runner-bash
describe("a real runner", { skip: !REAL && "SEATBELT_EXEC (macOS) or MXC_LXC_EXEC with MXC_LINUX_EXPECT=confined (Linux) names none" }, () => {
  let dir: string;
  let root: string;
  let agentDir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "canary-real-"));
    root = path.join(dir, "app");
    agentDir = path.join(dir, "agent");
    await mkdir(root);
    await mkdir(agentDir);
    await writeFile(path.join(agentDir, "auth.json"), "{}");
  });
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("AVerifiedRunnerEarnsTheLock: every attempt is refused through the runner's own path", async () => {
    const ops = confinedBashOperations({ runner: REAL!, root, allowWrite: true, agentDir });
    const exec = async (command: string) => {
      let output = "";
      await ops.exec(command, root, { onData: (data) => (output += data.toString()) });
      return output;
    };
    const verdict = await runCanary({ runner: REAL!, agentDir, root, powerShell: false, proxied: false, exec });
    assert.equal(verdict.state, "verified", JSON.stringify(verdict));
    assert.deepEqual(verdict.state === "verified" && verdict.refused, ["agent-directory", "beside-root", "write-beside-root", "signal-process", "server-environment"]);
    assert.deepEqual(await readdir(agentDir), ["auth.json"], "the bait was removed");
  });
});
