import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { c8ReportArgs, COVERAGE_EXCLUSIONS, COVERAGE_ROOTS, COVERAGE_THRESHOLDS, inInventory, missingFromReport } from "./coverageConfig.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tracked = execFileSync("git", ["ls-files", "-z", "--", ...COVERAGE_ROOTS], { cwd: REPO, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const excludedBy = (file: string) => COVERAGE_EXCLUSIONS.filter(({ pattern }) => path.posix.matchesGlob(file, pattern));
const args = c8ReportArgs({ tempDirectory: "t", reportsDirectory: "r" });
const values = (flag: string) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []));

// openlore: scenario=ExclusionsArePublishedWithTheirReason spec=test-coverage
test("ExclusionsArePublishedWithTheirReason: each exclusion has a reason and still matches a tracked file", () => {
  assert.ok(tracked.length > 100, `only ${tracked.length} tracked files under ${COVERAGE_ROOTS.join(", ")}`);
  for (const { pattern, reason } of COVERAGE_EXCLUSIONS) {
    assert.ok(reason.trim().length > 10, `${pattern} needs a reason`);
    assert.ok(tracked.some((file) => path.posix.matchesGlob(file, pattern)), `${pattern} matches no tracked file: remove it`);
  }
});

// openlore: scenario=UnlistedFileCannotBeExcludedSilently spec=test-coverage
test("UnlistedFileCannotBeExcludedSilently: the report excludes exactly the listed patterns, over both roots", () => {
  assert.deepEqual(values("--exclude"), COVERAGE_EXCLUSIONS.map(({ pattern }) => pattern));
  assert.deepEqual(values("--src"), COVERAGE_ROOTS);
  assert.deepEqual(values("--include"), COVERAGE_ROOTS.map((root) => `${root}/**`));
  assert.ok(args.includes("--all"), "files no test loads must count");
  // The files the old command left out are in the inventory now.
  for (const file of ["server/src/index.ts", "server/src/embeddedRuntime.ts", "shared/src/protocol.ts"]) {
    assert.ok(tracked.includes(file), `${file} is tracked`);
    assert.deepEqual(excludedBy(file), [], `${file} must be measured`);
  }
  // What is left out is exactly what the list names.
  const excluded = tracked.filter((file) => excludedBy(file).length > 0);
  assert.ok(excluded.includes("server/src/pdfjs-worker.d.ts"));
  assert.ok(excluded.every((file) => file.endsWith(".d.ts") || file.startsWith("shared/src/generated/")), excluded.join(", "));
});

test("the thresholds reach c8 as given", () => {
  assert.ok(args.includes("--check-coverage"));
  for (const [measure, value] of Object.entries(COVERAGE_THRESHOLDS)) assert.deepEqual(values(`--${measure}`), [String(value)]);
});

// openlore: scenario=UnloadedFileCountsAsUncovered spec=test-coverage
test("UnloadedFileCountsAsUncovered: a run whose report omits an inventory file is caught", () => {
  const file = (relative: string) => path.join(REPO, relative);
  const summary = { total: {}, [file("server/src/index.ts")]: {}, [file("shared/src/protocol.ts")]: {} };
  const inventory = ["server/src/index.ts", "shared/src/protocol.ts", "server/src/neverImported.ts", "server/src/pdfjs-worker.d.ts", "shared/src/generated/structuredExchangeCheck.ts", "server/test/harness.mjs"];
  // Excluded and out-of-root files are not owed; an unloaded source file is.
  assert.deepEqual(missingFromReport(summary, inventory, REPO), ["server/src/neverImported.ts"]);
});

// openlore: scenario=CentralEntryPointIsMeasured spec=test-coverage
test("CentralEntryPointIsMeasured: index.ts is in the inventory the report must account for", () => {
  assert.equal(inInventory("server/src/index.ts"), true);
  assert.equal(inInventory("server/src/embeddedRuntime.ts"), true);
  assert.deepEqual(missingFromReport({ total: {} }, ["server/src/index.ts"], REPO), ["server/src/index.ts"]);
});
