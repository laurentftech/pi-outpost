/**
 * Bundle the reference validator into something a producer can actually run.
 *
 * The script under bin/ imports this repository's TypeScript, so it needs `tsx` and
 * a checkout — which makes it a demonstration rather than an interface. An external
 * producer, an MCP server in particular, needs one file and a Node runtime.
 *
 * Everything goes in: the schema as data, the semantic rules, and the validator
 * library. Nothing is resolved at run time, so the bundle works from any directory
 * on any machine.
 */
import { build } from "esbuild";
import { chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../dist/validate-structured-exchange.mjs");

await mkdir(path.dirname(OUT), { recursive: true });
// The version a conformity report states: the CLI that ships this bundle.
const { version } = JSON.parse(await readFile(path.resolve(HERE, "../../cli/package.json"), "utf8"));

const result = await build({
  entryPoints: [path.resolve(HERE, "../bin/validate-structured-exchange.mjs")],
  outfile: OUT,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // The schema travels as data inside the bundle. Reading it from a path relative to
  // the module is what broke the last time this shipped: the path resolves inside
  // this repository and nowhere else.
  loader: { ".json": "json" },
  define: { __VALIDATOR_VERSION__: JSON.stringify(version) },
  // No banner: the entry point already carries a shebang, and esbuild keeps it.
  // A second one lands on line two, where it is a syntax error rather than a
  // comment — which every test inside the repository was blind to, because none of
  // them ran the bundle.
  metafile: true,
});

await chmod(OUT, 0o755);

const bundled = Object.keys(result.metafile.outputs)[0];
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${result.metafile.outputs[bundled].bytes} bytes)`);
