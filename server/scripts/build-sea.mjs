#!/usr/bin/env node
/**
 * Builds a standalone Windows .exe (Node SEA) for pi-outpost's server.
 *
 * Requires Node ≥ 26 (for --build-sea + mainFormat: "module" support).
 *
 * Output layout (server/dist/):
 *   server/dist/bundle.mjs        - bundled server (ESM, one file)
 *   server/dist/sea-config.json   - Node --build-sea input
 *   server/dist/pi-outpost.exe    - final standalone executable
 *
 * Extension loading (config.extensionScripts) works at runtime via the
 * pi SDK's jiti-based loader (createRequire under the hood), which can
 * load from the filesystem inside a SEA blob.  Direct import() is limited
 * to Node built-in modules in SEA mode.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(SERVER_DIR, "..");
const { version } = require(resolve(REPO_ROOT, "cli/package.json"));
const piSdkMain = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piSdkVersion = JSON.parse(readFileSync(resolve(dirname(piSdkMain), "..", "package.json"), "utf-8")).version;
const OUT_DIR = resolve(SERVER_DIR, "dist");
const BUNDLE_PATH = resolve(OUT_DIR, "bundle.mjs");
const SEA_CONFIG_PATH = resolve(OUT_DIR, "sea-config.json");
const EXE_PATH = resolve(OUT_DIR, "pi-outpost.exe");
const WEB_DIST = resolve(REPO_ROOT, "web/dist");
const SEA_CFG = {
  main: BUNDLE_PATH,
  disableExperimentalSEAWarning: true,
};

if (!existsSync(WEB_DIST)) {
  console.error(`[build-sea] ${WEB_DIST} does not exist — run "npm run build --workspace web" first.`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

// Inline the built UI into the bundle (self-contained .exe — no web/ folder needed)
console.log("[build-sea] inlining web UI into the server bundle …");
const { generateEmbeddedWeb } = await import("../../cli/scripts/embed-web.mjs");
const embeddedCount = await generateEmbeddedWeb(WEB_DIST, resolve(SERVER_DIR, "src/embedded-web.ts"));
console.log(`[build-sea] embedded ${embeddedCount} web assets`);

// ── 1. Bundle server as ESM ──────────────────────────────────────────────────
console.log("[build-sea] bundling server/src/index.ts …");
await esbuild.build({
  entryPoints: [resolve(SERVER_DIR, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  outfile: BUNDLE_PATH,
  define: { __PI_OUTPOST_VERSION__: JSON.stringify(version), __PI_SDK_VERSION__: JSON.stringify(piSdkVersion) },
  // Dependencies (e.g. cross-spawn) use CJS require() for Node builtins — esbuild's
  // ESM output needs this shim, since plain `import` can't do that at the top level.
  banner: {
    js: "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);",
  },
});

// ── 1b. Patch getAliases() for SEA mode ──────────────────────────────────────
// In SEA mode, the entire bundle is embedded in the .exe — there are no
// node_modules/ directories on the filesystem at the executable's location.
// The SDK's getAliases() calls require.resolve("typebox") which throws in
// that environment, preventing jiti from being created and silently killing
// all extension loading.  We wrap the function body so that if filesystem
// resolution fails, empty aliases are returned — enough for extensions that
// import only Node built-in modules (npm-registered pi packages still need
// full filesystem resolution and aren't supported in SEA mode).
{
  console.log("[build-sea] patching getAliases() for SEA mode …");
  let bundleSrc = await readFile(BUNDLE_PATH, "utf-8");
  // Replace the getAliases function: wrap the body so require.resolve
  // failures are caught and returned as {}.
  // Match the function opening and wrap body in try
  const openBefore = "function getAliases() {\n" +
    "  if (_aliases)\n" +
    "    return _aliases;";
  const openAfter = "function getAliases() {\n" +
    "  if (_aliases)\n" +
    "    return _aliases;\n" +
    "  try {";
  // Match ";, return _aliases; }" sequence unique to getAliases' tail
  const tailBefore = "};\n" +
    "  return _aliases;\n" +
    "}";
  const tailAfter = "};\n" +
    "  return _aliases;\n" +
    "  } catch {\n" +
    "    _aliases = {};\n" +
    "    return _aliases;\n" +
    "  }\n" +
    "}";
  bundleSrc = bundleSrc.replace(openBefore, openAfter).replace(tailBefore, tailAfter);
  await writeFile(BUNDLE_PATH, bundleSrc, "utf-8");
}

// ── 2a. Generate preparation blob (for npm distribution, cross-platform) ─────
// The blob can be injected into a node.exe on any platform via postject.
console.log("[build-sea] generating SEA preparation blob …");
const blobCfg = { ...SEA_CFG, output: resolve(OUT_DIR, "sea-prep.blob") };
delete blobCfg.mainFormat;
await writeFile(SEA_CONFIG_PATH, JSON.stringify(blobCfg, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", SEA_CONFIG_PATH], { stdio: "inherit" });

// ── 2b. Generate native .exe via --build-sea (skip in CI, .exe is platform-specific) ──
if (!process.env.CI) {
  console.log("[build-sea] generating SEA executable …");
  const exeCfg = { ...SEA_CFG, mainFormat: "module", output: EXE_PATH };
  await writeFile(SEA_CONFIG_PATH, JSON.stringify(exeCfg, null, 2));
  execFileSync(process.execPath, ["--build-sea", SEA_CONFIG_PATH], { stdio: "inherit" });
} else {
  console.log("[build-sea] skipping .exe in CI (platform-specific; build locally on Windows)");
}

console.log(`
[build-sea] done.
  ${BUNDLE_PATH}
  ${resolve(OUT_DIR, "sea-prep.blob")}     (cross-platform blob — for npm distribution)
  ${process.env.CI ? "(skipped)" : EXE_PATH}  ${process.env.CI ? "" : "(Windows .exe — platform-specific)"}

Extension loading: config.extensionPaths/extensionScripts work at runtime via
the pi SDK's jiti-based loader (createRequire), which can load from the file
system inside a SEA blob.  Direct import() is limited to Node built-in modules.
`);
