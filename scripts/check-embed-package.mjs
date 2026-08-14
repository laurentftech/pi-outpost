#!/usr/bin/env node
/**
 * Guard against an embed package that builds cleanly and cannot be consumed.
 *
 * `npm run build --workspace @pi-outpost/embed` proves the code compiles. It
 * proves nothing about the thing we publish, and the two fail apart:
 *
 * - **Entry points.** package.json promises `main`, `module`, `types` and an
 *   `exports` map. A renamed output or a `files` array that stops covering one
 *   of them leaves a tarball whose `import { mount } from "@pi-outpost/embed"`
 *   resolves to nothing. Every gate we have stays green, because every gate
 *   reads the source tree rather than the tarball.
 * - **A second React.** react/react-dom are peer dependencies, externalised in
 *   embed/vite.config.ts. If that externalisation regresses, the widget carries
 *   its own React into a host page that already has one — two copies, hooks
 *   throwing "invalid hook call", and a bundle that built without a warning.
 *
 * Both are cheap to assert against the artifact, which is why they are here and
 * not in the browser smoke test: a test that needs Chromium to notice a missing
 * file is a slow way to learn it. The CSS side of the same worry lives in
 * check-web-css.mjs.
 *
 * Run after `npm run build --workspace @pi-outpost/embed`.
 */
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EMBED = path.join(ROOT, "embed");

const fail = (message, detail) => {
  console.error(`[check-embed-package] ${message}`);
  if (detail) console.error(`\n${detail}`);
  process.exit(1);
};

const manifest = JSON.parse(await readFile(path.join(EMBED, "package.json"), "utf8"));

/* ── 1. Every entry point the manifest promises exists ───────────────────────── */

/** Paths the manifest points at, by the field that points at them. */
const declared = [
  ["main", manifest.main],
  ["module", manifest.module],
  ["types", manifest.types],
  ['exports["."].import', manifest.exports?.["."]?.import],
  ['exports["."].require', manifest.exports?.["."]?.require],
  ['exports["."].types', manifest.exports?.["."]?.types],
].filter(([, value]) => typeof value === "string");

if (declared.length === 0) fail("embed/package.json declares no entry point at all");

const absent = [];
for (const [field, relative] of declared) {
  const target = path.join(EMBED, relative);
  await access(target).catch(() => absent.push([field, relative]));
}
if (absent.length > 0) {
  fail(
    "embed/package.json points at files the build did not produce:",
    absent.map(([field, relative]) => `  ${field} → ${relative}`).join("\n") +
      `\n\nRun "npm run build --workspace @pi-outpost/embed" first. If an output was` +
      ` renamed, the manifest has to follow it — a consumer's import resolves through` +
      ` these fields and nothing else.`,
  );
}

/* ── 2. Those entry points are inside the published tarball ──────────────────── */

// `files` decides what ships. A path can exist locally and still be absent from
// the tarball, which is the failure that only shows up after publishing.
// --ignore-scripts: prepack would rebuild, and we are inspecting what is there.
let packed;
try {
  packed = new Set(packedFiles().map((entry) => entry.path));
} catch (error) {
  fail(`could not inspect the package tarball: ${error.message}`);
}

/**
 * `npm pack --dry-run --json`, run without a shell on every platform.
 *
 * Windows makes this awkward twice over: the executable is `npm.cmd`, so the
 * bare name resolves to nothing (ENOENT), and since the CVE-2024-27980 fix Node
 * refuses to spawn a `.cmd` at all unless `shell: true` (EINVAL). Passing
 * `shell: true` would work — the arguments here are literals — but it hands an
 * argument list to a command interpreter for no reason.
 *
 * So npm is invoked the way npm invokes itself: node running npm's own CLI
 * entry point, whose path npm exports as `npm_execpath` to the scripts it runs.
 * Outside `npm run` that variable is absent, and the platform name is the
 * fallback — with the shell Windows requires for a `.cmd`.
 */
function packedFiles() {
  const cli = process.env.npm_execpath;
  const [command, argv, useShell] = cli
    ? [process.execPath, [cli], false]
    : [process.platform === "win32" ? "npm.cmd" : "npm", [], true];

  const output = execFileSync(command, [...argv, "pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: EMBED,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: useShell && process.platform === "win32",
  });
  return JSON.parse(output)[0].files;
}

const unpublished = declared.filter(([, relative]) => !packed.has(relative.replace(/^\.\//, "")));
if (unpublished.length > 0) {
  fail(
    "entry points that exist locally but are not in the published tarball:",
    unpublished.map(([field, relative]) => `  ${field} → ${relative}`).join("\n") +
      `\n\nThe "files" array in embed/package.json decides what ships. A consumer` +
      ` installing this version would get a package whose entry points resolve to nothing.`,
  );
}

/* ── 3. The ESM entry really exports mount ──────────────────────────────────── */

// Imported rather than pattern-matched: an export the bundler renamed, or a
// module that throws while initialising, both fail here and neither shows in a
// substring search. mount() itself is not called — it needs a DOM.
const entry = path.join(EMBED, manifest.module ?? manifest.main);
let exported;
try {
  exported = await import(entry);
} catch (error) {
  fail(
    `importing the ESM entry threw: ${error.message}`,
    `  ${path.relative(ROOT, entry)}\n\nThe published module fails at load time, before a` +
      ` consumer calls anything.`,
  );
}
if (typeof exported.mount !== "function") {
  fail(
    `the ESM entry exports no mount() function`,
    `  exports: ${Object.keys(exported).join(", ") || "(none)"}\n\n` +
      `mount() is the package's whole public surface.`,
  );
}

/* ── 4. React is peer-provided, not bundled ─────────────────────────────────── */

const bundle = await readFile(entry, "utf8");
// The internals object is React's own and appears in no consumer bundle that
// merely imports React. Its presence means a copy was inlined.
const REACT_INTERNALS = /__CLIENT_INTERNALS_DO_NOT_USE|__SECRET_INTERNALS_DO_NOT_USE/;
if (REACT_INTERNALS.test(bundle)) {
  fail(
    "the bundle carries its own copy of React",
    `React and react-dom are peer dependencies and must stay external (see the` +
      ` "external" list in embed/vite.config.ts). Bundled, the widget runs a second` +
      ` React inside a host page that already has one: hooks throw "invalid hook call"` +
      ` and context crosses nothing.`,
  );
}
// The other half of the same claim: it must still *import* React from outside.
if (!/from\s*["']react["']|["']react-dom\/client["']/.test(bundle)) {
  fail(
    "the bundle imports neither react nor react-dom/client",
    `Externalised correctly, the bundle keeps those imports for the host to resolve.` +
      ` Neither bundled nor imported means the widget has no React at all.`,
  );
}

console.log(
  `[check-embed-package] ${declared.length} entry points present and published,` +
    ` mount() exported, React external (${(bundle.length / 1024 / 1024).toFixed(1)} MB bundle)`,
);
