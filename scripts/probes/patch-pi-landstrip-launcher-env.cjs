/**
 * Local fix for pi-landstrip's Windows launcher environment, to see what fails next.
 *
 * pi-landstrip (0.19.8 to 0.19.11 at least) launches the landstrip runner with PATH, HOME
 * and ProgramData only. On Windows the runner also needs LOCALAPPDATA to create its
 * AppContainer, and a child needs SystemRoot: without them the launch fails with
 * `os error 203`. This patches an installed copy — never the one a real deployment uses.
 *
 *   node scripts/probes/patch-pi-landstrip-launcher-env.cjs <pi-landstrip dir>
 */
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.argv[2], "dist", "index.ts");
let source = fs.readFileSync(file, "utf8");
const start = source.indexOf("function createLandstripLauncherEnvironment(");
const end = source.indexOf("function createWindowsDenyRead(");
if (start < 0 || end < 0) throw new Error(`launcher environment function not found in ${file}`);
const replacement = `function createLandstripLauncherEnvironment(providerEnv, hostEnv = process.env, platform = process.platform) {
  if (platform !== "win32" || hostEnv.ProgramData === undefined)
    return providerEnv;
  const extra = Object.fromEntries(["LOCALAPPDATA", "SystemRoot", "windir", "ComSpec", "PATHEXT"].filter((k) => hostEnv[k] !== undefined).map((k) => [k, hostEnv[k]]));
  return { ...providerEnv, ProgramData: hostEnv.ProgramData, ...extra };
}
`;
source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(file, source);
console.log(`patched ${file}`);
