/**
 * Onboarding: a server with no credentials must say so, and must become usable from
 * the UI alone — no restart, no hand-written auth.json. These drive the real server
 * over the real WebSocket; only the model provider is fake (nothing is ever called).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

/**
 * The machine running the tests almost certainly has a provider key exported (the
 * developer's, or CI's). Strip every one of them, or "unconfigured" is a fiction and
 * the test passes for the wrong reason.
 */
function withoutProviderKeys() {
  const stripped = {};
  for (const name of Object.keys(process.env)) {
    if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) stripped[name] = undefined;
  }
  return stripped;
}

const AGENT_DIR = (root) => path.join(root, ".pi-agent");

test("an unconfigured server reports no usable model, then onboards without a restart", async () => {
  const root = await makeWorkspace();
  const server = await startServer(root, {}, { env: withoutProviderKeys() });
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor((m) => m.type === "hello");
    assert.equal(hello.credentials.usableModel, false, "no key anywhere: nothing can answer");
    assert.ok(hello.credentials.providers.length > 0, "the registry still knows providers");
    assert.ok(
      hello.credentials.providers.every((provider) => provider.configured === false),
      "none of them is configured",
    );
    assert.equal(hello.credentials.agentDir, AGENT_DIR(root), "and it says where credentials belong");

    client.send({ type: "set_credential", provider: "anthropic", apiKey: "sk-ant-not-a-real-key" });

    const replaced = await client.waitFor((m) => m.type === "credentials_changed");
    assert.equal(replaced.credentials.usableModel, true, "the agent can answer now");
    const anthropic = replaced.credentials.providers.find((provider) => provider.id === "anthropic");
    assert.equal(anthropic.configured, true);
    assert.ok(replaced.model.startsWith("anthropic/"), `session moved onto the usable model, got ${replaced.model}`);
    // Not a snapshot: a snapshot means "different session", and clients answer it by
    // dropping live extension dialogs and widgets the server still holds.
    assert.ok(!client.received.some((m) => m.type === "session_replaced"));
    // The path is only disclosed while onboarding needs it
    assert.equal(replaced.credentials.agentDir, undefined, "a configured server stops naming its agentDir");

    // The key travels one way. A snapshot that echoed it would hand it to any client
    // that later reaches this socket.
    assert.ok(!JSON.stringify(replaced.credentials).includes("sk-ant-not-a-real-key"));

    const stored = JSON.parse(await readFile(path.join(AGENT_DIR(root), "auth.json"), "utf8"));
    assert.deepEqual(stored.anthropic, { type: "api_key", key: "sk-ant-not-a-real-key" });
  } finally {
    client.close();
    await server.stop();
  }
});

test("a custom OpenAI-compatible endpoint becomes selectable, and is written where the next start reads it", async () => {
  const root = await makeWorkspace();
  const server = await startServer(root, {}, { env: withoutProviderKeys() });
  const client = connect(server.wsUrl());
  let written;
  try {
    await client.waitFor((m) => m.type === "hello");
    client.send({
      type: "declare_provider",
      provider: "corp",
      baseUrl: "https://llm.corp.example/v1",
      apiKey: "corp-key",
      models: ["gpt-oss-120b"],
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    });

    const replaced = await client.waitFor((m) => m.type === "credentials_changed");
    assert.ok(
      replaced.models.some((model) => model.provider === "corp" && model.id === "gpt-oss-120b"),
      "the declared model is selectable straight away",
    );
    assert.equal(replaced.credentials.usableModel, true);

    // The compat flags are the whole point of the form: a gateway that rejects the
    // `developer` role fails on every turn, so they must reach models.json.
    written = await readFile(path.join(AGENT_DIR(root), "models.json"), "utf8");
    const file = JSON.parse(written);
    assert.equal(file.providers.corp.baseUrl, "https://llm.corp.example/v1");
    assert.equal(file.providers.corp.api, "openai-completions");
    assert.deepEqual(file.providers.corp.compat, { supportsDeveloperRole: false, supportsReasoningEffort: false });
    assert.deepEqual(file.providers.corp.models, [{ id: "gpt-oss-120b" }]);
  } finally {
    client.close();
    // Takes the workspace with it, so persistence is proven by feeding what we wrote
    // to a *fresh* server below — same file, same place the next start would read.
    await server.stop();
  }

  const seeded = await makeWorkspace({ ".pi-agent/models.json": written });
  const restarted = await startServer(seeded, {}, { env: withoutProviderKeys() });
  const second = connect(restarted.wsUrl());
  try {
    const hello = await second.waitFor((m) => m.type === "hello");
    assert.ok(
      hello.models.some((model) => model.provider === "corp" && model.id === "gpt-oss-120b"),
      "a server reading that models.json offers the declared model without redeclaring it",
    );
  } finally {
    second.close();
    await restarted.stop();
  }
});

test("a base URL that is not http(s) is refused", async () => {
  const root = await makeWorkspace();
  const server = await startServer(root, {}, { env: withoutProviderKeys() });
  const client = connect(server.wsUrl());
  try {
    await client.waitFor((m) => m.type === "hello");
    client.send({ type: "declare_provider", provider: "bad", baseUrl: "file:///etc/passwd", apiKey: "k", models: ["m"] });
    // Nothing to wait for: the frame is dropped. Prove the state never moved.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(!client.received.some((m) => m.type === "credentials_changed"));
  } finally {
    client.close();
    await server.stop();
  }
});
