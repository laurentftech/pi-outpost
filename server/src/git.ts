/**
 * Read-only git backend for the UI: status, worktree file diff, history.
 *
 * A workspace holds a SET of repositories, not one: the directory it is rooted at
 * may be inside a repository, may hold several underneath it, or both. Every
 * request naming a path is served by the repository owning that path (`repoFor`),
 * and paths cross this module's boundary browser-root-relative in both directions.
 *
 * SECURITY: every command is spawned without a shell, with a fixed argument list,
 * a trailing pathspec — `-- .` for repo-scoped reads, `-- <file>` for file-scoped
 * ones — and `cwd` at either the browser root or a repository toplevel that has
 * been realpath-resolved and checked to lie under that root. Both cases keep git
 * reporting only content under the browser root: the second because the cwd is
 * itself under it, the first because the pathspec bounds a repository whose
 * toplevel is an ancestor. The `--` also stops git reading a path starting with a
 * dash as an option or a revision. Only rev-parse/status/log/show are used —
 * nothing here can mutate the repository.
 */
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isWithin, realResolve } from "./sandbox.ts";
import {
  WORKTREE_REVISION,
  type GitUnavailable,
  type GitFileLogEntry,
  type GitFileState,
  type GitFileStatus,
  type GitLogEntry,
  type GitRepoStatus,
} from "@pi-outpost/shared";

const execFileAsync = promisify(execFile);

/**
 * The git this process runs.
 *
 * Resolved once at startup and held, rather than looked up per command: it cannot
 * usefully change mid-run, and a badge refresh should not pay for a search. Left at
 * the bare name until `useGitExecutable` says otherwise, so any caller that has not
 * resolved yet behaves exactly as this module always did.
 */
let gitBinary = "git";
let gitResolved = false;

/**
 * Where git installers put it, per platform.
 *
 * SECURITY: every candidate is absolute, and none is derived from the workspace, the
 * browser root or the working directory. A repository that could contribute a
 * candidate would be a repository choosing which binary the server runs for it.
 */
export function standardLocations(): string[] {
  const env = (name: string) => process.env[name];
  if (process.platform === "win32") {
    return [env("ProgramFiles"), env("ProgramW6432"), env("ProgramFiles(x86)")]
      .filter((base): base is string => !!base)
      .map((base) => path.join(base, "Git", "cmd", "git.exe"))
      .concat(env("LOCALAPPDATA") ? [path.join(env("LOCALAPPDATA")!, "Programs", "Git", "cmd", "git.exe")] : []);
  }
  if (process.platform === "darwin") {
    return ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git", "/Library/Developer/CommandLineTools/usr/bin/git"];
  }
  return ["/usr/bin/git", "/usr/local/bin/git"];
}

/** Does this path answer as a git? The cheapest question that proves it runs. */
async function answersAsGit(candidate: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(candidate, ["--version"], {
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      windowsHide: true,
    });
    return /^git version /i.test(stdout.trim());
  } catch {
    return false;
  }
}

/**
 * The git executable to use, or a GitError saying what was tried.
 *
 * `PATH` is not enough on its own: git is installed on every Windows box that has
 * VS Code working, and is routinely absent from the PATH a server process inherits —
 * which removed the whole git surface with no message, and is why this exists.
 *
 * A configured path that does not answer FAILS here rather than falling through to
 * the next candidate. Naming an executable is an instruction, and quietly running a
 * different git would answer questions about the wrong installation.
 */
export async function resolveGitExecutable(configured?: string, candidates: string[] = standardLocations()): Promise<string> {
  if (configured !== undefined) {
    if (await answersAsGit(configured)) return configured;
    throw new GitError(`"${configured}" is not a runnable git`);
  }
  if (await answersAsGit("git")) return "git";
  for (const candidate of candidates) {
    if (await answersAsGit(candidate)) return candidate;
  }
  throw new GitError(`git could not be found on PATH, nor at ${candidates.join(", ")}`);
}

/** Adopt a resolved executable for every git command from here on. */
export function useGitExecutable(executable: string): void {
  gitBinary = executable;
  gitResolved = true;
}

/** Resolved executable for the separate resource-repository service. */
export function currentGitExecutable(): string {
  return gitBinary;
}

/** Test seam: forget the resolved executable, back to the bare name. */
export function resetGitExecutable(): void {
  gitBinary = "git";
  gitResolved = false;
}

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;
/** Commit patches beyond this are truncated (flagged), not refused. */
export const MAX_PATCH_BYTES = 256 * 1024;

export class GitError extends Error {}

async function runGit(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(gitBinary, args, {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "utf8",
      // Without this, every git call opens a console window on Windows — and the
      // repository questions are asked constantly: on each workspace switch, each
      // tree listing, each status check. The result is a machine that flashes a
      // black rectangle at its user all day. It changes nothing on other platforms.
      windowsHide: true,
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
 * Why git cannot serve this workspace, or undefined when it can.
 *
 * Discovery looks for `.git` on disk and never asks git whether it will actually read
 * what it found — so a repository git refuses (dubious ownership, the everyday case)
 * enters the set looking perfectly healthy, and every command against it then fails
 * where nobody is watching. One `rev-parse` against a discovered repository is what
 * turns that into an answer.
 *
 * An unrecognised failure classifies as `refused`, not as `no-repository`: the loud
 * reading of an unknown error surfaces it, the quiet one buries it, and burying it is
 * precisely the bug this replaces.
 */
export async function whyGitCannotServe(root: string, repos: readonly GitRepo[]): Promise<GitUnavailable | undefined> {
  if (!gitResolved) {
    return { reason: "no-executable", message: `git could not be run (tried ${gitBinary})` };
  }
  // With a set in hand, ask one of its repositories rather than the root: the root of a
  // directory-of-projects is no repository at all, and would answer for none of them
  const [first] = repos;
  try {
    await runGit(first ? first.cwd : root, ["rev-parse", "--show-toplevel"]);
    // It answered. An empty set here means the root is in a repository discovery
    // dropped — impossible — so a set with something in it is simply healthy.
    return first ? undefined : { reason: "no-repository" };
  } catch (error) {
    const message = (error as Error).message;
    if (/not a git repository/i.test(message)) return first ? undefined : { reason: "no-repository" };
    return { reason: "refused", message };
  }
}

/**
 * One repository serving a workspace.
 *
 * `cwd` and `toplevel` part company only in the ancestor case: a repository whose
 * toplevel lies ABOVE the browser root is still usable, but git must run from the
 * browser root so the `-- .` pathspec keeps its output inside it. For a repository
 * at or under the root the two are the same directory.
 */
export interface GitRepo {
  /** Absolute toplevel of the work tree, as git reports it. */
  toplevel: string;
  /** Directory git commands run in - always the browser root, or a directory under it. */
  cwd: string;
  /** Identity on the wire: browser-root-relative posix path; "" for the root itself or an ancestor. */
  id: string;
}

/**
 * Directories discovery never enters. `.git` is absent on purpose: it is what
 * discovery looks FOR, recognised by name rather than by descending into it.
 */
const DISCOVERY_IGNORED_NAMES = new Set(["node_modules", "dist", "build", ".next", ".turbo", "__pycache__"]);

/**
 * How far below the browser root a repository is still found. A directory of
 * projects is depth 1, a directory of clients each holding projects is 2; four
 * leaves room without turning discovery into a full tree walk.
 */
const MAX_DISCOVERY_DEPTH = 4;

function repoAt(browserRoot: string, toplevel: string): GitRepo {
  // git reports a toplevel with forward slashes on Windows; `resolve` puts it back in
  // the platform's own terms so it can be compared with a path the filesystem gave us
  const native = path.resolve(toplevel);
  const id = isWithin(browserRoot, native) ? path.relative(browserRoot, native).split(path.sep).join("/") : "";
  return { toplevel: native, cwd: id === "" ? browserRoot : native, id };
}

/**
 * Every repository serving a workspace: the one containing the browser root, when
 * there is one, plus every repository whose work tree lies under it. Ordered
 * deepest-first, which is what `repoFor` reads as "longest match".
 *
 * SECURITY: a discovered toplevel becomes a git `cwd`, so it is realpath-resolved
 * and checked against the browser root before it may enter the set - a symlinked
 * directory whose real repository lives outside the root is dropped, and no command
 * is ever spawned in it. Symlinked directories are not descended into at all, as the
 * file browser's own search already declines to.
 */
export async function discoverRepos(root: string): Promise<GitRepo[]> {
  // Canonicalise the root ONCE, and compare everything against that. A caller may
  // hand over a path the filesystem knows by another name - on Windows `%TEMP%` is a
  // short name, `RUNNER~1` for `runneradmin` - and every candidate below is
  // realpath-resolved before the confinement check. Comparing a short root with an
  // expanded child rejects the whole tree and quietly discovers nothing.
  const browserRoot = await realResolve(root);
  const repos: GitRepo[] = [];
  const containing = await probeGit(browserRoot);
  if (containing) repos.push(repoAt(browserRoot, containing.toplevel));

  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable directory is not a reason to fail the whole scan
    }
    // The marker can be a file rather than a directory - a linked work tree or a submodule
    if (entries.some((entry) => entry.name === ".git")) {
      const real = await realResolve(dir);
      if (isWithin(browserRoot, real) && !repos.some((repo) => repo.toplevel === real)) {
        repos.push(repoAt(browserRoot, real));
      }
      // Repositories inside a work tree are its submodules; it already accounts for them
      return;
    }
    if (depth >= MAX_DISCOVERY_DEPTH) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") || DISCOVERY_IGNORED_NAMES.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  };
  await walk(browserRoot, 0);

  repos.sort((a, b) => b.id.length - a.id.length);
  return repos;
}

/**
 * The repository owning a browser-root-relative path, or null when none does.
 *
 * Longest match wins, so a repository nested inside another answers for its own
 * files. `repos` must be ordered deepest-first, as `discoverRepos` returns it: the
 * root-or-ancestor repository has the empty id and therefore sorts last, where it
 * acts as the fallback for everything no nested repository claims.
 */
export function repoFor(repos: readonly GitRepo[], relPath: string): GitRepo | null {
  for (const repo of repos) {
    if (repo.id === "" || relPath === repo.id || relPath.startsWith(`${repo.id}/`)) return repo;
  }
  return null;
}

/** Browser-root-relative path -> relative to the directory git runs in. */
export function toRepoRelative(repo: GitRepo, relPath: string): string {
  return repo.id === "" ? relPath : relPath.slice(repo.id.length + 1);
}

/** The inverse: what git reported, back in the browser-root terms the UI speaks. */
export function toBrowserRelative(repo: GitRepo, repoRel: string): string {
  return repo.id === "" ? repoRel : `${repo.id}/${repoRel}`;
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
  repos: GitRepoStatus[];
  files: GitFileStatus[];
  /** Safe per-repository diagnostics retained when a multi-repository sweep is partial. */
  failures: { repo: string; message: string }[];
  /**
   * Repositories in the set that could not answer, by id.
   *
   * A repository stops being one without touching any directory a client has
   * listed - `rm -rf proj/.git` changes `proj`, which nobody expanded - so the
   * watcher never hears of it. The failure is the more reliable signal: a caller
   * seeing this non-empty knows the set is stale and can go and look again.
   */
  missing: string[];
}

/**
 * One repository's working-tree state, with paths already expressed from the
 * browser root so several repositories' answers merge without further translation.
 *
 * Also the unit of a scoped refresh: a file change names a path, and only the
 * repository owning it has anything new to say.
 */
export async function gitStatusFor(repo: GitRepo): Promise<GitStatusResult> {
  // -uall lists untracked files individually (default -unormal collapses a brand-new
  // directory to one "dir/" entry, leaving the files inside without badges)
  const out = await runGit(repo.cwd, ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "--", "."]);
  const repoStatus: GitRepoStatus = { repo: repo.id, branch: "", ahead: 0, behind: 0 };
  const result: GitStatusResult = { repos: [repoStatus], files: [], missing: [], failures: [] };

  // status paths are relative to the directory git ran in; the `-- .` pathspec already
  // confines entries, the "../" guard is defense in depth
  const push = (gitPath: string, status: GitFileState) => {
    const rel = unquote(gitPath);
    if (rel !== "" && !rel.startsWith("../")) result.files.push({ path: toBrowserRelative(repo, rel), status });
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      repoStatus.branch = line.slice("# branch.head ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        repoStatus.ahead = Number(match[1]);
        repoStatus.behind = Number(match[2]);
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

/** How many repositories are read at once. A directory of projects can hold dozens. */
const STATUS_CONCURRENCY = 4;

/**
 * Working-tree state across every repository serving the workspace.
 *
 * A repository that fails to answer is dropped rather than failing the sweep: one
 * project being mid-rebase, or having just stopped being a repository, is no reason
 * to blank the badges of every other. If they ALL fail the first error surfaces, so
 * a one-repository workspace still reports its errors exactly as it used to.
 */
export async function gitStatus(repos: readonly GitRepo[], scope?: GitRepo): Promise<GitStatusResult> {
  // A scoped read answers "one file moved, whose repository is it in?" without
  // asking the other twenty-nine repositories of a project directory the same thing
  const read = scope === undefined ? repos : [scope];
  const answers: (GitStatusResult | Error)[] = new Array(read.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const repo = read[index];
      if (repo === undefined) return;
      try {
        answers[index] = await gitStatusFor(repo);
      } catch (error) {
        answers[index] = error as Error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(STATUS_CONCURRENCY, read.length) }, worker));

  const ok = answers.filter((answer): answer is GitStatusResult => !(answer instanceof Error));
  if (ok.length === 0) {
    const failure = answers.find((answer): answer is Error => answer instanceof Error);
    if (failure) throw failure;
  }
  const missing = read.filter((_, index) => answers[index] instanceof Error).map((repo) => repo.id);
  const failures = read.flatMap((repo, index) => {
    const answer = answers[index];
    return answer instanceof Error ? [{ repo: repo.id, message: answer.message }] : [];
  });

  // A repository nested inside another appears twice: as itself, and as the single
  // entry its container reports for it - a gitlink, or an untracked directory named
  // with a trailing slash. The nested repository is the one with something to say.
  const nested = new Set(repos.map((repo) => repo.id).filter((id) => id !== ""));
  return {
    repos: ok.flatMap((answer) => answer.repos),
    files: ok.flatMap((answer) => answer.files).filter((file) => !nested.has(file.path.replace(/\/$/, ""))),
    missing,
    failures,
  };
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
export async function gitHeadContent(repo: GitRepo, relPath: string): Promise<string> {
  const toplevelRel = toToplevelRelative(repo.cwd, repo.toplevel, toRepoRelative(repo, relPath));
  try {
    return await runGit(repo.cwd, ["show", `HEAD:${toplevelRel}`]);
  } catch (error) {
    // Only "not in HEAD" means an empty before-side (untracked/added, or an unborn
    // branch); anything else (timeout, output cap) must surface, not fake a full add
    const message = (error as Error).message;
    if (/does not exist in|exists on disk, but not in|invalid object name/i.test(message)) return "";
    throw error;
  }
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export async function gitLog(repo: GitRepo, limit: number): Promise<GitLogEntry[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const out = await runGit(repo.cwd, ["log", "--format=%H%x1f%an%x1f%aI%x1f%s", "-n", String(n), "--", "."]);
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
export async function gitFileLog(repo: GitRepo, relPath: string, limit: number): Promise<GitFileLogEntry[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const raw: RawFileLogEntry[] = [];
  const seen = new Set<string>();
  let rev: string | null = null;
  // Paths stay relative to the directory git runs in for the whole walk - a pathspec
  // is read from there - and return to browser-root terms only in the result below
  let currentPath = toRepoRelative(repo, relPath);

  for (let stitch = 0; stitch <= MAX_STITCHES && raw.length < n; stitch++) {
    const batch = await fullHistoryPass(repo.cwd, rev, currentPath, n - raw.length);
    for (const entry of batch) {
      if (seen.has(entry.sha)) continue;
      seen.add(entry.sha);
      // Normalise here, not at the end: git reports log paths from the repository
      // toplevel, while a pathspec — including the one the next stitch passes — is
      // read from cwd, i.e. the browser root
      raw.push({ ...entry, path: entry.path === "" ? currentPath : toRootRelative(repo.cwd, repo.toplevel, entry.path) });
    }
    const tail = batch[batch.length - 1];
    // Nothing left, no parent to resume from, or the budget is spent
    if (tail === undefined || tail.parents.length === 0 || raw.length >= n) break;
    const source = await renameSourceAt(repo.cwd, repo.toplevel, tail.sha, currentPath);
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
      path: toBrowserRelative(repo, entry.path),
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
export async function gitRevisionContent(repo: GitRepo, rev: string, relPath: string): Promise<string> {
  if (rev === WORKTREE_REVISION) throw new GitError("The working tree is read from disk, not from git");
  if (!SHA_PATTERN.test(rev)) throw new GitError("Invalid commit id");
  const toplevelRel = toToplevelRelative(repo.cwd, repo.toplevel, toRepoRelative(repo, relPath));
  try {
    // ^{commit} peels annotated tags and makes git refuse blob/tree ids
    return await runGit(repo.cwd, ["show", `${rev}^{commit}:${toplevelRel}`]);
  } catch (error) {
    // The file simply not existing at that revision is an empty side, not a failure.
    // Everything else surfaces — notably "dereferences to blob type", which is
    // ^{commit} refusing a blob id and must never read as an empty file.
    const message = (error as Error).message;
    if (/does not exist in|exists on disk, but not in|invalid object name/i.test(message)) return "";
    throw error;
  }
}

export async function gitShow(repo: GitRepo, sha: string): Promise<{ patch: string; truncated: boolean }> {
  if (!SHA_PATTERN.test(sha)) throw new GitError("Invalid commit id");
  // SECURITY: ^{commit} peels annotated tags but makes git refuse blob/tree ids —
  // `show <blob> -- .` would ignore the pathspec and print content outside the root
  const out = await runGit(repo.cwd, ["show", "--format=%h %an %aI%n%s%n", "--patch", `${sha}^{commit}`, "--", "."]);
  const bytes = Buffer.from(out, "utf8");
  if (bytes.byteLength > MAX_PATCH_BYTES) {
    // Byte-accurate cap; strip the replacement char a split code point leaves behind
    return { patch: bytes.subarray(0, MAX_PATCH_BYTES).toString("utf8").replace(/�$/, ""), truncated: true };
  }
  return { patch: out, truncated: false };
}
