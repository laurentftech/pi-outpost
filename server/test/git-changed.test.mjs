/**
 * A commit or checkout made outside the application reaches the client.
 *
 * Over the socket, because the defect was what a client saw: badges, branch and the
 * editor's gutter describing a HEAD that had moved, since only the git directory changed
 * and nobody lists it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

function git(cwd, ...args) {
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" });
}

async function makeRepo(dir) {
  await mkdir(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  await writeFile(path.join(dir, "README.md"), "# project\n");
  git(dir, "add", "--", "README.md");
  git(dir, "commit", "-m", "initial");
}

describe("git state changed outside the application", () => {
  let server;
  let client;
  let root;

  before(async () => {
    root = await makeWorkspace({});
    await makeRepo(path.join(root, "projA"));
    await makeRepo(path.join(root, "projB"));
    server = await startServer(root);
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  // openlore: scenario=AnOutsideCommitIsAnnounced spec=git
  test("AnOutsideCommitIsAnnounced: a commit made in a terminal names its repository", async () => {
    await writeFile(path.join(root, "projB", "README.md"), "# changed\n");
    git(path.join(root, "projB"), "commit", "-qam", "outside");
    const changed = await client.waitFor((message) => message.type === "git_changed", 10_000);
    assert.equal(changed.repo, "projB");
  });

  // openlore: scenario=AnOutsideCheckoutMovesTheBranch spec=git
  test("AnOutsideCheckoutMovesTheBranch: the status read after the announcement names the new branch", async () => {
    git(path.join(root, "projA"), "checkout", "-q", "-b", "feature");
    const changed = await client.waitFor((message) => message.type === "git_changed" && message.repo === "projA", 10_000);
    client.send({ type: "git_status", repo: changed.repo, requestId: "after-checkout" });
    const status = await client.waitFor((message) => message.requestId === "after-checkout", 20_000);
    assert.equal(status.repos.find((repo) => repo.repo === "projA")?.branch, "feature");
  });
});
