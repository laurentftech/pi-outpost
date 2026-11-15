// MXC's denial report on macOS (durable-sandbox-rules, task 2.3): runs one confined command
// through the SDK's development contract (`1.1.0-alpha`, `seatbelt.captureDenials` in `block`
// mode — the stable `v1` API does not carry it), then prints what came back — exit code, output,
// the result's metadata, the report — and how long it took against the same command without
// capture. The macOS counterpart of mxc-capture-denials.mjs.
//
//   node scripts/probes/mxc-capture-denials-mac.mjs [runs]
//
// Layout under a fresh temp directory: app/ (readable, out/ writable), other/secret.txt beside it
// (left to the default deny) and named/secret.txt (in `deniedPaths`). The command reads and writes
// in each, then asks for a host the policy does not allow and for a Mach service it does not list.
// Writes its findings to ~/mxc-capture-denials-mac.json.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const { spawnJson } = await import("@microsoft/mxc-sdk/v1/dev");

const runs = Number(process.argv[2] ?? 3);
const base = realpathSync(mkdtempSync(join(tmpdir(), "mxc-cd-")));
const app = join(base, "app"), out = join(app, "out"), other = join(base, "other"), named = join(base, "named"), tmp = join(base, "tmp");
for (const dir of [out, other, named, tmp]) mkdirSync(dir, { recursive: true });
writeFileSync(join(other, "secret.txt"), "other-secret");
writeFileSync(join(named, "secret.txt"), "named-secret");
writeFileSync(join(app, "readme.txt"), "mine");
const script = [
  `cat ${join(app, "readme.txt")}; echo " readme=$?"`,
  `cat ${join(other, "secret.txt")}; echo "other-read=$?"`,
  `echo x > ${join(other, "w.txt")}; echo "other-write=$?"`,
  `cat ${join(named, "secret.txt")}; echo "named-read=$?"`,
  `echo x > ${join(named, "w.txt")}; echo "named-write=$?"`,
  `echo y > ${join(out, "a.txt")}; echo "out-write=$?"`,
  `ls ${homedir()}/Documents >/dev/null; echo "home-list=$?"`,
  `/usr/bin/curl -s -m 3 -o /dev/null http://example.com; echo "curl=$?"`,
  `/usr/bin/pbpaste >/dev/null; echo "pbpaste=$?"`,
].join("\n");
const commandLine = `/bin/sh -c '${script.replaceAll("'", `'\\''`)}'`;

function request(capture) {
  return {
    version: "1.1.0-alpha",
    containment: "seatbelt",
    process: { commandLine, cwd: app, env: ["PATH=/usr/bin:/bin", `HOME=${tmp}`, `TMPDIR=${tmp}`], timeout: 60000 },
    filesystem: {
      readwritePaths: [out, tmp],
      readonlyPaths: ["/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", app],
      deniedPaths: [named],
    },
    network: { egress: { default: "deny" }, ingress: { default: "deny" } },
    seatbelt: { extraMachLookups: [], ...(capture ? { captureDenials: capture } : {}) },
  };
}

const text = (stream) =>
  new Promise((resolve) => {
    if (!stream) return resolve("");
    let all = "";
    stream.setEncoding("utf8");
    stream.on("data", (data) => (all += data));
    stream.once("end", () => resolve(all));
    stream.once("error", () => resolve(all));
  });

async function run(req, label) {
  const before = new Set(readdirSync(tmpdir()));
  const t0 = Date.now();
  try {
    const proc = await spawnJson(JSON.stringify(req), { experimental: true });
    const [stdout, stderr] = [text(proc.standardOutput), text(proc.standardError)];
    const result = await proc.wait();
    const ms = Date.now() - t0;
    const metadata = proc.outputMetadata;
    const reportPath = metadata?.captureDenials?.outputPath;
    return {
      label,
      ms,
      ...result,
      stdout: await stdout,
      stderr: await stderr,
      warnings: proc.warnings,
      metadata,
      report: reportPath && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null,
      newInTmpdir: readdirSync(tmpdir()).filter((name) => !before.has(name)),
      besideReport: reportPath ? readdirSync(join(reportPath, "..")).filter((name) => /mxc|seatbelt|denial|report/i.test(name)) : [],
    };
  } catch (error) {
    return { label, ms: Date.now() - t0, error: String(error?.message ?? error), code: error?.code };
  }
}

const findings = { base, script, node: process.version, plain: [], capture: [], captureWithPath: [], retained: [] };
for (let i = 0; i < runs; i++) findings.plain.push(await run(request(undefined), `plain-${i}`));
for (let i = 0; i < runs; i++) findings.capture.push(await run(request({ mode: "block" }), `capture-${i}`));
findings.captureWithPath.push(await run(request({ mode: "block", outputPath: join(base, "chosen-report.json") }), "capture-path"));
findings.retained.push(await run(request({ mode: "block", outputPath: join(base, "kept-report.json"), retainEtl: true }), "capture-retain"));
// The noise: commands that are refused nothing they need, under a policy shaped as pi-outpost's
// (`mxcMacConfig`: the system trees, the developer tools, node's tree, the root writable, the
// network open, the trust service). What their reports hold is what a filter has to drop.
const developer = execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim();
const developerTree = developer.endsWith("/Contents/Developer") ? developer.slice(0, -"/Contents/Developer".length) : developer;
const nodeTree = join(process.execPath, "..", "..");
function benign(command) {
  return {
    version: "1.1.0-alpha",
    containment: "seatbelt",
    process: {
      commandLine: `/bin/zsh -c '${command.replaceAll("'", `'\\''`)}'`,
      cwd: out,
      env: [`PATH=${join(developer, "usr", "bin")}:${join(nodeTree, "bin")}:/usr/bin:/bin`, `HOME=${tmp}`, `TMPDIR=${tmp}`],
      timeout: 60000,
    },
    filesystem: {
      readwritePaths: [out, tmp],
      readonlyPaths: ["/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/private/var/db/xcode_select_link", "/opt/homebrew", developerTree, nodeTree, app].filter((tree) => existsSync(tree)),
      deniedPaths: [named],
    },
    network: { egress: { default: "allow" } },
    seatbelt: { extraMachLookups: ["com.apple.TrustEvaluationAgent"], captureDenials: { mode: "block" } },
  };
}
findings.benign = [];
for (const command of ["ls -la . >/dev/null", "git init -q . && git status -sb", "node -e 'console.log(1+1)'", "/usr/bin/python3 -c 'print(2)'", "curl -s -m 10 -o /dev/null -w '%{http_code}' https://example.com", "true"]) {
  const result = await run(benign(command), command);
  findings.benign.push({ command, ms: result.ms, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, error: result.error, denials: result.report?.denials?.map((d) => `${d.resourceType} ${d.accessType} ${d.resource}`) });
}
findings.baseAfter = readdirSync(base);
findings.wroteBeside = existsSync(join(other, "w.txt"));
findings.wroteNamed = existsSync(join(named, "w.txt"));
findings.wroteInside = existsSync(join(out, "a.txt"));
writeFileSync(join(homedir(), "mxc-capture-denials-mac.json"), JSON.stringify(findings, null, 2));
console.log(JSON.stringify(findings, null, 2));
