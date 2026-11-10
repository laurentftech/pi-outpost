// Where does a confined terminal's shell live under landstrip, and can the server read its cwd?
// Prints the process tree under the pty and readlink(/proc/<pid>/cwd) for each, after `cd out`.
// Run inside Linux with LANDSTRIP_BIN set: node --import tsx scripts/probes/landstrip-cwd/probe.mts
import { mkdir, mkdtemp, readFile, readlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";
import { TerminalManager } from "../../../server/src/terminalManager.ts";
import { terminalPolicy } from "../../../server/src/terminalSandbox.ts";

const base = await mkdtemp(path.join(tmpdir(), "cwd-probe-"));
const root = path.join(base, "app");
const out = path.join(root, "out");
await mkdir(out, { recursive: true });
const manager = new TerminalManager();
const socket = {} as WebSocket;
const session = await manager.open(socket, "t", root, 80, 24, () => {}, () => {},
  { shell: "/bin/bash", shellArgs: ["--norc", "--noprofile", "-i"] },
  { runner: process.env.LANDSTRIP_BIN!, root, policy: ({ tmp }) => terminalPolicy({ root, writableRoot: out, allowWrite: true, agentDir: path.join(base, "agent"), tmp, searchPath: process.env.PATH }) });
await new Promise((r) => setTimeout(r, 1500));
manager.write(socket, "t", `cd ${out}\r`);
await new Promise((r) => setTimeout(r, 1000));
async function describe(pid: number, depth = 0): Promise<void> {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch((e) => `?? ${e.code}`);
  const name = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
  const cwd = await readlink(`/proc/${pid}/cwd`).catch((e) => `<${e.code}>`);
  const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
  const ns = await readlink(`/proc/${pid}/ns/pid`).catch((e) => `<${e.code}>`);
  console.log(`${"  ".repeat(depth)}${pid} ${name} cwd=${cwd} pidns=${ns} ${/^NSpid:.*$/m.exec(status)?.[0] ?? ""}`);
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const s = await readFile(`/proc/${entry}/stat`, "utf8").catch(() => "");
    if (Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]) === pid) await describe(Number(entry), depth + 1);
  }
}
console.log(`server pidns=${await readlink("/proc/self/ns/pid")}`);
await describe(session.ptyProcess.pid);
console.log("getCwd ->", await manager.getCwd(socket, "t"), "expected", out);
manager.closeAll();
process.exit(0);
