/**
 * Unit tests for the file-browser backend.
 *
 * This module decides what the sidebar may read and write, so most of what
 * follows is confinement: the `..` escape, the symlink that points out of the
 * root, the writable zone inside a readable one. Those paths were only ever
 * exercised through the HTTP route before, which tests the route as much as the
 * rule. The size, binary and mtime guards are here for the same reason — they
 * are the difference between a refused request and a corrupted file.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  assertWithinRoot,
  FileBrowserError,
  listDirectory,
  MAX_PREVIEW_BYTES,
  readFileForPreview,
  readFileRaw,
  resolveBrowserRoot,
  resolveWritableRoot,
  searchFiles,
  writeFileFromBrowser,
} from "../src/fileBrowser.ts";

/** The reason carried by a FileBrowserError, or the error itself when it is another kind. */
async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FileBrowserError) return error.reason;
    throw error;
  }
  throw new Error("expected the call to be refused, but it resolved");
}

describe("file browser", () => {
  let root: string;
  /** A sibling of the root — nothing served may ever reach inside it. */
  let outside: string;

  function write(relPath: string, content: string | Buffer) {
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  before(() => {
    // realpathSync is not optional: on macOS /var is a symlink to /private/var, so
    // an unresolved root fails isWithin against every resolved path and each test
    // below would refuse as "outside-root" for the wrong reason
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-fb-")));
    root = path.join(base, "root");
    outside = path.join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });

    writeFileSync(path.join(outside, "secret.txt"), "SECRET\n");
    write("readme.md", "# hello\n");
    write("src/main.ts", "console.log('hi');\n");
    write("src/nested/deep.txt", "deep\n");
    write("binary.bin", Buffer.from([0x68, 0x69, 0x00, 0x21]));
    write("big.txt", "x".repeat(MAX_PREVIEW_BYTES + 10));
    mkdirSync(path.join(root, "empty"), { recursive: true });

    // A symlink pointing out of the root: listed, but never followed
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape-link"));
    symlinkSync(outside, path.join(root, "escape-dir"));
    symlinkSync(path.join(root, "src"), path.join(root, "src-link"));
  });

  after(() => {
    rmSync(path.dirname(root), { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Confinement
  // -------------------------------------------------------------------------
  describe("confinement", () => {
    test("refuses a path that climbs out with ..", async () => {
      assert.equal(await reasonOf(() => listDirectory(root, "../outside")), "outside-root");
      assert.equal(await reasonOf(() => readFileForPreview(root, "../outside/secret.txt")), "outside-root");
      assert.equal(await reasonOf(() => readFileRaw(root, "../outside/secret.txt")), "outside-root");
    });

    test("refuses an absolute path outside the root", async () => {
      assert.equal(await reasonOf(() => readFileForPreview(root, path.join(outside, "secret.txt"))), "outside-root");
    });

    test("refuses a path that climbs out and back in", async () => {
      assert.equal(await reasonOf(() => readFileForPreview(root, "src/../../outside/secret.txt")), "outside-root");
    });

    test("refuses to follow a symlink pointing out of the root", async () => {
      // The link itself lives inside the root; its target does not
      assert.equal(await reasonOf(() => readFileForPreview(root, "escape-link")), "outside-root");
      assert.equal(await reasonOf(() => listDirectory(root, "escape-dir")), "outside-root");
      assert.equal(await reasonOf(() => readFileForPreview(root, "escape-dir/secret.txt")), "outside-root");
    });

    test("follows a symlink that stays inside the root", async () => {
      const entries = await listDirectory(root, "src-link");
      assert.deepEqual(
        entries.map((e) => e.name).sort(),
        ["main.ts", "nested"],
      );
    });

    test("accepts the root itself and paths below it", async () => {
      await assertWithinRoot(root, "");
      await assertWithinRoot(root, "src/main.ts");
      await assertWithinRoot(root, "src/nested/deep.txt");
    });

    test("confines a path that does not exist on disk", async () => {
      // The history view asks about paths from old commits, long since deleted
      await assertWithinRoot(root, "src/was-deleted.ts");
      assert.equal(await reasonOf(() => assertWithinRoot(root, "../outside/was-deleted.ts")), "outside-root");
    });
  });

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------
  describe("listDirectory", () => {
    test("sorts directories first, then names case-insensitively", async () => {
      const names = (await listDirectory(root, "")).map((e) => e.name);
      const dirs = names.slice(0, names.indexOf("readme.md"));
      assert.ok(dirs.includes("src"), `expected directories first, got ${JSON.stringify(names)}`);
      assert.ok(dirs.includes("empty"));
      assert.ok(names.indexOf("binary.bin") < names.indexOf("readme.md"), "files sort by name");
    });

    test("classifies symlinks by what they point at, without following them", async () => {
      const entries = await listDirectory(root, "");
      const byName = Object.fromEntries(entries.map((e) => [e.name, e.type]));
      // Shown rather than hidden, so an out-of-root link is visible but inert
      assert.equal(byName["escape-link"], "symlink-file");
      assert.equal(byName["escape-dir"], "symlink-directory");
      assert.equal(byName["src-link"], "symlink-directory");
      assert.equal(byName["src"], "directory");
      assert.equal(byName["readme.md"], "file");
    });

    test("reports a missing directory as not-found", async () => {
      assert.equal(await reasonOf(() => listDirectory(root, "no-such-dir")), "not-found");
    });

    test("lists an empty directory as empty", async () => {
      assert.deepEqual(await listDirectory(root, "empty"), []);
    });
  });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------
  describe("readFileForPreview", () => {
    test("returns content with its size and mtime", async () => {
      const result = await readFileForPreview(root, "readme.md");
      assert.equal(result.content, "# hello\n");
      assert.equal(result.size, statSync(path.join(root, "readme.md")).size);
      assert.ok(result.mtimeMs > 0);
    });

    test("refuses a binary file", async () => {
      assert.equal(await reasonOf(() => readFileForPreview(root, "binary.bin")), "binary");
    });

    test("refuses a file over the preview cap", async () => {
      assert.equal(await reasonOf(() => readFileForPreview(root, "big.txt")), "too-large");
    });

    test("refuses a directory", async () => {
      assert.equal(await reasonOf(() => readFileForPreview(root, "src")), "not-found");
    });

    test("reports a missing file as not-found", async () => {
      assert.equal(await reasonOf(() => readFileForPreview(root, "nope.txt")), "not-found");
    });
  });

  describe("readFileRaw", () => {
    test("serves binary bytes, unlike the preview", async () => {
      const bytes = await readFileRaw(root, "binary.bin");
      assert.deepEqual([...bytes], [0x68, 0x69, 0x00, 0x21]);
    });

    test("still refuses an oversized file", async () => {
      assert.equal(await reasonOf(() => readFileRaw(root, "big.txt")), "too-large");
    });
  });

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------
  describe("writeFileFromBrowser", () => {
    /** A fresh file per test: writes mutate, and mtime is part of the contract. */
    function scratch(name: string, content = "before\n") {
      write(`scratch/${name}`, content);
      return { rel: `scratch/${name}`, mtimeMs: statSync(path.join(root, "scratch", name)).mtimeMs };
    }

    test("writes when the mtime matches", async () => {
      const file = scratch("ok.txt");
      const result = await writeFileFromBrowser(root, undefined, file.rel, "after\n", file.mtimeMs);
      assert.equal((await readFileForPreview(root, file.rel)).content, "after\n");
      assert.ok(result.mtimeMs > 0);
      assert.equal(result.size, 6);
    });

    test("refuses a stale mtime as a conflict", async () => {
      const file = scratch("stale.txt");
      assert.equal(await reasonOf(() => writeFileFromBrowser(root, undefined, file.rel, "after\n", file.mtimeMs - 5000)), "conflict");
      assert.equal((await readFileForPreview(root, file.rel)).content, "before\n", "the file must be untouched");
    });

    test("overwrites a stale mtime when forced", async () => {
      const file = scratch("forced.txt");
      await writeFileFromBrowser(root, undefined, file.rel, "after\n", file.mtimeMs - 5000, true);
      assert.equal((await readFileForPreview(root, file.rel)).content, "after\n");
    });

    test("refuses to create a file that does not exist", async () => {
      assert.equal(await reasonOf(() => writeFileFromBrowser(root, undefined, "scratch/new.txt", "x", 0)), "conflict");
    });

    test("refuses every write when the sandbox is read-only", async () => {
      const file = scratch("readonly.txt");
      assert.equal(await reasonOf(() => writeFileFromBrowser(root, null, file.rel, "after\n", file.mtimeMs)), "denied");
    });

    test("refuses a write outside the writable zone", async () => {
      const file = scratch("outside-zone.txt");
      // Only src/ is writable; scratch/ is readable but not writable
      assert.equal(await reasonOf(() => writeFileFromBrowser(root, "src", file.rel, "after\n", file.mtimeMs)), "denied");
    });

    test("allows a write inside the writable zone", async () => {
      const mtimeMs = statSync(path.join(root, "src/main.ts")).mtimeMs;
      await writeFileFromBrowser(root, "src", "src/main.ts", "console.log('bye');\n", mtimeMs);
      assert.equal((await readFileForPreview(root, "src/main.ts")).content, "console.log('bye');\n");
    });

    test("refuses content carrying a NUL byte", async () => {
      const file = scratch("nul.txt");
      assert.equal(await reasonOf(() => writeFileFromBrowser(root, undefined, file.rel, "a\0b", file.mtimeMs)), "binary");
    });

    test("refuses content over the cap", async () => {
      const file = scratch("toobig.txt");
      const oversized = "x".repeat(MAX_PREVIEW_BYTES + 1);
      assert.equal(await reasonOf(() => writeFileFromBrowser(root, undefined, file.rel, oversized, file.mtimeMs)), "too-large");
    });

    test("refuses content whose UTF-8 encoding crosses the cap", async () => {
      // Under the cap as UTF-16 code units, over it as bytes — the second check
      const file = scratch("multibyte.txt");
      const multibyte = "é".repeat(MAX_PREVIEW_BYTES - 10);
      assert.ok(multibyte.length < MAX_PREVIEW_BYTES, "the string itself is under the cap");
      assert.equal(await reasonOf(() => writeFileFromBrowser(root, undefined, file.rel, multibyte, file.mtimeMs)), "too-large");
    });

    test("refuses a write that escapes the root", async () => {
      assert.equal(await reasonOf(() => writeFileFromBrowser(root, undefined, "../outside/secret.txt", "x", 0)), "outside-root");
    });

    test("leaves no temporary file behind", async () => {
      const file = scratch("atomic.txt");
      await writeFileFromBrowser(root, undefined, file.rel, "after\n", file.mtimeMs);
      const leftovers = (await listDirectory(root, "scratch")).filter((e) => e.name.includes(".tmp"));
      assert.deepEqual(leftovers, []);
    });
  });

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------
  describe("searchFiles", () => {
    test("matches a substring of the relative path, case-insensitively", async () => {
      const hits = await searchFiles(root, "MAIN");
      assert.ok(
        hits.some((h) => h.path === "src/main.ts"),
        `expected src/main.ts, got ${JSON.stringify(hits.map((h) => h.path))}`,
      );
    });

    test("returns nothing for an empty or whitespace query", async () => {
      assert.deepEqual(await searchFiles(root, ""), []);
      assert.deepEqual(await searchFiles(root, "   "), []);
    });

    test("prefers shorter paths", async () => {
      const hits = await searchFiles(root, "e");
      const lengths = hits.map((h) => h.path.length);
      assert.deepEqual(lengths, [...lengths].sort((a, b) => a - b), "results are ordered by path length");
    });

    test("honours the limit", async () => {
      assert.ok((await searchFiles(root, "e", 2)).length <= 2);
    });

    test("skips symlinks, so a cycle cannot hang the walk", async () => {
      const hits = await searchFiles(root, "link");
      assert.deepEqual(hits, [], `symlinks must not be walked, got ${JSON.stringify(hits.map((h) => h.path))}`);
    });

    test("reports the entry type", async () => {
      const hits = await searchFiles(root, "nested");
      assert.equal(hits.find((h) => h.path === "src/nested")?.type, "directory");
    });
  });

  // -------------------------------------------------------------------------
  // Root and writable-zone resolution
  // -------------------------------------------------------------------------
  describe("root resolution", () => {
    test("prefers the sandbox root over the agent cwd", async () => {
      // cwd points elsewhere on purpose: the sandbox root has to win
      assert.equal(await resolveBrowserRoot({ cwd: outside, sandbox: { root } } as never), root);
    });

    test("falls back to the agent cwd when no sandbox is configured", async () => {
      assert.equal(await resolveBrowserRoot({ cwd: root } as never), root);
    });

    test("reports no writable zone when there is no sandbox", async () => {
      assert.equal(await resolveWritableRoot({ cwd: root } as never, root), undefined);
    });

    test("reports a read-only sandbox as null", async () => {
      assert.equal(await resolveWritableRoot({ cwd: root, sandbox: { root, allowWrite: false } } as never, root), null);
    });

    test("reports the whole root as an empty relative path", async () => {
      assert.equal(await resolveWritableRoot({ cwd: root, sandbox: { root, allowWrite: true } } as never, root), "");
    });

    test("reports a writable subtree relative to the root, in posix separators", async () => {
      const writableRoot = path.join(root, "src", "nested");
      const rel = await resolveWritableRoot({ cwd: root, sandbox: { root, allowWrite: true, writableRoot } } as never, root);
      assert.equal(rel, "src/nested");
    });
  });
});
