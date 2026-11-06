/**
 * Git host credentials over the real WebSocket (git-host-credentials).
 *
 * A real server, a real Git HTTPS host behind Basic auth: the clone fails for want of a
 * credential, the client stores one, the same clone then succeeds — what the panel does,
 * without the panel. The secret is checked against every message any client received.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { gitTrustEnv, makeBareRepository, startGitHttpServer } from "./fixtures/gitHttpServer.mjs";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const SECRET = "wire-secret-7c1f";
const gitEnv = { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1", ...gitTrustEnv() };
const AGENT_DIR = (root) => path.join(root, ".pi-agent");

let gitServer;
const temps = [];
before(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-outpost-git-wire-"));
  temps.push(root);
  makeBareRepository(root, "demo");
  gitServer = await startGitHttpServer({ root, credentials: { username: "alice", password: SECRET } });
});
after(async () => {
  await gitServer?.close();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const leaked = (client) => client.received.filter((message) => JSON.stringify(message).includes(SECRET));

describe("storing a Git host credential from a client", () => {
  // openlore: scenario=The host list carries no secret spec=git-host-credentials
  // openlore: scenario=Clone asks, stores and retries spec=git-host-credentials
  test("clone fails as authentication, a stored credential lets the same clone through, and no client ever sees the secret", async () => {
    const root = await makeWorkspace();
    const server = await startServer(root, {}, { env: gitEnv });
    const client = connect(server.wsUrl());
    const other = connect(server.wsUrl());
    await client.open();
    await other.open();
    try {
      const hello = await client.waitFor("hello");
      assert.deepEqual(hello.credentials.gitHosts, []);

      const destination = path.join(root, "demo-clone");
      client.send({ type: "clone_agent_resource_repository", repositoryUrl: `${gitServer.base}/demo.git`, destinationPath: destination, requestId: "c1" });
      const refused = await client.waitFor((m) => m.type === "agent_resource_error" && m.requestId === "c1");
      assert.deepEqual(refused.auth, { scheme: "https", host: `https://${gitServer.host}` }, `${refused.message}\n--- server log ---\n${server.log()}`);
      assert.match(refused.message, /requires authentication/);

      client.send({ type: "set_git_host_credential", host: refused.auth.host, username: "alice", secret: SECRET, requestId: "s1" });
      const stored = await client.waitFor((m) => m.type === "git_host_credential_result" && m.requestId === "s1");
      assert.deepEqual(stored, { type: "git_host_credential_result", requestId: "s1", ok: true, host: `https://${gitServer.host}` });
      // Every client of the project learns the new host, without the secret.
      const told = await other.waitFor((m) => m.type === "credentials_changed" && m.credentials.gitHosts?.length === 1);
      assert.deepEqual(told.credentials.gitHosts, [{ host: `https://${gitServer.host}`, username: "alice" }]);
      assert.match(readFileSync(path.join(AGENT_DIR(root), "git-credentials"), "utf8"), /alice/, "the store is in the agent directory");

      client.send({ type: "clone_agent_resource_repository", repositoryUrl: `${gitServer.base}/demo.git`, destinationPath: destination, requestId: "c2" });
      const preview = await client.waitFor((m) => (m.type === "agent_resource_preview" || m.type === "agent_resource_error") && m.requestId === "c2");
      assert.equal(preview.type, "agent_resource_preview", preview.message);
      assert.deepEqual(preview.preview.skills.map((skill) => skill.name), ["demo"]);

      assert.deepEqual(leaked(client), []);
      assert.deepEqual(leaked(other), []);
      assert.doesNotMatch(server.log(), new RegExp(SECRET));
    } finally {
      client.ws.close();
      other.ws.close();
      await server.stop();
    }
  });

  // openlore: scenario=A stored credential survives a restart spec=git-host-credentials
  test("A stored credential survives a restart: a new server lists the host and clones with it", async () => {
    const firstRoot = await makeWorkspace();
    const first = await startServer(firstRoot, {}, { env: gitEnv });
    const client = connect(first.wsUrl());
    await client.open();
    let written;
    try {
      await client.waitFor("hello");
      client.send({ type: "set_git_host_credential", host: gitServer.base, username: "alice", secret: SECRET, requestId: "s1" });
      assert.equal((await client.waitFor((m) => m.type === "git_host_credential_result" && m.requestId === "s1")).ok, true);
      written = readFileSync(path.join(AGENT_DIR(firstRoot), "git-credentials"), "utf8");
    } finally {
      client.ws.close();
      // stop() takes the workspace with it: persistence is proven by handing what was
      // written to a fresh server, at the place the next start reads it from.
      await first.stop();
    }
    const root = await makeWorkspace({ ".pi-agent/git-credentials": written });
    const second = await startServer(root, {}, { env: gitEnv });
    const again = connect(second.wsUrl());
    await again.open();
    try {
      const hello = await again.waitFor("hello");
      assert.deepEqual(hello.credentials.gitHosts, [{ host: `https://${gitServer.host}`, username: "alice" }]);
      again.send({ type: "clone_agent_resource_repository", repositoryUrl: `${gitServer.base}/demo.git`, destinationPath: path.join(root, "after-restart"), requestId: "c1" });
      const result = await again.waitFor((m) => (m.type === "agent_resource_preview" || m.type === "agent_resource_error") && m.requestId === "c1");
      assert.equal(result.type, "agent_resource_preview", result.message);
    } finally {
      again.ws.close();
      await second.stop();
    }
  });

  test("removing a host empties the list for every client", async () => {
    const root = await makeWorkspace();
    const server = await startServer(root, {}, { env: gitEnv });
    const client = connect(server.wsUrl());
    await client.open();
    try {
      await client.waitFor("hello");
      client.send({ type: "set_git_host_credential", host: "git.example.com:8447", username: "bob", secret: SECRET, requestId: "s1" });
      await client.waitFor((m) => m.type === "credentials_changed" && m.credentials.gitHosts?.length === 1);
      client.send({ type: "remove_git_host_credential", host: "https://git.example.com:8447", requestId: "r1" });
      assert.equal((await client.waitFor((m) => m.type === "git_host_credential_result" && m.requestId === "r1")).ok, true);
      await client.waitFor((m) => m.type === "credentials_changed" && m.credentials.gitHosts?.length === 0);
      assert.doesNotMatch(readFileSync(path.join(AGENT_DIR(root), "git-credentials"), "utf8"), /bob/);
    } finally {
      client.ws.close();
      await server.stop();
    }
  });

  test("a non-HTTPS host is refused with a reason that does not repeat the secret", async () => {
    const root = await makeWorkspace();
    const server = await startServer(root, {}, { env: gitEnv });
    const client = connect(server.wsUrl());
    await client.open();
    try {
      await client.waitFor("hello");
      client.send({ type: "set_git_host_credential", host: "ssh://git@git.example.com", username: "bob", secret: SECRET, requestId: "s1" });
      const result = await client.waitFor((m) => m.type === "git_host_credential_result" && m.requestId === "s1");
      assert.equal(result.ok, false);
      assert.match(result.message, /HTTPS/);
      assert.deepEqual(leaked(client), []);
    } finally {
      client.ws.close();
      await server.stop();
    }
  });
});

describe("credentialsLock", () => {
  // openlore: scenario=A locked server refuses spec=git-host-credentials
  test("A locked server refuses: storing and removing are refused with the reason, the store is untouched", async () => {
    const root = await makeWorkspace();
    const server = await startServer(root, { credentialsLock: true }, { env: gitEnv });
    const client = connect(server.wsUrl());
    await client.open();
    try {
      const hello = await client.waitFor("hello");
      assert.equal(hello.credentials.locked, true);
      client.send({ type: "set_git_host_credential", host: "git.example.com", username: "bob", secret: SECRET, requestId: "s1" });
      const set = await client.waitFor((m) => m.type === "git_host_credential_result" && m.requestId === "s1");
      assert.equal(set.ok, false);
      assert.match(set.message, /locked/);
      client.send({ type: "remove_git_host_credential", host: "git.example.com", requestId: "r1" });
      const removed = await client.waitFor((m) => m.type === "git_host_credential_result" && m.requestId === "r1");
      assert.equal(removed.ok, false);
      assert.equal(existsSync(path.join(AGENT_DIR(root), "git-credentials")), false);
    } finally {
      client.ws.close();
      await server.stop();
    }
  });
});
