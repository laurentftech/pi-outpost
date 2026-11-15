// Inside a Node SEA: MXC's SDK, bundled, with koffi and mxc_ffi.dll loaded from beside the exe.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.MXC_FFI_DIR ??= path.dirname(process.execPath);
const { run } = await import("@microsoft/mxc-sdk/v1");
const base = mkdtempSync(path.join(tmpdir(), "mxc-sea-"));
const app = path.join(base, "app"), other = path.join(base, "other"), reports = path.join(base, "reports");
for (const d of [app, other, reports]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(other, "secret.txt"), "other-secret");
const res = await run({
  command: `cmd.exe /d /c type "${path.join(other, "secret.txt")}"`,
  workingDirectory: app,
  filesystem: { readonlyPaths: [app], readwritePaths: [] },
  network: { egress: { default: "deny" } },
  ui: { disable: false, clipboard: "none", allowInputInjection: false },
  containment: { type: "processcontainer", config: { captureDenials: { mode: "block", outputPath: path.join(reports, "report.json") } } },
});
const report = res.outputMetadata?.captureDenials?.outputPath;
console.log(JSON.stringify({ sea: (await import("node:sea")).isSea(), exitCode: res.exitCode, stderr: res.stderr, secretShown: /other-secret/.test(res.stdout), report: report && existsSync(report) ? JSON.parse(readFileSync(report, "utf8")).summary : null }));
