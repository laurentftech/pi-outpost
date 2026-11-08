#!/usr/bin/env node
/**
 * `npm run test:coverage --workspace server`: every server suite, unit and integration,
 * with V8 coverage, reported over the inventory in test/coverageConfig.mjs.
 *
 * The test processes get NODE_V8_COVERAGE from here; the servers the harness starts get
 * the same directory through PI_OUTPOST_TEST_COVERAGE_DIR (see test/childEnv.mjs), write
 * their coverage when stop() ends them, and have it cut down to the inventory's roots at
 * once. Nothing here goes through node's own coverage reporter, which is what used to
 * truncate on large files: c8 reads the filtered files and maps them through tsx's source
 * maps. Linux only — Windows ends a server with `taskkill /F`, which leaves it no exit to
 * write its coverage on.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COVERAGE_DIR_VARIABLE } from "../test/childEnv.mjs";
import { c8ReportArgs, COVERAGE_EXCLUSIONS, COVERAGE_ROOTS, missingFromReport } from "../test/coverageConfig.mjs";
import { filterCoverageDir } from "../test/coverageFilter.mjs";

if (process.platform === "win32") {
  console.error("test:coverage runs on Linux and macOS only: on Windows the harness kills servers before they can write coverage.");
  process.exit(2);
}

const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = path.resolve(serverRoot, "..");
const reportsDirectory = path.join(serverRoot, "coverage");
const tempDirectory = path.join(reportsDirectory, "v8");
rmSync(reportsDirectory, { recursive: true, force: true });
mkdirSync(tempDirectory, { recursive: true });

// The same suites, batching and timeout as `npm test`, with dependencies' source maps kept
// out of the test processes' files from the start.
const tests = spawnSync(process.execPath, ["scripts/test.mjs", "--import", "./test/stripDependencySourceMaps.mjs"], {
  cwd: serverRoot,
  stdio: "inherit",
  env: { ...process.env, NODE_V8_COVERAGE: tempDirectory, [COVERAGE_DIR_VARIABLE]: tempDirectory },
});
if (tests.error) throw tests.error;

// The servers' files were filtered as each one stopped; this catches the test processes'
// own files and any server a test ended itself.
const filtered = await filterCoverageDir(tempDirectory);
console.log(
  `[coverage] ${filtered.kept} coverage files kept, ${filtered.empty} with nothing to measure; ` +
    `${(filtered.before / 1e6).toFixed(0)} MB cut to ${(filtered.after / 1e6).toFixed(0)} MB`,
);
if (filtered.unreadable.length > 0) {
  console.warn(`[coverage] ${filtered.unreadable.length} unreadable coverage files set aside (a process killed mid-write): ${filtered.unreadable.join(", ")}`);
}
console.log(`[coverage] excluded from the inventory:\n${COVERAGE_EXCLUSIONS.map(({ pattern, reason }) => `  ${pattern} — ${reason}`).join("\n")}`);

const c8 = createRequire(import.meta.url).resolve("c8/bin/c8.js");
const report = spawnSync(process.execPath, [c8, ...c8ReportArgs({ tempDirectory, reportsDirectory })], { cwd: repoRoot, stdio: "inherit" });
if (report.error) throw report.error;

// The raw files are large and only the reports are kept.
rmSync(tempDirectory, { recursive: true, force: true });

// Every inventory file must be in the report, loaded or not: a file missing from it would
// leave the total, which is exactly what the inventory is there to prevent.
const tracked = execFileSync("git", ["ls-files", "-z", "--", ...COVERAGE_ROOTS], { cwd: repoRoot, encoding: "utf8" }).split("\0").filter(Boolean);
const summary = JSON.parse(readFileSync(path.join(reportsDirectory, "coverage-summary.json"), "utf8"));
const missing = missingFromReport(summary, tracked, repoRoot);
if (missing.length > 0) {
  console.error(`[coverage] inventory files missing from the report: ${missing.join(", ")}`);
  process.exitCode = 1;
}
if (tests.status !== 0) process.exitCode = tests.status ?? 1;
else if (report.status !== 0) process.exitCode = report.status ?? 1;
