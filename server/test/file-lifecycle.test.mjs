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
