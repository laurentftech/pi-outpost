/**
 * What changed since the version this installation ran before — read offline, from the
 * CHANGELOG.md the build inlines into the bundle.
 *
 * The same shape pi gives its own changelog: the file ships with the program, a marker
 * remembers the last version that ran, and an update shows the sections in between.
 * Nothing here reaches the network, so an installation that never checks for updates
 * still learns what the one it was given does differently.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OutpostChangelogEntry, OutpostChanges } from "@pi-outpost/shared";
import { cachePath, isComparableVersion, isNewer, releaseNotesUrl } from "./update.ts";

/** A release heading: `## [0.44.0] - 2026-10-20`, the date optional. */
const HEADING = /^##\s+\[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\](?:\s+-\s+(\S+))?\s*$/;

/**
 * The release sections of a changelog, in file order (newest first by convention).
 *
 * Only `## [x.y.z]` headings open a section; the preamble, and any `##` heading that
 * names no version, belong to nothing. Lines are split on `\r?\n`, since a checked-out
 * file carries CRLF on Windows and the build inlines whatever is on disk.
 */
export function parseChangelog(text: string): OutpostChangelogEntry[] {
  const entries: OutpostChangelogEntry[] = [];
  let current: { version: string; date?: string; lines: string[] } | null = null;
  const close = () => {
    if (current) entries.push({ version: current.version, ...(current.date ? { date: current.date } : {}), markdown: current.lines.join("\n").trim() });
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      close();
      const match = HEADING.exec(line);
      current = match ? { version: match[1], ...(match[2] ? { date: match[2] } : {}), lines: [] } : null;
      continue;
    }
    current?.lines.push(line);
  }
  close();
  return entries;
}

/** The sections newer than `from` and no newer than `to`, newest first. */
export function entriesBetween(entries: OutpostChangelogEntry[], from: string, to: string): OutpostChangelogEntry[] {
  return entries
    .filter((entry) => isNewer(entry.version, from) && !isNewer(entry.version, to))
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0));
}

/** The last version that ran, and the one it replaced when that run was an update. */
interface VersionMarker {
  version: string;
  updatedFrom?: string;
}

/** Beside the update check's cache: `agentDir` is pi-outpost's own state. */
export const markerPath = (agentDir: string): string => path.join(agentDir, "outpost-version.json");

async function readMarker(agentDir: string): Promise<VersionMarker | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(markerPath(agentDir), "utf8")) as Partial<VersionMarker> | null;
    if (typeof parsed?.version !== "string" || !isComparableVersion(parsed.version)) return undefined;
    return typeof parsed.updatedFrom === "string" && isComparableVersion(parsed.updatedFrom)
      ? { version: parsed.version, updatedFrom: parsed.updatedFrom }
      : { version: parsed.version };
  } catch {
    return undefined;
  }
}

async function writeMarker(agentDir: string, marker: VersionMarker): Promise<void> {
  try {
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(markerPath(agentDir), `${JSON.stringify(marker)}\n`);
  } catch {
    // Best effort: an unwritable marker costs a missed changelog, never a startup.
  }
}

/**
 * Whether an earlier pi-outpost ran with this agent directory: the update check leaves
 * its cache there. Tells an installation that predates the marker from a first run.
 */
async function ranBefore(agentDir: string): Promise<boolean> {
  return fs.stat(cachePath(agentDir)).then(
    () => true,
    () => false,
  );
}

/**
 * Record the running version, and say what changed if this run is an update.
 *
 * The marker keeps the version an update came from for as long as the new one runs,
 * so a restart before anyone opened the app does not lose the news; each browser
 * dismisses it for itself. A first run, a downgrade, and a source checkout (`dev`)
 * show nothing — there is no "before" worth describing. An installation older than
 * the marker is told about the running release only.
 */
export async function recordRunningVersion(options: { version: string; changelog: string; agentDir: string }): Promise<OutpostChanges | undefined> {
  const { version, agentDir } = options;
  if (!isComparableVersion(version)) return undefined;
  const marker = await readMarker(agentDir);

  const entries = parseChangelog(options.changelog);
  let from: string | undefined;
  if (marker === undefined && (await ranBefore(agentDir))) {
    // pi-outpost ran here before the marker existed, so the version it ran is unknown:
    // describe the running release alone, as an update from the one before it
    from = entries.find((entry) => isNewer(version, entry.version))?.version;
    await writeMarker(agentDir, from === undefined ? { version } : { version, updatedFrom: from });
  } else if (marker === undefined || isNewer(marker.version, version)) {
    await writeMarker(agentDir, { version });
  } else if (isNewer(version, marker.version)) {
    from = marker.version;
    await writeMarker(agentDir, { version, updatedFrom: from });
  } else {
    from = marker.updatedFrom;
  }
  if (from === undefined) return undefined;

  return { from, to: version, entries: entriesBetween(entries, from, version), releaseNotes: releaseNotesUrl(version) };
}
