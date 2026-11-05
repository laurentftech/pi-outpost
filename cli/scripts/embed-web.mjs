/**
 * Build-time helper: inlines the built web UI (web/dist) into a generated
 * TypeScript module (server/src/embedded-web.ts) so the SEA/npm bundle ships
 * the UI inside the executable — no web/ folder needed next to the .exe.
 *
 * Each file becomes { b64, type } keyed by its URL path (e.g. "/assets/x.js").
 * The server serves these from memory, which also sidesteps the
 * application/octet-stream MIME bug that happened when the Vite *source*
 * index.html was served instead of the production build.
 */
import { constants as fsConstants } from "node:fs";
import { readdir, lstat, open, realpath, stat, writeFile, mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  // A web app manifest served as an opaque stream is ignored, and the interface
  // is then silently not installable from the executable while remaining
  // installable from a built directory — the one failure this table can cause
  // that nothing reports.
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFor(file) {
  const dot = file.lastIndexOf(".");
  if (dot >= 0) {
    const t = MIME[file.slice(dot).toLowerCase()];
    if (t) return t;
  }
  return "application/octet-stream";
}

function fdPath(fd) {
  if (process.platform === "linux") return `/proc/self/fd/${fd}`;
  if (process.platform === "darwin") return `/dev/fd/${fd}`;
  return undefined;
}

function samePath(first, second) {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function insideRoot(root, target) {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function openedPathIsStable(abs, logicalAbs, base, opened) {
  try {
    const [atPath, canonical] = await Promise.all([stat(abs), realpath(abs)]);
    return atPath.dev === opened.dev && atPath.ino === opened.ino &&
      samePath(canonical, logicalAbs) && insideRoot(base, canonical);
  } catch {
    return false;
  }
}

async function directoryIsStable(dir, logicalDir, base, expected) {
  try {
    const [current, canonical] = await Promise.all([stat(dir), realpath(dir)]);
    return current.isDirectory() && current.dev === expected.dev && current.ino === expected.ino &&
      samePath(canonical, logicalDir) && insideRoot(base, canonical);
  } catch {
    return false;
  }
}

async function walk(dir, logicalDir, base, out, expectedDirectory) {
  if (!(await directoryIsStable(dir, logicalDir, base, expectedDirectory))) return;
  const entries = await readdir(dir);
  if (!(await directoryIsStable(dir, logicalDir, base, expectedDirectory))) return;
  for (const entry of entries) {
    const abs = join(dir, entry);
    const logicalAbs = join(logicalDir, entry);
    const flags = process.platform === "win32" ? "r" : fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW;
    const input = await open(abs, flags).catch(() => null);
    if (input === null) {
      // Windows may refuse to open a directory handle. Check for a real directory
      // only after the attempted open, then recurse.
      if (process.platform === "win32") {
        const stats = await lstat(abs).catch(() => null);
        if (stats?.isDirectory() && !stats.isSymbolicLink()) await walk(abs, logicalAbs, base, out, stats);
      }
      continue;
    }
    try {
      const opened = await input.stat();
      if (opened.isDirectory()) {
        if (!(await openedPathIsStable(abs, logicalAbs, base, opened))) continue;
        const anchoredDir = fdPath(input.fd);
        if (anchoredDir !== undefined) {
          await walk(anchoredDir, logicalAbs, base, out, opened);
        } else {
          await input.close();
          await walk(abs, logicalAbs, base, out, opened);
        }
        continue;
      }
      if (!opened.isFile()) continue;
      if (!(await openedPathIsStable(abs, logicalAbs, base, opened))) continue;
      const rel = relative(base, logicalAbs).split(sep).join("/");
      const url = "/" + rel;
      const buf = await input.readFile();
      out[url] = { b64: buf.toString("base64"), type: mimeFor(entry) };
    } finally {
      await input.close().catch(() => undefined);
    }
  }
}

export async function generateEmbeddedWeb(webDist, outFile) {
  const map = {};
  const base = await realpath(webDist);
  if (process.platform === "win32") {
    const rootStats = await lstat(base);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("web/dist is not a real directory");
    await walk(base, base, base, map, rootStats);
  } else {
    const rootFd = await open(base, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    try {
      const opened = await rootFd.stat();
      if (!(await openedPathIsStable(base, base, base, opened))) throw new Error("web/dist changed while opening");
      await walk(fdPath(rootFd.fd) ?? base, base, base, map, opened);
    } finally {
      await rootFd.close();
    }
  }
  const count = Object.keys(map).length;
  const lines = [
    "// GENERATED by cli/scripts/embed-web.mjs — do not edit.",
    "// Inlined production web UI (web/dist). Consumed by server/src/index.ts",
    "// when present, making the SEA/npm bundle self-contained.",
    "export interface EmbeddedAsset { b64: string; type: string; }",
    "export const EMBEDDED_WEB: Record<string, EmbeddedAsset> = {",
    ...Object.entries(map).map(([url, a]) => `  ${JSON.stringify(url)}: { b64: ${JSON.stringify(a.b64)}, type: ${JSON.stringify(a.type)} },`),
    "};",
    "",
  ];
  await mkdir(join(outFile, ".."), { recursive: true });
  await writeFile(outFile, lines.join("\n"), "utf-8");
  return count;
}

/**
 * Writes an empty EMBEDDED_WEB map. Used in server-only / embed mode
 * (BUILD_EMBED_WEB=0): the bundle then serves the UI from a web/ folder on
 * disk (fastifyStatic fallback in server/src/index.ts) instead of inlining it.
 */
export async function writeEmptyEmbeddedWeb(outFile) {
  const lines = [
    "// GENERATED by cli/scripts/embed-web.mjs — do not edit.",
    "// Empty by design (BUILD_EMBED_WEB=0): the server serves the UI from a",
    "// web/ folder on disk via fastifyStatic, not from this map.",
    "export interface EmbeddedAsset { b64: string; type: string; }",
    "export const EMBEDDED_WEB: Record<string, EmbeddedAsset> = {};",
    "",
  ];
  await mkdir(join(outFile, ".."), { recursive: true });
  await writeFile(outFile, lines.join("\n"), "utf-8");
}
