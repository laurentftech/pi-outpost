/**
 * The user's rules where they apply: what they say of a request, the always-allow directories a
 * launch is given, and `run_with_grant` answered by a rule. A launch's host rules and directories
 * are `confinedBash.test.ts`'s.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { allowRuleGrant } from "../src/sandbox.ts";
import { createRunWithGrantToolDefinition } from "../src/sandboxGrantTool.ts";
import { directoryDecision, hostDecision, SandboxRulesStore, type SandboxRule } from "../src/sandboxRules.ts";

const rule = (r: Omit<Extract<SandboxRule, { kind: "directory" }>, "id" | "createdAt" | "kind">): SandboxRule => ({ id: r.target + r.access + r.decision, createdAt: "", kind: "directory", ...r });

describe("what the rules say", () => {
  test("of a host: the rule naming it, without case", () => {
    const rules: SandboxRule[] = [{ id: "1", createdAt: "", kind: "host", target: "example.com", decision: "refuse" }];
    assert.equal(hostDecision(rules, "Example.COM"), "refuse");
    assert.equal(hostDecision(rules, "sub.example.com"), undefined, "a rule names one host");
  });

  test("of a directory: an allow covers its subtree with enough access; a refuse covers it and what holds it, and wins", () => {
    const p = path.posix;
    const rules = [rule({ target: "/a", access: "read", decision: "allow" }), rule({ target: "/w", access: "write", decision: "allow" }), rule({ target: "/a/secret", access: "read", decision: "refuse" })];
    assert.equal(directoryDecision(rules, p.join("/a", "b"), "read", "linux"), "allow");
    assert.equal(directoryDecision(rules, "/a/b", "write", "linux"), undefined, "a read rule does not allow writing");
    assert.equal(directoryDecision(rules, "/w/x", "read", "linux"), "allow", "a write rule covers reading");
    assert.equal(directoryDecision(rules, "/a/secret/x", "read", "linux"), "refuse");
    assert.equal(directoryDecision(rules, "/a", "read", "linux"), "refuse", "granting the parent would grant what was refused");
    assert.equal(directoryDecision(rules, "/ab", "read", "linux"), undefined, "a sibling with a longer name is not inside");
    const writeRefused = [rule({ target: "/d", access: "write", decision: "refuse" })];
    assert.equal(directoryDecision(writeRefused, "/d", "read", "linux"), undefined, "refusing writes leaves reading to ask");
    assert.equal(directoryDecision(writeRefused, "/d", "write", "linux"), "refuse");
    assert.equal(directoryDecision([rule({ target: "C:\\Data", access: "read", decision: "allow" })], "c:\\data\\x", "read", "win32"), "allow", "Windows compares without case");
  });
});

describe("rules applied", () => {
  let base: string;
  let root: string;
  let agentDir: string;
  let beside: string;

  before(async () => {
    base = await realpath(await mkdtemp(path.join(tmpdir(), "rules-applied-")));
    root = path.join(base, "app");
    agentDir = path.join(base, "agent");
    beside = path.join(base, "beside");
    for (const dir of [root, agentDir, beside]) await mkdir(dir, { recursive: true });
  });
  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const context = () => ({ root, allowWrite: true, agentDir, home: path.join(base, "home") });

  test("a launch is given each always-allow directory; not a deleted one, not one never grantable, not what the sandbox gives, not a refuse", async () => {
    const store = new SandboxRulesStore({ agentDir, root: path.join(base, "p1") });
    await store.setRule({ kind: "directory", target: beside, access: "read", decision: "allow" });
    await store.setRule({ kind: "directory", target: path.join(base, "gone"), access: "read", decision: "allow" });
    await store.setRule({ kind: "directory", target: agentDir, access: "read", decision: "allow" });
    await store.setRule({ kind: "directory", target: path.join(root), access: "write", decision: "allow" });
    await mkdir(path.join(base, "refused"), { recursive: true });
    await store.setRule({ kind: "directory", target: path.join(base, "refused"), access: "read", decision: "refuse" });
    await store.setRule({ kind: "host", target: "example.com", decision: "allow" });
    const grant = await allowRuleGrant(store, context());
    assert.deepEqual(grant, { hosts: [], directories: [{ path: beside, access: "read" }] });
  });

  test("a revoked rule is not given to the next launch", async () => {
    const store = new SandboxRulesStore({ agentDir, root: path.join(base, "p2") });
    const made = await store.setRule({ kind: "directory", target: beside, access: "read", decision: "allow" });
    assert.equal((await allowRuleGrant(store, context())).directories.length, 1);
    await store.revoke(made.id);
    assert.equal((await allowRuleGrant(store, context())).directories.length, 0);
  });

  function grantTool(rules: SandboxRule[] | (() => Promise<SandboxRule[]>), answer = "approved-once") {
    const asked: unknown[] = [];
    const runs: unknown[] = [];
    const definition = createRunWithGrantToolDefinition({
      broker: { ask: async (request: unknown) => (asked.push(request), answer), log: () => {} },
      context,
      shellTool: "bash",
      rules: typeof rules === "function" ? rules : async () => rules,
      run: async (grant: unknown) => (runs.push(grant), { content: [{ type: "text", text: "result" }], details: {} }),
    } as never);
    const execute = definition.execute as unknown as (...args: unknown[]) => Promise<{ content: Array<{ text?: string }> }>;
    return { asked, runs, execute };
  }

  // openlore: scenario=AnAlwaysRefuseRuleAnswersWithoutAsking spec=sandbox-durable-rules
  test("an always-refuse rule refuses a directory request at once, naming the rule, and runs nothing", async () => {
    const tool = grantTool([rule({ target: beside, access: "read", decision: "refuse" })]);
    await assert.rejects(tool.execute("c", { command: "cat x", reason: "r", directories: [{ path: beside, access: "read" }] }), /a rule of the user's always refuses .*beside.*did not run/);
    assert.equal(tool.asked.length, 0);
    assert.equal(tool.runs.length, 0);
  });

  test("an always-allow rule needs no question: the directory is given to every launch already", async () => {
    const tool = grantTool([rule({ target: beside, access: "write", decision: "allow" })]);
    const result = await tool.execute("c", { command: "cat x", reason: "r", directories: [{ path: path.join(beside), access: "read" }] });
    assert.equal(tool.asked.length, 0);
    assert.match(result.content[0]?.text ?? "", /already gives/);
  });

  // openlore: scenario=TheAgentCannotMakeARule spec=sandbox-durable-rules
  test("the agent's request approved for this command makes no rule", async () => {
    const store = new SandboxRulesStore({ agentDir, root: path.join(base, "p3") });
    const tool = grantTool(() => store.rules(), "approved-once");
    await tool.execute("c", { command: "cat x", reason: "r", directories: [{ path: beside, access: "read" }] });
    assert.equal(tool.asked.length, 1);
    assert.equal(tool.runs.length, 1);
    assert.deepEqual(await store.rules(), []);
    const parameters = createRunWithGrantToolDefinition({ broker: {}, context, shellTool: "bash", run: async () => ({}) } as never).parameters as unknown as { properties: object };
    const names = Object.keys(parameters.properties);
    assert.deepEqual(names.sort(), ["command", "directories", "reason", "timeout"], "no parameter of the agent's tool speaks of rules");
  });
});
