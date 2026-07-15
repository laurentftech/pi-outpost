import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, after, describe, test } from "node:test";
import { probeGit, gitStatus, gitLog, gitShow, gitHeadContent, unquote } from "../src/git.ts";

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
    execFileSync("git", args, { cwd: root, shell: process.platform === "win32" });
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
    assert.equal(realpathSync(result!.toplevel), realpathSync(root));
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
