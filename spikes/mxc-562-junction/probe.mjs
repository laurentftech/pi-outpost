#!/usr/bin/env node
/**
 * E2E probe for issue #562 — does a tool behind a scoop-style `current` junction resolve on
 * PATH under a real MXC tier 1 process container?
 *
 * Run on a Windows machine after `npm ci --foreground-scripts` (CI: windows-11-arm):
 *
 *   node --import tsx/esm spikes/mxc-562-junction/probe.mjs
 *
 * It lays out `C:\pi562` the way the reporter's machine is laid out — a project root, and beside
 * it a denied sibling holding a scoop tree whose `apps\nodejs\current` is a junction to the
 * versioned folder — builds the policy with pi-outpost's own `mxcTerminalConfig`, launches
 * PowerShell through the SDK in process (as the agent's shell does), and records what command
 * lookup and execution see through the junction. Results land in
 * spikes/mxc-562-junction/results/<label>/, saved after every stage (spot runners get preempted).
 *
 * Exit 0 unless the probe completed and the junction did not resolve: a probe records, and a
 * completed-but-failing probe is a failure. On a non-Windows host it records the platform and
 * exits 0.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const label = process.env.SPIKE_LABEL ?? `${process.platform}-${process.arch}`;
const outDir = path.join(root, "spikes", "mxc-562-junction", "results", label);
mkdirSync(outDir, { recursive: true });

const findings = { label, platform: process.platform, arch: process.arch, osBuild: os.release(), node: process.version };
const lines = [];
const say = (line) => {
  lines.push(line);
  console.log(line);
};
const save = () => {
  writeFileSync(path.join(outDir, "probe.json"), JSON.stringify(findings, null, 2));
  writeFileSync(path.join(outDir, "summary.md"), `${lines.join("\n")}\n`);
};

say(`# MXC #562 junction e2e — ${label}`);
say(`- platform ${process.platform} ${process.arch}, OS build ${os.release()}, Node ${process.version}`);

if (process.platform !== "win32") {
  say("- not Windows: nothing to probe here.");
  save();
  process.exit(0);
}

const { mxcTerminalConfig, siblingsToDeny, confinedEnvironment, checkRunner, enumerateLevelFlags } = await import(
  pathToFileURL(path.join(root, "server", "src", "terminalSandbox.ts")).href
);
const { mxcSdk, sdkRequest, runThroughSdk, isSecurityEnvironmentRefusal } = await import(
  pathToFileURL(path.join(root, "server", "src", "mxcSdk.ts")).href
);

// The SDK's own probe and pi-outpost's gate, as the spike recorded them.
try {
  const sdk = await import("@microsoft/mxc-sdk/v1");
  findings.sdkProbe = await sdk.probe();
  say(`- SDK probe: ${JSON.stringify(findings.sdkProbe)}`);
} catch (error) {
  say(`- SDK probe failed: ${String(error).split("\n")[0]}`);
}
const check = await checkRunner("mxc").catch((error) => ({ ok: false, reason: String(error) }));
findings.checkRunner = check;
say(`- checkRunner("mxc"): ${check.ok ? "ok" : `refused — ${check.reason}`}`);
save();
if (!check.ok) {
  // A host without MXC tier 1 (the Server control runner carries no PSEC) has nothing to
  // measure: not a failure.
  say("- E2E-SKIP: no MXC process container on this host; nothing to measure.");
  save();
  process.exit(0);
}

// The layout: a project root, and beside it a denied sibling with a scoop tree whose
// apps\nodejs\current is a junction to the versioned folder.
const base = "C:\\pi562";
const projectRoot = `${base}\\proj`;
const tmp = `${base}\\tmp`;
const scoop = `${base}\\WRK\\Scoop`;
const nodejs = `${scoop}\\apps\\nodejs`;
const versioned = `${nodejs}\\v26.8.2`;
const current = `${nodejs}\\current`;
for (const dir of [projectRoot, tmp, `${scoop}\\shims`, `${versioned}\\bin`, `${scoop}\\buckets`]) mkdirSync(dir, { recursive: true });
copyFileSync(process.execPath, `${versioned}\\node.exe`);
copyFileSync(process.execPath, `${scoop}\\shims\\rg.exe`);
writeFileSync(`${scoop}\\buckets\\secret.txt`, "beside the way down\n");
writeFileSync(`${scoop}\\shims\\npm.shim`, `path = "${current}\\npm.cmd"\r\n`);
writeFileSync(`${versioned}\\npm.cmd`, "@echo off\r\n");
const mklink = spawnSync("cmd", ["/c", "mklink", "/J", "current", "v26.8.2"], { cwd: nodejs, encoding: "utf8" });
findings.layout = {
  mklink: (mklink.stdout ?? "") + (mklink.stderr ?? ""),
  currentIsLink: lstatSync(current).isSymbolicLink(),
  currentRealpath: realpathSync(current),
};
say(`- layout: junction current -> ${findings.layout.currentRealpath} (isLink ${findings.layout.currentIsLink})`);
save();
if (findings.layout.currentRealpath.replace(/[\\/]+$/, "").toLowerCase() === current.toLowerCase()) {
  say(`- E2E-FAIL: the junction was not created (mklink: ${findings.layout.mklink.trim()}); current is a plain folder, nothing to probe.`);
  save();
  process.exit(1);
}

// The confined shell's environment, then a PATH that points into the scoop tree.
const shell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const env = confinedEnvironment(process.env, { root: projectRoot, tmp, shell, platform: "win32", containerProfileInTmp: true });
const searchPath = ["C:\\Windows\\System32", "C:\\Windows", `${scoop}\\shims`, current, `${current}\\bin`].join(";");
env.PATH = searchPath;

// The probe script the confined PowerShell runs: command lookup and execution through the junction.
// (Paths are interpolated here, in JS — inside the ps1's single quotes they would stay literal.)
const probePs1 = `${projectRoot}\\probe.ps1`;
writeFileSync(path.join(projectRoot, "realpath.js"), 'console.log(require("fs").realpathSync(process.execPath))\n');
writeFileSync(
  probePs1,
  [
    '$ErrorActionPreference = "Continue"',
    '"PSVERSION $($PSVersionTable.PSVersion)"',
    '$n = Get-Command node -ErrorAction SilentlyContinue',
    'if ($n) { "NODE-SOURCE $($n.Source)" } else { "NODE-SOURCE MISS" }',
    '$r = Get-Command rg -ErrorAction SilentlyContinue',
    'if ($r) { "RG-SOURCE $($r.Source)" } else { "RG-SOURCE MISS" }',
    'if ($n) {',
    '  "NODE-RUN $(& $n.Source -v 2>&1 | Out-String)"',
    '  "REALPATH $(& $n.Source realpath.js 2>&1 | Out-String)"',
    `  "TARGET-STAT $(Test-Path '${versioned}\\node.exe')"`,
    `  "CURRENT-STAT $(Test-Path '${current}\\node.exe')"`,
    '}',
    `try { Get-ChildItem '${scoop}\\buckets' -ErrorAction Stop | Out-Null; 'BUCKETS LISTED (BAD)' } catch { 'BUCKETS REFUSED (GOOD)' }`,
    `try { (Get-ChildItem '${scoop}\\apps' -ErrorAction Stop | ForEach-Object Name) -join ', ' | ForEach-Object { "APPS-LIST $_" } } catch { "APPS ERR $($_.Exception.Message)" }`,
    "'DONE'",
    "",
  ].join("\r\n"),
);

const input = {
  root: projectRoot,
  allowWrite: true,
  tmp,
  shell,
  shellArgs: ["-NoProfile", "-NonInteractive", "-File", probePs1],
  cwd: projectRoot,
  env,
  siblings: siblingsToDeny(projectRoot),
  searchPath,
  home: process.env.USERPROFILE,
};

// Launch as the agent's shell does, stepping the enumeration down if Windows refuses the
// security environment (the 0x80070005 path of #557/#560).
const loaded = await mxcSdk();
if ("reason" in loaded) {
  say(`- SDK did not load: ${loaded.reason}`);
  save();
  process.exit(0);
}
let output = "";
let exitCode = null;
let usedLevel = -1;
let lastError = undefined;
for (let level = 0; level <= 2; level++) {
  const config = mxcTerminalConfig({ ...input, ...enumerateLevelFlags(level) });
  const enumPaths = config.processContainer?.filesystem?.enumeratePaths ?? [];
  const relevant = (p) => p.toLowerCase().startsWith(`${base}\\`);
  findings[`policy-level-${level}`] = {
    enumeratePaths: enumPaths.filter(relevant),
    readonlyPaths: (config.processContainer?.filesystem?.readonlyPaths ?? config.filesystem?.readonlyPaths ?? []).filter(relevant),
    deniedPaths: config.filesystem.deniedPaths.filter(relevant),
  };
  say(`- level ${level}: enumeratePaths=${JSON.stringify(findings[`policy-level-${level}`].enumeratePaths)} denied=${JSON.stringify(findings[`policy-level-${level}`].deniedPaths)}`);
  save();
  try {
    const result = await runThroughSdk(loaded.sdk, sdkRequest(config), {
      onData: (data) => void (output += data.toString()),
      timeoutMs: 120_000,
      timeout: 120,
    });
    exitCode = result.exitCode;
    usedLevel = level;
    break;
  } catch (error) {
    lastError = String(error);
    say(`- level ${level} launch: ${lastError.split("\n")[0]}${isSecurityEnvironmentRefusal(error) ? " (security-environment refusal, stepping down)" : ""}`);
    if (!isSecurityEnvironmentRefusal(error) || level === 2) break;
  }
}
findings.usedLevel = usedLevel;
findings.exitCode = exitCode;
findings.lastError = lastError;
findings.output = output;
say(`- confined run at level ${usedLevel}, exit ${exitCode}:`);
for (const line of output.split(/\r?\n/).filter(Boolean)) say(`    ${line}`);
save();

// The verdict: node resolved through the junction, ran, realpath followed it; the denied
// sibling's other content stayed out.
const checks = {
  nodeResolved: /NODE-SOURCE (?!MISS)/.test(output) && output.includes(`NODE-SOURCE ${current}\\node.exe`),
  rgResolved: output.includes(`RG-SOURCE ${scoop}\\shims\\rg.exe`),
  nodeRan: /NODE-RUN v\d/.test(output),
  realpathThroughJunction: output.includes(`REALPATH ${versioned}\\node.exe`),
  targetStat: output.includes("TARGET-STAT True"),
  currentStat: output.includes("CURRENT-STAT True"),
  bucketsRefused: output.includes("BUCKETS REFUSED (GOOD)"),
};
findings.checks = checks;
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
say(`- checks: ${JSON.stringify(checks)}`);
say(failed.length === 0 ? "E2E-PASS: the junction target resolves and runs under tier 1; the rest stays denied" : `E2E-FAIL: ${failed.join(", ")}`);
save();
process.exit(failed.length === 0 ? 0 : 1);
