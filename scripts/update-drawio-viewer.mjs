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
const RAW_ORIGIN = "https://raw.githubusercontent.com";
const MAX_ASSET_BYTES = 20 * 1024 * 1024;

async function download(path) {
  const assetUrl = new URL(`${base}/${path}`);
  if (assetUrl.origin !== RAW_ORIGIN || !assetUrl.pathname.startsWith(`/jgraph/drawio/v${version}/`)) {
    throw new Error("refusing an asset URL outside the selected draw.io release");
  }
  const response = await fetch(assetUrl, { redirect: "error" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} for v${version}`);
  if (response.url !== assetUrl.href) throw new Error(`${path}: the asset URL changed during download`);
  if (!response.body) throw new Error(`${path}: empty response body`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ASSET_BYTES) {
      await reader.cancel();
      throw new Error(`${path}: asset is over the ${MAX_ASSET_BYTES}-byte download limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
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
