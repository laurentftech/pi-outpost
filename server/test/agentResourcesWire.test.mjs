import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { startScriptedServer } from "./multiProjectHarness.mjs";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();

function run(cwd, args) {
  return execFileSync(git, args, { cwd, encoding: "utf8" }).trim();
}

async function makeRemote(root) {
  const remote = path.join(root, "resource-origin.git");
  const seed = path.join(root, "resource-seed");
  await mkdir(remote);
  run(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  await mkdir(seed);
  run(seed, ["init", "-q", "--initial-branch=main"]);
  run(seed, ["config", "user.email", "test@example.com"]);
  run(seed, ["config", "user.name", "Resource Wire Test"]);
  run(seed, ["config", "commit.gpgsign", "false"]);
  await mkdir(path.join(seed, "skills", "review"), { recursive: true });
  await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review resources.\n---\n\n# Review\n");
  await mkdir(path.join(seed, "extensions"));
  await writeFile(path.join(seed, "extensions", "review.ts"), "export default function review() {}\n");
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "initial"]);
  run(seed, ["remote", "add", "origin", remote]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  return { remote, seed };
}

async function quietTick() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function resourceInventory(client, snapshot) {
  if (snapshot.agentResources) return snapshot.agentResources;
  const message = await client.waitFor((candidate) => candidate.type === "agent_resource_inventory", 180_000);
  return message.inventory;
}

async function advanceRemote(seed, content = "Updated.\n") {
  await writeFile(path.join(seed, "skills", "review", "SKILL.md"), `# Review\n\n${content}`);
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "update"]);
  run(seed, ["push", "-q"]);
  return run(seed, ["rev-parse", "HEAD"]);
}

// openlore: scenario=AnAnswerReachesOnlyItsRequester spec=api
test("agent resource refresh answers only its requesting socket and echoes its request id", async (t) => {
  const root = await realpath(await makeWorkspace());
  const server = await startServer(root);
  t.after(() => server.stop());
  const requester = connect(server.wsUrl());
  const observer = connect(server.wsUrl());
  t.after(() => { requester.close(); observer.close(); });
  await Promise.all([requester.waitFor("hello", 180_000), observer.waitFor("hello", 180_000)]);

  requester.send({ type: "refresh_agent_resource_repositories", requestId: "refresh-owned" });
  const answer = await requester.waitFor((message) => message.type === "agent_resource_assessments" && message.requestId === "refresh-owned", 180_000);
  assert.equal(answer.requestId, "refresh-owned");
  await quietTick();
  assert.equal(observer.received.some((message) => message.requestId === "refresh-owned"), false);
});

// openlore: scenario=AResourceRequestIsServedForItsOwnWorkspace spec=api
test("repository enrollment is composed for the requesting socket workspace only", async (t) => {
  const root = await realpath(await makeWorkspace());
  const beta = await realpath(await makeWorkspace());
  const { remote } = await makeRemote(root);
  const server = await startServer(root, { openProjects: [beta] });
  t.after(() => server.stop());
  const alphaClient = connect(server.wsUrl());
  const betaClient = connect(server.wsUrl());
  t.after(() => { alphaClient.close(); betaClient.close(); });
  const alphaHello = await alphaClient.waitFor("hello");
  await betaClient.waitFor("hello");
  betaClient.send({ type: "switch_workspace", root: beta });
  const betaHello = await betaClient.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === beta);

  const destination = path.join(root, "checked-out-resources");
  alphaClient.send({
    type: "clone_agent_resource_repository",
    repositoryUrl: pathToFileURL(remote).toString(),
    destinationPath: destination,
    requestId: "clone-alpha",
  });
  const previewMessage = await alphaClient.waitFor((message) => message.type === "agent_resource_preview" && message.requestId === "clone-alpha");
  const skillRoot = previewMessage.preview.roots.find((candidate) => candidate.kind === "skill");
  const extensionRoot = previewMessage.preview.roots.find((candidate) => candidate.kind === "extension");
  assert.ok(skillRoot);
  assert.ok(extensionRoot);
  alphaClient.send({
    type: "enroll_agent_resource_repository",
    previewToken: previewMessage.preview.token,
    skillRoots: [skillRoot.path],
    extensionRoots: [extensionRoot.path],
    requestId: "enroll-alpha",
  });
  const enrolled = await alphaClient.waitFor((message) => message.type === "agent_resource_enrolled" && message.requestId === "enroll-alpha");

  assert.equal(alphaClient.received.some((message) => message.type === "update_config_ack"), false, "enrollment must not reset its pending correlation before the enrolled result");
  assert.equal(enrolled.inventory.repositories.some((repository) => repository.path === destination), true);
  const mixed = enrolled.inventory.repositories.find((repository) => repository.path === destination);
  assert.equal(mixed.containsExtensions, true);
  assert.equal(mixed.resourceIds.length, 2);
  assert.equal(alphaHello.workspace.root, root);
  assert.equal(betaHello.workspace.root, beta);
  await quietTick();
  assert.equal(betaClient.received.some((message) => message.requestId === "clone-alpha" || message.requestId === "enroll-alpha"), false);
  assert.equal(betaHello.agentResources?.repositories.some((repository) => repository.path === destination) ?? false, false);

  alphaClient.send({
    type: "clone_agent_resource_repository",
    repositoryUrl: pathToFileURL(remote).toString(),
    destinationPath: destination,
    requestId: "clone-again",
  });
  const again = await alphaClient.waitFor((message) => message.type === "agent_resource_preview" && message.requestId === "clone-again");
  alphaClient.send({
    type: "enroll_agent_resource_repository",
    previewToken: again.preview.token,
    skillRoots: [again.preview.roots.find((candidate) => candidate.kind === "skill").path],
    extensionRoots: [again.preview.roots.find((candidate) => candidate.kind === "extension").path],
    requestId: "enroll-again",
  });
  const reEnrolled = await alphaClient.waitFor((message) => message.type === "agent_resource_enrolled" && message.requestId === "enroll-again");
  assert.equal(reEnrolled.inventory.repositories.filter((repository) => repository.path === destination).length, 1);
  assert.equal(reEnrolled.inventory.repositories.find((repository) => repository.path === destination).resourceIds.length, 2);
});

test("extension lock filters a mixed preview while allowing skill-only enrollment", async (t) => {
  const root = await realpath(await makeWorkspace());
  const { remote } = await makeRemote(root);
  const server = await startServer(root, { extensionLock: true });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello");
  client.send({
    type: "clone_agent_resource_repository",
    repositoryUrl: pathToFileURL(remote).toString(),
    destinationPath: path.join(root, "locked-checkout"),
    requestId: "locked-preview",
  });
  const preview = await client.waitFor((message) => message.type === "agent_resource_preview" && message.requestId === "locked-preview");
  const skillRoot = preview.preview.roots.find((candidate) => candidate.kind === "skill");
  const extensionRoot = preview.preview.roots.find((candidate) => candidate.kind === "extension");
  assert.ok(skillRoot);
  assert.equal(extensionRoot.locked, true);
  client.send({
    type: "enroll_agent_resource_repository",
    previewToken: preview.preview.token,
    skillRoots: [skillRoot.path],
    extensionRoots: [],
    requestId: "locked-enroll",
  });
  const enrolled = await client.waitFor((message) => message.type === "agent_resource_enrolled" && message.requestId === "locked-enroll");
  const repository = enrolled.inventory.repositories.find((candidate) => candidate.path === path.join(root, "locked-checkout"));
  assert.ok(repository);
  assert.equal(repository.resourceIds.length, 1);
  assert.equal(enrolled.inventory.resources.find((resource) => resource.id === repository.resourceIds[0]).kind, "skill");
});

// openlore: scenario=AnUnissuedIdentifierIsRefused spec=api
test("unissued repository and assessment identifiers return correlated resource errors", async (t) => {
  const root = await realpath(await makeWorkspace());
  const { remote, seed } = await makeRemote(root);
  const checkout = path.join(root, "resource-checkout");
  run(root, ["clone", "-q", remote, checkout]);
  const server = await startServer(root, { skillPaths: [path.join(checkout, "skills", "review")] });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello");
  const repository = (await resourceInventory(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  assert.ok(repository);

  client.send({
    type: "update_agent_resource_repository",
    repositoryId: "resource-repo:not-issued",
    assessmentToken: "not-issued",
    localRevision: "not-issued",
    upstreamRevision: "not-issued",
    requestId: "unknown-repository",
  });
  const unknownRepository = await client.waitFor((message) => message.type === "agent_resource_error" && message.requestId === "unknown-repository");
  assert.match(unknownRepository.message, /unknown resource repository/i);

  await writeFile(path.join(seed, "skills", "review", "SKILL.md"), "# Review\n\nUpdated.\n");
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "update"]);
  run(seed, ["push", "-q"]);
  client.send({ type: "refresh_agent_resource_repositories", repositoryId: repository.id, requestId: "assess" });
  const assessed = await client.waitFor((message) => message.type === "agent_resource_assessments" && message.requestId === "assess");
  const updateable = assessed.assessments.find((candidate) => candidate.repositoryId === repository.id);
  assert.equal(updateable.status, "updateable");
  client.send({
    type: "update_agent_resource_repository",
    repositoryId: repository.id,
    assessmentToken: "not-issued",
    localRevision: updateable.localRevision,
    upstreamRevision: updateable.upstreamRevision,
    requestId: "unknown-assessment",
  });
  const unknownAssessment = await client.waitFor((message) => message.type === "agent_resource_error" && message.requestId === "unknown-assessment");
  assert.match(unknownAssessment.message, /unknown update assessment/i);
});

// openlore: scenario=AFailureDoesNotLeakCredentials spec=api
test("a failed credential-bearing clone returns a private correlated error", async (t) => {
  const root = await realpath(await makeWorkspace());
  const server = await startServer(root);
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  const observer = connect(server.wsUrl());
  t.after(() => { client.close(); observer.close(); });
  await Promise.all([client.waitFor("hello"), observer.waitFor("hello")]);
  const secret = "dont-show-this-password";
  client.send({
    type: "clone_agent_resource_repository",
    repositoryUrl: `https://wire-user:${secret}@127.0.0.1:1/private.git`,
    destinationPath: path.join(root, "failed-clone"),
    requestId: "credential-failure",
  });
  const failure = await client.waitFor((message) => message.type === "agent_resource_error" && message.requestId === "credential-failure", 10_000);
  assert.equal(failure.requestId, "credential-failure");
  assert.equal(JSON.stringify(failure).includes(secret), false);
  assert.equal(JSON.stringify(failure).includes("wire-user"), false);
  assert.equal(client.received.some((message) => message.type === "error" && JSON.stringify(message).includes(secret)), false);
  await quietTick();
  assert.equal(observer.received.some((message) => message.requestId === "credential-failure"), false);
  assert.equal(observer.received.some((message) => message.type === "error"), false, "resource failures stay private to their requester");
});

test("updating a shared repository reloads every started workspace and broadcasts fresh snapshots", async (t) => {
  const root = await realpath(await makeWorkspace());
  const beta = await realpath(await makeWorkspace());
  const { remote, seed } = await makeRemote(root);
  const checkout = path.join(root, "shared-resources");
  run(root, ["clone", "-q", remote, checkout]);
  const server = await startServer(root, { openProjects: [beta], noSkills: false, skillPaths: [path.join(checkout, "skills")] });
  t.after(() => server.stop());
  const alpha = connect(server.wsUrl());
  const betaClient = connect(server.wsUrl());
  t.after(() => { alpha.close(); betaClient.close(); });
  const alphaHello = await alpha.waitFor("hello");
  await betaClient.waitFor("hello");
  betaClient.send({ type: "switch_workspace", root: beta });
  const betaHello = await betaClient.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === beta);
  const repository = (await resourceInventory(alpha, alphaHello)).repositories.find((candidate) => candidate.path === checkout);
  assert.ok(repository);
  await mkdir(path.join(seed, "skills", "new-resource"));
  await writeFile(path.join(seed, "skills", "new-resource", "SKILL.md"), "---\nname: new-resource\ndescription: A newly added resource.\n---\n\n# New resource\n");
  run(seed, ["rm", "skills/review/SKILL.md"]);
  run(seed, ["add", "."]);
  run(seed, ["commit", "-q", "-m", "replace resource"]);
  run(seed, ["push", "-q"]);
  const expected = run(seed, ["rev-parse", "HEAD"]);

  alpha.send({ type: "refresh_agent_resource_repositories", repositoryId: repository.id, requestId: "shared-assess" });
  const checked = await alpha.waitFor((message) => message.type === "agent_resource_assessments" && message.requestId === "shared-assess");
  const assessment = checked.assessments[0];
  assert.equal(assessment.status, "updateable");
  alpha.send({
    type: "update_agent_resource_repository",
    repositoryId: repository.id,
    assessmentToken: assessment.token,
    localRevision: assessment.localRevision,
    upstreamRevision: assessment.upstreamRevision,
    requestId: "shared-update",
  });
  alpha.send({ type: "prompt", text: "must not start during a resource update" });
  const blockedPrompt = await alpha.waitFor((message) => message.type === "error" && /Session change already in progress/.test(message.message));
  assert.match(blockedPrompt.message, /Session change already in progress/);
  const result = await alpha.waitFor((message) => message.type === "agent_resource_update_result" && message.requestId === "shared-update");
  assert.equal(result.result.status, "updated");
  assert.deepEqual(
    new Map(result.result.reloads.map((reload) => [reload.workspaceRoot, reload.status])),
    new Map([[root, "reloaded"], [beta, "reloaded"]]),
  );
  assert.equal(run(checkout, ["rev-parse", "HEAD"]), expected);
  const refreshedInventory = (message) =>
    message.type === "agent_resource_inventory" &&
    message.inventory.repositories.find((candidate) => candidate.id === repository.id)?.assessment.status === "current" &&
    message.inventory.resources.some((resource) => resource.path?.includes("/skills/new-resource"));
  await alpha.waitFor((message) => message.type === "session_replaced" && message.sessionId !== alphaHello.sessionId);
  await betaClient.waitFor((message) => message.type === "session_replaced" && message.sessionId !== betaHello.sessionId);
  const alphaInventory = (await alpha.waitFor(refreshedInventory)).inventory;
  const betaInventory = (await betaClient.waitFor(refreshedInventory)).inventory;
  for (const updatedInventory of [alphaInventory, betaInventory]) {
    assert.equal(updatedInventory.repositories.find((candidate) => candidate.id === repository.id).assessment.status, "current");
    assert.equal(updatedInventory.resources.some((resource) => resource.path?.includes("/skills/review")), false);
    assert.equal(updatedInventory.resources.some((resource) => resource.path?.includes("/skills/new-resource")), true);
  }
});

test("updating does not start a dormant affected workspace and it loads the updated resources later", async (t) => {
  const root = await realpath(await makeWorkspace());
  const beta = await realpath(await makeWorkspace());
  const { remote, seed } = await makeRemote(root);
  const checkout = path.join(root, "dormant-shared-resources");
  run(root, ["clone", "-q", remote, checkout]);
  const server = await startServer(root, { openProjects: [beta], skillPaths: [path.join(checkout, "skills", "review")] });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello");
  const repository = (await resourceInventory(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  await advanceRemote(seed, "Dormant update.\n");
  client.send({ type: "refresh_agent_resource_repositories", repositoryId: repository.id, requestId: "dormant-assess" });
  const checked = await client.waitFor((message) => message.type === "agent_resource_assessments" && message.requestId === "dormant-assess");
  const assessment = checked.assessments[0];
  client.send({
    type: "update_agent_resource_repository",
    repositoryId: repository.id,
    assessmentToken: assessment.token,
    localRevision: assessment.localRevision,
    upstreamRevision: assessment.upstreamRevision,
    requestId: "dormant-update",
  });
  client.send({ type: "switch_workspace", root: beta });
  const blockedStart = await client.waitFor((message) => message.type === "workspace_error" && /resource update in progress/.test(message.message));
  assert.match(blockedStart.message, /resource update in progress/);
  const result = await client.waitFor((message) => message.type === "agent_resource_update_result" && message.requestId === "dormant-update");
  assert.equal(result.result.reloads.find((reload) => reload.workspaceRoot === beta).status, "not-started");
  client.send({ type: "switch_workspace", root: beta });
  const later = await client.waitFor((message) => message.type === "workspace_switched" && message.workspace.root === beta);
  assert.ok(later.agentResources.repositories.find((candidate) => candidate.id === repository.id));
  assert.match(await readFile(path.join(checkout, "skills", "review", "SKILL.md"), "utf8"), /Dormant update/);
});

test("a busy affected workspace refuses the update before mutating Git", async (t) => {
  const root = await realpath(await makeWorkspace());
  const beta = await realpath(await makeWorkspace());
  const { remote, seed } = await makeRemote(root);
  const checkout = path.join(root, "busy-shared-resources");
  run(root, ["clone", "-q", remote, checkout]);
  const before = run(checkout, ["rev-parse", "HEAD"]);
  const server = await startScriptedServer(root, [beta], {
    state: { sessionId: "busy-resource", isStreaming: false },
    commands_: { prompt: { after: [{ type: "agent_start" }] } },
  }, { skillPaths: [path.join(checkout, "skills", "review")] });
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
  const repository = (await resourceInventory(alpha, hello)).repositories.find((candidate) => candidate.path === checkout);
  await advanceRemote(seed, "Busy update.\n");
  alpha.send({ type: "refresh_agent_resource_repositories", repositoryId: repository.id, requestId: "busy-assess" });
  const checked = await alpha.waitFor((message) => message.type === "agent_resource_assessments" && message.requestId === "busy-assess");
  const assessment = checked.assessments[0];
  alpha.send({
    type: "update_agent_resource_repository",
    repositoryId: repository.id,
    assessmentToken: assessment.token,
    localRevision: assessment.localRevision,
    upstreamRevision: assessment.upstreamRevision,
    requestId: "busy-update",
  });
  const result = await alpha.waitFor((message) => message.type === "agent_resource_update_result" && message.requestId === "busy-update");
  assert.equal(result.result.status, "refused");
  assert.equal(result.result.assessment.status, "busy");
  assert.match(result.result.reason, /busy/);
  assert.equal(run(checkout, ["rev-parse", "HEAD"]), before);
});

test("a runtime reload failure reports partial failure after preserving the Git update", async (t) => {
  const root = await realpath(await makeWorkspace());
  const { remote, seed } = await makeRemote(root);
  const checkout = path.join(root, "reload-failure-resources");
  run(root, ["clone", "-q", remote, checkout]);
  const server = await startScriptedServer(root, [], {
    state: { sessionId: "reload-failure", isStreaming: false },
  }, { skillPaths: [path.join(checkout, "skills", "review")] });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor("hello");
  const repository = (await resourceInventory(client, hello)).repositories.find((candidate) => candidate.path === checkout);
  const expected = await advanceRemote(seed, "Reload failure update.\n");
  client.send({ type: "refresh_agent_resource_repositories", repositoryId: repository.id, requestId: "failure-assess" });
  const checked = await client.waitFor((message) => message.type === "agent_resource_assessments" && message.requestId === "failure-assess");
  const assessment = checked.assessments[0];
  client.send({
    type: "update_agent_resource_repository",
    repositoryId: repository.id,
    assessmentToken: assessment.token,
    localRevision: assessment.localRevision,
    upstreamRevision: assessment.upstreamRevision,
    requestId: "failure-update",
  });
  const result = await client.waitFor((message) => message.type === "agent_resource_update_result" && message.requestId === "failure-update");
  assert.equal(result.result.status, "updated-reload-failed");
  assert.equal(result.result.reloads.length, 1);
  assert.equal(result.result.reloads[0].status, "failed");
  assert.match(result.result.reloads[0].message, /unavailable/i);
  assert.equal(run(checkout, ["rev-parse", "HEAD"]), expected);
});
