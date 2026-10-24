// Assembles the posters .mcpb bundle from the built server and editor, and packs it:
//
//     dist/bundle-posters/manifest.json          mcp/manifest-posters.json, at pi-outpost's version
//     dist/bundle-posters/server/index.mjs       the bundled server (build:server-posters)
//     dist/bundle-posters/server/poster.html     the editor (build:viewer-poster)
//     dist/bundle-posters/LICENSE
//
// then `mcpb validate` and `mcpb pack` to dist/pi-outpost-posters.mcpb.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mcpb } from "./mcpb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const repo = path.resolve(root, "..");
const bundle = path.join(root, "dist", "bundle-posters");
const output = path.join(root, "dist", "pi-outpost-posters.mcpb");

for (const built of [path.join(bundle, "server", "index.mjs"), path.join(root, "dist", "viewer-poster", "poster.html")]) {
  if (!existsSync(built)) throw new Error(`${path.relative(root, built)} is missing: run npm run build and npm run build:server-posters first`);
}

const { version } = JSON.parse(readFileSync(path.join(repo, "cli", "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(root, "manifest-posters.json"), "utf8"));
writeFileSync(path.join(bundle, "manifest.json"), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
copyFileSync(path.join(root, "dist", "viewer-poster", "poster.html"), path.join(bundle, "server", "poster.html"));
copyFileSync(path.join(repo, "LICENSE"), path.join(bundle, "LICENSE"));

mcpb(["validate", path.join(bundle, "manifest.json")]);
rmSync(output, { force: true });
mcpb(["pack", bundle, output]);
