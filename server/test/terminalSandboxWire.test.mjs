/**
 * The confined terminal, as a client meets it.
 *
 * `terminal.sandbox` names a runner every terminal must run inside. The question these
 * answer is the one the setting exists for: when that runner cannot confine anything —
 * missing, or failing its own self-check — does the server refuse the terminal, or does
 * it quietly hand out the unconfined shell the deployment asked never to see?
 *
 * The fake runner records every invocation, so "no shell was spawned" is observed, not
 * inferred from the absence of output.
 */
import assert from "node:assert/strict";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

// The fake runner is a script with a shebang: Windows cannot execute one directly, and
// confinement is a Linux feature anyway. The missing-runner case runs everywhere.
const POSIX = process.platform !== "win32";

const openTerminal = async (client, terminalId) => {
  client.send({ type: "terminal_open", terminalId, cols: 80, rows: 24 });
  return client.waitFor(
    (m) => (m.type === "terminal_error" || m.type === "terminal_data" || m.type === "terminal_exit") && m.terminalId === terminalId,
  );
};

/** Open until the start-up self-check has answered: before that the refusal says "still being checked". */
const openAfterCheck = async (client, prefix) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const answer = await openTerminal(client, `${prefix}-${attempt}`);
    if (!(answer.type === "terminal_error" && /still being checked/.test(answer.message))) return answer;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the runner self-check never finished");
};

/** A runner that logs how it was called and answers `doctor` as told. */
async function fakeRunner(dir, doctor) {
  const log = path.join(dir, "runner-calls.log");
  const runner = path.join(dir, "fake-landstrip");
  await writeFile(
    runner,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "doctor") {
  ${doctor}
}
`,
  );
  await chmod(runner, 0o755);
  return { runner, calls: async () => (await readFile(log, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) };
}

// openlore: scenario=ARunnerThatFailsItsSelfCheck spec=terminal
test("a runner that fails its self-check means no terminal, with its reason, and no shell", { skip: !POSIX && "fake runner needs a shebang" }, async (t) => {
  const root = await makeWorkspace();
  const { runner, calls } = await fakeRunner(root, `process.stdout.write(JSON.stringify({ ok: false, error: "landlock unavailable" }) + "\\n"); process.exit(1);`);
  const server = await startServer(root, { sandbox: undefined, terminal: { enabled: true, sandbox: runner } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  const answer = await openAfterCheck(client, "probe");
  assert.equal(answer.type, "terminal_error");
  assert.match(answer.message, /self-check|cannot be sandboxed/);
  assert.match(answer.message, /landlock unavailable/, "the runner's own reason must reach the user");

  // A refusal is not a shell: nothing answers input, and the runner ran only its check.
  client.send({ type: "terminal_input", terminalId: "probe-0", data: "echo reached-a-shell\r" });
  await assert.rejects(client.waitFor((m) => m.type === "terminal_data", 1_500));
  assert.deepEqual(await calls(), [["doctor"]], "the runner was asked to run something besides its self-check");

  // And a client connecting now is told up front, so the panel can say why.
  const late = connect(server.wsUrl());
  t.after(() => late.close());
  const hello = await late.waitFor((m) => m.type === "hello");
  const state = hello.state ?? hello;
  assert.equal(state.terminal.confined, true);
  assert.match(state.terminal.unavailable, /landlock unavailable/);
});

// openlore: scenario=AMissingRunner spec=terminal
test("a runner that does not exist means no terminal, with a reason naming the path", async (t) => {
  const root = await makeWorkspace();
  const missing = path.join(root, "no", "such", "landstrip");
  const server = await startServer(root, { sandbox: undefined, terminal: { enabled: true, sandbox: missing } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  const answer = await openAfterCheck(client, "probe");
  assert.equal(answer.type, "terminal_error");
  assert.ok(answer.message.includes(missing), `the reason must name ${missing}: ${answer.message}`);
  client.send({ type: "terminal_input", terminalId: "probe-0", data: "echo reached-a-shell\r" });
  await assert.rejects(client.waitFor((m) => m.type === "terminal_data", 1_500));
});

/** A runner that passes its self-check and, asked to run, records what it was given and acts as a shell. */
async function recordingRunner(dir) {
  const record = path.join(dir, "runner-run.json");
  const runner = path.join(dir, "fake-landstrip");
  await writeFile(
    runner,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "doctor") { console.log(JSON.stringify({ ok: true, implementation: "fake" })); process.exit(0); }
const policyFile = args[args.indexOf("-p") + 1];
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, env: process.env, cwd: process.cwd(), policy: JSON.parse(fs.readFileSync(policyFile, "utf8")) }));
process.stdout.write("fake-shell-ready\\r\\n");
process.stdin.on("data", (d) => process.stdout.write(d));
`,
  );
  await chmod(runner, 0o755);
  return { runner, recorded: async () => JSON.parse(await readFile(record, "utf8")) };
}

// openlore: scenario=KeysDoNotReachTheShell spec=terminal
test("a confined terminal is spawned through the runner with its policy, a built environment, and cleaned up", { skip: !POSIX && "fake runner needs a shebang" }, async (t) => {
  const root = await makeWorkspace({ "out/.keep": "" });
  const { runner, recorded } = await recordingRunner(root);
  const server = await startServer(
    root,
    { sandbox: { root, allowWrite: true, writableRoot: path.join(root, "out"), allowBash: true }, terminal: { enabled: true, sandbox: runner } },
    { env: { OPENAI_API_KEY: "sk-must-not-leak", PI_OUTPOST_SECRET_PROBE: "nope" } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  const answer = await openAfterCheck(client, "confined");
  assert.equal(answer.type, "terminal_data", `expected the shell, got ${JSON.stringify(answer)}`);
  const id = answer.terminalId;
  const run = await recorded();

  // `<runner> run -p <policy> -- <shell> …`
  assert.equal(run.args[0], "run");
  assert.equal(run.args[1], "-p");
  assert.equal(run.args[3], "--");
  // The policy is the workspace sandbox's: read the root, write the writable zone.
  assert.ok(run.policy.filesystem.allowRead.includes(root));
  assert.equal(run.policy.filesystem.allowWrite[0], path.join(root, "out"));
  // The environment was built, not inherited: no key, nothing of the server's own.
  assert.equal(run.env.OPENAI_API_KEY, undefined, "a provider key reached the confined shell");
  assert.equal(run.env.PI_OUTPOST_SECRET_PROBE, undefined);
  assert.equal(run.env.HOME, root);
  assert.ok(run.env.TMPDIR && run.policy.filesystem.allowWrite.includes(run.env.TMPDIR));

  // The policy file sits in the terminal's private directory, owner-only, gone on close.
  const policyFile = run.args[2];
  assert.equal((await stat(policyFile)).mode & 0o777, 0o600);
  client.send({ type: "terminal_close", terminalId: id });
  let gone = false;
  for (let i = 0; i < 40 && !gone; i += 1) {
    gone = await stat(path.dirname(policyFile)).then(() => false, () => true);
    if (!gone) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(gone, "the confined terminal's private directory outlived it");
});

// openlore: scenario=SyncUnderALockedSandbox spec=terminal
test("syncing the agent to a confined terminal's directory cannot move a locked root", { skip: !POSIX && "fake runner needs a shebang" }, async (t) => {
  const root = await makeWorkspace({ "out/.keep": "" });
  const { runner } = await recordingRunner(root);
  const server = await startServer(root, {
    sandbox: { root, allowWrite: true, writableRoot: path.join(root, "out"), allowBash: true },
    sandboxLocks: { root: true },
    terminal: { enabled: true, sandbox: runner },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");
  assert.equal((await openAfterCheck(client, "sync")).type, "terminal_data");

  // What the panel's Sync sends for a terminal standing in /usr: the same request the
  // directory picker would send, and nothing a confined terminal adds to it.
  const elsewhere = path.resolve(path.sep, "usr");
  client.send({ type: "update_config", sandbox: { root: elsewhere, allowWrite: true, allowBash: true, writableRoot: path.join(root, "out") } });
  const ack = await client.waitFor((m) => m.type === "update_config_ack" || m.type === "error");
  const sandbox = ack.type === "update_config_ack" ? ack.sandbox : undefined;
  if (sandbox) assert.equal(sandbox.root, root, "a locked root moved to where the terminal stood");

  // And a client connecting afresh sees the root it was locked to.
  const fresh = connect(server.wsUrl());
  t.after(() => fresh.close());
  const hello = await fresh.waitFor((m) => m.type === "hello");
  assert.equal((hello.state ?? hello).sandbox.root, root);
});
