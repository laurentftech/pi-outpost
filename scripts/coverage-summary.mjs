/**
 * Turn coverage json-summary files into a markdown table for the GitHub Actions run summary.
 *
 *   node scripts/coverage-summary.mjs server=server/coverage/coverage-summary.json ui=ui/coverage/coverage-summary.json
 *
 * Writes to $GITHUB_STEP_SUMMARY when set, stdout otherwise, so the same command is useful
 * locally. Every percentage comes with the covered and total counts behind it, for lines,
 * statements, branches and functions, so a reader can check the arithmetic. The server's
 * figure is measured over an inventory (server/test/coverageConfig.mjs): every file under
 * server/src and shared/src, unit and integration suites together, a file no test loads at
 * 0%; the files it leaves out are listed here with their reason.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COVERAGE_EXCLUSIONS, COVERAGE_ROOTS } from "../server/test/coverageConfig.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MEASURES = ["lines", "statements", "branches", "functions"];

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

/** A json-summary path as the repository-relative path a reader recognises. */
const relative = (file) => path.relative(REPO, file).split(path.sep).join("/");

/**
 * The markdown for `inputs`: `{ name, summary }` pairs, `summary` a parsed json-summary
 * (or undefined when the workspace produced none).
 */
export function renderSummary(inputs) {
  const out = ["## Coverage\n"];
  const details = [];
  out.push(`| workspace | ${MEASURES.join(" | ")} |`);
  out.push(`| --- |${MEASURES.map(() => " ---: |").join("")}`);
  const missing = [];
  for (const { name, summary } of inputs) {
    if (!summary) {
      missing.push(name);
      continue;
    }
    out.push(`| **${name}** | ${MEASURES.map((measure) => `${badge(pct(summary.total[measure]))} ${counted(summary.total[measure])}`).join(" | ")} |`);
    const files = Object.entries(summary).filter(([key]) => key !== "total");
    details.push(`<details><summary><strong>${name}</strong> — per file</summary>\n`);
    details.push(`| file | ${MEASURES.join(" | ")} |`);
    details.push(`| --- |${MEASURES.map(() => " ---: |").join("")}`);
    for (const [file, metrics] of files.sort(([, a], [, b]) => (pct(a.lines) ?? 0) - (pct(b.lines) ?? 0))) {
      details.push(`| \`${relative(file)}\` | ${MEASURES.map((measure) => counted(metrics[measure])).join(" | ")} |`);
    }
    details.push("\n</details>\n");
  }
  out.push("");
  for (const name of missing) out.push(`> \`${name}\`: no coverage summary — coverage not reported for this workspace.\n`);
  out.push(
    `> **server**: every file under ${COVERAGE_ROOTS.map((root) => `\`${root}\``).join(" and ")}, measured over the unit and integration suites together, including the servers the integration suites start. A file no test loads counts at 0%. Left out:\n>`,
  );
  for (const { pattern, reason } of COVERAGE_EXCLUSIONS) out.push(`> - \`${pattern}\` — ${reason}`);
  out.push("");
  out.push(...details);
  return `${out.join("\n")}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const inputs = process.argv.slice(2).map((arg) => {
    const [name, file] = arg.split("=");
    return { name, summary: file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined };
  });
  const markdown = renderSummary(inputs);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  else process.stdout.write(markdown);
}
