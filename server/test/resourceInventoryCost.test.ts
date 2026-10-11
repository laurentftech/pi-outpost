/**
 * What an inventory costs in git processes.
 *
 * It used to ask git where the repository was once per loaded skill or extension —
 * whether it had a repository or not — one process at a time. At ~0.1 s a process on a
 * Mac, and more on Windows, a few dozen skills held startup for seconds. Git is now asked
 * once per repository found by walking up to a `.git`, and not at all where there is none.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { AgentResourceInfo } from "@pi-outpost/shared";
import { useGitExecutable } from "../src/git.ts";
import { ResourceRepositoryService, useResourceGitObserver } from "../src/resourceRepositories.ts";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();
const roots: string[] = [];

async function temp(name: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), `pi-inventory-cost-${name}-`)));
  roots.push(root);
  return root;
}

async function skill(dir: string, name: string): Promise<AgentResourceInfo> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}.\n---\n`);
  return { id: `skill:${name}`, kind: "skill", name, origin: "runtime", path: path.join(dir, "SKILL.md") };
}

function input(resources: AgentResourceInfo[]) {
  return {
    resources,
    capabilities: { skills: "available" as const, extensions: "available" as const },
    configuredSkillPaths: [],
    userSkillPaths: [],
    configuredExtensionPaths: [],
    userExtensionPaths: [],
    userSkillCollections: [],
    extensionLock: false,
  };
}

/** The git commands an inventory runs. */
async function gitCommandsOf(run: () => Promise<unknown>): Promise<string[]> {
  const commands: string[] = [];
  useResourceGitObserver((event) => {
    if (event.phase === "start") commands.push(event.args.join(" "));
  });
  try {
    await run();
  } finally {
    useResourceGitObserver();
  }
  return commands;
}

before(() => useGitExecutable(git));
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

describe("the git cost of an inventory", () => {
  test("one question per repository, none for a resource outside every repository", async () => {
    const base = await temp("mixed");
    const repo = path.join(base, "team-skills");
    await mkdir(repo);
    execFileSync(git, ["init", "-q"], { cwd: repo });
    const inside = await Promise.all(Array.from({ length: 8 }, (_, index) => skill(path.join(repo, "skills", `s${index}`), `inside-${index}`)));
    const outside = await Promise.all(Array.from({ length: 6 }, (_, index) => skill(path.join(base, "loose", `l${index}`), `outside-${index}`)));

    let inventory!: Awaited<ReturnType<ResourceRepositoryService["buildInventory"]>>;
    const commands = await gitCommandsOf(async () => {
      inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(input([...inside, ...outside]));
    });

    assert.equal(commands.filter((command) => command === "rev-parse --show-toplevel").length, 1, commands.join("\n"));
    const repository = inventory.repositories.find((candidate) => candidate.path === repo);
    assert.ok(repository, "the repository is listed");
    assert.equal(repository.resourceIds.length, 8, "with every skill it holds");
    for (const resource of inventory.resources.filter((candidate) => candidate.name.startsWith("outside-"))) {
      assert.equal(resource.unavailableReason, "Not backed by a Git repository");
    }
  });

  test("a .git git does not recognise is still git's call, asked once", async () => {
    const base = await temp("broken");
    const folder = path.join(base, "not-a-repo");
    await mkdir(folder);
    // A worktree-style pointer to nowhere: a `.git` entry git refuses.
    await writeFile(path.join(folder, ".git"), "gitdir: /nowhere/at/all\n");
    const resources = await Promise.all([1, 2, 3].map((index) => skill(path.join(folder, `s${index}`), `broken-${index}`)));

    let inventory!: Awaited<ReturnType<ResourceRepositoryService["buildInventory"]>>;
    const commands = await gitCommandsOf(async () => {
      inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(input(resources));
    });

    assert.equal(commands.filter((command) => command === "rev-parse --show-toplevel").length, 1);
    assert.equal(inventory.repositories.length, 0);
    assert.ok(inventory.resources.every((resource) => resource.unavailableReason === "Not backed by a Git repository"));
  });

  test("a resource inside a nested repository belongs to the inner one, as git says", async () => {
    const base = await temp("nested");
    const outer = path.join(base, "outer");
    const inner = path.join(outer, "vendor", "inner");
    await mkdir(inner, { recursive: true });
    execFileSync(git, ["init", "-q"], { cwd: outer });
    execFileSync(git, ["init", "-q"], { cwd: inner });
    const inOuter = await skill(path.join(outer, "skills", "a"), "in-outer");
    const inInner = await skill(path.join(inner, "skills", "b"), "in-inner");

    const inventory = await new ResourceRepositoryService(path.join(base, "managed")).buildInventory(input([inOuter, inInner]));

    const byPath = new Map(inventory.repositories.map((repository) => [repository.path, repository.resourceIds.length]));
    assert.equal(byPath.get(outer), 1);
    assert.equal(byPath.get(inner), 1);
  });
});
