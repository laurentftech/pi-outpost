// Finds which policy path Windows cannot open when it builds the process security environment
// (CreateProcessSecurityEnvironment failing 0x80070005): builds the agent shell's real policy for
// the current directory, then bisects the policy's paths through the real MXC SDK until each
// offending path is named.
//
// Run on the Windows host in a clone of this repository, against a project directory:
//   node --import tsx scripts/mxc-find-unopenable-path.mjs [project-dir]   (default: cwd)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mxcSdk, sdkRequest, isSecurityEnvironmentRefusal } from "../server/src/mxcSdk.ts";
import { defaultSandboxCache, mxcTerminalConfig, siblingsToDeny } from "../server/src/terminalSandbox.ts";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const tmp = mkdtempSync(path.join(tmpdir(), "pi-outpost-offender-"));
const home = process.env.USERPROFILE;
const agentDir = home ? path.join(home, ".pi", "agent") : undefined;
const configFile = home ? path.join(home, ".config", "pi-outpost", "config.json") : undefined;

const policy = mxcTerminalConfig({
  root,
  allowWrite: true,
  tmp,
  shell: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  shellArgs: [],
  cwd: root,
  env: { PATH: process.env.PATH ?? "" },
  siblings: siblingsToDeny(root),
  searchPath: process.env.PATH,
  ...(home ? { home } : {}),
  ...(agentDir ? { agentDir } : {}),
  ...(configFile ? { configFile } : {}),
  grantedRead: [defaultSandboxCache()],
});

const loaded = await mxcSdk();
if ("reason" in loaded) {
  console.error(`no MXC SDK on this host: ${loaded.reason}`);
  process.exit(1);
}
const sdk = loaded.sdk;

/** Whether the SDK refuses to build the security environment over `paths` placed as `where`. */
async function refuses(paths, where) {
  const wire = {
    version: "1.0.0",
    containment: "processcontainer",
    process: { commandLine: "cmd.exe /c exit 0", cwd: root, env: [`PATH=${process.env.PATH ?? ""}`] },
    filesystem: {
      readwritePaths: [root, tmp],
      readonlyPaths: where === "readonly" ? paths : [],
      deniedPaths: where === "denied" ? paths : [],
    },
  };
  try {
    const proc = await sdk.spawn(sdkRequest(wire));
    await proc.wait();
    return false;
  } catch (error) {
    return isSecurityEnvironmentRefusal(error);
  }
}

/** Bisect `paths` down to the ones whose presence makes the build fail. */
async function bisect(paths, where) {
  if (paths.length === 0) return [];
  if (!(await refuses(paths, where))) return [];
  if (paths.length === 1) return paths;
  const mid = Math.ceil(paths.length / 2);
  const first = await bisect(paths.slice(0, mid), where);
  if (first.length > 0) return first;
  return bisect(paths.slice(mid), where);
}

const denied = policy.filesystem.deniedPaths;
const readonly = policy.filesystem.readonlyPaths;
const enumerated = policy.processContainer?.filesystem?.enumeratePaths ?? [];
console.log(`root=${root}`);
console.log(`policy: ${policy.filesystem.readwritePaths.length} read-write, ${readonly.length} read-only, ${denied.length} denied, ${enumerated.length} enumerable`);

const badDenied = await bisect(denied, "denied");
console.log("denied paths the security environment cannot open:");
for (const p of badDenied) console.log(`  ${p}`);
if (badDenied.length === 0) {
  const badReadonly = await bisect(readonly, "readonly");
  console.log("read-only paths the security environment cannot open:");
  for (const p of badReadonly) console.log(`  ${p}`);
  if (badReadonly.length === 0) console.log("  (none found in read-only either — the failure may need the paths combined)");
}
