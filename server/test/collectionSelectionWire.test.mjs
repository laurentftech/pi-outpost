/**
 * Turning collection skills on and off over the real socket.
 *
 * Each assertion reads what the replacement session loaded (the inventory's
 * loaded resources) and what reached the configuration file, never only the
 * acknowledgement.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { startScriptedServer } from "./multiProjectHarness.mjs";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();
const VETO = fileURLToPath(new URL("./fixtures/veto-session-switch.mjs", import.meta.url));

function run(cwd, args) {
  return execFileSync(git, args, { cwd, encoding: "utf8" }).trim();
}

const SKILLS = [["dev-skills/react", "react"], ["dev-skills/rust", "rust"], ["agent-skills/a2a", "a2a"]];

async function writeSkill(root, relative, name) {
  await mkdir(path.join(root, ...relative.split("/")), { recursive: true });
  await writeFile(path.join(root, ...relative.split("/"), "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill.\n---\n`);
}

/** A bare remote, its seed, and a checkout of it registered as a collection. */
async function collectionCheckout(root) {
  const remote = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  const checkout = path.join(root, "collection");
  await mkdir(remote);
  run(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  await mkdir(seed);
  run(seed, ["init", "-q", "--initial-branch=main"]);
  run(seed, ["config", "user.email", "test@example.com"]);
  run(seed, ["config", "user.name", "Selection Test"]);
  run(seed, ["config", "commit.gpgsign", "false"]);
  for (const [relative, name] of SKILLS) await writeSkill(seed, relative, name);
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "initial"]);
  run(seed, ["remote", "add", "origin", remote]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  run(root, ["clone", "-q", remote, checkout]);
  return { seed, checkout };
}

async function inventoryOf(client, hello) {
  if (hello.agentResources) return hello.agentResources;
  return (await client.waitFor((message) => message.type === "agent_resource_inventory", 180_000)).inventory;
}

async function setSkills(client, repositoryId, enabledSkills, requestId) {
  client.send({ type: "set_agent_resource_skills", repositoryId, enabledSkills, requestId });
  return client.waitFor(
    (message) => (message.type === "agent_resource_skills_applied" || message.type === "agent_resource_error") && message.requestId === requestId,
    180_000,
  );
}

const loadedUnder = (inventory, root) =>
  inventory.resources.filter((resource) => resource.kind === "skill" && resource.path?.startsWith(root + path.sep)).map((resource) => resource.name).sort();

const persistedSelection = async (server) =>
  JSON.parse(await readFile(server.configFile, "utf8")).userSkillCollections?.[0]?.enabledSkills;

async function bootWithCollection(t, enabledSkills = [], extra = {}) {
  const root = await realpath(await makeWorkspace());
  const { seed, checkout } = await collectionCheckout(root);
  const server = await startServer(root, { userSkillCollections: [{ path: checkout, managed: false, enabledSkills }], ...extra });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 180_000);
  const repository = (await inventoryOf(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  assert.ok(repository, "the collection is in the inventory");
  return { root, seed, checkout, server, client, repository };
}

// openlore: scenario=TurningOneSkillOnLoadsThatSkillAlone spec=agent-resource-management
// openlore: scenario=AllOnAndAllOffForTheRepository spec=agent-resource-management
// openlore: scenario=AllOnForOneFolderGroup spec=agent-resource-management
test("one skill, all on, one group, all off: the session loads exactly what is on", async (t) => {
  const { checkout, server, client, repository } = await bootWithCollection(t);

  const one = await setSkills(client, repository.id, ["dev-skills/rust"], "one");
  assert.equal(one.type, "agent_resource_skills_applied", one.message);
  assert.deepEqual(loadedUnder(one.inventory, checkout), ["rust"]);
  assert.deepEqual(await persistedSelection(server), ["dev-skills/rust"]);
  const state = (inventory) => Object.fromEntries(
    inventory.repositories.find((candidate) => candidate.id === repository.id).collection.skills.map((skill) => [skill.relativePath, skill.state]),
  );
  assert.deepEqual(state(one.inventory), { "agent-skills/a2a": "off", "dev-skills/react": "off", "dev-skills/rust": "on-loaded" });

  const all = await setSkills(client, repository.id, SKILLS.map(([relative]) => relative), "all-on");
  assert.deepEqual(loadedUnder(all.inventory, checkout), ["a2a", "react", "rust"]);

  const group = await setSkills(client, repository.id, ["dev-skills/react", "dev-skills/rust"], "group");
  assert.deepEqual(loadedUnder(group.inventory, checkout), ["react", "rust"], "only the dev-skills group");

  const none = await setSkills(client, repository.id, [], "all-off");
  assert.deepEqual(loadedUnder(none.inventory, checkout), []);
  assert.deepEqual(await persistedSelection(server), []);
});

// openlore: scenario=ASelectionOutsideTheCatalogueIsRefused spec=agent-resource-management
test("a selection outside the catalogue, a path leaving the repository, or an unknown id is refused", async (t) => {
  const { server, client, repository } = await bootWithCollection(t, ["dev-skills/react"]);
  for (const [enabled, id, requestId, pattern] of [
    [["dev-skills/none"], repository.id, "stranger", /not in this repository/],
    [["../escape"], repository.id, "escape", /not in this repository/],
    [["dev-skills/react"], "resource-repo:not-issued", "unknown", /unknown resource repository/i],
  ]) {
    const answer = await setSkills(client, id, enabled, requestId);
    assert.equal(answer.type, "agent_resource_error", `${requestId} is refused`);
    assert.match(answer.message, pattern);
  }
  assert.deepEqual(await persistedSelection(server), ["dev-skills/react"], "nothing was persisted");
  assert.equal(client.received.some((message) => message.type === "session_replaced"), false, "the session was not replaced");
});

// openlore: scenario=ARefusedReplacementKeepsThePreviousSelection spec=agent-resource-management
test("a vetoed replacement keeps the previous selection", async (t) => {
  const { checkout, server, client, repository } = await bootWithCollection(t, ["dev-skills/react"], { extensionPaths: [VETO] });
  const answer = await setSkills(client, repository.id, ["agent-skills/a2a"], "vetoed");
  assert.equal(answer.type, "agent_resource_error");
  assert.match(answer.message, /cancelled by an extension/i);
  assert.deepEqual(await persistedSelection(server), ["dev-skills/react"]);
  client.send({ type: "refresh_agent_resource_repositories", repositoryId: repository.id, requestId: "after-veto" });
  await client.waitFor((message) => message.type === "agent_resource_assessments" && message.requestId === "after-veto");
  const observer = connect(server.wsUrl());
  t.after(() => observer.close());
  const hello = await observer.waitFor("hello", 180_000);
  assert.deepEqual(loadedUnder(await inventoryOf(observer, hello), checkout), ["react"], "the retained session still loads the old selection");
});

// openlore: scenario=ABusyWorkspaceBlocksASelectionChange spec=agent-resource-management
test("a busy workspace loading the collection blocks a selection change, naming it", async (t) => {
  const root = await realpath(await makeWorkspace());
  const beta = await realpath(await makeWorkspace());
  const { checkout } = await collectionCheckout(root);
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "busy-collection", isStreaming: false },
    commands_: { prompt: { after: [{ type: "agent_start" }] } },
  }, { userSkillCollections: [{ path: checkout, managed: false, enabledSkills: ["dev-skills/react"] }] });
  t.after(() => server.stop());
  const alpha = connect(server.wsUrl());
  const worker = connect(server.wsUrl());
  t.after(() => { alpha.close(); worker.close(); });
  const hello = await alpha.waitFor("hello");
  await worker.waitFor("hello");
  worker.send({ type: "switch_workspace", root: beta });
  await worker.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === beta);
  worker.send({ type: "prompt", text: "stay busy" });
  await worker.waitFor((message) => message.type === "agent_start" || message.type === "streaming");
  const repository = (await inventoryOf(alpha, hello)).repositories.find((candidate) => candidate.path === checkout);
  const answer = await setSkills(alpha, repository.id, [], "busy");
  assert.equal(answer.type, "agent_resource_error");
  assert.match(answer.message, new RegExp(`${path.basename(beta)} is busy`));
  assert.deepEqual(JSON.parse(await readFile(server.configFile, "utf8")).userSkillCollections[0].enabledSkills, ["dev-skills/react"]);
});

test("the RPC runtime refuses a selection change", async (t) => {
  const root = await realpath(await makeWorkspace());
  const { checkout } = await collectionCheckout(root);
  const server = await startScriptedServer(root, [], { state: { sessionId: "rpc-collection", isStreaming: false } }, {
    userSkillCollections: [{ path: checkout, managed: false, enabledSkills: [] }],
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello");
  const repository = (await inventoryOf(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  const answer = await setSkills(client, repository.id, ["dev-skills/react"], "rpc");
  assert.equal(answer.type, "agent_resource_error");
  assert.match(answer.message, /runtime/i);
  assert.deepEqual(JSON.parse(await readFile(server.configFile, "utf8")).userSkillCollections[0].enabledSkills, []);
});

async function updateCollection(client, repositoryId, requestId) {
  client.send({ type: "refresh_agent_resource_repositories", repositoryId, requestId: `${requestId}-assess` });
  const checked = await client.waitFor((message) => message.type === "agent_resource_assessments" && message.requestId === `${requestId}-assess`, 180_000);
  const assessment = checked.assessments.find((candidate) => candidate.repositoryId === repositoryId);
  assert.equal(assessment.status, "updateable", assessment.reason);
  client.send({
    type: "update_agent_resource_repository",
    repositoryId,
    assessmentToken: assessment.token,
    localRevision: assessment.localRevision,
    upstreamRevision: assessment.upstreamRevision,
    requestId,
  });
  const result = await client.waitFor((message) => message.type === "agent_resource_update_result" && message.requestId === requestId, 180_000);
  assert.equal(result.result.status, "updated", result.result.reason);
  return result.inventory;
}

// openlore: scenario=ASkillAddedByAnUpdateStaysOff spec=agent-resource-management
// openlore: scenario=ASkillThatIsOnButGoneIsReportedMissing spec=agent-resource-management
test("an update adds a skill that stays off, and one deleting an enabled skill leaves it missing", async (t) => {
  const { seed, checkout, client, repository } = await bootWithCollection(t, ["dev-skills/react"]);

  await writeSkill(seed, "dev-skills/zig", "zig");
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "add zig"]);
  run(seed, ["push", "-q"]);
  const added = await updateCollection(client, repository.id, "add");
  const skillsAfterAdd = added.repositories.find((candidate) => candidate.id === repository.id).collection.skills;
  assert.equal(skillsAfterAdd.find((skill) => skill.relativePath === "dev-skills/zig").state, "off");
  assert.equal(skillsAfterAdd.find((skill) => skill.relativePath === "dev-skills/react").state, "on-loaded");
  assert.deepEqual(loadedUnder(added, checkout), ["react"]);

  await rm(path.join(seed, "dev-skills", "react"), { recursive: true });
  run(seed, ["add", "-A"]);
  run(seed, ["commit", "-q", "-m", "drop react"]);
  run(seed, ["push", "-q"]);
  const dropped = await updateCollection(client, repository.id, "drop");
  const skillsAfterDrop = dropped.repositories.find((candidate) => candidate.id === repository.id).collection.skills;
  assert.equal(skillsAfterDrop.find((skill) => skill.relativePath === "dev-skills/react").state, "on-missing");
  assert.deepEqual(loadedUnder(dropped, checkout), [], "the vanished skill is not handed to the runtime");
});

// openlore: scenario=AFailedWriteKeepsTheLiveSelection spec=persistent-runtime-settings
test("a selection that cannot be persisted keeps the live one", async (t) => {
  const { checkout, server, client, repository } = await bootWithCollection(t, ["dev-skills/react"]);
  // Removing the configuration file makes the persistence transaction fail before
  // it can write a replacement, on every platform.
  await unlink(server.configFile);
  const answer = await setSkills(client, repository.id, ["agent-skills/a2a"], "unwritable");
  assert.equal(answer.type, "agent_resource_error");
  assert.match(answer.message, /cannot read|could not save/i);
  assert.equal(client.received.some((message) => message.type === "session_replaced"), false, "the session was not replaced");
  const observer = connect(server.wsUrl());
  t.after(() => observer.close());
  const hello = await observer.waitFor("hello", 180_000);
  const live = await inventoryOf(observer, hello);
  assert.deepEqual(loadedUnder(live, checkout), ["react"], "the session still loads the selection it had");
  const skills = live.repositories.find((candidate) => candidate.id === repository.id).collection.skills;
  assert.equal(skills.find((skill) => skill.relativePath === "agent-skills/a2a").state, "off");
});
