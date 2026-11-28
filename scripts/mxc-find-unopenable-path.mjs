// Finds what makes Windows refuse to build the process security environment
// (CreateProcessSecurityEnvironment failing 0x80070005) for the agent shell's REAL launch.
//
// The real policy is built with the production builders (buildTerminalConfinement +
// confinedEnvironment), not approximated. If the full request fails, the script bisects, inside
// that real request: first the filesystem paths (each kept in its role), then the environment
// entries. If nothing fails alone, it says the refusal is a pure combination/size effect.
//
// Run on the Windows host in a clone of this repository, against a project directory:
//   node --import tsx scripts/mxc-find-unopenable-path.mjs [project-dir]   (default: cwd)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mxcSdk, sdkRequest, isSecurityEnvironmentRefusal } from "../server/src/mxcSdk.ts";
import { buildTerminalConfinement } from "../server/src/confinementStatus.ts";
import { confinedEnvironment } from "../server/src/terminalSandbox.ts";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const tmp = mkdtempSync(path.join(tmpdir(), "pi-outpost-offender-"));
const home = process.env.USERPROFILE;
const agentDir = home ? path.join(home, ".pi", "agent") : undefined;
const configFile = home ? path.join(home, ".config", "pi-outpost", "config.json") : undefined;
const shell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const confine = buildTerminalConfinement({
  runner: "mxc",
  root,
  allowWrite: true,
  ...(agentDir ? { agentDir } : {}),
  ...(configFile ? { configFile } : {}),
});
const env = confinedEnvironment(process.env, { root, tmp, shell, platform: "win32", containerProfileInTmp: true });
const terminal = { tmp, shell, shellArgs: [], cwd: root, env };
const policy = confine.policy(terminal, 0);

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

console.log(`root=${root}`);
console.log(
  `policy: ${policy.filesystem.readwritePaths.length} read-write, ${policy.filesystem.readonlyPaths.length} read-only, ${policy.filesystem.deniedPaths.length} denied, ${(policy.processContainer?.filesystem?.enumeratePaths ?? []).length} enumerable, ${policy.process.env.length} env entries`,
);

if (!(await refuses(policy))) {
  console.log("the real policy at level 0 does NOT fail here — try level 1 (the server retries it once).");
  process.exit(0);
}
console.log("the real policy fails; bisecting inside it.");

// Bisect a list of mutations over the real wire; returns the mutations that fail on their own.
async function bisect(mutations) {
  const applies = async (batch) => {
    const wire = structuredClone(policy);
    for (const m of batch) m(wire);
    return refuses(wire);
  };
  const offenders = async (batch) => {
    if (batch.length === 0 || !(await applies(batch))) return [];
    if (batch.length === 1) return batch;
    const mid = Math.ceil(batch.length / 2);
    return [...(await offenders(batch.slice(0, mid))), ...(await offenders(batch.slice(mid)))];
  };
  return offenders(mutations);
}

// 1) filesystem paths, each replaced by nothing (removed), keeping their role slot empty.
const pathMutations = [
  ...policy.filesystem.deniedPaths.map((p) => ({ label: `denied ${p}`, apply: (w) => { w.filesystem.deniedPaths = w.filesystem.deniedPaths.filter((x) => x !== p); } })),
  ...policy.filesystem.readonlyPaths.map((p) => ({ label: `readonly ${p}`, apply: (w) => { w.filesystem.readonlyPaths = w.filesystem.readonlyPaths.filter((x) => x !== p); } })),
  ...(policy.processContainer?.filesystem?.enumeratePaths ?? []).map((p) => ({ label: `enumerate ${p}`, apply: (w) => { w.processContainer.filesystem.enumeratePaths = w.processContainer.filesystem.enumeratePaths.filter((x) => x !== p); } })),
].map((m) => (w) => m.apply(w));
const pathLabels = [
  ...policy.filesystem.deniedPaths.map((p) => `denied ${p}`),
  ...policy.filesystem.readonlyPaths.map((p) => `readonly ${p}`),
  ...(policy.processContainer?.filesystem?.enumeratePaths ?? []).map((p) => `enumerate ${p}`),
];
const badPaths = await bisect(pathMutations);
console.log(`removing a single path fixes it for: ${badPaths.length}`);
for (const i of badPaths) console.log(`  ${pathLabels[i]}`);

// 2) env entries, each removed.
const envMutations = policy.process.env.map((entry, i) => (w) => { w.process.env = w.process.env.filter((_, j) => j !== i); });
const badEnv = await bisect(envMutations);
console.log(`removing a single env entry fixes it for: ${badEnv.length}`);
for (const i of badEnv) console.log(`  env ${policy.process.env[i].split("=")[0]}=…`);

if (badPaths.length === 0 && badEnv.length === 0) {
  console.log("nothing single fixes it: the refusal is a pure combination/size effect. Measuring the budget…");
  const withCounts = (deniedN, readonlyN) => {
    const wire = structuredClone(policy);
    wire.filesystem.deniedPaths = policy.filesystem.deniedPaths.slice(0, deniedN);
    wire.filesystem.readonlyPaths = policy.filesystem.readonlyPaths.slice(0, readonlyN);
    return wire;
  };
  const maxPassing = async (total, make) => {
    let lo = 0, hi = total; // lo passes, hi fails
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (await refuses(make(mid))) hi = mid; else lo = mid;
    }
    return lo;
  };
  const deniedTotal = policy.filesystem.deniedPaths.length;
  const readonlyTotal = policy.filesystem.readonlyPaths.length;
  const deniedBudget = await maxPassing(deniedTotal, (n) => withCounts(n, readonlyTotal));
  console.log(`denied entries: passes with <= ${deniedBudget}, fails from ${deniedBudget + 1} (policy has ${deniedTotal}).`);
  const readonlyBudget = await maxPassing(readonlyTotal, (n) => withCounts(deniedTotal, n));
  console.log(`read-only entries: passes with <= ${readonlyBudget}, fails from ${readonlyBudget + 1} (policy has ${readonlyTotal}).`);
}
