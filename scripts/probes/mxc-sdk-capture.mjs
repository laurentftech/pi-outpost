// MXC's denial capture through the SDK's in-process API (durable-sandbox-rules): the same layout as
// mxc-capture-denials.mjs, run through `run` from @microsoft/mxc-sdk/v1. Prints the exit, what
// outputMetadata carries, the report it names, and the time taken.
//   node scripts/probes/mxc-sdk-capture.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@microsoft/mxc-sdk/v1";

const base = mkdtempSync(join(tmpdir(), "mxc-sdk-cd-"));
const app = join(base, "app"), out = join(app, "out"), other = join(base, "other"), reports = join(base, "reports");
for (const d of [out, other, reports]) mkdirSync(d, { recursive: true });
writeFileSync(join(other, "secret.txt"), "other-secret");
const t0 = Date.now();
const res = await run({
  command: `cmd.exe /d /c "type "${join(other, "secret.txt")}" & echo x> "${join(other, "w.txt")}""`,
  workingDirectory: app,
  filesystem: { readwritePaths: [out], readonlyPaths: [app] },
  network: { egress: { default: "deny" } },
  ui: { disable: false, clipboard: "none", allowInputInjection: false },
  containment: { type: "processcontainer", config: { captureDenials: { mode: "block", outputPath: join(reports, "report.json") } } },
});
const { stdout, stderr, exitCode, timedOut } = res; const result = { exitCode, timedOut }; const metadata = res.outputMetadata;
const path = metadata?.captureDenials?.outputPath;
console.log(JSON.stringify({ ms: Date.now() - t0, result, stdout, stderr, metadata, warnings: res.warnings, report: path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null, wroteOutside: existsSync(join(other, "w.txt")) }, null, 2));
