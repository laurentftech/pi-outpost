/**
 * One release's section of CHANGELOG.md, for the GitHub Release's notes.
 *
 * The changelog ships inside the package and the executables — the app reads it after
 * an update (server/src/changelog.ts) — so a release without a section would tell
 * everyone who installs it nothing. The release workflow calls this before anything is
 * published, and it refuses rather than print an empty section.
 *
 *   node scripts/changelog-section.mjs 0.44.0   # → the body under "## [0.44.0] - …"
 */
import { readFileSync } from "node:fs";

/** The heading server/src/changelog.ts reads: `## [0.44.0] - 2026-10-20`, the date optional. */
const HEADING = /^##\s+\[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\](?:\s+-\s+(\S+))?\s*$/;

export class ChangelogError extends Error {}

/** The body of `version`'s section, trimmed; refuses a missing or empty one. */
export function sectionFor(text, version) {
  let collecting = false;
  let found = false;
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      // Read to the end: a second section for the same version would go unnoticed otherwise
      collecting = false;
      const match = HEADING.exec(line);
      if (match?.[1] === version) {
        if (found) throw new ChangelogError(`CHANGELOG.md has two sections for ${version}`);
        collecting = found = true;
      }
      continue;
    }
    if (collecting) lines.push(line);
  }
  const body = lines.join("\n").trim();
  if (!found) throw new ChangelogError(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section — write it before tagging`);
  if (body === "") throw new ChangelogError(`CHANGELOG.md's section for ${version} is empty`);
  return body;
}

// Called by the workflow: prints the section, or fails loudly enough to stop the job.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    const text = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    process.stdout.write(`${sectionFor(text, process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
