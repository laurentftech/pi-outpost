// SPIKE: shrink raw V8 coverage files to the scripts under server/src.
// usage: node cov-filter.cjs <inDir> <outDir>
const fs = require("fs");
const path = require("path");
const [inDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const ours = (url) => /\/server\/src\//.test(decodeURIComponent(url));
let before = 0, after = 0, n = 0, bad = 0;
for (const name of fs.readdirSync(inDir)) {
  const p = path.join(inDir, name);
  const text = fs.readFileSync(p, "utf8");
  before += text.length;
  let j;
  try { j = JSON.parse(text); } catch { bad++; continue; } // a file cut by a kill
  const result = j.result.filter((r) => ours(r.url));
  if (result.length === 0) continue;
  const smc = Object.fromEntries(Object.entries(j["source-map-cache"] || {}).filter(([k]) => ours(k)));
  const out = JSON.stringify({ result, "source-map-cache": smc });
  after += out.length;
  n++;
  fs.writeFileSync(path.join(outDir, name), out);
}
console.log(`files kept ${n}, unreadable ${bad}; ${(before / 1e6).toFixed(0)} MB -> ${(after / 1e6).toFixed(0)} MB`);
