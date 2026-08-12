import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, after, describe, test } from "node:test";
import { probeGit, gitStatus, gitLog, gitShow, gitHeadContent, gitFileLog, gitRevisionContent, unquote } from "../src/git.ts";

// ---------------------------------------------------------------------------
// unquote — C-style path unquoting (pure, no git needed)
// ---------------------------------------------------------------------------
describe("unquote", () => {
  test("passes through an unquoted string", () => {
    assert.equal(unquote("src/main.ts"), "src/main.ts");
  });

  test("passes through an empty string", () => {
    assert.equal(unquote(""), "");
  });

  test("unquotes a simple C-quoted string", () => {
    assert.equal(unquote('"src/main.ts"'), "src/main.ts");
  });

  test("unquotes octal-encoded accented characters", () => {
    // \303\251 = é in octal
    assert.equal(unquote('"r\\303\\251sum\\303\\251.pdf"'), "résumé.pdf");
  });

  test("unquotes escaped special characters", () => {
    assert.equal(unquote('"file\\040name.txt"'), "file name.txt");
  });

  test("handles backslash and double-quote escapes", () => {
    assert.equal(unquote('"\\"quoted\\""'), '"quoted"');
  });
});

// ---------------------------------------------------------------------------
// Git integration tests (require a real git repo)
// ---------------------------------------------------------------------------
describe("git operations", () => {
  let root: string;

  function git(...args: string[]) {
    execFileSync("git", args, { cwd: root });
  }

  function write(relPath: string, content: string) {
    const full = relPath.startsWith("/") ? relPath : `${root}/${relPath}`;
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  function setupRepo() {
    git("init");
    git("branch", "-M", "main");
    git("config", "user.email", "test@test");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    // A tracked file
    write("README.md", "# Project\n");
    git("add", ".");
    git("commit", "-m", "initial commit");
    // A second commit
    write("README.md", "# Project\n\nUpdated.\n");
    write("src/main.ts", 'console.log("hi");\n');
    git("add", ".");
    git("commit", "-m", "add main.ts and update readme");
  }

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "pi-git-test-"));
    setupRepo();
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("probeGit returns the toplevel", async () => {
    const result = await probeGit(root);
    assert.ok(result !== null, "expected a git repo");
    // The toplevel must be a real directory containing the .git we created.
    // On Windows, os.tmpdir() may use 8.3 short names (RUNNER~1) while git
    // returns canonical long names (runneradmin), so compare resolved paths
    // instead of raw strings.
    assert.ok(existsSync(result!.toplevel), `toplevel ${result!.toplevel} should exist`);
    assert.ok(existsSync(path.join(result!.toplevel, ".git")), ".git should be inside toplevel");
  });

  test("probeGit returns null for a non-git directory", async () => {
    const noGit = mkdtempSync(path.join(tmpdir(), "pi-no-git-"));
    try {
      const result = await probeGit(noGit);
      assert.equal(result, null);
    } finally {
      rmSync(noGit, { recursive: true, force: true });
    }
  });

  test("gitStatus reports branch and tracked files", async () => {
    const status = await gitStatus(root);
    assert.equal(status.branch, "main");
    assert.equal(status.ahead, 0);
    assert.equal(status.behind, 0);
    // After the second commit, everything is committed — no pending changes
    assert.equal(status.files.length, 0);
  });

  test("gitStatus detects untracked files", async () => {
    write("new.txt", "new file");
    try {
      const status = await gitStatus(root);
      const untracked = status.files.find((f) => f.path === "new.txt");
      assert.ok(untracked, "expected new.txt to appear as untracked");
      assert.equal(untracked!.status, "untracked");
    } finally {
      rmSync(`${root}/new.txt`);
    }
  });

  test("gitStatus detects modified files", async () => {
    write("README.md", "# Modified\n");
    try {
      const status = await gitStatus(root);
      const modified = status.files.find((f) => f.path === "README.md");
      assert.ok(modified, "expected README.md to appear");
      assert.equal(modified!.status, "modified");
    } finally {
      write("README.md", "# Project\n\nUpdated.\n");
    }
  });

  test("gitLog returns commit history in reverse order", async () => {
    const log = await gitLog(root, 10);
    assert.equal(log.length, 2);
    assert.equal(log[0].subject, "add main.ts and update readme");
    assert.equal(log[1].subject, "initial commit");
    assert.ok(/[0-9a-f]{7,40}/.test(log[0].sha));
    assert.ok(log[0].author.length > 0);
    assert.ok(log[0].date.length > 0);
  });

  test("gitLog respects the limit", async () => {
    const log = await gitLog(root, 1);
    assert.equal(log.length, 1);
  });

  test("gitShow returns a commit patch", async () => {
    const log = await gitLog(root, 1);
    const result = await gitShow(root, log[0].sha);
    assert.ok(result.patch.length > 0);
    assert.equal(result.truncated, false);
    // Should show the diff for src/main.ts and README.md
    assert.ok(result.patch.includes("src/main.ts"));
  });

  test("gitShow rejects an invalid sha", async () => {
    await assert.rejects(
      () => gitShow(root, "not-a-sha"),
      /Invalid commit id/,
    );
  });

  test("gitShow rejects a very short sha", async () => {
    await assert.rejects(
      () => gitShow(root, "abc"),
      /Invalid commit id/,
    );
  });

  test("gitHeadContent returns HEAD content for a tracked file", async () => {
    const content = await gitHeadContent(root, root, "README.md");
    assert.ok(content.includes("Updated"));
  });

  test("gitHeadContent returns empty string for an untracked file", async () => {
    write("untracked.txt", "fresh");
    const content = await gitHeadContent(root, root, "untracked.txt");
    assert.equal(content, "");
  });

  test("gitHeadContent returns empty for a non-existent file", async () => {
    const content = await gitHeadContent(root, root, "no-such-file.ts");
    assert.equal(content, "");
  });

  test("gitHeadContent works with nested paths", async () => {
    const content = await gitHeadContent(root, root, "src/main.ts");
    assert.ok(content.includes('console.log("hi")'));
  });
});

// ---------------------------------------------------------------------------
// File history — a repo shaped to exercise every branch of the stitching walk:
// a rename (which `--full-history` alone stops at), a fork and a merge resolving
// a conflict in the file (which `--follow` alone drops), and a subject carrying
// the record separator the log format uses.
// ---------------------------------------------------------------------------
describe("file history", () => {
  let root: string;
  /** Subject → sha, so assertions never depend on generated ids. */
  const sha: Record<string, string> = {};

  function git(...args: string[]) {
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  }

  function write(relPath: string, content: string) {
    const full = `${root}/${relPath}`;
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  function commit(subject: string) {
    git("add", "-A");
    git("commit", "-m", subject);
    sha[subject] = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  }

  const SEP_SUBJECT = "tidy up \x1e and carry on";

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "pi-git-history-"));
    git("init", "-b", "main");
    git("config", "user.email", "test@test");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");

    write("notes.txt", "1\n");
    commit("create notes");
    write("notes.txt", "1\n2\n");
    commit("extend notes");

    // Rename: `--full-history` stops here, so the walk has to probe and resume
    mkdirSync(`${root}/docs`, { recursive: true });
    git("mv", "notes.txt", "docs/notes.txt");
    write("docs/notes.txt", "1\n2\n3\n");
    commit("move notes into docs");

    // Fork both sides of the file, then merge with a conflict so the merge commit
    // differs from both parents and survives history simplification
    git("checkout", "-b", "side");
    write("docs/notes.txt", "1\n2\nside\n");
    commit("side edit");
    git("checkout", "main");
    write("docs/notes.txt", "1\n2\nmain\n");
    commit("main edit");
    try {
      git("merge", "--no-commit", "side");
    } catch {
      // expected: the conflict is the point
    }
    write("docs/notes.txt", "1\n2\nmerged\n");
    commit("merge side");

    write("docs/notes.txt", "1\n2\nmerged\n4\n");
    commit(SEP_SUBJECT);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("lists the file's commits newest first", async () => {
    const log = await gitFileLog(root, root, "docs/notes.txt", 50);
    assert.equal(log[0].subject, SEP_SUBJECT);
    assert.equal(log[0].sha, sha[SEP_SUBJECT]);
    assert.ok(log[0].author.length > 0);
    assert.ok(log[0].date.length > 0);
  });

  test("reports per-file line counts", async () => {
    const log = await gitFileLog(root, root, "docs/notes.txt", 50);
    const latest = log.find((entry) => entry.subject === SEP_SUBJECT);
    assert.equal(latest!.added, 1);
    assert.equal(latest!.deleted, 0);
  });

  test("keeps a record separator inside a subject", async () => {
    const log = await gitFileLog(root, root, "docs/notes.txt", 50);
    assert.ok(
      log.some((entry) => entry.subject === SEP_SUBJECT),
      `expected the \\x1e subject to survive parsing, got ${JSON.stringify(log.map((e) => e.subject))}`,
    );
  });

  test("keeps the merge commit and both its parents", async () => {
    const log = await gitFileLog(root, root, "docs/notes.txt", 50);
    const merge = log.find((entry) => entry.subject === "merge side");
    assert.ok(merge, "expected the merge commit in the history");
    assert.equal(merge!.parents.length, 2);
    assert.deepEqual(new Set(merge!.parents), new Set([sha["main edit"], sha["side edit"]]));
  });

  test("follows the rename past the point --full-history stops at", async () => {
    const log = await gitFileLog(root, root, "docs/notes.txt", 50);
    const subjects = log.map((entry) => entry.subject);
    assert.ok(subjects.includes("extend notes"), `expected pre-rename history, got ${JSON.stringify(subjects)}`);
    assert.ok(subjects.includes("create notes"));
  });

  test("reports the path the file had at each commit", async () => {
    const log = await gitFileLog(root, root, "docs/notes.txt", 50);
    assert.equal(log.find((entry) => entry.subject === "create notes")!.path, "notes.txt");
    assert.equal(log.find((entry) => entry.subject === "main edit")!.path, "docs/notes.txt");
  });

  test("leaves every entry connected to one already in the list", async () => {
    const log = await gitFileLog(root, root, "docs/notes.txt", 50);
    const present = new Set(log.map((entry) => entry.sha));
    for (const entry of log.slice(0, -1)) {
      assert.ok(entry.parents.length > 0, `${entry.subject} has no parent to draw a rail to`);
      for (const parent of entry.parents) assert.ok(present.has(parent), `${entry.subject} points at an absent parent`);
    }
    assert.deepEqual(log[log.length - 1].parents, [], "the root commit has no parent");
  });

  test("clamps the limit", async () => {
    assert.equal((await gitFileLog(root, root, "docs/notes.txt", 2)).length, 2);
    assert.equal((await gitFileLog(root, root, "docs/notes.txt", 0)).length, 1);
  });

  test("returns an empty list for an untracked file", async () => {
    write("scratch.txt", "not committed\n");
    try {
      assert.deepEqual(await gitFileLog(root, root, "scratch.txt", 50), []);
    } finally {
      rmSync(`${root}/scratch.txt`);
    }
  });

  test("gitRevisionContent reads the file at a commit", async () => {
    const content = await gitRevisionContent(root, root, sha["main edit"], "docs/notes.txt");
    assert.equal(content, "1\n2\nmain\n");
  });

  test("gitRevisionContent reads the pre-rename path at an old commit", async () => {
    const content = await gitRevisionContent(root, root, sha["extend notes"], "notes.txt");
    assert.equal(content, "1\n2\n");
  });

  test("gitRevisionContent returns empty where the file did not exist yet", async () => {
    const content = await gitRevisionContent(root, root, sha["create notes"], "docs/notes.txt");
    assert.equal(content, "");
  });

  test("gitRevisionContent peels an annotated tag", async () => {
    git("tag", "-a", "v1", "-m", "release", sha["main edit"]);
    const tagId = execFileSync("git", ["rev-parse", "v1"], { cwd: root, encoding: "utf8" }).trim();
    const content = await gitRevisionContent(root, root, tagId, "docs/notes.txt");
    assert.equal(content, "1\n2\nmain\n");
  });

  test("gitRevisionContent refuses a blob id", async () => {
    const blob = execFileSync("git", ["rev-parse", `${sha["main edit"]}:docs/notes.txt`], { cwd: root, encoding: "utf8" }).trim();
    // ^{commit} refuses a blob outright, and that must surface rather than read as
    // an empty file — an empty side would silently render as an all-added diff
    await assert.rejects(() => gitRevisionContent(root, root, blob, "docs/notes.txt"), /blob/i);
  });

  test("gitRevisionContent refuses a malformed revision", async () => {
    await assert.rejects(() => gitRevisionContent(root, root, "main", "docs/notes.txt"), /Invalid commit id/);
    await assert.rejects(() => gitRevisionContent(root, root, "HEAD@{0}", "docs/notes.txt"), /Invalid commit id/);
    await assert.rejects(() => gitRevisionContent(root, root, "--upload-pack=evil", "docs/notes.txt"), /Invalid commit id/);
  });

  test("gitRevisionContent refuses the working-tree marker", async () => {
    await assert.rejects(() => gitRevisionContent(root, root, "worktree", "docs/notes.txt"), /read from disk/);
  });
});
