/**
 * `allowedModels` binds the session, not only the model list.
 *
 * The agent directory's default model (`settings.json`) is outside the list here. Found
 * live: a deployment restricted to one model started every session on the user's default
 * instead, and answered with it. Each model of the provider names itself in its answer,
 * so the assertions read which model really ran a turn.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/two-models-provider.mjs", import.meta.url));
const ALLOWED = { provider: "two-models-test", id: "allowed" };

const answeredBy = (client, id) =>
  client.received.some((m) => m.type === "assistant_end" && JSON.stringify(m.item).includes(`answered by ${id}`));

async function eventually(check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

async function boot(t) {
  const root = await makeWorkspace();
  const agentDir = path.join(root, ".pi-agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "two-models-test", defaultModel: "denied" }));
  const server = await startServer(root, { agentDir, extensionPaths: [PROVIDER], allowedModels: [ALLOWED] });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.open();
  const hello = await client.waitFor("hello", 60_000);
  return { client, hello, agentDir };
}

// openlore: scenario=TheSessionStartsOnAnAllowedModel spec=model
test("TheSessionStartsOnAnAllowedModel: a default outside allowedModels is replaced, and the turn runs on the allowed one", async (t) => {
  const { client, hello, agentDir } = await boot(t);
  assert.deepEqual(hello.models.map((m) => `${m.provider}/${m.id}`), ["two-models-test/allowed"]);
  assert.equal(hello.model, "two-models-test/allowed", "the greeting names the model the session is on");
  client.send({ type: "prompt", text: "hello" });
  assert.ok(await eventually(() => answeredBy(client, "allowed")), "the turn ran on the allowed model");
  assert.equal(answeredBy(client, "denied"), false);
  // The deployment's restriction is not the user's preference: pi's default stays theirs.
  assert.equal(JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")).defaultModel, "denied");
});

// openlore: scenario=AModelOutsideTheListIsRefused spec=model
test("AModelOutsideTheListIsRefused: set_model names a model outside allowedModels, and nothing changes", async (t) => {
  const { client } = await boot(t);
  client.send({ type: "set_model", provider: "two-models-test", id: "denied" });
  const error = await client.waitFor("error");
  assert.match(error.message, /not available/i);
  assert.equal(client.received.some((m) => m.type === "model_changed"), false, "no client was told the model changed");
  client.send({ type: "prompt", text: "hello" });
  assert.ok(await eventually(() => answeredBy(client, "allowed")), "the next turn still runs on the allowed model");
  assert.equal(answeredBy(client, "denied"), false);
});

// openlore: scenario=ANewSessionStaysOnAnAllowedModel spec=model
test("ANewSessionStaysOnAnAllowedModel: a new session, which starts from the default again, is moved onto the list", async (t) => {
  const { client } = await boot(t);
  client.send({ type: "new_session" });
  const replaced = await client.waitFor("session_replaced", 30_000);
  assert.equal(replaced.model, "two-models-test/allowed");
  client.send({ type: "prompt", text: "hello" });
  assert.ok(await eventually(() => answeredBy(client, "allowed")), "the turn ran on the allowed model");
  assert.equal(answeredBy(client, "denied"), false);
});
