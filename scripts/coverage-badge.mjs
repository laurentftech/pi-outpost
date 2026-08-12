/**
 * Write a coverage badge as a self-contained SVG.
 *
 *   node scripts/coverage-badge.mjs badges/coverage.svg server/coverage/lcov.info ui/coverage/lcov.info
 *
 * The figure is the *lowest* of lines, branches and functions across every lcov
 * given. A badge that quotes the flattering number is worse than none: it is read
 * as a summary of the whole, so it says the weakest thing the suites can claim.
 *
 * No dependency and no third-party action: the badge is drawn here and pushed by
 * the workflow with the token GitHub already mints for it, so nothing outside
 * this repository ever needs write access to it.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Totals for one lcov file: [hit, found] per metric. */
function readLcov(file) {
  const totals = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
  const add = (key, index, value) => {
    totals[key][index] += Number(value);
  };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("LH:")) add("lines", 0, line.slice(3));
    else if (line.startsWith("LF:")) add("lines", 1, line.slice(3));
    else if (line.startsWith("BRH:")) add("branches", 0, line.slice(4));
    else if (line.startsWith("BRF:")) add("branches", 1, line.slice(4));
    else if (line.startsWith("FNH:")) add("functions", 0, line.slice(4));
    else if (line.startsWith("FNF:")) add("functions", 1, line.slice(4));
  }
  return totals;
}

/** Green when comfortable, amber when it needs attention, red when it does not hold. */
function colour(percent) {
  if (percent >= 90) return "#3fb950";
  if (percent >= 75) return "#d29922";
  return "#f85149";
}

/**
 * A flat badge, drawn rather than fetched. Character widths are approximated at
 * 6.3px for the 11px DejaVu-ish stack browsers land on — close enough that the
 * text never touches the edges, which is all the geometry has to guarantee.
 */
function svg(label, value, fill) {
  const width = (text) => Math.round(text.length * 6.3) + 10;
  const labelWidth = width(label);
  const valueWidth = width(value);
  const total = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${fill}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>
`;
}

const [output, ...inputs] = process.argv.slice(2);
if (!output || inputs.length === 0) {
  console.error("usage: coverage-badge.mjs <output.svg> <lcov...>");
  process.exit(1);
}

const combined = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
for (const file of inputs) {
  if (!existsSync(file)) {
    console.error(`missing lcov: ${file}`);
    process.exit(1);
  }
  const totals = readLcov(file);
  for (const key of Object.keys(combined)) {
    combined[key][0] += totals[key][0];
    combined[key][1] += totals[key][1];
  }
}

const percents = Object.values(combined)
  .filter(([, found]) => found > 0)
  .map(([hit, found]) => (hit / found) * 100);
if (percents.length === 0) {
  console.error("no coverage data found in the given lcov files");
  process.exit(1);
}

const worst = Math.min(...percents);
const value = `${worst.toFixed(1)}%`;
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, svg("coverage", value, colour(worst)));
console.log(`${output}: ${value} (lowest of lines/branches/functions across ${inputs.length} workspace(s))`);
