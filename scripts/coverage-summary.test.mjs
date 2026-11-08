import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { COVERAGE_EXCLUSIONS } from "../server/test/coverageConfig.mjs";
import { renderSummary } from "./coverage-summary.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metric = (covered, total) => ({ covered, total, skipped: 0, pct: total ? (covered / total) * 100 : 100 });
const metrics = (covered, total) => ({ lines: metric(covered, total), statements: metric(covered, total), branches: metric(1, 4), functions: metric(3, 3) });
const server = {
  total: metrics(41615, 43843),
  [path.join(REPO, "server", "src", "index.ts")]: metrics(6912, 7771),
  [path.join(REPO, "server", "src", "neverImported.ts")]: metrics(0, 10),
};

// openlore: scenario=SummaryShowsNumeratorAndDenominator spec=test-coverage
test("SummaryShowsNumeratorAndDenominator: every measure shows covered/total and the percentage", () => {
  const markdown = renderSummary([{ name: "server", summary: server }]);
  const row = markdown.split("\n").find((line) => line.startsWith("| **server**"));
  assert.ok(row, markdown);
  assert.match(row, /94\.9% \(41615\/43843\).*94\.9% \(41615\/43843\).*25\.0% \(1\/4\).*100\.0% \(3\/3\)/);
  assert.match(markdown, /\| lines \| statements \| branches \| functions \|/);
  // Per file, by repository path, an unloaded file included.
  assert.match(markdown, /\| `server\/src\/neverImported\.ts` \| 0\.0% \(0\/10\)/);
  assert.match(markdown, /\| `server\/src\/index\.ts` \| 88\.9% \(6912\/7771\)/);
});

// openlore: scenario=ExcludedFileIsNamedInTheSummary spec=test-coverage
test("ExcludedFileIsNamedInTheSummary: the summary names every exclusion and its reason", () => {
  const markdown = renderSummary([{ name: "server", summary: server }]);
  for (const { pattern, reason } of COVERAGE_EXCLUSIONS) assert.ok(markdown.includes(`\`${pattern}\` — ${reason}`), pattern);
  assert.doesNotMatch(markdown, /measured apart|unit suites\. `server\/src\/index\.ts`/, "index.ts is no longer set aside");
});

test("a workspace without a summary is said, not dropped", () => {
  assert.match(renderSummary([{ name: "ui", summary: undefined }]), /`ui`: no coverage summary/);
});
