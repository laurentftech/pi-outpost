import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { filterCoverageDir, filterCoverageFile, isUnder, SERVER_SRC, SHARED_SRC } from "./coverageFilter.mjs";

const OURS = pathToFileURL(path.join(SERVER_SRC, "index.ts")).href;
const SHARED = pathToFileURL(path.join(SHARED_SRC, "protocol.ts")).href;
const PDFJS = pathToFileURL(path.join(SERVER_SRC, "..", "..", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")).href;

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-outpost-coverage-filter-"));
  dirs.push(dir);
  return dir;
}

const entry = (url: string) => ({ scriptId: "1", url, functions: [{ functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] }] });

test("isUnder accepts the server's and shared sources and nothing beside them", () => {
  assert.equal(isUnder(OURS), true);
  assert.equal(isUnder(SHARED), true);
  assert.equal(isUnder(PDFJS), false);
  assert.equal(isUnder(pathToFileURL(SERVER_SRC).href), false, "the directory itself is not a source file");
  assert.equal(isUnder(OURS, SHARED_SRC), false, "roots narrow what is kept");
  assert.equal(isUnder(pathToFileURL(`${SERVER_SRC}-other${path.sep}x.ts`).href), false, "a sibling sharing the prefix is not inside");
  assert.equal(isUnder("node:internal/main/run_main_module"), false);
});

// openlore: scenario=LargeDependencyDoesNotInflateCoverageData spec=test-coverage
test("LargeDependencyDoesNotInflateCoverageData: only server/src and shared/src entries and source maps survive", async () => {
  const dir = await scratch();
  const file = path.join(dir, "coverage-1-1-0.json");
  const bigMap = { lineLengths: Array(200_000).fill(80), data: { version: 3, mappings: "A".repeat(200_000) } };
  await writeFile(
    file,
    JSON.stringify({
      result: [entry(OURS), entry(PDFJS), entry(SHARED), entry("node:internal/fs/utils")],
      "source-map-cache": { [OURS]: { lineLengths: [80], data: { version: 3 } }, [PDFJS]: bigMap },
    }),
  );
  const outcome = await filterCoverageFile(file);
  assert.equal(outcome.status, "kept");
  assert.ok(outcome.after < outcome.before / 10, `${outcome.after} bytes left of ${outcome.before}`);
  const kept = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(kept.result.map((r: { url: string }) => r.url), [OURS, SHARED]);
  assert.deepEqual(Object.keys(kept["source-map-cache"]), [OURS]);
});

test("a file with nothing under server/src is removed", async () => {
  const dir = await scratch();
  const file = path.join(dir, "coverage-2-1-0.json");
  await writeFile(file, JSON.stringify({ result: [entry(PDFJS)] }));
  assert.equal((await filterCoverageFile(file)).status, "empty");
  assert.deepEqual(await readdir(dir), []);
});

// openlore: scenario=UnreadableChildCoverageIsReported spec=test-coverage
test("UnreadableChildCoverageIsReported: a truncated file is set aside and named, not thrown on", async () => {
  const dir = await scratch();
  await writeFile(path.join(dir, "coverage-3-1-0.json"), JSON.stringify({ result: [entry(OURS)] }));
  await writeFile(path.join(dir, "coverage-4-1-0.json"), '{"result":[{"scriptId":"1","url":"file:///x');
  const summary = await filterCoverageDir(dir);
  assert.equal(summary.kept, 1);
  assert.deepEqual(summary.unreadable, ["coverage-4-1-0.json"]);
  assert.deepEqual((await readdir(dir)).sort(), ["coverage-3-1-0.json", "coverage-4-1-0.json.unreadable"]);
});

test("filterCoverageDir touches only the files its match accepts", async () => {
  const dir = await scratch();
  await writeFile(path.join(dir, "coverage-5-1-0.json"), JSON.stringify({ result: [entry(PDFJS)] }));
  await writeFile(path.join(dir, "coverage-6-1-0.json"), JSON.stringify({ result: [entry(PDFJS)] }));
  const summary = await filterCoverageDir(dir, { match: (name) => name.startsWith("coverage-5-") });
  assert.equal(summary.empty, 1);
  assert.deepEqual(await readdir(dir), ["coverage-6-1-0.json"]);
});
