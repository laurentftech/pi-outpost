/**
 * Cut raw V8 coverage files down to the sources the coverage run measures.
 *
 * A process started with NODE_V8_COVERAGE writes one JSON file at exit holding an entry
 * for every script it ran — node internals, every dependency — and, under tsx, the source
 * maps of all of them. A server that loads pdf.js writes about 20 MB, of which the
 * server's own sources are about 3. The coverage run keeps only entries for files under
 * `server/src` and `shared/src`, so the run's data stays bounded and the reporter never reads anything else.
 *
 * A file that does not parse — a process killed mid-write — is renamed aside with an
 * `.unreadable` suffix and reported, never handed to the reporter.
 */
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The sources the coverage run measures: the server and the code it shares with the UI. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SERVER_SRC = path.join(REPO, "server", "src");
export const SHARED_SRC = path.join(REPO, "shared", "src");
export const SOURCE_ROOTS = [SERVER_SRC, SHARED_SRC];

/** A script URL or path from a coverage file, as a filesystem path, or undefined when it is not a file. */
function toPath(url) {
  if (url.startsWith("file:")) {
    try {
      return fileURLToPath(url);
    } catch {
      return undefined;
    }
  }
  return path.isAbsolute(url) ? url : undefined;
}

/** Whether `url` names a file under one of `roots`. Case-insensitive where the filesystem is. */
export function isUnder(url, roots = SOURCE_ROOTS) {
  const file = toPath(url);
  if (file === undefined) return false;
  const fold = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  return [roots].flat().some((root) => {
    const relative = path.relative(fold(root), fold(path.resolve(file)));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

/**
 * Rewrite one coverage file in place with only the entries under `roots`.
 *
 * Returns `kept` (rewritten), `empty` (nothing under `roots`: deleted) or `unreadable`
 * (renamed to `<file>.unreadable`), with the sizes before and after.
 */
export async function filterCoverageFile(file, roots = SOURCE_ROOTS) {
  // One read, sized from what was read: no separate stat for the file to change after.
  const raw = await readFile(file);
  const before = raw.length;
  let data;
  try {
    data = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(data?.result)) throw new Error("no result array");
  } catch {
    await rename(file, `${file}.unreadable`);
    return { status: "unreadable", file, before, after: 0 };
  }
  const result = data.result.filter((entry) => typeof entry.url === "string" && isUnder(entry.url, roots));
  if (result.length === 0) {
    await rm(file, { force: true });
    return { status: "empty", file, before, after: 0 };
  }
  const maps = Object.fromEntries(Object.entries(data["source-map-cache"] ?? {}).filter(([url]) => isUnder(url, roots)));
  const text = JSON.stringify({ result, "source-map-cache": maps });
  await writeFile(file, text);
  return { status: "kept", file, before, after: Buffer.byteLength(text) };
}

/**
 * Filter every coverage file in `dir` (optionally only those `match` accepts) and
 * summarise: how many were kept, emptied and unreadable, and the bytes before and after.
 */
export async function filterCoverageDir(dir, { roots = SOURCE_ROOTS, match = () => true } = {}) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json") && match(name));
  const summary = { kept: 0, empty: 0, unreadable: [], before: 0, after: 0 };
  for (const name of names) {
    const outcome = await filterCoverageFile(path.join(dir, name), roots);
    summary.before += outcome.before;
    summary.after += outcome.after;
    if (outcome.status === "unreadable") summary.unreadable.push(name);
    else summary[outcome.status] += 1;
  }
  return summary;
}
