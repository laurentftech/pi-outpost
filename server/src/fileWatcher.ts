/**
 * Directory watching for the file browser.
 *
 * The tree used to learn about a change only when this process was the one that
 * made it, and only through the `edit` and `write` tools — so a `bash` move, an
 * extension's write, or anything done outside the process at all left the tree
 * showing a workspace that no longer existed. This watches the disk instead.
 *
 * What is watched is exactly what a client displays: `handleListDirectory` is the
 * funnel every displayed directory passes through, and `handleReadFile` that of every
 * displayed file (its directory is watched, so the file is followed even when its
 * folder was never expanded). Registering there bounds the watch set by what somebody
 * actually looked at. A collapsed directory
 * displays nothing, so nothing needs to know it changed — and a workspace with a
 * 40 000-directory `node_modules` costs nothing until someone opens it. This is
 * the whole reason there is no recursive watch on the root: on Linux that is one
 * inotify watch per subdirectory, which spends the host's `max_user_watches` on
 * directories nobody is looking at and then fails wholesale with ENOSPC.
 *
 * SECURITY: a watch is an open handle on a path. Every path resolves through the
 * file browser's own symlink-safe confinement before one is opened — the callers
 * have already confined it, but a second implementation of that rule is exactly
 * the kind that drifts, and this one would drift into which paths the server
 * holds handles on.
 */
import fsSync, { type FSWatcher } from "node:fs";
import { FileBrowserError, resolveConfined } from "./fileBrowser.ts";

/**
 * Ceiling on simultaneously watched directories, least-recently-listed evicted.
 *
 * A backstop rather than a budget: expanding this many directories in one
 * session is already unusual, and going over degrades to today's behaviour — a
 * stale directory, refreshable by hand — rather than to an error.
 */
export const MAX_WATCHED_DIRECTORIES = 256;

/**
 * How long changes to one directory are collected before it is announced.
 *
 * The window opens on the first event and is never extended. That distinction is
 * the point: a debounce that resets on every event never fires while a directory
 * is being written to continuously, which is precisely when the tree is most
 * wrong. A fixed window bounds the rate at one message per directory per window
 * with no starvation, and the client's reaction (re-list) is idempotent, so
 * collapsing a burst into one loses nothing.
 */
export const DEFAULT_COALESCE_MS = 120;

export interface DirectoryWatcher {
  /**
   * Watch `relPath` (browser-root-relative, `""` = the root), and mark it as the
   * most recently used. Idempotent, and never throws: a path that cannot be
   * confined or opened is simply not watched.
   */
  watch(relPath: string): Promise<void>;
  /** Browser-root-relative paths currently watched, least recently listed first. */
  watched(): string[];
  /** Release every handle and cancel every pending window. */
  close(): void;
}

export interface DirectoryWatcherOptions {
  /** The browser root every watched path is confined to. */
  root: string;
  /** Called with the browser-root-relative directory path, once per coalescing window. */
  onChange: (relPath: string) => void;
  maxWatched?: number;
  coalesceMs?: number;
}

interface Entry {
  watcher: FSWatcher;
  /** Pending announcement for this directory, if a window is open. */
  timer?: NodeJS.Timeout;
}

export function createDirectoryWatcher(options: DirectoryWatcherOptions): DirectoryWatcher {
  const { root, onChange } = options;
  const maxWatched = options.maxWatched ?? MAX_WATCHED_DIRECTORIES;
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;

  // Map preserves insertion order, which is what makes it the LRU: re-listing
  // deletes and re-inserts, so the oldest key is always the least recently listed.
  const entries = new Map<string, Entry>();
  let closed = false;

  function drop(relPath: string): void {
    const entry = entries.get(relPath);
    if (entry === undefined) return;
    entries.delete(relPath);
    if (entry.timer) clearTimeout(entry.timer);
    // The handle may already be dead (directory removed) — closing twice is fine,
    // and a throw here would take down whatever event delivered us.
    try {
      entry.watcher.close();
    } catch {
      // Already closed, or the platform refuses to close a watch on a gone directory.
    }
  }

  function announce(relPath: string): void {
    const entry = entries.get(relPath);
    if (entry === undefined || entry.timer !== undefined) return; // window already open
    entry.timer = setTimeout(() => {
      // Read the entry again: it may have been evicted or closed while the window
      // was open, in which case nobody is listening for this directory any more.
      const current = entries.get(relPath);
      if (current === undefined) return;
      current.timer = undefined;
      if (!closed) onChange(relPath);
    }, coalesceMs);
    // A pending announcement must not be the reason the process stays alive. The
    // server has an HTTP listener for that; a test has nothing, and a stray timer
    // is how a test run hangs instead of finishing.
    entry.timer.unref?.();
  }

  return {
    async watch(relPath: string): Promise<void> {
      if (closed) return;
      const existing = entries.get(relPath);
      if (existing !== undefined) {
        // Already watched — just make it the most recently used.
        entries.delete(relPath);
        entries.set(relPath, existing);
        return;
      }

      let resolved: string;
      try {
        resolved = await resolveConfined(root, relPath);
      } catch (error) {
        // Outside the root, or gone between the listing and here. Either way there
        // is nothing to watch, and a listing that already succeeded must not fail
        // retroactively because of it.
        if (error instanceof FileBrowserError) return;
        return;
      }
      // `close()` can land while the resolve above is in flight.
      if (closed) return;
      // Re-check: two concurrent listings of the same directory both get here.
      if (entries.has(relPath)) return;

      let watcher: FSWatcher;
      try {
        // `persistent: false` — see the timer note above; same reasoning, and here
        // it is the documented switch for it.
        watcher = fsSync.watch(resolved, { persistent: false });
      } catch {
        // ENOSPC (inotify budget), EPERM, ENOENT. Watching is best-effort by
        // contract; the manual refresh control is what covers this.
        return;
      }

      const entry: Entry = { watcher };
      entries.set(relPath, entry);
      watcher.on("change", () => announce(relPath));
      // A directory that is removed reports an error on some platforms and goes
      // silent on others. Dropping is right either way: the parent directory's own
      // watch is what reports the removal to the tree.
      watcher.on("error", () => drop(relPath));

      while (entries.size > maxWatched) {
        const oldest = entries.keys().next();
        if (oldest.done || oldest.value === relPath) break;
        drop(oldest.value);
      }
    },

    watched(): string[] {
      return [...entries.keys()];
    },

    close(): void {
      closed = true;
      for (const relPath of [...entries.keys()]) drop(relPath);
    },
  };
}
