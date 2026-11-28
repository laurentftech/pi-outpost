// MXC's pseudo-terminal through the SDK, as the confined terminal opens it: cmd.exe under the
// terminal's policy, a line typed, what comes back. Prints the raw output and the exit.
//   node --import tsx/esm scripts/probes/mxc-sdk-pty.mts
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mxcPty, mxcSdk, sdkRequest, type MxcWireRequest } from "../../server/src/mxcSdk.ts";
import { confinedEnvironment, mxcTerminalConfig } from "../../server/src/terminalSandbox.ts";

const base = await mkdtemp(path.join(tmpdir(), "mxc-pty-"));
const root = path.join(base, "app");
const tmp = path.join(base, "tmp");
await mkdir(root, { recursive: true });
await mkdir(tmp, { recursive: true });
const shell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
const env = confinedEnvironment(process.env, { root, tmp, shell });
const wire = mxcTerminalConfig({ root, allowWrite: true, tmp, shell, shellArgs: [], cwd: root, env }) as MxcWireRequest;
const loaded = await mxcSdk();
if ("reason" in loaded) throw new Error(loaded.reason);
const started = Date.now();
let output = "";
const term = await mxcPty(loaded.sdk, sdkRequest(wire), 100, 30, shell);
term.onData((data) => (output += data));
term.onExit(({ exitCode }) => console.log(`exit ${exitCode} after ${Date.now() - started} ms`));
await new Promise((resolve) => setTimeout(resolve, 3000));
term.write("echo marker-%USERNAME%\r");
await new Promise((resolve) => setTimeout(resolve, 3000));
console.log(JSON.stringify({ pid: term.pid, output: output.slice(-800) }, null, 1));
term.kill();
