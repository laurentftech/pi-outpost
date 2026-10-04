/**
 * A skill the agent is told about is one it can open.
 *
 * Skills live outside the project: bundled with pi-outpost, installed into the agent
 * directory, in `~/.agents/skills`. The sandbox confines `read` to the project, so the
 * agent was shown a skill it was refused — and went looking for it elsewhere, in the
 * installation it could not reach either. These run the real server and agent: the
 * provider has the agent `read` the path named in the prompt.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/read-call-provider.mjs", import.meta.url));
const MODEL = { provider: "read-call-test", id: "read-call-test" };
const BUNDLED = path.resolve(fileURLToPath(new URL("../../skills/structured-exchange/SKILL.md", import.meta.url)));
const BUNDLED_REFERENCE = path.resolve(fileURLToPath(new URL("../../skills/structured-exchange/references/timelines.md", import.meta.url)));
const OUTSIDE = path.resolve(fileURLToPath(new URL("../package.json", import.meta.url)));

async function waitForFile(file, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await readFile(file, "utf8").catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${path.basename(file)} never written`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Starts a server with skills on and returns `read(path)`: what the agent's `read` tool answered. */
async function agentReader(t) {
  const project = await realpath(await makeWorkspace());
  // Outside the project, as in a real installation: inside it, the sandbox root already covers it.
  const agentDir = await realpath(await makeWorkspace());
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  // A skill installed into the agent directory, with a file beside it, and the keys next door.
  await mkdir(path.join(agentDir, "skills", "house-style", "references"), { recursive: true });
  await writeFile(path.join(agentDir, "skills", "house-style", "SKILL.md"), "---\nname: house-style\ndescription: How we write.\n---\n\nUse the house style.\n");
  await writeFile(path.join(agentDir, "skills", "house-style", "references", "tone.md"), "Plain words.\n");
  await writeFile(path.join(agentDir, "auth.json"), JSON.stringify({ secret: { type: "api_key", key: "do-not-read" } }));
  const log = path.join(project, "read-result.json");
  const server = await startServer(
    project,
    { agentDir, noSkills: false, extensionPaths: [PROVIDER], allowedModels: [MODEL] },
    { env: { READ_CALL_LOG: log } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  return {
    agentDir,
    async read(target) {
      await rm(log, { force: true });
      client.send({ type: "prompt", text: `read ${target}` });
      const result = JSON.parse(await waitForFile(log));
      await client.waitFor((message) => message.type === "agent_end" || message.type === "turn_end", 30_000).catch(() => undefined);
      return result.map((part) => part.text ?? "").join("");
    },
  };
}

// openlore: scenario=LoadedSkillsAreReadable spec=sandbox-delegated-bash
test("LoadedSkillsAreReadable: bundled and installed skills open, with the files beside them", async (t) => {
  const { agentDir, read } = await agentReader(t);
  assert.match(await read(BUNDLED), /name: structured-exchange/, "the bundled skill");
  assert.match(await read(BUNDLED_REFERENCE), /Timelines/, "and a reference beside it");
  assert.match(await read(path.join(agentDir, "skills", "house-style", "SKILL.md")), /Use the house style/, "a skill in the agent directory");
  assert.match(await read(path.join(agentDir, "skills", "house-style", "references", "tone.md")), /Plain words/);
});

// openlore: scenario=OnlySkillsBecomeReadable spec=sandbox-delegated-bash
test("OnlySkillsBecomeReadable: the keys beside them and the rest of the installation stay closed", async (t) => {
  const { agentDir, read } = await agentReader(t);
  const auth = await read(path.join(agentDir, "auth.json"));
  assert.match(auth, /outside the sandbox/);
  assert.doesNotMatch(auth, /do-not-read/);
  assert.match(await read(OUTSIDE), /outside the sandbox/, "pi-outpost's own package.json");
});
