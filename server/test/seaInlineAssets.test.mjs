/**
 * What the agent does with files the SDK loads beside its own modules, inside the
 * single-file executable: an image read with `read`, and a codemode script.
 *
 * photon (image resizing) loads its WebAssembly from `__dirname`, which an ESM bundle
 * does not have; codemode finds `quickjs.wasm` with `require.resolve` and its worker
 * beside the module. In the executable none of them is there: every image the agent
 * read came back as "[Image omitted: could not be resized …]" — the model described a
 * picture it never saw — and codemode failed on its first script. A source run, and
 * the npm package (the SDK stays external there), never showed either.
 *
 * So each is bundled the way `build-sea.mjs` bundles the server — ESM, every dependency
 * inlined, the same banner and plugin — and run from a directory with no `node_modules`
 * above it and no file beside it, as the executable runs. The same bundle without the
 * plugin is run too: it is the failure, and it proves the test can see it.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, describe, test } from "node:test";
import esbuild from "esbuild";
import { envWithoutCoverageSink } from "./childEnv.mjs";
import { inlineSeaAssets } from "../scripts/sea-inline-assets.mjs";

const run = promisify(execFile);
const SDK = fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/", import.meta.url));
// The entries import the SDK by path, so they have to sit inside the repo. `node_modules/.cache` is git-ignored.
const CACHE = fileURLToPath(new URL("../../node_modules/.cache", import.meta.url));
/** A real 64×48 PNG: photon refuses a malformed one, which would fail for another reason. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAADYSURBVGiB7ZkhDsIwGEa/EkimMYiJJYg5AhfaKXasud2gHscJJqamqhHglmBHmyf2PdeK/i8vrWp4Sh/tmAMtQOMAtACNA9ACNA5AC9A4AC1A4wC0AI0D0AI0DkAL0DgALUDjALQATfYAl77XbZp+9toYdR0GSdJ9WXTuutxjN+MbQAvQHEsceqprPVJa16GqlMaxxKi/KRLgPc96Nc26bmMsMSYLu38CDkAL0AT/De4cB6AFaByAFqBxAFqAxgFoARoHoAVoHIAWoHEAWoDGAWgBGgegBWi+KcoXBy4+/5AAAAAASUVORK5CYII=",
  "base64",
);

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Bundles the entry `body(sdk)` writes like the executable, and runs it from an empty
 * directory holding only `picture.png`. It prints one JSON line: what the model would be given.
 */
async function runBundled(body, plugins) {
  await mkdir(CACHE, { recursive: true });
  const source = await mkdtemp(path.join(CACHE, "sea-assets-"));
  const runFrom = await mkdtemp(path.join(tmpdir(), "sea-assets-run-"));
  dirs.push(source, runFrom);
  const entry = path.join(source, "entry.mjs");
  // A relative specifier with forward slashes: an absolute Windows path is no import specifier.
  const sdk = (file) => JSON.stringify(path.relative(source, path.join(SDK, file)).split(path.sep).join("/"));
  await writeFile(entry, body(sdk));
  const outfile = path.join(runFrom, "pi-outpost.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
    banner: { js: "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);" },
    plugins,
  });
  await writeFile(path.join(runFrom, "picture.png"), PNG);
  const { stdout } = await run(process.execPath, [outfile], { cwd: runFrom, env: envWithoutCoverageSink(), timeout: 60_000 });
  return JSON.parse(stdout);
}

/** The `read` tool on the picture: its content, with the image's bytes left out. */
const READ = (sdk) => `import { createReadToolDefinition } from ${sdk("core/tools/read.js")};
const result = await createReadToolDefinition(process.cwd()).execute("call", { path: "picture.png" });
console.log(JSON.stringify(result.content.map((block) => (block.type === "image" ? { type: "image", mimeType: block.mimeType } : block))));
`;

/** A codemode script, run by the codemode tool itself: its output, or what it threw. */
const CODEMODE = (sdk) => `import { executeCodemode } from ${sdk("extensions/codemode/execute.js")};
try {
  const result = await executeCodemode("call", { code: "return 6 * 7" });
  console.log(JSON.stringify({ text: result.content.map((block) => block.text).join("\\n") }));
} catch (error) {
  console.log(JSON.stringify({ error: error.message.split("\\n")[0] }));
}
process.exit(0);
`;

describe("the files the SDK loads, inside the executable", () => {
  test("an image read with read reaches the model as an image", { timeout: 120_000 }, async () => {
    assert.deepEqual(await runBundled(READ, [inlineSeaAssets()]), [
      { type: "text", text: "Read image file [image/png]" },
      { type: "image", mimeType: "image/png" },
    ]);
  });

  test("a codemode script runs", { timeout: 120_000 }, async () => {
    const { text, error } = await runBundled(CODEMODE, [inlineSeaAssets()]);
    assert.equal(error, undefined);
    assert.match(text, /Script completed/);
    assert.match(text, /^42$/m);
  });

  test("without the plugin, the same bundle reads no image and runs no script — the failure this guards", { timeout: 120_000 }, async () => {
    const read = await runBundled(READ, []);
    assert.equal(read.length, 1, JSON.stringify(read));
    assert.match(read[0].text, /Image omitted: could not be resized/);
    const codemode = await runBundled(CODEMODE, []);
    assert.match(codemode.error ?? "", /quickjs\.wasm/);
  });
});
