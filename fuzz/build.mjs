// Bundle each fuzz target into one CommonJS file Jazzer.js can load, and gather its seed corpus
// from the repository's own fixtures. Run from the repository root after `npm ci`:
//   node fuzz/build.mjs
// Output: fuzz/build/<target>.js and fuzz/build/seeds/<target>/…  (both ignored by git).
//
// Bundled for Node 20, the Node of OSS-Fuzz's JavaScript runner, with every dependency inlined:
// the fuzzers run from a copy of fuzz/ alone, without the repository's node_modules.
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fuzz = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(fuzz);
const out = path.join(fuzz, "build");

/** Each target and the files its corpus starts from: inputs the parser is known to meet. */
const TARGETS = {
  mail: ["server/test/fixtures/mail-thread.eml", "server/test/fixtures/mail-outlook.msg"],
  zip: readdirSync(path.join(root, "server/test/fixtures"))
    .filter((name) => /\.(docx|pptx|xlsx)$/.test(name) && !name.includes("bomb"))
    .map((name) => `server/test/fixtures/${name}`),
  "structured-exchange": ["valid", "invalid"].flatMap((kind) =>
    readdirSync(path.join(root, "shared/conformance", kind)).map((name) => `shared/conformance/${kind}/${name}`),
  ),
};

rmSync(out, { recursive: true, force: true });
for (const [target, seeds] of Object.entries(TARGETS)) {
  await build({
    entryPoints: [path.join(fuzz, "targets", `${target}.fuzz.ts`)],
    outfile: path.join(out, `${target}.js`),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: "inline",
    logLevel: "warning",
  });
  const corpus = path.join(out, "seeds", target);
  mkdirSync(corpus, { recursive: true });
  for (const seed of seeds) cpSync(path.join(root, seed), path.join(corpus, path.basename(seed)));
  console.log(`${target}: fuzz/build/${target}.js, ${seeds.length} seeds`);
}
