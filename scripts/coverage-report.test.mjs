/**
 * The merged coverage report, on real V8 data from two processes: one stands for the server
 * suites, one for the UI suites. Both run part of the same `shared/src` file, converted and
 * merged as the coverage run does it, so the expected figures are known in advance.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { buildReport, codeLines, convertV8ToRaw, missingFromReport } from "./coverage-report.mjs";
import { inInventory } from "./coverage-config.mjs";

// Line numbers matter: 2, 4 and 7 are a comment, a blank line and a comment.
const SHARED = `export function first() {
  // a comment inside a function the tests run
  const a = 1;

  return a;
}
// a comment between functions
export function second() {
  return 2;
}
export function onlyTheUi() {
  return 3;
}
`;

let base;
const scope = { name: "shared", root: "shared/src", thresholds: { lines: 1, branches: 0, functions: 1 } };
let scopeFor;

/** Run `calls` in a fresh process with coverage on; convert its V8 data to MCR raw under `name`. */
async function suite(name, calls) {
  const v8Directory = path.join(base, `${name}-v8`);
  await mkdir(v8Directory);
  const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `const m = await import("./shared/src/both.mjs"); ${calls.map((call) => `m.${call}();`).join(" ")}`], {
    cwd: base,
    env: { ...process.env, NODE_V8_COVERAGE: v8Directory },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const outputDir = path.join(base, name);
  await convertV8ToRaw({ v8Directory, outputDir, baseDir: base, keep: (file) => scopeFor(file) !== undefined, name });
  return path.join(outputDir, "raw");
}

let inputs;
before(async () => {
  base = await mkdtemp(path.join(tmpdir(), "pi-outpost-coverage-report-"));
  await mkdir(path.join(base, "shared", "src"), { recursive: true });
  await writeFile(path.join(base, "shared", "src", "both.mjs"), SHARED);
  await writeFile(path.join(base, "shared", "src", "never.mjs"), "export function unused() {\n  return 4;\n}\n");
  const root = path.join(base, "shared", "src");
  scopeFor = (file) => (path.resolve(file).startsWith(`${root}${path.sep}`) ? scope : undefined);
  inputs = { server: await suite("server", ["first"]), ui: await suite("ui", ["second", "onlyTheUi"]) };
});
after(() => rm(base, { recursive: true, force: true }));

async function report(name, inputDirs, thresholds = scope.thresholds) {
  const outputDir = path.join(base, `report-${name}`);
  const result = await buildReport({ inputDirs, outputDir, baseDir: base, scopes: [{ ...scope, thresholds }], scopeFor });
  const file = (relative) => result.scopes[0].files.find((entry) => entry.path === relative);
  return { ...result, file, lcov: await readFile(path.join(outputDir, "lcov.info"), "utf8") };
}

// openlore: scenario=SharedCodeRunOnlyByUiTestsIsCovered spec=test-coverage
test("SharedCodeRunOnlyByUiTestsIsCovered: a function only the UI-side process runs counts as covered", async () => {
  const serverOnly = await report("server-only", [inputs.server]);
  const merged = await report("merged-ui", [inputs.server, inputs.ui]);
  assert.ok(serverOnly.file("shared/src/both.mjs").summary.functions.covered < merged.file("shared/src/both.mjs").summary.functions.covered);
  assert.match(merged.lcov, /FNDA:[1-9]\d*,onlyTheUi/, "onlyTheUi is run, by the UI side only");
});

// openlore: scenario=SharedCountsAreTheUnionOfServerAndUiSuites spec=test-coverage
// openlore: scenario=UnitAndIntegrationCountsAreMerged spec=test-coverage
test("SharedCountsAreTheUnionOfServerAndUiSuites: one total, and the union of both sides' hits", async () => {
  const server = (await report("server", [inputs.server])).file("shared/src/both.mjs").summary;
  const ui = (await report("ui", [inputs.ui])).file("shared/src/both.mjs").summary;
  const merged = (await report("merged", [inputs.server, inputs.ui])).file("shared/src/both.mjs").summary;
  for (const measure of ["lines", "functions"]) {
    assert.equal(server[measure].total, merged[measure].total, `${measure}: one total whichever side ran the file`);
    assert.equal(ui[measure].total, merged[measure].total);
  }
  assert.deepEqual([merged.functions.covered, merged.functions.total], [3, 3], "each side ran part; together, every function");
  assert.equal(merged.lines.covered, merged.lines.total);
});

// openlore: scenario=CommentLinesAreNotCounted spec=test-coverage
test("CommentLinesAreNotCounted: comment and blank lines are neither covered nor uncovered", async () => {
  const { lcov, file } = await report("comments", [inputs.server, inputs.ui]);
  const record = lcov.split("end_of_record").find((part) => part.includes("both.mjs"));
  const lines = [...record.matchAll(/^DA:(\d+),/gm)].map((match) => Number(match[1]));
  for (const line of [2, 4, 7]) assert.ok(!lines.includes(line), `line ${line} is not code, yet it is counted`);
  assert.ok(lines.includes(3) && lines.includes(9), "code lines are counted");
  assert.ok(file("shared/src/both.mjs").summary.lines.total <= SHARED.trimEnd().split("\n").length - 3);
});

test("a file no suite loads is in the report at 0%, and a report without it is caught", async () => {
  const { file, scopes } = await report("unloaded", [inputs.server, inputs.ui]);
  const never = file("shared/src/never.mjs");
  assert.ok(never, "the unloaded file is missing from the report");
  assert.equal(never.summary.lines.covered, 0);
  assert.ok(never.summary.lines.total > 0);
  assert.ok(scopes[0].totals.lines.total >= never.summary.lines.total + file("shared/src/both.mjs").summary.lines.total);
  // missingFromReport works on the real inventory's rules.
  assert.deepEqual(missingFromReport({ scopes: [{ files: [{ path: "server/src/index.ts" }] }] }, ["server/src/index.ts", "server/src/newFile.ts", "server/src/pdfjs-worker.d.ts"]), ["server/src/newFile.ts"]);
  assert.equal(inInventory("server/src/index.ts"), true);
});

// openlore: scenario=CoverageBelowThresholdFailsCi spec=test-coverage
test("CoverageBelowThresholdFailsCi: a scope below a threshold fails, naming the scope and the measure", async () => {
  const { failures, scopes } = await report("short", [inputs.server], { lines: 1, functions: 99 });
  assert.ok(scopes[0].totals.functions.covered < scopes[0].totals.functions.total, "the fixture must fall short");
  assert.equal(failures.length, 1, failures.join("; "));
  assert.match(failures[0], /^shared functions .* is below 99%$/);
});

// openlore: scenario=CommentLinesAreNotCounted spec=test-coverage
test("only lines that produce code count: TypeScript's types, comments and blank lines do not", () => {
  const source = [
    'import type { Thing } from "./thing.ts";', // 1: erased
    'import { make } from "./make.ts";', // 2: code
    "", // 3
    "export interface Options {", // 4: erased
    "  /** A size. */", // 5
    "  size: number;", // 6: erased
    "}", // 7: erased
    "export type Pair = [number, number];", // 8: erased
    "// a comment", // 9
    "export function area(options: Options): number {", // 10: code
    "  const { size } = options;", // 11: code
    "  return size * size;", // 12: code
    "}", // 13
    "export const thing: Thing = make();", // 14: code
  ].join("\n");
  const lines = codeLines("shape.ts", source);
  for (const line of [1, 3, 4, 5, 6, 7, 8, 9]) assert.ok(!lines.has(line), `line ${line} produces no code, yet it counts`);
  for (const line of [2, 10, 11, 12, 14]) assert.ok(lines.has(line), `line ${line} is code, yet it does not count`);
  // A file of types alone has nothing to measure, so the report does not owe it.
  assert.equal(codeLines("types.ts", "export interface A { a: string }\nexport type B = A[];\n").size, 0);
});
