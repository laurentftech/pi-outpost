/**
 * What `npm run test:coverage --workspace server` measures, in one place.
 *
 * The inventory is every file under `server/src` and `shared/src`; a file no test loads
 * counts with all its lines uncovered. Only the patterns below are left out, each for the
 * reason it gives, and the run summary prints this list. Nothing else may exclude a file:
 * the coverage script builds its exclusions from this list alone.
 */
import path from "node:path";

const { matchesGlob } = path.posix;

/** Directories whose files make up the inventory, relative to the repository root. */
export const COVERAGE_ROOTS = ["server/src", "shared/src"];

/** Files left out of the inventory: glob relative to the repository root, and why. */
export const COVERAGE_EXCLUSIONS = [
  {
    pattern: "shared/src/generated/**",
    reason: "validators generated from the structured-exchange schema (shared/scripts/generate-structured-exchange-check.mjs), not written by hand",
  },
  { pattern: "**/*.d.ts", reason: "type declarations: no executable code" },
];

/**
 * The run fails below these, measured over the inventory. Set about a point under the first
 * two full measurements on CI (2026-11-08: lines and statements 95.0%, branches 87.3%,
 * functions 96.3%), to absorb run-to-run noise without letting a real drop through.
 */
export const COVERAGE_THRESHOLDS = { lines: 94, statements: 94, branches: 86, functions: 95 };

/**
 * The arguments for `c8 report`, run from the repository root: the inventory, the
 * exclusions above and nothing else, the reports CI reads, and the thresholds. The other
 * options exist so a test can run the same report over a fixture.
 */
export function c8ReportArgs({ tempDirectory, reportsDirectory, roots = COVERAGE_ROOTS, exclusions = COVERAGE_EXCLUSIONS, thresholds = COVERAGE_THRESHOLDS }) {
  return [
    "report",
    "--temp-directory", tempDirectory,
    "--reports-dir", reportsDirectory,
    "--all",
    ...roots.flatMap((root) => ["--src", root, "--include", `${root}/**`]),
    ...exclusions.flatMap(({ pattern }) => ["--exclude", pattern]),
    // Given any --exclude, c8 drops its default exclusions: the list above is the whole of them.
    // Applied after source maps, to the TypeScript paths the report shows.
    "--exclude-after-remap",
    "--reporter", "lcov", "--reporter", "json-summary", "--reporter", "text-summary",
    "--check-coverage",
    ...Object.entries(thresholds).flatMap(([measure, value]) => [`--${measure}`, String(value)]),
  ];
}

/** Whether a repository-relative file is in the inventory: code under a root, and not excluded. */
export function inInventory(file) {
  const posix = file.split("\\").join("/");
  if (!/\.(?:[cm]?js|[cm]?ts|tsx)$/.test(posix)) return false;
  return COVERAGE_ROOTS.some((root) => posix.startsWith(`${root}/`)) && !COVERAGE_EXCLUSIONS.some(({ pattern }) => matchesGlob(posix, pattern));
}

/**
 * The inventory files a c8 json-summary leaves out. `summary` is keyed by absolute path;
 * `tracked` lists repository-relative files. Empty when every file is reported, loaded or not.
 */
export function missingFromReport(summary, tracked, repoRoot) {
  const fold = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  const reported = new Set(Object.keys(summary).filter((key) => key !== "total").map((file) => fold(path.resolve(file))));
  return tracked.filter(inInventory).filter((file) => !reported.has(fold(path.resolve(repoRoot, file))));
}
