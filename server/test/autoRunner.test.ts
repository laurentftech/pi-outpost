/**
 * `sandbox.bashRunner: "auto"`: which runner it takes, how a command waits for the runner to
 * prove itself, and how it is refused — never run unconfined — when it cannot.
 *
 * The runner here is a fake (see `confinedBash.test.ts`); the verdicts are given, through the
 * shared verdict the interface and the gate both read. What the real runners confine is the
 * real tests' job.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { ConfinementVerdict } from "@pi-outpost/shared";
import { platformRunner } from "../src/autoRunner.ts";
import { confinedBashOperations } from "../src/confinedBash.ts";
import {
  autoShellRefusal,
  autoVerdictRefusal,
  confineSuggestion,
  sharedShellVerdict,
  shellIsUnconfined,
  unconfinedShellVerdict,
} from "../src/confinementStatus.ts";
import { confinementChecks } from "../src/doctor.ts";
import type { SandboxConfig } from "../src/config.ts";
import { createSandboxedTools } from "../src/sandbox.ts";

const FAKE_RUNNER = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const [shell, script] = args.slice(args.indexOf("--") + 1);
fs.appendFileSync(require("node:path").join(process.cwd(), "ran.log"), "ran\\n");
const child = spawn(shell, [script], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
`;

const verified = (runner: string): ConfinementVerdict => ({ state: "verified", runner, checkedAt: new Date().toISOString(), refused: ["agent-directory"], notChecked: [] });
const leaking = (runner: string): ConfinementVerdict => ({ state: "leaking", runner, checkedAt: new Date().toISOString(), reached: ["agent-directory"], refused: [] });

describe("platformRunner", () => {
  test("macOS takes Seatbelt, on every Mac", () => {
    assert.deepEqual(platformRunner({ platform: "darwin", arch: "x64" }), { runner: "/usr/bin/sandbox-exec", label: "Seatbelt" });
  });

  test("Windows and Linux take MXC's executor, or say why there is none", () => {
    assert.deepEqual(platformRunner({ platform: "win32", mxcExecutor: () => "C:\\mxc\\wxc-exec.exe" }), { runner: "C:\\mxc\\wxc-exec.exe", label: "MXC" });
    const missing = platformRunner({ platform: "linux", arch: "x64", execPath: "/opt/pi-outpost", mxcExecutor: () => undefined });
    assert.ok("reason" in missing);
    assert.match(missing.reason, /MXC's executor is not installed/);
  });

  test("a platform no runner confines on has a reason", () => {
    const none = platformRunner({ platform: "freebsd" });
    assert.ok("reason" in none);
    assert.match(none.reason, /freebsd/);
  });
});

describe("the shared verdict and its refusal", () => {
  const sandbox = (name: string): SandboxConfig => ({ root: path.join(tmpdir(), name), allowWrite: true, allowBash: true, bashRunner: "/r", autoRunner: { label: "MXC" }, readExceptions: [] });

  test("the lock and the gate read one canary run", async () => {
    let runs = 0;
    const fake = async () => {
      runs += 1;
      return verified("/r");
    };
    const box = sandbox("shared-once");
    const [a, b] = await Promise.all([sharedShellVerdict(box, {}, fake), sharedShellVerdict(box, {}, fake)]);
    assert.equal(a, b);
    assert.equal(runs, 1);
    assert.equal(await autoShellRefusal(box, {}, fake), undefined, "a verified runner runs commands");
    assert.equal(runs, 1);
  });

  test("a verdict that could not be reached is asked again", async () => {
    let runs = 0;
    const fake = async (): Promise<ConfinementVerdict> => {
      runs += 1;
      return { state: "failed", runner: "/r", checkedAt: new Date().toISOString(), reason: "timed out" };
    };
    const box = sandbox("shared-failed");
    assert.match((await autoShellRefusal(box, {}, fake))!, /timed out/);
    await new Promise((resolve) => setImmediate(resolve));
    await autoShellRefusal(box, {}, fake);
    assert.equal(runs, 2);
  });

  // openlore: scenario=ACanaryLeakRefusesTheShell spec=sandbox-defaults
  test("ACanaryLeakRefusesTheShell: a leak refuses, naming what the canary reached and the way back", () => {
    const refusal = autoVerdictRefusal(leaking("/opt/mxc/lxc-exec"))!;
    assert.match(refusal, /lxc-exec cannot confine it/);
    assert.match(refusal, /read the agent directory/);
    assert.match(refusal, /"sandbox\.bashRunner": "none"/);
    assert.equal(autoVerdictRefusal(verified("/r")), undefined);
    assert.ok(autoVerdictRefusal({ state: "partial", runner: "/r", checkedAt: "", refused: [], exposed: ["OPENAI_API_KEY"], notChecked: [] })!.includes("OPENAI_API_KEY"));
  });
});

describe("a command of an \"auto\" shell", () => {
  let base: string;
  let root: string;
  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "auto-runner-"));
    root = path.join(base, "app");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "run"), FAKE_RUNNER);
  });
  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const ran = async () => (await readFile(path.join(root, "ran.log"), "utf8").catch(() => "")).split("\n").filter(Boolean).length;

  function operations(gate: () => Promise<string | undefined>, checks: { count: number }) {
    return confinedBashOperations({
      runner: process.execPath,
      shell: process.execPath,
      root,
      allowWrite: true,
      agentDir: path.join(base, "agent"),
      check: async () => {
        checks.count += 1;
        return { ok: true as const };
      },
      gate,
    });
  }

  // openlore: scenario=APromptBeforeTheChoiceIsAnswered spec=sandbox-defaults
  test("APromptBeforeTheChoiceIsAnswered: a command issued while the canary runs waits for it, then runs", async () => {
    let pass!: () => void;
    const canary = new Promise<void>((resolve) => (pass = resolve));
    const checks = { count: 0 };
    const before = await ran();
    let output = "";
    const running = operations(async () => {
      await canary;
      return undefined;
    }, checks).exec(`process.stdout.write("done")`, root, { onData: (data) => (output += data.toString()) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await ran(), before, "nothing ran before the canary passed");
    assert.equal(checks.count, 0);
    pass();
    const result = await running;
    assert.equal(result.exitCode, 0);
    assert.equal(output, "done");
    assert.equal(await ran(), before + 1);
  });

  // openlore: scenario=ACanaryLeakRefusesTheShell spec=sandbox-defaults
  test("a refused gate runs nothing, confined or not", async () => {
    const checks = { count: 0 };
    const before = await ran();
    const refusal = autoVerdictRefusal(leaking(process.execPath))!;
    await assert.rejects(
      operations(async () => refusal, checks).exec(`process.stdout.write("leak")`, root, { onData: () => {} }),
      (error: Error) => error.message === refusal,
    );
    assert.equal(await ran(), before, "the runner was never started");
    assert.equal(checks.count, 0);
  });
});

describe("an \"auto\" shell with no runner on this machine", () => {
  // openlore: scenario=AnOldWindowsBuildRefusesTheShell spec=sandbox-defaults
  test("the shell tool is registered, refuses every command with the reason, and the other tools stay", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "auto-unavailable-"));
    try {
      for (const bashShell of [undefined, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"]) {
        const tools = await createSandboxedTools({
          root,
          allowWrite: true,
          allowBash: true,
          ...(bashShell ? { bashShell } : {}),
          autoRunner: { unavailable: "MXC would confine with tier \"appcontainer\"; this machine is Windows build 26100.8000" },
          readExceptions: [],
        });
        const name = bashShell ? "powershell" : "bash";
        const shell = tools.find((tool) => tool.name === name);
        assert.ok(shell, `${name} is registered`);
        assert.ok(tools.some((tool) => tool.name === "read") && tools.some((tool) => tool.name === "write"), "the other tools keep working");
        assert.ok(!tools.some((tool) => tool.name === "run_with_grant"), "nothing to grant to a shell that runs nothing");
        const marker = path.join(root, "ran.txt");
        const run = (shell.execute as unknown as (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<unknown>)(
          "call-1",
          { command: `echo ran > "${marker}"` },
          undefined,
          undefined,
          { cwd: root, sessionManager: { getSessionId: () => "auto-runner-test", getSessionFile: () => undefined } },
        );
        await assert.rejects(run, /26100\.8000[\s\S]*"sandbox\.bashRunner": "none"/);
        assert.equal(await readFile(marker, "utf8").catch(() => undefined), undefined, "the command did not run");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the nudge for an unconfined shell", () => {
  // openlore: scenario=ACapableMachineIsNudged spec=sandbox-defaults
  // openlore: scenario=TheSuggestionNamesTheCommand spec=sandbox-defaults
  test("ACapableMachineIsNudged: a runner passing its self-check is named, with pi-outpost config --confine, in the log line and doctor", async () => {
    const verdict = await unconfinedShellVerdict({ runner: "C:\\mxc\\wxc-exec.exe", label: "MXC" }, async () => ({ ok: true }));
    assert.deepEqual(verdict, { state: "unconfined", available: { runner: "C:\\mxc\\wxc-exec.exe", label: "MXC" } });
    assert.match(confineSuggestion(verdict)!, /MXC can confine it on this machine: run "pi-outpost config --confine"/);
    const [check] = confinementChecks([{ surface: "shell", verdict }]);
    assert.equal(check.status, "warn");
    assert.match(check.remedy!.join(" "), /pi-outpost config --confine/);
  });

  // openlore: scenario=AnIncapableMachineIsNotNudged spec=sandbox-defaults
  test("AnIncapableMachineIsNotNudged: a failed self-check gives its reason and suggests nothing", async () => {
    const verdict = await unconfinedShellVerdict({ runner: "C:\\mxc\\wxc-exec.exe", label: "MXC" }, async () => ({ ok: false, reason: "tier appcontainer-dacl" }));
    assert.deepEqual(verdict, { state: "unconfined", reason: "tier appcontainer-dacl" });
    assert.equal(confineSuggestion(verdict), undefined);
    const [check] = confinementChecks([{ surface: "shell", verdict }]);
    assert.equal(check.status, "ok");
    assert.doesNotMatch(JSON.stringify(check), /--confine/);
    assert.match(check.detail.join(" "), /tier appcontainer-dacl/);
    assert.deepEqual(await unconfinedShellVerdict({ reason: "no runner on freebsd" }), { state: "unconfined", reason: "no runner on freebsd" });
  });

  test("an unavailable \"auto\" shell is a doctor warning carrying the refusal; which shells count as unconfined", () => {
    const [check] = confinementChecks([{ surface: "shell", verdict: { state: "unavailable", runner: "", reason: "nothing can confine it" } }]);
    assert.equal(check.status, "warn");
    assert.match(check.detail.join(" "), /nothing can confine it/);
    const base = { root: "/p", allowWrite: true, readExceptions: [] };
    assert.equal(shellIsUnconfined({ ...base, allowBash: true }), true);
    assert.equal(shellIsUnconfined({ ...base, allowBash: false }), false);
    assert.equal(shellIsUnconfined({ ...base, allowBash: true, bashRunner: "/r" }), false);
    assert.equal(shellIsUnconfined({ ...base, allowBash: true, autoRunner: { unavailable: "x" } }), false);
    assert.equal(shellIsUnconfined({ ...base, allowBash: true, bashFrom: "npm:pi-landstrip" }), false);
  });
});
