/**
 * Directory watching: what reaches the tree when the disk moves under it.
 *
 * Every test here changes the filesystem from outside the watcher — which is the
 * whole point of the feature, and the one thing the old `announceFileChange`
 * path could not see.
 */
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { promisify } from "node:util";
import { createDirectoryWatcher, DEFAULT_COALESCE_MS, MAX_WATCHED_DIRECTORIES } from "../src/fileWatcher.ts";
import { envWithoutCoverageSink } from "./childEnv.mjs";

const execFile = promisify(execFileCallback);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Short enough to keep the suite quick, long enough to actually coalesce. */
const COALESCE_MS = 25;

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  // `resolveConfined` compares canonical paths. macOS exposes /var as a symlink
  // to /private/var, and Windows runners may expand a short temp-directory name;
  // returning the spelling from mkdtemp makes every valid watch look outside its
  // root on those platforms.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "pi-outpost-watcher-")));
  roots.push(root);
  return root;
}

/** A recorder of announced directories, plus a way to wait for the next one. */
function recorder() {
  const seen: string[] = [];
  let wake: (() => void) | undefined;
  return {
    seen,
    onChange(relPath: string) {
      seen.push(relPath);
      wake?.();
    },
    /** Resolves as soon as `seen` grows past `from`, or after `timeoutMs`. */
    async next(from: number, timeoutMs = 2000): Promise<void> {
      if (seen.length > from) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(finish, timeoutMs);
        wake = finish;
        function finish() {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        }
      });
    },
  };
}

/**
 * Long enough that a coalescing window has certainly closed.
 *
 * Generously so, and deliberately not `COALESCE_MS * 4`. That was 100 ms, which is
 * ample on an idle laptop and not always ample on a CI runner doing three other
 * things: a setup-era announcement then arrives *after* the drain and lands in the
 * next assertion, which reads as the watcher announcing something it should not.
 * Waiting longer costs a few hundred milliseconds across this file and removes a
 * failure mode that looks exactly like a real defect.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(COALESCE_MS * 12, 300)));
}

describe("createDirectoryWatcher", () => {
  test("announces a directory changed by something other than this server", async () => {
    const root = await workspace();
    const log = recorder();
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: COALESCE_MS });
    try {
      await watcher.watch("");
      // The case the old tool-driven invalidation could not see at all: a write
      // that no part of this process performed.
      await writeFile(path.join(root, "appeared.txt"), "x");
      await log.next(0);
      assert.deepEqual(log.seen, [""]);
    } finally {
      watcher.close();
    }
  });

  test("sees a rename, in both the directory it left and the one it joined", async () => {
    const root = await workspace();
    await mkdir(path.join(root, "from"));
    await mkdir(path.join(root, "to"));
    await writeFile(path.join(root, "from/note.txt"), "x");
    const log = recorder();
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: COALESCE_MS });
    try {
      await watcher.watch("from");
      await watcher.watch("to");
      // The user's own report: a file moved with the operating system.
      await rename(path.join(root, "from/note.txt"), path.join(root, "to/note.txt"));
      await settle();
      assert.deepEqual([...log.seen].sort(), ["from", "to"]);
    } finally {
      watcher.close();
    }
  });

  test("says nothing about a directory that was never listed", async () => {
    const root = await workspace();
    await mkdir(path.join(root, "unopened"));
    const log = recorder();
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: COALESCE_MS });
    try {
      await watcher.watch(""); // the root only
      await writeFile(path.join(root, "unopened/hidden.txt"), "x");
      await settle();
      // Some platforms notify a watched parent for nested activity. The honest
      // cross-platform contract is that the unlisted child itself never becomes
      // a watched/announced path; a conservative root refresh is harmless.
      assert.ok(!log.seen.includes("unopened"));
      assert.deepEqual(watcher.watched(), [""]);
    } finally {
      watcher.close();
    }
  });

  test("opens no watch on a path that does not confine to the root", async () => {
    const root = await workspace();
    const outside = await workspace();
    await writeFile(path.join(outside, "secret.txt"), "x");
    const log = recorder();
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: COALESCE_MS });
    try {
      // A watch is an open handle on a path: the confinement that governs reading
      // has to govern this too, whatever the caller believed it was passing.
      await watcher.watch("../..");
      await watcher.watch(outside);
      assert.deepEqual(watcher.watched(), []);
      await writeFile(path.join(outside, "another.txt"), "x");
      await settle();
      assert.deepEqual(log.seen, []);
    } finally {
      watcher.close();
    }
  });

  test("opens no watch on a directory that is not there", async () => {
    const root = await workspace();
    const log = recorder();
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: COALESCE_MS });
    try {
      // A refused listing must not leave a watch behind, and must not throw here
      // either — the listing already answered the client.
      await watcher.watch("no-such-directory");
      assert.deepEqual(watcher.watched(), []);
    } finally {
      watcher.close();
    }
  });

  test("collapses a burst into one announcement", async () => {
    const root = await workspace();
    const log = recorder();
    // Wide enough that forty writes provably finish inside it, on a loaded CI runner
    // as well as here. The window opens on the first event and is never extended, so
    // a burst that outlives it opens a second one — correctly, and the spec says so:
    // "at most one notification for that directory *and that window*". With 100 ms
    // the writes themselves straddled the boundary on Windows, and the test failed
    // for the one reason that is not a defect.
    const burstWindowMs = 2_000;
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: burstWindowMs });
    try {
      await watcher.watch("");
      // One `npm install` is thousands of these. The client's reaction is to
      // re-list, which is idempotent, so collapsing them costs nothing.
      const began = Date.now();
      await Promise.all(Array.from({ length: 40 }, (_, i) => writeFile(path.join(root, `f${i}.txt`), "x")));
      const writing = Date.now() - began;
      assert.ok(
        writing < burstWindowMs,
        `the burst took ${writing} ms, which is not inside a ${burstWindowMs} ms window — this test proves nothing`,
      );

      await new Promise((resolve) => setTimeout(resolve, burstWindowMs + 500));
      assert.deepEqual(log.seen, [""], `expected one announcement, got ${log.seen.length}`);
    } finally {
      watcher.close();
    }
  });

  test("keeps reporting while a directory is written to continuously", async () => {
    const root = await workspace();
    const log = recorder();
    // A wide window on purpose. The failure a resetting debounce produces is that
    // writes never stop, so the window never closes, so the tree stays wrong for
    // exactly as long as it is being made wrong — but with a 25 ms window the
    // platform's own gaps between delivered events are wide enough to let a
    // resetting timer fire anyway, and the regression goes unseen. Nothing here
    // pauses for a quarter of a second, so only a window that opens on the first
    // event and is never extended reaches a second announcement.
    const windowMs = 250;
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: windowMs });
    try {
      await watcher.watch("");
      // Driven by what has been announced, not by the clock: how quickly a
      // platform delivers the first event is not part of the contract, and on
      // Windows it was slow enough to end the writes after a single window.
      const deadline = Date.now() + windowMs * 40;
      let i = 0;
      while (log.seen.length < 2 && Date.now() < deadline) {
        await writeFile(path.join(root, `busy${i++}.txt`), "x");
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      assert.ok(log.seen.length >= 2, `expected repeated announcements while writing, got ${log.seen.length}`);
    } finally {
      watcher.close();
    }
  });

  test("drops the least recently listed directory once the cap is reached", async () => {
    const root = await workspace();
    for (const name of ["a", "b", "c"]) await mkdir(path.join(root, name));
    const log = recorder();
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: COALESCE_MS, maxWatched: 2 });
    try {
      await watcher.watch("a");
      await watcher.watch("b");
      // Re-listing "a" makes it the most recent, so "b" is now the oldest — this
      // is recency of *listing*, not of creation.
      await watcher.watch("a");
      await watcher.watch("c");
      assert.deepEqual(watcher.watched(), ["a", "c"]);

      // macOS can deliver setup-era directory notifications after watch() has
      // returned. Drain them before proving that the evicted path itself is quiet.
      await settle();
      log.seen.length = 0;

      // An evicted directory goes quiet rather than erroring…
      await writeFile(path.join(root, "b/ignored.txt"), "x");
      await settle();
      assert.deepEqual(log.seen, []);

      // …and comes back when it is listed again.
      await watcher.watch("b");
      await writeFile(path.join(root, "b/noticed.txt"), "x");
      await log.next(0);
      assert.deepEqual(log.seen, ["b"]);
    } finally {
      watcher.close();
    }
  });

  test("stops announcing once closed", async () => {
    const root = await workspace();
    const log = recorder();
    const watcher = createDirectoryWatcher({ root, onChange: log.onChange, coalesceMs: COALESCE_MS });
    await watcher.watch("");
    watcher.close();
    assert.deepEqual(watcher.watched(), []);
    await writeFile(path.join(root, "after-close.txt"), "x");
    await settle();
    assert.deepEqual(log.seen, []);
  });

  test("holds sane defaults", () => {
    assert.equal(MAX_WATCHED_DIRECTORIES, 256);
    assert.equal(DEFAULT_COALESCE_MS, 120);
  });

  test("never keeps the process alive on its own", async () => {
    // Not introspection of an option — the actual property. A watcher that held
    // the loop would make this child hang, and a hung child is how a whole test
    // run stops finishing.
    const { stdout } = await execFile(
      process.execPath,
      ["--import", "tsx/esm", path.join(HERE, "fixtures/watcher-exits.mjs")],
      { timeout: 20_000, env: envWithoutCoverageSink() },
    );
    assert.match(stdout, /watching/);
  });
});
