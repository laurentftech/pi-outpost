/**
 * The project's extensions run only once allowed (`project-extension-approval`): the gate, against
 * pi's real loader. Each extension, when imported, leaves a marker: the assertions are on what ran.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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

  // openlore: scenario=AProjectMcpServerDoesNotStartUntilAllowed spec=project-extension-approval
  test("AProjectMcpServerDoesNotStartUntilAllowed: a server the project's mcp.json defines is left out of pi's MCP configuration until allowed, and a change asks again", async () => {
    await writeFile(
      path.join(root, ".pi", "mcp.json"),
      JSON.stringify({ mcpServers: { planted: { command: "node", args: ["-e", "1"] }, other: { url: "https://example.invalid/mcp" } } }),
    );
    const approvals = store();
    const gate = await extensionGate(root, agentDir, approvals);
    const mcp = gate.undecided.filter((candidate) => candidate.kind === "mcp");
    assert.deepEqual(mcp.map((candidate) => candidate.label).sort(), ['MCP server "other": https://example.invalid/mcp', 'MCP server "planted": node -e 1']);
    const servers = (g: typeof gate) => g.loadMcpConfig({ agentDir, cwd: root, projectTrusted: true }).servers.map((entry) => entry.name).sort();
    assert.deepEqual(servers(gate), [], "neither is given to pi");
    await approvals.decide(mcp.find((candidate) => candidate.key === "planted")!, "allow");
    const next = await extensionGate(root, agentDir, approvals);
    assert.deepEqual(servers(next), ["planted"], "the allowed one only");
    // Changed after it was allowed: its command is not what was allowed.
    await writeFile(path.join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { planted: { command: "node", args: ["-e", "2"] } } }));
    assert.deepEqual(servers(next), [], "a changed server is out, even through a gate built before the change");
    const after = await extensionGate(root, agentDir, approvals);
    assert.deepEqual(after.undecided.filter((candidate) => candidate.kind === "mcp").map((candidate) => candidate.label), ['MCP server "planted": node -e 2'], "asked again");
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

/**
 * The same two checks under each real runner this machine has, named by its variable: MXC on
 * Windows (`MXC_EXEC`, PowerShell), MXC on Linux (`MXC_LXC_EXEC`, Bubblewrap — CI's `mxc-linux`
 * job), MXC on macOS (`MXC_MAC_EXEC`) and Seatbelt (`SEATBELT_EXEC`) — CI's `mxc-macos` job.
 */
interface RealRunner {
  name: string;
  runner: string;
  shell?: string;
  /** Creates the extension file with \`body\`, and prints "wrote it". */
  plant(file: string, body: string): string;
  /** Tries to read, then to write, \`file\`, printing "read: yes|no" and "write: yes|no". */
  touch(file: string): string;
}

const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const sh = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const posix = (name: string, runner: string | undefined, platform: NodeJS.Platform): RealRunner | undefined =>
  runner && process.platform === platform
    ? {
        name,
        runner,
        plant: (file, body) => `mkdir -p ${sh(path.dirname(file))} && printf '%s\\n' ${sh(body)} > ${sh(file)} && test -f ${sh(file)} && echo 'wrote it'`,
        touch: (file) =>
          `if cat ${sh(file)} >/dev/null 2>&1; then echo 'read: yes'; else echo 'read: no'; fi; ` +
          `if (printf '{}' > ${sh(file)}) 2>/dev/null; then echo 'write: yes'; else echo 'write: no'; fi`,
      }
    : undefined;

const REAL_RUNNERS: RealRunner[] = [
  process.platform === "win32" && process.env.MXC_EXEC
    ? {
        name: "MXC on Windows",
        runner: process.env.MXC_EXEC,
        shell: POWERSHELL,
        plant: (file: string, body: string) =>
          `New-Item -ItemType Directory -Force -Path '${path.dirname(file)}' | Out-Null; Set-Content -LiteralPath '${file}' -Value '${body}'; if (Test-Path -LiteralPath '${file}') { 'wrote it' }`,
        touch: (file: string) =>
          `try { Get-Content -LiteralPath '${file}' -ErrorAction Stop | Out-Null; 'read: yes' } catch { 'read: no' }; ` +
          `try { Set-Content -LiteralPath '${file}' -Value '{}' -ErrorAction Stop; 'write: yes' } catch { 'write: no' }`,
      }
    : undefined,
  // In the Linux container, only the run with the documented flags confines: under Docker's default
  // profile MXC must refuse (MXC_LINUX_EXPECT=refused), which its own tests check.
  posix("MXC on Linux", process.env.MXC_LINUX_EXPECT === "confined" ? process.env.MXC_LXC_EXEC : undefined, "linux"),
  posix("MXC on macOS", process.env.MXC_MAC_EXEC, "darwin"),
  posix("Seatbelt", process.env.SEATBELT_EXEC, "darwin"),
].filter((runner): runner is RealRunner => runner !== undefined);

/** A fresh base with a project, an agent directory and a place outside both, symlinks resolved. */
async function confinedBase(prefix: string) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  const root = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  const outside = path.join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(outside, { recursive: true });
  return { base, root, agentDir, outside };
}

async function runConfined(runner: RealRunner, root: string, agentDir: string, command: string): Promise<string> {
  const { confinedBashOperations } = await import("../src/confinedBash.ts");
  const ops = confinedBashOperations({ runner: runner.runner, ...(runner.shell ? { shell: runner.shell } : {}), root, allowWrite: true, agentDir });
  let output = "";
  await ops.exec(command, root, { onData: (data: Buffer) => (output += data.toString()), timeout: 120 });
  return output;
}

describe("under a real runner: what a confined command writes waits, and the decisions are out of its reach", { skip: REAL_RUNNERS.length === 0 ? "no real runner named (MXC_EXEC, MXC_LXC_EXEC, MXC_MAC_EXEC, SEATBELT_EXEC)" : false }, () => {
  for (const runner of REAL_RUNNERS) {
    // openlore: scenario=AnExtensionTheAgentWroteDoesNotRunUntilAllowed spec=project-extension-approval
    test(`${runner.name}: an extension a confined command writes is not run by the next session`, async () => {
      const { base, root, agentDir, outside } = await confinedBase("ext-approval-write-");
      try {
        const marker = slash(path.join(outside, "ESCAPED"));
        const file = path.join(root, ".pi", "extensions", "planted.ts");
        const body = `import { writeFileSync } from "node:fs"; writeFileSync("${marker}", "ran"); export default function () {}`;
        const output = await runConfined(runner, root, agentDir, runner.plant(file, body));
        assert.match(output, /wrote it/, `writing an extension stays allowed to the agent: ${output}`);
        const gate = await extensionGate(root, agentDir, new ExtensionApprovalStore(agentDir, root));
        await createAgentSessionServices({ cwd: root, agentDir, settingsManager: gate.settingsManager });
        assert.deepEqual(gate.undecided.map((candidate) => candidate.label), [".pi/extensions/planted.ts"], "asked about");
        assert.equal(existsSync(path.join(outside, "ESCAPED")), false, "not run outside the sandbox");
      } finally {
        await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    });

    // openlore: scenario=AConfinedCommandCannotApprove spec=project-extension-approval
    test(`AConfinedCommandCannotApprove (${runner.name}): the decisions file can be neither read nor written`, async () => {
      const { base, root, agentDir } = await confinedBase("ext-approval-touch-");
      try {
        await mkdir(path.join(root, ".pi", "extensions"), { recursive: true });
        await writeFile(path.join(root, ".pi", "extensions", "x.ts"), "export default function () {}\n");
        const approvals = new ExtensionApprovalStore(agentDir, root);
        const [candidate] = await projectExtensionCandidates(root, agentDir);
        await approvals.decide(candidate, "refuse");
        const output = await runConfined(runner, root, agentDir, runner.touch(approvals.file));
        assert.match(output, /read: no/, output);
        assert.match(output, /write: no/, output);
        assert.equal(await approvals.decisionFor(candidate), "refuse", "the decision is unchanged");
      } finally {
        await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    });
  }
});
