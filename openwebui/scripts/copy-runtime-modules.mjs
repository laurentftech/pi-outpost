/**
 * Copies the packages the bundled server loads at run time — and everything they
 * depend on — out of an installed tree, into a `node_modules` of their own.
 *
 * The server is one bundled file, but three of its dependencies cannot be bundled:
 * `@napi-rs/canvas` and `@resvg/resvg-js` are native, and jsdom reads files of its own
 * at run time. Installing them again in the image would pick versions the lockfile
 * did not; copying what `npm ci` installed keeps the image on exactly the versions the
 * tests ran with, and nothing else of the workspace's dependencies.
 *
 *   node copy-runtime-modules.mjs <installed node_modules> <target node_modules> <package>...
 *
 * Optional dependencies are followed when installed: that is how a native package's
 * build for this platform comes along, and only that one.
 */
import fs from "node:fs";
import path from "node:path";

const [from, to, ...roots] = process.argv.slice(2);
if (!from || !to || roots.length === 0) {
  console.error("usage: copy-runtime-modules.mjs <installed node_modules> <target node_modules> <package>...");
  process.exit(2);
}
const source = path.resolve(from);

/** Where Node would find `name` when required from the package in `dir`. */
function locate(name, dir) {
  for (let at = dir; at.startsWith(source); at = path.dirname(at)) {
    const candidate = path.join(at === source ? at : path.join(at, "node_modules"), name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (at === source) break;
  }
  return undefined;
}

const found = new Set();
const pending = roots.map((name) => ({ name, from: source, optional: false }));
while (pending.length > 0) {
  const { name, from: dir, optional } = pending.pop();
  const located = locate(name, dir);
  if (located === undefined) {
    if (optional) continue;
    console.error(`copy-runtime-modules: ${name} is not installed (needed from ${path.relative(source, dir) || "the root"})`);
    process.exit(1);
  }
  if (found.has(located)) continue;
  found.add(located);
  const manifest = JSON.parse(fs.readFileSync(path.join(located, "package.json"), "utf8"));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) pending.push({ name: dependency, from: located, optional: false });
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) pending.push({ name: dependency, from: located, optional: true });
}

for (const dir of found) {
  fs.cpSync(dir, path.join(to, path.relative(source, dir)), { recursive: true, dereference: true });
}
console.log(`copy-runtime-modules: ${found.size} packages for ${roots.join(", ")}`);
