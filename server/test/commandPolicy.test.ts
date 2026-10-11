/**
 * The operator's rule over slash commands: what the composer is offered, what a prompt
 * may invoke, and how the configuration declares it. The wire-level proof — a real
 * extension, a real connection — is `commandPolicyWire.test.mjs`.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { CommandInfo } from "@pi-outpost/shared";
import { commandOffered, invokedCommand, normalizeCommandPattern, offeredCommands, refusesPrompt } from "../src/commandPolicy.ts";
import { loadConfig } from "../src/config.ts";

const COMMANDS: CommandInfo[] = [
  { name: "setup-creds", source: "extension" },
  { name: "config-capture", source: "extension" },
  { name: "status", source: "extension" },
  { name: "review", source: "prompt" },
  { name: "skill:internal-audit", source: "skill" },
  { name: "skill:docs", source: "skill" },
];
const names = (commands: CommandInfo[]) => commands.map((command) => command.name);

describe("what the composer is offered", () => {
  test("no rule offers everything", () => {
    assert.deepEqual(names(offeredCommands(COMMANDS, {})), names(COMMANDS));
  });

  test("a blocked pattern leaves its commands out, skills included, whatever the case", () => {
    const offered = offeredCommands(COMMANDS, { blocked: ["setup*", "CONFIG-*", "skill:internal-?????"] });
    assert.deepEqual(names(offered), ["status", "review", "skill:docs"]);
  });

  test("an allowlist offers only what it names, and a blocked pattern still wins over it", () => {
    assert.deepEqual(names(offeredCommands(COMMANDS, { allowed: ["status", "skill:*"] })), ["status", "skill:internal-audit", "skill:docs"]);
    assert.deepEqual(names(offeredCommands(COMMANDS, { allowed: ["status", "skill:*"], blocked: ["skill:internal-*"] })), ["status", "skill:docs"]);
  });

  test("glob characters are the only special ones: a dot or a bracket means itself", () => {
    assert.equal(commandOffered("setupXcreds", { blocked: ["setup.creds"] }), true);
    assert.equal(commandOffered("setup.creds", { blocked: ["setup.creds"] }), false);
    assert.equal(commandOffered("a", { blocked: ["[a]"] }), true);
  });
});

describe("what a prompt may invoke", () => {
  test("the command is the first word after the slash", () => {
    assert.equal(invokedCommand("/setup-creds now"), "setup-creds");
    assert.equal(invokedCommand("  /skill:docs\nwith a body"), "skill:docs");
    assert.equal(invokedCommand("/status"), "status");
    assert.equal(invokedCommand("hello /setup-creds"), undefined);
    assert.equal(invokedCommand("/etc/hosts is wrong"), undefined);
    assert.equal(invokedCommand("/"), undefined);
  });

  test("a blocked name is refused whether it exists or not, and in any case", () => {
    const policy = { blocked: ["setup*"] };
    assert.equal(refusesPrompt("/setup-creds key=abc", policy, COMMANDS), true);
    assert.equal(refusesPrompt("/SETUP-creds", policy, COMMANDS), true);
    assert.equal(refusesPrompt("/setup-anything-unregistered", policy, COMMANDS), true);
    assert.equal(refusesPrompt("/status", policy, COMMANDS), false);
    assert.equal(refusesPrompt("please run setup-creds", policy, COMMANDS), false);
  });

  test("an allowlist refuses a registered command it does not name, never a plain message", () => {
    const policy = { allowed: ["status"] };
    assert.equal(refusesPrompt("/setup-creds", policy, COMMANDS), true);
    assert.equal(refusesPrompt("/Review this", policy, COMMANDS), true);
    assert.equal(refusesPrompt("/status", policy, COMMANDS), false);
    // Not a command the runtime has: a message that begins with a slash.
    assert.equal(refusesPrompt("/tmp is full", policy, COMMANDS), false);
    assert.equal(refusesPrompt("/unknown thing", policy, COMMANDS), false);
  });

  test("no rule refuses nothing", () => {
    assert.equal(refusesPrompt("/setup-creds", {}, COMMANDS), false);
  });
});

describe("the configuration", () => {
  const roots: string[] = [];
  after(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  async function load(raw: Record<string, unknown>) {
    const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-command-policy-"));
    roots.push(root);
    await writeFile(path.join(root, "pi-outpost.config.json"), JSON.stringify(raw));
    return loadConfig(root, {}, { HOME: root } as NodeJS.ProcessEnv);
  }

  test("reads both lists, a leading slash forgiven", async () => {
    const config = await load({ blockedCommands: ["/setup*", " config-* "], allowedCommands: ["status"] });
    assert.deepEqual(config.blockedCommands, ["setup*", "config-*"]);
    assert.deepEqual(config.allowedCommands, ["status"]);
    assert.equal(normalizeCommandPattern("//x"), "x");
  });

  test("leaves both out when not declared", async () => {
    const config = await load({});
    assert.equal(config.blockedCommands, undefined);
    assert.equal(config.allowedCommands, undefined);
  });

  test("refuses at startup what cannot be a command name", async () => {
    await assert.rejects(load({ blockedCommands: "setup*" }), /"blockedCommands" must be an array of strings/);
    await assert.rejects(load({ blockedCommands: ["/"] }), /"blockedCommands\[0\]" must name a command/);
    await assert.rejects(load({ allowedCommands: ["status", "two words"] }), /"allowedCommands\[1\]" must be a command name without spaces/);
  });
});
