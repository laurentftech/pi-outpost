// Finds which policy paths Windows cannot open when it builds the process security environment
// (CreateProcessSecurityEnvironment failing 0x80070005): builds the agent shell's real policy for
// the project directory, checks the full policy fails, then bisects the paths — each kept in its
// original role (denied / read-only / enumerable) — until every individually offending path is
// named. If none fails alone, the failure only happens in combination (size or interaction) and the
// script says so.
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

// Candidates with the role they have in the real policy.
const candidates = [
  ...policy.filesystem.deniedPaths.map((p) => ({ path: p, role: "denied" })),
  ...policy.filesystem.readonlyPaths.map((p) => ({ path: p, role: "readonly" })),
  ...(policy.processContainer?.filesystem?.enumeratePaths ?? []).map((p) => ({ path: p, role: "enumerate" })),
];

function wireFor(batch) {
  const wire = {
    version: "1.0.0",
    containment: "processcontainer",
    process: { commandLine: "cmd.exe /c exit 0", cwd: root, env: [`PATH=${process.env.PATH ?? ""}`] },
    filesystem: {
      readwritePaths: [root, tmp],
      readonlyPaths: batch.filter((c) => c.role === "readonly").map((c) => c.path),
      deniedPaths: batch.filter((c) => c.role === "denied").map((c) => c.path),
    },
  };
  const enumerated = batch.filter((c) => c.role === "enumerate").map((c) => c.path);
  if (enumerated.length > 0) wire.processContainer = { filesystem: { enumeratePaths: enumerated } };
  return wire;
}

/** Whether the SDK refuses to build the security environment over this batch. */
async function refuses(batch) {
  try {
    const proc = await sdk.spawn(sdkRequest(wireFor(batch)));
    await proc.wait();
    return false;
  } catch (error) {
    return isSecurityEnvironmentRefusal(error);
  }
}

/** All entries of `batch` that fail on their own (bisect both halves when the batch fails). */
async function offenders(batch) {
  if (batch.length === 0 || !(await refuses(batch))) return [];
  if (batch.length === 1) return batch;
  const mid = Math.ceil(batch.length / 2);
  return [...(await offenders(batch.slice(0, mid))), ...(await offenders(batch.slice(mid)))];
}

console.log(`root=${root}`);
console.log(`policy: ${policy.filesystem.readwritePaths.length} read-write, ${policy.filesystem.readonlyPaths.length} read-only, ${policy.filesystem.deniedPaths.length} denied, ${(policy.processContainer?.filesystem?.enumeratePaths ?? []).length} enumerable`);

if (!(await refuses(candidates))) {
  console.log("the full policy does NOT fail here — the refusal needs the real launch's other parts (process, network, env); nothing to bisect in the paths.");
  process.exit(0);
}
console.log("the full policy fails as expected; bisecting…");
const bad = await offenders(candidates);
if (bad.length === 0) {
  console.log("no single path fails alone: the refusal only happens in combination (size or interaction between entries).");
} else {
  console.log(`paths that fail alone (${bad.length}):`);
  for (const c of bad) console.log(`  [${c.role}] ${c.path}`);
}
