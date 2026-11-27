// Finds what makes Windows refuse to build the process security environment
// (CreateProcessSecurityEnvironment failing 0x80070005) for the agent shell's real launch.
//
// Phase 1 builds the real policy's paths and checks they do NOT fail alone. Phase 2 then adds the
// real launch's other parts one by one on top of the passing baseline — the real process line and
// working directory, the confined environment, the network block, the ui block, the proxy's
// runtimeConfig — and bisects whichever part makes the build fail (down to a single env entry).
//
// Run on the Windows host in a clone of this repository, against a project directory:
//   node --import tsx scripts/mxc-find-unopenable-path.mjs [project-dir]   (default: cwd)
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mxcSdk, sdkRequest, isSecurityEnvironmentRefusal } from "../server/src/mxcSdk.ts";
import { confinedEnvironment, defaultSandboxCache, mxcTerminalConfig, siblingsToDeny } from "../server/src/terminalSandbox.ts";
import { powerShellCommandFile, powerShellScript, POWERSHELL_COMMAND_FILE } from "../server/src/confinedBash.ts";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const tmp = mkdtempSync(path.join(tmpdir(), "pi-outpost-offender-"));
const home = process.env.USERPROFILE;
const agentDir = home ? path.join(home, ".pi", "agent") : undefined;
const configFile = home ? path.join(home, ".config", "pi-outpost", "config.json") : undefined;
const shell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const policy = mxcTerminalConfig({
  root,
  allowWrite: true,
  tmp,
  shell,
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

async function refuses(wire) {
  try {
    const proc = await sdk.spawn(sdkRequest(wire));
    await proc.wait();
    return false;
  } catch (error) {
    return isSecurityEnvironmentRefusal(error);
  }
}

const baseWire = () => ({
  version: "1.0.0",
  containment: "processcontainer",
  process: { commandLine: "cmd.exe /c exit 0", cwd: root, env: [`PATH=${process.env.PATH ?? ""}`] },
  filesystem: policy.filesystem,
  ...(policy.processContainer ? { processContainer: policy.processContainer } : {}),
});

console.log(`root=${root}`);
console.log(`policy: ${policy.filesystem.readwritePaths.length} read-write, ${policy.filesystem.readonlyPaths.length} read-only, ${policy.filesystem.deniedPaths.length} denied, ${(policy.processContainer?.filesystem?.enumeratePaths ?? []).length} enumerable`);

// Phase 1: the policy's paths alone.
if (await refuses(baseWire())) {
  console.log("phase 1: the policy's paths ALONE fail — bisecting them.");
  const candidates = [
    ...policy.filesystem.deniedPaths.map((p) => ({ path: p, role: "denied" })),
    ...policy.filesystem.readonlyPaths.map((p) => ({ path: p, role: "readonly" })),
    ...(policy.processContainer?.filesystem?.enumeratePaths ?? []).map((p) => ({ path: p, role: "enumerate" })),
  ];
  const wireFor = (batch) => {
    const wire = baseWire();
    wire.filesystem = {
      readwritePaths: policy.filesystem.readwritePaths,
      readonlyPaths: batch.filter((c) => c.role === "readonly").map((c) => c.path),
      deniedPaths: batch.filter((c) => c.role === "denied").map((c) => c.path),
    };
    const enumerated = batch.filter((c) => c.role === "enumerate").map((c) => c.path);
    if (enumerated.length > 0) wire.processContainer = { filesystem: { enumeratePaths: enumerated } };
    else delete wire.processContainer;
    return wire;
  };
  const offenders = async (batch) => {
    if (batch.length === 0 || !(await refuses(wireFor(batch)))) return [];
    if (batch.length === 1) return batch;
    const mid = Math.ceil(batch.length / 2);
    return [...(await offenders(batch.slice(0, mid))), ...(await offenders(batch.slice(mid)))];
  };
  const bad = await offenders(candidates);
  if (bad.length === 0) console.log("  no single path fails alone: combination/size effect.");
  else for (const c of bad) console.log(`  [${c.role}] ${c.path}`);
  process.exit(0);
}
console.log("phase 1: the policy's paths alone pass.");

// Phase 2: the real launch's other parts, one by one on top of the passing baseline.
const scriptFile = path.join(tmp, "command.ps1");
writeFileSync(scriptFile, powerShellScript());
writeFileSync(path.join(tmp, POWERSHELL_COMMAND_FILE), powerShellCommandFile("exit 0"));
const confinedEnv = confinedEnvironment(process.env, { root, tmp, shell, platform: "win32", containerProfileInTmp: true });

const parts = [
  ["real process (shell, script in tmp, cwd)", (w) => { w.process = { commandLine: `"${shell}" -NoProfile -NonInteractive -File "${scriptFile}"`, cwd: root, env: w.process.env }; }],
  ["confined environment", (w) => { w.process.env = Object.entries(confinedEnv).map(([k, v]) => `${k}=${v}`); }],
  ["network block", (w) => { w.network = policy.network; }],
  ["ui block", (w) => { w.ui = policy.ui; }],
  ["proxy runtimeConfig", (w) => { w.runtimeConfig = { networkProxy: "http://127.0.0.1:1" }; }],
];

for (const [name, apply] of parts) {
  const wire = baseWire();
  apply(wire);
  if (await refuses(wire)) {
    console.log(`phase 2: FAILS with the ${name}`);
    if (name === "confined environment") {
      const entries = Object.entries(confinedEnv).map(([k, v]) => `${k}=${v}`);
      const offenders = async (batch) => {
        if (batch.length === 0) return [];
        const w = baseWire();
        w.process.env = batch;
        if (!(await refuses(w))) return [];
        if (batch.length === 1) return batch;
        const mid = Math.ceil(batch.length / 2);
        return [...(await offenders(batch.slice(0, mid))), ...(await offenders(batch.slice(mid)))];
      };
      const bad = await offenders(entries);
      if (bad.length === 0) console.log("  no single env entry fails alone: combination/size effect.");
      else for (const e of bad) console.log(`  env entry: ${e.split("=")[0]}=…`);
    }
    process.exit(0);
  }
  console.log(`phase 2: passes with ${name}`);
}
console.log("phase 2: nothing fails alone — the refusal needs the full combination.");
