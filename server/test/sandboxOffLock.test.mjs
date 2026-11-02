/**
 * The shell's lock when the sandbox is turned off (sandbox-defaults, sandbox-runner-bash): open
 * while the agent has a shell, absent without one, and absent for an RPC child's shell, which
 * pi-outpost does not judge. Read from the snapshot a client receives on connect.
 */
import assert from "node:assert/strict";
import { realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE_RPC = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

async function helloWith(t, config, env = {}, onClient) {
  const root = await realpath(await makeWorkspace({ "readme.md": "# lock\n" }));
  const server = await startServer(root, typeof config === "function" ? await config(root) : config, { env });
  const client = connect(server.wsUrl());
  t.after(async () => {
    client.close();
    await server.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  onClient?.(client);
  return client.waitFor("hello", 30_000);
}

// openlore: scenario=SandboxFalseRestoresTheOldBehaviour spec=sandbox-defaults
test("with the sandbox off, the agent's shell is shown not confined, saying the sandbox is off", async (t) => {
  let client;
  const hello = await helloWith(t, { sandbox: false }, {}, (c) => (client = c));
  assert.ok(hello.tools.some((tool) => tool.name === "bash" && tool.active), "the agent has its shell");
  assert.equal(hello.confinement?.bash?.state, "unconfined");
  assert.equal(hello.confinement?.bash?.sandboxOff, true);
  // Then the machine's runner is checked, as for any unconfined shell: either it could confine
  // (and `config --confine` is offered) or the reason it cannot is given — still sandbox off.
  const settled = await client.waitFor((message) =>
    (message.type === "hello" || message.type === "confinement") &&
    (message.confinement?.bash?.available !== undefined || message.confinement?.bash?.reason !== undefined), 30_000);
  assert.equal(settled.confinement.bash.state, "unconfined");
  assert.equal(settled.confinement.bash.sandboxOff, true);
});

// openlore: scenario=SandboxFalseWithoutAShellShowsNoLock spec=sandbox-defaults
test("with the sandbox off and no bash tool, no lock is shown", async (t) => {
  const hello = await helloWith(t, { sandbox: false, tools: ["read", "ls"] });
  assert.ok(!hello.tools.some((tool) => tool.name === "bash" && tool.active), "no shell among the agent's tools");
  assert.equal(hello.confinement?.bash, undefined);
});

// openlore: scenario=AnRpcChildsShellIsNotJudged spec=sandbox-runner-bash
test("an RPC child's shell is not judged", async (t) => {
  const fakeConfig = path.join(await realpath(await makeWorkspace({})), "fake-rpc.json");
  await writeFile(fakeConfig, JSON.stringify({}));
  t.after(() => rm(path.dirname(fakeConfig), { recursive: true, force: true }));
  const hello = await helloWith(
    t,
    { sandbox: false, agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE_RPC], startupTimeoutMs: 15_000 } },
    { FAKE_PI_RPC_CONFIG: fakeConfig },
  );
  assert.equal(hello.confinement?.bash, undefined);
});
