/**
 * Opening an artifact the document bound its approval to.
 *
 * An artifact link carries a mandatory `sha256:` digest so that an approval refers
 * to stable bytes even when its URI is not. That promise is only worth something if
 * something checks it — a digest nobody verifies reads as a guarantee and is a
 * decoration.
 *
 * So the check happens where the bytes are read, over the real socket, against a
 * real file on disk. Two cases carry the whole weight: the artifact that is what it
 * says it is, and the one that moved on — which is not necessarily an attack. A
 * mutable path whose content changed since the extraction says exactly this, and it
 * is the case the digest exists for.
 *
 * What this deliberately does not do is fetch anything outward. An artifact
 * addressed at another host is shown, never retrieved on the reader's behalf: that
 * would be this server making requests a producer's document told it to make.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test, before, after } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const REPORT = "Verification report: 42 of 42 passed.\n";
const digestOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

describe("an artifact is opened only when its bytes are the ones approved", () => {
  let root;
  let server;
  let client;
  let counter = 0;

  /** The viewer's own read, with the digest an artifact link carries. */
  const open = async (file, sha256) => {
    const requestId = `open-${++counter}`;
    client.send({ type: "read_file", path: file, requestId, ...(sha256 === undefined ? {} : { sha256 }) });
    return client.waitFor((message) => message.requestId === requestId, 20_000);
  };

  before(async () => {
    root = await makeWorkspace({
      "evidence/report.txt": REPORT,
      "evidence/other.txt": "Something else entirely.\n",
    });
    server = await startServer(root, { sandbox: undefined });
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
  });

  test("the artifact the document names is opened, and its content handed over", async () => {
    const answer = await open("evidence/report.txt", digestOf(REPORT));
    assert.equal(answer.type, "file_content", `refused: ${answer.message ?? ""}`);
    assert.equal(answer.content, REPORT);
  });

  test("bytes that are not the approved ones are refused rather than shown", async () => {
    // The digest of the report, against the file beside it: the shape of a link
    // whose target moved.
    const answer = await open("evidence/other.txt", digestOf(REPORT));
    assert.equal(answer.type, "file_browser_error");
    assert.equal(answer.content, undefined, "the content was handed over anyway");
  });

  test("the refusal says what was expected and what is actually there", async () => {
    // A reader has to be able to tell a moved artifact from a corrupt one, and a
    // producer has to be able to fix the link. "Does not match" says neither.
    const answer = await open("evidence/other.txt", digestOf(REPORT));
    assert.match(answer.message, /sha256:[0-9a-f]{64}/);
    assert.ok(answer.message.includes(digestOf(REPORT)), "the expected digest is not named");
    assert.ok(
      answer.message.includes(digestOf("Something else entirely.\n")),
      "what is actually there is not named",
    );
  });

  test("a file that changes after the document was written stops opening", async () => {
    // The whole point of binding an approval to a digest rather than to a path.
    const moving = path.join(root, "evidence/moving.txt");
    await writeFile(moving, "first\n");
    const bound = digestOf("first\n");
    assert.equal((await open("evidence/moving.txt", bound)).type, "file_content");

    await writeFile(moving, "second\n");
    const after = await open("evidence/moving.txt", bound);
    assert.equal(after.type, "file_browser_error");
  });

  test("an ordinary read is unaffected, because it claims nothing", () => {
    // The viewer opens files that no document vouched for, all day. Only a read
    // that carries a digest is a verification.
    return open("evidence/other.txt").then((answer) => {
      assert.equal(answer.type, "file_content");
      assert.equal(answer.content, "Something else entirely.\n");
    });
  });

  test("a digest that is not one is ignored rather than treated as a mismatch", async () => {
    // A malformed digest would never match anything. Refusing every read against it
    // would present a client bug as a corrupt file, and send the reader hunting.
    const answer = await open("evidence/report.txt", "not-a-digest");
    assert.equal(answer.type, "file_content");
  });

  test("a missing artifact is missing, not a mismatch", async () => {
    const answer = await open("evidence/absent.txt", digestOf(REPORT));
    assert.equal(answer.type, "file_browser_error");
    assert.match(answer.message, /does not exist/i);
  });

  test("the digest does not widen where a read may go", async () => {
    // Confinement is decided before any of this, and carrying a digest is not a
    // reason to reach outside the browser root.
    const answer = await open("../outside.txt", digestOf(REPORT));
    assert.equal(answer.type, "file_browser_error");
    assert.equal(answer.content, undefined);
  });
});
