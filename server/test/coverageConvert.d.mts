/** Types for coverageConvert.mjs. */

/** Convert the V8 files in `v8Directory` into MCR raw data under `<outputDir>/raw`; resolves to MCR's summary. */
export function convertServerCoverage(v8Directory: string, outputDir: string): Promise<Record<string, { covered: number; total: number; pct: number }> | undefined>;
