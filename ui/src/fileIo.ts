import type { FileBrowserErrorReason, FileSearchEntry } from "@pi-outpost/shared";

/**
 * Reading and writing one workspace file for a caller that is not the file viewer.
 *
 * The viewer's own read and save go through the reducer, because the viewer *is* that
 * state. A diagram drawn in a reply is not the open file, and its touch-up needs an
 * answer — the text and its modification time, then whether the save landed — rather
 * than a state update about some other file. Same messages, same guards on the server:
 * `write_file` refuses a file whose modification time moved (`reason: "conflict"`).
 */
export interface FileIo {
  read(path: string): Promise<{ content: string; mtimeMs: number }>;
  write(path: string, content: string, expectedMtimeMs: number): Promise<{ mtimeMs: number }>;
  /** Called when the watcher reports `path` changed, or its directory did. Returns an unsubscribe. */
  onChanged(path: string, listener: () => void): () => void;
  /**
   * Paths under the browser root whose path holds `query`, case-insensitively, shortest first
   * and capped (the server's `search_files`). Absent where nothing can search the project.
   */
  find?(query: string): Promise<FileSearchEntry[]>;
}

/** A refused or failed read or write, carrying the server's machine-readable reason. */
export class FileIoError extends Error {
  readonly reason?: FileBrowserErrorReason;

  constructor(message: string, reason?: FileBrowserErrorReason) {
    super(message);
    this.name = "FileIoError";
    this.reason = reason;
  }
}
