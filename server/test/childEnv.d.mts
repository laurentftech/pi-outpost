/** Types for childEnv.mjs. */

/** `process.env` with the coverage sink blanked, plus `extra`. */
export function envWithoutCoverageSink(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv;

/** The variable `npm run test:coverage` sets to its coverage directory. */
export const COVERAGE_DIR_VARIABLE: "PI_OUTPOST_TEST_COVERAGE_DIR";

/** NODE_V8_COVERAGE for a server the harness starts: the coverage run's directory, or `""`. */
export function serverCoverageSink(): string;
