/**
 * The default sandbox's `"auto"` shell, under the real runner this machine has.
 *
 * `autoRunner.test.ts` fakes the runner and the verdicts; this one loads a configuration that
 * says nothing about the sandbox, builds the agent's tools from it, and runs a command through
 * them: on Windows 11 with MXC's tier 1 (`AUTO_REAL=1`, since no CI runner has the August 2026
 * update yet), and on macOS, where Seatbelt is part of the system.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { sharedShellVerdict } from "../src/confinementStatus.ts";
import { createSandboxedTools } from "../src/sandbox.ts";

const skip =
  process.platform === "darwin"
    ? false
    : process.platform === "win32"
      ? process.env.AUTO_REAL === "1"
        ? false
        : "AUTO_REAL=1 runs it on a Windows 11 build MXC's tier 1 supports"
      : "the Linux runner needs user namespaces a CI container refuses: see confinedBashMxcLinux.test.ts";

type Executable = (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<{ content: Array<{ text?: string }> }>;

describe("the default sandbox's shell under this machine's runner", { skip }, () => {
  let dir: string;
  let agentDir: string;
  before(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "auto-real-")));
    agentDir = path.join(dir, ".agent");
    await writeFile(path.join(dir, "config.json"), "{}\n");
  });
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // openlore: scenario=AutoOnACapableWindowsBuild spec=sandbox-defaults
  // openlore: scenario=AutoOnMacOs spec=sandbox-defaults
  test("AutoOnACapableWindowsBuild / AutoOnMacOs: the platform's runner earns the shell, and a command runs under it", { timeout: 180_000 }, async () => {
    const sandbox = loadConfig(dir, { config: path.join(dir, "config.json") }, process.env, { quiet: true }).sandbox!;
    assert.equal(sandbox.autoRunner?.unavailable, undefined, "this machine has a runner");
    assert.equal(sandbox.autoRunner?.label, process.platform === "darwin" ? "Seatbelt" : "MXC");
    const neverReadable = { agentDir, configFile: path.join(dir, "config.json") };
    const tools = await createSandboxedTools(sandbox, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, neverReadable);
    const name = process.platform === "win32" ? "powershell" : "bash";
    const shell = tools.find((tool) => tool.name === name);
    assert.ok(shell, `the agent gets ${name}`);
    const result = await (shell.execute as unknown as Executable)(
      "call-1",
      { command: process.platform === "win32" ? "Write-Output confined-hello" : "echo confined-hello" },
      undefined,
      undefined,
      { cwd: dir, sessionManager: { getSessionId: () => "auto-real", getSessionFile: () => undefined } },
    );
    assert.match(result.content.map((part) => part.text ?? "").join(""), /confined-hello/);
    const verdict = await sharedShellVerdict(sandbox, neverReadable);
    assert.equal(verdict.state, "verified", JSON.stringify(verdict));
  });
});
