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

// Inline the built UI into the bundle (self-contained .exe — no web/ folder needed).
// Set BUILD_EMBED_WEB=0 for server-only / embed mode: the UI is then served
// from a web/ folder on disk (fastifyStatic fallback in server/src/index.ts).
console.log("[build] building the embedded web UI …");
const { generateEmbeddedWeb, writeEmptyEmbeddedWeb } = await import("./embed-web.mjs");
const EMBED_WEB = process.env.BUILD_EMBED_WEB !== "0";
if (EMBED_WEB) {
  const embeddedCount = await generateEmbeddedWeb(WEB_SRC, resolve(REPO_ROOT, "server/src/embedded-web.ts"));
  console.log(`[build] embedded ${embeddedCount} web assets`);
} else {
  await writeEmptyEmbeddedWeb(resolve(REPO_ROOT, "server/src/embedded-web.ts"));
  console.log("[build] server-only mode: web UI served from disk (web/), not embedded");
}

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
    "node-pty",
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

// ── Let extensions reach the bundled packages ────────────────────────────────
// The same patch server/scripts/build-sea.mjs applies, and for the same reason:
// this bundle is what `--build-sea` turns into an executable, so an extension
// loaded from disk beside it has no node_modules to resolve the agent's own
// packages from. jiti's `virtualModules` serves them as already-loaded objects,
// the SDK already builds that map, and it selects it on `isBunBinary` — false in
// a Node SEA. One condition, not a new mechanism.
//
// Two bundles carry this because two paths produce an executable: this one for
// `node --build-sea`, and server/dist/bundle.mjs for the blob. Patching only one
// leaves extensions working on whichever path the machine happened to take.
//
// pi-coding-agent 0.84.3 fixed the same gap upstream (earendil-works/pi#8237):
// the branch now reads `isBunBinary || isNodeSeaBinary || isBundledNode`, and
// `isNodeSeaBinary` is the same `node:sea` isSea() check this patch was adding
// by hand. When that shape is present there is nothing left to patch —
// checked explicitly, not assumed, so a real drift still throws below.
{
  console.log("[build] routing extension imports through jiti's virtual modules …");
  let src = await readFile(SEA_BUNDLE, "utf-8");

  const branchBefore = "...isBunBinary ? { virtualModules: VIRTUAL_MODULES, tryNative: false }";
  const upstreamHandlesSea = /isBunBinary\s*\|\|\s*isNodeSeaBinary\s*\|\|\s*isBundledNode\s*\?\s*\{\s*virtualModules:\s*VIRTUAL_MODULES,\s*tryNative:\s*false\s*\}/;

  if (src.includes(branchBefore)) {
    const helper =
      "\nfunction __piOutpostIsSea() {\n" +
      "  try {\n" +
      "    return require(\"node:sea\").isSea();\n" +
      "  } catch {\n" +
      "    return false;\n" +
      "  }\n" +
      "}\n";
    const requireShim = "const require = ___createRequire(import.meta.url);";
    if (!src.includes(requireShim)) {
      throw new Error("[build] the bundle's createRequire shim moved — the SEA extension patch needs it");
    }
    src = src.replace(requireShim, requireShim + helper);
    src = src.replace(branchBefore, "...isBunBinary || __piOutpostIsSea() ? { virtualModules: VIRTUAL_MODULES, tryNative: false }");

    // Kept as a seatbelt rather than as the mechanism: if the detection above ever
    // stops matching, extension loading degrades instead of throwing before the
    // first extension is read.
    const openBefore = "function getAliases() {\n" + "  if (_aliases)\n" + "    return _aliases;";
    const openAfter = openBefore + "\n  try {";
    const tailBefore = "};\n" + "  return _aliases;\n" + "}";
    const tailAfter =
      "};\n" + "  return _aliases;\n" + "  } catch {\n" + "    _aliases = {};\n" + "    return _aliases;\n" + "  }\n" + "}";
    src = src.replace(openBefore, openAfter).replace(tailBefore, tailAfter);

    await writeFile(SEA_BUNDLE, src, "utf-8");
  } else if (upstreamHandlesSea.test(src)) {
    console.log("[build] the SDK already detects a Node SEA binary itself (pi#8237) — nothing to patch");
  } else {
    throw new Error("[build] the SDK's jiti branch moved — extensions would lose their bundled packages");
  }
}

// Skills are part of the product, not local configuration: an agent that has the
// present_structure tool and not the skill explaining it has the mechanism without
// the instructions. .pi/skills and .agents/skills are runtime locations and are
// gitignored, so the tracked skills/ directory is what ships.
// The contract, at a path a producer can be pointed at. A format meant for
// producers built elsewhere is not delivered by living in the repository: someone
// who installed this package has the schema inlined in the bundle, which validates
// their input and tells them nothing about what to send.
console.log("[build] copying the structured-exchange contract …");
await cp(resolve(REPO_ROOT, "shared/schemas"), resolve(OUT_DIR, "contract/schemas"), { recursive: true });
await cp(resolve(REPO_ROOT, "shared/conformance"), resolve(OUT_DIR, "contract/conformance"), { recursive: true });
await cp(resolve(REPO_ROOT, "docs/structured-exchange.md"), resolve(OUT_DIR, "contract/README.md"));

// The reference validator, as one file that runs anywhere Node does. The script it
// is built from imports this repository's TypeScript, so shipping that would be
// shipping a demonstration; a producer needs something they can actually execute.
console.log("[build] building the reference validator …");
execFileSync("node", [resolve(REPO_ROOT, "shared/scripts/build-validator.mjs")], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  shell: isWindows,
});
await cp(
  resolve(REPO_ROOT, "shared/dist/validate-structured-exchange.mjs"),
  resolve(OUT_DIR, "contract/validate-structured-exchange.mjs"),
);

console.log("[build] copying skills …");
await cp(resolve(REPO_ROOT, "skills"), resolve(OUT_DIR, "skills"), { recursive: true });

console.log("[build] copying the web UI …");
await cp(WEB_SRC, WEB_OUT, { recursive: true });

if (!(await stat(resolve(WEB_OUT, "index.html")).catch(() => null))) {
  console.error(`[build] ${WEB_OUT}/index.html is missing — the web build produced nothing.`);
  process.exit(1);
}

// The SEA blob. Not gated here the way the web UI above is, and deliberately: the
// release builds the blob *after* this script runs — it needs Node 26, which the job
// switches to once the tests are done — and copies it into dist/ itself. Failing here
// would break the pipeline for a file that is legitimately not there yet.
//
// The gate that matters is on the tarball instead (`npm run check:cli`, run just
// before publish), because that is the artifact the promise is about: `build-exe`
// reads this blob, and a package published without it cannot take the fallback path
// at all — which is not a legacy nicety, it is what produces a working executable on
// macOS x64, where `node --build-sea` currently segfaults.
//
// What changed here is only that its absence is now said out loud rather than
// swallowed by an empty catch.
const SEA_BLOB_SRC = resolve(REPO_ROOT, "server/dist/sea-prep.blob");
const SEA_BLOB_OUT = resolve(OUT_DIR, "sea-prep.blob");
if (await stat(SEA_BLOB_SRC).catch(() => null)) {
  await cp(SEA_BLOB_SRC, SEA_BLOB_OUT);
  console.log("[build] copied sea-prep.blob");
} else {
  console.warn(
    `[build] no sea-prep.blob at ${SEA_BLOB_SRC} — this package cannot build a standalone executable.\n` +
      `[build] Run \`npm run build:sea --workspace server\` before packing; \`npm run check:cli\` enforces it.`,
  );
}
  
console.log(`[build] done: pi-outpost ${version}\n  ${BUNDLE}\n  ${WEB_OUT}/`);
