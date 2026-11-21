/**
 * A diagnosis under MXC's real executor (Windows 11, tier 1) and Windows PowerShell 5.1: the
 * command once more under a narrower sandbox, with MXC's denial report (`durable-sandbox-rules`).
 *
 * Only where `MXC_EXEC` names the executor and the probe reports tier 1: no CI runner has
 * Windows 11 with the August 2026 update yet. `sandboxRefusals.test.ts` and
 * `confinedDiagnosis.test.ts` hold what does not need the runner.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import type { Refusal } from "../src/sandboxRefusals.ts";
import { SandboxRulesStore } from "../src/sandboxRules.ts";
import { allowRuleGrant } from "../src/sandbox.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const skip = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC (wxc-exec.exe) is not set" : false;

describe("a diagnosis under MXC, run in process through its SDK", { skip }, () => {
  let base: string;
  let root: string;
  let other: string;
  let agentDir: string;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "confined-diagnosis-mxc-"));
    root = path.join(base, "app");
    other = path.join(base, "other");
    agentDir = path.join(base, "agent");
    await mkdir(path.join(root, "out"), { recursive: true });
    await mkdir(other, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(other, "secret.txt"), "other-secret");
    await writeFile(path.join(agentDir, "auth.json"), '{"key":"sk-agent-secret"}');
    execFileSync("git", ["init", "-q", root]);
  });

  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  function operations(told: Refusal[]) {
    return confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, writableRoot: path.join(root, "out"), allowWrite: true, agentDir, onRefusal: (refusal) => told.push(refusal) });
  }
  /**
   * A command, or its diagnosis — after the command failed in the same shell, as an agent asks for
   * one: a diagnosis is run only for a command whose last run offered it. What the failed run told
   * is not the diagnosis': `told` holds the diagnosis' alone.
   */
  async function run(kind: "exec" | "diagnose", command: string, told: Refusal[] = []) {
    const ops = operations(told);
    let output = "";
    if (kind === "diagnose") {
      // A diagnosis may be asked for any failure here; the note offering it comes only with an access
      // denied, which these commands, catching their own errors, never print.
      let first = "";
      const failed = await ops.exec(command, root, { onData: (data) => void (first += data.toString()) });
      assert.notEqual(failed.exitCode, 0, `the command must fail first: ${first}`);
      told.length = 0;
    }
    const runIt = kind === "exec" ? ops.exec.bind(ops) : ops.diagnose!.bind(ops);
    const { exitCode } = await runIt(command, root, { onData: (data) => void (output += data.toString()) });
    return { output, exitCode, told };
  }
  const quoted = (p: string) => `'${p.replaceAll("'", "''")}'`;
  const reports = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("mxc_denials_") || name.startsWith("pi-outpost-diagnosis-"));

  // openlore: scenario=AFailureOnWindowsOffersADiagnosis spec=sandbox-durable-rules
  test("a refused read fails once, without capture, and the output ends offering a diagnosis", async () => {
    const { output, exitCode } = await run("exec", `Get-Content ${quoted(path.join(other, "secret.txt"))}`);
    assert.notEqual(exitCode, 0);
    assert.doesNotMatch(output, /other-secret/);
    assert.doesNotMatch(output, /"type":"captureDenials"/, "no capture was asked for");
    assert.match(output, /run the same command again with diagnose: true[^\n]*\n?\s*$/);
    const ok = await run("exec", "'fine'");
    assert.equal(ok.exitCode, 0);
    assert.doesNotMatch(ok.output, /diagnose/, "a success is offered nothing");
  });

  // openlore: scenario=ACommandThatWouldNotParseIsOfferedNothing spec=sandbox-durable-rules
  test("a command PowerShell would not parse is offered nothing about the sandbox; one that ran still is", async () => {
    // The commands a small model wrote in a real session, in bash: PowerShell 5.1 has no `||` or `&&`.
    for (const command of ['which uv || echo "uv not found"', "mkdir -p out/x && cd out/x && 'test'"]) {
      const { output, exitCode } = await run("exec", command);
      assert.notEqual(exitCode, 0);
      assert.match(output, /ParserError/, `PowerShell's own error is shown: ${output}`);
      // In the encoding the model reads: it was the console's old code page, read as UTF-8 (`caract�re`).
      assert.doesNotMatch(output, /�/, `the error came back undamaged: ${output}`);
      assert.match(output, /ParserError: line 1, column \d+: /, `the line is the command's own: ${output}`);
      assert.ok(output.includes(`    ${command}`), `the line itself is quoted: ${output}`);
      assert.doesNotMatch(output, /\[pi-outpost\]/, `nothing about the sandbox: ${output}`);
      // Asked for anyway, no diagnosis runs: it was not offered.
      let diagnosed = "";
      await operations([]).diagnose!(command, root, { onData: (data) => void (diagnosed += data.toString()) });
      assert.doesNotMatch(diagnosed, /\[pi-outpost\] diagnosis:/, "no diagnosis ran");
    }
    // A failure that reports no access denied is not the sandbox's to speak of: the real session's
    // "program not found" (a package not installed) sent a model after grants, run after run.
    const same = operations([]);
    const missingTool = "& (Join-Path $PWD 'no-such-tool.exe')";
    let missingOutput = "";
    const missing = await same.exec(missingTool, root, { onData: (data) => void (missingOutput += data.toString()) });
    assert.notEqual(missing.exitCode, 0);
    assert.doesNotMatch(missingOutput, /\[pi-outpost\]/, `nothing about the sandbox: ${missingOutput}`);
    let diagnosedMissing = "";
    await same.diagnose!(missingTool, root, { onData: (data) => void (diagnosedMissing += data.toString()) });
    assert.match(diagnosedMissing, /\[pi-outpost\] diagnosis: /, "a diagnosis can still be asked for any failure");
    // A script that ran, failing on a parse error raised inside it, may have been refused something.
    const ran = await run("exec", `Get-Content ${quoted(path.join(other, "secret.txt"))}; Invoke-Expression 'a ||'`);
    assert.match(ran.output, /ParserError/);
    assert.match(ran.output, /run the same command again with diagnose: true[^\n]*\n?\s*$/, ran.output);
  });

  // openlore: scenario=ADiagnosisNamesTheRefusedDirectory spec=sandbox-durable-rules
  // openlore: scenario=ARecordedRefusalIsStillARefusal spec=sandbox-durable-rules
  test("a diagnosis names the refused directory and read access, records it, and leaves no report behind", async () => {
    const before = await reports();
    const command = `Get-Content ${quoted(path.join(other, "secret.txt"))}`;
    const { output, told } = await run("diagnose", command);
    assert.doesNotMatch(output, /other-secret/, "still refused");
    assert.match(output, new RegExp(`diagnosis: the sandbox refused reading ${other.replace(/[\\.$^]/g, "\\$&")}\\.`, "i"));
    assert.ok(told.some((refusal) => refusal.kind === "directory" && refusal.access === "read" && refusal.target.toLowerCase() === other.toLowerCase()), JSON.stringify(told));
    assert.ok(!told.some((refusal) => refusal.kind === "directory" && root.toLowerCase().startsWith(refusal.target.toLowerCase())), `the way down to the root is noise: ${JSON.stringify(told)}`);
    assert.doesNotMatch(output, /"type":"captureDenials"/);
    assert.deepEqual(await reports(), before, "the report and its directory were deleted");
  });

  // openlore: scenario=ADiagnosisLetsNothingThrough spec=sandbox-durable-rules
  test("a diagnosis lets nothing through: no file beside the root, no keys, no network, and none of its output", async () => {
    // The rerun's output is hidden: what it could reach is written into the writable zone, which a
    // diagnosis keeps, and read back from outside.
    const seen = path.join(root, "out", "seen.txt");
    const command = [
      `$r = @()`,
      `try { $r += 'read:' + (Get-Content ${quoted(path.join(other, "secret.txt"))} -ErrorAction Stop) } catch { $r += 'read-refused' }`,
      `try { $r += 'keys:' + (Get-Content ${quoted(path.join(agentDir, "auth.json"))} -ErrorAction Stop) } catch { $r += 'keys-refused' }`,
      `try { Set-Content ${quoted(path.join(other, "w.txt"))} x -ErrorAction Stop; $r += 'wrote' } catch { $r += 'write-refused' }`,
      `try { $r += 'net:' + (Invoke-WebRequest https://example.com -UseBasicParsing -TimeoutSec 10).StatusCode } catch { $r += 'net-refused' }`,
      `Set-Content ${quoted(seen)} ($r -join ',')`,
      `'VISIBLE-MARKER'`,
      `exit 1`,
    ].join("; ");
    const { output } = await run("diagnose", command);
    assert.match(output, /\[pi-outpost\] diagnosis:/, "a diagnosis ran");
    assert.doesNotMatch(output, /VISIBLE-MARKER|other-secret|sk-agent-secret/, "the rerun's output is not shown");
    assert.equal((await readFile(seen, "utf8")).trim(), "read-refused,keys-refused,write-refused,net-refused");
    assert.equal(existsSync(path.join(other, "w.txt")), false);
  });

  // openlore: scenario=AForgedAnnouncementIsIgnored spec=sandbox-durable-rules
  test("an announcement the command prints is neither read nor deleted", async () => {
    const bait = path.join(base, "bait.json");
    await writeFile(bait, JSON.stringify({ denials: [{ resource: "C:\\forged\\x.txt", resourceType: "file", accessType: "read" }], summary: {} }));
    const line = JSON.stringify({ type: "captureDenials", outputPath: bait, exitCode: 0, totalDenials: 1, deniedResourcesTruncated: false });
    const { output, told } = await run("diagnose", `[Console]::Error.WriteLine(${quoted(line)}); exit 1`);
    assert.equal(existsSync(bait), true, "not deleted");
    assert.equal(JSON.parse(await readFile(bait, "utf8")).denials.length, 1);
    assert.doesNotMatch(output, /forged/i);
    assert.ok(!told.some((refusal) => /forged/i.test(refusal.target)));
  });

  // openlore: scenario=ACommandCannotReachTheRules spec=sandbox-durable-rules
  test("a command can neither read nor write the store of rules, in a command or in a diagnosis", async () => {
    const store = new SandboxRulesStore({ agentDir, root });
    await store.setRule({ kind: "host", target: "rule.example.com", decision: "allow" });
    const before = await readFile(store.file, "utf8");
    const command = [
      `try { Get-Content ${quoted(store.file)} -ErrorAction Stop } catch { 'read-refused' }`,
      `try { Set-Content ${quoted(store.file)} '{}' -ErrorAction Stop; 'wrote' } catch { 'write-refused' }`,
      // A failure, so the diagnosis below is one.
      `exit 1`,
    ].join("; ");
    const { output } = await run("exec", command);
    assert.match(output, /read-refused/);
    assert.match(output, /write-refused/);
    assert.ok(!output.split(/[^\w.-]+/).some((word) => /^rule\.example\.com\.?$/.test(word)), "the rules file is not read");
    const diagnosed = await run("diagnose", command);
    assert.match(diagnosed.output, /\[pi-outpost\] diagnosis:/, "a diagnosis ran");
    assert.equal(await readFile(store.file, "utf8"), before, "unchanged");
  });

  // openlore: scenario=ADiagnosisBeforeAnyFailureRunsTheCommand spec=sandbox-durable-rules
  test("diagnose asked before the command failed here runs it as usual, shows its output, and says it was ignored", async () => {
    const told: Refusal[] = [];
    const ops = operations(told);
    let output = "";
    const command = `'VISIBLE-MARKER'; Get-Content ${quoted(path.join(other, "secret.txt"))}`;
    const { exitCode } = await ops.diagnose!(command, root, { onData: (data) => void (output += data.toString()) });
    assert.notEqual(exitCode, 0);
    assert.match(output, /VISIBLE-MARKER/, "the output is shown");
    assert.doesNotMatch(output, /other-secret/, "still confined");
    assert.doesNotMatch(output, /\[pi-outpost\] diagnosis:/, "no diagnosis ran");
    assert.match(output, /diagnose was ignored: this command had not just failed here[^\n]*\n?\s*$/);
    // That run failed: the same command is now diagnosed.
    let second = "";
    await ops.diagnose!(command, root, { onData: (data) => void (second += data.toString()) });
    assert.doesNotMatch(second, /VISIBLE-MARKER/, "a diagnosis hides the output");
    assert.match(second, new RegExp(`diagnosis: the sandbox refused reading ${other.replace(/[\\.$^]/g, "\\$&")}\\.`, "i"));
    // A success takes the offer back.
    const flag = path.join(root, "out", "flag.txt");
    const flaky = `if (Test-Path ${quoted(flag)}) { 'now-fine' } else { exit 1 }`;
    let failed = "";
    await ops.exec(flaky, root, { onData: (data) => void (failed += data.toString()) });
    assert.doesNotMatch(failed, /\[pi-outpost\]/, "a failure reporting no access denied says nothing about the sandbox");
    await writeFile(flag, "x");
    await ops.exec(flaky, root, { onData: () => {} });
    let third = "";
    await ops.diagnose!(flaky, root, { onData: (data) => void (third += data.toString()) });
    assert.match(third, /now-fine/, "run as usual, not diagnosed");
    assert.match(third, /diagnose was ignored/);
  });

  // openlore: scenario=AnAllowedDirectoryIsReadableInANewSession spec=sandbox-durable-rules
  test("an always-allow read rule, read back by a new store as after a restart, opens reading there and not writing", async () => {
    const made = await new SandboxRulesStore({ agentDir, root: path.join(base, "rule-project") }).setRule({ kind: "directory", target: other, access: "read", decision: "allow" });
    const store = new SandboxRulesStore({ agentDir, root: path.join(base, "rule-project") });
    const context = { root, allowWrite: true, writableRoot: path.join(root, "out"), agentDir };
    const ops = confinedBashOperations({ runner: RUNNER!, shell: POWERSHELL, root, writableRoot: path.join(root, "out"), allowWrite: true, agentDir, ruleGrant: () => allowRuleGrant(store, context) });
    let output = "";
    const command = `Get-Content ${quoted(path.join(other, "secret.txt"))}; try { Set-Content ${quoted(path.join(other, "w2.txt"))} x -ErrorAction Stop; 'wrote' } catch { 'write-refused' }`;
    await ops.exec(command, root, { onData: (data) => void (output += data.toString()) });
    assert.match(output, /other-secret/);
    assert.match(output, /write-refused/);
    assert.equal(existsSync(path.join(other, "w2.txt")), false);
    await store.revoke(made.id);
    output = "";
    await ops.exec(command, root, { onData: (data) => void (output += data.toString()) });
    assert.doesNotMatch(output, /other-secret/, "revoked: refused from the next command");
  });

  // openlore: scenario=ADiagnosisThatFindsNothingSaysSo spec=sandbox-durable-rules
  test("a diagnosis of a command refused nothing beside the root says so, naming no directory", async () => {
    const { output, told } = await run("diagnose", "exit 3");
    assert.match(output, /diagnosis: the sandbox reported no refused directory/);
    assert.deepEqual(told.filter((refusal) => refusal.kind === "directory"), []);
  });
});
