/**
 * The terminal kill switch, as a client meets it.
 *
 * `TerminalManager` is unit-tested next door, and the panel is tested in the UI.
 * Neither answers the question the opt-in exists for: handed a `terminal_open`
 * by a client that was never offered the button, does a real server refuse — or
 * does it open an unconfined host shell because nothing on the wire says no?
 *
 * Both refusals matter and they are separate branches: the feature switch
 * (`terminal.enabled`, off unless a deployment asks for it) and the sandbox one
 * (`sandbox.allowBash`, which the terminal shares with the agent's bash tool).
 * Hiding the button is not a gate; this is.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const openTerminal = async (client, terminalId) => {
  client.send({ type: "terminal_open", terminalId, cols: 80, rows: 24 });
  return client.waitFor(
    (m) => (m.type === "terminal_error" || m.type === "terminal_data" || m.type === "terminal_exit") && m.terminalId === terminalId,
  );
};

test("a server with no terminal configured advertises none and refuses to open one", async (t) => {
  const root = await makeWorkspace();
  const server = await startServer(root, { sandbox: undefined });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());

  const hello = await client.waitFor((m) => m.type === "hello");
  const state = hello.state ?? hello;
  assert.deepEqual(state.terminal, { enabled: false }, "the default snapshot must not advertise a terminal");

  // The client asks anyway — a browser console, a stale page, anything holding
  // an authenticated socket. Nothing but the server stands between that and a shell.
  const answer = await openTerminal(client, "probe-1");
  assert.equal(answer.type, "terminal_error");
  assert.equal(answer.message, "Terminal access is disabled by server configuration.");

  // A refusal is not a shell: no output and no exit may follow it.
  client.send({ type: "terminal_input", terminalId: "probe-1", data: "echo reached-a-shell\r" });
  await assert.rejects(
    client.waitFor((m) => m.type === "terminal_data" && m.terminalId === "probe-1", 2_000),
    "input after a refusal reached something that answered",
  );
});

test("a locked terminal says so in the snapshot, so Settings cannot offer to switch it on", async (t) => {
  const root = await makeWorkspace();
  const server = await startServer(root, {
    sandbox: undefined,
    terminal: { enabled: true },
    sandboxLocks: { terminal: true },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());

  const hello = await client.waitFor((m) => m.type === "hello");
  const state = hello.state ?? hello;
  assert.equal(state.terminal.enabled, true);
  assert.equal(state.terminal.locked, true, "a locked terminal must be marked locked on the wire");
});

test("the sandbox refuses the terminal on its own, even when the feature is enabled", async (t) => {
  const root = await makeWorkspace();
  const server = await startServer(root, {
    terminal: { enabled: true },
    sandbox: { root, allowWrite: true, writableRoot: root, allowBash: false },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());

  const hello = await client.waitFor((m) => m.type === "hello");
  const state = hello.state ?? hello;
  // The feature is on, so the button is offered — and the shell is still refused,
  // because `allowBash: false` is the deployment saying no shells at all.
  assert.equal(state.terminal.enabled, true);

  const answer = await openTerminal(client, "probe-2");
  assert.equal(answer.type, "terminal_error");
  assert.match(answer.message, /sandbox/i);
  assert.match(answer.message, /allowBash/);
});

test("the environment variable turns the terminal on where no config file asked for it", async (t) => {
  const root = await makeWorkspace();
  // No `terminal` key in the config at all: the deployment switch is the environment,
  // which is how a container turns this on without rewriting the file it was given.
  const server = await startServer(root, { sandbox: undefined }, { env: { PI_OUTPOST_TERMINAL: "1" } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());

  const hello = await client.waitFor((m) => m.type === "hello");
  const state = hello.state ?? hello;
  assert.equal(state.terminal.enabled, true, "PI_OUTPOST_TERMINAL=1 must reach the snapshot");

  // And the gate is open with it. A host without a usable `node-pty` still fails here
  // — that is the optional dependency, not the switch — so what this asserts is that
  // neither refusal the switch produces is what comes back.
  const answer = await openTerminal(client, "probe-3");
  if (answer.type === "terminal_error") {
    assert.doesNotMatch(
      answer.message,
      /disabled by server configuration|disabled in the current sandbox/,
      "the switch was on and the server still refused for a configuration reason",
    );
  }
  client.send({ type: "terminal_close", terminalId: "probe-3" });
});

test("PI_OUTPOST_TERMINAL=0 leaves it off, so the variable is a switch and not a mere presence", async (t) => {
  const root = await makeWorkspace();
  const server = await startServer(root, { sandbox: undefined }, { env: { PI_OUTPOST_TERMINAL: "0" } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());

  const hello = await client.waitFor((m) => m.type === "hello");
  const state = hello.state ?? hello;
  assert.equal(state.terminal.enabled, false);
  const answer = await openTerminal(client, "probe-4");
  assert.equal(answer.type, "terminal_error");
});

test("a locked terminal cannot be switched on from the client, because no wire path exists", async (t) => {
  const root = await makeWorkspace();
  const server = await startServer(root, {
    terminal: { enabled: false },
    sandboxLocks: { terminal: true },
    sandbox: { root, allowWrite: true, writableRoot: root, allowBash: true },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());

  await client.waitFor((m) => m.type === "hello");

  // Settings is the only surface that edits configuration at runtime. The lock has to
  // hold on the wire, not merely grey the control out: a client that sends the update
  // anyway must not come back with a terminal.
  client.send({ type: "update_config", terminal: { enabled: true } });
  const ack = await client.waitFor((m) => m.type === "update_config_ack" || m.type === "error");
  if (ack.type === "update_config_ack") {
    assert.equal(ack.terminal.enabled, false, "the client's update switched the terminal on");
    assert.equal(ack.terminal.locked, true);
  }

  const answer = await openTerminal(client, "probe-5");
  assert.equal(answer.type, "terminal_error");
  assert.equal(answer.message, "Terminal access is disabled by server configuration.");
});
