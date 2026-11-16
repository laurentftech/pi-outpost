import { stripAnsi } from "../util/ansi";

export interface SearchHit {
  line: number;
  text: string;
}

export interface SearchFileGroup {
  path: string;
  hits: SearchHit[];
}

/** `path:line:text`, where the path may itself contain colons on Windows-style drives. */
const HIT = /^(.*?):(\d+):(.*)$/;

/**
 * Groups `path:line:text` search output by file, preserving the order files were
 * first seen.
 *
 * Returns an empty array when no line matches, which the presentation reads as
 * "this is not a hit list" and falls back to the raw output. A search that
 * genuinely found nothing also yields an empty array — the raw output says so
 * better than an empty file list would.
 */
export function parseSearchHits(output: string): SearchFileGroup[] {
  const groups: SearchFileGroup[] = [];
  const byPath = new Map<string, SearchFileGroup>();

  // `rg --color=always` / `grep --color=always` wrap path, line and match in SGR
  // escapes; a path containing them would never group with its plain twin.
  for (const raw of stripAnsi(output).split("\n")) {
    const match = HIT.exec(raw);
    if (match === null) continue;
    const [, path, line, text] = match;
    if (path === "") continue;
    let group = byPath.get(path);
    if (group === undefined) {
      group = { path, hits: [] };
      byPath.set(path, group);
      groups.push(group);
    }
    group.hits.push({ line: Number(line), text });
  }
  return groups;
}

/**
 * Where a hit's file is from the project, given the `path` the search was asked for.
 *
 * The grep tool prints paths relative to the directory it searched, and only the file's
 * name when it searched one file — so the printed path alone opens the wrong file, or none,
 * whenever the search was not at the project root.
 */
export function hitFilePath(searchPath: unknown, hitPath: string): string {
  if (typeof searchPath !== "string") return hitPath;
  const base = searchPath.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (base === "" || base === ".") return hitPath;
  // One file searched: the tool printed its name, and the search path is the file itself.
  if (!hitPath.includes("/") && (base === hitPath || base.endsWith(`/${hitPath}`))) return base;
  return `${base}/${hitPath}`;
}

export function countHits(groups: SearchFileGroup[]): number {
  return groups.reduce((total, group) => total + group.hits.length, 0);
}
