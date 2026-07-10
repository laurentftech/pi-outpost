/**
 * Read-only file-browser backend for the sidebar: lists directories and
 * previews file contents, confined to the same root the agent's own tools
 * can see (SECURITY: reuses sandbox.ts's realResolve/isWithin — never
 * reinvent path confinement here).
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DirEntry, FileSearchEntry } from "@pi-outpost/shared";
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

/**
 * Writable zone the browser should highlight, relative to `browserRoot` (posix
 * separators): undefined when no sandbox is configured, null when the sandbox
 * is entirely read-only, or the writable subtree's path ("" = the whole root).
 */
export async function resolveWritableRoot(config: AppConfig, browserRoot: string): Promise<string | null | undefined> {
  if (!config.sandbox) return undefined;
  if (!config.sandbox.allowWrite) return null;
  const target = config.sandbox.writableRoot ? await fs.realpath(config.sandbox.writableRoot) : browserRoot;
  return path.relative(browserRoot, target).split(path.sep).join("/");
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

const SEARCH_IGNORED_NAMES = new Set(["node_modules", "dist", "build", ".git", ".next", ".turbo", "__pycache__"]);
/** Guard against pathologically large trees — this is a UI convenience, not a full index. */
const SEARCH_MAX_VISITED = 20_000;

/**
 * Recursively search file/directory names under `root` for `query` (case-insensitive
 * substring match against the relative path). Powers the composer's `@` mention
 * autocomplete — best-effort and capped, not a full-text or fuzzy search. Skips
 * dotfiles, common build/dependency directories, and symlinks (avoids cycles).
 */
export async function searchFiles(root: string, query: string, limit = 20): Promise<FileSearchEntry[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: FileSearchEntry[] = [];
  let visited = 0;

  async function walk(dir: string, relDir: string): Promise<void> {
    if (results.length >= limit || visited >= SEARCH_MAX_VISITED) return;
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (results.length >= limit || visited >= SEARCH_MAX_VISITED) return;
      visited++;
      if (dirent.isSymbolicLink() || dirent.name.startsWith(".") || SEARCH_IGNORED_NAMES.has(dirent.name)) continue;
      const relPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      const isDirectory = dirent.isDirectory();
      if (relPath.toLowerCase().includes(q)) {
        results.push({ path: relPath, type: isDirectory ? "directory" : dirent.isFile() ? "file" : "other" });
      }
      if (isDirectory) {
        await walk(path.join(dir, dirent.name), relPath);
      }
    }
  }

  await walk(root, "");
  results.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
  return results.slice(0, limit);
}
