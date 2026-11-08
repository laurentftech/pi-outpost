/**
 * What the coverage run measures, in one place.
 *
 * Three scopes, each with its own figure and thresholds: `server/src`, `shared/src` and
 * `ui/src`. Every file under them counts — a file no test loads with all its lines uncovered —
 * except the patterns in COVERAGE_EXCLUSIONS, each for the reason it gives. The run summary
 * prints that list; nothing else may exclude a file.
 *
 * One converter, monocart-coverage-reports, turns every suite's raw V8 data into the report:
 * the server suites' (server/scripts/test-coverage.mjs) and the UI suites'
 * (ui/mcr.config.mjs, through vitest-monocart-coverage). It counts lines of code only, and it
 * merges raw data before converting, so a `shared/src` file run by both sides has one total
 * and the union of their hits. scripts/coverage-report.mjs does the merge.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The scopes, in report order, with the thresholds below which the run fails. */
export const COVERAGE_SCOPES = [
  { name: "server", root: "server/src", thresholds: { lines: 0, branches: 0, functions: 0 } },
  { name: "shared", root: "shared/src", thresholds: { lines: 0, branches: 0, functions: 0 } },
  { name: "ui", root: "ui/src", thresholds: { lines: 0, branches: 0, functions: 0 } },
];

/** Files left out of the inventory: glob relative to the repository root, and why. */
export const COVERAGE_EXCLUSIONS = [
  {
    pattern: "shared/src/generated/**",
    reason: "validators generated from the structured-exchange schema (shared/scripts/generate-structured-exchange-check.mjs), not written by hand",
  },
  { pattern: "**/*.d.ts", reason: "type declarations: no executable code" },
  { pattern: "ui/src/**/*.test.{ts,tsx}", reason: "the UI's tests themselves" },
  {
    pattern: "ui/src/{test-setup.ts,components/codeEditorTesting.ts,export/testImages.ts,export/testSupport.ts}",
    reason: "helpers only the UI's tests import",
  },
];

const CODE = /\.(?:[cm]?js|[cm]?ts|tsx)$/;

/** A path as repository-relative with forward slashes, or undefined when it is outside the repository. */
export function repoRelative(file) {
  const relative = path.relative(REPO, path.resolve(REPO, file)).split(path.sep).join("/");
  return relative.startsWith("../") || path.isAbsolute(relative) ? undefined : relative;
}

/**
 * A source path from MCR raw data, made relative to the repository root. Vite names the UI
 * workspace's own files from its root (`src/…`) and files outside it from the repository root
 * (`shared/src/…`); the server's are already from the repository root.
 */
export const repoSourcePath = (file) => {
  const posix = file.split("\\").join("/");
  return posix.startsWith("src/") ? `ui/${posix}` : posix;
};

/** The scope a file belongs to, or undefined when it is outside every scope or excluded. */
export function scopeOf(file) {
  const relative = repoRelative(file);
  if (relative === undefined || !CODE.test(relative)) return undefined;
  if (COVERAGE_EXCLUSIONS.some(({ pattern }) => path.posix.matchesGlob(relative, pattern))) return undefined;
  return COVERAGE_SCOPES.find(({ root }) => relative.startsWith(`${root}/`));
}

/** Whether a file is in the inventory: code under a scope's root, and not excluded. */
export const inInventory = (file) => scopeOf(file) !== undefined;
