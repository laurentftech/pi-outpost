// Builds the probe executable: node scripts/probes/mxc-sdk-sea/build.mjs <outDir>
import esbuild from "esbuild";
import { cpSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const out = path.resolve(process.argv[2]);
mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(here, "main.mjs")], bundle: true, platform: "node", format: "esm", target: "node26",
  outfile: path.join(out, "bundle.mjs"), alias: { koffi: path.join(here, "koffi-shim.cjs") },
  banner: { js: "import { createRequire as ___cr } from 'node:module'; const require = ___cr(import.meta.url);" },
});
writeFileSync(path.join(out, "sea-config.json"), JSON.stringify({ main: path.join(out, "bundle.mjs"), mainFormat: "module", output: path.join(out, "probe.exe"), disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ["--build-sea", path.join(out, "sea-config.json")], { stdio: "inherit" });
// Beside the exe: koffi's package (its prebuilt .node inside) and MXC's native library.
cpSync(path.join(repo, "node_modules/koffi"), path.join(out, "node_modules/koffi"), { recursive: true });
// koffi 3 keeps its native module in a package per platform, which it looks for beside its own.
cpSync(path.join(repo, `node_modules/@koromix/koffi-${process.platform}-${process.arch}`), path.join(out, `node_modules/@koromix/koffi-${process.platform}-${process.arch}`), { recursive: true });
copyFileSync(path.join(repo, "node_modules/@microsoft/mxc-sdk/bin/x64/mxc_ffi.dll"), path.join(out, "mxc_ffi.dll"));
console.log("built", path.join(out, "probe.exe"));
