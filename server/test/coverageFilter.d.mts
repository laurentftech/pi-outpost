/** Types for coverageFilter.mjs. */

export const SERVER_SRC: string;
export const SHARED_SRC: string;
export const SOURCE_ROOTS: string[];

export function isUnder(url: string, roots?: string | string[]): boolean;

export interface FilterOutcome {
  status: "kept" | "empty" | "unreadable";
  file: string;
  before: number;
  after: number;
}

export function filterCoverageFile(file: string, roots?: string | string[]): Promise<FilterOutcome>;

export interface FilterSummary {
  kept: number;
  empty: number;
  unreadable: string[];
  before: number;
  after: number;
}

export function filterCoverageDir(dir: string, options?: { roots?: string | string[]; match?: (name: string) => boolean }): Promise<FilterSummary>;
