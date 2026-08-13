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

  for (const raw of output.split("\n")) {
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

export function countHits(groups: SearchFileGroup[]): number {
  return groups.reduce((total, group) => total + group.hits.length, 0);
}
