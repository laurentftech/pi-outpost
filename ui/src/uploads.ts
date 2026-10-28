/**
 * Getting a file that lives outside the workspace into the agent's reach.
 *
 * A file dragged from the desktop has no path inside the workspace, so there is
 * nothing for an `@path` reference to point at. Copying it in gives it one — and
 * a PDF then costs the prompt a filename instead of a megabyte.
 */
import type { FileBrowserErrorReason } from "@pi-outpost/shared";

/**
 * Where attachment copies land, relative to the writable root. A file attached to the conversation is not a
 * statement about where in the project it belongs, so it goes somewhere
 * predictable rather than into whichever directory the tree happens to show.
 * Tree imports explicitly choose an existing folder instead.
 *
 * Not dot-prefixed on purpose: file search skips `.`-prefixed entries, and a file
 * the agent is meant to find should be findable.
 */
export const UPLOADS_DIRECTORY = "uploads";

/**
 * Largest file the workspace will take, in raw bytes. Must match
 * `MAX_UPLOAD_BYTES` in `server/src/fileBrowser.ts`, which is the authority —
 * this copy exists so an oversized file is refused before the browser spends a
 * 34 MB send finding out.
 *
 * The value tracks the path-based extraction tools' own limits: a document the
 * agent could read must be one the upload accepts.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** A refused or failed upload, carrying the server's machine-readable reason. */
export class UploadError extends Error {
  readonly reason?: FileBrowserErrorReason;

  constructor(message: string, reason?: FileBrowserErrorReason) {
    super(message);
    this.name = "UploadError";
    this.reason = reason;
  }
}

/** Ends a batch whose destination no longer belongs to the active workspace. */
export class UploadContextChangedError extends UploadError {
  constructor() {
    super("The workspace changed before the import finished");
    this.name = "UploadContextChangedError";
  }
}

/**
 * Copies one file into the workspace and resolves with the path actually
 * written — which is not always the name asked for, since the server
 * disambiguates a collision. Injected rather than imported by the attachment
 * builder, so its unit tests keep running without a socket.
 */
export type UploadFile = (name: string, contentBase64: string) => Promise<string>;

/** Read a tree import without the composer's MIME classification or text inlining. */
export function readUploadFile(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) return Promise.reject(new UploadError("Files are limited to 25 MB", "too-large"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(new UploadError("The file could not be read"));
    reader.onabort = () => reject(new UploadError("Reading the file was cancelled"));
    reader.readAsDataURL(file);
  });
}
