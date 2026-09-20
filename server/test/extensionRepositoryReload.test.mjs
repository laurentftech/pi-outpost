/**
 * Does updating an extension repository through the resource manager make the new
 * code run?
 *
 * The extension registers a tool named after its revision, so what the agent runs is
 * read from its tools rather than inferred from the files on disk.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();
const run = (cwd, args) => execFileSync(git, args, { cwd, encoding: "utf8" }).trim();

const extension = (tool) => `export default function (pi) {
  pi.registerTool({
    name: ${JSON.stringify(tool)},
    label: ${JSON.stringify(tool)},
    description: "Says which revision of the extension is loaded.",
    parameters: { type: "object", properties: {} },
    async execute() { return { content: [{ type: "text", text: ${JSON.stringify(tool)} }] }; },
  });
}
`;

const toolNames = (message) => (message.tools ?? []).map((tool) => tool.name);

test("an updated extension repository says its code runs after a restart, and a restart runs it", async (t) => {
  const root = await realpath(await makeWorkspace());
  const remote = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  await mkdir(remote);
  run(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  await mkdir(path.join(seed, "extensions"), { recursive: true });
  run(seed, ["init", "-q", "--initial-branch=main"]);
  run(seed, ["config", "user.email", "test@example.com"]);
  run(seed, ["config", "user.name", "Reload Test"]);
  run(seed, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(seed, "extensions", "revision.js"), extension("repo_ext_v1"));
  await writeFile(path.join(seed, "package.json"), JSON.stringify({ type: "module" }));
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "v1"]);
  run(seed, ["remote", "add", "origin", remote]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  const checkout = path.join(root, "checkout");
  run(root, ["clone", "-q", remote, checkout]);

  const server = await startServer(root, { extensionPaths: [path.join(checkout, "extensions", "revision.js")] });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 180_000);
  assert.ok(toolNames(hello).includes("repo_ext_v1"), toolNames(hello).join(","));

  await writeFile(path.join(seed, "extensions", "revision.js"), extension("repo_ext_v2"));
  run(seed, ["commit", "-q", "-am", "v2"]);
  run(seed, ["push", "-q"]);

  const inventory = hello.agentResources ?? (await client.waitFor((m) => m.type === "agent_resource_inventory", 180_000)).inventory;
  const repository = inventory.repositories.find((candidate) => candidate.path === checkout);
  assert.ok(repository, JSON.stringify(inventory.repositories.map((r) => r.path)));
  client.send({ type: "refresh_agent_resource_repositories", repositoryId: repository.id, requestId: "assess" });
  const assessed = (await client.waitFor((m) => m.type === "agent_resource_assessments" && m.requestId === "assess", 120_000)).assessments[0];
  assert.equal(assessed.status, "updateable", JSON.stringify(assessed));
  client.send({
    type: "update_agent_resource_repository",
    repositoryId: repository.id,
    assessmentToken: assessed.token,
    localRevision: assessed.localRevision,
    upstreamRevision: assessed.upstreamRevision,
    allowExecutableChanges: true,
    requestId: "update",
  });
  const result = await client.waitFor((m) => m.type === "agent_resource_update_result" && m.requestId === "update", 120_000);

  // Updated on disk; not claimed as running. It used to say "reloaded" while the agent
  // kept running the previous revision.
  assert.equal(result.result.status, "updated");
  assert.deepEqual(result.result.reloads.map((reload) => reload.status), ["restart-required"]);
  assert.match(result.result.reloads[0].message, /extension code runs after pi-outpost restarts/);
  const waiting = await client.waitFor((m) => m.type === "restart_needed", 30_000);
  assert.deepEqual(waiting.reasons, ["checkout"]);

  // And that is true: until a restart the agent still has the old tool…
  const before = connect(server.wsUrl());
  t.after(() => before.close());
  const stillOld = await before.waitFor("hello", 60_000);
  assert.ok(toolNames(stillOld).includes("repo_ext_v1") && !toolNames(stillOld).includes("repo_ext_v2"), toolNames(stillOld).join(","));
  assert.deepEqual(stillOld.restartNeeded, ["checkout"]);

  // …and after one, the new.
  client.send({ type: "restart_server" });
  await client.waitFor((m) => m.type === "server_restarting", 10_000);
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (await fetch(`${server.base}/health`).then((res) => res.ok, () => false)) break;
    if (Date.now() > deadline) throw new Error(`the server did not come back:\n${server.log().slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const after = connect(server.wsUrl());
  t.after(() => after.close());
  const restarted = await after.waitFor("hello", 60_000);
  assert.ok(toolNames(restarted).includes("repo_ext_v2") && !toolNames(restarted).includes("repo_ext_v1"), toolNames(restarted).join(","));
  assert.equal(restarted.restartNeeded, undefined, "nothing waits on a restart any more");
});

test("a repository of skills alone is really reloaded, and asks for no restart", async (t) => {
  const root = await realpath(await makeWorkspace());
  const remote = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  await mkdir(remote);
  run(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  await mkdir(path.join(seed, "skills", "review"), { recursive: true });
  run(seed, ["init", "-q", "--initial-branch=main"]);
  run(seed, ["config", "user.email", "test@example.com"]);
  run(seed, ["config", "user.name", "Reload Test"]);
  run(seed, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review v1.\n---\n\n# Review\n");
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "v1"]);
  run(seed, ["remote", "add", "origin", remote]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  const checkout = path.join(root, "skills-checkout");
  run(root, ["clone", "-q", remote, checkout]);

  const server = await startServer(root, { skillPaths: [path.join(checkout, "skills")] });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello", 180_000);
  await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review v2.\n---\n\n# Review\n");
  run(seed, ["commit", "-q", "-am", "v2"]);
  run(seed, ["push", "-q"]);
  const inventory = hello.agentResources ?? (await client.waitFor((m) => m.type === "agent_resource_inventory", 180_000)).inventory;
  const repository = inventory.repositories.find((candidate) => candidate.path === checkout);
  client.send({ type: "refresh_agent_resource_repositories", repositoryId: repository.id, requestId: "assess" });
  const assessed = (await client.waitFor((m) => m.type === "agent_resource_assessments" && m.requestId === "assess", 120_000)).assessments[0];
  client.send({
    type: "update_agent_resource_repository",
    repositoryId: repository.id,
    assessmentToken: assessed.token,
    localRevision: assessed.localRevision,
    upstreamRevision: assessed.upstreamRevision,
    requestId: "update",
  });
  const result = await client.waitFor((m) => m.type === "agent_resource_update_result" && m.requestId === "update", 120_000);
  assert.deepEqual(result.result.reloads.map((reload) => reload.status), ["reloaded"]);
  const fresh = connect(server.wsUrl());
  t.after(() => fresh.close());
  const again = await fresh.waitFor("hello", 60_000);
  assert.equal(again.restartNeeded, undefined);
  assert.ok(JSON.stringify(again.commands).includes("Review v2"), "the skill's new description is what the agent has");
});
