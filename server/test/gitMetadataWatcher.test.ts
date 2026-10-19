import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { discoverRepos, gitStatus, type GitRepo } from "../src/git.ts";
import { createGitMetadataWatcher } from "../src/gitMetadataWatcher.ts";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "-c", "init.defaultBranch=main", ...args], { cwd, stdio: "ignore" });
}

/** A repository with one commit, and the set `discoverRepos` makes of it. */
async function repository(): Promise<{ root: string; repos: GitRepo[] }> {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "git-watch-")));
  roots.push(root);
  git(root, "init", "-q");
  writeFileSync(path.join(root, "a.txt"), "one\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "first");
  return { root, repos: await discoverRepos(root) };
}

/** Collects announcements; `settle` waits past a coalescing window. */
function recorder(coalesceMs = 40) {
  const seen: string[] = [];
  const watcher = createGitMetadataWatcher({ onChange: (id) => seen.push(id), coalesceMs });
  const settle = () => new Promise((resolve) => setTimeout(resolve, coalesceMs * 6));
  return { seen, watcher, settle };
}

describe("git metadata watcher", () => {
  test("announces a commit made outside the application, once per burst", async () => {
    const { root, repos } = await repository();
    const { seen, watcher, settle } = recorder();
    await watcher.watch(repos);
    writeFileSync(path.join(root, "a.txt"), "two\n");
    git(root, "commit", "-qam", "second");
    await settle();
    watcher.close();
    assert.deepEqual(seen, [""]);
  });

  test("announces a checkout, which moves HEAD without touching the work tree's files", async () => {
    const { root, repos } = await repository();
    const { seen, watcher, settle } = recorder();
    await watcher.watch(repos);
    git(root, "checkout", "-q", "-b", "other");
    await settle();
    watcher.close();
    assert.ok(seen.length >= 1, "a checkout is announced");
  });

  // openlore: scenario=ReadingTheStatusIsNotAChange spec=git
  test("ReadingTheStatusIsNotAChange: its own reading of the status feeds nothing, so a refresh cannot loop", async () => {
    const { root, repos } = await repository();
    // Past git's timestamp granularity, so a status that may write would rewrite the
    // index to cache the new stat: a plain `git status` here does fire the watcher.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    writeFileSync(path.join(root, "a.txt"), "changed\n");
    const { seen, watcher, settle } = recorder();
    await watcher.watch(repos);
    await gitStatus(repos);
    await gitStatus(repos);
    await settle();
    watcher.close();
    assert.deepEqual(seen, []);
  });

  test("says which repository moved when a workspace holds several", async () => {
    const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "git-watch-multi-")));
    roots.push(parent);
    for (const name of ["alpha", "beta"]) {
      const dir = path.join(parent, name);
      execFileSync("git", ["init", "-q", dir]);
      writeFileSync(path.join(dir, "f.txt"), "x\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-qm", "first");
    }
    const repos = await discoverRepos(parent);
    const { seen, watcher, settle } = recorder();
    await watcher.watch(repos);
    assert.deepEqual(watcher.watched().sort(), ["alpha", "beta"]);
    git(path.join(parent, "beta"), "commit", "-q", "--allow-empty", "-m", "second");
    await settle();
    watcher.close();
    assert.deepEqual(seen, ["beta"]);
  });

  // openlore: scenario=ALinkedWorkTreeIsFollowed spec=git
  test("ALinkedWorkTreeIsFollowed: a linked work tree's commits are announced, though its state lives elsewhere", async () => {
    const { root } = await repository();
    const linked = path.join(path.dirname(root), `${path.basename(root)}-linked`);
    roots.push(linked);
    git(root, "worktree", "add", "-q", linked, "-b", "linked");
    const repos = await discoverRepos(linked);
    const { seen, watcher, settle } = recorder();
    await watcher.watch(repos);
    writeFileSync(path.join(linked, "a.txt"), "from the linked tree\n");
    git(linked, "commit", "-qam", "in the linked tree");
    await settle();
    watcher.close();
    assert.deepEqual(seen, [""]);
  });

  test("stops watching a repository that left the set, and everything once closed", async () => {
    const { root, repos } = await repository();
    const { seen, watcher, settle } = recorder();
    await watcher.watch(repos);
    await watcher.watch([]);
    assert.deepEqual(watcher.watched(), []);
    git(root, "commit", "-q", "--allow-empty", "-m", "unwatched");
    await watcher.watch(repos);
    watcher.close();
    git(root, "commit", "-q", "--allow-empty", "-m", "closed");
    await settle();
    assert.deepEqual(seen, []);
  });
});
