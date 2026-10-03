/**
 * `sandbox.bashFrom`: bash supplied by a sandboxing extension instead of pi-outpost's.
 *
 * pi-outpost's own `bash` runs in the project but is not confined. An extension such as
 * pi-landstrip registers a confined `bash` — and the SDK keeps an application's tool
 * over an extension's of the same name, so without delegation the confined one is
 * silently shadowed. These run the real server and the real agent: the provider makes
 * the agent call `bash`, and the tool result says whose `bash` ran.
 */
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const CONFINED = fileURLToPath(new URL("./fixtures/confined-bash-extension.mjs", import.meta.url));
const PROVIDER = fileURLToPath(new URL("./fixtures/bash-call-provider.mjs", import.meta.url));
const MODEL = { provider: "bash-call-test", id: "bash-call-test" };

async function waitForFile(file, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await readFile(file, "utf8").catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${path.basename(file)} never written`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Starts a server, has the agent call `bash` once, and returns what ran and who registered it. */
async function runBash(t, sandbox, { root, afterHello } = {}) {
  const project = root ?? (await realpath(await makeWorkspace()));
  const log = path.join(project, "bash-result.json");
  const report = path.join(project, "bash-source.json");
  const server = await startServer(
    project,
    {
      sandbox: { root: project, allowWrite: true, writableRoot: project, ...sandbox },
      extensionPaths: [CONFINED, PROVIDER],
      allowedModels: [MODEL],
    },
    { env: { BASH_CALL_LOG: log, CONFINED_BASH_REPORT: report } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 30_000);
  if (afterHello) await afterHello(client, project);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "Run the shell." });
  return { hello, result: await waitForFile(log), source: JSON.parse(await waitForFile(report)) };
}

// openlore: scenario=ADelegatedBashIsTheExtensions spec=sandbox-delegated-bash
test("ADelegatedBashIsTheExtensions: the named extension's bash is the one the agent runs", async (t) => {
  const { hello, result, source } = await runBash(t, { allowBash: true, bashFrom: CONFINED });
  assert.ok(hello.tools.some((tool) => tool.name === "bash" && tool.active), "bash is active");
  assert.equal(source.path, CONFINED, "the registered bash is the extension's");
  assert.match(result, /ran confined/);
  assert.doesNotMatch(result, /from-the-shell/, "pi-outpost's unconfined bash did not run");
});

// openlore: scenario=WithoutDelegationTheExtensionIsShadowed spec=sandbox-delegated-bash
test("WithoutDelegationTheExtensionIsShadowed: allowBash alone runs pi-outpost's bash", async (t) => {
  // The case delegation exists for: the extension registered bash, and it is not the one.
  const { result, source } = await runBash(t, { allowBash: true });
  assert.equal(source.source, "sdk", "pi-outpost's bash shadows the extension's");
  assert.match(result, /from-the-shell/);
  assert.doesNotMatch(result, /ran confined/);
});

// openlore: scenario=SettingsKeepTheDelegation spec=sandbox-delegated-bash
test("SettingsKeepTheDelegation: applying Settings leaves bash with the extension", async (t) => {
  const { result } = await runBash(
    t,
    { allowBash: true, bashFrom: CONFINED },
    {
      // A Settings apply rebuilds the sandbox and the session from what the browser sends,
      // which carries no bashFrom.
      afterHello: async (client, project) => {
        client.send({ type: "update_config", sandbox: { root: project, allowWrite: false, allowBash: true } });
        const ack = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error", 30_000);
        assert.equal(ack.type, "update_config_ack", ack.message);
      },
    },
  );
  assert.match(result, /ran confined/, "the rebuilt session still runs the extension's bash");
});

// openlore: scenario=AMissingDelegateRefusesTheSession spec=sandbox-delegated-bash
test("AMissingDelegateRefusesTheSession: naming an extension that supplies no bash stops the server", async () => {
  const project = await realpath(await makeWorkspace());
  await assert.rejects(
    startServer(project, {
      sandbox: { root: project, allowWrite: true, writableRoot: project, allowBash: true, bashFrom: "npm:pi-landstrip" },
      extensionPaths: [PROVIDER],
    }),
    (error) => {
      assert.match(error.message, /"sandbox\.bashFrom" hands bash to "npm:pi-landstrip"/);
      assert.match(error.message, /refusing to start the session/);
      return true;
    },
  );
});

// openlore: scenario=AnotherExtensionsBashIsRefused spec=sandbox-delegated-bash
test("AnotherExtensionsBashIsRefused: a bash from an extension other than the named one stops the server", async () => {
  const project = await realpath(await makeWorkspace());
  await assert.rejects(
    startServer(project, {
      sandbox: { root: project, allowWrite: true, writableRoot: project, allowBash: true, bashFrom: "npm:pi-landstrip" },
      extensionPaths: [CONFINED, PROVIDER],
    }),
    (error) => {
      assert.match(error.message, /the one registered comes from/);
      assert.ok(error.message.includes(CONFINED), "the refusal names where that bash came from");
      return true;
    },
  );
});

// openlore: scenario=NoBashMeansNoDelegate spec=sandbox-delegated-bash
test("NoBashMeansNoDelegate: without allowBash, the extension's bash is not registered either", async () => {
  const project = await realpath(await makeWorkspace());
  const server = await startServer(project, {
    sandbox: { root: project, allowWrite: true, writableRoot: project, allowBash: false, bashFrom: CONFINED },
    extensionPaths: [CONFINED],
  });
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 30_000);
    assert.ok(!hello.tools.some((tool) => tool.name === "bash"), `no bash at all: ${hello.tools.map((tool) => tool.name).join(", ")}`);
  } finally {
    client.close();
    await server.stop();
  }
});

// openlore: scenario=TurningBashOnWithoutTheDelegateIsRefused spec=sandbox-delegated-bash
test("TurningBashOnWithoutTheDelegateIsRefused: Settings cannot switch on a bash nobody supplies", async (t) => {
  const project = await realpath(await makeWorkspace());
  const server = await startServer(project, {
    sandbox: { root: project, allowWrite: true, writableRoot: project, allowBash: false, bashFrom: "npm:pi-landstrip" },
    extensionPaths: [PROVIDER],
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);

  client.send({ type: "update_config", sandbox: { root: project, allowWrite: true, writableRoot: project, allowBash: true } });
  const answer = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error", 30_000);
  assert.equal(answer.type, "error", "the change is refused, not acknowledged");
  assert.match(answer.message, /hands bash to "npm:pi-landstrip"/);

  // Still the sandbox it was, as a fresh connection sees it: bash off, and no bash tool.
  const again = connect(server.wsUrl());
  t.after(() => again.close());
  const hello = await again.waitFor("hello", 30_000);
  assert.equal(hello.sandbox.allowBash, false, "the sandbox was rolled back");
  assert.ok(hello.tools.length > 0, "a live session answers");
  assert.ok(!hello.tools.some((tool) => tool.name === "bash"), `bash did not come back: ${hello.tools.map((tool) => tool.name).join(", ")}`);
  // And on disk: kept there, the change would stop the next start.
  const saved = JSON.parse(await readFile(server.configFile, "utf8"));
  assert.equal(saved.sandbox.allowBash, false, "the file was rolled back too");
  assert.equal(saved.sandbox.bashFrom, "npm:pi-landstrip", "and still names the extension");
});

/** The first message after hello that warns about a shadowed bash, if one comes. */
async function shadowedWarning(client) {
  return client
    .waitFor((message) => message.type === "extension_ui_request" && message.id === "sandbox-shadowed-bash", 3_000)
    .catch(() => undefined);
}

// openlore: scenario=AShadowedExtensionBashIsWarnedAbout spec=sandbox-delegated-bash
test("AShadowedExtensionBashIsWarnedAbout: allowBash without bashFrom says the extension's bash is not the one", async (t) => {
  const project = await realpath(await makeWorkspace());
  const server = await startServer(project, {
    sandbox: { root: project, allowWrite: true, writableRoot: project, allowBash: true },
    extensionPaths: [CONFINED],
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  const warning = await shadowedWarning(client);
  assert.ok(warning, "a browser binding to the project is told");
  assert.equal(warning.method, "notify");
  assert.equal(warning.notifyType, "warning");
  assert.ok(warning.message.includes(CONFINED), "it names the extension");
  assert.match(warning.message, /not confined/);
  assert.ok(warning.message.includes(`"sandbox.bashFrom": ${JSON.stringify(CONFINED)}`), "and the line that fixes it");
  assert.match(server.log(), /\[pi\] WARNING .*registers its own bash/, "and the server log says so at start");

  // Told again to the next browser, which was not there when the session started.
  const later = connect(server.wsUrl());
  t.after(() => later.close());
  await later.waitFor("hello", 30_000);
  assert.ok(await shadowedWarning(later), "each binding browser is told");
});

test("no warning when the extension's bash is the one, or when there is no bash", async (t) => {
  for (const sandbox of [{ allowBash: true, bashFrom: CONFINED }, { allowBash: false }]) {
    const project = await realpath(await makeWorkspace());
    const server = await startServer(project, {
      sandbox: { root: project, allowWrite: true, writableRoot: project, ...sandbox },
      extensionPaths: [CONFINED],
    });
    t.after(() => server.stop());
    const client = connect(server.wsUrl());
    t.after(() => client.close());
    await client.waitFor("hello", 30_000);
    assert.equal(await shadowedWarning(client), undefined, JSON.stringify(sandbox));
    assert.doesNotMatch(server.log(), /registers its own bash/, JSON.stringify(sandbox));
  }
});

// openlore: scenario=ExtensionsSeeTheServersAgentDirectory spec=sandbox-delegated-bash
test("ExtensionsSeeTheServersAgentDirectory: an extension looking up Pi's agent directory finds agentDir", async (t) => {
  const project = await realpath(await makeWorkspace());
  const report = path.join(project, "agent-dir.json");
  const agentDir = path.join(project, ".pi-agent");
  const server = await startServer(
    project,
    { agentDir, extensionPaths: [fileURLToPath(new URL("./fixtures/agent-dir-probe-extension.mjs", import.meta.url))] },
    // Started from a shell that points Pi elsewhere: the configured agentDir still wins.
    { env: { AGENT_DIR_REPORT: report, PI_CODING_AGENT_DIR: path.join(project, "somewhere-else") } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  const seen = JSON.parse(await waitForFile(report));
  assert.equal(path.resolve(seen.agentDir), path.resolve(agentDir));
});
