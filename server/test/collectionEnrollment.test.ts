/**
 * Enrolling a repository as a skill collection: preview, confirmation, and what
 * the confirmation hands back to be persisted.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { useGitExecutable } from "../src/git.ts";
import { ResourceRepositoryService } from "../src/resourceRepositories.ts";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();
const roots: string[] = [];

function run(cwd: string, args: string[]): string {
  return execFileSync(git, args, { cwd, encoding: "utf8" }).trim();
}

async function temp(name: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), `pi-collection-${name}-`)));
  roots.push(root);
  return root;
}

async function skill(root: string, relative: string): Promise<void> {
  const dir = path.join(root, ...relative.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${path.basename(relative)}\ndescription: test skill\n---\n`);
}

async function repository(name: string, skills: string[]): Promise<string> {
  const root = await temp(name);
  run(root, ["init", "-q", "--initial-branch=main"]);
  run(root, ["config", "user.email", "test@example.com"]);
  run(root, ["config", "user.name", "Collection Test"]);
  run(root, ["config", "commit.gpgsign", "false"]);
  for (const relative of skills) await skill(root, relative);
  run(root, ["add", "."]);
  run(root, ["commit", "-q", "-m", "skills"]);
  return root;
}

async function bareRemote(name: string, skills: string[]): Promise<{ base: string; address: string }> {
  const seed = await repository(`${name}-seed`, skills);
  const base = await temp(name);
  const remote = path.join(base, "remote.git");
  await mkdir(remote);
  run(remote, ["init", "-q", "--bare", "--initial-branch=main"]);
  run(seed, ["remote", "add", "origin", remote]);
  run(seed, ["push", "-q", "-u", "origin", "main"]);
  return { base, address: pathToFileURL(remote).toString() };
}

before(() => useGitExecutable(git));
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

describe("collection enrollment", () => {
  test("a catalogue change between preview and confirmation is refused", async () => {
    const root = await repository("catalogue-change", ["group/one"]);
    const service = new ResourceRepositoryService();
    const preview = await service.preview(root, false);
    await skill(root, "group/two");
    await assert.rejects(() => service.confirmPreview(preview.token, [], [], false, ["group/one"]), /changed after preview/);
  });

  test("a collection preview offers no skill root, and refuses one sent anyway", async () => {
    const root = await repository("no-root", ["skills/one"]);
    const service = new ResourceRepositoryService();
    const preview = await service.preview(root, false);
    assert.equal(preview.mode, "collection");
    assert.deepEqual(preview.roots, []);
    await assert.rejects(
      () => service.confirmPreview(preview.token, [path.join(root, "skills")], [], false),
      /selected skill root is unavailable/,
    );
  });

  test("a skill the catalogue does not contain is refused", async () => {
    const root = await repository("stranger", ["group/one"]);
    const service = new ResourceRepositoryService();
    for (const stranger of ["group/none", "../escape", "group"]) {
      const preview = await service.preview(root, false);
      await assert.rejects(
        () => service.confirmPreview(preview.token, [], [], false, [stranger]),
        /not in this repository/,
        `refuses ${stranger}`,
      );
    }
  });

  // openlore: scenario=EnrollWithNothingTurnedOn spec=agent-resource-management
  test("an empty selection is a valid enrollment", async () => {
    const root = await repository("empty-selection", ["group/one", "group/two"]);
    const service = new ResourceRepositoryService();
    const preview = await service.preview(root, false);
    assert.deepEqual(preview.skills.map((entry) => entry.relativePath), ["group/one", "group/two"]);
    const confirmed = await service.confirmPreview(preview.token, [], [], false, []);
    assert.equal(confirmed.mode, "collection");
    assert.deepEqual(confirmed.enabledSkills, []);
    assert.deepEqual(confirmed.skillRoots, []);
    assert.equal(confirmed.repositoryPath, root);
  });

  test("a selection is deduplicated and kept to the catalogue", async () => {
    const root = await repository("selection", ["a/one", "b/two"]);
    const service = new ResourceRepositoryService();
    const preview = await service.preview(root, false);
    const confirmed = await service.confirmPreview(preview.token, [], [], false, ["b/two", "b/two", "a/one"]);
    assert.deepEqual(confirmed.enabledSkills, ["b/two", "a/one"]);
  });

  // openlore: scenario=ARootEnrolledRepositoryKeepsLoadingEverything spec=agent-resource-management
  test("a worktree registered through a skill root keeps root enrollment", async () => {
    const root = await repository("legacy", ["skills/one"]);
    const service = new ResourceRepositoryService();
    const preview = await service.preview(root, false, { userSkillPaths: [path.join(root, "skills")] });
    assert.equal(preview.mode, "roots");
    assert.deepEqual(preview.skills, []);
    const skillRoot = preview.roots.find((entry) => entry.kind === "skill")!.path;
    await assert.rejects(
      () => service.confirmPreview(preview.token, [skillRoot], [], false, ["skills/one"]),
      /registered through skill roots/,
    );
    const again = await service.preview(root, false, { userSkillPaths: [path.join(root, "skills")] });
    const confirmed = await service.confirmPreview(again.token, [skillRoot], [], false);
    assert.equal(confirmed.mode, "roots");
    assert.deepEqual(confirmed.skillRoots, [skillRoot]);
  });

  test("a preview names the repository after its origin, not its clone folder", async () => {
    const { base, address } = await bareRemote("preview-name", ["skills/one"]);
    const service = new ResourceRepositoryService(path.join(base, "managed"));
    const preview = await service.cloneAndPreview(address, path.join(base, "resources-3f9a1c2b7e"), false);
    assert.equal(preview.repositoryName, "remote", "the bare remote is remote.git");
  });

  test("a clone this service created is managed; a reused clone outside managed storage is not", async () => {
    const { base, address } = await bareRemote("managed", ["skills/one"]);
    const service = new ResourceRepositoryService(path.join(base, "managed"));

    const created = await service.cloneAndPreview(address, path.join(base, "fresh"), false);
    assert.equal((await service.confirmPreview(created.token, [], [], false)).managed, true);

    const reused = path.join(base, "someone-elses");
    run(base, ["clone", "-q", path.join(base, "remote.git"), reused]);
    const existing = await service.cloneAndPreview(address, reused, false);
    assert.equal((await service.confirmPreview(existing.token, [], [], false)).managed, false);

    const inManaged = path.join(base, "managed", "already-here");
    run(base, ["clone", "-q", path.join(base, "remote.git"), inManaged]);
    const stored = await service.cloneAndPreview(address, inManaged, false);
    assert.equal((await service.confirmPreview(stored.token, [], [], false)).managed, true, "managed storage is pi-outpost's");
  });
});
