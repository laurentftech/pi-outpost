/**
 * Turn lcov files into a markdown coverage table for the GitHub Actions run summary.
 *
 *   node scripts/coverage-summary.mjs server=server/coverage/lcov.info ui=ui/coverage/lcov.info
 *
 * Writes to $GITHUB_STEP_SUMMARY when set, stdout otherwise, so the same command
 * is useful locally.
 *
 * One file is deliberately singled out. server/src/index.ts is exercised only by
 * the integration tests, which spawn the server as a subprocess — the coverage
 * instrumentation does not follow it there, so it reports near zero however well
 * tested it is. Folding that into one headline number would understate the suite
 * by roughly thirty points, so it is reported apart and named.
 */
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";

/** Files whose coverage is measured elsewhere — reported, but kept out of the total. */
const SUBPROCESS_ONLY = ["src/index.ts"];

/** Parse an lcov file into per-source-file counters. */
function parseLcov(file) {
  const records = [];
  let current = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("SF:")) {
      current = { file: line.slice(3).trim(), lines: [0, 0], branches: [0, 0], functions: [0, 0] };
      records.push(current);
    } else if (current === null) {
      continue;
    } else if (line.startsWith("LF:")) current.lines[1] = Number(line.slice(3));
    else if (line.startsWith("LH:")) current.lines[0] = Number(line.slice(3));
    else if (line.startsWith("BRF:")) current.branches[1] = Number(line.slice(4));
    else if (line.startsWith("BRH:")) current.branches[0] = Number(line.slice(4));
    else if (line.startsWith("FNF:")) current.functions[1] = Number(line.slice(4));
    else if (line.startsWith("FNH:")) current.functions[0] = Number(line.slice(4));
  }
  return records;
}

const pct = (hit, found) => (found === 0 ? null : (hit / found) * 100);
const show = (value) => (value === null ? "—" : `${value.toFixed(1)}%`);

/** Green above 80, amber above 60, red below — a glance should be enough. */
function badge(value) {
  if (value === null) return "";
  if (value >= 80) return "🟢";
  if (value >= 60) return "🟡";
  return "🔴";
}

function summarise(records) {
  const total = records.reduce(
    (acc, record) => ({
      lines: [acc.lines[0] + record.lines[0], acc.lines[1] + record.lines[1]],
      branches: [acc.branches[0] + record.branches[0], acc.branches[1] + record.branches[1]],
      functions: [acc.functions[0] + record.functions[0], acc.functions[1] + record.functions[1]],
    }),
    { lines: [0, 0], branches: [0, 0], functions: [0, 0] },
  );
  return {
    lines: pct(...total.lines),
    branches: pct(...total.branches),
    functions: pct(...total.functions),
    counted: total.lines,
  };
}

const inputs = process.argv.slice(2).map((arg) => {
  const [name, file] = arg.split("=");
  return { name, file };
});

const out = [];
out.push("## Coverage\n");

const overall = [];
const details = [];

for (const { name, file } of inputs) {
  if (!file || !existsSync(file)) {
    out.push(`> \`${name}\`: no lcov at \`${file ?? "(unset)"}\` — coverage not reported for this workspace.\n`);
    continue;
  }
  const records = parseLcov(file);
  const held = records.filter((record) => !SUBPROCESS_ONLY.some((skip) => record.file.endsWith(skip)));
  const apart = records.filter((record) => SUBPROCESS_ONLY.some((skip) => record.file.endsWith(skip)));
  const summary = summarise(held);

  overall.push({ name, summary, apart });

  details.push(`<details><summary><strong>${name}</strong> — per file</summary>\n`);
  details.push("| file | lines | branches | functions |");
  details.push("| --- | ---: | ---: | ---: |");
  for (const record of [...held].sort((a, b) => (pct(...a.lines) ?? 0) - (pct(...b.lines) ?? 0))) {
    const lines = pct(...record.lines);
    details.push(
      `| \`${path.posix.normalize(record.file)}\` | ${badge(lines)} ${show(lines)} | ${show(pct(...record.branches))} | ${show(pct(...record.functions))} |`,
    );
  }
  details.push("\n</details>\n");
}

out.push("| workspace | lines | branches | functions |");
out.push("| --- | ---: | ---: | ---: |");
for (const { name, summary } of overall) {
  out.push(
    `| **${name}** | ${badge(summary.lines)} ${show(summary.lines)} | ${show(summary.branches)} | ${show(summary.functions)} |`,
  );
}
out.push("");

const excluded = overall.flatMap(({ name, apart }) => apart.map((record) => ({ name, record })));
if (excluded.length > 0) {
  out.push("### Measured apart\n");
  out.push(
    "These are covered by integration tests that run the server in a subprocess, which the instrumentation does not follow — the figure below is not a measure of how well they are tested.\n",
  );
  out.push("| file | lines |");
  out.push("| --- | ---: |");
  for (const { record } of excluded) {
    out.push(`| \`${path.posix.normalize(record.file)}\` | ${show(pct(...record.lines))} |`);
  }
  out.push("");
}

out.push(...details);

const markdown = `${out.join("\n")}\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
else process.stdout.write(markdown);
