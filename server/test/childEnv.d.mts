/** Types for childEnv.mjs. */

/** `process.env` with the coverage sink blanked, plus `extra`. */
export function envWithoutCoverageSink(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv;
