/**
 * Provider accounts over the socket, through the real embedded runtime: a provider signed in to
 * with an account (a test extension's flow: a device code, then a code to paste), its state in the
 * snapshot, signing out, cancelling, and the lock. Nothing the flow produces — the token — may ever
 * reach a client.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/account-provider.mjs", import.meta.url));

const account = (credentials) => credentials.providers.find((provider) => provider.id === "account-test");

async function serve(extra = {}) {
  const root = await makeWorkspace({ "README.md": "hello\n" });
  const server = await startServer(root, { extensionPaths: [PROVIDER], noExtensions: false, ...extra });
  const client = connect(server.wsUrl());
  const hello = await client.waitFor("hello", 30_000);
  return { root, server, client, hello };
}

/** The next message of a type, after those already seen. */
function next(client, type, after = client.received.length) {
  return client.waitFor((message) => message.type === type && client.received.indexOf(message) >= after, 20_000);
}

// openlore: scenario=ADeviceCodeSignIn spec=credentials
// openlore: scenario=ACodeIsPastedBackFromAnotherMachine spec=credentials
// openlore: scenario=SigningOutRemovesTheStoredCredential spec=credentials
// openlore: scenario=EachProviderSaysHowItIsConfigured spec=credentials
test("sign in with an account, step by step, then sign out — and no token ever reaches the client", async (t) => {
  const { root, server, client, hello } = await serve();
  t.after(() => server.stop());
  t.after(() => client.close());

  const before = account(hello.credentials);
  assert.deepEqual(before.methods, ["oauth"], "an account-only provider offers a sign-in, not a key");
  assert.equal(before.configured, false);
  assert.equal(before.subscription, true);
  assert.equal(hello.credentials.signIn, true);

  // A wrong code fails the flow and stores nothing.
  let mark = client.received.length;
  client.send({ type: "start_login", flowId: "f1", provider: "account-test", method: "oauth" });
  const device = await next(client, "login_event", mark);
  assert.deepEqual(device.event, { type: "device_code", userCode: "WDJB-MJHT", verificationUri: "https://example.test/device", expiresInSeconds: 600 });
  const askWrong = await next(client, "login_prompt", mark);
  assert.equal(askWrong.prompt.type, "manual_code");
  client.send({ type: "login_answer", flowId: "f1", promptId: askWrong.promptId, value: "wrong" });
  const failed = await next(client, "login_done", mark);
  assert.deepEqual([failed.ok, failed.message], [false, "That code was not accepted"]);

  // The right code signs in; the provider's model becomes usable without a restart.
  mark = client.received.length;
  client.send({ type: "start_login", flowId: "f2", provider: "account-test", method: "oauth" });
  const ask = await next(client, "login_prompt", mark);
  client.send({ type: "login_answer", flowId: "f2", promptId: ask.promptId, value: "right-code" });
  const done = await next(client, "login_done", mark);
  assert.equal(done.ok, true, JSON.stringify(done));
  const signedIn = await client.waitFor((m) => m.type === "credentials_changed" && account(m.credentials)?.configured, 20_000);
  assert.deepEqual(
    { auth: account(signedIn.credentials).auth, source: account(signedIn.credentials).source },
    { auth: "oauth", source: "stored" },
  );
  assert.ok(signedIn.models.some((model) => model.provider === "account-test"), "the provider's model is offered");
  const stored = JSON.parse(await readFile(path.join(root, ".pi-agent", "auth.json"), "utf8"));
  assert.equal(stored["account-test"]?.type, "oauth", "the credential is in the agent directory");

  // Sign out: gone from the agent directory, the provider not configured, its model withdrawn.
  mark = client.received.length;
  client.send({ type: "logout_provider", provider: "account-test" });
  const signedOut = await client.waitFor((m) => m.type === "credentials_changed" && client.received.indexOf(m) >= mark && !account(m.credentials)?.configured, 20_000);
  assert.ok(!signedOut.models.some((model) => model.provider === "account-test"));
  const after = JSON.parse(await readFile(path.join(root, ".pi-agent", "auth.json"), "utf8"));
  assert.equal(after["account-test"], undefined);

  assert.doesNotMatch(JSON.stringify(client.received), /SECRET/, "a token reached the client");
});

// openlore: scenario=ASignInIsCancelled spec=credentials
test("a sign-in waiting for the user is cancelled by the user, and by closing the page", async (t) => {
  const { server, client } = await serve();
  t.after(() => server.stop());
  t.after(() => client.close());

  let mark = client.received.length;
  client.send({ type: "start_login", flowId: "c1", provider: "account-test", method: "oauth" });
  await next(client, "login_prompt", mark);
  client.send({ type: "cancel_login", flowId: "c1" });
  const cancelled = await next(client, "login_done", mark);
  assert.deepEqual([cancelled.ok, cancelled.cancelled], [false, true]);

  // A second sign-in from another page, abandoned by closing it: the next one is not refused as "already running".
  const other = connect(server.wsUrl());
  await other.waitFor("hello", 30_000);
  other.send({ type: "start_login", flowId: "c2", provider: "account-test", method: "oauth" });
  await other.waitFor("login_prompt", 20_000);
  other.close();
  mark = client.received.length;
  client.send({ type: "start_login", flowId: "c3", provider: "account-test", method: "oauth" });
  const ask = await next(client, "login_prompt", mark);
  client.send({ type: "login_answer", flowId: "c3", promptId: ask.promptId, value: "right-code" });
  assert.equal((await next(client, "login_done", mark)).ok, true);
});

// openlore: scenario=ALockedServerRefusesAccountChanges spec=credentials
test("under credentialsLock, sign-in, keys and sign-out are refused, saying why", async (t) => {
  const { server, client, hello } = await serve({ credentialsLock: true });
  t.after(() => server.stop());
  t.after(() => client.close());
  assert.equal(hello.credentials.locked, true);

  let mark = client.received.length;
  client.send({ type: "start_login", flowId: "l1", provider: "account-test", method: "oauth" });
  const refused = await next(client, "login_done", mark);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /credentialsLock/);
  for (const message of [
    { type: "set_credential", provider: "account-test", apiKey: "sk-x" },
    { type: "logout_provider", provider: "account-test" },
  ]) {
    mark = client.received.length;
    client.send(message);
    const error = await next(client, "error", mark);
    assert.match(error.message, /credentialsLock/, JSON.stringify(message));
  }
  assert.ok(!client.received.some((m) => m.type === "login_prompt"), "no flow ran");
});

// openlore: scenario=AnEnvironmentKeyIsNotRemovable spec=credentials
// openlore: scenario=EachProviderSaysHowItIsConfigured spec=credentials
test("a key from the server's environment shows that source, and the value never travels", async (t) => {
  const root = await makeWorkspace({ "README.md": "hello\n" });
  const server = await startServer(root, {}, { env: { OPENAI_API_KEY: "sk-env-SECRET-value" } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 30_000);
  const openai = hello.credentials.providers.find((provider) => provider.id === "openai");
  assert.equal(openai.configured, true);
  assert.equal(openai.source, "environment", JSON.stringify(openai));
  assert.equal(openai.auth, "api_key");
  const anthropic = hello.credentials.providers.find((provider) => provider.id === "anthropic");
  assert.equal(anthropic?.configured, false, "a provider with nothing set up says so");
  assert.doesNotMatch(JSON.stringify(client.received), /sk-env-SECRET-value/);
});
