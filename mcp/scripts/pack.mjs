// Assembles the .mcpb bundle from the built server and view, and packs it:
//
//     dist/bundle/manifest.json            mcp/manifest.json, at pi-outpost's version
//     dist/bundle/server/index.mjs         the bundled server (build:server)
//     dist/bundle/server/guide/*.md        the guide pages (build:server)
//     dist/bundle/server/planning.html     the view (build:viewer)
//     dist/bundle/LICENSE
//
// then `mcpb validate` and `mcpb pack` to dist/pi-outpost-plannings.mcpb.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// The CLI's own entry, run with this Node: no npx, no .cmd shim on Windows.
// Its package root is found from its main entry: the package does not export package.json.
const mcpb = path.join(path.dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/mcpb"))), "cli", "cli.js");
execFileSync(process.execPath, [mcpb, "validate", path.join(bundle, "manifest.json")], { stdio: "inherit" });
rmSync(output, { force: true });
execFileSync(process.execPath, [mcpb, "pack", bundle, output], { stdio: "inherit" });
