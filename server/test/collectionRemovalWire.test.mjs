/**
 * Removing a repository as a whole over the real socket: what is unregistered,
 * what is deleted from disk, and what is left alone when removal is refused.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { startScriptedServer } from "./multiProjectHarness.mjs";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();
const VETO = fileURLToPath(new URL("./fixtures/veto-session-switch.mjs", import.meta.url));

function run(cwd, args) {
  return execFileSync(git, args, { cwd, encoding: "utf8" }).trim();
}

async function remote(root) {
  const bare = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  await mkdir(bare);
  run(bare, ["init", "-q", "--bare", "--initial-branch=main"]);
  await mkdir(path.join(seed, "skills", "review"), { recursive: true });
  run(seed, ["init", "-q", "--initial-branch=main"]);
  run(seed, ["config", "user.email", "test@example.com"]);
  run(seed, ["config", "user.name", "Removal Test"]);
  run(seed, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review.\n---\n");
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "initial"]);
  run(seed, ["remote", "add", "origin", bare]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  return bare;
}

async function inventoryOf(client, hello) {
  if (hello.agentResources) return hello.agentResources;
  return (await client.waitFor((message) => message.type === "agent_resource_inventory", 180_000)).inventory;
}

async function removeRepository(client, repositoryId, requestId) {
  client.send({ type: "remove_agent_resource_repository", repositoryId, requestId });
  return client.waitFor(
    (message) => (message.type === "agent_resource_removed" || message.type === "agent_resource_error") && message.requestId === requestId,
    180_000,
  );
}

const exists = (target) => access(target).then(() => true, () => false);
const persisted = async (server) => JSON.parse(await readFile(server.configFile, "utf8"));

async function boot(t, root, config, scripted) {
  const server = scripted ? await startScriptedServer(root, scripted.others, scripted.script, config) : await startServer(root, config);
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 180_000);
  return { server, client, hello };
}

// openlore: scenario=RemovingAManagedCollectionDeletesItsClone spec=agent-resource-management
// openlore: scenario=RemovalClearsThePersistedSelection spec=persistent-runtime-settings
test("removing a collection pi-outpost cloned unregisters it and deletes the clone", async (t) => {
  const root = await realpath(await makeWorkspace());
  const bare = await remote(root);
  const { server, client } = await boot(t, root, {});
  const destination = path.join(root, "managed-collection");
  client.send({ type: "clone_agent_resource_repository", repositoryUrl: pathToFileURL(bare).toString(), destinationPath: destination, requestId: "clone" });
  const preview = await client.waitFor((message) => message.type === "agent_resource_preview" && message.requestId === "clone", 180_000);
  client.send({ type: "enroll_agent_resource_repository", previewToken: preview.preview.token, skillRoots: [], extensionRoots: [], enabledSkills: ["skills/review"], requestId: "enroll" });
  const enrolled = await client.waitFor((message) => message.type === "agent_resource_enrolled" && message.requestId === "enroll", 180_000);
  const repository = enrolled.inventory.repositories.find((candidate) => candidate.path === destination);
  assert.deepEqual(repository.removal, { allowed: true, deletesFiles: true, path: destination });

  const answer = await removeRepository(client, repository.id, "remove");
  assert.equal(answer.type, "agent_resource_removed", answer.message);
  assert.deepEqual(answer.result, { status: "removed", path: destination });
  assert.equal(await exists(destination), false, "the clone is gone from disk");
  assert.deepEqual((await persisted(server)).userSkillCollections, []);
  assert.equal(answer.inventory.repositories.some((candidate) => candidate.path === destination), false);
  assert.equal(answer.inventory.resources.some((resource) => resource.path?.startsWith(destination + path.sep)), false, "nothing from it is loaded");
});

// openlore: scenario=ARepositoryOutsideManagedStorageKeepsItsFiles spec=agent-resource-management
test("removing a repository pi-outpost does not manage keeps its files and says so", async (t) => {
  const root = await realpath(await makeWorkspace());
  const bare = await remote(root);
  const checkout = path.join(root, "their-checkout");
  run(root, ["clone", "-q", bare, checkout]);
  const { server, client, hello } = await boot(t, root, { userSkillCollections: [{ path: checkout, managed: false, enabledSkills: ["skills/review"] }] });
  const repository = (await inventoryOf(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  assert.equal(repository.removal.deletesFiles, false);
  const answer = await removeRepository(client, repository.id, "remove");
  assert.equal(answer.type, "agent_resource_removed", answer.message);
  assert.equal(answer.result.status, "removed-files-kept");
  assert.equal(answer.result.path, checkout);
  assert.match(answer.result.reason, /does not manage/);
  assert.equal(await exists(path.join(checkout, "skills", "review", "SKILL.md")), true);
  assert.deepEqual((await persisted(server)).userSkillCollections, []);
});

// openlore: scenario=AConfigurationFilePathBlocksRemoval spec=agent-resource-management
test("a repository supplying a configuration-file path is refused, and an unknown id too", async (t) => {
  const root = await realpath(await makeWorkspace());
  const bare = await remote(root);
  const checkout = path.join(root, "operator-checkout");
  run(root, ["clone", "-q", bare, checkout]);
  const { server, client, hello } = await boot(t, root, {
    skillPaths: [path.join(checkout, "skills")],
    userSkillCollections: [{ path: checkout, managed: true, enabledSkills: [] }],
  });
  const repository = (await inventoryOf(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  const refused = await removeRepository(client, repository.id, "configured");
  assert.equal(refused.type, "agent_resource_error");
  assert.match(refused.message, /configuration file/);
  const unknown = await removeRepository(client, "resource-repo:not-issued", "unknown");
  assert.equal(unknown.type, "agent_resource_error");
  assert.match(unknown.message, /unknown resource repository/i);
  assert.equal(await exists(checkout), true);
  assert.equal((await persisted(server)).userSkillCollections.length, 1, "nothing was unregistered");
});

// openlore: scenario=ARefusedReplacementKeepsTheRepository spec=agent-resource-management
test("a vetoed replacement keeps the repository registered and its files on disk", async (t) => {
  const root = await realpath(await makeWorkspace());
  const bare = await remote(root);
  const checkout = path.join(root, "vetoed-checkout");
  run(root, ["clone", "-q", bare, checkout]);
  const { server, client, hello } = await boot(t, root, {
    extensionPaths: [VETO],
    userSkillCollections: [{ path: checkout, managed: true, enabledSkills: ["skills/review"] }],
  });
  const repository = (await inventoryOf(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  const answer = await removeRepository(client, repository.id, "vetoed");
  assert.equal(answer.type, "agent_resource_error");
  assert.match(answer.message, /cancelled by an extension/i);
  assert.equal(await exists(path.join(checkout, "skills", "review", "SKILL.md")), true);
  assert.deepEqual((await persisted(server)).userSkillCollections, [{ path: checkout, managed: true, enabledSkills: ["skills/review"] }]);
});

// openlore: scenario=RemovalIsRefusedWhileAConsumerIsBusy spec=agent-resource-management
test("removal is refused while a workspace loading the repository is busy", async (t) => {
  const root = await realpath(await makeWorkspace());
  const beta = await realpath(await makeWorkspace());
  const bare = await remote(root);
  const checkout = path.join(root, "busy-checkout");
  run(root, ["clone", "-q", bare, checkout]);
  const { server, client, hello } = await boot(t, root, { userSkillCollections: [{ path: checkout, managed: true, enabledSkills: [] }] }, {
    others: [beta],
    script: { state: { sessionId: "busy-removal", isStreaming: false }, commands_: { prompt: { after: [{ type: "agent_start" }] } } },
  });
  const worker = connect(server.wsUrl());
  t.after(() => worker.close());
  await worker.waitFor("hello");
  worker.send({ type: "switch_workspace", root: beta });
  await worker.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === beta);
  worker.send({ type: "prompt", text: "stay busy" });
  await worker.waitFor((message) => message.type === "agent_start" || message.type === "streaming");
  const repository = (await inventoryOf(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  const answer = await removeRepository(client, repository.id, "busy");
  assert.equal(answer.type, "agent_resource_error");
  assert.match(answer.message, new RegExp(`${path.basename(beta)} is busy`));
  assert.equal(await exists(checkout), true);
  assert.equal((await persisted(server)).userSkillCollections.length, 1);
});
