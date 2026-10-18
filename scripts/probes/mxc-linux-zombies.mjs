// Run as the container's main process (node, PID 1 unless docker run --init): start an interactive
// bash through lxc-exec, SIGHUP the executor as a closed terminal does, and count zombies left.
// Shows whether the deployment needs an init to reap the bwrap processes lxc-exec orphans.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const root = mkdtempSync("/tmp/z-") + "/app";
mkdirSync(root);
writeFileSync("/tmp/zreq.json", JSON.stringify({ version: "1.0.0", containment: "bubblewrap",
  process: { commandLine: "/bin/bash --norc -i", cwd: root, env: ["PATH=/usr/bin:/bin"] },
  filesystem: { readwritePaths: [root], readonlyPaths: ["/usr", "/etc", "/lib", "/lib64", "/bin"] },
  network: { egress: { default: "allow" } } }));
const states = () => readdirSync("/proc").filter((p) => /^\d+$/.test(p)).map((p) => { try { const s = readFileSync(`/proc/${p}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2, s.lastIndexOf(")") + 3) + ":" + s.slice(s.indexOf("(") + 1, s.lastIndexOf(")")); } catch { return ""; } });
const child = spawn(`/app/node_modules/@microsoft/mxc-sdk/bin/${arch}/lxc-exec`, ["/tmp/zreq.json"], { stdio: ["pipe", "ignore", "ignore"] });
setTimeout(() => { console.log("pid1:", readFileSync("/proc/1/comm", "utf8").trim(), "running:", states().filter((s) => s.startsWith("S")).join(" ")); child.kill("SIGHUP"); }, 1500);
setTimeout(() => { console.log("zombies after close:", states().filter((s) => s.startsWith("Z")).join(" ") || "none"); process.exit(0); }, 4000);
