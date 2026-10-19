/**
 * Watching each repository's own state, so the git surface follows what happened to it.
 *
 * The status was re-read when a listed file or directory changed and at the end of an
 * agent turn. A commit, a checkout, a reset or a stash touches only the git directory,
 * which nobody lists, so one made from a terminal, an IDE, or the integrated terminal
 * between two turns left the tree's badges, the branch chip and the editor's gutter
 * describing a HEAD that had moved — the gutter silently comparing with another branch.
 *
 * One non-recursive watch per repository, on its git directory: `index`, `HEAD`,
 * `ORIG_HEAD`, `COMMIT_EDITMSG` and `FETCH_HEAD` are all written there, so every
 * operation that changes what the status says shows up as a change in it. A burst (a
 * commit writes several files) is announced once, after a fixed window, as the
 * directory watcher does.
 *
 * Our own git calls do not feed this: they run with `GIT_OPTIONAL_LOCKS=0` (see
 * `runGit`), so even `git status` writes nothing there, and re-reading the status on
 * an announcement cannot announce again.
 *
 * SECURITY: a watch is a handle on a directory, which may lie outside the browser root —
 * the repository containing the root, a linked work tree's common directory. It reads
 * no content and announces only the repository's id, which the client already holds;
 * the git commands themselves still run only where `discoverRepos` confined them.
 */
import fsSync, { type FSWatcher } from "node:fs";
import { gitDirOf, type GitRepo } from "./git.ts";

export const GIT_COALESCE_MS = 150;

/** A backstop: a workspace holding more repositories than this watches the first ones. */
export const MAX_WATCHED_REPOSITORIES = 64;

export interface GitMetadataWatcher {
  /** Watch exactly these repositories: new ones are opened, gone ones closed. Never throws. */
  watch(repos: readonly GitRepo[]): Promise<void>;
  /** Repository ids currently watched. */
  watched(): string[];
  close(): void;
}

export interface GitMetadataWatcherOptions {
  /** Called with the repository's id, once per coalescing window. */
  onChange: (repoId: string) => void;
  coalesceMs?: number;
  /** For tests: where a repository's git directory is. */
  gitDirOf?: (repo: GitRepo) => Promise<string>;
}

interface Entry {
  gitDir: string;
  watcher: FSWatcher;
  timer?: NodeJS.Timeout;
}

export function createGitMetadataWatcher(options: GitMetadataWatcherOptions): GitMetadataWatcher {
  const { onChange } = options;
  const coalesceMs = options.coalesceMs ?? GIT_COALESCE_MS;
  const resolveGitDir = options.gitDirOf ?? gitDirOf;
  const entries = new Map<string, Entry>();
  let closed = false;
  // Calls are serialised: two rescans finishing out of order would leave the older set watched.
  let queue: Promise<void> = Promise.resolve();

  function drop(id: string): void {
    const entry = entries.get(id);
    if (entry === undefined) return;
    entries.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    try {
      entry.watcher.close();
    } catch {
      // Already closed, or its directory is gone.
    }
  }

  function announce(id: string): void {
    const entry = entries.get(id);
    if (entry === undefined || entry.timer !== undefined) return;
    entry.timer = setTimeout(() => {
      const current = entries.get(id);
      if (current === undefined) return;
      current.timer = undefined;
      if (!closed) onChange(id);
    }, coalesceMs);
    entry.timer.unref?.();
  }

  async function sync(repos: readonly GitRepo[]): Promise<void> {
    const wanted = repos.slice(0, MAX_WATCHED_REPOSITORIES);
    const dirs = new Map<string, string>();
    for (const repo of wanted) {
      try {
        dirs.set(repo.id, await resolveGitDir(repo));
      } catch {
        // A repository git cannot read now is not watched; the next rescan tries again.
      }
    }
    if (closed) return;
    for (const id of [...entries.keys()]) {
      if (dirs.get(id) !== entries.get(id)!.gitDir) drop(id);
    }
    for (const [id, gitDir] of dirs) {
      if (entries.has(id)) continue;
      let watcher: FSWatcher;
      try {
        watcher = fsSync.watch(gitDir, { persistent: false }, () => announce(id));
      } catch {
        continue;
      }
      // The directory removed under the watch: stop, and let the next rescan decide.
      watcher.on("error", () => drop(id));
      entries.set(id, { gitDir, watcher });
    }
  }

  return {
    watch(repos) {
      queue = queue.then(() => sync(repos)).catch(() => {});
      return queue;
    },
    watched: () => [...entries.keys()],
    close() {
      closed = true;
      for (const id of [...entries.keys()]) drop(id);
    },
  };
}
