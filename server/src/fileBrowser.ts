/**
 * Read-only file-browser backend for the sidebar: lists directories and
 * previews file contents, confined to the same root the agent's own tools
 * can see (SECURITY: reuses sandbox.ts's realResolve/isWithin — never
 * reinvent path confinement here).
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DirEntry } from "@pi-interface/shared";
import type { AppConfig } from "./config.ts";
import { isWithin, realResolve } from "./sandbox.ts";

/** Hard cap for file previews — refused outright above this, never silently truncated. */
export const MAX_PREVIEW_BYTES = 1_048_576; // 1 MiB

export type FileBrowserErrorReason = "outside-root" | "not-found" | "too-large" | "binary" | "denied";

export class FileBrowserError extends Error {
  constructor(
    public readonly reason: FileBrowserErrorReason,
    message: string,
  ) {
    super(message);
  }
}

/** Root the browser is confined to: the file sandbox root if configured, else the agent's cwd. */
export async function resolveBrowserRoot(config: AppConfig): Promise<string> {
  return fs.realpath(config.sandbox?.root ?? config.cwd);
}

/** Resolve a client-supplied relative path against root, rejecting anything that escapes it. */
async function resolveConfined(root: string, relPath: string): Promise<string> {
  const target = path.resolve(root, relPath);
  const resolved = await realResolve(target);
  if (!isWithin(root, resolved)) {
    throw new FileBrowserError("outside-root", `"${relPath}" is outside the browser root`);
  }
  return resolved;
}

function classify(dirent: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }, realType: "file" | "directory" | "other"): DirEntry["type"] {
  if (!dirent.isSymbolicLink()) return realType === "other" ? "other" : realType;
  return realType === "directory" ? "symlink-directory" : realType === "file" ? "symlink-file" : "other";
}

export async function listDirectory(root: string, relPath: string): Promise<DirEntry[]> {
  const resolved = await resolveConfined(root, relPath);
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileBrowserError("not-found", `"${relPath}" does not exist`);
    }
    throw new FileBrowserError("denied", `Cannot read "${relPath}": ${(error as Error).message}`);
  }
  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<DirEntry> => {
      if (!dirent.isSymbolicLink()) {
        return { name: dirent.name, type: dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : "other" };
      }
      // Classify the symlink's target, but never resolve it further for listing —
      // an out-of-root target is still shown (so it isn't silently hidden), just
      // not followed; entering it later goes through resolveConfined again.
      try {
        const stat = await fs.stat(path.join(resolved, dirent.name));
        return { name: dirent.name, type: classify(dirent, stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other") };
      } catch {
        return { name: dirent.name, type: "other" };
      }
    }),
  );
  entries.sort((a, b) => {
    const aDir = a.type === "directory" || a.type === "symlink-directory";
    const bDir = b.type === "directory" || b.type === "symlink-directory";
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}

/** Cheap binary heuristic: presence of a NUL byte (same check git/grep -I use). */
function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export async function readFileForPreview(root: string, relPath: string): Promise<{ content: string; size: number }> {
  const resolved = await resolveConfined(root, relPath);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new FileBrowserError("not-found", `"${relPath}" does not exist`);
  }
  if (!stat.isFile()) {
    throw new FileBrowserError("not-found", `"${relPath}" is not a file`);
  }
  if (stat.size > MAX_PREVIEW_BYTES) {
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    throw new FileBrowserError("too-large", `File is ${mb} MB, larger than the 1 MB preview limit`);
  }
  const buffer = await fs.readFile(resolved);
  if (looksBinary(buffer)) {
    throw new FileBrowserError("binary", "Binary file — preview not supported");
  }
  return { content: buffer.toString("utf8"), size: stat.size };
}
