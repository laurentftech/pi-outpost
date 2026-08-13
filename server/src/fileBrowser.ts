/**
 * File-browser backend for the sidebar: lists directories, previews file
 * contents, and saves editor buffers back, confined to the same root the
 * agent's own tools can see — writes further confined to the writable zone
 * (SECURITY: reuses sandbox.ts's realResolve/isWithin — never reinvent path
 * confinement here).
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DirEntry, FileBrowserErrorReason, FileSearchEntry } from "@pi-outpost/shared";
import type { AppConfig } from "./config.ts";
import { isWithin, realResolve } from "./sandbox.ts";

/** Hard cap for file previews — refused outright above this, never silently truncated. */
export const MAX_PREVIEW_BYTES = 1_048_576; // 1 MiB

/** A PDF is never previewed as text, so the preview cap says nothing useful about it. */
export function isPdfPath(relPath: string): boolean {
  return path.extname(relPath).toLowerCase() === ".pdf";
}

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

/**
 * Confinement on its own, for paths that need not exist on disk — a file's path
 * at an old commit, or one that has since been deleted. `realResolve` keeps a
 * non-existent tail, so the check still follows symlinks in the part that does
 * exist and cannot be walked out of the root by a link.
 */
export async function assertWithinRoot(root: string, relPath: string): Promise<void> {
  await resolveConfined(root, relPath);
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

export async function readFileForPreview(
  root: string,
  relPath: string,
): Promise<{ content: string; size: number; mtimeMs: number }> {
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
  return { content: buffer.toString("utf8"), size: stat.size, mtimeMs: stat.mtimeMs };
}

/**
 * Raw bytes for the HTTP `/files/raw` endpoint — inline images in the chat, and
 * the bytes the PDF viewer renders. Same confinement as previews; binary is fine
 * here — deciding what's safe to *serve* (content type, disposition) is the
 * route's job.
 *
 * The size cap depends on the file's type: a PDF is measured against
 * `pdfMaxBytes`, which is the whole point — most real PDFs exceed the 1 MB
 * preview limit that governs everything else.
 */
export async function readFileRaw(
  root: string,
  relPath: string,
  pdfMaxBytes = MAX_PREVIEW_BYTES,
): Promise<Buffer> {
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
  const limit = isPdfPath(relPath) ? pdfMaxBytes : MAX_PREVIEW_BYTES;
  if (stat.size > limit) {
    const mb = (limit / (1024 * 1024)).toFixed(0);
    throw new FileBrowserError("too-large", `File is larger than the ${mb} MB limit`);
  }
  return fs.readFile(resolved);
}

/**
 * The last segment of a path the user typed is a *name*, not a route.
 *
 * `resolveConfined` already refuses an escape, so this is belt and braces — but a
 * separator in a name is a specific mistake and deserves to be named as one
 * rather than reported as a confinement refusal.
 */
export function assertCreatableName(relPath: string): void {
  const name = relPath.split("/").pop() ?? "";
  if (name.trim() === "") {
    throw new FileBrowserError("denied", "A name is required");
  }
  if (name !== name.trim()) {
    // Leading/trailing spaces in a filename are almost always a typo, and they
    // make the file miserable to reference from a shell or a prompt.
    throw new FileBrowserError("denied", `"${name}" starts or ends with a space`);
  }
  if (name === "." || name === "..") {
    throw new FileBrowserError("denied", `"${name}" is not a name`);
  }
  if (name.includes("\\") || name.includes("\0")) {
    throw new FileBrowserError("denied", `"${name}" is a path, not a name`);
  }
}

/** The two creation paths share every check; only their last syscall differs. */
async function resolveForCreation(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
): Promise<string> {
  if (writableRel === null) {
    throw new FileBrowserError("denied", "The sandbox is read-only");
  }
  assertCreatableName(relPath);
  const writableRoot = writableRel === undefined ? root : path.resolve(root, writableRel);
  const resolved = await resolveConfined(root, relPath);
  if (!isWithin(writableRoot, resolved)) {
    throw new FileBrowserError("denied", `"${relPath}" is outside the writable zone`);
  }
  return resolved;
}

/** Turn a filesystem refusal into the reason the client can act on. */
function creationError(error: unknown, relPath: string): FileBrowserError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EEXIST") return new FileBrowserError("conflict", `"${relPath}" already exists`);
  if (code === "ENOENT") return new FileBrowserError("not-found", `The folder for "${relPath}" does not exist`);
  if (code === "ENOTDIR") return new FileBrowserError("not-found", `The folder for "${relPath}" is not a folder`);
  if (code === "EACCES" || code === "EPERM") return new FileBrowserError("denied", `Cannot create "${relPath}"`);
  return error instanceof FileBrowserError ? error : new FileBrowserError("denied", `Cannot create "${relPath}"`);
}

/**
 * Create an empty file from the browser, under exactly the permission rules that
 * govern a write.
 *
 * The `wx` flag does the existence check and the creation in one syscall: a
 * `stat` first would leave a window in which the path could appear, and this
 * operation must never truncate something that is already there.
 */
export async function createFileFromBrowser(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
): Promise<{ size: number; mtimeMs: number }> {
  const resolved = await resolveForCreation(root, writableRel, relPath);
  try {
    await fs.writeFile(resolved, "", { flag: "wx" });
  } catch (error) {
    throw creationError(error, relPath);
  }
  const stat = await fs.stat(resolved);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

/**
 * Create one directory from the browser. Not `recursive`: a control that creates
 * a chain of directories from a typo is a control that surprises.
 */
export async function createDirectoryFromBrowser(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
): Promise<void> {
  const resolved = await resolveForCreation(root, writableRel, relPath);
  try {
    await fs.mkdir(resolved);
  } catch (error) {
    throw creationError(error, relPath);
  }
}

/**
 * Write a file back from the browser's editor. Permission mirrors the agent's own
 * write tool: without a sandbox anything under the browser root is writable; with
 * one, writes need `allowWrite` and must land inside the writable zone.
 *
 * `writableRel` is resolveWritableRoot's output (undefined = no sandbox, null =
 * read-only sandbox, "" or subpath = writable zone relative to root).
 *
 * `expectedMtimeMs` must match the file's current mtime (from the file_content
 * that populated the editor) — a mismatch or a missing file is a "conflict",
 * refusing to clobber concurrent changes. `force` skips the mtime comparison
 * (the user explicitly chose to overwrite); permission and size checks still
 * apply, and only existing files can be saved either way.
 */
export async function writeFileFromBrowser(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
  content: string,
  expectedMtimeMs: number,
  force = false,
): Promise<{ size: number; mtimeMs: number }> {
  if (writableRel === null) {
    throw new FileBrowserError("denied", "The sandbox is read-only");
  }
  const writableRoot = writableRel === undefined ? root : path.resolve(root, writableRel);
  const resolved = await resolveConfined(root, relPath);
  if (!isWithin(writableRoot, resolved)) {
    throw new FileBrowserError("denied", `"${relPath}" is outside the writable zone`);
  }
  // UTF-8 byteLength >= UTF-16 length, so this rejects grossly oversized payloads
  // before allocating a Buffer for them
  if (content.length > MAX_PREVIEW_BYTES) {
    throw new FileBrowserError("too-large", "Content is larger than the 1 MB limit");
  }
  const buffer = Buffer.from(content, "utf8");
  if (buffer.byteLength > MAX_PREVIEW_BYTES) {
    const mb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
    throw new FileBrowserError("too-large", `Content is ${mb} MB, larger than the 1 MB limit`);
  }
  // A NUL byte would make the saved file unreadable in the viewer (looksBinary refuses it on read)
  if (looksBinary(buffer)) {
    throw new FileBrowserError("binary", "Content contains binary data");
  }
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new FileBrowserError("conflict", `"${relPath}" no longer exists`);
  }
  if (!stat.isFile()) {
    throw new FileBrowserError("not-found", `"${relPath}" is not a file`);
  }
  if (!force && stat.mtimeMs !== expectedMtimeMs) {
    throw new FileBrowserError("conflict", `"${relPath}" changed on disk since it was opened`);
  }
  // Atomic replace: a crash mid-write must never leave a truncated file behind
  const tmp = `${resolved}.pi-outpost-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, buffer, { mode: stat.mode });
    await fs.rename(tmp, resolved);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  const written = await fs.stat(resolved);
  return { size: written.size, mtimeMs: written.mtimeMs };
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
