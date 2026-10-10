// Runs labelled command lines through MXC's wxc-exec against mxc-probe.ps1's layout, with a policy
// tuned from the environment - the follow-up tool for findings mxc-probe.ps1 only flags.
//
// Run mxc-probe.ps1 once first (it installs the SDK and builds the layout), then, from the desktop
// session:
//   MXC_READ='C:\Users\me\tools;C:\' MXC_DENY='C:\Users\me' \
//     node scripts/probes/mxc-run.mjs '[["git init","$SH -c \"cd out && git init -q repo\""]]'
// $SH is busybox (~\tools\sh.exe), $GITBASH Git's bash.exe. Write paths in commands with forward
// slashes: backslashes need escaping twice (JSON, then the shell). The cwd is the layout's app\,
// readable; app\out\ is writable (MXC_APP moves app\ elsewhere, out\ must exist; MXC_APP_RW=1
// makes all of app\ writable instead). MXC_READ / MXC_DENY add ';'-separated readonly / denied roots,
// MXC_DEBUG=1 passes --debug, MXC_MAX sets how much output to keep (default 400 characters).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const work = join(homedir(), "mxc-probe");
const exe = join(work, "sdk/node_modules/@microsoft/mxc-sdk/bin", process.arch === "arm64" ? "arm64" : "x64", "wxc-exec.exe");
const app = process.env.MXC_APP ?? join(work, "layout/app");
const cfg = join(work, "run-config.json");
const sh = `"${join(homedir(), "tools/sh.exe")}"`;
const gitBash = `"C:\\Program Files\\Git\\usr\\bin\\bash.exe"`;
const list = (name) => (process.env[name] ?? "").split(";").filter(Boolean);

for (const [label, cmd] of JSON.parse(process.argv[2])) {
  const commandLine = cmd.replaceAll("$SH", sh).replaceAll("$GITBASH", gitBash);
  writeFileSync(cfg, JSON.stringify({
    version: "1.0.0", containment: "processcontainer",
    process: { commandLine, cwd: app, timeout: 30000 },
    filesystem: process.env.MXC_APP_RW
      ? { readwritePaths: [app, ...list("MXC_RW")], readonlyPaths: list("MXC_READ"), deniedPaths: list("MXC_DENY") }
      : { readwritePaths: [join(app, "out")], readonlyPaths: [app, ...list("MXC_READ")], deniedPaths: list("MXC_DENY") },
    // Without it anything loading user32.dll fails with 0xC0000142 (see mxc-probe.ps1).
    ui: { disable: false },
  }));
  let out, code = 0;
  try { out = execFileSync(exe, [...(process.env.MXC_DEBUG ? ["--debug"] : []), cfg], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { code = e.status; out = (e.stdout ?? "") + (e.stderr ?? ""); }
  console.log(`${label.padEnd(26)} exit=${code} :: ${out.replace(/\s+/g, " ").trim().slice(0, Number(process.env.MXC_MAX ?? 400)) || "(nothing)"}`);
}
