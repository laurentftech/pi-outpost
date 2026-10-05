// Assembles the .mcpb bundle from the built server and view, and packs it:
//
//     dist/bundle/manifest.json            mcp/manifest.json, at pi-outpost's version
//     dist/bundle/server/index.mjs         the bundled server (build:server)
//     dist/bundle/server/guide/*.md        the guide pages (build:server)
//     dist/bundle/server/planning.html     the view (build:viewer)
//     dist/bundle/LICENSE
//
// then `mcpb validate` and `mcpb pack` to dist/pi-outpost-plannings.mcpb.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mcpb } from "./mcpb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const repo = path.resolve(root, "..");
const bundle = path.join(root, "dist", "bundle");
const output = path.join(root, "dist", "pi-outpost-plannings.mcpb");

for (const built of [path.join(bundle, "server", "index.mjs"), path.join(bundle, "server", "guide"), path.join(root, "dist", "viewer", "planning.html")]) {
  if (!existsSync(built)) throw new Error(`${path.relative(root, built)} is missing: run npm run build first`);
}

const { version } = JSON.parse(readFileSync(path.join(repo, "cli", "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
writeFileSync(path.join(bundle, "manifest.json"), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
copyFileSync(path.join(root, "dist", "viewer", "planning.html"), path.join(bundle, "server", "planning.html"));
copyFileSync(path.join(repo, "LICENSE"), path.join(bundle, "LICENSE"));

mcpb(["validate", path.join(bundle, "manifest.json")]);
rmSync(output, { force: true });
mcpb(["pack", bundle, output]);
