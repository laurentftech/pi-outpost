/**
 * pi-outpost's confined terminal on Windows, end to end: TerminalManager + the real landstrip
 * runner + the default shell (PowerShell once confined), driven through a real pty.
 *
 * Run in the interactive session (over SSH the container gets no window station):
 *   powershell -File scripts\probes\run-interactive.ps1 -Dir <repo> -Command "node --import tsx/esm scripts\probes\confined-terminal-windows.mts <landstrip.exe>"
 * Writes its findings to ~/confined-terminal-windows.json.
 */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TerminalManager } from "../../server/src/terminalManager.ts";
import { checkRunner, terminalPolicy } from "../../server/src/terminalSandbox.ts";

const runner = process.argv[2];
const report: Record<string, unknown> = { check: await checkRunner(runner) };
const base = await mkdtemp(path.join(os.homedir(), "ctw-"));
const root = path.join(base, "app"), out = path.join(root, "out"), agentDir = path.join(base, "agent");
await mkdir(out, { recursive: true });
await mkdir(path.join(base, "other"));
await mkdir(agentDir);
await writeFile(path.join(base, "other", "secret.txt"), "other-secret");
await writeFile(path.join(agentDir, "auth.json"), "sk-agent");
await writeFile(path.join(root, "readme.txt"), "mine");

const manager = new TerminalManager();
const socket = {} as never;
let output = "";
const session = await manager.open(
  socket, "t", root, 160, 40,
  (_id, data) => { output += data; },
  (_id, code) => { output += `\n[exit ${code}]\n`; },
  {},
  { runner, root, policy: (tmp) => terminalPolicy({ root, writableRoot: out, allowWrite: true, agentDir, tmp, searchPath: process.env.PATH, systemRoot: process.env.SystemRoot, userProfile: process.env.USERPROFILE }) },
);
report.shell = session.ptyProcess.process;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const t0 = Date.now();
while (Date.now() - t0 < 30_000 && !/PS .*>\s*$/.test(output)) await wait(250);
report.promptAfterMs = Date.now() - t0;

const commands = [
  `Get-Content "${path.join(root, "readme.txt")}"`,
  `Get-Content "${path.join(base, "other", "secret.txt")}"`,
  `Get-Content "${path.join(agentDir, "auth.json")}"`,
  `Set-Content "${path.join(out, "a.txt")}" inside`,
  `Set-Content "${path.join(root, "b.txt")}" outside`,
  `"key-var: [$env:OPENAI_API_KEY]"`,
  `git --version`,
  `"home: $HOME"`,
];
for (const command of commands) {
  manager.write(socket, "t", command + "\r");
  await wait(2500);
}
const clean = output.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
report.transcript = clean.split("\n").filter((line) => line.trim()).slice(-40);
report.aTxt = await readFile(path.join(out, "a.txt"), "utf8").catch(() => null);
report.bTxt = await readFile(path.join(root, "b.txt"), "utf8").catch(() => null);
manager.closeAllForSocket(socket);
writeFileSync(path.join(os.homedir(), "confined-terminal-windows.json"), JSON.stringify(report, null, 1));
setTimeout(() => process.exit(0), 300);
