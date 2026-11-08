#!/usr/bin/env node
/**
 * Merge the coverage the suites left behind into one report, per scope.
 *
 *   node scripts/coverage-report.mjs            # server/coverage/raw + ui/coverage/raw → coverage/
 *
 * Each input is monocart-coverage-reports raw data: the server's from
 * `npm run test:coverage --workspace server`, the UI's from `npm run test:coverage --workspace ui`.
 * MCR merges the raw V8 data of every process before converting it, so a `shared/src` file run
 * by server and UI suites gets one total and the union of their hits, and it converts by syntax
 * tree, so only lines of code count. Files no suite loaded are added at 0%.
 *
 * Writes `coverage/coverage-scopes.json` (per scope and per file, read by
 * scripts/coverage-summary.mjs and scripts/coverage-badge.mjs) and `coverage/lcov.info` for
 * editors and other tools. Fails when a scope falls below its thresholds or an inventory file
 * is missing from the report.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COVERAGE_EXCLUSIONS, COVERAGE_SCOPES, inInventory, REPO, repoRelative, repoSourcePath, scopeOf } from "./coverage-config.mjs";

const { MCR } = createRequire(import.meta.url)("monocart-coverage-reports");
/**
 * What the report measures. Not statements: the converter counts them from the generated
 * code's lines, and tsx emits each module on one line while Vite does not, so the same file
 * gets 2 statements from one side and 67 from the other. Functions and branches come from the
 * syntax tree, and lines are mapped back to the source, so those three agree across sides.
 */
export const MEASURES = ["lines", "branches", "functions"];

const empty = () => Object.fromEntries(MEASURES.map((measure) => [measure, { covered: 0, total: 0 }]));
const pct = ({ covered, total }) => (total === 0 ? 100 : (covered / total) * 100);

/**
 * Turn the NODE_V8_COVERAGE files in `v8Directory` into MCR raw data under `<outputDir>/raw`,
 * keeping the scripts `keep` accepts (absolute paths) and naming sources from `baseDir`.
 * The server's coverage run uses it; a test uses it to build fixture inputs.
 *
 * A V8 coverage file holds byte ranges into the code V8 ran, not that code. For TypeScript
 * that code is tsx's output, which the coverage hook (server/test/stripDependencySourceMaps.mjs)
 * keeps under `<v8Directory>/sources/`; it is handed to the converter here, so functions,
 * statements and branches are read from the JavaScript that ran, and mapped back to the
 * TypeScript through its source map. Without it the converter would parse the `.ts` on disk,
 * which is not JavaScript and not what the ranges point into.
 */
export async function convertV8ToRaw({ v8Directory, outputDir, keep, baseDir = REPO, name = "suites" }) {
  const fromUrl = (url) => {
    try {
      return url.startsWith("file:") ? fileURLToPath(url) : undefined;
    } catch {
      return undefined;
    }
  };
  const ran = new Map();
  const sources = path.join(v8Directory, "sources");
  if (existsSync(sources)) {
    for (const file of readdirSync(sources)) {
      const { url, source } = JSON.parse(readFileSync(path.join(sources, file), "utf8"));
      ran.set(url, [...(ran.get(url) ?? []), source]);
    }
  }
  const mcr = MCR({
    name,
    outputDir,
    baseDir,
    reports: ["raw"],
    cleanCache: true,
    entryFilter: (entry) => typeof entry.url === "string" && fromUrl(entry.url) !== undefined && keep(fromUrl(entry.url)),
    sourceFilter: (file) => keep(path.resolve(baseDir, file)),
    onEntry: (entry) => {
      const candidates = ran.get(entry.url);
      if (!candidates) return;
      // Normally one; if the file changed during the run, the one whose length fits the ranges.
      const end = Math.max(0, ...entry.functions.flatMap((fn) => fn.ranges.map((range) => range.endOffset)));
      entry.source = candidates.find((source) => source.length === end) ?? candidates.find((source) => source.length >= end) ?? candidates[0];
    },
  });
  await mcr.addFromDir(v8Directory);
  return (await mcr.generate())?.summary;
}

/**
 * A file no suite loaded reaches the converter as its TypeScript source, which it cannot parse
 * into functions and branches; compiled here to JavaScript with its source map, it counts with
 * all its functions and branches uncovered, not only its lines.
 */
async function untestedToJavaScript(entry) {
  const file = fileURLToPath(entry.url);
  if (!/\.(?:[cm]?ts|tsx)$/.test(file)) return;
  const { transform } = createRequire(import.meta.url)("esbuild");
  const { code, map } = await transform(entry.source, { loader: file.endsWith("x") ? "tsx" : "ts", format: "esm", sourcemap: "external", sourcefile: file, jsx: "automatic" });
  entry.source = code;
  entry.sourceMap = JSON.parse(map);
}

const BASE64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((char, index) => [char, index]));

/** The original (0-based) lines a source map's mappings point at. */
function mappedLines(mappings) {
  const lines = new Set();
  let original = 0;
  for (const line of mappings.split(";")) {
    for (const segment of line.split(",")) {
      if (segment === "") continue;
      const values = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = BASE64[char];
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      // [generated column, source, original line, original column, name]: the line is a delta.
      if (values.length >= 4) {
        original += values[2];
        lines.add(original);
      }
    }
  }
  return lines;
}

/**
 * The 1-based lines of a source file that produce code: what compiling it maps back to.
 * Comments, blank lines and everything TypeScript erases — interfaces, type aliases,
 * `import type`, annotations on a line of their own — produce none, so they are neither
 * covered nor uncovered lines.
 */
export function codeLines(file, source) {
  const { transformSync } = createRequire(import.meta.url)("esbuild");
  const loader = file.endsWith(".tsx") ? "tsx" : /\.[cm]?ts$/.test(file) ? "ts" : "js";
  const { map } = transformSync(source, { loader, format: "esm", sourcemap: "external", sourcefile: file, jsx: "automatic" });
  return new Set([...mappedLines(JSON.parse(map).mappings)].map((line) => line + 1));
}

/**
 * A file's line coverage over its lines of code. The converter reports a count per line it
 * considers (`data.lines`: a number, or "covered/total" for a line partly run); it also counts
 * lines that produce no code, as covered. Those are dropped here.
 */
function lineCoverage(file, absolute) {
  const code = codeLines(absolute, readFileSync(absolute, "utf8"));
  let covered = 0;
  let total = 0;
  for (const [line, count] of Object.entries(file.data?.lines ?? {})) {
    if (!code.has(Number(line))) continue;
    total += 1;
    if (typeof count === "string" ? !count.startsWith("0/") : count > 0) covered += 1;
  }
  return { covered, total };
}

/**
 * Convert and merge `inputDirs` (MCR raw directories) over the inventory. The scopes and the
 * exclusion-aware `scopeFor` come from coverage-config.mjs unless a test passes its own.
 * Returns the scopes with their totals and files, and the threshold failures.
 */
export async function buildReport({ inputDirs, outputDir, baseDir = REPO, scopes = COVERAGE_SCOPES, scopeFor = scopeOf }) {
  const inputs = inputDirs.filter((dir) => existsSync(dir));
  const keep = (file) => scopeFor(path.resolve(baseDir, repoSourcePath(file))) !== undefined;
  const mcr = MCR({
    name: "pi-outpost coverage",
    outputDir,
    baseDir,
    inputDir: inputs,
    reports: [["lcovonly", { file: "lcov.info" }]],
    cleanCache: true,
    sourceFilter: keep,
    sourcePath: (file) => repoSourcePath(file),
    all: { dir: scopes.map(({ root }) => path.resolve(baseDir, root)), filter: (file) => keep(file), transformer: untestedToJavaScript },
  });
  const results = await mcr.generate();
  const byScope = new Map(scopes.map((scope) => [scope.name, { ...scope, totals: empty(), files: [] }]));
  for (const file of results?.files ?? []) {
    const absolute = path.resolve(baseDir, file.sourcePath);
    const scope = scopeFor(absolute);
    if (!scope) continue;
    const entry = byScope.get(scope.name);
    const summary = Object.fromEntries(MEASURES.map((measure) => [measure, { covered: file.summary[measure].covered, total: file.summary[measure].total }]));
    summary.lines = lineCoverage(file, absolute);
    for (const measure of MEASURES) {
      entry.totals[measure].covered += summary[measure].covered;
      entry.totals[measure].total += summary[measure].total;
    }
    entry.files.push({ path: path.relative(baseDir, absolute).split(path.sep).join("/"), summary });
  }
  const report = [...byScope.values()];
  const failures = report.flatMap(({ name, thresholds, totals }) =>
    Object.entries(thresholds)
      .filter(([measure, minimum]) => pct(totals[measure]) < minimum)
      .map(([measure, minimum]) => `${name} ${measure} ${pct(totals[measure]).toFixed(2)}% is below ${minimum}%`),
  );
  return { scopes: report, failures };
}

/**
 * Inventory files (repository-relative) the report does not list. A file with no line of code
 * — only types — produces nothing to run or to measure, so the converter leaves it out and it
 * is not owed.
 */
export function missingFromReport(report, tracked, baseDir = REPO) {
  const reported = new Set(report.scopes.flatMap(({ files }) => files.map((file) => file.path)));
  return tracked
    .filter(inInventory)
    .filter((file) => !reported.has(file))
    .filter((file) => {
      const absolute = path.resolve(baseDir, file);
      return !existsSync(absolute) || codeLines(absolute, readFileSync(absolute, "utf8")).size > 0;
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const outputDir = path.join(REPO, "coverage");
  mkdirSync(outputDir, { recursive: true });
  const report = await buildReport({ inputDirs: [path.join(REPO, "server", "coverage", "raw"), path.join(REPO, "ui", "coverage", "raw")], outputDir });
  writeFileSync(path.join(outputDir, "coverage-scopes.json"), `${JSON.stringify(report, null, 1)}\n`);
  for (const { name, totals } of report.scopes) {
    console.log(`[coverage] ${name}: ${MEASURES.map((measure) => `${measure} ${pct(totals[measure]).toFixed(2)}% (${totals[measure].covered}/${totals[measure].total})`).join(", ")}`);
  }
  console.log(`[coverage] excluded from the inventory:\n${COVERAGE_EXCLUSIONS.map(({ pattern, reason }) => `  ${pattern} — ${reason}`).join("\n")}`);
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...COVERAGE_SCOPES.map(({ root }) => root)], { cwd: REPO, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const missing = missingFromReport(report, tracked);
  if (missing.length > 0) console.error(`[coverage] inventory files missing from the report: ${missing.join(", ")}`);
  for (const failure of report.failures) console.error(`[coverage] ${failure}`);
  if (missing.length > 0 || report.failures.length > 0) process.exitCode = 1;
}
export { repoRelative };
