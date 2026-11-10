// Fuzz every target built by fuzz/build.mjs with Jazzer.js, one after another, for a fixed time
// each. Run from the repository root after `node fuzz/build.mjs` and `(cd fuzz && npm ci)`:
//   node fuzz/run.mjs <seconds per target> [target …]
//
// Jazzer.js is run directly rather than through ClusterFuzzLite's actions: those cannot fuzz
// JavaScript. Their configuration accepts only the address, memory, undefined and coverage
// sanitizers, OSS-Fuzz's JavaScript builder accepts only none and coverage, and coverage turns a
// run into a coverage report that fuzzes nothing. `.clusterfuzzlite/` stays laid out as an
// OSS-Fuzz project, which builds JavaScript without a sanitizer.
//
// Each target grows its corpus in fuzz/build/corpus/<target>, starting from its seeds, and writes
// a crashing input to fuzz/artifacts/<target>/. Every target runs even when an earlier one found
// something; the exit code is non-zero when any did.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fuzz = path.dirname(fileURLToPath(import.meta.url));
const ALL = ["mail", "zip", "structured-exchange"];

const [secondsArg, ...requested] = process.argv.slice(2);
const seconds = Number(secondsArg);
if (!Number.isInteger(seconds) || seconds <= 0) {
  console.error("usage: node fuzz/run.mjs <seconds per target> [target …]");
  process.exit(2);
}
const unknown = requested.filter((target) => !ALL.includes(target));
if (unknown.length > 0) {
  console.error(`unknown target: ${unknown.join(", ")} (known: ${ALL.join(", ")})`);
  process.exit(2);
}
const targets = requested.length > 0 ? requested : ALL;

const cli = path.join(fuzz, "node_modules/@jazzer.js/core/dist/cli.js");
if (!existsSync(cli)) {
  console.error("Jazzer.js is not installed: run (cd fuzz && npm ci) first.");
  process.exit(2);
}

const failed = [];
for (const target of targets) {
  const bundle = path.join(fuzz, "build", `${target}.js`);
  if (!existsSync(bundle)) {
    console.error(`${target}: ${path.relative(process.cwd(), bundle)} is missing: run node fuzz/build.mjs first.`);
    process.exit(2);
  }
  const corpus = path.join(fuzz, "build", "corpus", target);
  const seeds = path.join(fuzz, "build", "seeds", target);
  const artifacts = path.join(fuzz, "artifacts", target);
  mkdirSync(corpus, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  console.log(`::group::${target}: ${seconds} s`);
  // The first corpus directory is the one libFuzzer adds new inputs to; the seeds are only read.
  //
  // Not `--sync`: that mode calls the target in a loop on the main thread and never yields to the
  // event loop, so whatever Node releases there never is. zlib is one: an engine that fails on
  // damaged data is destroyed through `process.nextTick`, and the zip target grew by ~4 KB a run
  // until libFuzzer stopped it out of memory — a leak the server, whose event loop turns, does not
  // have. The default mode runs libFuzzer on its own thread and the event loop with it, at about
  // two thirds of the speed.
  const run = spawnSync(
    process.execPath,
    [cli, bundle, corpus, seeds, "--", `-max_total_time=${seconds}`, `-artifact_prefix=${artifacts}${path.sep}`],
    { cwd: fuzz, stdio: "inherit" },
  );
  console.log("::endgroup::");
  if (run.status !== 0) {
    failed.push(target);
    console.log(`::error title=Fuzzing found a problem in ${target}::the crashing input is in fuzz/artifacts/${target}/`);
  } else {
    console.log(`${target}: no finding in ${seconds} s`);
  }
}

if (failed.length > 0) {
  console.error(`findings in: ${failed.join(", ")}`);
  process.exit(1);
}
