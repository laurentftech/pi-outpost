/**
 * git_file_log / git_file_diff over the WebSocket — the wiring the unit tests in
 * git.test.ts cannot see: dispatch, path confinement on both sides of a pair, and
 * the size limit that keeps an oversized blob off the wire.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

describe("file history over the socket", () => {
  let server;
  let client;
  /** Subject → sha, so assertions never depend on generated ids. */
  const sha = {};
  let requestCounter = 0;

  function git(root, ...args) {
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  }

  /** Send a request and wait for its answer, matched on requestId. */
  async function ask(message) {
    const requestId = `req-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((m) => m.requestId === requestId, 20_000);
  }

  before(async () => {
    const root = await makeWorkspace({});
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "test@test");
    git(root, "config", "user.name", "Test");
    git(root, "config", "commit.gpgsign", "false");

    // Stage the one path, never `-A`: a blanket add would sweep the deliberately
    // uncommitted notes.txt into the next commit and put it in that commit's history
    const commit = async (relPath, content, subject) => {
      const target = path.join(root, relPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
      git(root, "add", "--", relPath);
      git(root, "commit", "-m", subject);
      sha[subject] = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    };

    await commit("notes.txt", "one\n", "first");
    await commit("notes.txt", "one\ntwo\n", "second");
    // A committed file over the 1 MiB preview limit, then removed from the worktree
    // so only the commit side can trip the limit
    await commit("huge.txt", "x".repeat(1_100_000), "huge");
    await rm(path.join(root, "huge.txt"));
    // Uncommitted, so the worktree side differs from every commit
    await writeFile(path.join(root, "notes.txt"), "one\ntwo\nthree\n");

    server = await startServer(root);
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.ws.close();
    await server?.stop();
  });

  test("lists a file's commits", async () => {
    const reply = await ask({ type: "git_file_log", path: "notes.txt" });
    assert.equal(reply.type, "git_file_log");
    assert.equal(reply.path, "notes.txt");
    assert.deepEqual(
      reply.entries.map((entry) => entry.subject),
      ["second", "first"],
    );
    assert.equal(reply.entries[0].added, 1);
    assert.equal(reply.entries[0].path, "notes.txt");
  });

  test("diffs one commit against another", async () => {
    const reply = await ask({
      type: "git_file_diff",
      base: { rev: sha.first, path: "notes.txt" },
      target: { rev: sha.second, path: "notes.txt" },
    });
    assert.equal(reply.type, "git_file_diff");
    assert.equal(reply.beforeText, "one\n");
    assert.equal(reply.afterText, "one\ntwo\n");
    // Both revisions echo back so a client can drop a reply its selection moved past
    assert.equal(reply.base.rev, sha.first);
    assert.equal(reply.target.rev, sha.second);
  });

  test("diffs a commit against the working tree", async () => {
    const reply = await ask({
      type: "git_file_diff",
      base: { rev: sha.second, path: "notes.txt" },
      target: { rev: "worktree", path: "notes.txt" },
    });
    assert.equal(reply.type, "git_file_diff");
    assert.equal(reply.beforeText, "one\ntwo\n");
    assert.equal(reply.afterText, "one\ntwo\nthree\n");
  });

  test("renders the pair in the opposite direction when swapped", async () => {
    const reply = await ask({
      type: "git_file_diff",
      base: { rev: "worktree", path: "notes.txt" },
      target: { rev: sha.second, path: "notes.txt" },
    });
    assert.equal(reply.beforeText, "one\ntwo\nthree\n");
    assert.equal(reply.afterText, "one\ntwo\n");
  });

  test("refuses a log for a path outside the browser root", async () => {
    const reply = await ask({ type: "git_file_log", path: "../../etc/passwd" });
    assert.equal(reply.type, "git_error");
    assert.match(reply.message, /outside the browser root/);
  });

  test("refuses a diff whose side escapes the browser root", async () => {
    const reply = await ask({
      type: "git_file_diff",
      base: { rev: sha.first, path: "../../etc/passwd" },
      target: { rev: "worktree", path: "notes.txt" },
    });
    assert.equal(reply.type, "git_error");
    assert.match(reply.message, /outside the browser root/);
  });

  test("refuses a revision that is not a commit id", async () => {
    const reply = await ask({
      type: "git_file_diff",
      base: { rev: "main", path: "notes.txt" },
      target: { rev: "worktree", path: "notes.txt" },
    });
    assert.equal(reply.type, "git_error");
    assert.match(reply.message, /Invalid commit id/);
  });

  test("refuses an oversized commit side instead of putting it on the wire", async () => {
    const reply = await ask({
      type: "git_file_diff",
      base: { rev: sha.huge, path: "huge.txt" },
      // Deleted from the worktree, so this side is empty and only the commit trips the cap
      target: { rev: "worktree", path: "huge.txt" },
    });
    assert.equal(reply.type, "git_error");
    assert.match(reply.message, /larger than the 1 MB limit/);
  });
});
