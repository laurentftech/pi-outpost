/**
 * `sandbox.bashRunner`: the agent's own `bash`, every command run inside a sandbox runner.
 *
 * These run the real server and the real agent: a provider makes the agent call `bash`,
 * and the tool result the model receives says what ran and how.
 *
 * The fake runner is node itself (see `confinedBash.test.ts`): asked `doctor`, a file the
 * server preloads into every node it starts answers ok (`fake-runner-doctor.cjs`); asked
 * `run -p … -- <shell> <script>`, node runs the project's `run` file — commands start in
 * the root — which says it is the runner and runs the "shell" (node) on the script. The
 * command is therefore JavaScript. The real runner runs where `MXC_EXEC` and `MXC_SHELL`
 * are set.
 */
import assert from "node:assert/strict";
import { readFile, realpath, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/bash-call-provider.mjs", import.meta.url));
const MODEL = { provider: "bash-call-test", id: "bash-call-test" };

const DOCTOR = fileURLToPath(new URL("./fixtures/fake-runner-doctor.cjs", import.meta.url));
const FAKE_RUN = `
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const [shell, script] = args.slice(args.indexOf("--") + 1);
process.stdout.write("via-the-runner\\n");
spawn(shell, [script], { stdio: "inherit", env: process.env }).on("exit", (code) => process.exit(code ?? 1));
`;

async function waitForFile(file, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await readFile(file, "utf8").catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${path.basename(file)} never written`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Starts a server, has the agent call `bash` once with `command`, and returns the tool result. */
async function runBash(t, { project, sandbox, command, afterHello, fake = true }) {
  const log = path.join(path.dirname(project), `${path.basename(project)}-bash-result.json`);
  const server = await startServer(
    project,
    { sandbox: { root: project, allowWrite: true, allowBash: true, ...sandbox }, extensionPaths: [PROVIDER], allowedModels: [MODEL] },
    {
      env: {
        BASH_CALL_LOG: log,
        BASH_CALL_COMMAND: command,
        OPENAI_API_KEY: "sk-server-secret",
        // The server's own environment only: a confined command gets a minimal one.
        // Forward slashes: NODE_OPTIONS reads a backslash inside quotes as an escape.
        ...(fake ? { NODE_OPTIONS: `--require "${DOCTOR.replaceAll("\\", "/")}"` } : {}),
      },
    },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 30_000);
  if (afterHello) await afterHello(client);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "Run the shell." });
  try {
    return { hello, server, result: await waitForFile(log) };
  } catch (error) {
    // What the server said instead, for whoever reads the failure.
    const said = client.received.filter((m) => /error|refus|agent_end|turn_end/.test(m.type)).map((m) => `${m.type}: ${m.message ?? ""}`);
    throw new Error(`${error.message}; the server said: ${said.join(" | ") || "nothing relevant"}`);
  }
}

async function fakeProject() {
  const project = await realpath(await makeWorkspace());
  await writeFile(path.join(project, "run"), FAKE_RUN);
  return project;
}

const PRINT = `console.log("from-the-shell key=" + (process.env.OPENAI_API_KEY ?? "none"))`;

test("the agent's bash runs through the named runner, without the server's keys", async (t) => {
  const project = await fakeProject();
  const { hello, server, result } = await runBash(t, {
    project,
    sandbox: { bashRunner: process.execPath, bashShell: process.execPath },
    command: PRINT,
  });
  assert.ok(hello.tools.some((tool) => tool.name === "bash" && tool.active), "bash is active");
  // The startup line an operator reads names the runner, and does not cry "UNCONFINED".
  assert.match(server.log(), /bash \(confined by /);
  assert.doesNotMatch(server.log(), /bash \(UNCONFINED\)/);
  assert.match(result, /via-the-runner/, `the command did not go through the runner: ${result}`);
  assert.match(result, /from-the-shell key=none/, "the command ran, without OPENAI_API_KEY");
});

// openlore: scenario=ApplyingSettingsKeepsTheRunner spec=sandbox-runner-bash
test("ApplyingSettingsKeepsTheRunner: a Settings apply leaves bash in the runner", async (t) => {
  const project = await fakeProject();
  const { result } = await runBash(t, {
    project,
    sandbox: { bashRunner: process.execPath, bashShell: process.execPath },
    command: PRINT,
    // A Settings apply rebuilds the sandbox and the session from what the browser sends,
    // which carries no bashRunner.
    afterHello: async (client) => {
      client.send({ type: "update_config", sandbox: { root: project, allowWrite: false, allowBash: true } });
      const ack = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error", 30_000);
      assert.equal(ack.type, "update_config_ack", ack.message);
    },
  });
  assert.match(result, /via-the-runner/, "the rebuilt session's bash runs unconfined");
});

// openlore: scenario=AMissingRunnerRefusesTheCommand spec=sandbox-runner-bash
test("a missing runner: the session starts, and bash refuses with a reason naming the path", async (t) => {
  const project = await fakeProject();
  const missing = path.join(project, "nowhere", "wxc-exec.exe");
  const { result } = await runBash(t, {
    project,
    sandbox: { bashRunner: missing, bashShell: process.execPath },
    command: PRINT,
  });
  assert.ok(result.includes(JSON.stringify(missing).slice(1, -1)) || result.includes(missing), result);
  assert.doesNotMatch(result, /from-the-shell/, "the command ran anyway");
});

const MXC = process.env.MXC_EXEC;
const BUSYBOX = process.env.MXC_SHELL;
const realSkip = process.platform !== "win32" ? "MXC confines on Windows only" : !MXC || !BUSYBOX ? "MXC_EXEC and MXC_SHELL are not both set" : false;

// openlore: scenario=ACommandCannotReadOutsideTheRoot spec=sandbox-runner-bash
test("under MXC, the agent's bash cannot read beside the root, runs git, and holds no key", { skip: realSkip }, async (t) => {
  const base = await realpath(await makeWorkspace());
  const project = path.join(base, "app");
  await mkdir(project);
  await mkdir(path.join(base, "other"));
  await writeFile(path.join(base, "other", "secret.txt"), "other-secret");
  const secret = path.join(base, "other", "secret.txt").replaceAll("\\", "/");
  const { result } = await runBash(t, {
    project,
    sandbox: { bashRunner: MXC, bashShell: BUSYBOX },
    fake: false,
    command: `cat "${secret}"; echo "exit=$?"; git init -q . && git rev-parse --is-inside-work-tree; env | grep -c OPENAI_API_KEY`,
  });
  assert.doesNotMatch(result, /other-secret/, "a file beside the root was read");
  assert.match(result, /Permission denied/);
  assert.match(result, /exit=1/);
  assert.match(result, /true/, "git did not run in the root");
  assert.match(result, /(^|\\n)0(\\n|")/, "OPENAI_API_KEY reached the command");
});
