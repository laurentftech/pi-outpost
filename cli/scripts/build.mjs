#!/usr/bin/env node
/**
 * Builds the `pi-outpost` npm package: the server bundled (local code only),
 * with its web UI alongside.
 *
 *   cli/dist/pi-outpost.mjs   the server, local code bundled; npm deps external
 *   cli/dist/web/             a copy of web/dist, found by index.ts's `./web` candidate
 *
 * npm dependencies are listed in cli/package.json "dependencies" and resolved
 * at install time — no monolithic bundle. This keeps jiti (used by the pi SDK
 * to load extensions at runtime) available, so config.extensionPaths works.
 */
import { execFileSync } from "node:child_process";
import { cp, chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const CLI_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(CLI_DIR, "..");
const OUT_DIR = resolve(CLI_DIR, "dist");
const BUNDLE = resolve(OUT_DIR, "pi-outpost.mjs");
const WEB_SRC = resolve(REPO_ROOT, "web/dist");
const WEB_OUT = resolve(OUT_DIR, "web");

const { version } = require(resolve(CLI_DIR, "package.json"));
const piSdkMain = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piSdkVersion = JSON.parse(readFileSync(resolve(dirname(piSdkMain), "..", "package.json"), "utf-8")).version;

// Always rebuild web UI
console.log("[build] building the web UI …");
execFileSync("npm", ["run", "build", "--workspace", "web"], { cwd: REPO_ROOT, stdio: "inherit", shell: isWindows });

// Inline the built UI into the bundle (self-contained .exe — no web/ folder needed)
console.log("[build] inlining web UI into the server bundle …");
const { generateEmbeddedWeb } = await import("./embed-web.mjs");
const embeddedCount = await generateEmbeddedWeb(WEB_SRC, resolve(REPO_ROOT, "server/src/embedded-web.ts"));
console.log(`[build] embedded ${embeddedCount} web assets`);

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

console.log("[build] bundling the server …");
await esbuild.build({
  entryPoints: [resolve(REPO_ROOT, "server/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: BUNDLE,
  // npm deps resolved at install time — prevents inlining jiti etc.
  external: [
    "@earendil-works/pi-coding-agent",
    "@fastify/static",
    "@fastify/websocket",
    "fastify",
    "ws",
  ],
  define: { __PI_OUTPOST_VERSION__: JSON.stringify(version), __PI_SDK_VERSION__: JSON.stringify(piSdkVersion) },
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);",
    ].join("\n"),
  },
});
await chmod(BUNDLE, 0o755);

// Also produce a fully-bundled version for --build-sea (no external deps)
const SEA_BUNDLE = resolve(OUT_DIR, "pi-outpost.sea.mjs");
console.log("[build] bundling SEA-ready version (all deps inlined) …");
await esbuild.build({
  entryPoints: [resolve(REPO_ROOT, "server/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  outfile: SEA_BUNDLE,
  define: { __PI_OUTPOST_VERSION__: JSON.stringify(version), __PI_SDK_VERSION__: JSON.stringify(piSdkVersion) },
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);",
    ].join("\n"),
  },
});

// ── Patch getAliases() for SEA mode ──────────────────────────────────────────
// In SEA mode (or when running the bundled file outside node_modules), the
// SDK's getAliases() calls require.resolve("typebox") relative to the bundle's
// location on disk. Since the SEA bundle is fully inlined, there is no
// node_modules/ at that path and require.resolve() throws MODULE_NOT_FOUND.
// We wrap getAliases() so resolution failures produce empty aliases instead —
// enough for extensions that use only type imports (stripped by jiti).
{
  console.log("[build] patching getAliases() for SEA bundle …");
  let src = await readFile(SEA_BUNDLE, "utf-8");
  // esbuild bundles with 2-space indentation — match it exactly
  const openBefore =
    "function getAliases() {\n" +
    "  if (_aliases)\n" +
    "    return _aliases;";
  const openAfter =
    "function getAliases() {\n" +
    "  if (_aliases)\n" +
    "    return _aliases;\n" +
    "  try {";
  const tailBefore =
    "};\n" +
    "  return _aliases;\n" +
    "}";
  const tailAfter =
    "};\n" +
    "  return _aliases;\n" +
    "  } catch {\n" +
    "    _aliases = {};\n" +
    "    return _aliases;\n" +
    "  }\n" +
    "}";
  src = src.replace(openBefore, openAfter).replace(tailBefore, tailAfter);
  await writeFile(SEA_BUNDLE, src, "utf-8");
}

console.log("[build] copying the web UI …");
await cp(WEB_SRC, WEB_OUT, { recursive: true });

if (!(await stat(resolve(WEB_OUT, "index.html")).catch(() => null))) {
  console.error(`[build] ${WEB_OUT}/index.html is missing — the web build produced nothing.`);
  process.exit(1);
}

// Copy SEA blob if it exists (generated by npm run build:sea)
const SEA_BLOB_SRC = resolve(REPO_ROOT, "server/dist/sea-prep.blob");
const SEA_BLOB_OUT = resolve(OUT_DIR, "sea-prep.blob");
try {
  await stat(SEA_BLOB_SRC);
  await cp(SEA_BLOB_SRC, SEA_BLOB_OUT);
  console.log("[build] copied sea-prep.blob");
} catch (e) {
  // Blob not found (normal in local dev if build:sea wasn't run)
}
  
console.log(`[build] done: pi-outpost ${version}\n  ${BUNDLE}\n  ${WEB_OUT}/`);
