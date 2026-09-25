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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fsPromises from "node:fs/promises";
import { after, before, describe, mock, test } from "node:test";
import {
  assertWithinRoot,
  FileBrowserError,
  listDirectory,
  MAX_PREVIEW_BYTES,
  readFileForPreview,
  readFileRaw,
  createFileFromBrowser,
  createDirectoryFromBrowser,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_BASE64_LENGTH,
  uploadFileFromBrowser,
  copyFileFromBrowser,
  deleteFileFromBrowser,
  moveFileFromBrowser,
  launchNative,
  NATIVE_SPAWN_OPTIONS,
  openFileNative,
  revealPathNative,
  renameFileFromBrowser,
  resolveBrowserRoot,
  resolveWritableRoot,
  searchFiles,
  writeFileFromBrowser,
} from "../src/fileBrowser.ts";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 } from "@pi-outpost/shared/structured-exchange";
import { realResolve } from "../src/sandbox.ts";

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

/** The FileBrowserError itself, for assertions about what it says rather than only why. */
async function errorOf(run: () => Promise<unknown>): Promise<FileBrowserError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FileBrowserError) return error;
    throw error;
  }
  throw new Error("expected the call to be refused, but it resolved");
}

/** A document ceiling above the preview limit, the way a deployment configures one. */
const DOCUMENT_CEILING = MAX_PREVIEW_BYTES * 4;

/**
 * A JSON file past the preview limit, optionally declaring itself a
 * structured-exchange document. The pair differ in one field and in nothing else,
 * so a test that separates them is testing the declaration and not the size.
 */
function oversizedDocument(declared: boolean): string {
  const nodes = [];
  for (let i = 0; nodes.length === 0 || JSON.stringify(nodes).length < MAX_PREVIEW_BYTES; i += 1) {
    nodes.push({ id: `n${i}`, label: `node ${i} padded so the file grows quickly enough to matter` });
  }
  const document = declared
    ? { schema: STRUCTURED_EXCHANGE_SCHEMA_V1, kind: "graph", data: { nodes, edges: [] } }
    : { kind: "graph", data: { nodes, edges: [] } };
  return JSON.stringify(document);
}

describe("file browser", () => {
  let root: string;
  /** A sibling of the root — nothing served may ever reach inside it. */
  let outside: string;
  /** Windows refuses symlink creation without a privilege CI does not have. */
  let symlinksAvailable = false;

  function write(relPath: string, content: string | Buffer) {
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  before(async () => {
    // Resolve through the module's own primitive rather than realpathSync. The
    // confinement compares `root` against whatever realResolve returns, and the two
    // do not agree on every platform — on Windows a temp path can come back with a
    // \\?\ prefix that path.resolve then reshapes, leaving every path "outside the
    // browser root". Using the production resolver here makes the fixture agree with
    // the check by construction instead of by coincidence.
    const base = mkdtempSync(path.join(tmpdir(), "pi-fb-"));
    mkdirSync(path.join(base, "root"), { recursive: true });
    mkdirSync(path.join(base, "outside"), { recursive: true });
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));

    writeFileSync(path.join(outside, "secret.txt"), "SECRET\n");
    write("readme.md", "# hello\n");
    write("src/main.ts", "console.log('hi');\n");
    write("src/nested/deep.txt", "deep\n");
    write("binary.bin", Buffer.from([0x68, 0x69, 0x00, 0x21]));
    write("big.txt", "x".repeat(MAX_PREVIEW_BYTES + 10));
    // Past the preview limit and under a document ceiling: which of the two applies
    // depends on what the file declares, which is the whole point of the pair.
    write("big-document.json", oversizedDocument(true));
    write("big-object.json", oversizedDocument(false));
    write(
      "small-document.json",
      JSON.stringify({ schema: STRUCTURED_EXCHANGE_SCHEMA_V1, kind: "graph", data: { nodes: [{ id: "a" }], edges: [] } }),
    );
    mkdirSync(path.join(root, "empty"), { recursive: true });

    // A symlink pointing out of the root: listed, but never followed. Creating one
    // needs a privilege Windows does not grant by default, so the tests that depend
    // on these skip rather than fail there — the confinement they check is a POSIX
    // property of realpath, and the platform that cannot make the link cannot be
    // walked out through it either.
    try {
      symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape-link"));
      symlinkSync(outside, path.join(root, "escape-dir"), "dir");
      symlinkSync(path.join(root, "src"), path.join(root, "src-link"), "dir");
      symlinksAvailable = true;
    } catch {
      symlinksAvailable = false;
    }
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

    test("refuses to follow a symlink pointing out of the root", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
      // The link itself lives inside the root; its target does not
      assert.equal(await reasonOf(() => readFileForPreview(root, "escape-link")), "outside-root");
      assert.equal(await reasonOf(() => listDirectory(root, "escape-dir")), "outside-root");
      assert.equal(await reasonOf(() => readFileForPreview(root, "escape-dir/secret.txt")), "outside-root");
    });

    test("follows a symlink that stays inside the root", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
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

    test("classifies symlinks by what they point at, without following them", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
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

    test("measures a structured-exchange document against its own ceiling", async () => {
      // Over the 1 MB preview limit and served anyway, because the document says
      // what it is. This is the same arrangement PDFs have, decided by content
      // rather than by extension — the file is named .json like any other.
      const result = await readFileForPreview(root, "big-document.json", DOCUMENT_CEILING);
      assert.ok(result.size > MAX_PREVIEW_BYTES);
      assert.equal(JSON.parse(result.content).schema, STRUCTURED_EXCHANGE_SCHEMA_V1);
    });

    test("keeps the preview limit for JSON that declares nothing", async () => {
      // Same size, same extension, no declaration: the document ceiling is not a
      // ceiling for JSON, it is a ceiling for these documents.
      assert.equal(await reasonOf(() => readFileForPreview(root, "big-object.json", DOCUMENT_CEILING)), "too-large");
    });

    test("applies a document ceiling tightened below the preview limit", async () => {
      // The direction that silently did nothing: with the document limit set under
      // 1 MB, a declared document between the two was served anyway, because the
      // check only ever refused files that were *not* documents. A configured
      // limit that refuses nothing is not a limit.
      const size = statSync(path.join(root, "small-document.json")).size;
      const error = await errorOf(() => readFileForPreview(root, "small-document.json", size - 1));
      assert.equal(error.reason, "too-large");
      assert.match(error.message, /structured-exchange document limit/);
      // The same file under the same tightened setting, when it declares nothing,
      // keeps the preview limit and is served — the ceiling belongs to documents.
      assert.ok((await readFileForPreview(root, "readme.md", size - 1)).content.length > 0);
    });

    test("reports a document past its own ceiling as a size problem naming both limits", async () => {
      // The refusal happens before anything is read, so it cannot know which of the
      // two limits the file was going to be measured against — and a reader told
      // only about the 1 MB one would conclude diagrams are capped there.
      const ceiling = statSync(path.join(root, "big-document.json")).size - 1;
      const error = await errorOf(() => readFileForPreview(root, "big-document.json", ceiling));
      assert.equal(error.reason, "too-large");
      assert.match(error.message, /1 MB preview limit/);
      assert.match(error.message, /structured-exchange documents/);
      assert.doesNotMatch(error.message, /invalid|schema does not/i);
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

  /**
   * A file removed between the size check and the read.
   *
   * The workspace is written by an agent while someone reads it, so this is not
   * hypothetical: a figure renamed while the page still fetches it once surfaced as
   * a 500 from `/files/raw`, because the read's ENOENT escaped as an unknown error.
   * The race is reproduced for real — the file is deleted right after it is measured.
   */
  describe("a file that vanishes between measuring and reading", () => {
    function vanishAfterStat(relPath: string) {
      const target = path.join(root, relPath);
      const realStat = fsPromises.stat.bind(fsPromises);
      return mock.method(fsPromises, "stat", async (...args: Parameters<typeof fsPromises.stat>) => {
        const stats = await realStat(...args);
        if (String(args[0]) === target) rmSync(target);
        return stats;
      });
    }

    test("is not-found for the raw bytes", async () => {
      write("vanishing-raw.svg", "<svg/>");
      const stat = vanishAfterStat("vanishing-raw.svg");
      try {
        assert.equal(await reasonOf(() => readFileRaw(root, "vanishing-raw.svg")), "not-found");
        assert.ok(stat.mock.callCount() > 0, "the race was never staged");
      } finally {
        stat.mock.restore();
      }
    });

    test("is not-found for the preview", async () => {
      write("vanishing-preview.txt", "hello\n");
      const stat = vanishAfterStat("vanishing-preview.txt");
      try {
        assert.equal(await reasonOf(() => readFileForPreview(root, "vanishing-preview.txt")), "not-found");
        assert.ok(stat.mock.callCount() > 0, "the race was never staged");
      } finally {
        stat.mock.restore();
      }
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

    test("skips symlinks, so a cycle cannot hang the walk", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
      const hits = await searchFiles(root, "link");
      assert.deepEqual(hits, [], `symlinks must not be walked, got ${JSON.stringify(hits.map((h) => h.path))}`);
    });

    test("reports the entry type", async () => {
      const hits = await searchFiles(root, "nested");
      assert.equal(hits.find((h) => h.path === "src/nested")?.type, "directory");
    });
  });

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------
  describe("createFileFromBrowser", () => {
    test("creates an empty file inside the writable zone", async () => {
      const result = await createFileFromBrowser(root, undefined, "scratch/created.txt");

      assert.equal(result.size, 0);
      assert.ok(result.mtimeMs > 0);
      assert.equal((await readFileForPreview(root, "scratch/created.txt")).content, "");
    });

    test("creates inside a nested writable zone, and refuses outside it", async () => {
      mkdirSync(path.join(root, "zone"), { recursive: true });
      await createFileFromBrowser(root, "zone", "zone/inside.txt");
      assert.equal(statSync(path.join(root, "zone", "inside.txt")).size, 0);

      assert.equal(await reasonOf(() => createFileFromBrowser(root, "zone", "readme-2.md")), "denied");
    });

    test("refuses when the sandbox is read-only", async () => {
      assert.equal(await reasonOf(() => createFileFromBrowser(root, null, "nope.txt")), "denied");
    });

    test("refuses a path that climbs out of the root", async () => {
      assert.equal(await reasonOf(() => createFileFromBrowser(root, undefined, "../outside/evil.txt")), "outside-root");
      assert.equal(statSync(path.join(outside, "evil.txt"), { throwIfNoEntry: false }), undefined);
    });

    test("refuses to follow a symlink out of the root", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
      assert.equal(await reasonOf(() => createFileFromBrowser(root, undefined, "escape-dir/evil.txt")), "outside-root");
      assert.equal(statSync(path.join(outside, "evil.txt"), { throwIfNoEntry: false }), undefined);
    });

    test("never truncates something already there", async () => {
      write("scratch/taken.txt", "keep me\n");

      assert.equal(await reasonOf(() => createFileFromBrowser(root, undefined, "scratch/taken.txt")), "conflict");
      assert.equal((await readFileForPreview(root, "scratch/taken.txt")).content, "keep me\n");
    });

    test("refuses a name already taken by a directory", async () => {
      assert.equal(await reasonOf(() => createFileFromBrowser(root, undefined, "empty")), "conflict");
    });

    test("refuses a name that is not a name", async () => {
      for (const target of ["scratch/", "scratch/.", "scratch/..", "scratch/   ", "scratch/ spaced.txt", "scratch/back\\slash"]) {
        assert.equal(await reasonOf(() => createFileFromBrowser(root, undefined, target)), "denied", target);
      }
    });

    test("reports a missing parent rather than creating one", async () => {
      assert.equal(await reasonOf(() => createFileFromBrowser(root, undefined, "no/such/dir/file.txt")), "not-found");
      assert.equal(statSync(path.join(root, "no"), { throwIfNoEntry: false }), undefined);
    });
  });

  describe("createDirectoryFromBrowser", () => {
    test("creates one directory inside the writable zone", async () => {
      await createDirectoryFromBrowser(root, undefined, "scratch/newdir");

      assert.ok(statSync(path.join(root, "scratch", "newdir")).isDirectory());
      assert.deepEqual(await listDirectory(root, "scratch/newdir"), []);
    });

    test("does not create a chain of missing parents", async () => {
      assert.equal(await reasonOf(() => createDirectoryFromBrowser(root, undefined, "chain/of/dirs")), "not-found");
      assert.equal(statSync(path.join(root, "chain"), { throwIfNoEntry: false }), undefined);
    });

    test("refuses the same things a file creation refuses", async () => {
      assert.equal(await reasonOf(() => createDirectoryFromBrowser(root, null, "nope")), "denied");
      assert.equal(await reasonOf(() => createDirectoryFromBrowser(root, undefined, "../outside/evil")), "outside-root");
      assert.equal(await reasonOf(() => createDirectoryFromBrowser(root, undefined, "empty")), "conflict");
      assert.equal(await reasonOf(() => createDirectoryFromBrowser(root, undefined, "scratch/..")), "denied");
    });
  });

  // -------------------------------------------------------------------------
  // Native opening and file lifecycle
  // -------------------------------------------------------------------------
  describe("openFileNative", () => {
    test("launches a confined read-only file without a shell command", async () => {
      const calls: Array<{ command: string; args: string[] }> = [];

      await openFileNative(
        root,
        "readme.md",
        async (command, args) => {
          calls.push({ command, args });
        },
        "darwin",
      );

      assert.deepEqual(calls, [{ command: "open", args: [path.join(root, "readme.md")] }]);
    });

    test("never invokes the launcher for an escaping path", async () => {
      let launched = false;

      assert.equal(
        await reasonOf(() =>
          openFileNative(root, "../outside/secret.txt", async () => {
            launched = true;
          }),
        ),
        "outside-root",
      );
      assert.equal(launched, false);
    });

    test("reports a launcher failure with a machine-readable reason", async () => {
      assert.equal(
        await reasonOf(() =>
          openFileNative(root, "readme.md", async () => {
            throw new Error("no associated application");
          }),
        ),
        "launcher-failed",
      );
    });
  });

  describe("launching on Windows", () => {
    test("ExplorersExitCodeIsNotAFailure: opening on Windows accepts whatever Explorer exits with", async () => {
      const calls: Array<{ command: string; args: string[]; options?: { anyExitCode?: boolean } }> = [];
      await openFileNative(root, "readme.md", async (command, args, options) => void calls.push({ command, args, options }), "win32");
      assert.deepEqual(calls, [{ command: "explorer.exe", args: [path.join(root, "readme.md")], options: { anyExitCode: true } }]);
    });

    test("the real launcher: a non-zero exit fails unless any exit code is accepted, and a missing program always fails", async () => {
      const exitsOne = ["-e", "process.exit(1)"];
      await assert.rejects(launchNative(process.execPath, exitsOne), /exited with code 1/);
      await launchNative(process.execPath, exitsOne, { anyExitCode: true });
      await assert.rejects(launchNative("pi-outpost-no-such-launcher", [], { anyExitCode: true }));
    });

    test("launchers are never started hidden: Explorer passes a hidden show state on to what it opens", () => {
      // windowsHide becomes wShowWindow = SW_HIDE for every process libuv starts.
      assert.equal("windowsHide" in NATIVE_SPAWN_OPTIONS, false);
      assert.equal(NATIVE_SPAWN_OPTIONS.shell, false);
    });
  });

  describe("revealPathNative", () => {
    type Call = { command: string; args: string[]; options?: { anyExitCode?: boolean } };
    const recorder = (fail: (command: string) => boolean = () => false) => {
      const calls: Call[] = [];
      const launcher = async (command: string, args: string[], options?: { anyExitCode?: boolean }) => {
        calls.push(options === undefined ? { command, args } : { command, args, options });
        if (fail(command)) throw new Error(`${command} failed`);
      };
      return { calls, launcher };
    };

    test("RevealAFileOnEachPlatform: Finder, Explorer and the freedesktop file manager, each given the validated path", async () => {
      write("reveal/my report, final.docx", "x");
      const file = path.join(root, "reveal", "my report, final.docx");

      const mac = recorder();
      await revealPathNative(root, "reveal/my report, final.docx", mac.launcher, "darwin");
      assert.deepEqual(mac.calls, [{ command: "open", args: ["-R", file] }]);

      const windows = recorder();
      await revealPathNative(root, "reveal/my report, final.docx", windows.launcher, "win32");
      assert.deepEqual(windows.calls, [{ command: "explorer.exe", args: ["/select,", file], options: { anyExitCode: true } }]);

      const linux = recorder();
      await revealPathNative(root, "reveal/my report, final.docx", linux.launcher, "linux");
      const uri = pathToFileURL(file).href.replace(/,/g, "%2C");
      assert.match(uri, /my%20report%2C%20final\.docx$/, "spaces and the comma dbus-send would split on are encoded");
      assert.deepEqual(linux.calls, [
        {
          command: "dbus-send",
          args: [
            "--session",
            "--print-reply",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
            `array:string:${uri}`,
            "string:",
          ],
        },
      ]);
    });

    test("a folder is revealed like a file, and nothing needs to be writable", async () => {
      mkdirSync(path.join(root, "reveal", "folder"), { recursive: true });
      const mac = recorder();
      await revealPathNative(root, "reveal/folder", mac.launcher, "darwin");
      assert.deepEqual(mac.calls, [{ command: "open", args: ["-R", path.join(root, "reveal", "folder")] }]);
    });

    test("LinuxFallsBackToTheContainingFolder: when no file manager answers, xdg-open opens the folder", async () => {
      write("reveal/notes.md", "x");
      const linux = recorder((command) => command === "dbus-send");
      await revealPathNative(root, "reveal/notes.md", linux.launcher, "linux");
      assert.deepEqual(linux.calls.map((call) => call.command), ["dbus-send", "xdg-open"]);
      assert.deepEqual(linux.calls[1].args, [path.join(root, "reveal")]);
      // And when even that fails, the reason reaches the tree.
      const nothing = recorder(() => true);
      assert.equal(await reasonOf(() => revealPathNative(root, "reveal/notes.md", nothing.launcher, "linux")), "launcher-failed");
    });

    test("RevealIsConfined: an escaping, a traversal or a missing path is refused before anything is launched", async () => {
      const guard = recorder();
      assert.equal(await reasonOf(() => revealPathNative(root, "../outside/secret.txt", guard.launcher, "darwin")), "outside-root");
      assert.equal(await reasonOf(() => revealPathNative(root, path.join(root, "..", "outside"), guard.launcher, "darwin")), "outside-root");
      assert.equal(await reasonOf(() => revealPathNative(root, "reveal/nope.txt", guard.launcher, "darwin")), "not-found");
      assert.deepEqual(guard.calls, []);
    });
  });

  describe("file lifecycle", () => {
    test("renames a writable regular file and preserves its content", async () => {
      write("lifecycle/draft.docx", "draft");

      const result = await renameFileFromBrowser(root, undefined, "lifecycle/draft.docx", "final.docx");

      assert.equal(result, "lifecycle/final.docx");
      assert.equal((await readFileForPreview(root, result)).content, "draft");
      assert.equal(statSync(path.join(root, "lifecycle/draft.docx"), { throwIfNoEntry: false }), undefined);
    });

    test("refuses a rename collision without changing either file", async () => {
      write("lifecycle/collision-source.txt", "source");
      write("lifecycle/collision-target.txt", "target");

      assert.equal(
        await reasonOf(() => renameFileFromBrowser(root, undefined, "lifecycle/collision-source.txt", "collision-target.txt")),
        "conflict",
      );
      assert.equal((await readFileForPreview(root, "lifecycle/collision-source.txt")).content, "source");
      assert.equal((await readFileForPreview(root, "lifecycle/collision-target.txt")).content, "target");
    });

    test("deletes a writable regular file", async () => {
      write("lifecycle/delete-me.txt", "gone");

      await deleteFileFromBrowser(root, undefined, "lifecycle/delete-me.txt");

      assert.equal(statSync(path.join(root, "lifecycle/delete-me.txt"), { throwIfNoEntry: false }), undefined);
    });

    test("moves a file into a writable directory and refuses a collision", async () => {
      mkdirSync(path.join(root, "lifecycle/archive"), { recursive: true });
      write("lifecycle/report.docx", "report");

      const result = await moveFileFromBrowser(root, undefined, "lifecycle/report.docx", "lifecycle/archive");

      assert.equal(result, "lifecycle/archive/report.docx");
      assert.equal((await readFileForPreview(root, result)).content, "report");
      assert.equal(statSync(path.join(root, "lifecycle/report.docx"), { throwIfNoEntry: false }), undefined);

      write("lifecycle/duplicate.txt", "source");
      write("lifecycle/archive/duplicate.txt", "target");
      assert.equal(
        await reasonOf(() => moveFileFromBrowser(root, undefined, "lifecycle/duplicate.txt", "lifecycle/archive")),
        "conflict",
      );
      assert.equal((await readFileForPreview(root, "lifecycle/duplicate.txt")).content, "source");
      assert.equal((await readFileForPreview(root, "lifecycle/archive/duplicate.txt")).content, "target");
    });

    test("copies a read-only file into a writable directory without removing the source", async () => {
      mkdirSync(path.join(root, "copy-zone/archive"), { recursive: true });
      write("copy-source.txt", "source");

      const result = await copyFileFromBrowser(root, "copy-zone", "copy-source.txt", "copy-zone/archive");

      assert.equal(result, "copy-zone/archive/copy-source.txt");
      assert.equal((await readFileForPreview(root, result)).content, "source");
      assert.equal((await readFileForPreview(root, "copy-source.txt")).content, "source");

      assert.equal(
        await reasonOf(() => copyFileFromBrowser(root, "copy-zone", "copy-source.txt", "copy-zone/archive")),
        "conflict",
      );
      assert.equal((await readFileForPreview(root, "copy-zone/archive/copy-source.txt")).content, "source");
    });

    test("refuses lifecycle mutations outside the writable zone", async () => {
      write("lifecycle-zone/inside.txt", "inside");
      write("lifecycle-outside.txt", "outside");
      mkdirSync(path.join(root, "lifecycle-zone/destination"), { recursive: true });

      assert.equal(await reasonOf(() => renameFileFromBrowser(root, "lifecycle-zone", "lifecycle-outside.txt", "renamed.txt")), "denied");
      assert.equal(await reasonOf(() => deleteFileFromBrowser(root, null, "lifecycle-zone/inside.txt")), "denied");
      assert.equal(
        await reasonOf(() => moveFileFromBrowser(root, "lifecycle-zone", "lifecycle-outside.txt", "lifecycle-zone/destination")),
        "denied",
      );
      assert.equal((await readFileForPreview(root, "lifecycle-outside.txt")).content, "outside");
    });

    test("refuses escaping mutation paths", async () => {
      assert.equal(await reasonOf(() => deleteFileFromBrowser(root, undefined, "../outside/secret.txt")), "outside-root");
      assert.equal(
        await reasonOf(() => moveFileFromBrowser(root, undefined, "readme.md", "../outside")),
        "outside-root",
      );
      assert.equal(
        await reasonOf(() => copyFileFromBrowser(root, undefined, "../outside/secret.txt", "empty")),
        "outside-root",
      );
      assert.equal((await readFileForPreview(root, "readme.md")).content, "# hello\n");
    });

    test("refuses lifecycle mutations through an intermediate symlink outside the root", async (t) => {
      if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");

      assert.equal(await reasonOf(() => deleteFileFromBrowser(root, undefined, "escape-dir/secret.txt")), "outside-root");
      assert.equal(
        await reasonOf(() => renameFileFromBrowser(root, undefined, "escape-dir/secret.txt", "renamed.txt")),
        "outside-root",
      );
      assert.equal(await reasonOf(() => moveFileFromBrowser(root, undefined, "escape-dir/secret.txt", "empty")), "outside-root");
      assert.equal(readFileSync(path.join(outside, "secret.txt"), "utf8"), "SECRET\n");
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

/**
 * Uploads get their own fixture root. Every other test in this file shares one
 * tree and reads it; these write into it, and a colliding name and a
 * created-on-demand directory are the behaviour under test rather than
 * background noise another test should have to work around.
 *
 * The destination is pinned to `<writableRoot>/uploads`, so a test that needs an
 * empty uploads directory asks for a writable zone of its own rather than a
 * directory of its own.
 */
describe("file browser uploads", () => {
  let root: string;
  let outside: string;
  let symlinksAvailable = false;

  /** A PDF header followed by NUL and high bytes — the exact shape a text write refuses. */
  const BINARY = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0x00, 0xff, 0xfe, 0x0a]);
  const b64 = (content: string | Buffer) => Buffer.from(content as never).toString("base64");

  /** A writable zone of its own, and the only destination uploads into it may name. */
  function zone(name: string): { writableRel: string; destination: string } {
    mkdirSync(path.join(root, name), { recursive: true });
    return { writableRel: name, destination: `${name}/uploads` };
  }

  /** Upload into `name`'s zone, the way the server always calls it. */
  function upload(z: { writableRel: string; destination: string }, fileName: string, content: string | Buffer) {
    return uploadFileFromBrowser(root, z.writableRel, z.destination, fileName, b64(content));
  }

  before(async () => {
    const base = mkdtempSync(path.join(tmpdir(), "pi-upload-"));
    mkdirSync(path.join(base, "root"), { recursive: true });
    mkdirSync(path.join(base, "outside"), { recursive: true });
    root = await realResolve(path.join(base, "root"));
    outside = await realResolve(path.join(base, "outside"));
    mkdirSync(path.join(root, "readonly"), { recursive: true });
    try {
      symlinkSync(outside, path.join(root, "escape-dir"), "dir");
      symlinksAvailable = true;
    } catch {
      symlinksAvailable = false;
    }
  });

  after(() => {
    rmSync(path.dirname(root), { recursive: true, force: true });
  });

  test("stores a binary payload byte-identically and reports the written path", async () => {
    const z = zone("binary-zone");

    const written = await upload(z, "report.pdf", BINARY);

    assert.equal(written, "binary-zone/uploads/report.pdf");
    assert.deepEqual(readFileSync(path.join(root, written)), BINARY);
  });

  test("creates the uploads directory when it does not exist", async () => {
    const z = zone("fresh-zone");
    assert.equal(existsSync(path.join(root, "fresh-zone", "uploads")), false);

    const written = await upload(z, "note.txt", "hi");

    assert.equal(written, "fresh-zone/uploads/note.txt");
    assert.equal(statSync(path.join(root, "fresh-zone", "uploads")).isDirectory(), true);
  });

  test("does not overwrite a taken name: it suffixes and reports what it wrote", async () => {
    const z = zone("collide-zone");

    const first = await upload(z, "report.pdf", "first");
    const second = await upload(z, "report.pdf", "second");
    const third = await upload(z, "report.pdf", "third");

    assert.equal(first, "collide-zone/uploads/report.pdf");
    assert.equal(second, "collide-zone/uploads/report-1.pdf");
    assert.equal(third, "collide-zone/uploads/report-2.pdf");
    // The extension survives the suffix, and the file already there is untouched
    assert.equal(readFileSync(path.join(root, first), "utf8"), "first");
    assert.equal(readFileSync(path.join(root, second), "utf8"), "second");
  });

  test("leaves no temporary file behind", async () => {
    const z = zone("tidy-zone");

    await upload(z, "kept.bin", BINARY);

    const entries = await listDirectory(root, z.destination);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["kept.bin"],
    );
  });

  test("refuses a read-only sandbox", async () => {
    const z = zone("readonly-zone");

    assert.equal(
      await reasonOf(() => uploadFileFromBrowser(root, null, z.destination, "denied.pdf", b64(BINARY))),
      "denied",
    );
    assert.equal(existsSync(path.join(root, z.destination)), false);
  });

  test("refuses a destination outside the writable zone", async () => {
    const z = zone("scoped-zone");

    assert.equal(
      await reasonOf(() => uploadFileFromBrowser(root, z.writableRel, "readonly", "denied.pdf", b64(BINARY))),
      "denied",
    );
    assert.equal(existsSync(path.join(root, "readonly", "denied.pdf")), false);
  });

  test("refuses any destination but the uploads directory, even inside the writable zone", async () => {
    const z = zone("pinned-zone");

    // Every one of these is confined and writable — and still refused, because
    // upload_file is not a general-purpose write-anywhere primitive.
    for (const destination of ["pinned-zone", "pinned-zone/elsewhere", "pinned-zone/uploads/nested", "pinned-zone/Uploads"]) {
      assert.equal(
        await reasonOf(() => uploadFileFromBrowser(root, z.writableRel, destination, "report.pdf", b64(BINARY))),
        "denied",
        `expected "${destination}" to be refused`,
      );
    }
    assert.equal(existsSync(path.join(root, "pinned-zone", "elsewhere")), false);
    assert.equal(existsSync(path.join(root, "pinned-zone", "report.pdf")), false);
  });

  test("refuses a destination that climbs out of the root", async () => {
    const z = zone("escape-zone");

    assert.equal(
      await reasonOf(() => uploadFileFromBrowser(root, z.writableRel, "../outside", "escaped.pdf", b64(BINARY))),
      "outside-root",
    );
    assert.equal(existsSync(path.join(outside, "escaped.pdf")), false);
  });

  test("refuses a destination reached through a symlink out of the root", async (t) => {
    if (!symlinksAvailable) return t.skip("symlinks unavailable on this platform");
    const z = zone("symlink-zone");

    assert.equal(
      await reasonOf(() => uploadFileFromBrowser(root, z.writableRel, "escape-dir", "escaped.pdf", b64(BINARY))),
      "outside-root",
    );
    assert.equal(existsSync(path.join(outside, "escaped.pdf")), false);
  });

  test("refuses a name that is a route rather than a name", async () => {
    const z = zone("name-zone");
    const names = ["", "   ", ".", "..", "sub/report.pdf", "sub\\report.pdf", "report.pdf"];

    for (const name of names) {
      assert.equal(await reasonOf(() => upload(z, name, BINARY)), "invalid", `expected ${JSON.stringify(name)} to be refused`);
    }
    assert.equal(existsSync(path.join(root, "name-zone", "uploads", "sub")), false);
  });

  test("refuses names another platform would resolve to something else", async () => {
    const z = zone("portable-zone");
    const names = [
      // Win32 strips these, so they would collide with "report.pdf" while the
      // EEXIST check thought it was looking at a free name
      "report.pdf.",
      "report.pdf ",
      // NTFS alternate data stream
      "report.pdf:hidden",
      // DOS devices, with and without an extension
      "CON",
      "con.txt",
      "LPT1.pdf",
      "nul",
      "x".repeat(256),
    ];

    for (const name of names) {
      assert.equal(await reasonOf(() => upload(z, name, BINARY)), "invalid", `expected ${JSON.stringify(name)} to be refused`);
    }
  });

  test("refuses a body that is not decodable base64", async () => {
    const z = zone("base64-zone");

    assert.equal(
      await reasonOf(() => uploadFileFromBrowser(root, z.writableRel, z.destination, "bad.pdf", "not base64!!")),
      "invalid",
    );
    // Right alphabet, wrong length — Buffer.from would have silently truncated this
    assert.equal(await reasonOf(() => uploadFileFromBrowser(root, z.writableRel, z.destination, "bad.pdf", "QUJDR")), "invalid");
    assert.equal(existsSync(path.join(root, "base64-zone", "uploads", "bad.pdf")), false);
  });

  test("refuses a wire payload longer than the base64 cap, before decoding it", async () => {
    const z = zone("wire-cap-zone");
    const overLong = "A".repeat(MAX_UPLOAD_BASE64_LENGTH + 4);

    assert.equal(
      await reasonOf(() => uploadFileFromBrowser(root, z.writableRel, z.destination, "huge.pdf", overLong)),
      "too-large",
    );
    assert.equal(existsSync(path.join(root, "wire-cap-zone", "uploads", "huge.pdf")), false);
  });

  test("refuses a payload whose decoded size exceeds the cap", async () => {
    const z = zone("decoded-cap-zone");
    // Exactly the wire cap, unpadded: it decodes to two bytes past MAX_UPLOAD_BYTES,
    // so only the post-decode check can catch it.
    const atWireCap = "A".repeat(MAX_UPLOAD_BASE64_LENGTH);
    assert.ok(Buffer.from(atWireCap, "base64").byteLength > MAX_UPLOAD_BYTES);

    assert.equal(
      await reasonOf(() => uploadFileFromBrowser(root, z.writableRel, z.destination, "huge.pdf", atWireCap)),
      "too-large",
    );
    assert.equal(existsSync(path.join(root, "decoded-cap-zone", "uploads", "huge.pdf")), false);
  });

  test("accepts a payload at the declared maximum", async () => {
    const z = zone("max-zone");

    const written = await upload(z, "maximum.bin", Buffer.alloc(MAX_UPLOAD_BYTES, 0x00));

    assert.equal(statSync(path.join(root, written)).size, MAX_UPLOAD_BYTES);
  });
});
