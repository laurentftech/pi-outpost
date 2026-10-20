/**
 * Move the vendored draw.io viewer to another jgraph release.
 *
 *   node scripts/update-drawio-viewer.mjs 32.5.5
 *
 * Downloads `viewer-static.min.js` and the licence from the release's tag, unmodified,
 * and records the version and checksum in the README beside them. No npm package
 * publishes the viewer, hence the copy; check the rendering in the running app before
 * committing a new one.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: node scripts/update-drawio-viewer.mjs <version>, e.g. 32.5.5");
  process.exit(2);
}
const base = `https://raw.githubusercontent.com/jgraph/drawio/v${version}`;
const dir = new URL("../web/public/vendor/drawio/", import.meta.url);

async function download(path) {
  const response = await fetch(`${base}/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} for v${version}`);
  return Buffer.from(await response.arrayBuffer());
}

const viewer = await download("src/main/webapp/js/viewer-static.min.js");
const licence = await download("LICENSE");
const sha256 = createHash("sha256").update(viewer).digest("hex");
await writeFile(new URL("viewer-static.min.js", dir), viewer);
await writeFile(new URL("LICENSE", dir), licence);

const readme = new URL("README.md", dir);
const updated = (await readFile(readme, "utf8"))
  .replace(/tag `v[\d.]+`/, `tag \`v${version}\``)
  .replace(/- Version: [\d.]+/, `- Version: ${version}`)
  .replace(/- SHA-256: [0-9a-f]+/, `- SHA-256: ${sha256}`);
await writeFile(readme, updated);
console.log(`draw.io viewer ${version} (${viewer.length} bytes, sha256 ${sha256})`);
