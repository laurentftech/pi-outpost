/**
 * Search of file contents under the browser root (Files → Search in files).
 *
 * A plain walker rather than `rg`: nothing to spawn, so it behaves the same in the
 * single-file executable and on a Windows box whose PATH cannot reach binaries. The
 * walk is the one `searchFiles` makes — same skipped entries, symbolic links never
 * followed — so the two searches agree on what the workspace holds.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ContentSearchHit } from "@pi-outpost/shared";
import { looksBinary, SEARCH_MAX_VISITED, skippedBySearch } from "./fileBrowser.ts";
import { pdfPageTexts } from "./pdf.ts";

export interface ContentSearchLimits {
  maxHits: number;
  maxHitsPerFile: number;
  /** Text files larger than this are not read. */
  maxTextBytes: number;
  maxPdfBytes: number;
  /** Budget for one PDF; one that runs past it is skipped. */
  pdfTimeoutMs: number;
  /** Budget for the whole search; results so far come back marked truncated. */
  deadlineMs: number;
  maxVisited: number;
}

export const CONTENT_SEARCH_LIMITS: ContentSearchLimits = {
  maxHits: 500,
  maxHitsPerFile: 20,
  maxTextBytes: 1024 * 1024,
  maxPdfBytes: 50 * 1024 * 1024,
  pdfTimeoutMs: 5_000,
  deadlineMs: 15_000,
  maxVisited: SEARCH_MAX_VISITED,
};

/** Longest excerpt returned for one hit. */
export const EXCERPT_CHARS = 200;
/** How much of an excerpt comes before the match when the text has to be cut. */
const EXCERPT_LEAD = 60;
/** The binary check looks at this much of a file, as `git`/`grep -I` do. */
const BINARY_PROBE_BYTES = 8192;

export interface ContentSearchResult {
  hits: ContentSearchHit[];
  /** A cap or the deadline stopped the search before it covered everything. */
  truncated: boolean;
  /** PDFs that could not be read: encrypted, corrupt, or over their budget. */
  skipped: number;
}

/**
 * Case-insensitive literal search for `query` in the text files and PDF text layers
 * under `root`. An empty or whitespace query finds nothing and reads nothing. An
 * aborted `signal` rejects with its reason: a superseded search has no answer.
 */
export async function searchContent(
  root: string,
  query: string,
  options: { signal?: AbortSignal; limits?: Partial<ContentSearchLimits> } = {},
): Promise<ContentSearchResult> {
  const needle = query.trim().toLowerCase();
  const result: ContentSearchResult = { hits: [], truncated: false, skipped: 0 };
  if (needle === "") return result;
  const limits = { ...CONTENT_SEARCH_LIMITS, ...options.limits };
  const signal = options.signal;
  const deadline = Date.now() + limits.deadlineMs;
  let visited = 0;

  /** False once the search must stop, having said why in `result.truncated`. */
  function mayContinue(): boolean {
    signal?.throwIfAborted();
    if (result.truncated) return false;
    if (result.hits.length >= limits.maxHits || visited >= limits.maxVisited || Date.now() >= deadline) {
      result.truncated = true;
      return false;
    }
    return true;
  }

  function add(hits: ContentSearchHit[]): void {
    if (hits.length > limits.maxHitsPerFile) {
      hits = hits.slice(0, limits.maxHitsPerFile);
      result.truncated = true;
    }
    const room = limits.maxHits - result.hits.length;
    if (hits.length > room) result.truncated = true;
    result.hits.push(...hits.slice(0, room));
  }

  async function walk(dir: string, relDir: string): Promise<void> {
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // readdir's order is the filesystem's; sorted, the same tree answers the same way everywhere.
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
      if (!mayContinue()) return;
      visited++;
      if (skippedBySearch(dirent)) continue;
      const absolute = path.join(dir, dirent.name);
      const relPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        await walk(absolute, relPath);
      } else if (dirent.isFile()) {
        const hits = await searchFile(absolute, relPath);
        if (hits !== null) add(hits);
      }
    }
  }

  /** The file's hits, or null when it is not searched. */
  async function searchFile(absolute: string, relPath: string): Promise<ContentSearchHit[] | null> {
    // Listed as a file a moment ago; checked again without following anything, so a
    // file swapped for a link since cannot lead the read outside the root.
    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    if (relPath.toLowerCase().endsWith(".pdf")) {
      if (stat.size > limits.maxPdfBytes) return null;
      return searchPdf(absolute, relPath);
    }
    if (stat.size > limits.maxTextBytes) return null;
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(absolute);
    } catch {
      return null;
    }
    if (looksBinary(buffer.subarray(0, BINARY_PROBE_BYTES))) return null;
    return lineHits(relPath, buffer.toString("utf8"), needle, limits.maxHitsPerFile + 1);
  }

  async function searchPdf(absolute: string, relPath: string): Promise<ContentSearchHit[] | null> {
    let texts: string[];
    try {
      const bytes = new Uint8Array(await fs.readFile(absolute));
      const timeoutMs = Math.max(0, Math.min(limits.pdfTimeoutMs, deadline - Date.now()));
      texts = await pdfPageTexts(bytes, { timeoutMs, signal });
    } catch {
      signal?.throwIfAborted();
      result.skipped++;
      return null;
    }
    return pageHits(relPath, texts, needle, limits.maxHitsPerFile + 1);
  }

  await walk(root, "");
  return result;
}

/** One hit per matching line, up to `max`. */
export function lineHits(relPath: string, text: string, needle: string, max: number): ContentSearchHit[] {
  const hits: ContentSearchHit[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const column = line.toLowerCase().indexOf(needle);
    if (column === -1) continue;
    hits.push({ path: relPath, kind: "line", line: index + 1, column, excerpt: excerptAround(line, column, needle.length) });
    if (hits.length >= max) break;
  }
  return hits;
}

/** One hit per page whose text holds the query, up to `max`. Line breaks read as spaces. */
export function pageHits(relPath: string, pageTexts: string[], needle: string, max: number): ContentSearchHit[] {
  const hits: ContentSearchHit[] = [];
  for (const [index, raw] of pageTexts.entries()) {
    const text = raw.replace(/\s+/g, " ").trim();
    const at = text.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    hits.push({ path: relPath, kind: "pdf-page", page: index + 1, excerpt: excerptAround(text, at, needle.length) });
    if (hits.length >= max) break;
  }
  return hits;
}

/** The text around a match, at most EXCERPT_CHARS long, with "…" where it was cut. */
export function excerptAround(text: string, at: number, length: number): string {
  const trimmedStart = text.length - text.trimStart().length;
  const body = text.trim();
  const match = at - trimmedStart;
  if (body.length <= EXCERPT_CHARS) return body;
  // A match too long to fit after the lead starts the excerpt itself.
  const lead = Math.min(EXCERPT_LEAD, Math.max(0, EXCERPT_CHARS - length));
  const start = Math.max(0, Math.min(match - lead, body.length - EXCERPT_CHARS));
  const end = Math.min(body.length, start + EXCERPT_CHARS);
  return `${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
}
