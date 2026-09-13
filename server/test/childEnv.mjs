/**
 * The environment a test hands to a child `node` process.
 *
 * Under `--experimental-test-coverage` node exports NODE_V8_COVERAGE, and every
 * process that inherits it writes its own coverage file into the directory the
 * parent reads after the run. Node writes that file with a single write at exit and
 * the reporter parses every file there, so one that comes out truncated — a child
 * killed at its timeout, or a large write cut short — fails a run in which every test
 * passed: "failed to parse coverage file … Unterminated string in JSON".
 *
 * The files are large when the child loads pdf.js: tsx attaches source maps to it and
 * node embeds them in the coverage file, about ten megabytes per process — exactly
 * where the CI failures were cut. A child's coverage is never ours to claim anyway:
 * the process is measured, not the source.
 *
 * harness.mjs and the update and startup suites already strip it for the servers they
 * start; this is the same rule for every other child a test runs.
 */

/**
 * `process.env` with the coverage sink blanked, plus `extra`.
 *
 * Blanked, not deleted: node's child_process copies the parent's NODE_V8_COVERAGE into
 * a child's environment whenever that environment does not name it, so a deleted key
 * comes straight back. An empty value is kept, and turns coverage off in the child.
 */
export function envWithoutCoverageSink(extra = {}) {
  return { ...process.env, ...extra, NODE_V8_COVERAGE: "" };
}
