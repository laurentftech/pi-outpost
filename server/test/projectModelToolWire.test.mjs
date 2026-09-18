/**
 * `present_project_model`, over a real server and a real embedded session: withheld until
 * the conversation touches the project's model, published for the rest of the turn that
 * touches it, and withdrawn once unused.
 *
 * The assertions read the tool lists the *provider* was sent, request by request — what
 * costs tokens, and what the model can call.
 */
import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/project-model-tools-provider.mjs", import.meta.url));
const SKILL = fileURLToPath(new URL("../../skills/structured-exchange-project/SKILL.md", import.meta.url));
const TOOL = "present_project_model";

async function requests(logFile) {
  const text = await readFile(logFile, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((tools) => tools.length > 0);
}

async function nthRequest(logFile, index, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await requests(logFile);
    if (all.length > index) return all[index];
    if (Date.now() > deadline) throw new Error(`request ${index} never reached the model (${all.length} so far)`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const profileOf = (id) => ({ schema: "urn:structured-exchange-profile:1", id, label: id, elementKinds: [{ kind: "requirement" }] });

test("each project's model is its own: a file listed by one project does not publish the tool in another", async (t) => {
  // Two projects open on one server, each with a registry of its own. The risk is the
  // shape that produced a commit log under another project's name: a cache, or a
  // publication, that belongs to the connection rather than to the workspace.
  // Real paths: `switch_workspace` names a project by the root the server resolved.
  const beta = await realpath(await makeWorkspace({
    ".pi-outpost/structured-exchange.json": JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["model/beta.json"] }),
    "model/beta.json": JSON.stringify(profileOf("beta/model")),
  }));
  const alpha = await realpath(await makeWorkspace({
    ".pi-outpost/structured-exchange.json": JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"] }),
    "profiles/requirements.json": JSON.stringify(profileOf("acme/requirements")),
  }));
  const log = path.join(alpha, "tools.jsonl");
  const server = await startServer(
    alpha,
    {
      openProjects: [beta],
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "project-model-test", id: "project-model-test" }],
    },
    { env: { PROJECT_MODEL_LOG: log, PROJECT_MODEL_SKILL: SKILL } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  let request = 0;
  const next = () => nthRequest(log, request++);

  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", provider: "project-model-test", id: "project-model-test" });
  await client.waitFor((message) => message.type === "model_changed");
  client.send({ type: "prompt", text: "Open profiles/requirements.json." });
  assert.ok((await next()).includes(TOOL), "the file alpha's registry lists publishes the tool there");

  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((message) => message.type === "workspace_switched");
  // The second workspace may already hold the model, in which case nothing changes and
  // no event is sent; either way it must be able to run a turn before the assertions.
  client.send({ type: "set_model", provider: "project-model-test", id: "project-model-test" });
  await Promise.race([
    client.waitFor((message) => message.type === "model_changed").catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  client.send({ type: "prompt", text: "Open profiles/requirements.json." });
  assert.ok(!(await next()).includes(TOOL), "the same name is nothing to the other project, whose registry lists model/beta.json");
  client.send({ type: "prompt", text: "Open model/beta.json." });
  assert.ok((await next()).includes(TOOL), "and its own file publishes it");
});

test("present_project_model is published when the conversation touches the project's model, and not before", async () => {
  const profile = {
    schema: "urn:structured-exchange-profile:1",
    id: "acme/requirements",
    label: "ACME requirements",
    elementKinds: [{ kind: "requirement" }],
  };
  const root = await makeWorkspace({
    ".pi-outpost/structured-exchange.json": JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"] }),
    "profiles/requirements.json": JSON.stringify(profile),
  });
  const log = path.join(root, "tools.jsonl");
  const server = await startServer(
    root,
    { extensionPaths: [PROVIDER], allowedModels: [{ provider: "project-model-test", id: "project-model-test" }] },
    { env: { PROJECT_MODEL_LOG: log, PROJECT_MODEL_SKILL: SKILL } },
  );
  const client = connect(server.wsUrl());
  let request = 0;
  const next = () => nthRequest(log, request++);
  const prompt = (text) => client.send({ type: "prompt", text });
  try {
    const hello = await client.waitFor("hello", 30_000);
    // TheToolIsWithheldUntilTheModelIsTouched: registered, and not published in a project that has a model.
    assert.ok(hello.tools.some((tool) => tool.name === TOOL), "the tool is registered");
    assert.ok(!hello.tools.some((tool) => tool.name === TOOL && tool.active), "and withheld from a session that has touched nothing");

    client.send({ type: "set_model", provider: "project-model-test", id: "project-model-test" });
    await client.waitFor((message) => message.type === "model_changed");

    prompt("Write a rule: a derived requirement does not satisfy an upstream one.");
    assert.ok(!(await next()).includes(TOOL), "talking about rules in words does not publish it");

    // NamingAModelFilePublishesTheTool
    prompt("Add a status value to profiles/requirements.json.");
    const named = await next();
    assert.ok(named.includes(TOOL), "naming a listed file publishes it for that very turn");
    assert.equal(named.at(-1), TOOL, "ordered last, with the other tools published mid-session");

    // AnUncalledToolIsWithdrawn
    prompt("Thanks.");
    assert.ok(!(await next()).includes(TOOL), "published and never called, it is gone from the next turn");

    // WritingAModelFilePublishesTheToolWithinTheTurn
    prompt("WRITE THE REGISTRY");
    assert.ok(!(await next()).includes(TOOL), "not before the write");
    assert.ok((await next()).includes(TOOL), "the request after the write, in the same turn, carries it");
    prompt("Thanks again.");
    assert.ok(!(await next()).includes(TOOL));

    // ReadingTheSetupSkillPublishesTheTool
    prompt("READ THE SKILL");
    assert.ok(!(await next()).includes(TOOL));
    assert.ok((await next()).includes(TOOL), "the request after reading the setup skill carries it");
    prompt("Thanks.");
    assert.ok(!(await next()).includes(TOOL));

    // UserOpeningTheSetupSkillPublishesTheTool: the user, not the model, opens the skill.
    prompt("/skill:structured-exchange-project add the ARP4754A rule");
    assert.ok((await next()).includes(TOOL), "the turn in which the user opens the setup skill carries it from its first request");
    prompt("Thanks.");
    assert.ok(!(await next()).includes(TOOL));

    // AnUnusableRegistryRefusalPublishesTheTool
    await writeFile(path.join(root, ".pi-outpost/structured-exchange.json"), "{ not json");
    prompt("PRESENT");
    assert.ok(!(await next()).includes(TOOL));
    assert.ok((await next()).includes(TOOL), "the request after a refusal for an unusable registry carries it");
  } finally {
    client.close();
    await server.stop();
  }
});
