/**
 * The server's trash: what a deletion from the tree leaves behind, so it can be undone.
 * Restoring is the move rules (restoreFromBrowser); the trash itself only keeps, bounds
 * and forgets.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { deleteFileFromBrowser, FileBrowserError, restoreFromBrowser } from "../src/fileBrowser.ts";
import { realResolve } from "../src/sandbox.ts";
import { moveAcross, Trash, TRASH_MAX_AGE_MS } from "../src/trash.ts";

describe("the trash", () => {
  let base: string;
  let root: string;
  let trashRoot: string;
  let clock = 1_000;
  let trash: Trash;

  const write = (relPath: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
    writeFileSync(path.join(root, relPath), content);
  };
  const deleteToTrash = (relPath: string) =>
    deleteFileFromBrowser(root, undefined, relPath, (resolved) => trash.put("project-a", relPath, resolved));
  const restore = async (token: string, workspaceId = "project-a") => {
    const entry = trash.take(token, workspaceId);
    if (!entry) throw new FileBrowserError("not-found", "Nothing to restore");
    try {
      await restoreFromBrowser(root, undefined, entry.relPath, entry.trashed);
      await trash.discard(entry);
    } catch (error) {
      trash.giveBack(entry);
      throw error;
    }
  };
  const reason = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      return error instanceof FileBrowserError ? error.reason : String(error);
    }
    return "no error";
  };

  before(async () => {
    base = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-trash-")));
    root = path.join(base, "workspace");
    trashRoot = path.join(base, "agent", "outpost-trash");
    mkdirSync(root, { recursive: true });
    trash = new Trash(trashRoot, () => clock);
    await trash.reset();
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  test("DeleteThenRestore: a folder comes back with its content", async () => {
    write("old/a.txt", "a");
    write("old/sub/b.txt", "b");

    const token = await deleteToTrash("old");
    assert.match(token ?? "", /^[0-9a-f]{32}$/);
    assert.equal(existsSync(path.join(root, "old")), false);

    await restore(token!);
    assert.equal(readFileSync(path.join(root, "old", "sub", "b.txt"), "utf8"), "b");
    assert.equal(trash.size, 0);
  });

  test("TheTrashIsOutsideTheWorkspace: the bytes sit under the trash root, nothing under the workspace", async () => {
    write("notes/secret.md", "secret");
    const token = (await deleteToTrash("notes/secret.md"))!;
    assert.equal(existsSync(path.join(root, "notes", "secret.md")), false);
    assert.equal(readFileSync(path.join(trashRoot, token, "entry"), "utf8"), "secret");
    assert.ok(!path.join(trashRoot, token).startsWith(root + path.sep));
    await restore(token);
  });

  test("RestoreRefusesAnOverwrite: a file that took the place stays, and the deleted one can still come back", async () => {
    write("notes.md", "old");
    const token = (await deleteToTrash("notes.md"))!;
    write("notes.md", "new");

    assert.equal(await reason(() => restore(token)), "conflict");
    assert.equal(readFileSync(path.join(root, "notes.md"), "utf8"), "new");

    rmSync(path.join(root, "notes.md"));
    await restore(token);
    assert.equal(readFileSync(path.join(root, "notes.md"), "utf8"), "old");
  });

  test("a folder whose place was taken is refused too, both kept", async () => {
    write("box/inner.txt", "inner");
    const token = (await deleteToTrash("box"))!;
    write("box/other.txt", "other");
    assert.equal(await reason(() => restore(token)), "conflict");
    assert.equal(readFileSync(path.join(root, "box", "other.txt"), "utf8"), "other");
    assert.equal(existsSync(path.join(root, "box", "inner.txt")), false);
  });

  test("ATokenFromElsewhereRestoresNothing: unknown, used, or another project's", async () => {
    write("once.txt", "once");
    const token = (await deleteToTrash("once.txt"))!;

    assert.equal(trash.take(token, "project-b"), undefined, "another project's token");
    assert.equal(trash.take("0".repeat(32), "project-a"), undefined, "an unknown token");
    await restore(token);
    assert.equal(trash.take(token, "project-a"), undefined, "a token already used");
  });

  test("a restore into a folder that is gone is refused, and the entry kept", async () => {
    write("gone/leaf.txt", "leaf");
    const token = (await deleteToTrash("gone/leaf.txt"))!;
    rmSync(path.join(root, "gone"), { recursive: true });
    assert.equal(await reason(() => restore(token)), "not-found");
    assert.equal(trash.size > 0, true);
  });

  test("TheTrashIsEmptied: past 24 hours an entry is erased for good, and a reset empties everything", async () => {
    await trash.reset();
    write("aged.txt", "aged");
    write("fresh.txt", "fresh");
    clock = 10_000;
    const aged = (await deleteToTrash("aged.txt"))!;
    clock = 10_000 + TRASH_MAX_AGE_MS - 1000;
    const fresh = (await deleteToTrash("fresh.txt"))!;
    clock = 10_000 + TRASH_MAX_AGE_MS + 1;

    assert.equal(await trash.sweep(), 1);
    assert.equal(existsSync(path.join(trashRoot, aged)), false);
    assert.equal(trash.take(aged, "project-a"), undefined);
    assert.equal(existsSync(path.join(trashRoot, fresh)), true);

    await trash.reset();
    assert.equal(existsSync(path.join(trashRoot, fresh)), false);
    assert.equal(trash.take(fresh, "project-a"), undefined);
  });

  test("moveAcross copies across filesystems when rename says EXDEV, links as links", async () => {
    write("cross/a.txt", "a");
    write("cross/sub/b.txt", "b");
    const exdev = async () => {
      throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
    };
    await moveAcross(path.join(root, "cross"), path.join(base, "moved-dir"), { rename: exdev });
    assert.equal(readFileSync(path.join(base, "moved-dir", "sub", "b.txt"), "utf8"), "b");
    assert.equal(existsSync(path.join(root, "cross")), false);

    write("single.txt", "single");
    await moveAcross(path.join(root, "single.txt"), path.join(base, "moved.txt"), { rename: exdev });
    assert.equal(readFileSync(path.join(base, "moved.txt"), "utf8"), "single");
    assert.equal(existsSync(path.join(root, "single.txt")), false);
  });
});
