/**
 * The Files wire messages: listing, reading, writing and arranging files; creating,
 * renaming, moving, copying, deleting and restoring entries, one or many; uploads;
 * opening in the native app; and name and content search. Every path is confined to
 * the workspace's browser root, and writes to its writable root.
 *
 * `index.ts` routes these messages here and owns everything around them. This
 * module never imports the entry point; what it needs from it arrives in the
 * context.
 */
import path from "node:path";
import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@pi-outpost/shared";
import { arrangementPathFor, readArrangement } from "@pi-outpost/shared/structured-exchange/arrangement";
import { readStructuredExchangeDocument } from "@pi-outpost/shared/structured-exchange/document";
import { STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH } from "@pi-outpost/shared/structured-exchange/profile";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { searchContent } from "./contentSearch.ts";
import {
  copyEntryFromBrowser,
  createDirectoryFromBrowser,
  createFileFromBrowser,
  deleteFileFromBrowser,
  FileBrowserError,
  listDirectory,
  moveFileFromBrowser,
  openFileNative,
  readFileForPreview,
  renameFileFromBrowser,
  restoreFromBrowser,
  revealPathNative,
  searchFiles,
  uploadFileFromBrowser,
  writeFileFromBrowser,
} from "./fileBrowser.ts";
import type { Trash } from "./trash.ts";
import type { Workspace } from "./workspace.ts";

export interface FileBrowserMessageContext {
  /** Deliver one message to one socket. */
  send(socket: WebSocket, message: ServerMessage): void;
  /** Deliver one message to every client watching a workspace. */
  broadcast(workspace: Workspace, message: ServerMessage): void;
  /** Where a handler's unexpected rejection goes. */
  reportError(error: unknown): void;
  /** Where deletions from the tree wait to be undone. */
  trash: Trash;
  /** Re-read and announce the project's structured-exchange colours. */
  announceStructuredAppearance(workspace: Workspace): Promise<void>;
  /** The configured size limit of a structured-exchange document read for preview. */
  structuredExchangeMaxBytes(): number;
}

export interface FileBrowserMessageHandlers {
  /** Validate and answer one Files message; malformed ones are dropped, as before. */
  handle(workspace: Workspace, socket: WebSocket, message: ClientMessage): void;
  /** Stop the content search a socket has running: it moved to another project, or closed. */
  abortContentSearch(socket: WebSocket): void;
}

export function createFileBrowserMessageHandlers({
  send,
  broadcast,
  reportError,
  trash,
  announceStructuredAppearance,
  structuredExchangeMaxBytes,
}: FileBrowserMessageContext): FileBrowserMessageHandlers {

  /** File-browser sidebar: list a directory, confined to workspace.browserRoot. */
  async function handleListDirectory(workspace: Workspace, socket: WebSocket, dirPath: string, requestId: string): Promise<void> {
    try {
      const entries = await listDirectory(workspace.browserRoot, dirPath);
      // After a *successful* listing, so "watched" still means exactly "displayed
      // somewhere" — a directory the client was refused is one it is not showing, and
      // watching it would announce changes nobody can act on.
      //
      // But before the reply, and awaited. The client treats the listing as the moment
      // the directory became watched; arming afterwards left a window — one realpath
      // wide, and wider on a loaded host — in which a change made right after opening a
      // folder was never announced at all. That gap is invisible until it isn't: it is
      // what made the watcher tests time out on CI while passing on every developer's
      // machine. Watching stays best-effort, so a failure to arm never turns a good
      // listing into an error.
      await workspace.fileWatcher?.watch(dirPath).catch(() => {});
      send(socket, { type: "directory_listing", requestId, path: dirPath, entries });
    } catch (error) {
      const message = error instanceof FileBrowserError ? error.message : `Unexpected error: ${(error as Error).message}`;
      send(socket, { type: "file_browser_error", requestId, path: dirPath, message });
    }
  }

  /**
   * The reference validator's diagnosis of a file that claims to be a
   * structured-exchange document and is not one.
   *
   * Undefined for everything else, including a document that validates: the field
   * exists to say what is wrong, and "nothing" is said by its absence. The browser
   * decides for itself whether to render — it has its own check — and this only
   * supplies the reason, which its check does not have.
   */
  function documentIssuesFor(content: string): { rule: string; path: string; message: string }[] | undefined {
    const verdict = readStructuredExchangeDocument(content, checkStructuredExchangeSchema);
    if (verdict.status !== "invalid") return undefined;
    return verdict.issues.map((issue) => ({ rule: issue.rule, path: issue.path, message: issue.message }));
  }

  /** File-browser sidebar: read a file for preview, confined to workspace.browserRoot. */
  async function handleReadFile(
    workspace: Workspace,
    socket: WebSocket,
    filePath: string,
    requestId: string,
    /** The digest an artifact link bound its approval to, when the path came from one. */
    expectedDigest?: string,
  ): Promise<void> {
    try {
      // The digest travels into the read rather than being checked beside it: the
      // bytes hashed have to be the bytes served, and the file limit that applies has
      // to be the document's own — a separate raw read charged an artifact the 1 MB
      // preview cap, refusing one the file tree would have opened.
      const { content, size, mtimeMs } = await readFileForPreview(
        workspace.browserRoot,
        filePath,
        structuredExchangeMaxBytes(),
        expectedDigest,
      );
      const documentIssues = documentIssuesFor(content);
      // A file being shown is displayed as surely as a listed directory: its directory is
      // watched too, so a change to it is announced even when nobody expanded the folder —
      // a diagram drawn in a reply, a file opened from a link. Before the reply, as for a
      // listing, and best-effort.
      await workspace.fileWatcher?.watch(filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "").catch(() => {});
      send(socket, {
        type: "file_content",
        requestId,
        path: filePath,
        content,
        size,
        mtimeMs,
        ...(documentIssues === undefined ? {} : { documentIssues }),
      });
    } catch (error) {
      const message = error instanceof FileBrowserError ? error.message : `Unexpected error: ${(error as Error).message}`;
      send(socket, { type: "file_browser_error", requestId, path: filePath, message });
    }
  }

  /** File viewer's editor: save a buffer back, confined to the writable zone. */
  async function handleWriteFile(workspace: Workspace, 
    socket: WebSocket,
    filePath: string,
    content: string,
    expectedMtimeMs: number,
    force: boolean,
    requestId: string,
  ): Promise<void> {
    try {
      const { size, mtimeMs } = await writeFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, content, expectedMtimeMs, force);
      send(socket, { type: "file_written", requestId, path: filePath, size, mtimeMs });
      broadcast(workspace, { type: "file_changed", path: filePath });
      // The project's registry, saved from the viewer: its colours apply now, not at the
      // next document or reload — this is where somebody edits them and looks again.
      if (path.resolve(workspace.browserRoot, filePath) === path.resolve(workspace.root, STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH)) {
        void announceStructuredAppearance(workspace);
      }
    } catch (error) {
      if (error instanceof FileBrowserError) {
        send(socket, { type: "file_browser_error", requestId, path: filePath, message: error.message, reason: error.reason });
      } else {
        send(socket, { type: "file_browser_error", requestId, path: filePath, message: `Unexpected error: ${(error as Error).message}` });
      }
    }
  }

  /**
   * Keep a graph's arrangement beside its document (structured-exchange-arrangement). Only an
   * arrangement is written, only at the arrangement's own path, and through the same confinement
   * as every write from the browser; the document is never touched. The last arrangement kept
   * wins: it is presentation, and a reader moving a box is the newest word on where it goes.
   */
  /**
   * The arrangement saves of each file, in the order they came: one at a time. Two saves of the
   * same arrangement at once each write a temporary file and rename it over the target, and on
   * Windows the second rename fails EPERM while the first replaces the file — run in order, both
   * land and the last one sent is the one on disk.
   */
  const arrangementSaves = new Map<string, Promise<void>>();

  function handleSaveArrangement(workspace: Workspace, socket: WebSocket, documentPath: string, content: string, requestId: string): Promise<void> {
    const key = `${workspace.id}\0${arrangementPathFor(documentPath)}`;
    const previous = arrangementSaves.get(key) ?? Promise.resolve();
    // After the previous one, however it ended: one failed save must not hold back the next.
    const save = previous.catch(() => {}).then(() => saveArrangement(workspace, socket, documentPath, content, requestId));
    arrangementSaves.set(key, save);
    // The last save of a file forgets the chain once it is done, so the map holds only what is in flight.
    void save.finally(() => {
      if (arrangementSaves.get(key) === save) arrangementSaves.delete(key);
    });
    return save;
  }

  async function saveArrangement(workspace: Workspace, socket: WebSocket, documentPath: string, content: string, requestId: string): Promise<void> {
    const target = arrangementPathFor(documentPath);
    try {
      const reading = readArrangement(content);
      if (!reading.ok) throw new FileBrowserError("invalid", `Not an arrangement: ${reading.reason}`);
      try {
        await createFileFromBrowser(workspace.browserRoot, workspace.writableRoot, target);
      } catch (error) {
        // Already there is the usual case; anything else is the write's to report
        if (!(error instanceof FileBrowserError && error.reason === "conflict")) throw error;
      }
      await writeFileFromBrowser(workspace.browserRoot, workspace.writableRoot, target, content, 0, true);
      send(socket, { type: "arrangement_saved", requestId, path: target });
      broadcast(workspace, { type: "file_changed", path: target });
    } catch (error) {
      sendFileBrowserError(socket, requestId, target, error);
    }
  }

  /**
   * Create an empty file. Answered like a write, so the client can open the new
   * file straight into its editor without a second round trip.
   */
  async function handleCreateFile(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
    try {
      const { size, mtimeMs } = await createFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath);
      send(socket, { type: "file_written", requestId, path: filePath, size, mtimeMs });
      broadcast(workspace, { type: "file_changed", path: filePath });
    } catch (error) {
      sendFileBrowserError(socket, requestId, filePath, error);
    }
  }

  /**
   * Create one directory. Answered with its listing — empty, but it tells the tree
   * the directory exists and lets it expand without asking again.
   */
  async function handleCreateDirectory(workspace: Workspace, socket: WebSocket, dirPath: string, requestId: string): Promise<void> {
    try {
      await createDirectoryFromBrowser(workspace.browserRoot, workspace.writableRoot, dirPath);
      const entries = await listDirectory(workspace.browserRoot, dirPath);
      send(socket, { type: "directory_listing", requestId, path: dirPath, entries });
      broadcast(workspace, { type: "file_changed", path: dirPath });
    } catch (error) {
      sendFileBrowserError(socket, requestId, dirPath, error);
    }
  }

  async function handleOpenNative(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
    try {
      await openFileNative(workspace.browserRoot, filePath);
      send(socket, { type: "file_operation_result", requestId, operation: "open_native", path: filePath });
    } catch (error) {
      sendFileBrowserError(socket, requestId, filePath, error);
    }
  }

  async function handleRevealNative(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
    try {
      await revealPathNative(workspace.browserRoot, filePath);
      send(socket, { type: "file_operation_result", requestId, operation: "reveal_native", path: filePath });
    } catch (error) {
      sendFileBrowserError(socket, requestId, filePath, error);
    }
  }

  async function handleRenameFile(workspace: Workspace, socket: WebSocket, filePath: string, name: string, requestId: string): Promise<void> {
    try {
      const renamedPath = await renameFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, name);
      send(socket, { type: "file_operation_result", requestId, operation: "rename_file", path: renamedPath, previousPath: filePath });
      broadcast(workspace, { type: "file_changed", path: filePath });
      broadcast(workspace, { type: "file_changed", path: renamedPath });
    } catch (error) {
      sendFileBrowserError(socket, requestId, filePath, error);
    }
  }

  /** A deletion from the tree goes to the trash, so the tree can offer to undo it. */
  const toTrash = (workspace: Workspace, relPath: string) => (resolved: string) => trash.put(workspace.id, relPath, resolved);

  async function handleDeleteFile(workspace: Workspace, socket: WebSocket, filePath: string, requestId: string): Promise<void> {
    try {
      const restoreToken = await deleteFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, toTrash(workspace, filePath));
      send(socket, { type: "file_operation_result", requestId, operation: "delete_file", path: filePath, ...(restoreToken ? { restoreToken } : {}) });
      broadcast(workspace, { type: "file_changed", path: filePath });
    } catch (error) {
      sendFileBrowserError(socket, requestId, filePath, error);
    }
  }

  async function handleMoveFile(workspace: Workspace, socket: WebSocket, filePath: string, destinationDirectory: string, requestId: string): Promise<void> {
    try {
      const movedPath = await moveFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, destinationDirectory);
      send(socket, { type: "file_operation_result", requestId, operation: "move_file", path: movedPath, previousPath: filePath });
      broadcast(workspace, { type: "file_changed", path: filePath });
      broadcast(workspace, { type: "file_changed", path: movedPath });
    } catch (error) {
      sendFileBrowserError(socket, requestId, filePath, error);
    }
  }

  /**
   * Store a file supplied from outside the workspace. Answered with the path the
   * server wrote — a collision is disambiguated here, so the client cannot assume
   * the name it asked for survived.
   */
  async function handleUploadFile(workspace: Workspace, 
    socket: WebSocket,
    destinationDirectory: string,
    name: string,
    contentBase64: string,
    requestId: string,
    existingDirectory = false,
  ): Promise<void> {
    const requestedPath = destinationDirectory ? `${destinationDirectory}/${name}` : name;
    try {
      const writtenPath = await uploadFileFromBrowser(workspace.browserRoot, workspace.writableRoot, destinationDirectory, name, contentBase64, existingDirectory);
      send(socket, { type: "file_uploaded", requestId, path: writtenPath });
      broadcast(workspace, { type: "file_changed", path: writtenPath });
    } catch (error) {
      sendFileBrowserError(socket, requestId, requestedPath, error);
    }
  }

  async function handleCopyFile(workspace: Workspace, socket: WebSocket, filePath: string, destinationDirectory: string, requestId: string): Promise<void> {
    try {
      const copied = await copyEntryFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, destinationDirectory);
      send(socket, { type: "file_operation_result", requestId, operation: "copy_file", path: copied.path, ...(copied.skipped > 0 ? { skipped: copied.skipped } : {}) });
      broadcast(workspace, { type: "file_changed", path: copied.path });
    } catch (error) {
      sendFileBrowserError(socket, requestId, filePath, error);
    }
  }

  /** A selection is bounded by what a person can click, not by what a socket can carry. */
  const MAX_BATCH_PATHS = 10_000;

  /** The parent of a browser-root-relative path ("" for a top-level entry). */
  function parentOf(relPath: string): string {
    return relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  }

  /**
   * Several entries deleted, or moved into one directory, in one request. Each goes
   * through the single-entry helper, so every rule is the same; a refusal is recorded
   * and the next path goes on — nothing is rolled back. A path under another one in
   * the request is dropped first: deleting a folder already deletes its content, and
   * moving it already moves it. One `file_changed` per affected directory follows.
   */
  async function handleFileBatch(
    workspace: Workspace,
    socket: WebSocket,
    action: { operation: "delete_file" } | { operation: "move_file"; destinationDirectory: string },
    paths: string[],
    requestId: string,
  ): Promise<void> {
    const unique = [...new Set(paths)];
    const outermost = unique.filter((candidate) => !unique.some((other) => other !== candidate && (other === "" || candidate.startsWith(`${other}/`))));
    const done: { path: string; resultPath: string; restoreToken?: string }[] = [];
    const refused: { path: string; message: string; reason?: FileBrowserError["reason"] }[] = [];
    for (const filePath of outermost) {
      try {
        if (action.operation === "delete_file") {
          const restoreToken = await deleteFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, toTrash(workspace, filePath));
          done.push({ path: filePath, resultPath: filePath, ...(restoreToken ? { restoreToken } : {}) });
        } else {
          done.push({ path: filePath, resultPath: await moveFileFromBrowser(workspace.browserRoot, workspace.writableRoot, filePath, action.destinationDirectory) });
        }
      } catch (error) {
        if (!(error instanceof FileBrowserError)) throw error;
        refused.push({ path: filePath, message: error.message, reason: error.reason });
      }
    }
    send(socket, { type: "file_batch_result", requestId, operation: action.operation, done, refused });
    // `file_changed` re-lists the parent of the path it names: one path per directory touched.
    const byDirectory = new Map<string, string>();
    for (const { path: source, resultPath } of done) {
      if (!byDirectory.has(parentOf(source))) byDirectory.set(parentOf(source), source);
      if (!byDirectory.has(parentOf(resultPath))) byDirectory.set(parentOf(resultPath), resultPath);
    }
    for (const changed of byDirectory.values()) broadcast(workspace, { type: "file_changed", path: changed });
  }

  /**
   * Put deleted entries back from the trash. A token restores once, and only into the
   * workspace it was deleted from; one that fails to restore — its place taken since,
   * its folder gone — stays in the trash, so a later attempt can still succeed.
   */
  async function handleRestoreDeleted(workspace: Workspace, socket: WebSocket, tokens: string[], requestId: string): Promise<void> {
    const done: { path: string; resultPath: string }[] = [];
    const refused: { path: string; message: string; reason?: FileBrowserError["reason"] }[] = [];
    for (const token of new Set(tokens)) {
      const entry = trash.take(token, workspace.id);
      if (!entry) {
        refused.push({ path: "", message: "Nothing to restore: it is no longer in the trash", reason: "not-found" });
        continue;
      }
      try {
        await restoreFromBrowser(workspace.browserRoot, workspace.writableRoot, entry.relPath, entry.trashed);
        await trash.discard(entry);
        done.push({ path: entry.relPath, resultPath: entry.relPath });
      } catch (error) {
        trash.giveBack(entry);
        if (!(error instanceof FileBrowserError)) throw error;
        refused.push({ path: entry.relPath, message: error.message, reason: error.reason });
      }
    }
    send(socket, { type: "file_batch_result", requestId, operation: "restore_deleted", done, refused });
    const byDirectory = new Map<string, string>();
    for (const { path: restored } of done) if (!byDirectory.has(parentOf(restored))) byDirectory.set(parentOf(restored), restored);
    for (const changed of byDirectory.values()) broadcast(workspace, { type: "file_changed", path: changed });
  }

  function sendFileBrowserError(socket: WebSocket, requestId: string, targetPath: string, error: unknown): void {
    if (error instanceof FileBrowserError) {
      send(socket, { type: "file_browser_error", requestId, path: targetPath, message: error.message, reason: error.reason });
    } else {
      send(socket, { type: "file_browser_error", requestId, path: targetPath, message: `Unexpected error: ${(error as Error).message}` });
    }
  }

  /** Composer's `@` mention autocomplete: recursive name search, confined to workspace.browserRoot. */
  async function handleSearchFiles(workspace: Workspace, socket: WebSocket, query: string, requestId: string): Promise<void> {
    const results = await searchFiles(workspace.browserRoot, query);
    send(socket, { type: "file_search_results", requestId, query, results });
  }

  /**
   * The content search each socket has running. One at a time: a newer query, a switch of
   * project and a closed socket all abort it, and an aborted search sends no answer.
   */
  const contentSearches = new WeakMap<WebSocket, AbortController>();

  function abortContentSearch(socket: WebSocket): void {
    contentSearches.get(socket)?.abort();
    contentSearches.delete(socket);
  }

  /** Files → Search in files: literal search of file contents, confined to workspace.browserRoot. */
  async function handleSearchContent(workspace: Workspace, socket: WebSocket, query: string, requestId: string): Promise<void> {
    abortContentSearch(socket);
    const controller = new AbortController();
    contentSearches.set(socket, controller);
    try {
      const { hits, truncated, skipped } = await searchContent(workspace.browserRoot, query, { signal: controller.signal });
      if (controller.signal.aborted) return;
      send(socket, { type: "content_search_results", requestId, query, hits, truncated, skipped });
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    } finally {
      if (contentSearches.get(socket) === controller) contentSearches.delete(socket);
    }
  }

  function handle(workspace: Workspace, socket: WebSocket, message: ClientMessage): void {
    switch (message.type) {
      case "list_directory":
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        handleListDirectory(workspace, socket, message.path, message.requestId).catch(reportError);
        break;
      case "read_file": {
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        // A digest only means something in the shape the contract publishes. Anything
        // else is dropped rather than compared: a malformed one would never match, and
        // refusing every read against it would look like a corrupt file.
        const expected = typeof message.sha256 === "string" && /^sha256:[0-9a-f]{64}$/.test(message.sha256)
          ? message.sha256
          : undefined;
        handleReadFile(workspace, socket, message.path, message.requestId, expected).catch(reportError);
        break;
      }
      case "write_file":
        if (
          typeof message.path !== "string" ||
          typeof message.content !== "string" ||
          typeof message.expectedMtimeMs !== "number" ||
          typeof message.requestId !== "string"
        ) {
          return;
        }
        handleWriteFile(workspace, socket, message.path, message.content, message.expectedMtimeMs, message.force === true, message.requestId).catch(
          reportError,
        );
        break;
      case "save_arrangement":
        if (typeof message.documentPath !== "string" || typeof message.content !== "string" || typeof message.requestId !== "string") return;
        handleSaveArrangement(workspace, socket, message.documentPath, message.content, message.requestId).catch(reportError);
        break;
      case "create_file":
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        handleCreateFile(workspace, socket, message.path, message.requestId).catch(reportError);
        break;
      case "create_directory":
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        handleCreateDirectory(workspace, socket, message.path, message.requestId).catch(reportError);
        break;
      case "upload_file":
        if (
          typeof message.destinationDirectory !== "string" ||
          typeof message.name !== "string" ||
          typeof message.contentBase64 !== "string" ||
          (message.existingDirectory !== undefined && typeof message.existingDirectory !== "boolean") ||
          typeof message.requestId !== "string"
        ) {
          return;
        }
        if (message.existingDirectory === true && message.workspaceId !== workspace.id) {
          sendFileBrowserError(socket, message.requestId, message.destinationDirectory, new FileBrowserError("denied", "The active workspace changed; drop the files again"));
          break;
        }
        handleUploadFile(workspace, socket, message.destinationDirectory, message.name, message.contentBase64, message.requestId, message.existingDirectory === true).catch(reportError);
        break;
      case "open_native":
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        handleOpenNative(workspace, socket, message.path, message.requestId).catch(reportError);
        break;
      case "reveal_native":
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        handleRevealNative(workspace, socket, message.path, message.requestId).catch(reportError);
        break;
      case "rename_file":
        if (typeof message.path !== "string" || typeof message.name !== "string" || typeof message.requestId !== "string") return;
        handleRenameFile(workspace, socket, message.path, message.name, message.requestId).catch(reportError);
        break;
      case "delete_file":
        if (typeof message.path !== "string" || typeof message.requestId !== "string") return;
        handleDeleteFile(workspace, socket, message.path, message.requestId).catch(reportError);
        break;
      case "move_file":
        if (
          typeof message.path !== "string" ||
          typeof message.destinationDirectory !== "string" ||
          typeof message.requestId !== "string"
        ) {
          return;
        }
        handleMoveFile(workspace, socket, message.path, message.destinationDirectory, message.requestId).catch(reportError);
        break;
      case "copy_file":
        if (
          typeof message.path !== "string" ||
          typeof message.destinationDirectory !== "string" ||
          typeof message.requestId !== "string"
        ) {
          return;
        }
        handleCopyFile(workspace, socket, message.path, message.destinationDirectory, message.requestId).catch(reportError);
        break;
      case "restore_deleted": {
        const tokens = message.tokens as unknown;
        if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > MAX_BATCH_PATHS || !tokens.every((token) => typeof token === "string") || typeof message.requestId !== "string") {
          return;
        }
        handleRestoreDeleted(workspace, socket, tokens as string[], message.requestId).catch(reportError);
        break;
      }
      case "delete_files":
      case "move_files": {
        const paths = message.paths as unknown;
        if (
          !Array.isArray(paths) ||
          paths.length === 0 ||
          paths.length > MAX_BATCH_PATHS ||
          !paths.every((entry) => typeof entry === "string") ||
          typeof message.requestId !== "string" ||
          (message.type === "move_files" && typeof message.destinationDirectory !== "string")
        ) {
          return;
        }
        handleFileBatch(
          workspace,
          socket,
          message.type === "delete_files" ? { operation: "delete_file" } : { operation: "move_file", destinationDirectory: message.destinationDirectory },
          paths as string[],
          message.requestId,
        ).catch(reportError);
        break;
      }
      case "search_files":
        if (typeof message.query !== "string" || typeof message.requestId !== "string") return;
        handleSearchFiles(workspace, socket, message.query, message.requestId).catch(reportError);
        break;
      case "search_content":
        if (typeof message.query !== "string" || typeof message.requestId !== "string") return;
        handleSearchContent(workspace, socket, message.query, message.requestId).catch(reportError);
        break;
    }
  }

  return { handle, abortContentSearch };
}
