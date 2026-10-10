/**
 * Run one command under landstrip's runner, with a time limit, and report exactly what came
 * back: exit status, stdout, stderr. A small, reliable harness for "does X start inside the
 * sandbox?" — PowerShell's Start-Process lost both the exit code and the output.
 *
 *   node scripts/probes/landstrip-run.mjs <landstrip> <policy.json> <cwd> -- <program> [args…]
 */
import { spawnSync } from "node:child_process";

const [runner, policy, cwd, separator, ...command] = process.argv.slice(2);
if (separator !== "--" || command.length === 0) {
  console.error("usage: landstrip-run.mjs <landstrip> <policy.json> <cwd> -- <program> [args…]");
  process.exit(2);
}
const result = spawnSync(runner, ["run", "-p", policy, "--", ...command], { cwd, encoding: "utf8", timeout: 20_000, windowsHide: true });
const oneLine = (text) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
console.log(
  JSON.stringify({
    command: command.join(" "),
    status: result.error?.code === "ETIMEDOUT" ? "timeout" : result.status,
    signal: result.signal,
    stdout: oneLine(result.stdout),
    stderr: oneLine(result.stderr),
  }),
);
