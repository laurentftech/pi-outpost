/**
 * Reading a repository must not lock it.
 *
 * `git status` normally rewrites `.git/index` to cache the `stat` of everything it
 * looked at, and taking `.git/index.lock` is how it does that. This application asks
 * for a status on every file change, every directory change and the end of every agent
 * turn — which is exactly while an agent is running `git add` and `git commit` in the
 * same repository. Those fail outright when the lock is held, with
 * "Unable to create '.git/index.lock': File exists", intermittently and never
 * reproducibly, because the window is a few milliseconds wide.
 *
 * The assertions below are about that window rather than about an error message: the
 * index must not be rewritten by a read, and a write must go through while a read is
 * in flight. Asserting only that `gitStatus` still answers would pass either way — git
 * gives up the optional lock silently when it cannot take it, so a status is correct
 * whether or not this application is causing the problem.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, after, describe, test } from "node:test";
import { gitStatus, gitLog, type GitRepo } from "../src/git.ts";

describe("a read of a repository does not lock it", () => {
  let root: string;
  const repo = (): GitRepo => ({ toplevel: root, cwd: root, id: "" });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const indexWrittenAt = () => statSync(path.join(root, ".git", "index")).mtimeMs;

  /**
   * Make the index's cached `stat` stale, which is what gives `git status` a reason to
   * rewrite it. Without this the index is already current and nothing would be written
   * whatever this application did — the test would pass against the bug.
   */
  const touchTracked = () => {
    const when = new Date(Date.now() + 2000);
    utimesSync(path.join(root, "README.md"), when, when);
  };

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "pi-git-locks-"));
    git("init", "-b", "main");
    git("config", "user.email", "test@test");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(path.join(root, "README.md"), "# a repository\n");
    git("add", ".");
    git("commit", "-m", "initial commit");
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("a status leaves the index exactly as it found it", async () => {
    touchTracked();
    const before = indexWrittenAt();

    const answer = await gitStatus([repo()]);

    assert.ok(answer.files.length >= 0, "the status still answered");
    assert.equal(
      indexWrittenAt(),
      before,
      "the status rewrote .git/index, which means it took .git/index.lock to do it",
    );
  });

  test("the control: git rewrites the index when it is allowed to", () => {
    // Without this the assertion above could pass because nothing was ever going to
    // be written — a stale premise rather than a working fix.
    touchTracked();
    const before = indexWrittenAt();
    execFileSync("git", ["status", "--porcelain=v2"], { cwd: root, encoding: "utf8" });
    assert.notEqual(indexWrittenAt(), before, "git did not refresh the index even when free to");
  });

  test("a write goes through while this application is reading", async () => {
    // The failure in the field: the agent commits while the interface refreshes its
    // status, and the commit is the one that loses.
    writeFileSync(path.join(root, "second.txt"), "more\n");
    const reading = Promise.all([gitStatus([repo()]), gitLog([repo()], 20), gitStatus([repo()])]);

    git("add", "second.txt");
    git("commit", "-m", "written while the interface was reading");

    await reading;
    assert.match(git("log", "-1", "--format=%s"), /written while the interface was reading/);
  });

  test("a real conflict still fails, because two writers still conflict", () => {
    // What this must not do is make locking sloppy. A lock genuinely held by another
    // writer still refuses a write, and should: that one is not spurious.
    const lock = path.join(root, ".git", "index.lock");
    writeFileSync(lock, "");
    try {
      assert.throws(() => git("add", "second.txt"), /index\.lock/);
    } finally {
      rmSync(lock, { force: true });
    }
  });
});
