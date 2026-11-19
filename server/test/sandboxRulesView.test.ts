/**
 * The project's rules and recorded refusals as the interface shows them, and the rules the user
 * makes there from a refusal (`sandboxRulesView.ts`). The store itself is `sandboxRules.test.ts`'s.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { SandboxConfig } from "../src/config.ts";
import type { GrantContext } from "../src/sandboxGrants.ts";
import { SandboxRulesStore } from "../src/sandboxRules.ts";
import { fileReporting, ruleFromRefusal, rulesEnabled, rulesState } from "../src/sandboxRulesView.ts";

const confined: SandboxConfig = { allowWrite: true, allowBash: true, bashRunner: "/usr/local/bin/landstrip" } as SandboxConfig;

describe("rulesEnabled", () => {
  test("rules are on for a confined shell, unless grants are never", () => {
    assert.equal(rulesEnabled(confined), true);
    assert.equal(rulesEnabled({ ...confined, grants: "ask" } as SandboxConfig), true);
    assert.equal(rulesEnabled({ ...confined, grants: "never" } as SandboxConfig), false);
  });

  test("no sandbox, no shell or no runner: no rules", () => {
    assert.equal(rulesEnabled(undefined), false);
    assert.equal(rulesEnabled({ ...confined, allowBash: false } as SandboxConfig), false);
    assert.equal(rulesEnabled({ ...confined, bashRunner: undefined } as SandboxConfig), false);
  });
});

describe("the rules view", () => {
  let base: string;
  let agentDir: string;
  let root: string;
  let beside: string;
  let context: GrantContext;
  let projects = 0;

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "sandbox-rules-view-"));
    agentDir = path.join(base, "agent");
    root = path.join(base, "app");
    beside = path.join(base, "beside");
    await mkdir(agentDir, { recursive: true });
    await mkdir(root, { recursive: true });
    await mkdir(beside, { recursive: true });
    context = { root, allowWrite: true, agentDir, home: path.join(base, "home") };
  });
  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** A store of its own for each test: one project's file, nothing left over from another test. */
  const freshStore = async () => {
    const projectRoot = path.join(base, `project-${++projects}`);
    await mkdir(projectRoot, { recursive: true });
    return new SandboxRulesStore({ agentDir, root: projectRoot });
  };
  const keyOf = async (store: SandboxRulesStore, target: string) => (await store.refusals()).find((r) => r.target === target)!.key;

  test("refusals are shown most recent first, each with what it is and how often it was met", async () => {
    const store = await freshStore();
    await store.record({ kind: "directory", target: beside, access: "read", command: "cat ../beside/a" });
    await store.record({ kind: "host", target: "example.com", command: "curl example.com" });
    await store.record({ kind: "host", target: "example.com", command: "curl https://example.com" });
    await store.record({ kind: "info", target: "[::1]:0", detail: "network bind", command: "python3 -m http.server" });

    const state = await rulesState(store, confined, context, "linux");

    assert.deepEqual(
      state.refusals.map((r) => [r.kind, r.target, r.count]),
      [
        ["info", "[::1]:0", 1],
        ["host", "example.com", 2],
        ["directory", beside, 1],
      ],
    );
    const [info, host, directory] = state.refusals;
    // Each carries only the fields of its kind.
    assert.equal(info!.detail, "network bind");
    assert.equal("access" in info!, false);
    assert.equal(host!.command, "curl https://example.com", "the last command that met it");
    assert.equal("access" in host!, false);
    assert.equal("detail" in host!, false);
    assert.equal(directory!.access, "read");
    assert.equal("detail" in directory!, false);
    assert.equal(state.enabled, true);
    assert.equal(state.files, "reported");
    assert.deepEqual(state.rules, []);
  });

  test("a refusal no rule can name, or a target never granted, says why always allow is not offered", async () => {
    const store = await freshStore();
    await store.record({ kind: "info", target: "[::1]:0", detail: "network bind", command: "x" });
    await store.record({ kind: "host", target: "localhost", command: "curl localhost" });
    await store.record({ kind: "host", target: "pypi.org", command: "pip install" });
    await store.record({ kind: "directory", target: agentDir, access: "read", command: "cat keys" });
    await store.record({ kind: "directory", target: beside, access: "write", command: "touch ../beside/x" });

    const why = Object.fromEntries((await rulesState(store, confined, context, "linux")).refusals.map((r) => [r.target, r.notAllowable]));

    assert.match(why["[::1]:0"]!, /neither a directory nor a host/);
    assert.match(why.localhost!, /^never granted: the loopback is never granted/);
    assert.match(why[agentDir]!, /^never granted: the agent directory holds the provider keys/);
    assert.equal(why["pypi.org"], undefined, "an ordinary host can take an always-allow rule");
    assert.equal(why[beside], undefined, "an ordinary directory too");
  });

  test("a refusal shows the rule on its resource: a host whatever its case, a directory for the same access only", async () => {
    const store = await freshStore();
    await store.record({ kind: "host", target: "Example.COM", command: "curl" });
    await store.record({ kind: "directory", target: beside, access: "read", command: "cat" });
    await store.record({ kind: "directory", target: beside, access: "write", command: "touch" });
    const hostRule = await store.setRule({ kind: "host", target: "example.com", decision: "refuse" });
    const readRule = await store.setRule({ kind: "directory", target: beside, access: "read", decision: "allow" });

    const state = await rulesState(store, confined, context, process.platform);
    const ruleOf = (target: string, access?: string) => state.refusals.find((r) => r.target === target && r.access === access)!.ruleId;

    assert.equal(ruleOf("Example.COM"), hostRule.id);
    assert.equal(ruleOf(beside, "read"), readRule.id);
    assert.equal(ruleOf(beside, "write"), undefined, "a read rule is not a rule on writing there");
    assert.deepEqual(
      state.rules.map((r) => r.id),
      [hostRule.id, readRule.id],
    );
  });

  test("on Windows a directory rule matches its refusal whatever the case of the path", async () => {
    const store = await freshStore();
    await store.record({ kind: "directory", target: "C:\\Users\\U\\Data", access: "read", command: "type" });
    const rule = await store.setRule({ kind: "directory", target: "C:\\Users\\U\\Data", access: "read", decision: "allow" });
    // What the store kept, as the rule's own spelling, against a refusal spelled otherwise.
    await store.record({ kind: "directory", target: rule.target.toUpperCase(), access: "read", command: "dir" });

    const windows = await rulesState(store, confined, { ...context, platform: "win32" }, "win32");
    const upper = windows.refusals.find((r) => r.target === rule.target.toUpperCase())!;
    assert.equal(upper.ruleId, rule.id);

    const linux = await rulesState(store, confined, context, "linux");
    const elsewhere = linux.refusals.find((r) => r.target === rule.target.toUpperCase())!;
    assert.equal(elsewhere.ruleId, undefined, "elsewhere a path's case is part of its name");
  });

  test("with grants never, rules are off and say so; with no runner, files are not reported", async () => {
    const store = await freshStore();
    const off = await rulesState(store, { ...confined, grants: "never" } as SandboxConfig, context, "linux");
    assert.equal(off.enabled, false);
    // On this host's platform, as the server asks it.
    const none = await rulesState(store, undefined, context);
    assert.equal(none.enabled, false);
    assert.equal(none.files, "not-reported");
    assert.equal(fileReporting(undefined), "not-reported");
  });

  // openlore: scenario=ARuleIsMadeFromARecordedRefusal spec=sandbox-durable-rules
  test("always allow on a recorded host, and always refuse on a recorded directory, become rules", async () => {
    const store = await freshStore();
    await store.record({ kind: "host", target: "pypi.org", command: "pip install" });
    await store.record({ kind: "directory", target: beside, access: "write", command: "touch" });

    assert.deepEqual(await ruleFromRefusal(store, confined, context, await keyOf(store, "pypi.org"), "allow"), { ok: true });
    assert.deepEqual(await ruleFromRefusal(store, confined, context, await keyOf(store, beside), "refuse"), { ok: true });

    const rules = await store.rules();
    assert.deepEqual(
      rules.map((r) => (r.kind === "host" ? [r.kind, r.target, r.decision] : [r.kind, r.target, r.access, r.decision])),
      [
        ["host", "pypi.org", "allow"],
        ["directory", path.resolve(beside), "write", "refuse"],
      ],
    );
  });

  // openlore: scenario=TheAgentDirectoryTakesNoRule spec=sandbox-durable-rules
  test("always allow is refused on a target never granted, with the reason; always refuse is not", async () => {
    const store = await freshStore();
    await store.record({ kind: "directory", target: agentDir, access: "read", command: "cat keys" });
    await store.record({ kind: "host", target: "localhost", command: "curl localhost" });

    const directory = await ruleFromRefusal(store, confined, context, await keyOf(store, agentDir), "allow");
    assert.equal(directory.ok, false);
    assert.match((directory as { message: string }).message, new RegExp(`^Always allow is not offered for .*: never granted: the agent directory holds the provider keys\\.$`));
    const host = await ruleFromRefusal(store, confined, context, await keyOf(store, "localhost"), "allow");
    assert.equal(host.ok, false);
    assert.match((host as { message: string }).message, /^Always allow is not offered for localhost: never granted: the loopback/);
    assert.deepEqual(await store.rules(), [], "nothing was made");

    assert.deepEqual(await ruleFromRefusal(store, confined, context, await keyOf(store, "localhost"), "refuse"), { ok: true });
    assert.deepEqual(
      (await store.rules()).map((r) => [r.target, r.decision]),
      [["localhost", "refuse"]],
    );
  });

  // openlore: scenario=NeverMeansNoRules spec=sandbox-durable-rules
  test("no rule is made while rules are off, from a refusal no longer recorded, or from information", async () => {
    const store = await freshStore();
    await store.record({ kind: "host", target: "pypi.org", command: "pip install" });
    await store.record({ kind: "info", target: "[::1]:0", detail: "network bind", command: "x" });

    assert.deepEqual(await ruleFromRefusal(store, { ...confined, grants: "never" } as SandboxConfig, context, await keyOf(store, "pypi.org"), "allow"), {
      ok: false,
      message: 'Rules are off for this project: sandbox.grants is "never".',
    });
    assert.deepEqual(await ruleFromRefusal(store, confined, context, "no-such-key", "refuse"), { ok: false, message: "That refusal is no longer recorded." });
    assert.deepEqual(await ruleFromRefusal(store, confined, context, await keyOf(store, "[::1]:0"), "refuse"), {
      ok: false,
      message: "No rule can name it: it is neither a directory nor a host.",
    });
    assert.deepEqual(await store.rules(), []);
  });
});
