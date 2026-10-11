/**
 * Mermaid drawn by an installed pi-outpost package, with only what the install carries:
 * its `dist/mermaid-worker.mjs`, and the jsdom, canvas and resvg its own node_modules
 * resolved. Rehearses what `docx_create` relies on after `npm install -g pi-outpost`,
 * without starting a server or an agent.
 *
 *   node scripts/probes/installed-mermaid.mjs <installed package folder>
 *     e.g. $(npm root -g)/pi-outpost
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const packageDir = path.resolve(process.argv[2] ?? "");
const workerFile = path.join(packageDir, "dist", "mermaid-worker.mjs");
const fromPackage = createRequire(pathToFileURL(workerFile));
for (const name of ["jsdom", "@napi-rs/canvas", "@resvg/resvg-js"]) console.log(`${name.padEnd(16)} ${fromPackage.resolve(name)}`);

const worker = new Worker(pathToFileURL(workerFile));
const reply = await new Promise((resolve, reject) => {
  worker.once("message", resolve);
  worker.once("error", reject);
  worker.postMessage({ id: 1, source: "flowchart LR\n  A[Installed] --> B{Draws?}\n  B -->|yes| C[Word]", font: '"DejaVu Sans", Helvetica, Arial, sans-serif' });
});
await worker.terminate();
if ("error" in reply) throw new Error(`the worker refused: ${reply.error}`);
const { Resvg } = fromPackage("@resvg/resvg-js");
const png = new Resvg(reply.styled, { background: "#ffffff", fitTo: { mode: "zoom", value: 2 }, font: { loadSystemFonts: true } }).render().asPng();
const out = path.join(process.cwd(), "installed-mermaid.png");
writeFileSync(out, png);
console.log(`drawn: ${Math.round(reply.width)}×${Math.round(reply.height)}, labels ${["Installed", "Draws?", "yes", "Word"].every((label) => reply.svg.includes(label)) ? "all present" : "MISSING"}, png ${png.length} bytes → ${out}`);
