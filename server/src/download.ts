/**
 * What `GET /files/download` sends: one file as itself, or a folder — or several
 * entries — as one zip. Kept apart from the route so the decision (what, under which
 * name, within which limits) is testable without a server, limits lowered included.
 *
 * Everything is confined through fileBrowser.ts: the single file through
 * `resolveConfined`, an archive through `walkConfined`, which leaves out — and
 * counts — whatever resolves outside the browser root.
 */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { assertZipStreamFits, ZIP_MAX_32, ZIP_MAX_ENTRIES, type ZipStreamEntry } from "@pi-outpost/office/zipStream.ts";
import { FileBrowserError, resolveConfined, walkConfined, type WalkLimits } from "./fileBrowser.ts";

export const ARCHIVE_LIMITS: WalkLimits = { maxEntries: ZIP_MAX_ENTRIES, maxBytes: ZIP_MAX_32 };

export type Download =
  | { kind: "file"; name: string; size: number; open: () => Readable }
  | { kind: "archive"; name: string; entries: ZipStreamEntry[]; skipped: number; comment: string };

/** The last segment of a `/`-separated path; the browser root's own folder name for "". */
function baseName(root: string, relPath: string): string {
  return relPath === "" ? path.basename(root) : (relPath.split("/").pop() ?? relPath);
}

/** The archive's name: the folder's, or for several entries their common parent folder's. */
function archiveName(root: string, relPaths: string[]): string {
  if (relPaths.length === 1) return `${baseName(root, relPaths[0])}.zip`;
  const parents = relPaths.map((relPath) => (relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")).split("/") : []));
  const common: string[] = [];
  for (let i = 0; parents.every((parent) => i < parent.length && parent[i] === parents[0][i]); i++) common.push(parents[0][i]);
  return common.length === 0 ? "files.zip" : `${common[common.length - 1]}.zip`;
}

/**
 * Two selected entries may share a name (`a/notes.md`, `b/notes.md`); at the top of
 * one archive they would collide. The later one is renamed the way a browser names a
 * second download — `notes (2).md` — and everything under it follows.
 */
function topNamesFor(root: string, relPaths: string[]): string[] {
  const taken = new Set<string>();
  return relPaths.map((relPath) => {
    const name = baseName(root, relPath);
    let candidate = name;
    const dot = name.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let attempt = 2; taken.has(candidate.toLowerCase()); attempt++) candidate = `${stem} (${attempt})${extension}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Decide what to send for these browser-root-relative paths. Refusals are
 * `FileBrowserError`s: `not-found`, `outside-root`, or `too-large` naming the limit —
 * all raised here, before a single byte of the response exists.
 */
export async function prepareDownload(root: string, relPaths: string[], limits: WalkLimits = ARCHIVE_LIMITS): Promise<Download> {
  if (relPaths.length === 0) throw new FileBrowserError("not-found", "Nothing to download");
  const unique = [...new Set(relPaths)];
  if (unique.length === 1) {
    const resolved = await resolveConfined(root, unique[0]);
    const stat = await fs.stat(resolved).catch(() => null);
    if (stat === null) throw new FileBrowserError("not-found", `"${unique[0]}" does not exist`);
    if (stat.isFile()) {
      return { kind: "file", name: baseName(root, unique[0]), size: stat.size, open: () => createReadStream(resolved) };
    }
  }

  const tops = topNamesFor(root, unique);
  const entries: ZipStreamEntry[] = [];
  let skipped = 0;
  for (const [index, relPath] of unique.entries()) {
    const walk = await walkConfined(root, [relPath], {
      maxEntries: limits.maxEntries - entries.length,
      maxBytes: limits.maxBytes - entries.reduce((sum, entry) => sum + entry.size, 0),
    });
    skipped += walk.skipped;
    const ownName = baseName(root, relPath);
    for (const entry of walk.entries) {
      const name = tops[index] + entry.name.slice(ownName.length);
      entries.push(
        entry.kind === "file"
          ? { name, kind: "file", size: entry.size, open: () => createReadStream(entry.absolute) }
          : { name, kind: "directory", size: 0 },
      );
    }
  }
  const comment = skipped === 0 ? "" : `${skipped} ${skipped === 1 ? "entry was" : "entries were"} left out: ${skipped === 1 ? "it leads" : "they lead"} outside the workspace`;
  try {
    assertZipStreamFits(entries, Buffer.byteLength(comment, "utf8"));
  } catch {
    // The walk already held the entry count and the raw sizes to the limits; what
    // remains is the archive's own overhead pushing a borderline set past 4 GiB.
    throw new FileBrowserError("too-large", "Too large for one archive (4 GiB at most) — download a subfolder instead");
  }
  return { kind: "archive", name: archiveName(root, unique), entries, skipped, comment };
}

/**
 * A `Content-Disposition` naming the download: an ASCII fallback for old clients and
 * the exact name in RFC 5987 form, so `q3 résumé.pdf` arrives as itself.
 */
export function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
