/**
 * Hunts the CI-only failure in collectionEnrollmentWire ("Session change already in
 * progress"): many boots at once, each cloning a collection and enrolling one skill, under
 * CPU load. It never reproduced it (0/18 on 2026-10-11): the cause was not in the server
 * but in the harness, which took another test file's server, answering /health on the
 * port it had just freed, for its own — see harnessOwnServer.test.mjs. Kept for the
 * next time enrollment is suspected of racing for real.
 *
 *   node scripts/probes/collection-enroll-race.mjs [rounds] [parallel] [burners]
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { connect, makeWorkspace, startServer } from "../../server/test/harness.mjs";

const [rounds = 3, parallel = 6, burners = 6] = process.argv.slice(2).map(Number);
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function collectionRemote(root) {
  const remote = path.join(root, "collection-origin.git");
  const seed = path.join(root, "collection-seed");
  await mkdir(remote);
  git(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  await mkdir(seed);
  git(seed, ["init", "-q", "--initial-branch=main"]);
  git(seed, ["config", "user.email", "t@example.com"]);
  git(seed, ["config", "user.name", "Race"]);
  git(seed, ["config", "commit.gpgsign", "false"]);
  for (const [relative, name] of [["skills/review", "review"], ["tools/lint", "lint"]]) {
    await mkdir(path.join(seed, ...relative.split("/")), { recursive: true });
    await writeFile(path.join(seed, ...relative.split("/"), "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill.\n---\n`);
  }
  git(seed, ["add", "."]);
  git(seed, ["commit", "-q", "-m", "initial"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "-q", "-u", "origin", "main"]);
  return pathToFileURL(remote).toString();
}

async function once(label) {
  const root = await realpath(await makeWorkspace());
  const address = await collectionRemote(root);
  const server = await startServer(root);
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello", 180_000);
    const destination = path.join(root, "collection");
    client.send({ type: "clone_agent_resource_repository", repositoryUrl: address, destinationPath: destination, requestId: "p" });
    const preview = await client.waitFor((m) => (m.type === "agent_resource_preview" || m.type === "agent_resource_error") && m.requestId === "p", 180_000);
    if (preview.type !== "agent_resource_preview") return `${label}: preview ${preview.message}`;
    client.send({ type: "enroll_agent_resource_repository", previewToken: preview.preview.token, skillRoots: [], extensionRoots: [], enabledSkills: ["tools/lint"], requestId: "e" });
    const answer = await client.waitFor((m) => (m.type === "agent_resource_enrolled" || m.type === "agent_resource_error") && m.requestId === "e", 180_000);
    if (answer.type === "agent_resource_enrolled") return null;
    const before = client.received.map((m) => m.type).join(",");
    return `${label}: ${answer.message}\n  received: ${before}\n${server.log()}`;
  } catch (error) {
    return `${label}: ${error.message}\n${server.log()}`;
  } finally {
    client.close();
    await server.stop();
  }
}

const burn = Array.from({ length: burners }, () => spawn(process.execPath, ["-e", "for(;;){}"], { stdio: "ignore" }));
let failures = 0;
try {
  for (let round = 0; round < rounds; round++) {
    const results = await Promise.all(Array.from({ length: parallel }, (_, i) => once(`r${round}#${i}`)));
    for (const result of results.filter(Boolean)) {
      failures++;
      console.log(result);
    }
  }
} finally {
  for (const child of burn) child.kill();
}
console.log(`failures: ${failures} / ${rounds * parallel}`);
