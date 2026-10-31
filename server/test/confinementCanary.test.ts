/**
 * The confinement canary: what it tries, how it judges, and that it tells a confined runner from
 * one that confines nothing. The real-runner half runs where `SEATBELT_EXEC` (macOS) or
 * `MXC_LXC_EXEC` with `MXC_LINUX_EXPECT=confined` (the Linux container) names one.
 */
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations, POWERSHELL_SCRIPT_ARGS, powerShellScript } from "../src/confinedBash.ts";
import { shellIsConfined } from "../src/confinementStatus.ts";
import { canaryScript, expectedAttempts, prepareBait, readCanary, runCanary, secretVariables, serverEnvironment } from "../src/confinementCanary.ts";

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

  // openlore: scenario=AReadableEnvironmentWithoutSecretsKeepsTheLock spec=sandbox-runner-bash
  test("AReadableEnvironmentWithoutSecretsKeepsTheLock: only the server's process environment readable, and it holds no secret", () => {
    const all = [...expected, "server-process-environment"] as const;
    const output = `${lines("refused")}\nPI_OUTPOST_CANARY server-process-environment reached`;
    const verdict = readCanary(output, all, { serverSecrets: [] }, base);
    assert.equal(verdict.state, "verified");
    assert.equal(verdict.state === "verified" && verdict.environmentReadable, true);
  });

  // openlore: scenario=SecretsInAReadableEnvironmentAreNamed spec=sandbox-runner-bash
  test("SecretsInAReadableEnvironmentAreNamed: partial, naming the variables; anything else reached stays a leak", () => {
    const all = [...expected, "server-process-environment"] as const;
    const output = `${lines("refused")}\nPI_OUTPOST_CANARY server-process-environment reached`;
    const partial = readCanary(output, all, { serverSecrets: ["OPENAI_API_KEY"] }, base);
    assert.equal(partial.state, "partial");
    assert.deepEqual(partial.state === "partial" && partial.exposed, ["OPENAI_API_KEY"]);
    const worse = readCanary(output.replace("agent-directory refused", "agent-directory reached"), all, { serverSecrets: [] }, base);
    assert.deepEqual(worse.state === "leaking" && worse.reached, ["agent-directory", "server-process-environment"]);
  });

  test("secret-looking names only, by name, non-empty, never the canary's own marker", () => {
    assert.deepEqual(
      secretVariables({ OPENAI_API_KEY: "sk", PI_OUTPOST_TOKEN: "t", GITHUB_TOKEN: "", DB_PASSWORD: "p", HOME: "/h", PATH: "/bin", PI_OUTPOST_CANARY_AB: "x", AWS_SECRET_ACCESS_KEY: "s" }),
      ["AWS_SECRET_ACCESS_KEY", "DB_PASSWORD", "OPENAI_API_KEY", "PI_OUTPOST_TOKEN"],
    );
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
      assert.deepEqual(expectedAttempts(bait, { proxied: false }), ["signal-process", "server-environment", "server-process-environment"]);
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
      // The server's process environment is readable where there is a /proc (Linux).
      const proc = process.platform === "linux" ? (["server-process-environment"] as const) : [];
      assert.deepEqual(verdict.state === "leaking" && verdict.reached, ["agent-directory", "beside-root", "write-beside-root", "signal-process", "server-environment", ...proc]);
      assert.deepEqual(await readdir(home), [], "the bait was removed");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

});

test("the PowerShell canary reports the same attempts", () => {
  const script = canaryScript({ id: "x", agentMarker: "/a/m", besideDir: "/b", envName: "PI_OUTPOST_CANARY_X", envValue: "v", notChecked: [], cleanup: async () => {} }, { powerShell: true, proxied: true, serverPid: 1 });
  for (const attempt of ["agent-directory", "beside-root", "write-beside-root", "server-environment", "unlisted-host", "direct-connection"]) {
    // A subexpression: `try` in plain parentheses is read as a command named "try".
    assert.match(script, new RegExp(`^Report-Canary ${attempt} \\$\\(`, "m"), attempt);
  }
  assert.match(script, /^function Report-Canary\(/m);
  // `r` is Invoke-History's alias, and an alias outranks a function.
  assert.doesNotMatch(script, /\bR\b/);
});

/** The PowerShells this machine has: Windows PowerShell on Windows, and PowerShell 7 wherever it is installed. */
const PWSH = process.platform === "win32" ? "pwsh.exe" : "pwsh";
const POWERSHELLS = [
  ...(process.platform === "win32" ? ["powershell.exe"] : []),
  ...(spawnSync(PWSH, ["-NoProfile", "-Command", "exit 0"], { windowsHide: true }).status === 0 ? [PWSH] : []),
];

describe("a PowerShell that confines nothing", { skip: POWERSHELLS.length === 0 && "no PowerShell on this machine" }, () => {
  const unconfined = (run: (shell: string, command: string, root: string) => Promise<string>) => async () => {
    for (const shell of POWERSHELLS) {
      const home = await mkdtemp(path.join(tmpdir(), "canary-agent-"));
      const root = await mkdtemp(path.join(tmpdir(), "canary-root-"));
      try {
        const verdict = await runCanary({ runner: shell, agentDir: home, root, powerShell: true, proxied: false, exec: (command) => run(shell, command, root) });
        assert.equal(verdict.state, "leaking", `${shell}: ${JSON.stringify(verdict)}`);
        assert.deepEqual(verdict.state === "leaking" && verdict.reached, ["agent-directory", "beside-root", "write-beside-root", "signal-process", "server-environment"], shell);
      } finally {
        await rm(home, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    }
  };
  const output = (shell: string, args: string[], cwd: string) =>
    new Promise<string>((resolve) => execFile(shell, args, { env: process.env, cwd, windowsHide: true }, (_error, stdout, stderr) => resolve(`${stdout}${stderr}`)));

  test("every attempt is reported through the agent's shell: a .ps1 script", unconfined(async (shell, command, root) => {
    const script = path.join(root, "command.ps1");
    await writeFile(script, powerShellScript(command));
    return output(shell, [...POWERSHELL_SCRIPT_ARGS, script], root);
  }));

  test("every attempt is reported through the terminal: one line, -Command", unconfined((shell, command, root) => {
    const oneLine = command.split(/\r?\n/).filter(Boolean).join("; ");
    return output(shell, ["-NoProfile", "-NonInteractive", "-Command", oneLine], root);
  }));
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
    assert.deepEqual(verdict.state === "verified" && verdict.refused, ["agent-directory", "beside-root", "write-beside-root", "signal-process", "server-environment", "server-process-environment"]);
    assert.ok(verdict.state === "verified" && !verdict.environmentReadable, "the runner hides the server's process");
    assert.deepEqual(await readdir(agentDir), ["auth.json"], "the bait was removed");
  });
});

const LANDSTRIP = process.platform === "linux" ? process.env.LANDSTRIP_BIN : undefined;

// openlore: scenario=AReadableEnvironmentWithoutSecretsKeepsTheLock spec=sandbox-runner-bash
describe("landstrip, whose commands can read the server's /proc environ", { skip: !LANDSTRIP && "LANDSTRIP_BIN is not set (CI's Linux job sets it)" }, () => {
  test("the server's process environment reads as readable, and the verdict follows what it holds", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "canary-landstrip-"));
    const root = path.join(dir, "app");
    const agentDir = path.join(dir, "agent");
    await mkdir(root);
    await mkdir(agentDir);
    try {
      const ops = confinedBashOperations({ runner: LANDSTRIP!, root, allowWrite: true, agentDir });
      const exec = async (command: string) => {
        let output = "";
        await ops.exec(command, root, { onData: (data) => (output += data.toString()) });
        return output;
      };
      const verdict = await runCanary({ runner: LANDSTRIP!, agentDir, root, powerShell: false, proxied: false, exec });
      const secrets = secretVariables(await serverEnvironment());
      if (secrets.length === 0) {
        assert.equal(verdict.state, "verified", JSON.stringify(verdict));
        assert.equal(verdict.state === "verified" && verdict.environmentReadable, true, "landstrip leaves /proc/<pid>/environ readable");
      } else {
        assert.equal(verdict.state, "partial", JSON.stringify(verdict));
        assert.deepEqual(verdict.state === "partial" && verdict.exposed, secrets);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// openlore: scenario=NoRunnerNoLock spec=sandbox-runner-bash
test("NoRunnerNoLock: the shell is judged only with bash allowed, a runner, and no extension running it", () => {
  const base = { root: "/w", allowWrite: true, readExceptions: [] } as never as Parameters<typeof shellIsConfined>[0] & object;
  assert.equal(shellIsConfined({ ...base, allowBash: true, bashRunner: "/usr/bin/sandbox-exec" }), true);
  assert.equal(shellIsConfined({ ...base, allowBash: false, bashRunner: "/usr/bin/sandbox-exec" }), false, "no bash, no lock");
  assert.equal(shellIsConfined({ ...base, allowBash: true }), false, "no runner, no lock");
  assert.equal(shellIsConfined({ ...base, allowBash: true, bashRunner: "/r", bashFrom: "npm:pi-landstrip" }), false, "an extension runs bash");
  assert.equal(shellIsConfined(undefined), false);
});
