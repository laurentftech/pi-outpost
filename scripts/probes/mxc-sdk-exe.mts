// The standalone executable runs MXC in process (durable-sandbox-rules, task 5.6): MXC's native
// parts placed beside it by build-exe's placeMxcNative, a project whose agent shell is "mxc", and
// the confinement verdict its canary reaches — real commands through MXC's SDK, from inside the
// executable. Also checks no wxc-exec.exe ran for the shell.
//   node --import tsx/esm scripts/probes/mxc-sdk-exe.mts <path to pi-outpost.exe>
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { placeMxcNative } from "../../server/src/buildExe.ts";

const built = path.resolve(process.argv[2] ?? "server/dist/pi-outpost.exe");
const dir = mkdtempSync(path.join(tmpdir(), "mxc-exe-"));
const exe = path.join(dir, "pi-outpost.exe");
copyFileSync(built, exe);
const placed = placeMxcNative(exe, { platform: process.platform, arch: process.arch, log: (line) => console.log(line) });
const root = path.join(dir, "project");
mkdirSync(root);
const port = await new Promise<number>((resolve) => {
  const server = net.createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = server.address() as net.AddressInfo;
    server.close(() => resolve(free));
  });
});
const config = path.join(dir, "config.json");
writeFileSync(
  config,
  JSON.stringify({ cwd: root, agentDir: path.join(dir, "agent"), server: { host: "127.0.0.1", port }, openBrowser: false, noSkills: true, sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "mxc", bashShell: path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") } }),
);
let log = "";
const child = spawn(exe, [], { env: { ...process.env, PI_OUTPOST_CONFIG: config, PI_OFFLINE: "1" }, cwd: dir });
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const deadline = Date.now() + 60_000;
for (;;) {
  const ok = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
  if (ok) break;
  if (Date.now() > deadline) throw new Error(`the executable never served: ${log}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}
const verdict = await new Promise<unknown>((resolve, reject) => {
  // The token the server generated in its agent directory: every connection presents one.
  const token = readFileSync(path.join(dir, "agent", "outpost-token"), "utf8").trim();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  const timer = setTimeout(() => reject(new Error(`no verdict: ${log}`)), 120_000);
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    const bash = message.type === "hello" ? message.confinement?.bash : message.type === "confinement" ? message.confinement?.bash : undefined;
    if (bash && bash.state !== "checking") {
      clearTimeout(timer);
      ws.close();
      resolve(bash);
    }
  });
  ws.on("error", reject);
});
child.kill();
console.log(JSON.stringify({ placed: placed.map((p) => path.relative(dir, p)), verdict, executorInLog: /wxc-exec/i.test(log) }, null, 1));
