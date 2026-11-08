/** Types for coverageConfig.mjs. */

export const COVERAGE_ROOTS: string[];
export const COVERAGE_EXCLUSIONS: { pattern: string; reason: string }[];
export const COVERAGE_THRESHOLDS: { lines: number; statements: number; branches: number; functions: number };
export function c8ReportArgs(options: {
  tempDirectory: string;
  reportsDirectory: string;
  roots?: string[];
  exclusions?: { pattern: string; reason: string }[];
  thresholds?: Partial<Record<"lines" | "statements" | "branches" | "functions", number>>;
}): string[];
export function inInventory(file: string): boolean;
export function missingFromReport(summary: Record<string, unknown>, tracked: string[], repoRoot: string): string[];
