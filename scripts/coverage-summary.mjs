/**
 * Turn the merged coverage report into a markdown table for the GitHub Actions run summary.
 *
 *   node scripts/coverage-summary.mjs coverage/coverage-scopes.json
 *
 * Writes to $GITHUB_STEP_SUMMARY when set, stdout otherwise, so the same command is useful
 * locally. The report is scripts/coverage-report.mjs's: one entry per scope (`server/src`,
 * `shared/src`, `ui/src`), each with its totals and its files. Every percentage comes with the
 * covered and total counts behind it, for lines, branches and functions (not statements: see
 * MEASURES in coverage-report.mjs); the files
 * the inventory leaves out are listed with their reason.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { COVERAGE_EXCLUSIONS } from "./coverage-config.mjs";

export { MEASURES } from "./coverage-report.mjs";
import { MEASURES } from "./coverage-report.mjs";

const pct = ({ covered, total }) => (total === 0 ? null : (covered / total) * 100);
const show = (value) => (value === null ? "—" : `${value.toFixed(1)}%`);
const counted = (metric) => `${show(pct(metric))} (${metric.covered}/${metric.total})`;

/** Green above 80, amber above 60, red below — a glance should be enough. */
function badge(value) {
  if (value === null) return "";
  if (value >= 80) return "🟢";
  if (value >= 60) return "🟡";
  return "🔴";
}

/** The markdown for a merged report, or a line saying there is none. */
export function renderSummary(report) {
  if (!report) return "## Coverage\n\n> No merged coverage report: coverage not reported for this run.\n";
  const out = ["## Coverage\n"];
  out.push(`| scope | ${MEASURES.join(" | ")} |`);
  out.push(`| --- |${MEASURES.map(() => " ---: |").join("")}`);
  for (const { name, root, totals } of report.scopes) {
    out.push(`| **${name}** (\`${root}\`) | ${MEASURES.map((measure) => `${badge(pct(totals[measure]))} ${counted(totals[measure])}`).join(" | ")} |`);
  }
  out.push("");
  out.push(
    "> Every file under each root counts, a file no test loads at 0%. Only lines of code count, not comments or blank lines. `shared/src` is credited by every suite that runs it, server and UI together. Left out:\n>",
  );
  for (const { pattern, reason } of COVERAGE_EXCLUSIONS) out.push(`> - \`${pattern}\` — ${reason}`);
  out.push("");
  for (const { name, files } of report.scopes) {
    out.push(`<details><summary><strong>${name}</strong> — per file</summary>\n`);
    out.push(`| file | ${MEASURES.join(" | ")} |`);
    out.push(`| --- |${MEASURES.map(() => " ---: |").join("")}`);
    for (const { path, summary } of [...files].sort((a, b) => (pct(a.summary.lines) ?? 101) - (pct(b.summary.lines) ?? 101))) {
      out.push(`| \`${path}\` | ${MEASURES.map((measure) => counted(summary[measure])).join(" | ")} |`);
    }
    out.push("\n</details>\n");
  }
  return `${out.join("\n")}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  const markdown = renderSummary(file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  else process.stdout.write(markdown);
}
