/**
 * A diagnosis under MXC on Windows, what needs no runner: the narrower request, MXC's report read
 * and filtered, the notes, and the shell tool's option. The real executor's side is
 * `confinedDiagnosisMxc.test.ts`'s.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diagnosisNote, diagnosisOfferNote, confinedBashOperations } from "../src/confinedBash.ts";
import { withDiagnoseParameter } from "../src/sandbox.ts";
import { mxcReportFile, mxcReportRefusals } from "../src/sandboxRefusals.ts";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { mxcDiagnosticConfig, mxcTerminalConfig } from "../src/terminalSandbox.ts";

const ROOT = "C:\\Users\\me\\work\\app";
const AGENT = "C:\\Users\\me\\.pi\\agent";
const CONFIG = "C:\\Users\\me\\work\\app\\pi-outpost.json";

function request(networkProxy?: string) {
  return mxcTerminalConfig({
    root: ROOT,
    allowWrite: true,
    writableRoot: `${ROOT}\\out`,
    agentDir: AGENT,
    configFile: CONFIG,
    tmp: "C:\\Users\\me\\AppData\\Local\\Temp\\pi-outpost-bash-1",
    shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    shellArgs: ["-File", "x.ps1"],
    cwd: ROOT,
    env: {},
    searchPath: "C:\\Windows\\System32;C:\\Tools",
    home: "C:\\Users\\me",
    ...(networkProxy ? { networkProxy } : {}),
  });
}

describe("mxcDiagnosticConfig", () => {
  // openlore: scenario=ADiagnosisLetsNothingThrough spec=sandbox-durable-rules
  test("only takes away: no drive, no sibling named, the keys and the configuration still named, the network closed", () => {
    const original = request("http://127.0.0.1:4100");
    const diagnosis = mxcDiagnosticConfig(original, { root: ROOT, agentDir: AGENT, configFile: CONFIG, reportPath: "C:\\srv\\d\\report.json" });
    const subset = (a: string[], b: string[]) => a.every((p) => b.includes(p));
    assert.ok(subset(diagnosis.filesystem.readwritePaths, original.filesystem.readwritePaths), "no writable path added");
    assert.ok(subset(diagnosis.filesystem.readonlyPaths, original.filesystem.readonlyPaths), "no readable path added");
    assert.ok(!diagnosis.filesystem.readonlyPaths.includes("C:\\"), "no drive");
    assert.deepEqual(diagnosis.filesystem.deniedPaths.sort(), [AGENT, CONFIG].filter((p) => original.filesystem.deniedPaths.includes(p)).sort());
    assert.ok(diagnosis.filesystem.deniedPaths.includes(AGENT), "the agent directory stays named");
    assert.ok(diagnosis.filesystem.deniedPaths.includes(CONFIG), "the configuration inside the root stays named");
    assert.deepEqual(diagnosis.network, { egress: { default: "deny" } });
    assert.equal(diagnosis.runtimeConfig, undefined, "no proxy");
    assert.deepEqual(diagnosis.processContainer, { filesystem: original.processContainer?.filesystem, captureDenials: { mode: "block", outputPath: "C:\\srv\\d\\report.json" } }, "the enumerated way down kept, capture added");
    assert.deepEqual(diagnosis.ui, original.ui);
    assert.equal(diagnosis.process, original.process);
  });

  // openlore: scenario=ARecordedRefusalIsStillARefusal spec=sandbox-durable-rules
  test("capture is asked for in block mode, never allow", () => {
    const diagnosis = mxcDiagnosticConfig(request(), { root: ROOT, reportPath: "C:\\d\\r.json" });
    assert.equal(diagnosis.processContainer?.captureDenials?.mode, "block");
    assert.equal(request().processContainer?.captureDenials, undefined, "an ordinary command asks for no capture");
  });
});

// As `wxc-exec.exe` 1.1.0 wrote it on Windows 11 for a read of other\secret.txt beside the root (research.md).
const MEASURED = {
  denials: [
    { resource: `${ROOT}\\`, resourceType: "file", accessType: "execute", pid: 1 },
    { resource: `${ROOT}\\`, resourceType: "file", accessType: "write", pid: 1 },
    { resource: "\\REGISTRY\\USER\\S-1-5-21-1\\Console", resourceType: "other", accessType: "read", pid: 2 },
    { resource: "C:\\Program Files\\WindowsApps\\Microsoft.LanguageExperiencePackfr-FR_x\\Windows\\system32\\fr-FR\\h\\conhost.exe.mui", resourceType: "file", accessType: "write", pid: 2 },
    { resource: "Handles", resourceType: "ui", accessType: "unknown", pid: 2 },
    { resource: "C:\\", resourceType: "file", accessType: "read", pid: 1 },
    { resource: "C:\\Users\\", resourceType: "file", accessType: "read", pid: 1 },
    { resource: "C:\\Users\\me\\work\\", resourceType: "file", accessType: "read", pid: 1 },
    { resource: "C:\\Users\\me\\work\\other\\", resourceType: "file", accessType: "read", pid: 1 },
    { resource: "C:\\Users\\me\\work\\other\\w.txt", resourceType: "file", accessType: "write", pid: 1 },
    { resource: "C:\\Windows\\System32\\x.dll", resourceType: "file", accessType: "read", pid: 1 },
  ],
  summary: { exitCode: 0, totalDenials: 11, deniedResourcesTruncated: false },
};

describe("mxcReportRefusals", () => {
  // openlore: scenario=ADiagnosisNamesTheRefusedDirectory spec=sandbox-durable-rules
  test("keeps the directories beside the root, each with its access, and drops the way down, the root and the system's own", () => {
    const refusals = mxcReportRefusals(MEASURED, { root: ROOT, command: "Get-Content x", systemRoot: "C:\\Windows", programFiles: "C:\\Program Files" });
    assert.deepEqual(refusals, [
      { kind: "directory", target: "C:\\Users\\me\\work\\other", access: "read", command: "Get-Content x" },
      { kind: "directory", target: "C:\\Users\\me\\work\\other", access: "write", command: "Get-Content x" },
    ]);
  });

  test("anything that is not a report is no refusal", () => {
    for (const report of [undefined, null, 3, {}, { denials: "x" }, { denials: [{ resource: 3, resourceType: "file", accessType: "read" }] }]) {
      assert.deepEqual(mxcReportRefusals(report, { root: ROOT, command: "c" }), []);
    }
  });
});

describe("mxcReportFile", () => {
  test("the file MXC wrote for the path asked: its pid and hash before .json", () => {
    assert.equal(mxcReportFile(["other.json", "report.13060_bc521a751c1d033d8aa92931da1f1d59.json"], "C:\\d\\report.json"), "report.13060_bc521a751c1d033d8aa92931da1f1d59.json");
    assert.equal(mxcReportFile(["report.json"], "C:\\d\\report.json"), "report.json");
    assert.equal(mxcReportFile(["report.x.json", "reportx.json", "mxc_denials_1_ab.json"], "C:\\d\\report.json"), undefined);
  });
});

describe("the notes", () => {
  test("a diagnosis names each refused directory and its access, then says the output is not shown", () => {
    const note = diagnosisNote([
      { kind: "directory", target: "C:\\a", access: "read", command: "c" },
      { kind: "directory", target: "C:\\b", access: "write", command: "c" },
      { kind: "info", target: "x", detail: "y", command: "c" },
    ]);
    assert.equal(note.split("\n").length, 3);
    assert.match(note, /refused reading C:\\a\./);
    assert.match(note, /refused writing to C:\\b\./);
    assert.match(note, /run_with_grant/);
  });

  // openlore: scenario=ADiagnosisThatFindsNothingSaysSo spec=sandbox-durable-rules
  test("a diagnosis that found nothing says so and names nothing", () => {
    assert.match(diagnosisNote([]), /reported no refused directory/);
    assert.doesNotMatch(diagnosisNote([]), /C:\\/);
  });

  test("the offer names the option, and that the command runs again", () => {
    assert.match(diagnosisOfferNote(), /diagnose: true/);
    assert.match(diagnosisOfferNote(), /effects happen again/);
  });

  // openlore: scenario=AProgramsFolderIsAskedFor spec=sandbox-runner-bash
  test("the offer says a program refused at start is its folder, to ask for read only", () => {
    assert.match(diagnosisOfferNote(), /"Access denied" starting a program .* is such a path: the program's folder is refused — the diagnosis names it, and run_with_grant can ask the user for it, read only\.$/);
  });
});

describe("where a diagnosis is offered", () => {
  const base = { root: ROOT, allowWrite: true, shell: "powershell.exe" };
  test("MXC on Windows only: not landstrip, not MXC elsewhere, not WSLC", () => {
    assert.equal(typeof confinedBashOperations({ ...base, runner: "C:\\mxc\\wxc-exec.exe", platform: "win32" }).diagnose, "function");
    assert.equal(confinedBashOperations({ ...base, runner: "C:\\mxc\\wxc-exec.exe", platform: "win32", image: "ubuntu" }).diagnose, undefined);
    assert.equal(confinedBashOperations({ ...base, runner: "C:\\l\\landstrip.exe", platform: "win32" }).diagnose, undefined);
    assert.equal(confinedBashOperations({ ...base, runner: "/opt/mxc/lxc-exec", platform: "linux" }).diagnose, undefined);
  });

  test("the shell tool's parameters gain an optional diagnose, and keep their own", () => {
    const parameters = withDiagnoseParameter({ type: "object", properties: { command: { type: "string" }, timeout: { type: "number" } }, required: ["command"] } as never) as unknown as {
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };
    assert.deepEqual(Object.keys(parameters.properties), ["command", "timeout", "diagnose"]);
    assert.equal(parameters.properties.diagnose.type, "boolean");
    assert.match(parameters.properties.diagnose.description ?? "", /must not run twice/);
    assert.deepEqual(parameters.required, ["command"]);

    const real = withDiagnoseParameter(createBashToolDefinition(".").parameters) as unknown as { properties: Record<string, unknown>; required: string[] };
    assert.deepEqual(Object.keys(real.properties), ["command", "timeout", "diagnose"], "pi's own bash schema");
    assert.deepEqual(real.required, ["command"]);
  });
});

