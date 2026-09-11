/**
 * Collection skills at the real boundary: a server booted from a configuration
 * that enrolls a collection, its embedded agent, and that agent's own read tool.
 *
 * The configuration-level tests prove the path lists; these prove the session
 * that the lists produce — the skill that is on is loaded and readable although
 * it lies outside the sandbox, and the skill that is off is neither.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/sandbox-settings-provider.mjs", import.meta.url));

async function waitForFile(file, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await readFile(file, "utf8").catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("the agent never returned its read result");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function collectionProject() {
  const project = await realpath(await makeWorkspace());
  const sandboxRoot = path.join(project, "workspace");
  const repo = path.join(project, "resources", "collection");
  await mkdir(sandboxRoot);
  for (const [relative, body] of [["group/on-skill", "ON_SKILL_BODY"], ["group/off-skill", "OFF_SKILL_BODY"]]) {
    const dir = path.join(repo, ...relative.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${path.basename(relative)}\ndescription: A collection skill for tests\n---\n\n${body}\n`,
    );
  }
  return { project, sandboxRoot, repo };
}

async function bootAndRead(t, { project, sandboxRoot, repo }, readPath) {
  const log = path.join(project, "collection-read.json");
  const server = await startServer(
    project,
    {
      sandbox: { root: sandboxRoot, allowWrite: false, allowBash: false },
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "sandbox-settings-test", id: "sandbox-settings-test" }],
      userSkillCollections: [{ path: repo, managed: false, enabledSkills: ["group/on-skill"] }],
    },
    { env: { SANDBOX_SETTINGS_LOG: log, SANDBOX_SETTINGS_READ_PATH: readPath } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", provider: "sandbox-settings-test", id: "sandbox-settings-test" });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "Read the matching skill before answering." });
  return { hello, toolResult: await waitForFile(log) };
}

const skillNames = (hello) => (hello.commands ?? []).filter((c) => c.source === "skill").map((c) => c.name);

// openlore: scenario=TurningOneSkillOnLoadsThatSkillAlone spec=agent-resource-management
test("an enabled collection skill outside the sandbox is loaded and readable", async (t) => {
  const setup = await collectionProject();
  const { hello, toolResult } = await bootAndRead(t, setup, path.join(setup.repo, "group", "on-skill", "SKILL.md"));
  assert.ok(skillNames(hello).includes("skill:on-skill"), `on-skill is loaded: ${JSON.stringify(skillNames(hello))}`);
  assert.ok(!skillNames(hello).includes("skill:off-skill"), "off-skill is not loaded");
  assert.match(toolResult, /ON_SKILL_BODY/, "the agent's read tool reaches the enabled skill");
  assert.doesNotMatch(toolResult, /Access denied|outside the sandbox/);
});

test("a collection skill that is off is not readable outside the sandbox", async (t) => {
  const setup = await collectionProject();
  const { toolResult } = await bootAndRead(t, setup, path.join(setup.repo, "group", "off-skill", "SKILL.md"));
  assert.doesNotMatch(toolResult, /OFF_SKILL_BODY/, "a skill that is off grants no read access");
  assert.match(toolResult, /Access denied|outside the sandbox/i);
});
