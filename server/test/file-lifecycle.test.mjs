/** File lifecycle requests over the real WebSocket boundary. */
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

describe("file lifecycle over the socket", () => {
  let root;
  let server;
  let client;
  let observer;
  let requestCounter = 0;

  async function ask(message) {
    const requestId = `lifecycle-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((candidate) => candidate.requestId === requestId, 20_000);
  }

  before(async () => {
    root = await makeWorkspace({
      "writable/draft.docx": "draft",
      "writable/taken.docx": "taken",
      "writable/delete-me.txt": "delete",
      "writable/inbox/report.docx": "report",
      "writable/folders/drafts/a.txt": "a",
      "writable/folders/drafts/sub/b.txt": "b",
      "writable/folders/old/c.txt": "c",
      "readonly.txt": "readonly",
      "templates/letter.md": "letter",
      "templates/deep/memo.md": "memo",
      "writable/batch/one.txt": "1",
      "writable/batch/two.txt": "2",
      "writable/batch/three.txt": "3",
      "writable/batch/folder/inner.txt": "inner",
      "writable/moves/a.txt": "a",
      "writable/moves/c.txt": "c",
      "writable/moves/clash.txt": "mine",
      "writable/moves/target/clash.txt": "theirs",
      "outside-zone/b.txt": "b",
    });
    await mkdir(path.join(root, "writable/archive"), { recursive: true });
    server = await startServer(root, {
      sandbox: { root, allowWrite: true, writableRoot: path.join(root, "writable"), allowBash: false },
    });
    client = connect(server.wsUrl());
    observer = connect(server.wsUrl());
    await Promise.all([client.waitFor("hello"), observer.waitFor("hello")]);
  });

  after(async () => {
    client?.close();
    observer?.close();
    await server?.stop();
  });

  test("renames a file and broadcasts both affected paths", async () => {
    const reply = await ask({ type: "rename_file", path: "writable/draft.docx", name: "final.docx" });

    assert.equal(reply.type, "file_operation_result");
    assert.equal(reply.operation, "rename_file");
    assert.equal(reply.previousPath, "writable/draft.docx");
    assert.equal(reply.path, "writable/final.docx");
    assert.equal(await readFile(path.join(root, reply.path), "utf8"), "draft");
    await assert.rejects(stat(path.join(root, "writable/draft.docx")), { code: "ENOENT" });
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/draft.docx");
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/final.docx");
  });

  test("returns a correlated conflict without overwriting", async () => {
    await writeFile(path.join(root, "writable/source.docx"), "source");

    const reply = await ask({ type: "rename_file", path: "writable/source.docx", name: "taken.docx" });

    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "conflict");
    assert.equal(await readFile(path.join(root, "writable/source.docx"), "utf8"), "source");
    assert.equal(await readFile(path.join(root, "writable/taken.docx"), "utf8"), "taken");
  });

  test("deletes a confirmed file request and broadcasts its path", async () => {
    const reply = await ask({ type: "delete_file", path: "writable/delete-me.txt" });

    assert.equal(reply.type, "file_operation_result");
    assert.equal(reply.operation, "delete_file");
    await assert.rejects(stat(path.join(root, "writable/delete-me.txt")), { code: "ENOENT" });
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/delete-me.txt");
  });

  test("moves a file and broadcasts source and destination branches", async () => {
    const reply = await ask({ type: "move_file", path: "writable/inbox/report.docx", destinationDirectory: "writable/archive" });

    assert.equal(reply.type, "file_operation_result");
    assert.equal(reply.operation, "move_file");
    assert.equal(reply.previousPath, "writable/inbox/report.docx");
    assert.equal(reply.path, "writable/archive/report.docx");
    assert.equal(await readFile(path.join(root, reply.path), "utf8"), "report");
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/inbox/report.docx");
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/archive/report.docx");
  });

  test("copies a read-only file into a writable directory and keeps the source", async () => {
    const reply = await ask({ type: "copy_file", path: "readonly.txt", destinationDirectory: "writable/archive" });

    assert.equal(reply.type, "file_operation_result");
    assert.equal(reply.operation, "copy_file");
    assert.equal(reply.previousPath, undefined);
    assert.equal(reply.path, "writable/archive/readonly.txt");
    assert.equal(await readFile(path.join(root, reply.path), "utf8"), "readonly");
    assert.equal(await readFile(path.join(root, "readonly.txt"), "utf8"), "readonly");
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/archive/readonly.txt");
  });

  test("refuses a mutation outside the writable zone under the same request id", async () => {
    const reply = await ask({ type: "delete_file", path: "readonly.txt" });

    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "denied");
    assert.equal(await readFile(path.join(root, "readonly.txt"), "utf8"), "readonly");
  });

  test("a folder is renamed, moved and deleted over the socket, and each change is broadcast", async () => {
    const renamed = await ask({ type: "rename_file", path: "writable/folders/drafts", name: "final" });
    assert.equal(renamed.type, "file_operation_result");
    assert.equal(renamed.path, "writable/folders/final");
    assert.equal(await readFile(path.join(root, "writable", "folders", "final", "sub", "b.txt"), "utf8"), "b");
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/folders/final");

    const moved = await ask({ type: "move_file", path: "writable/folders/final", destinationDirectory: "writable/archive" });
    assert.equal(moved.type, "file_operation_result");
    assert.equal(moved.path, "writable/archive/final");
    assert.equal(await readFile(path.join(root, "writable", "archive", "final", "a.txt"), "utf8"), "a");

    const deleted = await ask({ type: "delete_file", path: "writable/folders/old" });
    assert.equal(deleted.type, "file_operation_result");
    await assert.rejects(stat(path.join(root, "writable", "folders", "old")), { code: "ENOENT" });
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/folders/old");
  });

  test("a read-only folder is copied into the writable zone with its content", async () => {
    const reply = await ask({ type: "copy_file", path: "templates", destinationDirectory: "writable/archive" });

    assert.equal(reply.type, "file_operation_result");
    assert.equal(reply.path, "writable/archive/templates");
    assert.equal(reply.skipped, undefined);
    assert.equal(await readFile(path.join(root, "writable", "archive", "templates", "deep", "memo.md"), "utf8"), "memo");
    assert.equal(await readFile(path.join(root, "templates", "letter.md"), "utf8"), "letter");
  });

  test("DeleteSeveralFiles: files and a folder go in one request, one result, one notification for their directory", async () => {
    const before = observer.received.length;
    const reply = await ask({
      type: "delete_files",
      paths: ["writable/batch/one.txt", "writable/batch/two.txt", "writable/batch/three.txt", "writable/batch/folder", "writable/batch/folder/inner.txt"],
    });

    assert.equal(reply.type, "file_batch_result");
    assert.equal(reply.operation, "delete_file");
    assert.deepEqual(
      reply.done.map((entry) => entry.path),
      ["writable/batch/one.txt", "writable/batch/two.txt", "writable/batch/three.txt", "writable/batch/folder"],
      "a path under a deleted folder is covered by it, not deleted twice",
    );
    assert.deepEqual(reply.refused, []);
    for (const name of ["one.txt", "two.txt", "three.txt", "folder"]) {
      await assert.rejects(stat(path.join(root, "writable", "batch", name)), { code: "ENOENT" });
    }
    // A request the observer makes now is answered after every broadcast already queued
    // for it, so what it has received by then is all the batch announced.
    observer.send({ type: "list_directory", path: "writable", requestId: "batch-barrier" });
    await observer.waitFor((message) => message.requestId === "batch-barrier");
    // Only this directory's: the previous test's copy into writable/archive can still be
    // announced late, by the file watcher, on a slow run.
    const changes = observer.received
      .slice(before)
      .filter((message) => message.type === "file_changed" && /^writable\/batch(\/|$)/.test(message.path));
    assert.equal(changes.length, 1, `one notification for writable/batch, got ${JSON.stringify(changes.map((m) => m.path))}`);
    assert.match(changes[0].path, /^writable\/batch\/[^/]+$/);
  });

  test("OneRefusalDoesNotStopTheBatch and ABatchMoveRefusesAnOverwrite", async () => {
    const reply = await ask({
      type: "move_files",
      paths: ["writable/moves/a.txt", "outside-zone/b.txt", "writable/moves/clash.txt", "writable/moves/c.txt"],
      destinationDirectory: "writable/moves/target",
    });

    assert.equal(reply.type, "file_batch_result");
    assert.deepEqual(reply.done, [
      { path: "writable/moves/a.txt", resultPath: "writable/moves/target/a.txt" },
      { path: "writable/moves/c.txt", resultPath: "writable/moves/target/c.txt" },
    ]);
    assert.deepEqual(reply.refused.map((entry) => [entry.path, entry.reason]), [
      ["outside-zone/b.txt", "denied"],
      ["writable/moves/clash.txt", "conflict"],
    ]);
    assert.ok(reply.refused.every((entry) => entry.message.length > 0));
    assert.equal(await readFile(path.join(root, "outside-zone", "b.txt"), "utf8"), "b");
    assert.equal(await readFile(path.join(root, "writable", "moves", "clash.txt"), "utf8"), "mine");
    assert.equal(await readFile(path.join(root, "writable", "moves", "target", "clash.txt"), "utf8"), "theirs");
    assert.equal(await readFile(path.join(root, "writable", "moves", "target", "c.txt"), "utf8"), "c");
  });

  test("DeleteThenRestore over the socket: a deletion answers a token, restore_deleted brings it back", async () => {
    await mkdir(path.join(root, "writable", "undo", "folder"), { recursive: true });
    await writeFile(path.join(root, "writable", "undo", "folder", "kept.txt"), "kept");
    await writeFile(path.join(root, "writable", "undo", "one.txt"), "one");

    const single = await ask({ type: "delete_file", path: "writable/undo/folder" });
    assert.equal(single.type, "file_operation_result");
    assert.match(single.restoreToken, /^[0-9a-f]{32}$/);
    await assert.rejects(stat(path.join(root, "writable", "undo", "folder")), { code: "ENOENT" });
    // The bytes wait under the agent directory's trash, not where they were.
    assert.equal(await readFile(path.join(root, ".pi-agent", "outpost-trash", single.restoreToken, "entry", "kept.txt"), "utf8"), "kept");

    const batch = await ask({ type: "delete_files", paths: ["writable/undo/one.txt"] });
    assert.equal(batch.done.length, 1);
    assert.match(batch.done[0].restoreToken, /^[0-9a-f]{32}$/);

    const restored = await ask({ type: "restore_deleted", tokens: [single.restoreToken, batch.done[0].restoreToken] });
    assert.equal(restored.type, "file_batch_result");
    assert.equal(restored.operation, "restore_deleted");
    assert.deepEqual(restored.done.map((entry) => entry.path).sort(), ["writable/undo/folder", "writable/undo/one.txt"]);
    assert.deepEqual(restored.refused, []);
    assert.equal(await readFile(path.join(root, "writable", "undo", "folder", "kept.txt"), "utf8"), "kept");
    assert.equal(await readFile(path.join(root, "writable", "undo", "one.txt"), "utf8"), "one");
    await observer.waitFor((message) => message.type === "file_changed" && message.path.startsWith("writable/undo/"));

    const again = await ask({ type: "restore_deleted", tokens: [single.restoreToken] });
    assert.deepEqual(again.done, []);
    assert.equal(again.refused[0].reason, "not-found", "a token restores once");
  });

  test("RestoreRefusesAnOverwrite over the socket: a file that took the place is left alone", async () => {
    await writeFile(path.join(root, "writable", "place.txt"), "old");
    const deleted = await ask({ type: "delete_file", path: "writable/place.txt" });
    await writeFile(path.join(root, "writable", "place.txt"), "new");

    const restored = await ask({ type: "restore_deleted", tokens: [deleted.restoreToken] });
    assert.deepEqual(restored.refused.map((entry) => [entry.path, entry.reason]), [["writable/place.txt", "conflict"]]);
    assert.equal(await readFile(path.join(root, "writable", "place.txt"), "utf8"), "new");
  });

  test("a malformed batch is ignored rather than half-applied", async () => {
    client.send({ type: "delete_files", paths: ["writable/taken.docx", 42], requestId: "bad-batch" });
    const probe = await ask({ type: "rename_file", path: "writable/taken.docx", name: "taken-still.docx" });
    assert.equal(probe.type, "file_operation_result", "the earlier malformed batch deleted nothing");
    await ask({ type: "rename_file", path: "writable/taken-still.docx", name: "taken.docx" });
  });

  test("the writable root itself cannot be deleted over the socket", async () => {
    const reply = await ask({ type: "delete_file", path: "writable" });

    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "denied");
    assert.ok((await stat(path.join(root, "writable"))).isDirectory());
  });

  test("refuses an escaping mutation under the same request id", async () => {
    const reply = await ask({ type: "move_file", path: "writable/final.docx", destinationDirectory: "../outside" });

    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "outside-root");
    assert.equal(await readFile(path.join(root, "writable/final.docx"), "utf8"), "draft");
  });
});
