// Measures whether the agent shell's MXC policy can become a pure whitelist on Windows (issue #593):
// the root's drive no longer readable whole, and no deny-list beside the way down.
//
// Every variant starts from the REAL level-0 policy (buildTerminalConfinement + confinedEnvironment,
// as mxc-find-unopenable-path.mjs builds it) and changes one thing at a time:
//   real          — the policy as shipped (drive readable, siblings denied)
//   no-drive      — drive roots removed from readonlyPaths, denies kept
//   whitelist     — drive roots removed and deniedPaths emptied (the target of #593)
//   whitelist+enum-drive — as whitelist, the drive roots enumerable instead of readable
//   whitelist-noenum — as whitelist, and no enumeratePaths either
// In each, it runs: node -e, node <file>, npm (plain, and with Node's --preserve-symlinks-main /
// --preserve-symlinks: Node lstats every component of a module's path, the drive root included),
// python, rtk, git status/rev-parse/log/diff, git status with GIT_CEILING_DIRECTORIES + GIT_DIR +
// GIT_WORK_TREE set (does git still walk the parents?), and two leak checks that must be refused: a
// marker beside the container's temporary directory, and a listing of a sibling of the root.
// Read-only: nothing is committed; a probe file is written at the root and removed.
//
// Run on the Windows host in a clone of this repository, against a project directory that is a git
// work tree:
//   npm run sandbox:mxc-whitelist -- [project-dir]   (default: cwd)
import { existsSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mxcSdk, sdkRequest, runThroughSdk, isSecurityEnvironmentRefusal } from "../server/src/mxcSdk.ts";
import { buildTerminalConfinement } from "../server/src/confinementStatus.ts";
import { confinedEnvironment } from "../server/src/terminalSandbox.ts";

if (process.platform !== "win32") {
  console.error("Windows MXC only.");
  process.exit(1);
}

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
if (!existsSync(root)) {
  console.error(`no such project directory: ${root}`);
  process.exit(1);
}
const tmp = mkdtempSync(path.join(tmpdir(), "pi-outpost-whitelist-"));
const beside = mkdtempSync(path.join(tmpdir(), "pi-outpost-whitelist-beside-"));
const marker = path.join(beside, "marker");
writeFileSync(marker, "LEAKED");
// A script run from a file: Node resolves its main module's real path (lstat of every component).
const hello = path.join(root, ".mxc-whitelist-probe-hello.cjs");
const rtkDirBefore = existsSync(path.join(root, "rtk"));
try {
  writeFileSync(hello, "console.log('hello from a file')\n");
} catch (error) {
  console.error(`cannot write the probe file in the project (${hello}): ${error.code ?? error.message}`);
  process.exit(1);
}
const parent = path.dirname(root);
const sibling = readdirSync(parent, { withFileTypes: true }).find((e) => e.isDirectory() && path.join(parent, e.name).toLowerCase() !== root.toLowerCase());
const siblingPath = sibling ? path.join(parent, sibling.name) : undefined;

const home = process.env.USERPROFILE;
const agentDir = home ? path.join(home, ".pi", "agent") : undefined;
const configFile = home ? path.join(home, ".config", "pi-outpost", "config.json") : undefined;
const shell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const confine = buildTerminalConfinement({ runner: "mxc", root, allowWrite: true, ...(agentDir ? { agentDir } : {}), ...(configFile ? { configFile } : {}) });
const env = confinedEnvironment(process.env, { root, tmp, shell, platform: "win32", containerProfileInTmp: true });

const loaded = await mxcSdk();
if ("reason" in loaded) {
  console.error(`no MXC SDK on this host: ${loaded.reason}`);
  process.exit(1);
}
const sdk = loaded.sdk;

const ps = (s) => s.replace(/'/g, "''");
// git's stderr folded in, and its own exit code printed: PowerShell's exit code alone hides why.
const git = (args) => `$o = (git ${args} 2>&1 | Out-String); $o; 'git-exit=' + $LASTEXITCODE`;
const probes = [
  { name: "node", script: "node -e \"console.log(process.version)\"" },
  { name: "npm", script: "npm.cmd --version" },
  { name: "npm (preserve-symlinks-main)", script: "$env:NODE_OPTIONS='--preserve-symlinks-main --preserve-symlinks'; npm.cmd --version" },
  { name: "npm (main only)", script: "$env:NODE_OPTIONS='--preserve-symlinks-main'; npm.cmd --version" },
  { name: "node <file> (main only)", script: `$env:NODE_OPTIONS='--preserve-symlinks-main'; node '${ps(path.join(root, ".mxc-whitelist-probe-hello.cjs"))}'` },
  { name: "node <file>", script: `node '${ps(path.join(root, ".mxc-whitelist-probe-hello.cjs"))}'` },
  { name: "python", script: "python --version" },
  { name: "rtk --version", script: "rtk --version" },
  { name: "rtk git status", script: "$o = (rtk git status 2>&1 | Out-String); $o; 'rtk-exit=' + $LASTEXITCODE" },
  { name: "git --version", script: "git --version" },
  { name: "git status", script: git("status --short --branch") },
  { name: "git rev-parse", script: git("rev-parse --show-toplevel") },
  { name: "git log -1", script: git("log -1 --format=%h") },
  { name: "git diff --stat", script: git("diff --shortstat HEAD~1") },
  {
    name: "git status (ceiling+GIT_DIR)",
    script: `$env:GIT_CEILING_DIRECTORIES='${ps(parent)}'; $env:GIT_DIR='${ps(path.join(root, ".git"))}'; $env:GIT_WORK_TREE='${ps(root)}'; ${git("status --short --branch")}`,
  },
  { name: "leak: marker beside tmp", script: `Get-Content -LiteralPath '${ps(marker)}' -ErrorAction Stop`, mustFail: true },
  ...(siblingPath ? [{ name: "leak: list root's sibling", script: `Get-ChildItem -LiteralPath '${ps(siblingPath)}' -Force -ErrorAction Stop | Select-Object -First 3 | ForEach-Object Name`, mustFail: true }] : []),
];

const isDriveRoot = (p) => /^[a-z]:\\?$/i.test(p);
const variants = {
  real: (w) => w,
  "no-drive": (w) => ({ ...w, filesystem: { ...w.filesystem, readonlyPaths: w.filesystem.readonlyPaths.filter((p) => !isDriveRoot(p)) } }),
  whitelist: (w) => ({ ...w, filesystem: { ...w.filesystem, readonlyPaths: w.filesystem.readonlyPaths.filter((p) => !isDriveRoot(p)), deniedPaths: [] } }),
  // The drive root only enumerable, not readable: what Node's realpath (lstat of every component) needs?
  "whitelist+enum-drive": (w) => ({
    ...w,
    filesystem: { ...w.filesystem, readonlyPaths: w.filesystem.readonlyPaths.filter((p) => !isDriveRoot(p)), deniedPaths: [] },
    processContainer: { ...w.processContainer, filesystem: { enumeratePaths: [...new Set([...w.filesystem.readonlyPaths.filter(isDriveRoot), ...(w.processContainer?.filesystem?.enumeratePaths ?? [])])] } },
  }),
  "whitelist-noenum": (w) => ({
    ...w,
    filesystem: { ...w.filesystem, readonlyPaths: w.filesystem.readonlyPaths.filter((p) => !isDriveRoot(p)), deniedPaths: [] },
    ...(w.processContainer ? { processContainer: { ...w.processContainer, filesystem: { enumeratePaths: [] } } } : {}),
  }),
};

async function runProbe(wire) {
  let out = "";
  try {
    const { exitCode } = await runThroughSdk(sdk, sdkRequest(wire), { onData: (d) => (out += d.toString("utf8")), timeoutMs: 60_000, timeout: 60 });
    return { exitCode, out: out.trim() };
  } catch (error) {
    if (isSecurityEnvironmentRefusal(error)) return { refused: error.message.split("\n")[0] };
    return { error: error.message.split("\n")[0], out: out.trim() };
  }
}

const oneLine = (s) => s.replace(/\s+/g, " ").slice(0, 400);
console.log(`root=${root}`);
const results = {};
for (const [variant, mutate] of Object.entries(variants)) {
  const sample = mutate(confine.policy({ tmp, shell, shellArgs: [], cwd: root, env }, 0));
  console.log(`\n== ${variant}: ${sample.filesystem.readwritePaths.length} rw, ${sample.filesystem.readonlyPaths.length} ro, ${sample.filesystem.deniedPaths.length} denied, ${(sample.processContainer?.filesystem?.enumeratePaths ?? []).length} enumerable`);
  results[variant] = {};
  for (const probe of probes) {
    const terminal = { tmp, shell, shellArgs: ["-NoProfile", "-NonInteractive", "-Command", probe.script], cwd: root, env };
    const r = await runProbe(mutate(confine.policy(terminal, 0)));
    let verdict;
    if (r.refused) verdict = `LAUNCH REFUSED (${oneLine(r.refused)})`;
    else if (r.error) verdict = `ERROR ${oneLine(r.error)}`;
    else if (probe.mustFail) verdict = r.exitCode === 0 && r.out ? `LEAK! read: ${oneLine(r.out)}` : "refused (good)";
    else verdict = r.exitCode === 0 ? `ok: ${oneLine(r.out)}` : `FAIL exit ${r.exitCode}: ${oneLine(r.out)}`;
    results[variant][probe.name] = verdict;
    console.log(`  ${probe.name.padEnd(30)} ${verdict}`);
  }
}

rmSync(hello, { force: true });
// rtk writes its history beside the working directory when its own data folder is out of reach.
if (!rtkDirBefore) rmSync(path.join(root, "rtk"), { recursive: true, force: true });
rmSync(beside, { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });
