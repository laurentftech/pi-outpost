// MXC's denial report on Windows (durable-sandbox-rules, task 1.1/1.2): runs one confined
// command through the installed wxc-exec.exe with `processContainer.captureDenials` in `block`
// mode, then prints what came back — exit code, stderr lines, the report — and how long it took
// against the same command without capture.
//
//   node scripts/probes/mxc-capture-denials.mjs [runs]      (MXC_DEFAULT_DENY=1: other\ not in deniedPaths)
//
// Layout under a fresh temp directory: app\ (readable, out\ writable), other\secret.txt beside it.
// Writes its findings to ~/mxc-capture-denials.json.
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const runs = Number(process.argv[2] ?? 3);
const sdk = join(createRequire(import.meta.url).resolve("@microsoft/mxc-sdk/package.json"), "..");
const exe = join(sdk, "bin", process.arch === "arm64" ? "arm64" : "x64", "wxc-exec.exe");
const base = mkdtempSync(join(tmpdir(), "mxc-cd-"));
const app = join(base, "app"), out = join(app, "out"), other = join(base, "other");
mkdirSync(out, { recursive: true });
mkdirSync(other);
writeFileSync(join(other, "secret.txt"), "other-secret");
writeFileSync(join(app, "readme.txt"), "mine");
const secret = join(other, "secret.txt");
const commandLine = `cmd.exe /d /c "type "${join(app, "readme.txt")}" & type "${secret}" & echo x> "${join(other, "w.txt")}" & echo y> "${join(out, "a.txt")}""`;

function request(capture, reportPath) {
  return {
    version: "1.0.0",
    containment: "processcontainer",
    process: { commandLine, cwd: app, timeout: 60000 },
    // MXC_DEFAULT_DENY=1: leave other\ to the default deny instead of naming it in deniedPaths.
    filesystem: { readwritePaths: [out], readonlyPaths: [app, "C:\\Windows"], deniedPaths: process.env.MXC_DEFAULT_DENY ? [] : [other] },
    ui: { disable: false, clipboard: "none", injection: false },
    ...(capture ? { processContainer: { captureDenials: { mode: "block", ...(reportPath ? { outputPath: reportPath } : {}) } } } : {}),
  };
}

function run(req, label) {
  const cfg = join(base, `${label}.json`);
  writeFileSync(cfg, JSON.stringify(req));
  const t0 = Date.now();
  return new Promise((resolve) => {
    execFile(exe, [cfg], { encoding: "utf8", timeout: 120000 }, (error, stdout, stderr) => {
      resolve({ label, ms: Date.now() - t0, exitCode: error ? error.code ?? null : 0, stdout, stderr });
    });
  });
}

const report = { exe, base, commandLine, plain: [], capture: [], captureWithPath: [] };
for (let i = 0; i < runs; i++) report.plain.push(await run(request(false), `plain-${i}`));
for (let i = 0; i < runs; i++) {
  const r = await run(request(true), `capture-${i}`);
  const announced = r.stderr.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return undefined; } }).filter((x) => x && x.type);
  r.announced = announced;
  for (const a of announced) if (a.outputPath && existsSync(a.outputPath)) r.report = JSON.parse(readFileSync(a.outputPath, "utf8"));
  report.capture.push(r);
}
const chosen = join(base, "chosen-report.json");
const r = await run(request(true, chosen), "capture-path");
r.reportAtChosenPath = existsSync(chosen) ? JSON.parse(readFileSync(chosen, "utf8")) : null;
report.captureWithPath.push(r);
report.wroteOutside = existsSync(join(other, "w.txt"));
report.wroteInside = existsSync(join(out, "a.txt"));
writeFileSync(join(homedir(), "mxc-capture-denials.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
