/**
 * The project's extensions run only once allowed (`project-extension-approval`): the gate, against
 * pi's real loader. Each extension, when imported, leaves a marker: the assertions are on what ran.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { ExtensionApprovalStore, extensionGate, projectExtensionCandidates } from "../src/extensionApproval.ts";

const slash = (p: string) => p.split(path.sep).join("/");

describe("the project's extensions run only once allowed", () => {
  let base: string;
  let root: string;
  let agentDir: string;
  let markers: string;
  let n = 0;

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "ext-approval-"));
  });
  after(async () => {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  beforeEach(async () => {
    n += 1;
    root = path.join(base, `project-${n}`);
    agentDir = path.join(base, `agent-${n}`);
    markers = path.join(base, `markers-${n}`);
    await mkdir(path.join(root, ".pi", "extensions", "dir"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await mkdir(markers, { recursive: true });
    await writeFile(path.join(root, ".pi", "extensions", "x.ts"), extension("x"));
    await writeFile(path.join(root, ".pi", "extensions", "dir", "index.ts"), extension("dir"));
    await writeFile(path.join(root, "elsewhere.ts"), extension("elsewhere"));
    await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({ extensions: ["../elsewhere.ts"] }));
  });

  const extension = (name: string, body = "") =>
    `import { writeFileSync } from "node:fs"; writeFileSync("${slash(path.join(markers, name))}", "ran"); ${body} export default function () {}`;
  const ran = (name: string) => existsSync(path.join(markers, name));
  const store = () => new ExtensionApprovalStore(agentDir, root);
  const open = async (approvals: ExtensionApprovalStore) => {
    const gate = await extensionGate(root, agentDir, approvals);
    await createAgentSessionServices({ cwd: root, agentDir, settingsManager: gate.settingsManager });
    return gate;
  };

  test("pi finds each shape the project brings, without running any", async () => {
    const candidates = await projectExtensionCandidates(root, agentDir);
    assert.deepEqual(candidates.map((candidate) => candidate.label).sort(), [".pi/extensions/dir", ".pi/extensions/x.ts", "elsewhere.ts"]);
    assert.deepEqual(["x", "dir", "elsewhere"].filter(ran), [], "listing imported nothing");
  });

  // openlore: scenario=AnExtensionTheAgentWroteDoesNotRunUntilAllowed spec=project-extension-approval
  test("AnExtensionTheAgentWroteDoesNotRunUntilAllowed: a file, a directory and a path the settings name stay out until allowed", async () => {
    const approvals = store();
    const gate = await open(approvals);
    assert.deepEqual(gate.undecided.map((candidate) => candidate.label).sort(), [".pi/extensions/dir", ".pi/extensions/x.ts", "elsewhere.ts"]);
    assert.deepEqual(["x", "dir", "elsewhere"].filter(ran), [], "nothing ran");
    const x = gate.undecided.find((candidate) => candidate.label === ".pi/extensions/x.ts")!;
    await approvals.decide(x, "allow");
    const next = await open(approvals);
    assert.deepEqual(["x", "dir", "elsewhere"].filter(ran), ["x"], "only the allowed one ran");
    assert.deepEqual(next.undecided.map((candidate) => candidate.label).sort(), [".pi/extensions/dir", "elsewhere.ts"]);
  });

  // openlore: scenario=AChangedExtensionAsksAgain spec=project-extension-approval
  test("AChangedExtensionAsksAgain: a change to an allowed file, or to any file of an allowed directory, keeps it out", async () => {
    const approvals = store();
    const gate = await open(approvals);
    for (const candidate of gate.undecided) await approvals.decide(candidate, "allow");
    await writeFile(path.join(root, ".pi", "extensions", "x.ts"), extension("x", "/* changed */"));
    await writeFile(path.join(root, ".pi", "extensions", "dir", "helper.ts"), "export const added = 1;\n");
    const next = await open(approvals);
    assert.deepEqual(next.undecided.map((candidate) => candidate.label).sort(), [".pi/extensions/dir", ".pi/extensions/x.ts"]);
    assert.deepEqual(["x", "dir", "elsewhere"].filter(ran), ["elsewhere"]);
  });

  // openlore: scenario=RefusingIsRemembered spec=project-extension-approval
  test("RefusingIsRemembered: a refused extension stays out and is not asked about again while unchanged", async () => {
    const approvals = store();
    const gate = await open(approvals);
    const x = gate.undecided.find((candidate) => candidate.label === ".pi/extensions/x.ts")!;
    await approvals.decide(x, "refuse");
    const next = await open(approvals);
    assert.ok(!next.undecided.some((candidate) => candidate.label === ".pi/extensions/x.ts"), "not asked again");
    assert.ok(next.excluded.some((candidate) => candidate.label === ".pi/extensions/x.ts"), "still kept out");
    assert.equal(ran("x"), false);
    // Withdrawn from Settings: asked about again.
    assert.equal(await approvals.withdraw("file", x.key), true);
    assert.ok((await open(approvals)).undecided.some((candidate) => candidate.label === ".pi/extensions/x.ts"));
  });

  test("a project package is withheld until allowed: listed by its entry, never installed to be listed", async () => {
    await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:pi-outpost-no-such-package-for-a-test@0.0.0"] }));
    const approvals = store();
    const gate = await extensionGate(root, agentDir, approvals);
    assert.deepEqual(gate.undecided.filter((candidate) => candidate.kind === "package").map((candidate) => candidate.label), ["npm:pi-outpost-no-such-package-for-a-test@0.0.0"]);
    assert.deepEqual(gate.settingsManager.getProjectSettings().packages, [], "pi is not given it to install");
  });

  test("the project's own settings cannot force an excluded file back in", async () => {
    await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({ extensions: [`+${path.join(root, ".pi", "extensions", "x.ts")}`] }));
    await open(store());
    assert.equal(ran("x"), false);
  });

  test("decisions live under the agent directory, for this project only", async () => {
    const approvals = store();
    assert.ok(approvals.file.startsWith(path.join(agentDir, "pi-outpost")), approvals.file);
    assert.ok(!approvals.file.startsWith(root));
    await approvals.decide((await projectExtensionCandidates(root, agentDir))[0], "allow");
    const other = new ExtensionApprovalStore(agentDir, path.join(base, "another"));
    assert.deepEqual(await other.decisions(), []);
  });
});

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const skipMxc = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC (wxc-exec.exe) is not set" : false;

describe("the decisions are out of a confined command's reach", { skip: skipMxc }, () => {
  // openlore: scenario=AnExtensionTheAgentWroteDoesNotRunUntilAllowed spec=project-extension-approval
  test("an extension a confined command writes under MXC's real executor is not run by the next session", async () => {
    const { confinedBashOperations } = await import("../src/confinedBash.ts");
    const base = await mkdtemp(path.join(tmpdir(), "ext-approval-mxc-write-"));
    try {
      const root = path.join(base, "project");
      const agentDir = path.join(base, "agent");
      const outside = path.join(base, "outside");
      await mkdir(root, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await mkdir(outside, { recursive: true });
      const marker = slash(path.join(outside, "ESCAPED"));
      const file = path.join(root, ".pi", "extensions", "planted.ts");
      const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir });
      let output = "";
      const body = `import { writeFileSync } from "node:fs"; writeFileSync("${marker}", "ran"); export default function () {}`;
      await ops.exec(
        `New-Item -ItemType Directory -Force -Path '${path.dirname(file)}' | Out-Null; Set-Content -LiteralPath '${file}' -Value '${body}'; if (Test-Path -LiteralPath '${file}') { 'wrote it' }`,
        root,
        { onData: (data: Buffer) => (output += data.toString()), timeout: 120 },
      );
      assert.match(output, /wrote it/, "writing an extension stays allowed to the agent");
      const gate = await extensionGate(root, agentDir, new ExtensionApprovalStore(agentDir, root));
      await createAgentSessionServices({ cwd: root, agentDir, settingsManager: gate.settingsManager });
      assert.deepEqual(gate.undecided.map((candidate) => candidate.label), [".pi/extensions/planted.ts"], "asked about");
      assert.equal(existsSync(path.join(outside, "ESCAPED")), false, "not run outside the sandbox");
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  // openlore: scenario=AConfinedCommandCannotApprove spec=project-extension-approval
  test("AConfinedCommandCannotApprove: under MXC's real executor, the decisions file can be neither read nor written", async () => {
    const { confinedBashOperations } = await import("../src/confinedBash.ts");
    const base = await mkdtemp(path.join(tmpdir(), "ext-approval-mxc-"));
    try {
      const root = path.join(base, "project");
      const agentDir = path.join(base, "agent");
      await mkdir(path.join(root, ".pi", "extensions"), { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await writeFile(path.join(root, ".pi", "extensions", "x.ts"), "export default function () {}\n");
      const approvals = new ExtensionApprovalStore(agentDir, root);
      const [candidate] = await projectExtensionCandidates(root, agentDir);
      await approvals.decide(candidate, "refuse");
      const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, allowWrite: true, agentDir });
      let output = "";
      await ops.exec(
        [
          `try { Get-Content -LiteralPath '${approvals.file}' -ErrorAction Stop | Out-Null; 'read: yes' } catch { 'read: no' }`,
          `try { Set-Content -LiteralPath '${approvals.file}' -Value '{}' -ErrorAction Stop; 'write: yes' } catch { 'write: no' }`,
        ].join("; "),
        root,
        { onData: (data: Buffer) => (output += data.toString()), timeout: 120 },
      );
      assert.match(output, /read: no/, output);
      assert.match(output, /write: no/, output);
      assert.equal(await approvals.decisionFor(candidate), "refuse", "the decision is unchanged");
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});
