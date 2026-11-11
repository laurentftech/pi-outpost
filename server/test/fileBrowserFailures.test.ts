/**
 * What the file browser answers when the filesystem refuses.
 *
 * fileBrowser.test.ts drives the rules against a real tree; the refusals a real tree
 * rarely produces on demand — a permission error, a cross-device move, a disk that fails
 * half-way through a folder copy — are staged here by making one `fs/promises` call fail
 * with the code the operating system would give. Each test checks the reason the client
 * receives and what is left on disk, because an error path that leaves a stray link or a
 * half-moved folder is the defect, not the message.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, mock, test } from "node:test";
import {
  copyEntryFromBrowser,
  createDirectoryFromBrowser,
  createFileFromBrowser,
  deleteFileFromBrowser,
  FileBrowserError,
  listDirectory,
  moveFileFromBrowser,
  openFileNative,
  readFileRaw,
  renameFileFromBrowser,
  restoreFromBrowser,
  revealPathNative,
  searchFiles,
  uploadFileFromBrowser,
  walkConfined,
  writeFileFromBrowser,
} from "../src/fileBrowser.ts";
import { realResolve } from "../src/sandbox.ts";

/** The error a syscall gives, with its code: what the module branches on. */
function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: staged by the test`), { code });
}

type FsMethod = "readdir" | "readFile" | "writeFile" | "mkdir" | "link" | "unlink" | "rename" | "copyFile" | "cp" | "rm";

/**
 * Make `method` fail with `code` for the calls `when` selects (all of them by default);
 * every other call goes to the real filesystem.
 */
function failing(method: FsMethod, code: string, when: (...args: unknown[]) => boolean = () => true) {
  const real = (fsPromises[method] as (...args: unknown[]) => Promise<unknown>).bind(fsPromises);
  return mock.method(fsPromises, method, async (...args: unknown[]) => {
    if (when(...args)) throw errno(code);
    return real(...args);
  });
}

async function refusal(run: () => Promise<unknown>): Promise<FileBrowserError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FileBrowserError) return error;
    throw error;
  }
  throw new Error("expected the call to be refused, but it resolved");
}

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("file browser refusals from the filesystem", () => {
  let root: string;
  let outside: string;
  let symlinksAvailable = false;

  function write(relPath: string, content = "content\n") {
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
    return full;
  }

  /** A FIFO: an entry that is neither a file nor a folder. POSIX only. */
  function fifo(relPath: string): boolean {
    if (process.platform === "win32") return false;
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    return spawnSync("mkfifo", [full]).status === 0;
  }

  before(async () => {
    const top = mkdtempSync(path.join(tmpdir(), "pi-fb-fail-"));
    mkdirSync(path.join(top, "root"));
    mkdirSync(path.join(top, "outside"));
    root = await realResolve(path.join(top, "root"));
    outside = await realResolve(path.join(top, "outside"));
    try {
      symlinkSync(path.join(root, "nowhere"), path.join(top, "probe-link"));
      symlinksAvailable = true;
    } catch {
      symlinksAvailable = false;
    }
  });

  afterEach(() => mock.restoreAll());

  after(() => {
    rmSync(path.dirname(root), { recursive: true, force: true });
  });

  describe("reading", () => {
    test("a folder that cannot be read is refused as denied, with the system's reason", async () => {
      mkdirSync(path.join(root, "locked"), { recursive: true });
      failing("readdir", "EACCES");
      const error = await refusal(() => listDirectory(root, "locked"));
      assert.equal(error.reason, "denied");
      assert.match(error.message, /Cannot read "locked": EACCES/);
    });

    test("a link whose target is gone is listed as other, not dropped and not an error", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable");
      mkdirSync(path.join(root, "with-dangling"), { recursive: true });
      write("with-dangling/real.txt");
      symlinkSync(path.join(root, "with-dangling", "gone.txt"), path.join(root, "with-dangling", "dangling"));
      const entries = await listDirectory(root, "with-dangling");
      assert.deepEqual(entries, [
        { name: "dangling", type: "other" },
        { name: "real.txt", type: "file" },
      ]);
    });

    test("a read that fails for another reason than absence is not reported as not-found", async () => {
      write("unreadable.svg", "<svg/>");
      failing("readFile", "EIO");
      await assert.rejects(readFileRaw(root, "unreadable.svg"), (error: NodeJS.ErrnoException) => {
        assert.ok(!(error instanceof FileBrowserError), "an I/O error must not be dressed as a browser refusal");
        return error.code === "EIO";
      });
    });

    test("raw bytes of a folder are refused as not a file", async () => {
      mkdirSync(path.join(root, "a-folder"), { recursive: true });
      const error = await refusal(() => readFileRaw(root, "a-folder"));
      assert.equal(error.reason, "not-found");
      assert.match(error.message, /is not a file/);
    });
  });

  describe("creating", () => {
    test("a name under a file says the folder is not a folder, and creates nothing", async () => {
      write("plain.txt");
      const error = await refusal(() => createFileFromBrowser(root, undefined, "plain.txt/child.txt"));
      assert.equal(error.reason, "not-found");
      // Windows reports ENOENT, not ENOTDIR, for a path through a file.
      assert.match(error.message, process.platform === "win32" ? /does not exist/ : /is not a folder/);
      assert.equal(readFileSync(path.join(root, "plain.txt"), "utf8"), "content\n");
    });

    test("a permission error is denied, naming what could not be created", async () => {
      failing("writeFile", "EACCES");
      const error = await refusal(() => createFileFromBrowser(root, undefined, "no-permission.txt"));
      assert.equal(error.reason, "denied");
      assert.equal(error.message, 'Cannot create "no-permission.txt"');
      assert.equal(existsSync(path.join(root, "no-permission.txt")), false);
    });

    test("an unexpected error is still a refusal the client can show, not a crash", async () => {
      failing("mkdir", "EIO");
      const error = await refusal(() => createDirectoryFromBrowser(root, undefined, "io-error"));
      assert.equal(error.reason, "denied");
      assert.equal(existsSync(path.join(root, "io-error")), false);
    });
  });

  describe("uploading", () => {
    test("an uploads path taken by a file is refused before anything is written", async () => {
      const uploadRoot = path.join(root, "upload-blocked");
      mkdirSync(uploadRoot, { recursive: true });
      writeFileSync(path.join(uploadRoot, "uploads"), "a file where the folder should be");
      const error = await refusal(() =>
        uploadFileFromBrowser(root, "upload-blocked", "upload-blocked/uploads", "a.txt", base64("hi")),
      );
      assert.equal(error.reason, "conflict");
      assert.equal(readFileSync(path.join(uploadRoot, "uploads"), "utf8"), "a file where the folder should be");
    });

    test("an uploads folder swapped for a link out of the root after its creation is refused", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable");
      const zone = path.join(root, "upload-swap");
      mkdirSync(zone, { recursive: true });
      const uploads = path.join(zone, "uploads");
      const realMkdir = fsPromises.mkdir.bind(fsPromises);
      // The window the re-confinement closes: the folder is created, then replaced by a
      // link pointing outside before the bytes are written.
      mock.method(fsPromises, "mkdir", async (...args: Parameters<typeof fsPromises.mkdir>) => {
        const made = await realMkdir(...args);
        if (String(args[0]) === uploads) {
          rmSync(uploads, { recursive: true });
          symlinkSync(outside, uploads, "dir");
        }
        return made;
      });
      const error = await refusal(() => uploadFileFromBrowser(root, "upload-swap", "upload-swap/uploads", "escape.txt", base64("x")));
      assert.equal(error.reason, "outside-root");
      assert.deepEqual(readdirSync(outside), [], "nothing may be written through the link");
    });

    test("a temporary file that cannot be written is refused and leaves nothing behind", async () => {
      const zone = path.join(root, "upload-tmp");
      mkdirSync(zone, { recursive: true });
      failing("writeFile", "EACCES", (file) => String(file).endsWith(".tmp"));
      const error = await refusal(() => uploadFileFromBrowser(root, "upload-tmp", "upload-tmp/uploads", "a.txt", base64("x")));
      assert.equal(error.reason, "denied");
      assert.match(error.message, /Cannot create "a\.txt"/);
      assert.deepEqual(readdirSync(path.join(zone, "uploads")), []);
    });

    test("a link refused for another reason than a taken name stops the upload and tidies up", async () => {
      const zone = path.join(root, "upload-link");
      mkdirSync(zone, { recursive: true });
      failing("link", "EPERM");
      const error = await refusal(() => uploadFileFromBrowser(root, "upload-link", "upload-link/uploads", "a.txt", base64("x")));
      assert.equal(error.reason, "denied");
      assert.deepEqual(readdirSync(path.join(zone, "uploads")), [], "the temporary file is removed");
    });

    test("when every suffixed name is taken, the upload says so instead of looping", async () => {
      const zone = path.join(root, "upload-full");
      mkdirSync(zone, { recursive: true });
      const link = failing("link", "EEXIST");
      const error = await refusal(() => uploadFileFromBrowser(root, "upload-full", "upload-full/uploads", "a.txt", base64("x")));
      assert.equal(error.reason, "conflict");
      assert.match(error.message, /Too many files named "a\.txt"/);
      assert.ok(link.mock.callCount() > 1, "several names were tried");
      assert.deepEqual(readdirSync(path.join(zone, "uploads")), []);
    });
  });

  describe("opening with the system", () => {
    const succeed = async () => {};
    const refuse = async () => {
      throw new Error("launcher missing");
    };

    test("a missing file or a folder is not opened, and the launcher is never called", async () => {
      mkdirSync(path.join(root, "open-folder"), { recursive: true });
      let calls = 0;
      const counting = async () => {
        calls++;
      };
      assert.equal((await refusal(() => openFileNative(root, "missing.pdf", counting, "linux"))).reason, "not-found");
      const folder = await refusal(() => openFileNative(root, "open-folder", counting, "linux"));
      assert.equal(folder.reason, "not-found");
      assert.match(folder.message, /is not a file/);
      assert.equal(calls, 0);
    });

    test("an entry that is neither a file nor a folder is not shown", async (t) => {
      if (!fifo("reveal-pipe")) return t.skip("no FIFO on this platform");
      assert.equal((await refusal(() => revealPathNative(root, "reveal-pipe", succeed, "linux"))).reason, "not-found");
    });

    for (const platform of ["darwin", "win32"] as const) {
      test(`a launcher that fails on ${platform} is reported as launcher-failed`, async () => {
        write("reveal-me.txt");
        const error = await refusal(() => revealPathNative(root, "reveal-me.txt", refuse, platform));
        assert.equal(error.reason, "launcher-failed");
        assert.match(error.message, /launcher missing/);
      });
    }
  });

  describe("renaming and moving", () => {
    test("a name with a slash is a path, refused before anything moves", async () => {
      write("rename-slash.txt");
      const error = await refusal(() => renameFileFromBrowser(root, undefined, "rename-slash.txt", "sub/name.txt"));
      assert.equal(error.reason, "denied");
      assert.match(error.message, /is a path, not a name/);
      assert.ok(existsSync(path.join(root, "rename-slash.txt")));
    });

    test("a missing entry is not-found, and a link is not a regular file or folder", async (t) => {
      assert.equal((await refusal(() => renameFileFromBrowser(root, undefined, "never-there.txt", "x.txt"))).reason, "not-found");
      if (!symlinksAvailable) return t.skip("symlinks unavailable");
      write("link-target.txt");
      symlinkSync(path.join(root, "link-target.txt"), path.join(root, "a-link"));
      const error = await refusal(() => renameFileFromBrowser(root, undefined, "a-link", "renamed-link"));
      assert.equal(error.reason, "not-found");
      assert.match(error.message, /is not a regular file or folder/);
    });

    test("a folder rename that loses a race to a new non-empty folder is a conflict", async () => {
      mkdirSync(path.join(root, "race-src"), { recursive: true });
      failing("rename", "ENOTEMPTY");
      const error = await refusal(() => renameFileFromBrowser(root, undefined, "race-src", "race-dst"));
      assert.equal(error.reason, "conflict");
      assert.ok(existsSync(path.join(root, "race-src")));
    });

    test("a folder rename refused for another reason names the action", async () => {
      mkdirSync(path.join(root, "rename-io"), { recursive: true });
      failing("rename", "EIO");
      const error = await refusal(() => renameFileFromBrowser(root, undefined, "rename-io", "rename-io-2"));
      assert.equal(error.reason, "denied");
      assert.match(error.message, /Cannot rename "rename-io-2": EIO/);
    });

    for (const [code, reason, message] of [
      ["ENOENT", "not-found", /does not exist/],
      ["EXDEV", "denied", /across filesystems/],
      ["EACCES", "denied", /^Cannot move "move-dest\/moved-\w+\.txt"$/],
      ["EIO", "denied", /Cannot move .*: EIO/],
    ] as const) {
      test(`a file move whose link fails with ${code} is ${reason}, and the source stays`, async () => {
        const name = `moved-${code}.txt`;
        write(name);
        mkdirSync(path.join(root, "move-dest"), { recursive: true });
        failing("link", code);
        const error = await refusal(() => moveFileFromBrowser(root, undefined, name, "move-dest"));
        assert.equal(error.reason, reason);
        assert.match(error.message, message);
        assert.ok(existsSync(path.join(root, name)), "the source is untouched");
        assert.equal(existsSync(path.join(root, "move-dest", name)), false);
      });
    }

    test("when the source cannot be removed, the new link is rolled back", async () => {
      write("sticky.txt", "sticky\n");
      mkdirSync(path.join(root, "sticky-dest"), { recursive: true });
      const source = path.join(root, "sticky.txt");
      failing("unlink", "EACCES", (file) => String(file) === source);
      const error = await refusal(() => moveFileFromBrowser(root, undefined, "sticky.txt", "sticky-dest"));
      assert.equal(error.reason, "denied");
      assert.equal(readFileSync(source, "utf8"), "sticky\n");
      assert.equal(existsSync(path.join(root, "sticky-dest", "sticky.txt")), false, "no second copy is left behind");
    });
  });

  describe("deleting and restoring", () => {
    test("a delete the system refuses is denied and leaves the file", async () => {
      write("undeletable.txt");
      failing("unlink", "EACCES");
      const error = await refusal(() => deleteFileFromBrowser(root, undefined, "undeletable.txt"));
      assert.equal(error.reason, "denied");
      assert.match(error.message, /Cannot delete "undeletable\.txt"/);
      assert.ok(existsSync(path.join(root, "undeletable.txt")));
    });

    test("restoring onto the root itself is refused", async () => {
      const trashed = write("../trash-root-item.txt");
      const error = await refusal(() => restoreFromBrowser(root, undefined, "", trashed));
      assert.equal(error.reason, "denied");
      assert.ok(existsSync(trashed));
    });

    test("an entry no longer in the trash is not-found", async () => {
      const error = await refusal(() => restoreFromBrowser(root, undefined, "gone.txt", path.join(outside, "never-trashed.txt")));
      assert.equal(error.reason, "not-found");
      assert.match(error.message, /no longer in the trash/);
    });

    /** A trashed folder with one file, kept outside the root the way the trash keeps it. */
    function trashedFolder(name: string): string {
      const folder = path.join(outside, name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, "inner.txt"), "inner\n");
      return folder;
    }

    test("a folder restore that loses a race to a new folder is a conflict, and stays in the trash", async () => {
      const trashed = trashedFolder("t-race");
      failing("rename", "EEXIST");
      const error = await refusal(() => restoreFromBrowser(root, undefined, "restored-race", trashed));
      assert.equal(error.reason, "conflict");
      assert.ok(existsSync(path.join(trashed, "inner.txt")));
    });

    test("a folder restore refused for another reason is denied, and stays in the trash", async () => {
      const trashed = trashedFolder("t-io");
      failing("rename", "EACCES");
      const error = await refusal(() => restoreFromBrowser(root, undefined, "restored-io", trashed));
      assert.equal(error.reason, "denied");
      assert.ok(existsSync(path.join(trashed, "inner.txt")));
    });

    test("a folder in a trash on another disk is copied back, then removed from the trash", async () => {
      const trashed = trashedFolder("t-xdev");
      failing("rename", "EXDEV");
      assert.equal(await restoreFromBrowser(root, undefined, "restored-xdev", trashed), "restored-xdev");
      assert.equal(readFileSync(path.join(root, "restored-xdev", "inner.txt"), "utf8"), "inner\n");
      assert.equal(existsSync(trashed), false);
    });

    test("a file whose link fails for another reason is not restored", async () => {
      const trashed = path.join(outside, "t-file-io.txt");
      writeFileSync(trashed, "kept\n");
      failing("link", "EIO");
      const error = await refusal(() => restoreFromBrowser(root, undefined, "restored-io.txt", trashed));
      assert.equal(error.reason, "denied");
      assert.equal(readFileSync(trashed, "utf8"), "kept\n");
      assert.equal(existsSync(path.join(root, "restored-io.txt")), false);
    });

    test("a file in a trash on another disk is copied back exclusively", async () => {
      const trashed = path.join(outside, "t-file-xdev.txt");
      writeFileSync(trashed, "across\n");
      failing("link", "EXDEV");
      assert.equal(await restoreFromBrowser(root, undefined, "restored-xdev.txt", trashed), "restored-xdev.txt");
      assert.equal(readFileSync(path.join(root, "restored-xdev.txt"), "utf8"), "across\n");
      assert.equal(existsSync(trashed), false);
    });

    test("a file whose cross-disk copy fails stays in the trash", async () => {
      const trashed = path.join(outside, "t-file-copy.txt");
      writeFileSync(trashed, "stays\n");
      failing("link", "EXDEV");
      failing("copyFile", "ENOSPC");
      const error = await refusal(() => restoreFromBrowser(root, undefined, "restored-copy.txt", trashed));
      assert.equal(error.reason, "denied");
      assert.equal(readFileSync(trashed, "utf8"), "stays\n");
    });
  });

  describe("copying and walking", () => {
    test("a copy into a read-only sandbox is refused", async () => {
      write("copy-ro.txt");
      const error = await refusal(() => copyEntryFromBrowser(root, null, "copy-ro.txt", ""));
      assert.equal(error.reason, "denied");
      assert.match(error.message, /read-only/);
    });

    test("a folder copy that fails part-way says how much it left behind", async () => {
      write("copy-partial/a.txt", "a\n");
      write("copy-partial/b.txt", "b\n");
      mkdirSync(path.join(root, "copy-partial-dest"), { recursive: true });
      failing("copyFile", "ENOSPC", (from) => String(from).endsWith("b.txt"));
      const error = await refusal(() => copyEntryFromBrowser(root, undefined, "copy-partial", "copy-partial-dest"));
      assert.equal(error.reason, "denied");
      assert.match(error.message, /a partial copy of 1 of 2 entries is left in "copy-partial-dest\/copy-partial"/);
      assert.equal(readFileSync(path.join(root, "copy-partial-dest", "copy-partial", "a.txt"), "utf8"), "a\n");
      assert.ok(existsSync(path.join(root, "copy-partial", "b.txt")), "the source is never touched");
    });

    test("a folder inside the walk that cannot be read fails the walk with its name", async () => {
      write("walk-locked/inner/file.txt");
      failing("readdir", "EACCES", (dir) => String(dir).endsWith(`${path.sep}inner`));
      const error = await refusal(() => walkConfined(root, ["walk-locked"]));
      assert.equal(error.reason, "denied");
      assert.match(error.message, /walk-locked\/inner/);
    });

    test("a dangling link and a pipe are skipped and counted, not followed", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable");
      write("walk-odd/real.txt");
      symlinkSync(path.join(root, "walk-odd", "missing.txt"), path.join(root, "walk-odd", "dangling"));
      const piped = fifo("walk-odd/pipe");
      const walk = await walkConfined(root, ["walk-odd"]);
      assert.deepEqual(walk.entries.map((entry) => entry.name), ["walk-odd", "walk-odd/real.txt"]);
      assert.equal(walk.skipped, piped ? 2 : 1);
    });

    test("a missing start is not-found, and a pipe is not a regular file or folder", async (t) => {
      assert.equal((await refusal(() => walkConfined(root, ["walk-missing"]))).reason, "not-found");
      if (!fifo("walk-pipe")) return t.skip("no FIFO on this platform");
      const error = await refusal(() => walkConfined(root, ["walk-pipe"]));
      assert.equal(error.reason, "not-found");
      assert.match(error.message, /is not a regular file or folder/);
    });
  });

  describe("saving from the editor", () => {
    test("a folder cannot be saved over", async () => {
      mkdirSync(path.join(root, "save-folder"), { recursive: true });
      const error = await refusal(() => writeFileFromBrowser(root, undefined, "save-folder", "text", 0, true));
      assert.equal(error.reason, "not-found");
      assert.match(error.message, /is not a file/);
    });

    test("a failed replace leaves the original intact and no temporary file", async () => {
      const file = write("save-fails.txt", "original\n");
      failing("rename", "EACCES");
      await assert.rejects(writeFileFromBrowser(root, undefined, "save-fails.txt", "new\n", 0, true), { code: "EACCES" });
      assert.equal(readFileSync(file, "utf8"), "original\n");
      assert.deepEqual(readdirSync(root).filter((name) => name.startsWith("save-fails.txt.")), []);
    });
  });

  describe("searching names", () => {
    test("the search stops at its limit, however deep the matches go", async () => {
      for (const dir of ["hit-a", "hit-b", "hit-c"]) write(`limit-tree/${dir}/hit.txt`);
      const results = await searchFiles(path.join(root, "limit-tree"), "hit", 2);
      assert.equal(results.length, 2);
    });

    test("a limit of zero reads nothing, and a root that cannot be read finds nothing", async () => {
      const readdir = mock.method(fsPromises, "readdir");
      assert.deepEqual(await searchFiles(path.join(root, "limit-tree"), "hit", 0), []);
      assert.equal(readdir.mock.callCount(), 0, "nothing is read when nothing may be returned");
      readdir.mock.restore();
      assert.deepEqual(await searchFiles(path.join(root, "no-such-root"), "hit"), []);
    });
  });

  describe("races and conflicts", () => {
    test("raw bytes of a path that does not exist are not-found", async () => {
      const error = await refusal(() => readFileRaw(root, "raw-missing.pdf"));
      assert.equal(error.reason, "not-found");
      assert.match(error.message, /does not exist/);
    });

    test("a preview bound to a digest is served when it matches and refused when it does not", async () => {
      write("digest.txt", "approved\n");
      const { createHash } = await import("node:crypto");
      const digest = `sha256:${createHash("sha256").update("approved\n").digest("hex")}`;
      const { readFileForPreview } = await import("../src/fileBrowser.ts");
      assert.equal((await readFileForPreview(root, "digest.txt", undefined, digest)).content, "approved\n");
      writeFileSync(path.join(root, "digest.txt"), "replaced\n");
      const error = await refusal(() => readFileForPreview(root, "digest.txt", undefined, digest));
      assert.equal(error.reason, "digest-mismatch");
      assert.match(error.message, new RegExp(digest));
    });

    test("a folder rename refused with EPERM because a folder appeared meanwhile is a conflict", async () => {
      mkdirSync(path.join(root, "eperm-src"), { recursive: true });
      const destination = path.join(root, "eperm-dst");
      // Windows answers EPERM, not ENOTEMPTY, when the destination folder exists.
      mock.method(fsPromises, "rename", async () => {
        mkdirSync(destination);
        throw errno("EPERM");
      });
      const error = await refusal(() => renameFileFromBrowser(root, undefined, "eperm-src", "eperm-dst"));
      assert.equal(error.reason, "conflict");
      assert.ok(existsSync(path.join(root, "eperm-src")));
    });

    test("a trash that refuses the entry passes its own refusal through unchanged", async () => {
      write("trash-refuses.txt");
      const refused = new FileBrowserError("too-large", "The trash is full");
      const error = await refusal(() =>
        deleteFileFromBrowser(root, undefined, "trash-refuses.txt", async () => {
          throw refused;
        }),
      );
      assert.equal(error, refused);
      assert.ok(existsSync(path.join(root, "trash-refuses.txt")));
    });

    test("a restore never overwrites what has since taken the entry's place", async () => {
      mkdirSync(path.join(root, "taken-folder"), { recursive: true });
      const folder = path.join(outside, "t-taken-folder");
      mkdirSync(folder, { recursive: true });
      assert.equal((await refusal(() => restoreFromBrowser(root, undefined, "taken-folder", folder))).reason, "conflict");
      assert.ok(existsSync(folder));

      write("taken.txt", "newer\n");
      const file = path.join(outside, "t-taken.txt");
      writeFileSync(file, "older\n");
      assert.equal((await refusal(() => restoreFromBrowser(root, undefined, "taken.txt", file))).reason, "conflict");
      assert.equal(readFileSync(path.join(root, "taken.txt"), "utf8"), "newer\n");
      assert.equal(readFileSync(file, "utf8"), "older\n");
    });

    test("a walk starts from a file as well as a folder, and follows a link that stays inside", async (t) => {
      write("walk-start.txt", "12345");
      assert.deepEqual((await walkConfined(root, ["walk-start.txt"])).entries.map((e) => [e.name, e.kind, e.size]), [
        ["walk-start.txt", "file", 5],
      ]);
      if (!symlinksAvailable) return t.skip("symlinks unavailable");
      write("walk-linked/target.txt", "t");
      symlinkSync(path.join(root, "walk-start.txt"), path.join(root, "walk-linked", "inside-link"));
      const walk = await walkConfined(root, ["walk-linked"]);
      const linked = walk.entries.find((entry) => entry.name === "walk-linked/inside-link");
      assert.equal(linked?.absolute, path.join(root, "walk-start.txt"));
      assert.equal(walk.skipped, 0);
    });
  });
});
