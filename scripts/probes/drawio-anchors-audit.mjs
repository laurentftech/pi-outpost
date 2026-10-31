/**
 * drawio-wire-anchors: pi-outpost's side of a live batch, read from the probe logs — not the
 * model's quality. Per run: a check that answered before an edit sent with it had ended (a
 * stale report), whether multi-warning reports carry the fixing order, and whether the last
 * report the agent read matches the file it left.
 *
 *   node scripts/probes/drawio-anchors-audit.mjs <batch dir>
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dir = process.argv[2];
for (const name of (await readdir(dir)).filter((file) => /^run-\d+\.txt$/.test(file)).sort()) {
  const lines = (await readFile(path.join(dir, name), "utf8")).split(/\r?\n/);
  const open = new Set(); // writes started and not ended
  let stale = 0;
  let checks = 0;
  let ordered = 0;
  let multi = 0;
  let lastReport = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = /^\[\d+s\] → (\w+) /.exec(line);
    const end = /^\[\d+s\] ← (\w+)/.exec(line);
    if (start && (start[1] === "edit" || start[1] === "write")) open.add(`${start[1]}#${i}`);
    if (end && (end[1] === "edit" || end[1] === "write")) {
      const first = [...open].find((key) => key.startsWith(end[1]));
      if (first) open.delete(first);
    }
    if (end && end[1] === "drawio_check") {
      checks++;
      if (open.size > 0) stale++;
      const report = [];
      for (let j = i + 1; j < lines.length && !/^\[\d+s\]/.test(lines[j]); j++) report.push(lines[j]);
      lastReport = report.join("\n");
      const warnings = (lastReport.match(/^- warning/gm) ?? []).length;
      if (warnings > 1) {
        multi++;
        if (/Fix the warnings in the order listed/.test(lastReport)) ordered++;
      }
    }
  }
  const final = lines.findIndex((line) => line.startsWith("=== final"));
  const finalIssues = final === -1 ? "?" : /(\d+) issue/.exec(lines[final])?.[1];
  const lastCount = /no defect found/.test(lastReport) ? "0" : (/(\d+) warning/.exec(lastReport)?.[1] ?? (/(\d+) error/.exec(lastReport)?.[1] ? "errors" : "?"));
  const unlabelled = (lastReport.match(/not labelled as the same data/g) ?? []).length;
  console.log(`${name}: ${checks} checks, ${stale} answered while an edit sent with them was running, ${ordered}/${multi} multi-warning reports with the order line; last report ${lastCount} vs final file ${finalIssues}; "not labelled" in last report: ${unlabelled}`);
}
