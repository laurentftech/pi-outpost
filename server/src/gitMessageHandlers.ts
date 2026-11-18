/**
 * The git wire messages: status (whole or changes since the last answer), the
 * worktree diff of a file, a repository's log, one commit, a file's history and a
 * two-point file diff. Read-only, and confined to the workspace's browser root.
 *
 * `index.ts` routes these messages here and owns everything around them: which
 * workspace a socket is bound to, and how a message reaches it. This module never
 * imports the entry point; what it needs from it arrives in the context.
 */
import type { WebSocket } from "ws";
import { type ClientMessage, type GitRevision, type ServerMessage, WORKTREE_REVISION } from "@pi-outpost/shared";
import { assertWithinRoot, FileBrowserError, MAX_PREVIEW_BYTES, readFileForPreview } from "./fileBrowser.ts";
import {
  GitError,
  gitFileLog,
  gitHeadContent,
  gitLog,
  gitRevisionContent,
  gitShow,
  gitStatus,
  repoFor,
  type GitRepo,
} from "./git.ts";
import { canAnswerWithChanges, recordChanges, recordFull, type SentStatus } from "./gitStatusDelta.ts";
import type { Workspace } from "./workspace.ts";

export interface GitMessageContext {
  /** Deliver one message to one socket. */
  send(socket: WebSocket, message: ServerMessage): void;
  /** The workspace a socket is bound to now, which may differ from the one a request started on. */
  boundWorkspace(socket: WebSocket): Workspace | undefined;
  /** Where a handler's unexpected rejection goes. */
  reportError(error: unknown): void;
}

export interface GitMessageHandlers {
  /** Validate and answer one git message; malformed ones are dropped, as before. */
  handle(workspace: Workspace, socket: WebSocket, message: ClientMessage): void;
}

export function createGitMessageHandlers({ send, boundWorkspace, reportError }: GitMessageContext): GitMessageHandlers {


  function gitErrorMessage(error: unknown): string {
    return error instanceof GitError || error instanceof FileBrowserError
      ? error.message
      : `Unexpected error: ${(error as Error).message}`;
  }

  /**
   * The repository owning a path.
   *
   * A file under no repository is not an error of the client's making — a workspace
   * can hold both versioned projects and loose notes — but it has no HEAD, no history
   * and no branch, so a request naming one has nothing to answer with.
   */
  function repoForPath(workspace: Workspace, relPath: string): GitRepo {
    const repo = repoFor(workspace.repos, relPath);
    if (repo === null) throw new GitError(`"${relPath}" is not in a git repository`);
    return repo;
  }

  /**
   * The repository a client named, by the same id `git_status` reported it under.
   *
   * Never falls back to another: a commit id from one repository resolved against a
   * second would answer with somebody else's history, and silently.
   */
  function repoById(workspace: Workspace, id: string): GitRepo {
    const repo = workspace.repos.find((candidate) => candidate.id === id);
    if (repo === undefined) throw new GitError(`No repository at "${id === "" ? "." : id}"`);
    return repo;
  }

  /** Per connection, the status it was last sent: released with the socket. */
  const sentGitStatus = new WeakMap<WebSocket, SentStatus>();

  async function handleGitStatus(
    workspace: Workspace,
    socket: WebSocket,
    scope: string | undefined,
    requestId: string,
    base: number | undefined,
  ): Promise<void> {
    if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
    try {
      // Only a client holding what this connection was last sent can be answered with
      // the difference; anyone else gets a full sweep, whatever scope it asked for, so
      // a scoped answer never lands on a state the server does not know.
      const held = sentGitStatus.get(socket);
      const changes = canAnswerWithChanges(held, workspace, base);
      const sweepScope = changes ? scope : undefined;
      const { repos, files, missing } = await gitStatus(workspace.repos, sweepScope === undefined ? undefined : repoById(workspace, sweepScope));
      // The connection moved to another project while git ran: this answer describes
      // the one it left, and would badge the new tree with the old one's files. The
      // request is still owed an answer - the client asks nothing more until it has
      // one - so it gets the project it is on now, in full.
      const current = boundWorkspace(socket);
      if (current !== undefined && current !== workspace) {
        if (current.repos.length > 0) return handleGitStatus(current, socket, undefined, requestId, undefined);
        const { next, answer } = recordFull(sentGitStatus.get(socket), current, [], () => "");
        sentGitStatus.set(socket, next);
        return send(socket, { type: "git_status", requestId, repos: [], files: [], version: answer.version });
      }
      // Read again: another answer may have reached this connection while git ran. A
      // client that named a version holds every answer sent since, in order, so the
      // difference is taken against the latest - still this project's.
      const now = sentGitStatus.get(socket);
      const repoOf = (path: string) => repoFor(workspace.repos, path)?.id ?? "";
      if (changes && now !== undefined && now.owner === workspace) {
        const { next, answer } = recordChanges(now, files, sweepScope, repoOf);
        sentGitStatus.set(socket, next);
        send(socket, {
          type: "git_status",
          requestId,
          ...(sweepScope === undefined ? {} : { repo: sweepScope }),
          repos,
          files: answer.files,
          version: answer.version,
          base: answer.base,
          removed: answer.removed,
        });
      } else if (sweepScope !== undefined) {
        // A scoped sweep, but what this connection was last sent is another project's
        // (it went there and came back): only a full answer is safe now.
        return handleGitStatus(workspace, socket, scope, requestId, undefined);
      } else {
        const { next, answer } = recordFull(now, workspace, files, repoOf);
        sentGitStatus.set(socket, next);
        send(socket, { type: "git_status", requestId, repos, files, version: answer.version });
      }
      // A repository that cannot answer has usually stopped being one, and did so
      // without touching a directory any client had listed - `rm -rf proj/.git` changes
      // `proj`, which nobody expanded, so the watcher heard nothing at all. Look again,
      // and announce it if the set really did change.
      if (missing.length > 0) void workspace.rediscoverRepos();
    } catch (error) {
      send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
      // The same signal, from the other side: a sweep where EVERY repository failed
      // throws rather than returning, and a workspace down to its last repository
      // reaches exactly that path when it loses it.
      void workspace.rediscoverRepos();
    }
  }

  /** Worktree-vs-HEAD contents of one file; missing sides (untracked/deleted) are "". */
  async function handleGitDiff(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
    if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
    try {
      let after = "";
      try {
        after = (await readFileForPreview(workspace.browserRoot, filePath)).content;
      } catch (error) {
        // A deleted file legitimately has no worktree side; confinement/size/binary still refuse
        if (!(error instanceof FileBrowserError) || error.reason !== "not-found") throw error;
      }
      const before = await gitHeadContent(repoForPath(workspace, filePath), filePath);
      if (before.includes("\0")) throw new FileBrowserError("binary", "Binary file — diff not supported");
      if (Buffer.byteLength(before, "utf8") > 1_048_576) {
        throw new FileBrowserError("too-large", "HEAD version is larger than the 1 MB limit");
      }
      send(socket, { type: "git_diff", requestId, path: filePath, before, after });
    } catch (error) {
      send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
    }
  }

  async function handleGitLog(workspace: Workspace, socket: WebSocket, repo: string, limit: number, requestId: string): Promise<void> {
    if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
    try {
      send(socket, { type: "git_log", requestId, repo, entries: await gitLog(repoById(workspace, repo), limit) });
    } catch (error) {
      send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
    }
  }

  function isGitRevision(value: unknown): value is GitRevision {
    const revision = value as GitRevision | undefined;
    return typeof revision?.rev === "string" && typeof revision.path === "string";
  }

  /** Commits touching one file, for the history graph. */
  async function handleGitFileLog(workspace: Workspace, socket: WebSocket, filePath: string, limit: number, requestId: string): Promise<void> {
    if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
    try {
      // Confine before spawning: this path goes straight into a pathspec. Only
      // confinement applies — a deleted or oversized file still has a history.
      await assertWithinRoot(workspace.browserRoot, filePath);
      const entries = await gitFileLog(repoForPath(workspace, filePath), filePath, limit);
      send(socket, { type: "git_file_log", requestId, path: filePath, entries });
    } catch (error) {
      send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
    }
  }

  /**
   * One side of a two-point file diff. The working tree is read from disk; every
   * other revision goes through git. Both sides obey the file browser's confinement
   * and its size and binary limits, so a pair can never smuggle out an oversized
   * blob or a path outside the browser root.
   */
  async function readRevisionSide(workspace: Workspace, revision: GitRevision): Promise<string> {
    if (revision.rev === WORKTREE_REVISION) {
      try {
        return (await readFileForPreview(workspace.browserRoot, revision.path)).content;
      } catch (error) {
        // A file deleted since that commit legitimately has no worktree side
        if (error instanceof FileBrowserError && error.reason === "not-found") return "";
        throw error;
      }
    }
    // Confine before spawning: the path becomes part of a `<rev>:<path>` argument
    await assertWithinRoot(workspace.browserRoot, revision.path);
    const content = await gitRevisionContent(repoForPath(workspace, revision.path), revision.rev, revision.path);
    if (content.includes("\0")) throw new FileBrowserError("binary", "Binary file — diff not supported");
    if (Buffer.byteLength(content, "utf8") > MAX_PREVIEW_BYTES) {
      throw new FileBrowserError("too-large", `${revision.rev.slice(0, 7)} is larger than the 1 MB limit`);
    }
    return content;
  }

  async function handleGitFileDiff(workspace: Workspace, socket: WebSocket, base: GitRevision, target: GitRevision, requestId: string): Promise<void> {
    if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
    try {
      const [beforeText, afterText] = await Promise.all([readRevisionSide(workspace, base), readRevisionSide(workspace, target)]);
      send(socket, { type: "git_file_diff", requestId, base, target, beforeText, afterText });
    } catch (error) {
      send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
    }
  }

  async function handleGitShow(workspace: Workspace, socket: WebSocket, repo: string, sha: string, requestId: string): Promise<void> {
    if (workspace.repos.length === 0) return send(socket, { type: "git_error", requestId, message: "git is not available" });
    try {
      const { patch, truncated } = await gitShow(repoById(workspace, repo), sha);
      send(socket, { type: "git_show", requestId, sha, patch, truncated });
    } catch (error) {
      send(socket, { type: "git_error", requestId, message: gitErrorMessage(error) });
    }
  }

  function handle(workspace: Workspace, socket: WebSocket, message: ClientMessage): void {
    switch (message.type) {
      case "git_status":
        if (typeof message.requestId !== "string") return;
        if (message.repo !== undefined && typeof message.repo !== "string") return;
        handleGitStatus(
          workspace,
          socket,
          message.repo,
          message.requestId,
          Number.isSafeInteger(message.base) ? message.base : undefined,
        ).catch(reportError);
        break;
      case "git_diff":
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        handleGitDiff(workspace, socket, message.path, message.requestId).catch(reportError);
        break;
      case "git_log":
        if (typeof message.requestId !== "string" || typeof message.repo !== "string") return;
        if (message.limit !== undefined && typeof message.limit !== "number") return;
        handleGitLog(workspace, socket, message.repo, message.limit ?? 30, message.requestId).catch(reportError);
        break;
      case "git_show":
        if (typeof message.sha !== "string" || typeof message.requestId !== "string") return;
        if (typeof message.repo !== "string") return;
        handleGitShow(workspace, socket, message.repo, message.sha, message.requestId).catch(reportError);
        break;
      case "git_file_log":
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        if (message.limit !== undefined && typeof message.limit !== "number") return;
        handleGitFileLog(workspace, socket, message.path, message.limit ?? 100, message.requestId).catch(reportError);
        break;
      case "git_file_diff":
        if (typeof message.requestId !== "string") return;
        if (!isGitRevision(message.base) || !isGitRevision(message.target)) return;
        handleGitFileDiff(workspace, socket, message.base, message.target, message.requestId).catch(reportError);
        break;
    }
  }

  return { handle };
}
