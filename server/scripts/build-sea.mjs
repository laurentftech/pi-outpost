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
import { PRE_8237_BRANCH, upstreamHandlesSea } from "../../scripts/sea-jiti-shape.mjs";

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

// Inline the built UI into the bundle (self-contained .exe — no web/ folder needed).
// Set BUILD_EMBED_WEB=0 for server-only / embed mode: the UI is then served
// from a web/ folder on disk (fastifyStatic fallback in server/src/index.ts).
console.log("[build-sea] building the embedded web UI …");
const { generateEmbeddedWeb, writeEmptyEmbeddedWeb } = await import("../../cli/scripts/embed-web.mjs");
const EMBED_WEB = process.env.BUILD_EMBED_WEB !== "0";
if (EMBED_WEB) {
  const embeddedCount = await generateEmbeddedWeb(WEB_DIST, resolve(SERVER_DIR, "src/embedded-web.ts"));
  console.log(`[build-sea] embedded ${embeddedCount} web assets`);
} else {
  await writeEmptyEmbeddedWeb(resolve(SERVER_DIR, "src/embedded-web.ts"));
  console.log("[build-sea] server-only mode: web UI served from disk (web/), not embedded");
}

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

// ── 1b. Let extensions reach the bundled packages, in SEA mode ───────────────
// An extension loaded at runtime lives outside the executable and may import the
// packages the agent itself is built from — pi-coding-agent, pi-tui, typebox. There
// are no node_modules beside a single-file executable, so the SDK's getAliases(),
// which answers with filesystem paths from require.resolve(), throws and takes all
// extension loading down with it.
//
// jiti already has the mechanism for exactly this, and the SDK already uses it: its
// `virtualModules` option maps a specifier to an *already-loaded module object* and
// bypasses filesystem resolution entirely. The SDK builds that map (VIRTUAL_MODULES)
// from static imports — "These MUST be static so Bun bundles them into the compiled
// binary" — and selects it when `isBunBinary`. Which is false in a Node SEA, so we
// fall to the aliases and die.
//
// So the patch is one condition, not a new mechanism: take the same branch Bun takes
// when this is a single executable. The objects are already inside the blob (esbuild
// bundles those static imports), which is what makes it work at all.
//
// The upstream fix is the same three lines in the SDK's own detection; this stays
// until that lands.
//
// It landed in pi-coding-agent 0.84.3 (earendil-works/pi#8237), and 0.86.0 moved the
// same condition into a named `usesEmbeddedModules`. Which shapes count as "upstream
// handles it" lives in scripts/sea-jiti-shape.mjs, shared with cli/scripts/build.mjs
// and the suite that guards both, so a real drift throws in one place instead of
// silently shipping a broken loader from whichever script was not updated.
{
  console.log("[build-sea] routing extension imports through jiti's virtual modules …");
  let bundleSrc = await readFile(BUNDLE_PATH, "utf-8");

  const branchBefore = PRE_8237_BRANCH;

  if (bundleSrc.includes(branchBefore)) {
    // `node:sea` answers this for real; wrapped because a runtime without it must
    // simply say no rather than take the whole loader with it.
    const helper =
      "\nfunction __piOutpostIsSea() {\n" +
      "  try {\n" +
      "    return require(\"node:sea\").isSea();\n" +
      "  } catch {\n" +
      "    return false;\n" +
      "  }\n" +
      "}\n";
    const requireShim = "const require = ___createRequire(import.meta.url);";
    if (!bundleSrc.includes(requireShim)) {
      throw new Error("[build-sea] the bundle's createRequire shim moved — the SEA extension patch needs it");
    }
    bundleSrc = bundleSrc.replace(requireShim, requireShim + helper);

    const branchAfter = "...isBunBinary || __piOutpostIsSea() ? { virtualModules: VIRTUAL_MODULES, tryNative: false }";
    bundleSrc = bundleSrc.replace(branchBefore, branchAfter);

    // getAliases() keeps its guard, demoted from mechanism to seatbelt: it is no
    // longer how extensions resolve anything, but a build where the detection above
    // failed must degrade to "extensions with no npm imports" rather than to a
    // loader that throws before any extension is read.
    const openBefore = "function getAliases() {\n" + "  if (_aliases)\n" + "    return _aliases;";
    const openAfter = openBefore + "\n  try {";
    const tailBefore = "};\n" + "  return _aliases;\n" + "}";
    const tailAfter =
      "};\n" + "  return _aliases;\n" + "  } catch {\n" + "    _aliases = {};\n" + "    return _aliases;\n" + "  }\n" + "}";
    bundleSrc = bundleSrc.replace(openBefore, openAfter).replace(tailBefore, tailAfter);

    await writeFile(BUNDLE_PATH, bundleSrc, "utf-8");
  } else if (upstreamHandlesSea(bundleSrc)) {
    console.log("[build-sea] the SDK already detects a Node SEA binary itself (pi#8237) — nothing to patch");
  } else {
    // Loudly, not silently: a patch that quietly stops matching leaves extensions
    // broken in exactly the build nobody runs locally.
    throw new Error("[build-sea] the SDK's jiti branch moved — extensions would lose their bundled packages");
  }
}

// ── 2a. Generate preparation blob (for npm distribution, cross-platform) ─────
// The blob can be injected into a node binary of any platform via postject.
//
// It carries `mainFormat: "module"`, and that is a deliberate reversal. It was
// removed once, because injecting a blob that declares a module format into a node
// too old to know the field asserts at startup — issue #14, which read like a
// platform mismatch and was not. But the bundle *is* ESM: without the field the
// runtime loads it as CommonJS and dies on its first `import`, so a blob without it
// is one nobody can use. The field stays and the requirement is stated instead:
// this blob wants Node >= 26, the same version --build-sea needs.
console.log("[build-sea] generating SEA preparation blob …");
const blobCfg = { ...SEA_CFG, mainFormat: "module", output: resolve(OUT_DIR, "sea-prep.blob") };
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
