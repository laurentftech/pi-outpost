#!/usr/bin/env node
/**
 * Spike — can a CI Windows runner exercise MXC's real process container (tier 1)?
 *
 * Run on a Windows machine (CI runner or developer's) after `npm ci`:
 *
 *   node --import tsx/esm spikes/mxc-windows-ci/probe.mjs
 *
 * It records, into spikes/mxc-windows-ci/results/<SPIKE_LABEL or platform-arch>/:
 *   1. the host: platform, arch, OS build, Node;
 *   2. the SDK's native parts for this arch, and its `probe()` (tier, deny/enumerate support);
 *   3. pi-outpost's own `checkRunner("mxc")` — the gate every command waits at;
 *   4. where that gate passes, the real-MXC server suites, with `MXC_EXEC` at the SDK's
 *      bundled `wxc-exec.exe` — the same suites that skip in CI for want of `MXC_EXEC`.
 *
 * Exit 0 unless the suites ran and failed: a spike records, it does not gate. On a non-Windows
 * host it records the platform and exits 0.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const label = process.env.SPIKE_LABEL ?? `${process.platform}-${process.arch}`;
const outDir = path.join(root, "spikes", "mxc-windows-ci", "results", label);
mkdirSync(outDir, { recursive: true });

const findings = { label, platform: process.platform, arch: process.arch, osBuild: os.release(), node: process.version };
const lines = [];
const say = (line) => {
  lines.push(line);
  console.log(line);
};
// ARM runners are spot instances and get preempted mid-run: persist after every stage, and
// append each suite's log as it finishes, so a preemption still leaves what was measured.
const save = () => {
  writeFileSync(path.join(outDir, "probe.json"), JSON.stringify(findings, null, 2));
  writeFileSync(path.join(outDir, "summary.md"), `${lines.join("\n")}\n`);
};

say(`# MXC-on-Windows-CI probe — ${label}`);
say(`- platform ${process.platform} ${process.arch}, OS build ${os.release()}, Node ${process.version}`);

// The SDK and its native parts for this architecture.
const require = createRequire(import.meta.url);
let sdkDir;
try {
  sdkDir = path.dirname(require.resolve("@microsoft/mxc-sdk/package.json"));
} catch {
  say("- `@microsoft/mxc-sdk` is not installed (run `npm ci` first): no probe.");
  finish(0);
}
const archDir = path.join(sdkDir, "bin", process.arch === "arm64" ? "arm64" : "x64");
const wxcExec = path.join(archDir, "wxc-exec.exe");
const ffi = path.join(archDir, "mxc_ffi.dll");
findings.sdk = { manifest: sdkDir, wxcExec: existsSync(wxcExec), mxcFfiDll: existsSync(ffi) };
say(`- SDK at ${sdkDir}; wxc-exec.exe ${existsSync(wxcExec) ? "present" : "MISSING"}, mxc_ffi.dll ${existsSync(ffi) ? "present" : "MISSING"}`);

if (process.platform !== "win32") {
  say("- not Windows: the in-process probe and the real suites are Windows-only; nothing more to record.");
  finish(0);
}

// The SDK's own probe: which tier this build picks, and what the base container supports.
try {
  const sdk = await import("@microsoft/mxc-sdk/v1");
  const probe = await sdk.probe();
  findings.sdkProbe = probe;
  say(`- SDK probe: ${JSON.stringify(probe)}`);
} catch (error) {
  findings.sdkProbeError = String(error);
  say(`- SDK probe failed: ${String(error).split("\n")[0]}`);
}
save();

// pi-outpost's gate: what `checkRunner("mxc")` answers on this host.
let check;
try {
  const { checkRunner } = await import(pathToFileURL(path.join(root, "server", "src", "terminalSandbox.ts")).href);
  check = await checkRunner("mxc");
  findings.checkRunner = check;
  say(`- checkRunner("mxc"): ${check.ok ? "ok" : `refused — ${check.reason}`}`);
} catch (error) {
  findings.checkRunnerError = String(error);
  say(`- checkRunner threw: ${String(error).split("\n")[0]}`);
  finish(0);
}
save();

// Where the gate passes, the real-MXC suites, exactly as a developer runs them (MXC_EXEC set).
// One process per suite, log appended after each: a preempted spot runner keeps what finished.
if (check.ok) {
  const suites = [
    "windowsSandboxReachMxc",
    "terminalSandboxMxc",
    "confinedDiagnosisMxc",
    "confinedPowerShellMxc",
    "confinedLoopbackMxc",
    "confinedNetworkMxc",
    "windowsToolchainsMxc",
    // Needs MXC_SHELL (busybox-w32's sh.exe) beside MXC_EXEC; runs only when both are set.
    ...(process.env.MXC_SHELL ? ["confinedBashMxc"] : []),
  ];
  say(`- running the real-MXC suites with MXC_EXEC=${wxcExec}: ${suites.join(", ")}`);
  findings.suites = { perFile: {}, tests: 0, pass: 0, fail: 0, skipped: 0 };
  const log = path.join(outDir, "suites.log");
  for (const name of suites) {
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx/esm", "--test", "--test-timeout=300000", path.join("test", `${name}.test.ts`)],
      { cwd: path.join(root, "server"), env: { ...process.env, MXC_EXEC: wxcExec }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    appendFileSync(log, `\n===== ${name} (exit ${run.status}) =====\n${output}\n`);
    const count = (key) => Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(output)?.[1] ?? 0);
    const entry = { tests: count("tests"), pass: count("pass"), fail: count("fail"), skipped: count("skipped"), exitCode: run.status };
    findings.suites.perFile[name] = entry;
    findings.suites.tests += entry.tests;
    findings.suites.pass += entry.pass;
    findings.suites.fail += entry.fail;
    findings.suites.skipped += entry.skipped;
    say(`- ${name}: ${entry.pass} pass, ${entry.fail} fail, ${entry.skipped} skipped (exit ${run.status})`);
    save();
  }
  say(`- suites total: ${findings.suites.pass} pass, ${findings.suites.fail} fail, ${findings.suites.skipped} skipped; full log in results/${label}/suites.log`);
  finish(findings.suites.fail > 0 ? 1 : 0);
} else {
  say("- checkRunner refused: the real suites would assert on the gate and fail rather than skip; not run.");
  finish(0);
}

function finish(code) {
  save();
  process.exit(code);
}
