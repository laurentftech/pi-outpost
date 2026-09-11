/**
 * Deleting a removed repository's clone: only pi-outpost's own folder, never
 * through a link, and honest when the deletion stops part-way.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { useGitExecutable } from "../src/git.ts";
import { ResourceRepositoryService, useResourceRemover } from "../src/resourceRepositories.ts";

const git = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).split("\n")[0].trim();
const roots: string[] = [];

function run(cwd: string, args: string[]): string {
  return execFileSync(git, args, { cwd, encoding: "utf8" }).trim();
}

async function temp(name: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), `pi-clone-deletion-${name}-`)));
  roots.push(root);
  return root;
}

/** A real repository with a commit, so Git's read-only object files are present. */
async function clone(root: string): Promise<string> {
  await mkdir(path.join(root, "skills", "one"), { recursive: true });
  run(root, ["init", "-q", "--initial-branch=main"]);
  run(root, ["config", "user.email", "test@example.com"]);
  run(root, ["config", "user.name", "Deletion Test"]);
  run(root, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(root, "skills", "one", "SKILL.md"), "---\nname: one\ndescription: One.\n---\n");
  run(root, ["add", "."]);
  run(root, ["commit", "-q", "-m", "one"]);
  return root;
}

const exists = (target: string) => access(target).then(() => true, () => false);

before(() => useGitExecutable(git));
afterEach(() => useResourceRemover());
after(async () => {
  for (const root of roots) {
    await chmod(root, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

describe("managed clone deletion", () => {
  test("a managed clone with Git's read-only objects is deleted", async () => {
    const base = await temp("objects");
    const repo = await clone(path.join(base, "collection"));
    const result = await new ResourceRepositoryService(path.join(base, "managed")).deleteManagedClone(repo, true);
    assert.deepEqual(result, { deleted: true });
    assert.equal(await exists(repo), false);
  });

  test("a read-only directory inside the clone does not stop the deletion", { skip: process.platform === "win32" }, async () => {
    const base = await temp("readonly");
    const repo = await clone(path.join(base, "collection"));
    const locked = path.join(repo, "locked");
    await mkdir(locked);
    await writeFile(path.join(locked, "file.txt"), "cannot unlink me until the directory is writable\n");
    await chmod(locked, 0o555);
    const result = await new ResourceRepositoryService(path.join(base, "managed")).deleteManagedClone(repo, true);
    assert.deepEqual(result, { deleted: true });
    assert.equal(await exists(repo), false);
  });

  // openlore: scenario=DeletionNeverLeavesTheWorktree spec=agent-resource-management
  test("a symbolic link out of the clone is unlinked, its target untouched", async () => {
    const base = await temp("symlink");
    const outside = path.join(base, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "precious.txt"), "keep\n");
    const repo = await clone(path.join(base, "collection"));
    await symlink(outside, path.join(repo, "escape"), "dir");
    const result = await new ResourceRepositoryService(path.join(base, "managed")).deleteManagedClone(repo, true);
    assert.deepEqual(result, { deleted: true });
    assert.equal(await exists(repo), false);
    assert.equal(await exists(path.join(outside, "precious.txt")), true);
  });

  // openlore: scenario=AFailedDeletionIsReportedAsPartial spec=agent-resource-management
  test("a deletion that fails is reported with its reason, not as done", async () => {
    const base = await temp("failure");
    const repo = await clone(path.join(base, "collection"));
    useResourceRemover(async () => {
      const error = new Error("EBUSY: resource busy or locked") as NodeJS.ErrnoException;
      error.code = "EBUSY";
      throw error;
    });
    const result = await new ResourceRepositoryService(path.join(base, "managed")).deleteManagedClone(repo, true);
    assert.equal(result.deleted, false);
    assert.equal((result as { failed: boolean }).failed, true, "a deletion that stopped part-way is a failure, not a refusal");
    assert.match((result as { reason: string }).reason, /Could not delete every file: EBUSY/);
    assert.equal(await exists(repo), true);
  });

  test("a folder pi-outpost does not manage is kept", async () => {
    const base = await temp("unmanaged");
    const repo = await clone(path.join(base, "theirs"));
    const result = await new ResourceRepositoryService(path.join(base, "managed")).deleteManagedClone(repo, false);
    assert.equal(result.deleted, false);
    assert.equal((result as { failed: boolean }).failed, false, "a refusal keeps the files on purpose");
    assert.match((result as { reason: string }).reason, /does not manage/);
    assert.equal(await exists(repo), true);
  });

  test("inside managed storage is pi-outpost's even without the flag", async () => {
    const base = await temp("storage");
    const managedRoot = path.join(base, "managed");
    const repo = await clone(path.join(managedRoot, "clone"));
    assert.deepEqual(await new ResourceRepositoryService(managedRoot).deleteManagedClone(repo, false), { deleted: true });
  });

  test("managed storage itself, a subfolder, and a folder that is not a repository are kept", async () => {
    const base = await temp("refusals");
    const managedRoot = path.join(base, "managed");
    await clone(managedRoot);
    const service = new ResourceRepositoryService(managedRoot);
    assert.match(((await service.deleteManagedClone(managedRoot, true)) as { reason: string }).reason, /Managed resource storage itself/);
    assert.match(((await service.deleteManagedClone(path.join(managedRoot, "skills"), true)) as { reason: string }).reason, /no longer the top of a Git repository/);
    const plain = path.join(base, "plain");
    await mkdir(plain);
    assert.match(((await service.deleteManagedClone(plain, true)) as { reason: string }).reason, /no longer the top of a Git repository/);
    assert.equal(await exists(path.join(managedRoot, "skills", "one", "SKILL.md")), true);
    assert.equal(await exists(plain), true);
  });

  test("a folder reached through a link is kept", async () => {
    const base = await temp("linked-root");
    const repo = await clone(path.join(base, "real"));
    const link = path.join(base, "link");
    await symlink(repo, link, "dir");
    const result = await new ResourceRepositoryService(path.join(base, "managed")).deleteManagedClone(link, true);
    assert.equal(result.deleted, false);
    assert.equal(await exists(repo), true);
  });
});
