/**
 * Turn a coverage run's filtered NODE_V8_COVERAGE files into monocart-coverage-reports raw
 * data, the form scripts/coverage-report.mjs merges with the UI's.
 *
 * Sources are named from the repository root, as the UI's are, so the same `shared/src` file
 * from both sides is one file in the merge.
 */
import { convertV8ToRaw } from "../../scripts/coverage-report.mjs";
import { isUnder } from "./coverageFilter.mjs";

/** Convert the V8 files in `v8Directory` into MCR raw data under `<outputDir>/raw`. */
export function convertServerCoverage(v8Directory, outputDir) {
  return convertV8ToRaw({ v8Directory, outputDir, keep: (file) => isUnder(file), name: "server suites" });
}
