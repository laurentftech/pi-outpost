// The confinement canary under MXC on Windows, twice: through the SDK in process, and through the
// executor (`wxc-exec.exe`) as before — same policy, same shell — to tell whether a verdict is the
// SDK's or MXC's. Prints each verdict and the canary's own report line for the signal.
//   node --import tsx/esm scripts/probes/mxc-sdk-canary.mts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCanary } from "../../server/src/confinementCanary.ts";
import { mxcSdk, runThroughSdk, sdkRequest, type MxcWireRequest } from "../../server/src/mxcSdk.ts";
import { bundledMxcExecutor } from "../../server/src/mxcExecutor.ts";
import { confinedEnvironment, mxcTerminalConfig, prepareConfinedTerminal, siblingsToDeny } from "../../server/src/terminalSandbox.ts";

const shell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const base = await mkdtemp(path.join(tmpdir(), "mxc-canary-"));
const root = path.join(base, "app");
const agentDir = path.join(base, "agent");
await mkdir(root, { recursive: true });
await mkdir(agentDir, { recursive: true });
const loaded = await mxcSdk();
if ("reason" in loaded) throw new Error(loaded.reason);
const executor = bundledMxcExecutor();
if (!executor) throw new Error("no wxc-exec.exe");

for (const through of ["sdk", "executor"] as const) {
  let said = "";
  const verdict = await runCanary({
    runner: "mxc",
    agentDir,
    root,
    powerShell: true,
    proxied: false,
    exec: async (command) => {
      const oneLine = command.split(/\r?\n/).filter(Boolean).join("; ");
      const files = await prepareConfinedTerminal((tmp) => {
        const env = confinedEnvironment(process.env, { root, tmp, shell });
        return mxcTerminalConfig({ root, allowWrite: true, agentDir, tmp, shell, shellArgs: ["-NoProfile", "-NonInteractive", "-Command", oneLine], cwd: root, env, siblings: siblingsToDeny(root), searchPath: env.PATH });
      });
      try {
        if (through === "sdk") {
          await runThroughSdk(loaded.sdk, sdkRequest(files.policy as MxcWireRequest), { onData: (d) => (said += d.toString()), timeoutMs: 60_000, timeout: 60 }).catch((e: Error) => (said += e.message));
        } else {
          said = await new Promise<string>((resolve) => execFile(executor, [files.policyFile], { timeout: 60_000, windowsHide: true }, (_e, out, err) => resolve(`${out}${err}`)));
        }
        return said;
      } finally {
        await files.dispose().catch(() => {});
      }
    },
  });
  const signalLine = said.split(/\r?\n/).find((line) => line.includes("signal-process")) ?? "(no line)";
  console.log(JSON.stringify({ through, state: verdict.state, reached: (verdict as { reached?: string[] }).reached, refused: (verdict as { refused?: string[] }).refused, signalLine }, null, 1));
}
