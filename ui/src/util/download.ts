/**
 * Handing the browser a file to keep.
 *
 * One place, rather than a copy per export. The two callers — a table leaving as
 * CSV or a workbook, a document leaving as Word — differ in what they build and
 * not at all in how they hand it over, and a second copy of these six lines is
 * how the one that revokes its url and the one that forgets drift apart.
 */
export function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Not leaked: a blob url held for the life of the page holds the file with it.
  URL.revokeObjectURL(url);
}

/*
 * Workspace entries, through the server's `/files/download`: the only way to take
 * a file off a remote server onto the machine the browser runs on.
 */

export interface DownloadConnection {
  /** Backend origin for the embed widget, "" when same-origin. */
  serverUrl: string;
  token: string | null;
  /** The project the paths are relative to — see `rawFileWorkspace`. */
  workspace?: string;
}

/** URL of `/files/download` for these browser-root-relative paths; the token rides the query string, as for `/files/raw`. */
export function downloadUrl(connection: DownloadConnection, paths: readonly string[]): string {
  const params = paths.map((path) => `path=${encodeURIComponent(path)}`);
  if (connection.token) params.push(`token=${encodeURIComponent(connection.token)}`);
  if (connection.workspace !== undefined) params.push(`workspace=${encodeURIComponent(connection.workspace)}`);
  return `${connection.serverUrl}/files/download?${params.join("&")}`;
}

/** The server said no (too large, gone, refused); `message` is what to show. */
export class DownloadRefusedError extends Error {}

/** The name a `Content-Disposition` gives, `filename*` (exact) over `filename` (ASCII fallback). */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename="([^"]*)"/i.exec(header);
  return plain ? plain[1] : null;
}

export interface DownloadDeps {
  fetch: typeof fetch;
  document: Document;
  /** Hands a fetched archive to the browser: `save` above, unless a test says otherwise. */
  save: (blob: Blob, fileName: string) => void;
}

const browserDeps = (): DownloadDeps => ({ fetch: (...args) => fetch(...args), document, save });

/**
 * Download one file as itself, or a folder or several entries as one archive.
 *
 * A single file is handed straight to the browser: the response is the file, and a
 * download manager shows its progress. An archive is fetched first, so a refusal —
 * an archive past its limits, above all — comes back as a message for the tree
 * rather than as a saved file holding an error; it is then saved from memory.
 * Resolves with how many entries the archive left out (0 for a file).
 */
export async function downloadEntries(
  connection: DownloadConnection,
  paths: readonly string[],
  options: { singleFile: boolean },
  deps: DownloadDeps = browserDeps(),
): Promise<{ skipped: number }> {
  if (paths.length === 0) return { skipped: 0 };
  const url = downloadUrl(connection, paths);
  if (options.singleFile && paths.length === 1) {
    const anchor = deps.document.createElement("a");
    anchor.href = url;
    // Ignored cross-origin (the embed); the server's attachment disposition saves it anyway.
    anchor.download = paths[0].split("/").pop() ?? "";
    anchor.rel = "noopener";
    anchor.click();
    return { skipped: 0 };
  }
  const response = await deps.fetch(url);
  if (!response.ok) {
    let message = `The download failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: unknown; error?: unknown };
      if (typeof body.message === "string") message = body.message;
      else if (typeof body.error === "string") message = `The download failed: ${body.error}`;
    } catch {
      // not JSON: keep the status
    }
    throw new DownloadRefusedError(message);
  }
  const skipped = Number(response.headers.get("X-Pi-Outpost-Skipped") ?? "0") || 0;
  const name = dispositionName(response.headers.get("Content-Disposition")) ?? "files.zip";
  deps.save(await response.blob(), name);
  return { skipped };
}
