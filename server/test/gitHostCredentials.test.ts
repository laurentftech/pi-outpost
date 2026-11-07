/**
 * Git host credentials (git-host-credentials, agent-resource-management).
 *
 * The git side is real: a smart-HTTPS server behind Basic auth (fixtures/gitHttpServer.mjs)
 * and the git on PATH. The deployment's own git configuration is shut out
 * (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`) so a developer's keychain helper cannot
 * answer for the test host and make a test pass for the wrong reason.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";
import {
  addressHost,
  classifyGitAuthFailure,
  gitCredentialHelperEnv,
  httpsHostKey,
  listGitHosts,
  removeGitHostCredential,
  storeGitHostCredential,
} from "../src/gitHostCredentials.ts";
import { ResourceRepositoryError, ResourceRepositoryService, useGitCredentialStore, useResourceGitObserver } from "../src/resourceRepositories.ts";
import { gitTrustEnv, isolatedGitConfig, makeBareRepository, startGitHttpServer } from "./fixtures/gitHttpServer.mjs";

const run = promisify(execFile);
const isolatedGit = gitTrustEnv();
const saved = new Map<string, string | undefined>();
const temps: string[] = [];

function temp(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `pi-outpost-${name}-`));
  temps.push(dir);
  return dir;
}

before(() => {
  for (const [key, value] of Object.entries(isolatedGit)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
});

after(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** What a non-interactive git really writes when it fails against `url`. */
async function gitStderr(args: string[], cwd?: string): Promise<string> {
  try {
    await run("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, ...isolatedGit, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=" + devNull },
    });
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? "");
  }
  throw new Error("git was expected to fail");
}

describe("host keys", () => {
  test("HTTPS addresses and bare hosts share one normalised key; ports distinguish", () => {
    assert.equal(httpsHostKey("HTTPS://Git.Example.com:443/team/x.git"), "https://git.example.com");
    assert.equal(httpsHostKey("git.example.com"), "https://git.example.com");
    assert.equal(httpsHostKey("https://git.example.com:8447/x.git"), "https://git.example.com:8447");
    assert.notEqual(httpsHostKey("git.example.com:8447"), httpsHostKey("git.example.com"));
  });

  test("only HTTPS has a key", () => {
    assert.equal(httpsHostKey("http://git.example.com/x.git"), undefined);
    assert.equal(httpsHostKey("ssh://git@git.example.com/x.git"), undefined);
    assert.equal(httpsHostKey("file:///tmp/x.git"), undefined);
  });

  test("SSH hosts are read from both URL and SCP forms", () => {
    assert.deepEqual(addressHost("ssh://git@Git.Example.com:2222/x.git"), { scheme: "ssh", host: "git.example.com:2222" });
    assert.deepEqual(addressHost("git@git.example.com:team/x.git"), { scheme: "ssh", host: "git.example.com" });
    assert.equal(addressHost("file:///tmp/x.git"), undefined);
  });
});

describe("recognising authentication failures from real git output", () => {
  let server: { base: string; close: () => Promise<void> };
  before(async () => {
    const root = temp("auth-classify");
    makeBareRepository(root, "demo");
    server = await startGitHttpServer({ root, credentials: { username: "alice", password: "right" } });
  });
  after(() => server.close());

  test("HTTPS without credentials: could not read Username", async () => {
    const url = `${server.base}/demo.git`;
    const stderr = await gitStderr(["ls-remote", url]);
    assert.match(stderr, /could not read Username/);
    assert.deepEqual(classifyGitAuthFailure(stderr, url), { scheme: "https", host: httpsHostKey(url) });
  });

  test("HTTPS with a wrong secret: Authentication failed", async () => {
    const url = `${server.base}/demo.git`;
    const withWrong = url.replace("https://", "https://alice:wrong@");
    const stderr = await gitStderr(["ls-remote", withWrong]);
    assert.match(stderr, /Authentication failed|returned error: 401/);
    assert.deepEqual(classifyGitAuthFailure(stderr, withWrong), { scheme: "https", host: httpsHostKey(url) });
  });

  test("a repository that does not exist is not an authentication failure", async () => {
    const stderr = await gitStderr(["ls-remote", path.join(temp("missing"), "nope.git")]);
    assert.ok(stderr.length > 0);
    assert.equal(classifyGitAuthFailure(stderr, "https://git.example.com/nope.git"), undefined);
  });

  test("an unreachable HTTPS host is not an authentication failure", async () => {
    const url = "https://127.0.0.1:1/x.git";
    const stderr = await gitStderr(["ls-remote", url]);
    assert.match(stderr, /fatal:/);
    assert.equal(classifyGitAuthFailure(stderr, url), undefined);
  });

  test("SSH publickey refusal is classified as SSH, with the address's host", () => {
    // ssh's own words; reproducing them needs an sshd, which CI runners do not offer.
    const stderr = "git@git.example.com: Permission denied (publickey).\r\nfatal: Could not read from remote repository.\n";
    assert.deepEqual(classifyGitAuthFailure(stderr, "git@git.example.com:team/x.git"), { scheme: "ssh", host: "git.example.com" });
    assert.equal(classifyGitAuthFailure(stderr, "https://git.example.com/x.git"), undefined, "an SSH phrase on an HTTPS address is not trusted");
  });

  test("the host comes from the address, never from git's text", () => {
    const stderr = "fatal: could not read Username for 'https://attacker.example': terminal prompts disabled\n";
    assert.deepEqual(classifyGitAuthFailure(stderr, "https://git.example.com:8447/x.git"), { scheme: "https", host: "https://git.example.com:8447" });
  });
});

describe("clone from Agent resources", () => {
  let server: { base: string; host: string; close: () => Promise<void> };
  before(async () => {
    const root = temp("auth-clone");
    makeBareRepository(root, "demo");
    server = await startGitHttpServer({ root, credentials: { username: "alice", password: "right" } });
  });
  after(() => server.close());

  // openlore: scenario=An authentication failure is named spec=agent-resource-management
  test("An authentication failure is named: host and authentication, not git's progress line, within the bound", async () => {
    const root = temp("clone-auth");
    const service = new ResourceRepositoryService(path.join(root, "managed"));
    const started = Date.now();
    const failure = await service.cloneAndPreview(`${server.base}/demo.git`, path.join(root, "demo"), false).then(
      () => assert.fail("the clone was expected to fail"),
      (error: unknown) => error,
    );
    assert.ok(Date.now() - started < 20_000, "an authentication failure must not wait for the git timeout");
    assert.ok(failure instanceof ResourceRepositoryError);
    assert.deepEqual(failure.auth, { scheme: "https", host: `https://${server.host}` });
    assert.match(failure.message, new RegExp(`${server.host.replace(".", "\\.")} requires authentication`));
    assert.doesNotMatch(failure.message, /Cloning into/);
  });

  test("an embedded wrong secret is named as authentication and never echoed", async () => {
    const root = temp("clone-wrong");
    const service = new ResourceRepositoryService(path.join(root, "managed"));
    const address = `${server.base}/demo.git`.replace("https://", "https://alice:hunter2-wrong@");
    const failure = await service.cloneAndPreview(address, path.join(root, "demo"), false).then(
      () => assert.fail("the clone was expected to fail"),
      (error: unknown) => error as ResourceRepositoryError,
    );
    assert.equal(failure.auth?.scheme, "https");
    assert.doesNotMatch(failure.message, /hunter2/);
  });
});

/* ── The store ─────────────────────────────────────────────────────────────── */

/** `git credential fill` through the helper alone, as git would consult it. */
async function fill(store: string, request: string): Promise<{ ok: boolean; out: string }> {
  const child = execFile("git", ["credential", "fill"], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, ...isolatedGit, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", ...gitCredentialHelperEnv(store, "git", {}) },
  });
  child.stdin?.end(request);
  return new Promise((resolve) => {
    let out = "";
    child.stdout?.on("data", (chunk) => { out += chunk; });
    child.on("close", (code) => resolve({ ok: code === 0, out }));
  });
}

async function credentialAction(store: string, action: "approve" | "reject", request: string): Promise<void> {
  const child = execFile("git", ["credential", action], { encoding: "utf8", timeout: 20_000, env: { ...process.env, ...isolatedGit, ...gitCredentialHelperEnv(store, "git", {}) } });
  child.stdin?.end(request);
  await new Promise((resolve) => child.on("close", resolve));
}

describe("the store", () => {
  // openlore: scenario=Storing again replaces spec=git-host-credentials
  test("Storing again replaces: one entry per host, the newest", async () => {
    const store = path.join(temp("store-replace"), "git-credentials");
    await storeGitHostCredential(store, "https://git.example.com/a.git", "alice", "one");
    await storeGitHostCredential(store, "git.example.com", "bob", "two");
    assert.deepEqual(await listGitHosts(store), [{ host: "https://git.example.com", username: "bob" }]);
    const { out } = await fill(store, "protocol=https\nhost=git.example.com\n\n");
    assert.match(out, /^username=bob$/m);
    assert.match(out, /^password=two$/m);
  });

  // openlore: scenario=Ports distinguish hosts spec=git-host-credentials
  test("Ports distinguish hosts: a credential for :8447 is not offered to the default port", async () => {
    const store = path.join(temp("store-ports"), "git-credentials");
    await storeGitHostCredential(store, "https://git.example.com:8447", "alice", "s3cret");
    const other = await fill(store, "protocol=https\nhost=git.example.com\n\n");
    assert.equal(other.ok, false, "no credential, and no prompt allowed, so fill fails");
    assert.doesNotMatch(other.out, /s3cret/);
    const same = await fill(store, "protocol=https\nhost=git.example.com:8447\n\n");
    assert.match(same.out, /^password=s3cret$/m);
  });

  // openlore: scenario=The store is private spec=git-host-credentials
  test("The store is private: mode 0600, even over a file that was looser", { skip: process.platform === "win32" }, async () => {
    const store = path.join(temp("store-mode"), "git-credentials");
    writeFileSync(store, "", { mode: 0o644 });
    await storeGitHostCredential(store, "git.example.com", "alice", "s3cret");
    assert.equal(statSync(store).mode & 0o777, 0o600);
  });

  test("only HTTPS hosts are accepted, and line breaks are refused", async () => {
    const store = path.join(temp("store-refuse"), "git-credentials");
    await assert.rejects(storeGitHostCredential(store, "http://git.example.com", "alice", "x"), /HTTPS hosts only/);
    await assert.rejects(storeGitHostCredential(store, "ssh://git@git.example.com/x", "alice", "x"), /HTTPS hosts only/);
    await assert.rejects(storeGitHostCredential(store, "git.example.com", "alice", "x\nhttps://evil"), /line breaks/);
    assert.deepEqual(await listGitHosts(store), []);
  });

  test("characters that mean something in a URL survive the round trip", async () => {
    const store = path.join(temp("store-encoding"), "git-credentials");
    await storeGitHostCredential(store, "git.example.com", "alice@corp", "p@ss:w/rd%");
    const { out } = await fill(store, "protocol=https\nhost=git.example.com\n\n");
    assert.match(out, /^username=alice@corp$/m);
    assert.match(out, /^password=p@ss:w\/rd%$/m);
  });

  test("removing a host deletes only it", async () => {
    const store = path.join(temp("store-remove"), "git-credentials");
    await storeGitHostCredential(store, "a.example.com", "alice", "1");
    await storeGitHostCredential(store, "b.example.com", "bob", "2");
    assert.equal(await removeGitHostCredential(store, "https://a.example.com"), true);
    assert.equal(await removeGitHostCredential(store, "https://a.example.com"), false);
    assert.deepEqual(await listGitHosts(store), [{ host: "https://b.example.com", username: "bob" }]);
  });

  test("concurrent saves are all kept", async () => {
    const store = path.join(temp("store-race"), "git-credentials");
    await Promise.all(["a", "b", "c", "d"].map((name) => storeGitHostCredential(store, `${name}.example.com`, name, name)));
    assert.equal((await listGitHosts(store)).length, 4);
  });
});

describe("the helper is read-only", () => {
  test("git's approve (store) and reject (erase) leave the file as it was", async () => {
    const store = path.join(temp("helper-readonly"), "git-credentials");
    await storeGitHostCredential(store, "git.example.com", "alice", "s3cret");
    const before = readFileSync(store, "utf8");
    await credentialAction(store, "approve", "protocol=https\nhost=other.example.com\nusername=eve\npassword=captured\n\n");
    await credentialAction(store, "reject", "protocol=https\nhost=git.example.com\nusername=alice\npassword=s3cret\n\n");
    assert.equal(readFileSync(store, "utf8"), before);
  });

  test("a missing store file is simply no credential", async () => {
    const result = await fill(path.join(temp("helper-missing"), "absent"), "protocol=https\nhost=git.example.com\n\n");
    assert.equal(result.ok, false);
    assert.equal(result.out, "");
  });

  test("the store's path and secret never appear in a command line", () => {
    const env = gitCredentialHelperEnv("/data/agent/git-credentials", "/usr/bin/git", {});
    assert.equal(env.PI_OUTPOST_GIT_CREDENTIALS, "/data/agent/git-credentials");
    assert.equal(env.GIT_CONFIG_KEY_0, "credential.helper");
    assert.doesNotMatch(String(env.GIT_CONFIG_VALUE_0), /\/data\/agent/);
  });

  test("an existing GIT_CONFIG_COUNT is extended, not overwritten", () => {
    const env = gitCredentialHelperEnv("/x", "git", { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "1" });
    assert.equal(env.GIT_CONFIG_COUNT, "3");
    assert.equal(env.GIT_CONFIG_KEY_2, "credential.helper");
    assert.equal(env.GIT_CONFIG_KEY_0, undefined, "the caller's entries are left to the caller");
  });
});

/* ── Agent resources git, end to end ──────────────────────────────────────── */

describe("Agent resources git with the store", () => {
  let server: { base: string; host: string; requests: { authorized: boolean; user?: string }[]; close: () => Promise<void> };
  before(async () => {
    const root = temp("store-e2e");
    makeBareRepository(root, "demo");
    server = await startGitHttpServer({ root, credentials: { username: "alice", password: "right" } });
  });
  after(async () => {
    useGitCredentialStore();
    useResourceGitObserver();
    await server.close();
  });

  function setup(name: string, locked = false) {
    const root = temp(name);
    const store = path.join(root, "agent", "git-credentials");
    useGitCredentialStore({ file: store, locked });
    return { root, store, service: new ResourceRepositoryService(path.join(root, "managed")) };
  }

  async function enrolled(service: ResourceRepositoryService, clone: string) {
    const skill = path.join(clone, "skills", "demo", "SKILL.md");
    const inventory = await service.buildInventory({
      resources: [{ id: `skill:${skill}`, kind: "skill", name: "demo", origin: "runtime", path: skill }],
      capabilities: { skills: "available", extensions: "available" },
      configuredSkillPaths: [],
      userSkillPaths: [],
      configuredExtensionPaths: [],
      userExtensionPaths: [],
      extensionLock: false,
    });
    return inventory.repositories[0].id;
  }

  // openlore: scenario=A stored credential lets a private repository clone spec=git-host-credentials
  // openlore: scenario=Other git use is unaffected spec=git-host-credentials
  test("A stored credential lets a private repository clone, without any secret on a command line or in this process", async () => {
    const { root, store, service } = setup("clone-with-store");
    await storeGitHostCredential(store, server.base, "alice", "right");
    const seen: { args: readonly string[]; env: Readonly<NodeJS.ProcessEnv> }[] = [];
    useResourceGitObserver((event) => { if (event.phase === "start") seen.push(event); });
    const preview = await service.cloneAndPreview(`${server.base}/demo.git`, path.join(root, "demo"), false);
    useResourceGitObserver();
    assert.deepEqual(preview.skills.map((skill) => skill.name), ["demo"]);
    assert.ok(seen.length > 0);
    for (const { args, env } of seen) {
      assert.doesNotMatch(args.join(" "), /right|git-credentials/);
      assert.doesNotMatch(Object.values(env).join("\n"), /\bright\b/);
    }
    // Only these processes are offered the store: nothing leaked into the server's own environment,
    // which every other git it runs (git.ts, the terminal) inherits.
    assert.equal(process.env.PI_OUTPOST_GIT_CREDENTIALS, undefined);
    assert.ok(!Object.values(process.env).some((value) => value?.includes("credential-store")));
  });

  // openlore: scenario=A stored credential keeps refresh working spec=git-host-credentials
  // openlore: scenario=Removing a host spec=git-host-credentials
  test("A stored credential keeps refresh working, and removing it turns refresh into an authentication failure", async () => {
    const { root, store, service } = setup("refresh-with-store");
    await storeGitHostCredential(store, server.base, "alice", "right");
    const clone = path.join(root, "demo");
    await service.cloneAndPreview(`${server.base}/demo.git`, clone, false);
    const id = await enrolled(service, clone);
    const [fresh] = await service.refresh(id);
    assert.equal(fresh.status, "current", fresh.reason);

    await removeGitHostCredential(store, server.base);
    const [after] = await service.refresh(id);
    assert.equal(after.status, "failed");
    assert.deepEqual(after.auth, { scheme: "https", host: `https://${server.host}` });
    assert.match(after.reason ?? "", /requires authentication/);
  });

  // openlore: scenario=Deployment credentials are not captured spec=git-host-credentials
  test("Deployment credentials are not captured: the deployment's helper answers first and nothing is copied", async () => {
    const { root, store, service } = setup("deployment-first");
    // A wrong credential in our store: if git asked us first, the clone would fail.
    await storeGitHostCredential(store, server.base, "mallory", "wrong");
    const global = isolatedGitConfig(`[credential]\n\thelper = "!f() { test \\"$1\\" = get && printf 'username=alice\\\\npassword=right\\\\n'; }; f"`);
    const previous = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = global;
    try {
      const clone = path.join(root, "demo");
      await service.cloneAndPreview(`${server.base}/demo.git`, clone, false);
      const id = await enrolled(service, clone);
      const [assessment] = await service.refresh(id);
      assert.equal(assessment.status, "current", assessment.reason);
    } finally {
      process.env.GIT_CONFIG_GLOBAL = previous;
    }
    // Still only what we stored ourselves: the deployment's credential was not copied in.
    assert.deepEqual(await listGitHosts(store), [{ host: `https://${server.host}`, username: "mallory" }]);
    assert.doesNotMatch(readFileSync(store, "utf8"), /alice|right/);
  });

  // openlore: scenario=Embedded credentials outlive the clone spec=git-host-credentials
  // openlore: scenario=A failure with a stored credential stays redacted spec=git-host-credentials
  test("Embedded credentials outlive the clone: origin is clean, the store keeps them, refresh authenticates", async () => {
    const { root, store, service } = setup("embedded");
    const clone = path.join(root, "demo");
    await service.cloneAndPreview(`${server.base}/demo.git`.replace("https://", "https://alice:right@"), clone, false);
    const { stdout: origin } = await run("git", ["remote", "get-url", "origin"], { cwd: clone, encoding: "utf8" });
    assert.equal(origin.trim(), `${server.base}/demo.git`);
    assert.doesNotMatch(readFileSync(path.join(clone, ".git", "config"), "utf8"), /right/);
    assert.deepEqual(await listGitHosts(store), [{ host: `https://${server.host}`, username: "alice" }]);
    const id = await enrolled(service, clone);
    assert.equal((await service.refresh(id))[0].status, "current");

    // A stored credential the host now rejects: named, redacted.
    await storeGitHostCredential(store, server.base, "alice", "stale-secret-value");
    const [refused] = await service.refresh(id);
    assert.equal(refused.status, "failed");
    assert.ok(refused.auth);
    assert.doesNotMatch(JSON.stringify(refused), /stale-secret-value/);
  });

  test("under the credentials lock an embedded credential is used for the clone and not stored", async () => {
    const { root, store, service } = setup("embedded-locked", true);
    await service.cloneAndPreview(`${server.base}/demo.git`.replace("https://", "https://alice:right@"), path.join(root, "demo"), false);
    assert.deepEqual(await listGitHosts(store), []);
  });
});
