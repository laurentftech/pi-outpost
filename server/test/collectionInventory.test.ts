/**
 * Collections in the inventory: every catalogued skill with its state, and what
 * removing the repository would be allowed to do.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { AgentResourceInfo } from "@pi-outpost/shared";
import type { SkillCollection } from "../src/config.ts";
import { useGitExecutable } from "../src/git.ts";
import { ResourceRepositoryService } from "../src/resourceRepositories.ts";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();
const roots: string[] = [];

function run(cwd: string, args: string[]): string {
  return execFileSync(git, args, { cwd, encoding: "utf8" }).trim();
}

async function temp(name: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), `pi-collection-inventory-${name}-`)));
  roots.push(root);
  return root;
}

async function repository(root: string, skills: Array<[string, string]>): Promise<string> {
  await mkdir(root, { recursive: true });
  run(root, ["init", "-q", "--initial-branch=main"]);
  run(root, ["config", "user.email", "test@example.com"]);
  run(root, ["config", "user.name", "Inventory Test"]);
  run(root, ["config", "commit.gpgsign", "false"]);
  for (const [relative, name] of skills) {
    const dir = path.join(root, ...relative.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n`);
  }
  run(root, ["add", "."]);
  run(root, ["commit", "-q", "-m", "skills"]);
  return root;
}

/** What the runtime reports for a loaded skill: its SKILL.md. */
function loaded(dir: string, name: string): AgentResourceInfo {
  const file = path.join(dir, "SKILL.md");
  return { id: `skill:${file}`, kind: "skill", name, origin: "runtime", path: file };
}

function input(
  resources: AgentResourceInfo[],
  userSkillCollections: SkillCollection[],
  extra: Partial<{ configuredSkillPaths: string[]; userSkillPaths: string[] }> = {},
) {
  return {
    resources,
    capabilities: { skills: "available" as const, extensions: "available" as const },
    configuredSkillPaths: extra.configuredSkillPaths ?? [],
    userSkillPaths: extra.userSkillPaths ?? [],
    configuredExtensionPaths: [],
    userExtensionPaths: [],
    userSkillCollections,
    extensionLock: false,
  };
}

before(() => useGitExecutable(git));
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

describe("collection inventory", () => {
  test("a collection with nothing loaded is listed with every skill off", async () => {
    const base = await temp("off");
    const repo = await repository(path.join(base, "collection"), [["dev-skills/react", "react"], ["agent-skills/a2a", "a2a"]]);
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([], [{ path: repo, managed: false, enabledSkills: [] }]),
    );
    const listed = inventory.repositories.find((candidate) => candidate.path === repo);
    assert.ok(listed, "the repository is in the inventory although nothing from it is loaded");
    assert.deepEqual(listed.resourceIds, []);
    assert.deepEqual(listed.collection?.groups, [
      { path: "agent-skills", label: "agent-skills" },
      { path: "dev-skills", label: "dev-skills" },
    ]);
    assert.deepEqual(listed.collection?.skills.map((skill) => [skill.relativePath, skill.state]), [
      ["agent-skills/a2a", "off"],
      ["dev-skills/react", "off"],
    ]);
  });

  // openlore: scenario=ASkillThatIsOnButGoneIsReportedMissing spec=agent-resource-management
  test("each state: on and loaded, on and not loaded, on and missing, off", async () => {
    const base = await temp("states");
    const repo = await repository(path.join(base, "collection"), [["g/loaded", "loaded"], ["g/skipped", "skipped"], ["g/off", "off"]]);
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([loaded(path.join(repo, "g", "loaded"), "loaded")], [
        { path: repo, managed: false, enabledSkills: ["g/loaded", "g/skipped", "g/vanished"] },
      ]),
    );
    const skills = inventory.repositories.find((candidate) => candidate.path === repo)!.collection!.skills;
    assert.deepEqual(skills.map((skill) => [skill.relativePath, skill.state]), [
      ["g/loaded", "on-loaded"],
      ["g/off", "off"],
      ["g/skipped", "on-not-loaded"],
      ["g/vanished", "on-missing"],
    ]);
    assert.equal(skills.find((skill) => skill.state === "on-not-loaded")?.reason, "The session did not load this skill");
    assert.match(skills.find((skill) => skill.state === "on-missing")?.reason ?? "", /no longer in the repository/);
  });

  // openlore: scenario=ASkillThatIsOnButNotLoadedSaysSo spec=agent-resource-management
  test("two enabled copies under one name: the one not loaded names the winner", async () => {
    const base = await temp("collision");
    const repo = await repository(path.join(base, "collection"), [["agent-skills/a2a", "a2a"], ["skills/agent-a2a", "a2a"]]);
    const first = path.join(repo, "agent-skills", "a2a");
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([loaded(first, "a2a")], [{ path: repo, managed: false, enabledSkills: ["agent-skills/a2a", "skills/agent-a2a"] }]),
    );
    const skills = inventory.repositories.find((candidate) => candidate.path === repo)!.collection!.skills;
    assert.equal(skills.find((skill) => skill.relativePath === "agent-skills/a2a")?.state, "on-loaded");
    const loser = skills.find((skill) => skill.relativePath === "skills/agent-a2a")!;
    assert.equal(loser.state, "on-not-loaded");
    assert.match(loser.reason ?? "", /Another skill named "a2a" was loaded first/);
    assert.ok(loser.reason?.includes(path.join(first, "SKILL.md")));
  });

  test("a skill at the repository root is grouped under the repository's name", async () => {
    const base = await temp("root-group");
    const repo = await repository(path.join(base, "solo-skill"), [[".", "solo"]]);
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([], [{ path: repo, managed: false, enabledSkills: [] }]),
    );
    assert.deepEqual(inventory.repositories.find((candidate) => candidate.path === repo)!.collection!.groups, [
      { path: "", label: "solo-skill" },
    ]);
  });

  test("removal: a managed collection deletes its files, an unmanaged one keeps them", async () => {
    const base = await temp("removal");
    const managedRepo = await repository(path.join(base, "managed-clone"), [["g/one", "one"]]);
    const theirs = await repository(path.join(base, "theirs"), [["g/two", "two"]]);
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([], [
        { path: managedRepo, managed: true, enabledSkills: [] },
        { path: theirs, managed: false, enabledSkills: [] },
      ]),
    );
    assert.deepEqual(inventory.repositories.find((candidate) => candidate.path === managedRepo)?.removal, {
      allowed: true,
      deletesFiles: true,
      path: managedRepo,
    });
    assert.deepEqual(inventory.repositories.find((candidate) => candidate.path === theirs)?.removal, {
      allowed: true,
      deletesFiles: false,
      path: theirs,
    });
  });

  test("removal: a clone inside managed storage is managed even when enrolled by root", async () => {
    const base = await temp("managed-storage");
    const managedRoot = path.join(base, "managed");
    const repo = await repository(path.join(managedRoot, "legacy"), [["skills/one", "one"]]);
    const inventory = await new ResourceRepositoryService(managedRoot).buildInventory(
      input([loaded(path.join(repo, "skills", "one"), "one")], [], { userSkillPaths: [path.join(repo, "skills")] }),
    );
    const removal = inventory.repositories.find((candidate) => candidate.path === repo)?.removal;
    assert.deepEqual(removal, { allowed: true, deletesFiles: true, path: repo });
  });

  // openlore: scenario=AConfigurationFilePathBlocksRemoval spec=agent-resource-management
  test("removal: a repository supplying a configuration-file path is not removable", async () => {
    const base = await temp("configured");
    const repo = await repository(path.join(base, "operator"), [["skills/one", "one"]]);
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([loaded(path.join(repo, "skills", "one"), "one")], [{ path: repo, managed: true, enabledSkills: [] }], {
        configuredSkillPaths: [path.join(repo, "skills")],
      }),
    );
    const removal = inventory.repositories.find((candidate) => candidate.path === repo)?.removal;
    assert.equal(removal?.allowed, false);
    assert.equal(removal?.deletesFiles, false);
    assert.match(removal?.reason ?? "", /configuration file/);
  });

  test("removal: a repository nobody added through Agent resources is not removable", async () => {
    const base = await temp("runtime-only");
    const repo = await repository(path.join(base, "discovered"), [["skills/one", "one"]]);
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([loaded(path.join(repo, "skills", "one"), "one")], []),
    );
    const removal = inventory.repositories.find((candidate) => candidate.path === repo)?.removal;
    assert.equal(removal?.allowed, false);
    assert.match(removal?.reason ?? "", /not added through Agent resources/);
  });

  // openlore: scenario=ARepositoryIsNamedAfterItsOrigin spec=agent-resource-management
  test("a repository is named after its origin, not the folder it was cloned into", async () => {
    const base = await temp("origin-name");
    const repo = await repository(path.join(base, "resources-3f9a1c2b7e"), [["g/one", "one"]]);
    run(repo, ["remote", "add", "origin", "https://user:secret@github.com/khalilbenaz/claude-skills-collection.git?ref=main"]);
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([], [{ path: repo, managed: true, enabledSkills: [] }]),
    );
    const listed = inventory.repositories.find((candidate) => candidate.path === repo)!;
    assert.equal(listed.name, "claude-skills-collection");
    assert.ok(!JSON.stringify(listed).includes("secret"), "no credential reaches the inventory");
  });

  // openlore: scenario=ARepositoryWithoutAnOriginKeepsItsFolderName spec=agent-resource-management
  test("a repository without an origin keeps its folder name", async () => {
    const base = await temp("no-origin");
    const repo = await repository(path.join(base, "plain-folder"), [["g/one", "one"]]);
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([], [{ path: repo, managed: false, enabledSkills: [] }]),
    );
    assert.equal(inventory.repositories.find((candidate) => candidate.path === repo)?.name, "plain-folder");
  });

  test("a collection whose folder vanished stays listed, unavailable and removable", async () => {
    const base = await temp("vanished");
    const gone = path.join(base, "gone");
    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(
      input([], [{ path: gone, managed: true, enabledSkills: ["g/one"] }]),
    );
    const listed = inventory.repositories.find((candidate) => candidate.path === gone);
    assert.ok(listed);
    assert.equal(listed.assessment.status, "unavailable");
    assert.deepEqual(listed.removal, { allowed: true, deletesFiles: false, path: gone });
    assert.deepEqual(listed.collection?.skills.map((skill) => [skill.relativePath, skill.state]), [["g/one", "on-missing"]]);
  });
});
