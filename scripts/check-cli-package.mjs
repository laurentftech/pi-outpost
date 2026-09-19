#!/usr/bin/env node
/**
 * Guard against a `pi-outpost` tarball that installs and cannot build an executable.
 *
 * `pi-outpost build-exe` promises one command and no download: the spec says the
 * package "SHALL also carry what building a standalone executable from it requires, so
 * that an installation is sufficient on its own". It reads exactly two artifacts —
 * the inlined bundle and the SEA preparation blob — and neither is covered by any gate
 * that reads the source tree, because both are build outputs.
 *
 * The blob is the one that actually goes missing. It is produced by a separate
 * `build:sea` step, and it used to be copied into the package only if it happened to
 * exist. A publish where that step had not run shipped a package whose fallback path
 * was simply absent — and that fallback is not a legacy nicety: it is what produces a
 * working executable on macOS x64, where `node --build-sea` currently segfaults.
 *
 * Asserted against the tarball rather than the output directory, because `files` in
 * package.json is the other half of the promise and a change there fails the same way.
 *
 * Run after `npm run build --workspace cli`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "cli");

const fail = (message, detail) => {
  console.error(`[check-cli-package] ${message}`);
  if (detail) console.error(`\n${detail}`);
  process.exit(1);
};

/**
 * `npm pack --dry-run --json`, run without a shell on every platform.
 *
 * Windows makes this awkward twice over: the executable is `npm.cmd`, so the bare name
 * resolves to nothing (ENOENT), and since the CVE-2024-27980 fix Node refuses to spawn
 * a `.cmd` at all unless `shell: true` (EINVAL). So npm is invoked the way npm invokes
 * itself: node running npm's own CLI entry point, whose path npm exports as
 * `npm_execpath` to the scripts it runs.
 */
function packedFiles() {
  const cli = process.env.npm_execpath;
  const [command, argv, useShell] = cli
    ? [process.execPath, [cli], false]
    : [process.platform === "win32" ? "npm.cmd" : "npm", [], true];

  const output = execFileSync(command, [...argv, "pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: CLI,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: useShell && process.platform === "win32",
  });
  // Two shapes, because npm changed one: an array of packed packages before npm 11,
  // an object keyed by package name after. Accept both.
  const parsed = JSON.parse(output);
  const packed = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (!Array.isArray(packed?.files)) {
    throw new Error(
      `"npm pack --json" reported no file list (got ${
        Array.isArray(parsed) ? "an empty array" : `keys: ${Object.keys(parsed).join(", ") || "none"}`
      })`,
    );
  }
  return packed.files;
}

const packed = new Set(packedFiles().map((f) => f.path.replace(/\\/g, "/")));

/** What `build-exe` reads, and why the build is dead without each one. */
const required = [
  ["dist/pi-outpost.sea.mjs", "the inlined bundle every build path starts from"],
  ["dist/sea-prep.blob", "the blob the fallback injects when --build-sea produces something that will not run"],
];

const missing = required.filter(([relative]) => !packed.has(relative));
if (missing.length > 0) {
  fail(
    "the tarball is missing what `pi-outpost build-exe` reads:",
    missing.map(([relative, why]) => `  ${relative} — ${why}`).join("\n") +
      `\n\nRun \`npm run build:sea --workspace server\` and \`npm run build --workspace cli\`, then re-check.` +
      `\nPublished as-is, \`npx pi-outpost build-exe\` fails on a fresh install.`,
  );
}

/**
 * What a producer built elsewhere reads, and why the package is not a contract without it.
 *
 * The schema is inlined in the bundle, so validation works whether or not these ship —
 * which is exactly why their absence is invisible here and total for the producer: they
 * would have a validator that judges their document and nothing that says what to send.
 * Both versions ship, because version 1 remains supported and a producer targeting it
 * must keep finding it.
 */
const contract = [
  ["dist/contract/schemas/structured-exchange-1.json", "the version 1 contract, still supported"],
  ["dist/contract/schemas/structured-exchange-2.json", "the enriched contract"],
  ["dist/contract/schemas/structured-exchange-profile-1.json", "the profile format a project declares its data model in"],
  ["dist/contract/schemas/structured-exchange-profile-registry-1.json", "the registry a project lists its profiles in"],
  ["dist/contract/schemas/structured-exchange-rules-1.json", "the rules a project reviews its specifications against"],
  ["dist/contract/conformance/index.json", "the conformance suite's manifest — the executable half of the contract"],
  ["dist/contract/validate-structured-exchange.mjs", "the reference validator, runnable without a checkout"],
  ["dist/contract/structured-exchange-project-setup.md", "how to write a project's profiles and rules, which the README links to"],
];

const absent = contract.filter(([relative]) => !packed.has(relative));
if (absent.length > 0) {
  fail(
    "the tarball is missing what a producer needs to write against the contract:",
    absent.map(([relative, why]) => `  ${relative} — ${why}`).join("\n") +
      `\n\nRun \`npm run build --workspace cli\`, then re-check.` +
      `\nPublished as-is, the package validates a producer's document and cannot tell them what shape it should have.`,
  );
}

console.log(
  `[check-cli-package] ok — the tarball carries ${required.length} build inputs and ${contract.length} contract files`,
);
