/**
 * Read-only git backend for the UI: status, worktree file diff, history.
 *
 * SECURITY: every command is spawned without a shell, with a fixed argument
 * list, `cwd` at the browser root and a trailing pathspec — `-- .` for repo-scoped
 * reads, `-- <file>` for file-scoped ones — so git only ever reports content under
 * the browser root even when the repository's toplevel is an ancestor of it. The
 * `--` also stops git reading a path starting with a dash as an option or a
 * revision. Only rev-parse/status/log/show are used — nothing here can mutate the
 * repository.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { WORKTREE_REVISION, type GitFileLogEntry, type GitFileState, type GitFileStatus, type GitLogEntry } from "@pi-outpost/shared";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;
/** Commit patches beyond this are truncated (flagged), not refused. */
export const MAX_PATCH_BYTES = 256 * 1024;

export class GitError extends Error {}

async function runGit(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    throw new GitError(stderr?.trim().split("\n")[0] || `git ${args[0]} failed`);
  }
}

/** Startup probe: toplevel of the work tree containing root, or null (no repo / no git). */
export async function probeGit(root: string): Promise<{ toplevel: string } | null> {
  try {
    const out = await runGit(root, ["rev-parse", "--show-toplevel"]);
    const toplevel = out.trim();
    return toplevel ? { toplevel } : null;
  } catch {
    return null;
  }
}

/**
 * Undo git's C-style path quoting (core.quotePath quotes any non-ASCII byte as
 * \NNN octal — accented filenames are the everyday case, not the exception).
 */
export function unquote(gitPath: string): string {
  if (!gitPath.startsWith('"') || !gitPath.endsWith('"')) return gitPath;
  const inner = gitPath.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== "\\") {
      for (const byte of Buffer.from(inner[i], "utf8")) bytes.push(byte);
      continue;
    }
    const next = inner[++i];
    if (next >= "0" && next <= "7") {
      bytes.push(parseInt(inner.slice(i, i + 3), 8));
      i += 2;
    } else {
      const mapped = ({ "\\": "\\", '"': '"', n: "\n", t: "\t", r: "\r" } as Record<string, string>)[next] ?? next;
      for (const byte of Buffer.from(mapped, "utf8")) bytes.push(byte);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function stateFromXY(xy: string): GitFileState {
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A")) return "added";
  return "modified";
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

export async function gitStatus(root: string): Promise<GitStatusResult> {
  // -uall lists untracked files individually (default -unormal collapses a brand-new
  // directory to one "dir/" entry, leaving the files inside without badges)
  const out = await runGit(root, ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "--", "."]);
  const result: GitStatusResult = { branch: "", ahead: 0, behind: 0, files: [] };

  // status paths are cwd-relative (cwd = browser root); the `-- .` pathspec already
  // confines entries, the "../" guard is defense in depth
  const push = (gitPath: string, status: GitFileState) => {
    const rel = unquote(gitPath);
    if (rel !== "" && !rel.startsWith("../")) result.files.push({ path: rel, status });
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      result.branch = line.slice("# branch.head ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        result.ahead = Number(match[1]);
        result.behind = Number(match[2]);
      }
    } else if (line.startsWith("1 ")) {
      // 1 XY sub mH mI mW hH hI <path>
      const fields = line.split(" ");
      push(fields.slice(8).join(" "), stateFromXY(fields[1]));
    } else if (line.startsWith("2 ")) {
      // 2 XY sub mH mI mW hH hI X<score> <new>\t<old> — flatten renames to added + deleted
      const fields = line.split(" ");
      const rest = fields.slice(9).join(" ");
      const [newPath, oldPath] = rest.split("\t");
      if (newPath) push(newPath, "added");
      // Copies (C<score>) leave the source in place — only renames lose the old path
      if (oldPath && fields[8]?.startsWith("R")) push(oldPath, "deleted");
    } else if (line.startsWith("u ")) {
      const fields = line.split(" ");
      push(fields.slice(10).join(" "), "conflicted");
    } else if (line.startsWith("? ")) {
      push(line.slice(2), "untracked");
    }
  }
  return result;
}

/** `<rev>:<path>` reads paths from the repository toplevel, not from cwd. */
function toToplevelRelative(root: string, toplevel: string, relPath: string): string {
  const prefix = path.relative(toplevel, root).split(path.sep).join("/");
  return prefix === "" ? relPath : `${prefix}/${relPath}`;
}

/** The inverse: git reports log paths from the toplevel, the UI speaks browser-root paths. */
function toRootRelative(root: string, toplevel: string, toplevelRel: string): string {
  const prefix = path.relative(toplevel, root).split(path.sep).join("/");
  if (prefix === "") return toplevelRel;
  // A file renamed in from outside the browser root keeps a "../" path: the history
  // is real, but the caller's confinement check will refuse to diff that side.
  return path.posix.relative(prefix, toplevelRel);
}

/**
 * HEAD content of a browser-root-relative file (for the before side of a
 * worktree diff). Missing in HEAD (untracked/added) yields "". The caller has
 * already confined `relPath`; size/binary limits are the caller's too — this
 * only refuses grossly oversized blobs via the exec buffer cap.
 */
export async function gitHeadContent(root: string, toplevel: string, relPath: string): Promise<string> {
  const toplevelRel = toToplevelRelative(root, toplevel, relPath);
  try {
    return await runGit(root, ["show", `HEAD:${toplevelRel}`]);
  } catch (error) {
    // Only "not in HEAD" means an empty before-side (untracked/added, or an unborn
    // branch); anything else (timeout, output cap) must surface, not fake a full add
    const message = (error as Error).message;
    if (/does not exist in|exists on disk, but not in|invalid object name/i.test(message)) return "";
    throw error;
  }
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export async function gitLog(root: string, limit: number): Promise<GitLogEntry[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const out = await runGit(root, ["log", "--format=%H%x1f%an%x1f%aI%x1f%s", "-n", String(n), "--", "."]);
  return out
    .split("\n")
    .filter((line) => line.includes("\x1f"))
    .map((line) => {
      const [sha, author, date, subject] = line.split("\x1f");
      return { sha, author, date, subject: subject ?? "" };
    });
}

// --- File history -----------------------------------------------------------
//
// Record and field separators of the file-log format. `--numstat -z` frames a
// rename as `added \t deleted \t \0 old \0 new \0` instead of the compressed
// `dir/{a => b}/f` form, and leaves every path unescaped; the \x1e prefix keeps
// the header line separable from that NUL-framed payload.

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const LOG_FORMAT = `--format=${RECORD_SEP}%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`;
const FULL_SHA = /^[0-9a-f]{40}$/;
/** A rename chain deeper than this is pathological; stop stitching rather than fan out. */
const MAX_STITCHES = 8;

interface RawFileLogEntry {
  sha: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  /** Path at this commit, as git reported it — relative to the repository toplevel. */
  path: string;
  /** Set only when this commit renamed the file; toplevel-relative like `path`. */
  renamedFrom?: string;
  added: number;
  deleted: number;
}

/**
 * Read one commit's numstat payload. A merge carries none — git shows no diff for
 * merges by default — so it reports zero lines and no path of its own.
 */
function parseNumstat(payload: string): { path: string | null; renamedFrom?: string; added: number; deleted: number } {
  const tokens = payload.split("\0");
  const first = tokens[0]?.replace(/^\n+/, "");
  if (!first) return { path: null, added: 0, deleted: 0 };
  const [added, deleted, inlinePath] = first.split("\t");
  // "-" is git's marker for a binary file, which has no line counts
  const count = (value: string | undefined) => (value === undefined || value === "-" ? 0 : Number(value) || 0);
  // An empty third field means the two following NUL-separated tokens are old, new
  const renamed = inlinePath === "" ? { from: tokens[1], to: tokens[2] } : null;
  return {
    path: renamed ? (renamed.to ?? null) : inlinePath || null,
    renamedFrom: renamed?.from,
    added: count(added),
    deleted: count(deleted),
  };
}

/** Split a raw log into records, absorbing a subject that itself contains a record separator. */
function parseFileLog(out: string): RawFileLogEntry[] {
  const entries: RawFileLogEntry[] = [];
  for (const chunk of out.split(RECORD_SEP)) {
    if (chunk === "") continue;
    const breakAt = chunk.indexOf("\n");
    // -z terminates the header with a NUL of its own, before the numstat block
    const header = (breakAt === -1 ? chunk : chunk.slice(0, breakAt)).replace(/\0+$/, "");
    const payload = breakAt === -1 ? "" : chunk.slice(breakAt + 1);
    const fields = header.split(FIELD_SEP);
    const stats = parseNumstat(payload);

    // The only way a chunk is not a record is a subject carrying a literal \x1e:
    // stitch it back onto the previous subject rather than dropping the commit
    if (!FULL_SHA.test(fields[0] ?? "")) {
      const previous = entries[entries.length - 1];
      if (previous === undefined) continue;
      previous.subject += RECORD_SEP + header;
      if (stats.path !== null) {
        previous.path = stats.path;
        previous.renamedFrom = stats.renamedFrom;
        previous.added = stats.added;
        previous.deleted = stats.deleted;
      }
      continue;
    }

    const [sha, parents, author, date, subject] = fields;
    entries.push({
      sha,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      author,
      date,
      subject: subject ?? "",
      path: stats.path ?? "",
      renamedFrom: stats.renamedFrom,
      added: stats.added,
      deleted: stats.deleted,
    });
  }
  return entries;
}

/**
 * One `--full-history` walk: keeps merge commits, but stops dead at a rename.
 * `rev` is always a commit id this module produced, never client input.
 */
async function fullHistoryPass(root: string, rev: string | null, relPath: string, limit: number): Promise<RawFileLogEntry[]> {
  const args = ["log", "--full-history", "-z", "--numstat", LOG_FORMAT, "-n", String(limit)];
  if (rev !== null) args.push(rev);
  args.push("--", relPath);
  return parseFileLog(await runGit(root, args));
}

/**
 * The file's path one commit further back, or null if `sha` did not rename it.
 *
 * `--follow`'s numstat is the only place the rename pair shows up: under a
 * pathspec, `--full-history` reports a rename as a plain add, because the source
 * path lies outside the pathspec git was handed.
 */
async function renameSourceAt(root: string, toplevel: string, sha: string, relPath: string): Promise<string | null> {
  const args = ["log", "--follow", "-z", "--numstat", LOG_FORMAT, "-n", "1", sha, "--", relPath];
  const [entry] = parseFileLog(await runGit(root, args));
  if (entry?.renamedFrom === undefined) return null;
  const source = toRootRelative(root, toplevel, entry.renamedFrom);
  return source === relPath ? null : source;
}

/**
 * Commits touching one file, newest first, with merges kept and renames followed.
 *
 * Git offers one or the other, never both: `--follow` follows renames but drops
 * merge commits, `--full-history` keeps merges but stops at the first rename. So
 * this walks with `--full-history` and, whenever the walk halts on a commit that
 * still has parents, probes that commit for a rename and resumes from its parent
 * under the old path.
 *
 * Parents are then pruned to the commits actually present: `%P` names real
 * parents, which both history simplification and the stitch seam can leave
 * outside the response. An entry left with no present parent is linked to the next
 * one in log order — that is what joins the two sides of a seam, and what keeps a
 * limit-truncated tail connected.
 */
export async function gitFileLog(root: string, toplevel: string, relPath: string, limit: number): Promise<GitFileLogEntry[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const raw: RawFileLogEntry[] = [];
  const seen = new Set<string>();
  let rev: string | null = null;
  let currentPath = relPath;

  for (let stitch = 0; stitch <= MAX_STITCHES && raw.length < n; stitch++) {
    const batch = await fullHistoryPass(root, rev, currentPath, n - raw.length);
    for (const entry of batch) {
      if (seen.has(entry.sha)) continue;
      seen.add(entry.sha);
      // Normalise here, not at the end: git reports log paths from the repository
      // toplevel, while a pathspec — including the one the next stitch passes — is
      // read from cwd, i.e. the browser root
      raw.push({ ...entry, path: entry.path === "" ? currentPath : toRootRelative(root, toplevel, entry.path) });
    }
    const tail = batch[batch.length - 1];
    // Nothing left, no parent to resume from, or the budget is spent
    if (tail === undefined || tail.parents.length === 0 || raw.length >= n) break;
    const source = await renameSourceAt(root, toplevel, tail.sha, currentPath);
    if (source === null) break;
    currentPath = source;
    rev = tail.parents[0];
  }

  const present = new Set(raw.map((entry) => entry.sha));
  return raw.map((entry, index) => {
    const kept = entry.parents.filter((parent) => present.has(parent));
    const next = raw[index + 1];
    return {
      sha: entry.sha,
      author: entry.author,
      date: entry.date,
      subject: entry.subject,
      parents: kept.length > 0 ? kept : next ? [next.sha] : [],
      path: entry.path,
      added: entry.added,
      deleted: entry.deleted,
    };
  });
}

/**
 * Content of one file at one revision, for either side of a two-point diff.
 *
 * SECURITY: `rev` is either the exact working-tree marker — which never reaches
 * git, and is the caller's job to read from disk — or a commit id. Anything else
 * is refused before a process is spawned, so no revision expression (`HEAD@{…}`,
 * a branch name, an option-looking string) can be smuggled in.
 */
export async function gitRevisionContent(root: string, toplevel: string, rev: string, relPath: string): Promise<string> {
  if (rev === WORKTREE_REVISION) throw new GitError("The working tree is read from disk, not from git");
  if (!SHA_PATTERN.test(rev)) throw new GitError("Invalid commit id");
  const toplevelRel = toToplevelRelative(root, toplevel, relPath);
  try {
    // ^{commit} peels annotated tags and makes git refuse blob/tree ids
    return await runGit(root, ["show", `${rev}^{commit}:${toplevelRel}`]);
  } catch (error) {
    // The file simply not existing at that revision is an empty side, not a failure.
    // Everything else surfaces — notably "dereferences to blob type", which is
    // ^{commit} refusing a blob id and must never read as an empty file.
    const message = (error as Error).message;
    if (/does not exist in|exists on disk, but not in|invalid object name/i.test(message)) return "";
    throw error;
  }
}

export async function gitShow(root: string, sha: string): Promise<{ patch: string; truncated: boolean }> {
  if (!SHA_PATTERN.test(sha)) throw new GitError("Invalid commit id");
  // SECURITY: ^{commit} peels annotated tags but makes git refuse blob/tree ids —
  // `show <blob> -- .` would ignore the pathspec and print content outside the root
  const out = await runGit(root, ["show", "--format=%h %an %aI%n%s%n", "--patch", `${sha}^{commit}`, "--", "."]);
  const bytes = Buffer.from(out, "utf8");
  if (bytes.byteLength > MAX_PATCH_BYTES) {
    // Byte-accurate cap; strip the replacement char a split code point leaves behind
    return { patch: bytes.subarray(0, MAX_PATCH_BYTES).toString("utf8").replace(/�$/, ""), truncated: true };
  }
  return { patch: out, truncated: false };
}
