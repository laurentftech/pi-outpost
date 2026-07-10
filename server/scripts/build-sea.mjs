#!/usr/bin/env node
/**
 * Builds a Node SEA (Single Executable Application) blob for pi-interface's
 * server, for distribution as a standalone Windows .exe. See
 * docs/sea-packaging.md for the full walkthrough, including why extensions
 * must go through sea-extensions.ts instead of pi-interface.config.json's
 * extensionPaths, and the Windows-only steps this script can't do for you.
 *
 * Output layout (server/dist/), mirroring server/src/'s depth so the server's
 * existing `path.resolve(import.meta.dirname, "../../web/dist")` keeps
 * resolving correctly once bundled:
 *   server/dist/bundle.js       - the bundled server, one file, no node_modules needed
 *   server/dist/sea-config.json - Node's --experimental-sea-config input
 *   server/dist/sea-prep.blob   - the generated blob (injected into node.exe on Windows)
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import esbuild from "esbuild";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(SERVER_DIR, "..");
const OUT_DIR = resolve(SERVER_DIR, "dist");
const BUNDLE_PATH = resolve(OUT_DIR, "bundle.js");
const SEA_CONFIG_PATH = resolve(OUT_DIR, "sea-config.json");
const BLOB_PATH = resolve(OUT_DIR, "sea-prep.blob");
const WEB_DIST = resolve(REPO_ROOT, "web/dist");

if (!existsSync(WEB_DIST)) {
  console.error(`[build-sea] ${WEB_DIST} does not exist — run "npm run build --workspace web" first.`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

console.log("[build-sea] bundling server/src/index.ts …");
await esbuild.build({
  entryPoints: [resolve(SERVER_DIR, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: BUNDLE_PATH,
  // Dependencies (e.g. cross-spawn) use CJS require() for Node builtins — esbuild's
  // ESM output needs this shim, since plain `import` can't do that at the top level.
  banner: {
    js: "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);",
  },
});

console.log("[build-sea] generating SEA blob …");
await writeFile(
  SEA_CONFIG_PATH,
  JSON.stringify(
    {
      main: BUNDLE_PATH,
      output: BLOB_PATH,
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, ["--experimental-sea-config", SEA_CONFIG_PATH], { stdio: "inherit" });

console.log(`
[build-sea] done.
  ${BUNDLE_PATH}
  ${BLOB_PATH}

Known limitation (see docs/sea-packaging.md): extensions loaded via
pi-interface.config.json's "extensionPaths" do NOT work once bundled — add
them as static imports in server/src/sea-extensions.ts instead, then re-run
this script.

Remaining steps happen on Windows (this script can only prepare the blob):
  1. Copy a Windows node.exe (same major version as this build) to pi-interface.exe
  2. npx postject pi-interface.exe NODE_SEA_BLOB "${BLOB_PATH}" ^
       --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ^
       --overwrite
  3. (Windows only, requires signtool) re-sign pi-interface.exe — postject invalidates
     the original Node signature, and an unsigned .exe will trigger SmartScreen
  4. Place pi-interface.exe next to a "web" folder containing dist/ (i.e. web/dist/,
     a sibling of where this script's bundle.js would sit) and a pi-interface.config.json
`);
