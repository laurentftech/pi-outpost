#!/usr/bin/env node
/**
 * `npm run test:coverage --workspace server`: every server suite, unit and integration, with
 * V8 coverage, converted to monocart-coverage-reports raw data in `server/coverage/raw`.
 *
 * The test processes get NODE_V8_COVERAGE from here; the servers the harness starts get the
 * same directory through PI_OUTPOST_TEST_COVERAGE_DIR (see test/childEnv.mjs), write their
 * coverage when stop() ends them, and have it cut down to `server/src` and `shared/src` at
 * once. Nothing here goes through node's own coverage reporter, which is what used to
 * truncate on large files. The figures, thresholds and inventory check come from
 * `node scripts/coverage-report.mjs`, which merges this with the UI's. Linux and macOS only —
 * Windows ends a server with `taskkill /F`, which leaves it no exit to write coverage on.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COVERAGE_DIR_VARIABLE } from "../test/childEnv.mjs";
import { convertServerCoverage } from "../test/coverageConvert.mjs";
import { filterCoverageDir } from "../test/coverageFilter.mjs";

if (process.platform === "win32") {
  console.error("test:coverage runs on Linux and macOS only: on Windows the harness kills servers before they can write coverage.");
  process.exit(2);
}

const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDir = path.join(serverRoot, "coverage");
const v8Directory = path.join(outputDir, "v8");
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(v8Directory, { recursive: true });

// The same suites, batching and timeout as `npm test`, with dependencies' source maps kept
// out of the test processes' files from the start.
const tests = spawnSync(process.execPath, ["scripts/test.mjs", "--import", "./test/stripDependencySourceMaps.mjs"], {
  cwd: serverRoot,
  stdio: "inherit",
  env: { ...process.env, NODE_V8_COVERAGE: v8Directory, [COVERAGE_DIR_VARIABLE]: v8Directory },
});
if (tests.error) throw tests.error;

// The servers' files were filtered as each one stopped; this catches the test processes'
// own files and any server a test ended itself.
const filtered = await filterCoverageDir(v8Directory);
console.log(
  `[coverage] ${filtered.kept} coverage files kept, ${filtered.empty} with nothing to measure; ` +
    `${(filtered.before / 1e6).toFixed(0)} MB cut to ${(filtered.after / 1e6).toFixed(0)} MB`,
);
if (filtered.unreadable.length > 0) {
  console.warn(`[coverage] ${filtered.unreadable.length} unreadable coverage files set aside (a process killed mid-write): ${filtered.unreadable.join(", ")}`);
}

await convertServerCoverage(v8Directory, outputDir);
// The raw V8 files are large; MCR's raw data in coverage/raw is what the report reads.
rmSync(v8Directory, { recursive: true, force: true });
process.exitCode = tests.status ?? 1;
