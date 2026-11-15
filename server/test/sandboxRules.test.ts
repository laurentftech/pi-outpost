/**
 * The user's durable rules and the recorded refusals, per project (`sandboxRules.ts`).
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { checkGrantRequest } from "../src/sandboxGrants.ts";
import { MAX_RECORDED_REFUSALS, rulesDirectory, rulesFile, SandboxRulesStore } from "../src/sandboxRules.ts";

describe("SandboxRulesStore", () => {
  let base: string;
  let agentDir: string;
  let root: string;

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "sandbox-rules-"));
    agentDir = path.join(base, "agent");
    root = path.join(base, "app");
    await mkdir(root, { recursive: true });
    await mkdir(agentDir, { recursive: true });
  });
  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const store = (projectRoot = root) => new SandboxRulesStore({ agentDir, root: projectRoot });

  test("a project without a file has no rules and no refusals", async () => {
    const empty = store(path.join(base, "never"));
    assert.deepEqual(await empty.rules(), []);
    assert.deepEqual(await empty.refusals(), []);
  });

  // openlore: scenario=AnAllowedDirectoryIsReadableInANewSession spec=sandbox-durable-rules
  test("a rule lasts: another store for the same project, as after a restart, reads it back", async () => {
    const beside = path.join(base, "beside");
    const made = await store().setRule({ kind: "directory", target: beside, access: "read", decision: "allow" });
    const again = await new SandboxRulesStore({ agentDir, root: path.join(root, ".") }).rules();
    assert.deepEqual(again, [made]);
    assert.equal(made.kind === "directory" && made.access, "read");
    assert.deepEqual(await store(path.join(base, "other-project")).rules(), [], "per project");
    await store().revoke(made.id);
  });

  test("one rule per resource: a new decision replaces the old, another access is another rule", async () => {
    const s = store();
    const dir = path.join(base, "d");
    await s.setRule({ kind: "directory", target: dir, access: "read", decision: "allow" });
    await s.setRule({ kind: "directory", target: dir, access: "write", decision: "refuse" });
    await s.setRule({ kind: "directory", target: dir, access: "read", decision: "refuse" });
    await s.setRule({ kind: "host", target: "Example.com", decision: "allow" });
    await s.setRule({ kind: "host", target: "example.COM", decision: "refuse" });
    const rules = await s.rules();
    assert.deepEqual(rules.map((rule) => [rule.kind, rule.target, rule.kind === "directory" ? rule.access : "-", rule.decision]), [
      ["directory", dir, "write", "refuse"],
      ["directory", dir, "read", "refuse"],
      ["host", "example.com", "-", "refuse"],
    ]);
    for (const rule of rules) await s.revoke(rule.id);
  });

  test("revoking removes one rule and says whether it was there", async () => {
    const s = store();
    const rule = await s.setRule({ kind: "host", target: "example.org", decision: "allow" });
    assert.equal(await s.revoke(rule.id), true);
    assert.equal(await s.revoke(rule.id), false);
    assert.deepEqual(await s.rules(), []);
  });

  // openlore: scenario=ARefusedFileIsRecordedAgainstItsDirectory spec=sandbox-durable-rules
  test("a refusal is recorded once per resource, with the last command, how often and when", async () => {
    let now = new Date("2026-11-15T10:00:00Z");
    const s = new SandboxRulesStore({ agentDir, root: path.join(base, "record"), now: () => now });
    await s.record({ kind: "directory", target: "/x/other", access: "read", command: "cat a" });
    now = new Date("2026-11-15T11:00:00Z");
    await s.record({ kind: "directory", target: "/x/other", access: "read", command: "cat b" });
    await s.record({ kind: "host", target: "example.com", command: "curl" });
    const recorded = await s.refusals();
    assert.equal(recorded.length, 2);
    assert.deepEqual(recorded[0], { kind: "directory", target: "/x/other", access: "read", command: "cat b", key: "directory:read:/x/other", count: 2, lastSeen: "2026-11-15T11:00:00.000Z" });
    assert.equal(recorded[1].kind, "host");
  });

  test("the record keeps the most recent, to a bound", async () => {
    const s = store(path.join(base, "bounded"));
    for (let i = 0; i < MAX_RECORDED_REFUSALS + 5; i++) await s.record({ kind: "host", target: `h${i}.example.com`, command: "c" });
    const recorded = await s.refusals();
    assert.equal(recorded.length, MAX_RECORDED_REFUSALS);
    assert.equal(recorded[0].target, "h5.example.com");
  });

  test("writes at once are all kept, and no temporary file is left", async () => {
    const s = store(path.join(base, "concurrent"));
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.setRule({ kind: "host", target: `c${i}.example.com`, decision: "allow" })));
    assert.equal((await s.rules()).length, 20);
    assert.deepEqual((await readdir(rulesDirectory(agentDir))).filter((name) => name.endsWith(".tmp")), []);
  });

  test("the file is named by a hash: no path of the project in it, and a file for another root is refused", async () => {
    const file = rulesFile(agentDir, root);
    assert.match(path.basename(file), /^[0-9a-f]{32}\.json$/);
    assert.ok(file.startsWith(path.join(agentDir, "pi-outpost", "sandbox-rules")));
    const forged = path.join(base, "forged");
    await mkdir(path.dirname(rulesFile(agentDir, forged)), { recursive: true });
    await writeFile(rulesFile(agentDir, forged), JSON.stringify({ version: 1, root: "/elsewhere", rules: [{ id: "x", kind: "host", target: "a.com", decision: "allow" }], refusals: [] }));
    await assert.rejects(store(forged).rules(), /another project/);
  });

  test("an entry that is not a rule is dropped on read", async () => {
    const odd = path.join(base, "odd");
    await mkdir(path.dirname(rulesFile(agentDir, odd)), { recursive: true });
    await writeFile(rulesFile(agentDir, odd), JSON.stringify({ version: 1, root: odd, rules: [{ id: "a", kind: "host", target: "a.com", decision: "maybe" }, { id: "b", kind: "directory", target: "/d", decision: "allow" }, { id: "c", kind: "host", target: "c.com", decision: "allow" }], refusals: [] }));
    assert.deepEqual((await store(odd).rules()).map((rule) => rule.id), ["c"]);
    assert.match(await readFile(rulesFile(agentDir, odd), "utf8"), /"maybe"/, "reading changes nothing");
  });

  // openlore: scenario=ACommandCannotReachTheRules spec=sandbox-durable-rules
  test("a grant on the store of rules is refused before anyone is asked", async () => {
    await store().setRule({ kind: "host", target: "g.example.com", decision: "allow" });
    for (const target of [rulesDirectory(agentDir), rulesFile(agentDir, root)]) {
      const check = await checkGrantRequest({ directories: [{ path: target, access: "read" }] }, { root, allowWrite: true, agentDir });
      assert.equal(check.ok, false, target);
    }
  });
});
