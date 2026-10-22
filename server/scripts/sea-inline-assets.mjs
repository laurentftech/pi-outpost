/**
 * The files the SDK reads beside its own modules, inside the single-file executable.
 *
 * The executable is one ESM bundle with nothing beside it. Three things the agent uses
 * load a file found relative to a module, and none of those files exists there:
 *
 * - **photon**, which the `read` tool resizes every image with, loads its WebAssembly
 *   with `readFileSync(join(__dirname, 'photon_rs_bg.wasm'))`. An ESM bundle has no
 *   `__dirname`: the load throws, the SDK's `loadPhoton()` swallows it, and every image
 *   comes back as "[Image omitted: could not be resized below the inline image size
 *   limit.]" — the model then describes a picture it never saw.
 * - **codemode** runs scripts in QuickJS, whose `quickjs.wasm` is found with
 *   `require.resolve("quickjs-wasi/quickjs.wasm")` — no `node_modules`, no file.
 * - **codemode's worker** is `pi-codemode`'s `worker.js` beside the module, unless the
 *   SDK was built as its own Node bundle. pi-outpost's bundle is not that build.
 *
 * Each is inlined: the wasm bytes into the code that read them, the worker as a `data:`
 * URL — what the SDK's own Node bundle does with it. Every replacement checks that the
 * code it replaces is still there; if the SDK changes it, the build stops rather than
 * ship an executable that silently loses images or codemode again.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
/** Where codemode's QuickJS module comes from, once it is no longer a file. */
const EMBEDDED_QUICKJS = "pi-outpost:embedded/quickjs.wasm";

/** One source edit, refused when the code it replaces has moved. */
function replaceOnce(source, file, pattern, replacement, why) {
  if (!pattern.test(source)) {
    throw new Error(`[sea-inline-assets] ${file} no longer has the code this build replaces — ${why} in the executable`);
  }
  return source.replace(pattern, () => replacement);
}

const base64 = async (file) => (await readFile(file)).toString("base64");

/** codemode's worker, bundled on its own: it runs from a `data:` URL, with nothing to import beside it. */
async function codemodeWorkerSource(sdkDist) {
  const result = await esbuild.build({
    entryPoints: [path.join(sdkDist, "extensions/codemode/worker.js")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const source = result.outputFiles[0].text;
  if (/\bimport\.meta\b|\brequire\(/.test(source)) {
    throw new Error("[sea-inline-assets] codemode's worker now needs import.meta or require, which a data: URL cannot give it");
  }
  return source;
}

/** An esbuild plugin that inlines photon's and codemode's files into the bundle. */
export function inlineSeaAssets() {
  return {
    name: "sea-inline-assets",
    setup(build) {
      build.onLoad({ filter: /[\\/]@silvia-odwyer[\\/]photon-node[\\/]photon_rs\.js$/ }, async (args) => {
        const wasm = await base64(path.join(path.dirname(args.path), "photon_rs_bg.wasm"));
        const contents = replaceOnce(
          await readFile(args.path, "utf8"),
          args.path,
          /const path = require\('path'\)\.join\(__dirname, 'photon_rs_bg\.wasm'\);\r?\nconst bytes = require\('fs'\)\.readFileSync\(path\);/,
          `const bytes = Buffer.from(${JSON.stringify(wasm)}, "base64");`,
          "images read by the agent would be dropped",
        );
        return { contents, loader: "js" };
      });

      build.onLoad({ filter: /[\\/]@earendil-works[\\/]pi-codemode[\\/]dist[\\/]wasm\.js$/ }, async (args) => {
        const wasm = await base64(require.resolve("quickjs-wasi/quickjs.wasm"));
        const contents = replaceOnce(
          await readFile(args.path, "utf8"),
          args.path,
          /module = readFile\(resolved\)/,
          `module = (resolved === ${JSON.stringify(EMBEDDED_QUICKJS)} ? Promise.resolve(Buffer.from(${JSON.stringify(wasm)}, "base64")) : readFile(resolved))`,
          "codemode could not start QuickJS",
        );
        return { contents, loader: "js" };
      });

      build.onLoad({ filter: /[\\/]@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]config\.js$/ }, async (args) => {
        const worker = Buffer.from(await codemodeWorkerSource(path.dirname(args.path))).toString("base64");
        let contents = await readFile(args.path, "utf8");
        contents = replaceOnce(
          contents,
          args.path,
          /quickJSWasmPath \?\?= createRequire\(import\.meta\.url\)\.resolve\("quickjs-wasi\/quickjs\.wasm"\);/,
          `quickJSWasmPath ??= ${JSON.stringify(EMBEDDED_QUICKJS)};`,
          "codemode could not find QuickJS",
        );
        contents = replaceOnce(
          contents,
          args.path,
          /export function getCodemodeWorkerSpecifier\(\) \{/,
          `export function getCodemodeWorkerSpecifier() {\n    return new URL(${JSON.stringify(`data:text/javascript;base64,${worker}`)});`,
          "codemode would have no worker",
        );
        return { contents, loader: "js" };
      });
    },
  };
}
