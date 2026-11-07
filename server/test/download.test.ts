/**
 * prepareDownload decides, before any byte goes out, what /files/download sends —
 * and refuses what cannot be one archive. Limits are lowered here so the refusal is
 * reachable without 65 535 files on disk.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { attachmentDisposition, prepareDownload } from "../src/download.ts";
import { FileBrowserError } from "../src/fileBrowser.ts";
import { realResolve } from "../src/sandbox.ts";

describe("prepareDownload", () => {
  let root: string;

  before(async () => {
    root = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-download-")));
    mkdirSync(path.join(root, "many"), { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(path.join(root, "many", `${i}.txt`), "x".repeat(10));
    writeFileSync(path.join(root, "one.txt"), "one");
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  async function refusal(promise: Promise<unknown>): Promise<FileBrowserError> {
    try {
      await promise;
    } catch (error) {
      assert.ok(error instanceof FileBrowserError);
      return error;
    }
    assert.fail("expected a refusal");
  }

  test("ATooLargeFolderIsRefusedUpFront: past the entry or the size limit, a too-large refusal naming it, no archive", async () => {
    const tooMany = await refusal(prepareDownload(root, ["many"], { maxEntries: 3, maxBytes: 1e9 }));
    assert.equal(tooMany.reason, "too-large");
    assert.match(tooMany.message, /More than 3 entries/);

    const tooBig = await refusal(prepareDownload(root, ["many"], { maxEntries: 100, maxBytes: 20 }));
    assert.equal(tooBig.reason, "too-large");

    // The limits are shared by every entry of a selection, not granted to each.
    const together = await refusal(prepareDownload(root, ["many", "one.txt"], { maxEntries: 6, maxBytes: 1e9 }));
    assert.equal(together.reason, "too-large");
  });

  test("a single file is sent as itself; a folder, or several entries, as an archive", async () => {
    const file = await prepareDownload(root, ["one.txt"]);
    assert.equal(file.kind, "file");
    assert.equal(file.name, "one.txt");

    const folder = await prepareDownload(root, ["many"]);
    assert.equal(folder.kind, "archive");
    assert.equal(folder.name, "many.zip");
    assert.equal(folder.kind === "archive" && folder.entries.length, 6);

    const several = await prepareDownload(root, ["many/0.txt", "many/1.txt"]);
    assert.equal(several.name, "many.zip", "named after the common parent folder");
  });

  test("the name survives the disposition header exactly, quotes and non-ASCII included", () => {
    assert.equal(
      attachmentDisposition('q3 "résumé".pdf'),
      "attachment; filename=\"q3 _r_sum__.pdf\"; filename*=UTF-8''q3%20%22r%C3%A9sum%C3%A9%22.pdf",
    );
  });
});
