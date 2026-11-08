/**
 * The report the coverage run produces, on real V8 data: two processes that each run part
 * of a module, one module nothing loads, and thresholds above and below what they reach.
 * The report is c8 with the arguments the coverage run passes (coverageConfig.mjs), over
 * a fixture instead of the repository, so the figures are known in advance.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { envWithoutCoverageSink } from "./childEnv.mjs";
import { c8ReportArgs } from "./coverageConfig.mjs";

const C8 = createRequire(import.meta.url).resolve("c8/bin/c8.js");
let base;
let v8;

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), "pi-outpost-coverage-report-"));
  v8 = path.join(base, "v8");
  await mkdir(path.join(base, "src"), { recursive: true });
  await mkdir(v8);
  await writeFile(
    path.join(base, "src", "both.mjs"),
    "export function first() {\n  return 1;\n}\n\nexport function second() {\n  return 2;\n}\n",
  );
  await writeFile(path.join(base, "src", "never.mjs"), "export function unused() {\n  return 3;\n}\n");
  // Two processes, as a unit suite and a server would be: each runs one function.
  for (const call of ["first", "second"]) {
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `const m = await import("./src/both.mjs"); m.${call}();`], {
      cwd: base,
      env: { ...process.env, NODE_V8_COVERAGE: v8 },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
  }
});
after(() => rm(base, { recursive: true, force: true }));

/** Run the coverage run's report over the fixture; returns the exit status, output and summary. */
async function report(name, thresholds) {
  const reportsDirectory = path.join(base, name);
  const run = spawnSync(process.execPath, [C8, ...c8ReportArgs({ tempDirectory: v8, reportsDirectory, roots: ["src"], exclusions: [], thresholds })], {
    cwd: base,
    env: envWithoutCoverageSink(),
    encoding: "utf8",
  });
  const summary = JSON.parse(await readFile(path.join(reportsDirectory, "coverage-summary.json"), "utf8"));
  const file = (relative) => summary[Object.keys(summary).find((key) => key.endsWith(relative))];
  return { status: run.status, output: `${run.stdout}${run.stderr}`, summary, file };
}

// openlore: scenario=UnitAndIntegrationCountsAreMerged spec=test-coverage
test("UnitAndIntegrationCountsAreMerged: a file run partly by each process is covered by both", async () => {
  const { status, file } = await report("merged", { lines: 1 });
  assert.equal(status, 0);
  const both = file(`src${path.sep}both.mjs`) ?? file("src/both.mjs");
  assert.deepEqual([both.functions.covered, both.functions.total], [2, 2], "each process ran one of the two functions");
  assert.equal(both.lines.pct, 100);
});

test("a module nothing loads is reported at 0% and counted in the total", async () => {
  const { summary, file } = await report("unloaded", { lines: 1 });
  const never = file(`src${path.sep}never.mjs`) ?? file("src/never.mjs");
  assert.ok(never, "the unloaded module is missing from the report");
  assert.equal(never.lines.covered, 0);
  assert.ok(never.lines.total > 0);
  assert.ok(summary.total.lines.total > (file(`src${path.sep}both.mjs`) ?? file("src/both.mjs")).lines.total, "its lines are in the total");
});

// openlore: scenario=CoverageBelowThresholdFailsCi spec=test-coverage
test("CoverageBelowThresholdFailsCi: a measure below its threshold fails the report and is named", async () => {
  const { status, output, summary } = await report("short", { lines: 1, branches: 1, functions: 99 });
  assert.ok(summary.total.functions.pct < 99, "the fixture must fall short of the threshold it is given");
  assert.notEqual(status, 0, output);
  assert.match(output, /functions/i);
});
