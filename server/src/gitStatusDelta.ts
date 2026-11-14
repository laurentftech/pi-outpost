/**
 * What one connection was last sent of the working-tree status, so the next answer
 * can carry only what changed.
 *
 * The status is asked again on every file change, save and agent turn. Sent in full
 * each time, a workspace with thousands of changed files resent all of them to say
 * that one moved. The client names the version it holds; when it is the one this
 * connection was last sent, the answer is the difference.
 *
 * The invariant both sides keep: after applying an answer, the client holds exactly
 * `entries`. A change answer is only computed against that; anything else - no
 * version, a stranger one, another workspace - gets a full sweep, never a scoped
 * full answer, so the two can never drift apart silently.
 */
import type { GitFileStatus } from "@pi-outpost/shared";

export interface SentStatus {
  /** The workspace the entries describe: a project switch on the same connection makes them stale. */
  owner: unknown;
  version: number;
  /** path → the entry sent and the repository it belongs to. */
  entries: Map<string, { file: GitFileStatus; repo: string }>;
}

/** Whether a change answer can be computed for a request naming `base`. */
export function canAnswerWithChanges(held: SentStatus | undefined, owner: unknown, base: number | undefined): held is SentStatus {
  return base !== undefined && held !== undefined && held.owner === owner && held.version === base;
}

const sameEntry = (a: GitFileStatus, b: GitFileStatus) => a.status === b.status && a.atLeast === b.atLeast;

/**
 * Record a full answer and return it. `held`'s version is continued so a version
 * number is never reused on one connection.
 */
export function recordFull(
  held: SentStatus | undefined,
  owner: unknown,
  files: GitFileStatus[],
  repoOf: (path: string) => string,
): { next: SentStatus; answer: { version: number; files: GitFileStatus[] } } {
  const version = (held?.version ?? 0) + 1;
  const entries = new Map<string, { file: GitFileStatus; repo: string }>();
  for (const file of files) entries.set(file.path, { file, repo: repoOf(file.path) });
  return { next: { owner, version, entries }, answer: { version, files } };
}

/**
 * The difference between what `held` says the client has and a fresh sweep.
 * `scope` limits the comparison to one repository's entries: a scoped sweep says
 * nothing about the others, so their entries are neither changed nor removed.
 */
export function recordChanges(
  held: SentStatus,
  files: GitFileStatus[],
  scope: string | undefined,
  repoOf: (path: string) => string,
): { next: SentStatus; answer: { version: number; base: number; files: GitFileStatus[]; removed: string[] } } {
  const fresh = new Map<string, GitFileStatus>();
  for (const file of files) fresh.set(file.path, file);
  const entries = new Map(held.entries);
  const removed: string[] = [];
  for (const [path, { repo }] of held.entries) {
    if (scope !== undefined && repo !== scope) continue;
    if (!fresh.has(path)) {
      removed.push(path);
      entries.delete(path);
    }
  }
  const changed: GitFileStatus[] = [];
  for (const file of files) {
    const before = held.entries.get(file.path);
    if (before === undefined || !sameEntry(before.file, file)) changed.push(file);
    entries.set(file.path, { file, repo: repoOf(file.path) });
  }
  const version = held.version + 1;
  return {
    next: { owner: held.owner, version, entries },
    answer: { version, base: held.version, files: changed, removed },
  };
}
