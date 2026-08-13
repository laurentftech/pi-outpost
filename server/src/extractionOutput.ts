/**
 * Writing an extraction to a workspace file.
 *
 * SECURITY — read this before touching it. The extraction tools are wrapped by
 * `scopeToRoot` in sandbox.ts, which confines **`params.path` and nothing else**.
 * A destination is a *second* path argument, so it arrives with no confinement at
 * all: everything that keeps it inside the writable zone is here. Getting this
 * wrong hands a read-only sandbox a way to write, which is the escalation the
 * sandbox exists to prevent.
 *
 * The checks are the same primitives `fileBrowser.ts` uses for the browser's own
 * writes — never a second implementation of path confinement.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isWithin, realResolve } from "./sandbox.ts";

/** How much of the extraction reached the file, for the summary that replaces it. */
export interface ExtractionCoverage {
  /** "42 pages" / "107 blocks" — the unit is the reader's, not this module's. */
  covered: string;
  /** Opening lines, so the caller can confirm what landed without reading it back. */
  excerpt: string;
}

export interface WriteExtractionOptions {
  /** Paths are resolved against this, as the source path is. */
  cwd: string;
  /**
   * Zone a destination must land in. `null` means writing is disabled — a
   * read-only sandbox — and every destination is refused.
   */
  writableRoot: string | null;
}

/**
 * Check a destination before any work is done for it.
 *
 * Called before extraction starts: refusing after parsing a 300-page document
 * wastes the parse, and the answer is knowable up front. The authoritative check
 * is still the `wx` write below — this one only fails earlier.
 *
 * Refusals are thrown as plain Errors: the tool surface turns them into the
 * message the model reads, and every one of them says that ordinary extraction
 * still works, so a refused destination never looks like a broken tool.
 */
export async function assertWritableDestination(
  destination: string,
  options: WriteExtractionOptions,
): Promise<string> {
  if (options.writableRoot === null) {
    throw new Error(
      `Cannot write "${destination}": this sandbox is read-only. Ask for the extraction itself instead.`,
    );
  }

  const resolved = await realResolve(path.resolve(options.cwd, destination));
  if (!isWithin(options.writableRoot, resolved)) {
    throw new Error(
      `Cannot write "${destination}": it is outside the writable zone (${options.writableRoot}). ` +
        `Ask for the extraction itself, or choose a path inside that zone.`,
    );
  }
  return resolved;
}

export async function writeExtraction(
  destination: string,
  markdown: string,
  options: WriteExtractionOptions,
): Promise<{ path: string; bytes: number }> {
  const resolved = await assertWritableDestination(destination, options);
  const bytes = Buffer.byteLength(markdown, "utf8");
  try {
    // "wx" does the existence check and the creation in one syscall: no window in
    // which the path could appear, and no chance of overwriting someone's file.
    await fs.writeFile(resolved, markdown, { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new Error(`"${destination}" already exists; extraction writes to a new file only. Choose another path.`);
    }
    if (code === "ENOENT") {
      throw new Error(`The folder for "${destination}" does not exist.`);
    }
    throw new Error(`Cannot write "${destination}": ${(error as Error).message}`);
  }

  return { path: destination, bytes };
}

/** The answer a writing call returns — deliberately not the content. */
export function extractionSummary(
  written: { path: string; bytes: number },
  coverage: ExtractionCoverage,
): string {
  return [
    `Wrote ${coverage.covered} to \`${written.path}\` (${written.bytes} bytes).`,
    "",
    "Opening lines:",
    "",
    "```markdown",
    coverage.excerpt,
    "```",
    "",
    `Read \`${written.path}\` for the rest — it is a workspace file like any other.`,
  ].join("\n");
}

/** First lines of the extraction, capped so the summary stays a summary. */
export function excerptOf(markdown: string, maxChars = 600): string {
  const trimmed = markdown.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n…`;
}
