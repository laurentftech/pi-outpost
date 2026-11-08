import assert from "node:assert/strict";
import test from "node:test";
import { COVERAGE_EXCLUSIONS } from "./coverage-config.mjs";
import { renderSummary } from "./coverage-summary.mjs";

const metric = (covered, total) => ({ covered, total });
const metrics = (covered, total) => ({ lines: metric(covered, total), branches: metric(1, 4), functions: metric(3, 3) });
const report = {
  scopes: [
    {
      name: "server",
      root: "server/src",
      totals: metrics(41615, 43843),
      files: [
        { path: "server/src/index.ts", summary: metrics(6912, 7771) },
        { path: "server/src/neverImported.ts", summary: metrics(0, 10) },
      ],
    },
    { name: "shared", root: "shared/src", totals: metrics(127, 160), files: [{ path: "shared/src/docx/mathmlToOmml.ts", summary: metrics(127, 160) }] },
    { name: "ui", root: "ui/src", totals: metrics(0, 0), files: [] },
  ],
};

// openlore: scenario=SummaryShowsNumeratorAndDenominator spec=test-coverage
test("SummaryShowsNumeratorAndDenominator: lines, branches and functions show covered/total, per scope and per file", () => {
  const markdown = renderSummary(report);
  const row = markdown.split("\n").find((line) => line.startsWith("| **server**"));
  assert.ok(row, markdown);
  assert.match(row, /94\.9% \(41615\/43843\).*25\.0% \(1\/4\).*100\.0% \(3\/3\)/);
  assert.match(markdown, /\| \*\*shared\*\* \(`shared\/src`\) \| .*79\.4% \(127\/160\)/);
  assert.match(markdown, /\| lines \| branches \| functions \|/);
  assert.doesNotMatch(markdown, /statements/, "statements are not comparable across the two pipelines");
  // Per file, by repository path, an unloaded file first.
  assert.match(markdown, /\| `server\/src\/neverImported\.ts` \| 0\.0% \(0\/10\)[^\n]*\n\| `server\/src\/index\.ts` \| 88\.9% \(6912\/7771\)/);
  assert.match(markdown, /<strong>shared<\/strong> — per file[\s\S]*`shared\/src\/docx\/mathmlToOmml\.ts`/);
  // A scope with nothing to measure says so rather than inventing a percentage.
  assert.match(markdown, /\| \*\*ui\*\* \(`ui\/src`\) \| +— \(0\/0\)/);
});

// openlore: scenario=ExcludedFileIsNamedInTheSummary spec=test-coverage
test("ExcludedFileIsNamedInTheSummary: the summary names every exclusion and its reason", () => {
  const markdown = renderSummary(report);
  for (const { pattern, reason } of COVERAGE_EXCLUSIONS) assert.ok(markdown.includes(`\`${pattern}\` — ${reason}`), pattern);
  assert.match(markdown, /Only lines of code count/);
});

test("a run without a merged report is said, not left blank", () => {
  assert.match(renderSummary(undefined), /No merged coverage report/);
});
