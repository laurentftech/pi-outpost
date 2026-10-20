/**
 * Directory watching across the real socket boundary.
 *
 * Everything here changes the filesystem directly — no tool call, no browser
 * request, nothing this server did. That is the case the old `announceFileChange`
 * path could not see at all, and the reason a tree could sit there showing a
 * workspace that had moved on without it.
 */
import assert from "node:assert/strict";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

/** Long enough for the coalescing window plus the trip back, short enough to be a test. */
const ANNOUNCE_TIMEOUT_MS = 10_000;

describe("watching the directories the browser has listed", () => {
  let root;
  let server;
  let client;
  let requestCounter = 0;

  async function ask(message) {
    const requestId = `watch-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((candidate) => candidate.requestId === requestId, 20_000);
  }

  /** List a directory, which is also what registers the watch. */
  async function list(dirPath) {
    const reply = await ask({ type: "list_directory", path: dirPath });
    assert.equal(reply.type, "directory_listing", `listing "${dirPath}" failed: ${reply.message ?? ""}`);
    return reply;
  }

  const changedDirectory = (dirPath) => (message) => message.type === "directory_changed" && message.path === dirPath;

  before(async () => {
    root = await makeWorkspace({
      "docs/note.md": "note",
      "inbox/report.txt": "report",
      "archive/.keep": "",
      "unopened/buried.txt": "buried",
      "shown/diagram.drawio": "<mxfile/>",
    });
    server = await startServer(root, { sandbox: { root, allowWrite: true, writableRoot: root, allowBash: false } });
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
  });

  test("announces a file that appeared without this server's involvement", async () => {
    await list("docs");
    const announced = client.waitFor(changedDirectory("docs"), ANNOUNCE_TIMEOUT_MS);
    // No write_file, no tool call — the agent's bash, another editor, or a person.
    await writeFile(path.join(root, "docs/appeared.md"), "new");
    await announced;
  });

  test("announces a file that vanished the same way", async () => {
    await list("docs");
    const announced = client.waitFor(changedDirectory("docs"), ANNOUNCE_TIMEOUT_MS);
    await rm(path.join(root, "docs/appeared.md"));
    await announced;
  });

  test("announces both ends of a move made outside the process", async () => {
    await list("inbox");
    await list("archive");
    const left = client.waitFor(changedDirectory("inbox"), ANNOUNCE_TIMEOUT_MS);
    const arrived = client.waitFor(changedDirectory("archive"), ANNOUNCE_TIMEOUT_MS);
    // The user's own report: a file dragged somewhere else in Finder or Explorer.
    await rename(path.join(root, "inbox/report.txt"), path.join(root, "archive/report.txt"));
    await Promise.all([left, arrived]);
  });

  test("follows a file that was read, though nobody listed its folder", async () => {
    // A diagram drawn in a reply, a file opened from a link: shown, never expanded
    const read = await ask({ type: "read_file", path: "shown/diagram.drawio" });
    assert.equal(read.type, "file_content");
    const announced = client.waitFor(changedDirectory("shown"), ANNOUNCE_TIMEOUT_MS);
    await writeFile(path.join(root, "shown/diagram.drawio"), "<mxfile><diagram/></mxfile>");
    await announced;
  });

  test("says nothing about a directory nobody listed", async () => {
    await list("docs");
    const before = client.received.filter((m) => m.type === "directory_changed").length;
    await writeFile(path.join(root, "unopened/another.txt"), "x");
    // Wait on a directory that *is* watched, so this is a real ordering check and
    // not just a sleep: by the time "docs" has been announced, anything the
    // unopened directory was going to produce has had its chance.
    const announced = client.waitFor(changedDirectory("docs"), ANNOUNCE_TIMEOUT_MS);
    await writeFile(path.join(root, "docs/marker.md"), "x");
    await announced;
    const seen = client.received.filter((m) => m.type === "directory_changed");
    assert.deepEqual(
      seen.slice(before).map((m) => m.path).filter((p) => p === "unopened"),
      [],
    );
  });

  test("watches a directory created and then listed after startup", async () => {
    await mkdir(path.join(root, "late"), { recursive: true });
    await list("late");
    const announced = client.waitFor(changedDirectory("late"), ANNOUNCE_TIMEOUT_MS);
    await writeFile(path.join(root, "late/first.txt"), "x");
    await announced;
  });
});

describe("with watching turned off", () => {
  let root;
  let server;
  let client;

  before(async () => {
    root = await makeWorkspace({ "docs/note.md": "note" });
    server = await startServer(root, {
      files: { watch: false },
      sandbox: { root, allowWrite: true, writableRoot: root, allowBash: false },
    });
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
  });

  test("still lists directories, and announces nothing", async () => {
    client.send({ type: "list_directory", path: "docs", requestId: "off-1" });
    const listing = await client.waitFor((m) => m.requestId === "off-1", 20_000);
    assert.equal(listing.type, "directory_listing");

    await writeFile(path.join(root, "docs/ignored.md"), "x");
    // A write_file through the browser still broadcasts `file_changed` — that path
    // is untouched by this setting — so waiting for it proves the round trip
    // happened, and that no `directory_changed` came with it.
    const changed = client.waitFor("file_changed", 20_000);
    client.send({ type: "write_file", path: "docs/note.md", content: "edited", expectedMtimeMs: 0, force: true, requestId: "off-2" });
    await changed;

    assert.deepEqual(
      client.received.filter((m) => m.type === "directory_changed"),
      [],
    );
  });
});
