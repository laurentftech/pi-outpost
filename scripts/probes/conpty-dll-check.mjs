#!/usr/bin/env node
/**
 * Probe: can this Windows machine run node-pty's bundled ConPTY (`useConptyDll: true`)?
 *
 * That mode runs conpty.dll and OpenConsole.exe from node-pty's own folder instead of
 * Windows' console. It removes the console-list helper that crashes with "AttachConsole
 * failed" (microsoft/node-pty#1007), but a locked-down machine (AppLocker, antivirus)
 * may refuse to run an .exe from the npm folder. This opens PowerShell both ways, types
 * a command, reads it back and closes it, and says which way works.
 *
 * Usage (Windows, PowerShell):
 *   node conpty-dll-check.mjs
 *   node conpty-dll-check.mjs "C:\path\to\node_modules\node-pty"   # if not found by itself
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("Windows only.");
  process.exit(0);
}

function findNodePty() {
  if (process.argv[2]) return process.argv[2];
  const candidates = [];
  try {
    // npm is npm.cmd on Windows: run it through the shell.
    const globalRoot = execFileSync("npm root -g", { encoding: "utf8", shell: true }).trim();
    candidates.push(path.join(globalRoot, "pi-outpost", "node_modules", "node-pty"), path.join(globalRoot, "node-pty"));
  } catch {
    // npm not on PATH: rely on the argument or the current folder.
  }
  candidates.push(path.join(process.cwd(), "node_modules", "node-pty"));
  return candidates.find((candidate) => existsSync(path.join(candidate, "package.json")));
}

const ptyDir = findNodePty();
if (!ptyDir) {
  console.log('node-pty not found. Pass its folder: node conpty-dll-check.mjs "C:\\...\\node_modules\\node-pty"');
  process.exit(1);
}
const require = createRequire(path.join(ptyDir, "package.json"));
const pty = require(ptyDir);
console.log(`node-pty ${require(path.join(ptyDir, "package.json")).version} from ${ptyDir}`);
const bundled = path.join(ptyDir, "prebuilds", `win32-${process.arch}`, "conpty");
console.log(`bundled ConPTY: ${bundled} (${existsSync(path.join(bundled, "OpenConsole.exe")) ? "present" : "MISSING"})\n`);

function attempt(label, useConptyDll) {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      console.log(`${ok ? "OK    " : "FAILED"} ${label}${detail ? ` — ${detail}` : ""}`);
      resolve(ok);
    };
    let term;
    try {
      term = pty.spawn("powershell.exe", ["-NoLogo", "-NoProfile"], { name: "xterm-256color", cols: 100, rows: 30, cwd: process.cwd(), env: process.env, useConptyDll });
    } catch (error) {
      finish(false, `spawn threw: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    term.onData((data) => {
      output += data;
      if (output.includes("PROBE-ANSWER-42")) {
        term.kill();
        finish(true, "PowerShell answered, terminal closed");
      }
    });
    term.onExit(({ exitCode }) => finish(output.includes("PROBE-ANSWER-42"), `shell exited (code ${exitCode}) before answering`));
    setTimeout(() => term.write("Write-Output ('PROBE-ANSWER-' + (40 + 2))\r"), 1500);
    setTimeout(() => {
      try { term.kill(); } catch {}
      finish(false, `no answer in 15 s; output so far: ${JSON.stringify(output.slice(-300))}`);
    }, 15_000);
  });
}

const windowsConsole = await attempt("Windows console (today's behaviour)", false);
const bundledConsole = await attempt("bundled ConPTY (useConptyDll: true)", true);
console.log(`\nResult: windows=${windowsConsole ? "ok" : "failed"} bundled=${bundledConsole ? "ok" : "failed"}`);
// Give node-pty's helpers a moment to print anything they still have to say.
setTimeout(() => process.exit(0), 2000);
