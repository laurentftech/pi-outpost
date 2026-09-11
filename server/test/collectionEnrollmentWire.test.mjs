/**
 * Collection enrollment over the real socket: what the server persists and what
 * the replacement session loads after an Add Git repository confirmation.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();

function run(cwd, args) {
  return execFileSync(git, args, { cwd, encoding: "utf8" }).trim();
}

async function collectionRemote(root) {
  const remote = path.join(root, "collection-origin.git");
  const seed = path.join(root, "collection-seed");
  await mkdir(remote);
  run(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  await mkdir(seed);
  run(seed, ["init", "-q", "--initial-branch=main"]);
  run(seed, ["config", "user.email", "test@example.com"]);
  run(seed, ["config", "user.name", "Collection Wire Test"]);
  run(seed, ["config", "commit.gpgsign", "false"]);
  for (const [relative, name] of [["skills/review", "review"], ["tools/lint", "lint"]]) {
    await mkdir(path.join(seed, ...relative.split("/")), { recursive: true });
    await writeFile(path.join(seed, ...relative.split("/"), "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill.\n---\n`);
  }
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "initial"]);
  run(seed, ["remote", "add", "origin", remote]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  return pathToFileURL(remote).toString();
}

async function boot(t, root, options = {}) {
  const server = await startServer(root, options);
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 180_000);
  return { server, client };
}

async function previewClone(client, address, destination, requestId) {
  client.send({ type: "clone_agent_resource_repository", repositoryUrl: address, destinationPath: destination, requestId });
  const answer = await client.waitFor(
    (message) => (message.type === "agent_resource_preview" || message.type === "agent_resource_error") && message.requestId === requestId,
    180_000,
  );
  assert.equal(answer.type, "agent_resource_preview", answer.message);
  return answer.preview;
}

async function enroll(client, preview, enabledSkills, requestId) {
  client.send({ type: "enroll_agent_resource_repository", previewToken: preview.token, skillRoots: [], extensionRoots: [], enabledSkills, requestId });
  const answer = await client.waitFor(
    (message) => (message.type === "agent_resource_enrolled" || message.type === "agent_resource_error") && message.requestId === requestId,
    180_000,
  );
  assert.equal(answer.type, "agent_resource_enrolled", answer.message);
  return answer.inventory;
}

const loadedSkillsUnder = (inventory, root) =>
  inventory.resources.filter((resource) => resource.kind === "skill" && resource.path?.startsWith(root + path.sep)).map((resource) => resource.name).sort();

// openlore: scenario=ANewlyEnrolledCollectionLoadsNothing spec=agent-resource-management
test("a collection enrolled with nothing on loads none of its skills", async (t) => {
  const root = await realpath(await makeWorkspace());
  const address = await collectionRemote(root);
  const { server, client } = await boot(t, root);
  const destination = path.join(root, "collection");
  const preview = await previewClone(client, address, destination, "preview-empty");
  assert.equal(preview.mode, "collection");
  assert.deepEqual(preview.skills.map((entry) => entry.relativePath), ["skills/review", "tools/lint"]);

  const inventory = await enroll(client, preview, [], "enroll-empty");
  assert.deepEqual(loadedSkillsUnder(inventory, destination), []);
  const persisted = JSON.parse(await readFile(server.configFile, "utf8"));
  assert.deepEqual(persisted.userSkillCollections, [{ path: destination, managed: true, enabledSkills: [] }]);
  assert.equal(persisted.userSkillPaths, undefined, "no skill root is registered for a collection");
});

// openlore: scenario=AddARepositoryContainingSkillsAndExtensions spec=agent-resource-management
test("a collection enrolled with one skill on loads exactly that skill", async (t) => {
  const root = await realpath(await makeWorkspace());
  const address = await collectionRemote(root);
  const { client } = await boot(t, root);
  const destination = path.join(root, "collection");
  const preview = await previewClone(client, address, destination, "preview-one");
  const inventory = await enroll(client, preview, ["tools/lint"], "enroll-one");
  assert.deepEqual(loadedSkillsUnder(inventory, destination), ["lint"]);
});

// openlore: scenario=ReEnrollAnExistingRepository spec=agent-resource-management
test("re-enrolling a collection adds skills and keeps those already on", async (t) => {
  const root = await realpath(await makeWorkspace());
  const address = await collectionRemote(root);
  const { server, client } = await boot(t, root);
  const destination = path.join(root, "collection");
  await enroll(client, await previewClone(client, address, destination, "p1"), ["skills/review"], "e1");
  const inventory = await enroll(client, await previewClone(client, address, destination, "p2"), ["tools/lint"], "e2");
  assert.deepEqual(loadedSkillsUnder(inventory, destination), ["lint", "review"]);
  const persisted = JSON.parse(await readFile(server.configFile, "utf8"));
  assert.equal(persisted.userSkillCollections.length, 1, "one repository, not two");
  assert.deepEqual(persisted.userSkillCollections[0].enabledSkills, ["skills/review", "tools/lint"]);
  assert.equal(inventory.repositories.filter((repository) => repository.path === destination).length, 1);
});

test("a worktree already registered through a skill root is previewed in root mode", async (t) => {
  const root = await realpath(await makeWorkspace());
  const address = await collectionRemote(root);
  const checkout = path.join(root, "legacy-checkout");
  run(root, ["clone", "-q", new URL(address).pathname, checkout]);
  const { client } = await boot(t, root, { userSkillPaths: [path.join(checkout, "skills")] });
  const preview = await previewClone(client, address, checkout, "legacy");
  assert.equal(preview.mode, "roots");
  assert.ok(preview.roots.some((entry) => entry.kind === "skill"));
  assert.deepEqual(preview.skills, []);
});
