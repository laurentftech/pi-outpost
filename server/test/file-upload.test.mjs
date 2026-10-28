/**
 * Uploads over the real WebSocket boundary.
 *
 * The unit tests in fileBrowser.test.ts already cover confinement and the size
 * cap. What can only be seen from here is the wiring: that the answer correlates
 * by request id, that a refusal arrives as a file-browser error rather than as
 * silence, that open trees are told — and that a maximum-sized upload is
 * *answered* instead of tearing the connection down, which is the one failure the
 * composer has no way to report.
 */
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

/** Must match MAX_UPLOAD_BYTES in server/src/fileBrowser.ts. */
const MAX_UPLOAD_BYTES = 26_214_400;
const MAX_UPLOAD_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;

/** A PDF header followed by NUL and high bytes — what a text write refuses outright. */
const BINARY = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0x00, 0xff, 0xfe, 0x0a]);

describe("upload_file over the socket", () => {
  let root;
  let server;
  let client;
  let observer;
  let requestCounter = 0;

  async function ask(message, timeoutMs = 20_000) {
    const requestId = `upload-${++requestCounter}`;
    client.send({ ...message, requestId });
    return client.waitFor((candidate) => candidate.requestId === requestId, timeoutMs);
  }

  before(async () => {
    // `writable/keep` exists only so the writable root itself does: the sandbox
    // config refuses a writableRoot that is not on disk, and the point of the
    // suite is that the *uploads* directory below it is created on demand.
    root = await makeWorkspace({ "readonly/note.txt": "read only", "writable/keep": "" });
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

  test("stores an uploaded file, answers with its path and tells open trees", async () => {
    const reply = await ask({
      type: "upload_file",
      destinationDirectory: "writable/uploads",
      name: "report.pdf",
      contentBase64: BINARY.toString("base64"),
    });

    assert.equal(reply.type, "file_uploaded");
    assert.equal(reply.path, "writable/uploads/report.pdf");
    assert.deepEqual(await readFile(path.join(root, reply.path)), BINARY);
    await observer.waitFor((message) => message.type === "file_changed" && message.path === "writable/uploads/report.pdf");
  });

  test("answers a colliding name with the path it actually wrote", async () => {
    const reply = await ask({
      type: "upload_file",
      destinationDirectory: "writable/uploads",
      name: "report.pdf",
      contentBase64: Buffer.from("second").toString("base64"),
    });

    assert.equal(reply.type, "file_uploaded");
    assert.equal(reply.path, "writable/uploads/report-1.pdf");
    assert.equal(await readFile(path.join(root, "writable/uploads/report.pdf"), "base64"), BINARY.toString("base64"));
    assert.equal(await readFile(path.join(root, reply.path), "utf8"), "second");
  });

  test("refuses a destination outside the writable zone as denied", async () => {
    const reply = await ask({
      type: "upload_file",
      destinationDirectory: "readonly",
      name: "sneaky.pdf",
      contentBase64: BINARY.toString("base64"),
    });

    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "denied");
    await assert.rejects(stat(path.join(root, "readonly/sneaky.pdf")), { code: "ENOENT" });
  });

  test("refuses a writable destination that is not the uploads directory", async () => {
    // Confined, inside the writable zone, and still refused: upload_file is the
    // only message that writes arbitrary binary content and creates its own
    // parents, so it does not double as a general-purpose write-anywhere tool.
    const reply = await ask({
      type: "upload_file",
      destinationDirectory: "writable",
      name: "loose.pdf",
      contentBase64: BINARY.toString("base64"),
    });

    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "denied");
    await assert.rejects(stat(path.join(root, "writable/loose.pdf")), { code: "ENOENT" });
  });

  test("refuses a destination that escapes the browser root", async () => {
    const reply = await ask({
      type: "upload_file",
      destinationDirectory: "../elsewhere",
      name: "escaped.pdf",
      contentBase64: BINARY.toString("base64"),
    });

    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "outside-root");
  });

  test("refuses a name that is a path, and an undecodable body, as invalid", async () => {
    const namedAsPath = await ask({
      type: "upload_file",
      destinationDirectory: "writable/uploads",
      name: "../escaped.pdf",
      contentBase64: BINARY.toString("base64"),
    });
    assert.equal(namedAsPath.type, "file_browser_error");
    assert.equal(namedAsPath.reason, "invalid");

    const undecodable = await ask({
      type: "upload_file",
      destinationDirectory: "writable/uploads",
      name: "corrupt.pdf",
      contentBase64: "not base64!!",
    });
    assert.equal(undecodable.type, "file_browser_error");
    assert.equal(undecodable.reason, "invalid");
    await assert.rejects(stat(path.join(root, "writable/uploads/corrupt.pdf")), { code: "ENOENT" });
  });

  test("refuses a payload past the cap as too-large", async () => {
    const reply = await ask({
      type: "upload_file",
      destinationDirectory: "writable/uploads",
      name: "huge.pdf",
      contentBase64: "A".repeat(MAX_UPLOAD_BASE64_LENGTH + 4),
    });

    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "too-large");
    await assert.rejects(stat(path.join(root, "writable/uploads/huge.pdf")), { code: "ENOENT" });
  });

  test("answers a maximum-sized upload instead of closing the connection", async () => {
    const maximum = Buffer.alloc(MAX_UPLOAD_BYTES, 0x2a);

    const reply = await ask(
      {
        type: "upload_file",
        destinationDirectory: "writable/uploads",
        name: "maximum.bin",
        contentBase64: maximum.toString("base64"),
      },
      60_000,
    );

    assert.equal(reply.type, "file_uploaded");
    assert.equal(reply.path, "writable/uploads/maximum.bin");
    assert.equal((await stat(path.join(root, reply.path))).size, MAX_UPLOAD_BYTES);
    // The frame limit tears the socket down rather than answering; if it had, the
    // wait above would have rejected — assert the connection is still usable too.
    assert.equal(client.closed(), null);
  });
});

describe("upload_file against a read-only sandbox", () => {
  let root;
  let server;
  let client;

  before(async () => {
    root = await makeWorkspace({ "note.txt": "read only" });
    server = await startServer(root, { sandbox: { root, allowWrite: false, allowBash: false } });
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
  });

  test("refuses every upload as denied", async () => {
    client.send({
      type: "upload_file",
      destinationDirectory: "uploads",
      name: "report.pdf",
      contentBase64: BINARY.toString("base64"),
      requestId: "readonly-upload",
    });

    const reply = await client.waitFor((candidate) => candidate.requestId === "readonly-upload", 20_000);
    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "denied");
    await assert.rejects(stat(path.join(root, "uploads")), { code: "ENOENT" });
  });
});

describe("explicit existing-directory imports", () => {
  let root;
  let server;
  let client;
  let observer;
  let counter = 0;
  let workspaceId;
  before(async () => {
    root = await makeWorkspace({ "writable/nested/keep.txt": "keep", "readonly/keep.txt": "read only" });
    server = await startServer(root, { sandbox: { root, allowWrite: true, writableRoot: path.join(root, "writable"), allowBash: false } });
    client = connect(server.wsUrl());
    observer = connect(server.wsUrl());
    const [hello] = await Promise.all([client.waitFor("hello"), observer.waitFor("hello")]);
    workspaceId = hello.workspace.id ?? hello.workspace.root;
  });
  after(async () => { client?.close(); observer?.close(); await server?.stop(); });
  async function upload(destinationDirectory, name, content = BINARY) {
    const requestId = `tree-import-${++counter}`;
    client.send({ type: "upload_file", destinationDirectory, name, contentBase64: content.toString("base64"), existingDirectory: true, workspaceId, requestId });
    return client.waitFor((message) => message.requestId === requestId);
  }
  test("refuses an import meant for a different workspace before writing bytes", async () => {
    for (const expected of ["a-different-workspace", undefined]) {
      const requestId = `tree-import-${++counter}`;
      client.send({ type: "upload_file", destinationDirectory: "writable/nested", name: "wrong-project.txt", contentBase64: "YQ==", existingDirectory: true, workspaceId: expected, requestId });
      const reply = await client.waitFor((message) => message.requestId === requestId);
      assert.equal(reply.type, "file_browser_error");
      assert.equal(reply.reason, "denied");
      assert.match(reply.message, /workspace changed/);
      await assert.rejects(stat(path.join(root, "writable", "nested", "wrong-project.txt")), { code: "ENOENT" });
    }
  });
  test("UploadToAnExistingDirectory: stores bytes, notifies trees and preserves collisions", async () => {
    const first = await upload("writable/nested", "scan.pdf");
    assert.equal(first.type, "file_uploaded");
    assert.equal(first.path, "writable/nested/scan.pdf");
    assert.deepEqual(await readFile(path.join(root, first.path)), BINARY);
    await observer.waitFor((message) => message.type === "file_changed" && message.path === first.path);
    const second = await upload("writable/nested", "scan.pdf", Buffer.from("second"));
    assert.equal(second.path, "writable/nested/scan-1.pdf");
    assert.deepEqual(await readFile(path.join(root, first.path)), BINARY);
    assert.equal(await readFile(path.join(root, second.path), "utf8"), "second");
  });
  test("ImportDoesNotResurrectAMissingDirectory: refuses without creating parents", async () => {
    const reply = await upload("writable/missing/child", "file.txt");
    assert.equal(reply.type, "file_browser_error");
    assert.equal(reply.reason, "not-found");
    await assert.rejects(stat(path.join(root, "writable/missing")), { code: "ENOENT" });
  });
  test("ImportCannotEscapePermissions: refuses outside the writable zone and browser root", async () => {
    for (const [directory, reason] of [["readonly", "denied"], ["../outside", "outside-root"]]) {
      const reply = await upload(directory, "blocked.txt");
      assert.equal(reply.type, "file_browser_error");
      assert.equal(reply.reason, reason);
    }
    await assert.rejects(stat(path.join(root, "readonly/blocked.txt")), { code: "ENOENT" });
  });
});
