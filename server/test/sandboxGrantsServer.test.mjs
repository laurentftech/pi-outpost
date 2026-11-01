/**
 * `run_with_grant` through the real server and the real agent: a provider makes the agent call
 * the tool, a client answers the grant request, and the tool results the model receives say what
 * ran and with what.
 *
 * The runner is node playing landstrip (see `sandboxRunnerBash.test.mjs`): it prints the policy
 * it was handed, so each command's result shows which directories its launch was granted. What a
 * real runner then confines is `sandboxGrantsReal.test.ts`'s and `confinedNetworkMxc.test.ts`'s.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/bash-call-provider.mjs", import.meta.url));
const MODEL = { provider: "bash-call-test", id: "bash-call-test" };
const DOCTOR = fileURLToPath(new URL("./fixtures/fake-runner-doctor.cjs", import.meta.url));
// Prints what the launch may write, then runs the "shell" (node) on the command's script.
const FAKE_RUN = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const policy = JSON.parse(fs.readFileSync(args[args.indexOf("-p") + 1], "utf8"));
process.stdout.write("writable=" + JSON.stringify(policy.filesystem.allowWrite) + "\\n");
const [shell, script] = args.slice(args.indexOf("--") + 1);
spawn(shell, [script], { stdio: "inherit", env: process.env }).on("exit", (code) => process.exit(code ?? 1));
`;

async function project() {
  const root = await realpath(await makeWorkspace());
  await writeFile(path.join(root, "run"), FAKE_RUN);
  const beside = path.join(path.dirname(root), `${path.basename(root)}-beside`);
  await mkdir(beside, { recursive: true });
  return { root, beside };
}

async function waitForFile(file, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await readFile(file, "utf8").catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${path.basename(file)} never written`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Starts a server whose agent takes `steps`, one tool call per round trip; `answer` plays the user. */
async function run(t, { root, steps, sandbox = {}, answer, beforePrompt }) {
  const log = path.join(path.dirname(root), `${path.basename(root)}-steps.json`);
  const server = await startServer(
    root,
    { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: process.execPath, bashShell: process.execPath, ...sandbox }, extensionPaths: [PROVIDER], allowedModels: [MODEL] },
    {
      env: {
        BASH_CALL_LOG: log,
        BASH_CALL_STEPS: JSON.stringify(steps),
        NODE_OPTIONS: `--require "${DOCTOR.replaceAll("\\", "/")}"`,
      },
    },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 30_000);
  if (beforePrompt) await beforePrompt(client, server);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "Go." });
  if (answer) await answer(client, server);
  const results = JSON.parse(await waitForFile(log)).map((result) => ({ isError: result.isError, text: result.content.map((part) => part.text ?? "").join("") }));
  return { hello, server, client, results };
}

const printWritable = `console.log("ran")`;
const grantStep = (beside, extra = {}) => ({
  tool: "run_with_grant",
  args: { command: printWritable, reason: "write the build output beside the project", directories: [{ path: beside, access: "write" }], ...extra },
});
const writableIn = (text, dir) => {
  const listed = JSON.parse(/writable=(\[.*\])/.exec(text)?.[1] ?? "[]");
  return listed.some((entry) => entry.replaceAll("\\", "/") === dir.replaceAll("\\", "/"));
};

// openlore: scenario=TheToolComesWithAConfinedShell spec=sandbox-approved-grants
test("TheToolComesWithAConfinedShell: a confined shell has run_with_grant beside it, saying the user approves", async (t) => {
  const { root } = await project();
  const { hello } = await run(t, { root, steps: [{ tool: "bash", args: { command: printWritable } }] });
  const tool = hello.tools.find((entry) => entry.name === "run_with_grant");
  assert.ok(tool?.active, `no active run_with_grant: ${JSON.stringify(hello.tools.map((entry) => entry.name))}`);
  assert.ok(hello.tools.some((entry) => entry.name === "bash" && entry.active), "the shell tool beside it");
  // What the model reads of it: the definition the server registers.
  const { createRunWithGrantToolDefinition } = await import("../src/sandboxGrantTool.ts");
  const definition = createRunWithGrantToolDefinition({ broker: {}, context: () => ({}), shellTool: "bash", run: async () => ({ content: [] }) });
  assert.match(definition.description, /The user approves or refuses every grant in the interface before anything runs/);
});

// openlore: scenario=NoRunnerNoGrantTool spec=sandbox-approved-grants
test("NoRunnerNoGrantTool: no tool without a runner, or with sandbox.grants never — which a Settings apply keeps", async (t) => {
  const { root } = await project();
  let applied;
  const never = await run(t, {
    root,
    steps: [{ tool: "bash", args: { command: printWritable } }],
    sandbox: { grants: "never" },
    // A Settings apply rebuilds the sandbox from what the browser sends, which carries no `grants`.
    beforePrompt: async (client) => {
      client.send({ type: "update_config", sandbox: { root, allowWrite: false, allowBash: true } });
      applied = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error", 30_000);
      assert.equal(applied.type, "update_config_ack", applied.message);
    },
  });
  assert.ok(!never.hello.tools.some((entry) => entry.name === "run_with_grant"), "offered with grants never");
  const rebuilt = applied.tools.map((entry) => entry.name);
  assert.ok(rebuilt.includes("bash") && !rebuilt.includes("run_with_grant"), `the rebuilt session's tools: ${rebuilt}`);
  const other = await project();
  const unconfined = await run(t, { root: other.root, steps: [{ tool: "bash", args: { command: printWritable } }], sandbox: { bashRunner: undefined, bashShell: undefined } });
  assert.ok(!unconfined.hello.tools.some((entry) => entry.name === "run_with_grant"), "offered without a runner");
});

// openlore: scenario=AOnceGrantIsBoundToItsCommand spec=sandbox-approved-grants
test("AOnceGrantIsBoundToItsCommand: allowed once, the command runs with its grant; the same command after it runs without", async (t) => {
  const { root, beside } = await project();
  let request;
  const { results, server } = await run(t, {
    root,
    steps: [grantStep(beside), { tool: "bash", args: { command: printWritable } }],
    answer: async (client) => {
      ({ request } = await client.waitFor("sandbox_grant_request", 60_000));
      client.send({ type: "sandbox_grant_response", id: request.id, decision: "once" });
      await client.waitFor((message) => message.type === "sandbox_grant_resolved" && message.id === request.id);
    },
  });
  // What the user was shown: the exact command, the resolved directory, the agent's reason.
  assert.equal(request.command, printWritable);
  assert.deepEqual(request.grant.directories, [{ path: beside, access: "write" }]);
  assert.equal(request.reason, "write the build output beside the project");
  assert.equal(request.overridesReadOnly, false);
  const [granted, after] = results;
  assert.equal(granted.isError, false, granted.text);
  assert.match(granted.text, /^Ran with the user's grant for this command: read-write /);
  assert.match(granted.text, /ran/);
  assert.ok(writableIn(granted.text, beside), `the launch was not granted the directory: ${granted.text}`);
  assert.ok(!writableIn(after.text, beside), `the next command kept the grant: ${after.text}`);
  assert.match(server.log(), /\[sandbox\] grant approved once: read-write .* for "console\.log\(\\"ran\\"\)" — write the build output beside the project/);
});

// openlore: scenario=ARefusedRequestRunsNothing spec=sandbox-approved-grants
test("ARefusedRequestRunsNothing: refused, the command does not run and the agent is told the user refused", async (t) => {
  const { root, beside } = await project();
  const marker = path.join(root, "ran.txt");
  const { results } = await run(t, {
    root,
    steps: [grantStep(beside, { command: `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x")` })],
    answer: async (client) => {
      const { request } = await client.waitFor("sandbox_grant_request", 60_000);
      // An extension's answer is not an answer to a grant.
      client.send({ type: "extension_ui_response", id: request.id, confirmed: true });
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.ok(!client.received.some((message) => message.type === "sandbox_grant_resolved"), "an extension_ui_response answered a grant");
      client.send({ type: "sandbox_grant_response", id: request.id, decision: "refuse" });
    },
  });
  assert.equal(results[0].isError, true);
  assert.match(results[0].text, /The user refused the grant\. The command did not run\./);
  assert.equal(existsSync(marker), false, "the refused command ran");
});

// openlore: scenario=LaterCommandsKeepTheSessionGrant spec=sandbox-approved-grants
// openlore: scenario=ANewSessionStartsWithoutGrants spec=sandbox-approved-grants
test("a session grant reaches later commands, and a new session starts without it, the configuration unchanged", async (t) => {
  const { root, beside } = await project();
  let configBefore;
  const { results, client } = await run(t, {
    root,
    steps: [grantStep(beside), { tool: "bash", args: { command: printWritable } }],
    beforePrompt: async () => {
      configBefore = await readFile(path.join(root, "pi-outpost.test.json"));
    },
    answer: async (connection) => {
      const { request } = await connection.waitFor("sandbox_grant_request", 60_000);
      connection.send({ type: "sandbox_grant_response", id: request.id, decision: "session" });
    },
  });
  assert.match(results[0].text, /^Ran with the user's grant for the rest of the session/);
  assert.ok(writableIn(results[1].text, beside), `the session grant did not reach the next command: ${results[1].text}`);
  const announced = await client.waitFor((message) => message.type === "sandbox_grants" && message.active.directories.length === 1);
  assert.deepEqual(announced.active.directories, [{ path: beside, access: "write" }]);

  client.send({ type: "new_session" });
  const ended = await client.waitFor((message) => message.type === "sandbox_grants" && message.active.directories.length === 0, 30_000);
  assert.deepEqual(ended.active, { hosts: [], directories: [] });
  assert.deepEqual(await readFile(path.join(root, "pi-outpost.test.json")), configBefore, "the configuration file was written");
  assert.equal(existsSync(path.join(root, ".pi-outpost", "settings.json")) && /beside/.test(await readFile(path.join(root, ".pi-outpost", "settings.json"), "utf8")), false, "the grant reached the project's settings");
});

test("a sandbox settings apply ends the session's grants", async (t) => {
  const { root, beside } = await project();
  const { client } = await run(t, {
    root,
    steps: [grantStep(beside)],
    answer: async (connection) => {
      const { request } = await connection.waitFor("sandbox_grant_request", 60_000);
      connection.send({ type: "sandbox_grant_response", id: request.id, decision: "session" });
    },
  });
  await client.waitFor((message) => message.type === "sandbox_grants" && message.active.directories.length === 1);
  client.send({ type: "update_config", sandbox: { root, allowWrite: false, allowBash: true } });
  const ended = await client.waitFor((message) => message.type === "sandbox_grants" && message.active.directories.length === 0, 30_000);
  assert.deepEqual(ended.active, { hosts: [], directories: [] });
  const ack = await client.waitFor("update_config_ack", 30_000);
  assert.deepEqual(ack.sandboxGrants?.active, { hosts: [], directories: [] }, "the snapshot after the apply holds none");
});

test("a forbidden target is refused before anyone is asked, naming why", async (t) => {
  const { root } = await project();
  const { results, client, server } = await run(t, {
    root,
    steps: [{ tool: "run_with_grant", args: { command: printWritable, reason: "read the keys", directories: [{ path: path.join(root, ".pi-agent"), access: "read" }] } }],
  });
  assert.equal(results[0].isError, true);
  assert.match(results[0].text, /Not asked: .*\.pi-agent — the agent directory holds the provider keys\. The command did not run\./);
  assert.ok(!client.received.some((message) => message.type === "sandbox_grant_request"), "the user was asked anyway");
  assert.match(server.log(), /\[sandbox\] grant forbidden: .*\.pi-agent for/);
});
