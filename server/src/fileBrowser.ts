/**
 * File-browser backend for the sidebar: lists directories, previews file
 * contents, and saves editor buffers back, confined to the same root the
 * agent's own tools can see — writes further confined to the writable zone
 * (SECURITY: reuses sandbox.ts's realResolve/isWithin — never reinvent path
 * confinement here).
 */
import { constants, type Dirent } from "node:fs";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { DirEntry, FileBrowserErrorReason, FileSearchEntry } from "@pi-outpost/shared";
import { declaredStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/document";
import type { AppConfig } from "./config.ts";

/** What root resolution actually reads out of a configuration. */
type RootSettings = Pick<AppConfig, "cwd" | "sandbox">;
import { isWithin, realResolve } from "./sandbox.ts";

/** Hard cap for file previews — refused outright above this, never silently truncated. */
export const MAX_PREVIEW_BYTES = 1_048_576; // 1 MiB

/**
 * Hard cap for an upload, in decoded bytes. Matched to the path-based extraction
 * tools' own limits (`DEFAULT_PDF_MAX_BYTES` and its docx/xlsx/pptx siblings in
 * config.ts): a document those tools can read must be one the upload accepts, or
 * the feature has a hole in the middle.
 */
export const MAX_UPLOAD_BYTES = 26_214_400; // 25 MiB

/**
 * The same cap measured on the wire. Base64 is 4 characters per 3 bytes, rounded
 * up to a whole quantum — checked *before* decoding so the Buffer allocation is
 * bounded by a number we already agreed to.
 */
export const MAX_UPLOAD_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;

/**
 * The one directory uploads may land in, relative to the writable root. Must match
 * `UPLOADS_DIRECTORY` in `ui/src/uploads.ts`.
 *
 * The client names its destination in the request, but the server does not take
 * its word for it. Without this, `upload_file` would be the most powerful message
 * in the protocol: arbitrary binary content, up to 25 MB, at any path in the
 * writable zone, creating a chain of parent directories on the way — while
 * `create_directory` right below deliberately refuses to create a chain at all,
 * and `write_file` refuses NUL bytes and demands the file already exist. Pinning
 * the destination keeps the new power to the one thing the feature needs.
 */
export const UPLOADS_DIRECTORY = "uploads";

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

/**
 * Root the browser is confined to: the file sandbox root if configured, else the
 * agent's cwd.
 *
 * Takes the narrow slice rather than the whole AppConfig so a workspace can resolve
 * its own root from its own settings (see workspace.ts); a full AppConfig still
 * satisfies it.
 */
export async function resolveBrowserRoot(config: RootSettings): Promise<string> {
  return fs.realpath(config.sandbox?.root ?? config.cwd);
}

/**
 * Writable zone the browser should highlight, relative to `browserRoot` (posix
 * separators): undefined when no sandbox is configured, null when the sandbox
 * is entirely read-only, or the writable subtree's path ("" = the whole root).
 */
export async function resolveWritableRoot(config: RootSettings, browserRoot: string): Promise<string | null | undefined> {
  if (!config.sandbox) return undefined;
  if (!config.sandbox.allowWrite) return null;
  const target = config.sandbox.writableRoot ? await fs.realpath(config.sandbox.writableRoot) : browserRoot;
  return path.relative(browserRoot, target).split(path.sep).join("/");
}

/** Resolve a client-supplied relative path against root, rejecting anything that escapes it. */
export async function resolveConfined(root: string, relPath: string): Promise<string> {
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

/**
 * Read a file that was measured a moment ago.
 *
 * The workspace is written by an agent while someone reads it, so the file can be
 * renamed or deleted between the `stat` and the read. That is the same answer as a
 * file that was never there — not an unknown error the HTTP route turns into a 500.
 */
async function readMeasuredFile(resolved: string, relPath: string): Promise<Buffer> {
  try {
    return await fs.readFile(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new FileBrowserError("not-found", `"${relPath}" does not exist`);
    }
    throw error;
  }
}

/** Cheap binary heuristic: presence of a NUL byte (same check git/grep -I use). */
function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export async function readFileForPreview(
  root: string,
  relPath: string,
  structuredExchangeMaxBytes = MAX_PREVIEW_BYTES,
  /**
   * The digest an artifact link bound its approval to, when the path came from one.
   *
   * Verified here rather than by a caller reading the file a second time: hashing
   * one buffer and serving another means the bytes shown are never the bytes
   * checked, and in an application whose premise is an agent writing this workspace
   * while someone reads it, a file replaced between the two reads would be
   * displayed as verified.
   */
  expectedDigest?: string,
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
  // A structured-exchange document is measured against its own ceiling, the way a
  // PDF is. Which ceiling applies cannot be known from the name — recognition is
  // by what the document declares — so the wider one gates the read and the
  // narrower one is applied afterwards, to a file that turned out not to be one.
  // The cost is reading a file that is then refused; the alternative is deciding
  // by extension, which is the thing this feature exists not to do.
  const outer = Math.max(MAX_PREVIEW_BYTES, structuredExchangeMaxBytes);
  if (stat.size > outer) {
    throw new FileBrowserError("too-large", describeUnmeasured(stat.size, structuredExchangeMaxBytes));
  }
  const buffer = await readMeasuredFile(resolved, relPath);
  if (expectedDigest !== undefined) {
    const observed = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    if (observed !== expectedDigest) {
      throw new FileBrowserError(
        "digest-mismatch",
        `This artifact is not the one the document was approved against — it declares ${expectedDigest}, ` +
          `and the file here is ${observed}.`,
      );
    }
  }
  if (looksBinary(buffer)) {
    throw new FileBrowserError("binary", "Binary file — preview not supported");
  }
  const content = buffer.toString("utf8");
  // Which of the two ceilings applies is settled here and nowhere earlier, because
  // it depends on what the file declares. Both directions matter: a tightened
  // document limit must actually refuse a document above it, and a document below
  // the wider ceiling must not be refused for exceeding the preview one.
  const isDocument = declaredStructuredExchangeSchema(content) !== undefined;
  const limit = isDocument ? structuredExchangeMaxBytes : MAX_PREVIEW_BYTES;
  if (stat.size > limit) {
    throw new FileBrowserError("too-large", describeOversize(stat.size, limit, isDocument));
  }
  return { content, size: stat.size, mtimeMs: stat.mtimeMs };
}

/** Megabytes, to one decimal, the way every other size refusal here says it. */
const asMb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/**
 * The size refusal, naming the limit that was applied.
 *
 * It is a size problem, and never a claim about the document being wrong — which
 * is why the sentence says what was measured and against what, and stops there.
 */
function describeOversize(size: number, limit: number, isDocument: boolean): string {
  return isDocument
    ? `File is ${asMb(size)} MB, larger than the ${asMb(limit)} MB structured-exchange document limit`
    : `File is ${asMb(size)} MB, larger than the 1 MB preview limit`;
}

/**
 * The refusal for a file too large to open at all, which is therefore too large to
 * ask what it declares.
 *
 * Both limits are named because at this point neither has been chosen, and a
 * reader told only "larger than the 1 MB preview limit" about a 6 MB diagram would
 * conclude that diagrams are capped at 1 MB.
 */
function describeUnmeasured(size: number, structuredExchangeMaxBytes: number): string {
  const preview = `File is ${asMb(size)} MB, larger than the 1 MB preview limit`;
  if (structuredExchangeMaxBytes <= MAX_PREVIEW_BYTES) return preview;
  return `${preview} (${asMb(structuredExchangeMaxBytes)} MB for structured-exchange documents)`;
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
  return readMeasuredFile(resolved, relPath);
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
 * An uploaded file's name is a name, not a route — and unlike a name the user
 * typed, it comes from a `File` the browser handed over, so a separator in it is
 * an attempt at a path rather than a typo. Refused as "invalid": the client needs
 * to tell a malformed request apart from a permission refusal.
 *
 * Deliberately *not* `assertCreatableName`: that one also refuses leading and
 * trailing spaces, which is right for a name being typed and wrong for a file
 * already sitting on someone's desktop under that name.
 */
export function assertUploadName(name: string): void {
  if (name.trim() === "") {
    throw new FileBrowserError("invalid", "A file name is required");
  }
  if (name === "." || name === "..") {
    throw new FileBrowserError("invalid", `"${name}" is not a name`);
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new FileBrowserError("invalid", `"${name}" is a path, not a name`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new FileBrowserError("invalid", "The file name contains control characters");
  }
  // ENAMETOOLONG otherwise, which surfaces as a bare "cannot create" the user
  // cannot act on. 255 bytes is the common single-component limit.
  if (Buffer.byteLength(name, "utf8") > MAX_UPLOAD_NAME_BYTES) {
    throw new FileBrowserError("invalid", "The file name is too long");
  }
  // The rest are refused on every platform, not only Windows: a workspace is
  // shared and synced, so a name that is fine here and unrepresentable on a
  // colleague's machine breaks their checkout rather than ours.
  //
  // Trailing dots and spaces are the dangerous half — Win32 strips them, so
  // "report.pdf." and "report.pdf" address the same file. The EEXIST collision
  // check would be looking at one name while the filesystem resolved another, and
  // the no-overwrite guarantee would quietly stop holding.
  if (/[. ]$/.test(name)) {
    throw new FileBrowserError("invalid", `"${name}" ends with a dot or a space`);
  }
  // ":" opens an NTFS alternate data stream — "report.pdf:hidden" writes a stream
  // on a file that still lists as report.pdf.
  if (name.includes(":")) {
    throw new FileBrowserError("invalid", `"${name}" is a path, not a name`);
  }
  if (WINDOWS_RESERVED_NAMES.test(name)) {
    throw new FileBrowserError("invalid", `"${name}" is a reserved device name`);
  }
}

/** Common single-path-component limit; anything longer fails as ENAMETOOLONG. */
const MAX_UPLOAD_NAME_BYTES = 255;

/**
 * DOS device names, which Win32 still resolves ahead of the filesystem — with or
 * without an extension, so `CON`, `con.txt` and `LPT1.pdf` are all the device.
 */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * `Buffer.from(s, "base64")` ignores anything it does not recognise, so a corrupt
 * body would silently become a shorter file rather than an error. Check the
 * alphabet first. Linear: the character class has no alternation, and `={0,2}` can
 * only back up two positions.
 */
function assertBase64(content: string): void {
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
    throw new FileBrowserError("invalid", "The uploaded content is not valid base64");
  }
}

/** `report.pdf` at attempt 2 → `report-2.pdf`; the extension has to survive. */
function suffixed(name: string, attempt: number): string {
  if (attempt === 0) return name;
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)}-${attempt}${ext}`;
}

/** Enough room to disambiguate a name without spinning on a hostile directory. */
const MAX_UPLOAD_NAME_ATTEMPTS = 1000;

/**
 * Store a file supplied by the browser, under exactly the permission rules that
 * govern a write — but for content that is *meant* to be binary.
 *
 * Deliberately not a flag on `writeFileFromBrowser`: that one refuses NUL bytes,
 * caps at the 1 MB preview limit, requires the file to already exist and checks an
 * mtime. Every one of those guards is wrong here, and a boolean suspending four
 * guards at once is not a guard.
 *
 * `destinationDirectory` is browser-root-relative and need not exist yet; missing
 * directories are created inside the writable zone. The returned path is the one
 * actually written, which is not always the one asked for — see below.
 */
export async function uploadFileFromBrowser(
  root: string,
  writableRel: string | null | undefined,
  destinationDirectory: string,
  name: string,
  contentBase64: string,
): Promise<string> {
  if (writableRel === null) {
    throw new FileBrowserError("denied", "The sandbox is read-only");
  }
  assertUploadName(name);
  const writableRoot = writableRel === undefined ? root : path.resolve(root, writableRel);
  const destination = await resolveConfined(root, destinationDirectory);
  if (!isWithin(writableRoot, destination)) {
    throw new FileBrowserError("denied", `"${destinationDirectory}" is outside the writable zone`);
  }
  // The destination is pinned, not merely confined: see UPLOADS_DIRECTORY. Checked
  // after confinement so an escaping path still reports *why* it was refused —
  // "outside the root" is the more useful answer, and the one the protocol
  // promises. The request carries a destination at all so that a client and server
  // that disagree say so, rather than the client writing somewhere it did not mean.
  if (path.resolve(root, destinationDirectory) !== path.resolve(writableRoot, UPLOADS_DIRECTORY)) {
    throw new FileBrowserError("denied", `Uploads may only be written to "${UPLOADS_DIRECTORY}"`);
  }

  // Both size checks run before anything touches the filesystem: a refused upload
  // must not leave a directory behind that the user never asked for.
  if (contentBase64.length > MAX_UPLOAD_BASE64_LENGTH) {
    throw new FileBrowserError("too-large", `Uploads are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  assertBase64(contentBase64);
  const buffer = Buffer.from(contentBase64, "base64");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new FileBrowserError("too-large", `Uploads are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }

  try {
    await fs.mkdir(destination, { recursive: true });
  } catch (error) {
    throw creationError(error, destinationDirectory);
  }

  // SECURITY: re-confine after creating the directory, not only before.
  //
  // `resolveConfined` resolves symlinks in the part of the path that exists and
  // keeps the missing tail as written — so for a destination that does not exist
  // yet, the tail was never checked against a real inode. The writable zone is
  // exactly where the agent's own write tools operate, so between that check and
  // this mkdir the tail can be replaced by a symlink pointing anywhere, and
  // recursive mkdir accepts an existing directory (through the link) rather than
  // failing. Resolving again closes that window, and everything below uses the
  // path that survived the second check.
  const confirmed = await realResolve(destination);
  if (!isWithin(root, confirmed) || !isWithin(writableRoot, confirmed)) {
    throw new FileBrowserError("outside-root", `"${destinationDirectory}" is outside the browser root`);
  }

  // Written whole under a temporary name, then linked into place: `link` fails
  // with EEXIST rather than overwriting, which is both the atomicity guarantee and
  // the collision check, without a stat/write window in between. `rename` would
  // give us the first and silently lose the second.
  //
  // SECURITY: `wx` and a random name, both deliberately. Plain `writeFile` opens
  // with O_TRUNC and *follows a symlink at the final component*, so a temporary
  // name the agent can guess is a temporary name the agent can pre-create as a
  // link to a file outside the sandbox — and the next upload would write 25 MB of
  // its choosing there. O_EXCL refuses to follow a link, dangling or not, and a
  // crypto-random suffix is not guessable in the first place.
  const tmp = path.join(confirmed, `.pi-outpost-upload-${randomBytes(12).toString("hex")}.tmp`);
  try {
    try {
      await fs.writeFile(tmp, buffer, { flag: "wx" });
    } catch (error) {
      throw creationError(error, name);
    }
    for (let attempt = 0; attempt < MAX_UPLOAD_NAME_ATTEMPTS; attempt++) {
      const candidate = suffixed(name, attempt);
      const target = path.join(confirmed, candidate);
      try {
        await fs.link(tmp, target);
        return path.relative(root, target).split(path.sep).join("/");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw creationError(error, candidate);
      }
    }
    throw new FileBrowserError("conflict", `Too many files named "${name}" already`);
  } finally {
    // Never let tidying up turn a completed upload into a failure: the file is
    // already linked into place by then, and `force` only forgives ENOENT.
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

type NativeLauncher = (command: string, args: string[]) => Promise<void>;

/** Spawn an OS launcher without a shell and wait until it reports success/failure. */
async function launchNative(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "ignore", windowsHide: true });
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

/** Open one confined regular file with the host platform's associated application. */
export async function openFileNative(
  root: string,
  relPath: string,
  launcher: NativeLauncher = launchNative,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const resolved = await resolveConfined(root, relPath);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new FileBrowserError("not-found", `"${relPath}" does not exist`);
  }
  if (!stat.isFile()) throw new FileBrowserError("not-found", `"${relPath}" is not a file`);

  const invocation =
    platform === "darwin"
      ? { command: "open", args: [resolved] }
      : platform === "win32"
        ? { command: "explorer.exe", args: [resolved] }
        : { command: "xdg-open", args: [resolved] };
  try {
    await launcher(invocation.command, invocation.args);
  } catch (error) {
    throw new FileBrowserError("launcher-failed", `Cannot open "${relPath}": ${(error as Error).message}`);
  }
}

/** Resolve an existing non-symlink regular file inside the browser root. */
async function resolveRegularFile(root: string, relPath: string): Promise<string> {
  const resolved = await resolveConfined(root, relPath);
  try {
    // Reject a symlink in the final segment: mutating or copying its resolved
    // target would make the visible tree entry's behavior surprising.
    if (!(await fs.lstat(path.resolve(root, relPath))).isFile()) {
      throw new FileBrowserError("not-found", `"${relPath}" is not a regular file`);
    }
  } catch (error) {
    if (error instanceof FileBrowserError) throw error;
    throw new FileBrowserError("not-found", `"${relPath}" does not exist`);
  }
  // Operate through the canonical path we just confined. Returning the lexical
  // path would reopen a race where an intermediate symlink is retargeted.
  return resolved;
}

/** Resolve an existing regular file and prove it is inside the writable zone. */
async function resolveWritableFile(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
): Promise<string> {
  if (writableRel === null) throw new FileBrowserError("denied", "The sandbox is read-only");
  const resolved = await resolveRegularFile(root, relPath);
  const writableRoot = writableRel === undefined ? root : path.resolve(root, writableRel);
  if (!isWithin(writableRoot, resolved)) {
    throw new FileBrowserError("denied", `"${relPath}" is outside the writable zone`);
  }
  return resolved;
}

/** Resolve an existing destination directory and prove it is writable. */
async function resolveWritableDirectory(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
): Promise<string> {
  if (writableRel === null) throw new FileBrowserError("denied", "The sandbox is read-only");
  const resolved = await resolveConfined(root, relPath);
  const writableRoot = writableRel === undefined ? root : path.resolve(root, writableRel);
  if (!isWithin(writableRoot, resolved)) {
    throw new FileBrowserError("denied", `"${relPath}" is outside the writable zone`);
  }
  try {
    if (!(await fs.stat(resolved)).isDirectory()) {
      throw new FileBrowserError("not-found", `"${relPath}" is not a directory`);
    }
  } catch (error) {
    if (error instanceof FileBrowserError) throw error;
    throw new FileBrowserError("not-found", `"${relPath}" does not exist`);
  }
  return resolved;
}

/** Translate lifecycle syscalls into stable browser errors. */
function lifecycleError(error: unknown, relPath: string, verb: "rename" | "delete" | "move" | "copy"): FileBrowserError {
  if (error instanceof FileBrowserError) return error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EEXIST") return new FileBrowserError("conflict", `"${relPath}" already exists`);
  if (code === "ENOENT" || code === "ENOTDIR") return new FileBrowserError("not-found", `"${relPath}" does not exist`);
  if (code === "EXDEV") return new FileBrowserError("denied", "Cannot move a file across filesystems");
  if (code === "EACCES" || code === "EPERM") return new FileBrowserError("denied", `Cannot ${verb} "${relPath}"`);
  return new FileBrowserError("denied", `Cannot ${verb} "${relPath}": ${(error as Error).message}`);
}

/**
 * Move a regular file without an overwrite race. A hard link is created with
 * EEXIST semantics before the source is removed; if removal fails, the new link
 * is rolled back. This deliberately refuses cross-filesystem moves.
 */
async function linkThenUnlink(source: string, destination: string, destinationRel: string, verb: "rename" | "move"): Promise<void> {
  try {
    await fs.link(source, destination);
  } catch (error) {
    throw lifecycleError(error, destinationRel, verb);
  }
  try {
    await fs.unlink(source);
  } catch (error) {
    await fs.unlink(destination).catch(() => {});
    throw lifecycleError(error, destinationRel, verb);
  }
}

/** Rename one regular file within its current directory, never overwriting. */
export async function renameFileFromBrowser(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
  name: string,
): Promise<string> {
  assertCreatableName(name);
  if (name.includes("/")) throw new FileBrowserError("denied", `"${name}" is a path, not a name`);
  const source = await resolveWritableFile(root, writableRel, relPath);
  const parentRel = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  await resolveWritableDirectory(root, writableRel, parentRel);
  const destinationRel = parentRel ? `${parentRel}/${name}` : name;
  const destination = await resolveConfined(root, destinationRel);
  await linkThenUnlink(source, destination, destinationRel, "rename");
  return destinationRel;
}

/** Permanently delete one writable regular file. */
export async function deleteFileFromBrowser(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
): Promise<void> {
  const source = await resolveWritableFile(root, writableRel, relPath);
  try {
    await fs.unlink(source);
  } catch (error) {
    throw lifecycleError(error, relPath, "delete");
  }
}

/** Move one regular file into an existing writable directory, never overwriting. */
export async function moveFileFromBrowser(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
  destinationDirectory: string,
): Promise<string> {
  const source = await resolveWritableFile(root, writableRel, relPath);
  const destinationDir = await resolveWritableDirectory(root, writableRel, destinationDirectory);
  const name = relPath.split("/").pop() ?? "";
  const destinationRel = destinationDirectory ? `${destinationDirectory}/${name}` : name;
  const destination = path.join(destinationDir, name);
  await resolveConfined(root, destinationRel);
  await linkThenUnlink(source, destination, destinationRel, "move");
  return destinationRel;
}

/** Copy one confined regular file into an existing writable directory, never overwriting. */
export async function copyFileFromBrowser(
  root: string,
  writableRel: string | null | undefined,
  relPath: string,
  destinationDirectory: string,
): Promise<string> {
  const source = await resolveRegularFile(root, relPath);
  const destinationDir = await resolveWritableDirectory(root, writableRel, destinationDirectory);
  const name = relPath.split("/").pop() ?? "";
  const destinationRel = destinationDirectory ? `${destinationDirectory}/${name}` : name;
  const destination = path.join(destinationDir, name);
  await resolveConfined(root, destinationRel);
  try {
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    throw lifecycleError(error, destinationRel, "copy");
  }
  return destinationRel;
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
  // Atomic replace: a crash mid-write must never leave a truncated file behind.
  //
  // SECURITY: `wx` and a crypto-random suffix, for the same reason the upload path
  // uses them. Plain `writeFile` opens with O_TRUNC and follows a symlink at the
  // final component, so a predictable temporary name inside the writable zone —
  // which is exactly where the agent's own tools operate — is a name the agent can
  // pre-create as a link pointing out of the sandbox, and this write would land
  // there. The `rename` below does not save us: by then the bytes are already
  // through the link.
  const tmp = `${resolved}.pi-outpost-${randomBytes(12).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, buffer, { mode: stat.mode, flag: "wx" });
    await fs.rename(tmp, resolved);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
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
