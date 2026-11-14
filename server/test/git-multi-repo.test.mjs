/**
 * A workspace rooted at a directory that is NOT a repository, holding one per child.
 *
 * The layout this whole change exists for: the git surface used to go dark here,
 * because the workspace held one repository or none. Over the socket, because what
 * matters is what a client can actually get after clicking a tracked leaf.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { secondProject } from "./multiProjectHarness.mjs";

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

async function makeRepo(dir, branch, subject) {
  await mkdir(dir, { recursive: true });
  git(dir, "init", "-b", branch);
  git(dir, "config", "user.email", "test@test");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  await writeFile(path.join(dir, "README.md"), "# project\n");
  git(dir, "add", "--", "README.md");
  git(dir, "commit", "-m", subject);
}

describe("a workspace holding a repository per child directory", () => {
  let server;
  let client;
  let root;
  let hello;
  let requestCounter = 0;

  async function ask(message) {
    const requestId = `req-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((m) => m.requestId === requestId, 20_000);
  }

  before(async () => {
    root = await makeWorkspace({});
    await makeRepo(path.join(root, "projA"), "main", "projA initial");
    await makeRepo(path.join(root, "projB"), "release", "projB initial");
    // A change in each, so both have something to badge
    await writeFile(path.join(root, "projA", "README.md"), "# projA changed\n");
    await writeFile(path.join(root, "projB", "fresh.txt"), "new\n");
    // A file belonging to no repository at all
    await writeFile(path.join(root, "notes.md"), "loose\n");

    server = await startServer(root);
    client = connect(server.wsUrl());
    hello = await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  // openlore: scenario=RepositoriesOnlyUnderneath spec=git
  test("advertises git as available, though the root is no repository", () => {
    assert.equal(hello.gitAvailable, true);
  });

  // openlore: scenario=StatusSpansRepositories spec=git
  test("reports both repositories, each with its own branch", async () => {
    const status = await ask({ type: "git_status" });
    assert.equal(status.type, "git_status");
    const branches = Object.fromEntries(status.repos.map((repo) => [repo.repo, repo.branch]));
    assert.deepEqual(branches, { projA: "main", projB: "release" });
  });

  // openlore: scenario=NestedRepositoriesUnderANonRepositoryRoot spec=git
  test("badges files from both, keyed from the browser root", async () => {
    const status = await ask({ type: "git_status" });
    const byPath = Object.fromEntries(status.files.map((file) => [file.path, file.status]));
    assert.equal(byPath["projA/README.md"], "modified");
    assert.equal(byPath["projB/fresh.txt"], "untracked");
  });

  test("diffs a file against the HEAD of ITS repository", async () => {
    const diff = await ask({ type: "git_diff", path: "projA/README.md" });
    assert.equal(diff.type, "git_diff");
    assert.equal(diff.before, "# project\n");
    assert.equal(diff.after, "# projA changed\n");
  });

  // openlore: scenario=FullGitSurfaceOnClickingATrackedLeaf spec=git
  test("gives a file its own repository's history", async () => {
    const log = await ask({ type: "git_file_log", path: "projA/README.md" });
    assert.equal(log.type, "git_file_log");
    assert.deepEqual(
      log.entries.map((entry) => entry.subject),
      ["projA initial"],
    );
    assert.deepEqual([...new Set(log.entries.map((entry) => entry.path))], ["projA/README.md"]);
  });

  // openlore: scenario=LogIsScopedToTheNamedRepository spec=git
  test("scopes the commit log to the repository the client names", async () => {
    const a = await ask({ type: "git_log", repo: "projA" });
    const b = await ask({ type: "git_log", repo: "projB" });
    assert.deepEqual(
      a.entries.map((entry) => entry.subject),
      ["projA initial"],
    );
    assert.deepEqual(
      b.entries.map((entry) => entry.subject),
      ["projB initial"],
    );
  });

  // openlore: scenario=CommitIdFromAnotherRepository spec=git
  test("refuses a commit id against a repository that does not have it", async () => {
    const b = await ask({ type: "git_log", repo: "projB" });
    const answer = await ask({ type: "git_show", repo: "projA", sha: b.entries[0].sha });
    assert.equal(answer.type, "git_error");
  });

  test("refuses a repository it does not hold, rather than picking one", async () => {
    const answer = await ask({ type: "git_log", repo: "projZ" });
    assert.equal(answer.type, "git_error");
    assert.match(answer.message, /projZ/);
  });

  // openlore: scenario=AFileOwnedByNoRepository spec=git
  test("says so for a file under no repository, and keeps its siblings' status", async () => {
    const answer = await ask({ type: "git_diff", path: "notes.md" });
    assert.equal(answer.type, "git_error");
    assert.match(answer.message, /not in a git repository/i);

    const status = await ask({ type: "git_status" });
    assert.equal(status.type, "git_status");
    assert.ok(status.files.some((file) => file.path === "projA/README.md"));
  });

  test("reads one repository when the client scopes the request", async () => {
    const full = await ask({ type: "git_status" });
    const status = await ask({ type: "git_status", repo: "projB", base: full.version });
    assert.equal(status.repo, "projB");
    assert.equal(status.base, full.version);
    assert.deepEqual(
      status.repos.map((repo) => repo.repo),
      ["projB"],
    );
    assert.equal(
      status.files.some((file) => file.path.startsWith("projA/")),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
describe("the status sent as changes", () => {
  let server;
  let client;
  let root;
  let requestCounter = 0;

  async function ask(message) {
    const requestId = `delta-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((m) => m.requestId === requestId, 20_000);
  }

  /** What a client holds after applying `answer` to `held`, by the protocol's rules. */
  function apply(held, answer) {
    if (answer.base === undefined) return new Map(answer.files.map((file) => [file.path, file]));
    assert.equal(answer.base, held.version);
    const next = new Map(held.files);
    for (const path of answer.removed) next.delete(path);
    for (const file of answer.files) next.set(file.path, file);
    return next;
  }

  before(async () => {
    root = await makeWorkspace({});
    await makeRepo(path.join(root, "projA"), "main", "projA initial");
    await makeRepo(path.join(root, "projB"), "main", "projB initial");
    for (let i = 0; i < 300; i++) await writeFile(path.join(root, "projA", `new${i}.txt`), "x\n");
    server = await startServer(root);
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  // openlore: scenario=ARefreshSendsOnlyWhatChanged spec=git
  test("ARefreshSendsOnlyWhatChanged: one more modified file is the whole answer", async () => {
    const first = await ask({ type: "git_status" });
    assert.equal(first.base, undefined);
    assert.equal(first.files.length, 300);
    await writeFile(path.join(root, "projB", "README.md"), "# changed\n");
    const second = await ask({ type: "git_status", base: first.version });
    assert.equal(second.base, first.version);
    assert.deepEqual(second.files, [{ path: "projB/README.md", status: "modified" }]);
    assert.deepEqual(second.removed, []);
    const held = apply({ version: first.version, files: apply(undefined, first) }, second);
    assert.equal(held.size, 301);
    assert.equal(held.get("projA/new0.txt")?.status, "untracked");

    // A scoped refresh with nothing new says nothing, and leaves the other repository alone
    const third = await ask({ type: "git_status", repo: "projA", base: second.version });
    assert.equal(third.repo, "projA");
    assert.deepEqual(third.files, []);
    assert.deepEqual(third.removed, []);
  });

  // openlore: scenario=AFileNoLongerChangedLeaves spec=git
  test("AFileNoLongerChangedLeaves: a restored file is named as removed", async () => {
    const first = await ask({ type: "git_status" });
    assert.ok(first.files.some((file) => file.path === "projB/README.md"));
    await writeFile(path.join(root, "projB", "README.md"), "# project\n");
    const second = await ask({ type: "git_status", repo: "projB", base: first.version });
    assert.deepEqual(second.removed, ["projB/README.md"]);
    assert.deepEqual(second.files, []);
    const held = apply({ version: first.version, files: apply(undefined, first) }, second);
    assert.equal(held.has("projB/README.md"), false);
    assert.equal(held.size, 300);
  });

  // openlore: scenario=AStrangerVersionGetsEverything spec=git
  test("AStrangerVersionGetsEverything: a version this connection was not last sent gets the full status", async () => {
    const first = await ask({ type: "git_status" });
    const stale = await ask({ type: "git_status", repo: "projB", base: first.version - 1 });
    assert.equal(stale.base, undefined);
    assert.equal(stale.repo, undefined, "a stranger version gets a full sweep, not a scoped one");
    assert.equal(stale.files.length, 300);
    assert.ok(stale.version > first.version);

    // Another connection's version means nothing on this one
    const other = connect(server.wsUrl());
    try {
      await other.waitFor("hello");
      other.send({ type: "git_status", requestId: "other", base: stale.version });
      const answer = await other.waitFor((m) => m.requestId === "other", 20_000);
      assert.equal(answer.base, undefined);
      assert.equal(answer.files.length, 300);
    } finally {
      other.close();
    }
  });
});

// ---------------------------------------------------------------------------
describe("a status asked just before the connection moves to another project", () => {
  test("is answered, and never with the project left behind", async (t) => {
    const root = await realpath(await makeWorkspace({}));
    await makeRepo(root, "main", "initial");
    await writeFile(path.join(root, "README.md"), "# changed\n");
    for (let i = 0; i < 2500; i++) await writeFile(path.join(root, `n${i}.txt`), "x\n");
    const beta = await secondProject();
    const server = await startServer(root, { openProjects: [beta] });
    const client = connect(server.wsUrl());
    t.after(async () => {
      client.close();
      await server.stop();
      await rm(root, { recursive: true, force: true });
      await rm(beta, { recursive: true, force: true });
    });
    await client.waitFor("hello");
    const order = [];
    const seen = (m) => {
      if (m.type === "workspace_switched" || m.requestId === "moving") order.push(m);
      return m.requestId === "moving";
    };
    client.send({ type: "git_status", requestId: "moving" });
    client.send({ type: "switch_workspace", root: beta });
    const answer = await client.waitFor(seen, 20_000);
    const switchedFirst = order.findIndex((m) => m.type === "workspace_switched") !== -1;
    if (switchedFirst) {
      // Answered for where the connection is now: a project without a repository
      assert.deepEqual(answer.files, []);
    } else {
      assert.ok(answer.files.some((file) => file.path === "README.md"), "an answer sent before the switch is the old project's, in order");
    }
  });
});

// ---------------------------------------------------------------------------
describe("repositories that appear and vanish while the server runs", () => {
  let server;
  let client;
  let root;
  let requestCounter = 0;

  async function ask(message) {
    const requestId = `fresh-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((m) => m.requestId === requestId, 20_000);
  }

  /** Poll the status until `predicate` holds, or give up — the re-scan is debounced. */
  async function until(predicate, what) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = await ask({ type: "git_status" });
      if (status.type === "git_status" && predicate(status)) return status;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`timed out waiting for ${what}`);
  }

  before(async () => {
    root = await makeWorkspace({});
    await makeRepo(path.join(root, "first"), "main", "first initial");
    server = await startServer(root);
    client = connect(server.wsUrl());
    await client.waitFor("hello");
    // The watcher only watches what a client has listed — that is where a new
    // repository will be noticed appearing
    await ask({ type: "list_directory", path: "" });
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  // openlore: scenario=ARepositoryClonedWhileRunning spec=git
  test("a repository created after startup becomes usable without a restart", async () => {
    await makeRepo(path.join(root, "second"), "later", "second initial");
    await writeFile(path.join(root, "second", "fresh.txt"), "new\n");

    const status = await until((s) => s.repos.some((repo) => repo.repo === "second"), "the new repository to appear");
    assert.equal(status.repos.find((repo) => repo.repo === "second").branch, "later");

    const log = await ask({ type: "git_log", repo: "second" });
    assert.deepEqual(
      log.entries.map((entry) => entry.subject),
      ["second initial"],
    );
  });

  // openlore: scenario=TheReasonDoesNotOutliveItsCause spec=git
  test("stops explaining an absence that has ended", async () => {
    const announced = await client.waitFor((m) => m.type === "git_repositories_changed" && m.available === true, 20_000);
    assert.equal(announced.unavailable, undefined, "a reason outliving its cause explains a state that has passed");
  });

  // openlore: scenario=ARepositoryThatStopsBeingOne spec=git
  test("a directory that stops being a repository stops being consulted", async () => {
    await rm(path.join(root, "second", ".git"), { recursive: true, force: true });

    await until((s) => !s.repos.some((repo) => repo.repo === "second"), "the repository to leave the set");
    const answer = await ask({ type: "git_log", repo: "second" });
    assert.equal(answer.type, "git_error");
  });
});

// ---------------------------------------------------------------------------
// openlore: scenario=ARepositoryClonedWhileRunning spec=git
describe("a workspace that had no repository at all, and gains one", () => {
  let server;
  let client;
  let root;
  let requestCounter = 0;

  async function ask(message) {
    const requestId = `empty-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((m) => m.requestId === requestId, 20_000);
  }

  before(async () => {
    root = await makeWorkspace({ "notes.md": "no repository here yet\n" });
    server = await startServer(root);
    client = connect(server.wsUrl());
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  test("tells the client, which was told at connect there was none", async () => {
    const hello = await client.waitFor("hello");
    assert.equal(hello.gitAvailable, false);
    // The watcher only watches what a client has listed
    await ask({ type: "list_directory", path: "" });

    await makeRepo(path.join(root, "arrived"), "main", "arrived initial");

    const announced = await client.waitFor((m) => m.type === "git_repositories_changed", 20_000);
    assert.equal(announced.available, true, "a client that stopped asking must be told, not left to ask again");

    const status = await ask({ type: "git_status" });
    assert.equal(status.type, "git_status");
    assert.deepEqual(
      status.repos.map((repo) => repo.repo),
      ["arrived"],
    );
  });
});

// ---------------------------------------------------------------------------
// openlore: scenario=ARepositoryThatStopsBeingOne spec=git
describe("a workspace that loses its last repository", () => {
  let server;
  let client;
  let root;
  let requestCounter = 0;

  async function ask(message) {
    const requestId = `lost-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((m) => m.requestId === requestId, 20_000);
  }

  before(async () => {
    root = await makeWorkspace({});
    await makeRepo(path.join(root, "only"), "main", "only initial");
    server = await startServer(root);
    client = connect(server.wsUrl());
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  test("says git is gone, rather than leaving stale badges on screen", async () => {
    const hello = await client.waitFor("hello");
    assert.equal(hello.gitAvailable, true);
    await ask({ type: "list_directory", path: "" });

    // `rm -rf only/.git` changes `only`, which nobody expanded, so the watcher hears
    // nothing at all. The next status is what finds out: the repository cannot answer.
    await rm(path.join(root, "only", ".git"), { recursive: true, force: true });
    await ask({ type: "git_status" });

    const announced = await client.waitFor((m) => m.type === "git_repositories_changed", 20_000);
    assert.equal(announced.available, false);

    const answer = await ask({ type: "git_status" });
    assert.equal(answer.type, "git_error");
  });
});

// ---------------------------------------------------------------------------
// openlore: scenario=GitInstalledButNotOnThePath spec=git
describe("a server whose PATH has lost git", () => {
  let server;
  let client;
  let root;

  before(async () => {
    root = await makeWorkspace({});
    await makeRepo(path.join(root, "proj"), "main", "proj initial");
    // Exactly the reported failure: git installed where the installer put it, and a
    // server process whose PATH does not mention it. This used to remove the entire
    // git surface with no message at all.
    server = await startServer(root, {}, { env: { PATH: "" } });
    client = connect(server.wsUrl());
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  test("finds git anyway, and keeps its features", async () => {
    const hello = await client.waitFor("hello");
    assert.equal(hello.gitAvailable, true, "git is installed; PATH is the only thing that lost it");
    assert.equal(hello.gitUnavailable, undefined);

    client.send({ type: "git_status", requestId: "nopath-1" });
    const status = await client.waitFor((m) => m.requestId === "nopath-1", 20_000);
    assert.equal(status.type, "git_status");
    assert.deepEqual(
      status.repos.map((repo) => repo.repo),
      ["proj"],
    );
  });
});

// ---------------------------------------------------------------------------
// openlore: scenario=NoRepository spec=git
describe("a workspace with no repository at all", () => {
  let server;
  let client;
  let root;

  before(async () => {
    root = await makeWorkspace({ "notes.md": "no git here\n" });
    server = await startServer(root);
    client = connect(server.wsUrl());
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  test("says git is unavailable, and refuses git requests", async () => {
    const hello = await client.waitFor("hello");
    assert.equal(hello.gitAvailable, false);
    client.send({ type: "git_status", requestId: "none-1" });
    const answer = await client.waitFor((m) => m.requestId === "none-1", 20_000);
    assert.equal(answer.type, "git_error");
  });

  // openlore: scenario=NoRepositoryHere spec=git
  test("says WHY, so an ordinary directory is not mistaken for a broken install", async () => {
    const hello = await client.waitFor("hello");
    assert.deepEqual(hello.gitUnavailable, { reason: "no-repository" });
  });
});

// ---------------------------------------------------------------------------
// openlore: scenario=ARepositoryOnDiskGitWillNotRead spec=git
// chmod is advisory on Windows, so a repository cannot be made unreadable there; the
// classification is covered on every platform by the unit tests in git-executable.test.ts
describe("a repository git will not read", { skip: process.platform === "win32" }, () => {
  let server;
  let client;
  let root;

  before(async () => {
    root = await makeWorkspace({});
    await makeRepo(path.join(root, "proj"), "main", "proj initial");
    // A refusal git states in its own words, as dubious ownership does in the field.
    // `GIT_TEST_ASSUME_DIFFERENT_OWNER` would read better and is not in every git.
    chmodSync(path.join(root, "proj", ".git", "config"), 0o000);
    server = await startServer(root);
    client = connect(server.wsUrl());
  });

  after(async () => {
    client?.close();
    chmodSync(path.join(root, "proj", ".git", "config"), 0o644);
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  // openlore: scenario=GitRefusesTheRepository spec=git
  test("is not offered as though it worked, and git's own words say why", async () => {
    const hello = await client.waitFor("hello");
    // The disk says this is a repository. Only git can say whether it is a usable one,
    // and a surface offered on the strength of the disk alone fails where nobody looks.
    assert.equal(hello.gitAvailable, false);
    assert.equal(hello.gitUnavailable?.reason, "refused");
    assert.match(hello.gitUnavailable.message, /permission denied/i);
  });
});

// ---------------------------------------------------------------------------
// openlore: scenario=InvalidExecutableValue spec=config
describe("a configured git that cannot run", () => {
  let root;

  before(async () => {
    root = await makeWorkspace({});
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("stops the server at startup rather than running one feature short", async () => {
    // An operator who names an executable should hear about a typo at boot, not the
    // first time somebody opens a file tree
    await assert.rejects(
      () => startServer(root, { gitPath: path.join(root, "not-a-git") }),
      (error) => /server exited/i.test(error.message) && /not-a-git/.test(error.message),
    );
  });
});

// ---------------------------------------------------------------------------
// openlore: scenario=RepositoriesArePerWorkspace spec=multi-project-workspaces
describe("two open projects, each with its own repositories", () => {
  let server;
  let client;
  let alpha;
  let beta;
  let requestCounter = 0;

  async function ask(message) {
    const requestId = `per-ws-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((m) => m.requestId === requestId, 20_000);
  }

  before(async () => {
    alpha = await realpath(await makeWorkspace({}));
    beta = await realpath(await makeWorkspace({}));
    await makeRepo(path.join(alpha, "inAlpha"), "alpha-branch", "alpha initial");
    await makeRepo(path.join(beta, "inBeta"), "beta-branch", "beta initial");

    server = await startServer(alpha, { openProjects: [alpha, beta] });
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(alpha, { recursive: true, force: true });
    await rm(beta, { recursive: true, force: true });
  });

  test("answers a git request from the subscribed project's repositories only", async () => {
    const inAlpha = await ask({ type: "git_status" });
    assert.deepEqual(
      inAlpha.repos.map((repo) => repo.repo),
      ["inAlpha"],
    );

    client.send({ type: "switch_workspace", root: beta });
    const switched = await client.waitFor((m) => m.type === "workspace_switched", 20_000);
    assert.equal(switched.workspace.root, beta);

    const inBeta = await ask({ type: "git_status" });
    assert.deepEqual(
      inBeta.repos.map((repo) => repo.repo),
      ["inBeta"],
    );
    assert.equal(inBeta.repos[0].branch, "beta-branch");
  });

  test("refuses the other project's repository by name", async () => {
    const answer = await ask({ type: "git_log", repo: "inAlpha" });
    assert.equal(answer.type, "git_error");
  });
});
