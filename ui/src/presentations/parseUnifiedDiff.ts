import type { DiffLine } from "../util/diff";

export interface DiffFile {
  /** Worktree-relative path, taken from the `b/` side unless the file was deleted. */
  path: string;
  lines: DiffLine[];
  added: number;
  removed: number;
}

/** Strips one leading `a/` or `b/` prefix; `/dev/null` becomes null. */
function stripPrefix(raw: string): string | null {
  const path = raw.trim();
  if (path === "/dev/null" || path === "") return null;
  return path.replace(/^[ab]\//, "");
}

/**
 * Parses `git diff` / `git show` output into per-file line lists.
 *
 * Deliberately tolerant: anything outside a hunk (commit headers, mode changes,
 * binary notices) is skipped rather than rejected, so a `git show` result parses
 * the same way a bare diff does. A result with no recognizable hunk yields an
 * empty array, which the presentation treats as "not a diff after all".
 */
export function parseUnifiedDiff(output: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let pendingOld: string | null = null;
  let inHunk = false;

  const push = () => {
    if (current && current.lines.length > 0) files.push(current);
    current = null;
  };

  for (const line of output.split("\n")) {
    if (line.startsWith("diff --git ")) {
      push();
      inHunk = false;
      pendingOld = null;
      // `diff --git a/x b/x` — take the b-side, which survives a rename.
      const match = /^diff --git (.+?) (.+)$/.exec(line);
      const path = match ? (stripPrefix(match[2]) ?? stripPrefix(match[1])) : null;
      current = path === null ? null : { path, lines: [], added: 0, removed: 0 };
      continue;
    }
    if (line.startsWith("--- ")) {
      inHunk = false;
      pendingOld = stripPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      inHunk = false;
      const path = stripPrefix(line.slice(4)) ?? pendingOld;
      // A diff without a `diff --git` header (plain `diff -u`) still names its file here.
      if (path !== null && (current === null || current.lines.length > 0)) {
        push();
        current = { path, lines: [], added: 0, removed: 0 };
      } else if (path !== null && current !== null) {
        current.path = path;
      }
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = current !== null;
      continue;
    }
    if (!inHunk || current === null) continue;

    if (line.startsWith("+")) {
      current.lines.push({ type: "add", text: line.slice(1) });
      current.added++;
    } else if (line.startsWith("-")) {
      current.lines.push({ type: "del", text: line.slice(1) });
      current.removed++;
    } else if (line.startsWith(" ")) {
      current.lines.push({ type: "same", text: line.slice(1) });
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — not a content line.
      continue;
    } else {
      // Anything else ends the hunk (next file header, commit trailer, blank tail).
      inHunk = false;
    }
  }
  push();
  return files;
}
