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
import { cp, chmod, mkdir, rm, stat } from "node:fs/promises";
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

// Always rebuild web UI
console.log("[build] building the web UI …");
execFileSync("npm", ["run", "build", "--workspace", "web"], { cwd: REPO_ROOT, stdio: "inherit", shell: isWindows });

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
  define: { __PI_OUTPOST_VERSION__: JSON.stringify(version) },
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);",
    ].join("\n"),
  },
});
await chmod(BUNDLE, 0o755);

console.log("[build] copying the web UI …");
await cp(WEB_SRC, WEB_OUT, { recursive: true });

if (!(await stat(resolve(WEB_OUT, "index.html")).catch(() => null))) {
  console.error(`[build] ${WEB_OUT}/index.html is missing — the web build produced nothing.`);
  process.exit(1);
}

console.log(`[build] done: pi-outpost ${version}\n  ${BUNDLE}\n  ${WEB_OUT}/`);
