/**
 * A confined terminal under MXC's real executor (Windows 11, tier 1).
 *
 * The Linux twin is `terminalSandboxReal.test.ts`. This one drives a real pty through
 * `TerminalManager` with `wxc-exec.exe` and the policy pi-outpost builds for it
 * (`mxcTerminalConfig` + `siblingsToDeny`), and checks from inside `cmd` what the
 * scenarios promise: reads stop at the root, writes at the writable zone, git runs, and
 * no key of the server's reaches the shell.
 *
 * Only where `MXC_EXEC` names the executor and its probe reports tier 1: no CI runner has
 * Windows 11 with the August 2026 update yet. Skipped elsewhere with the reason.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { WebSocket } from "ws";
import { TerminalManager } from "../src/terminalManager.ts";
import { checkRunner, mxcTerminalConfig, siblingsToDeny } from "../src/terminalSandbox.ts";

const RUNNER = process.env.MXC_EXEC;
const skip = process.platform !== "win32" ? "MXC confines on Windows only" : !RUNNER ? "MXC_EXEC is not set (the path of wxc-exec.exe)" : false;

describe("a confined terminal under MXC's real executor", { skip }, () => {
  let base: string;
  let root: string;
  let out: string;
  let agentDir: string;
  const manager = new TerminalManager();
  const socket = {} as WebSocket;
  const output: Record<string, string> = {};
  /** Set when a shell is gone: a launch MXC refused ends it at once, and waiting on it is pointless. */
  const exited: Record<string, number> = {};
  const savedKey = process.env.OPENAI_API_KEY;

  /**
   * Two terminals. "zone" writes only in `out`, for the read and write boundaries. "whole"
   * may write its whole root, for git: under tier 1 a read-only folder can be neither
   * listed nor entered (`baseContainerSupportsEnumeratePaths: false`), so git cannot use
   * a read-only work tree. That limit is documented; the common setup is this one.
   */
  async function openTerminal(id: string, writableRoot: string | undefined): Promise<void> {
    output[id] = "";
    await manager.open(
      socket,
      id,
      root,
      120,
      40,
      (_id, data) => {
        output[id] += data;
      },
      (_id, code) => {
        exited[id] = code ?? -1;
      },
      { shell: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), shellArgs: [] },
      {
        runner: RUNNER!,
        kind: "mxc",
        root,
        policy: (terminal) => mxcTerminalConfig({ root, writableRoot, allowWrite: true, agentDir, ...terminal, siblings: siblingsToDeny(root) }),
      },
    );
  }

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine a terminal on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "confined-terminal-mxc-"));
    root = path.join(base, "app");
    out = path.join(root, "out");
    agentDir = path.join(base, "agent");
    await mkdir(out, { recursive: true });
    await mkdir(path.join(base, "other"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(base, "other", "secret.txt"), "other-secret");
    await writeFile(path.join(agentDir, "auth.json"), '{"key":"sk-agent-secret"}');
    execFileSync("git", ["init", "-q", root]);
    process.env.OPENAI_API_KEY = "sk-server-secret";
    await openTerminal("zone", out);
    await openTerminal("whole", undefined);
  });

  after(async () => {
    manager.closeAllForSocket(socket);
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    // ConPTY lets go of the root a moment after the shell ends.
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  /** Run one line in a terminal's cmd and return what it printed between two markers. */
  async function run(command: string, id = "zone"): Promise<string> {
    const tag = `M${Math.random().toString(36).slice(2, 8)}`;
    const start = output[id].length;
    manager.write(socket, id, `echo ${tag}-B& ${command} 2>&1 & echo ${tag}-E\r`);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (exited[id] !== undefined) throw new Error(`the confined shell exited (${exited[id]}): ${output[id]}`);
      // ConPTY repaints with escape sequences: strip them before looking for the markers.
      const seen = output[id].slice(start).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
      const b = seen.lastIndexOf(`${tag}-B\n`);
      // ConPTY may follow the end marker with a cursor move instead of a newline: any
      // character after it, the next prompt included, means the line is complete.
      const e = seen.lastIndexOf(`${tag}-E`);
      if (b !== -1 && e > b && seen.length > e + tag.length + 2) return seen.slice(b + tag.length + 3, e).trim();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no answer to ${command}: ${output[id].slice(start)}`);
  }

  // openlore: scenario=ReadsStayInsideTheRoot spec=terminal
  test("reads stop at the root: a sibling project and the agent's keys", async () => {
    assert.match(await run(`type "${path.join(base, "other", "secret.txt")}"`), /(Access is denied|Accès refusé)/i);
    assert.match(await run(`type "${path.join(agentDir, "auth.json")}"`), /(Access is denied|Accès refusé)/i);
    assert.doesNotMatch(await run(`type "${path.join(agentDir, "auth.json")}"`), /sk-agent-secret/);
  });

  // openlore: scenario=WritesStayInsideTheWritableZone spec=terminal
  test("writes succeed in the writable zone and are refused elsewhere in the root", async () => {
    await run(`echo inside> "${path.join(out, "a.txt")}"`);
    assert.equal((await readFile(path.join(out, "a.txt"), "utf8")).trim(), "inside");
    assert.match(await run(`echo outside> "${path.join(root, "b.txt")}"`), /(Access is denied|Accès refusé)/i);
    await assert.rejects(readFile(path.join(root, "b.txt")));
  });

  // openlore: scenario=OnWindowsWithMxcGitRunsConfined spec=terminal
  test("git finds its work tree and runs, inside the sandbox", async () => {
    assert.match(await run("git rev-parse --is-inside-work-tree", "whole"), /^true$/m);
    assert.match(await run("git status --short --branch", "whole"), /^## /m);
    assert.match(await run("type nul && echo nul-ok", "whole"), /nul-ok/, "NUL, which landstrip's AppContainer refuses, opens");
    // Still confined: the drive is readable for git, the keys are not.
    assert.match(await run(`type "${path.join(agentDir, "auth.json")}"`, "whole"), /(Access is denied|Accès refusé)/i);
  });

  // openlore: scenario=KeysDoNotReachTheShell spec=terminal
  test("the server's keys are not in the shell's environment", async () => {
    // cmd's own words, in whichever language Windows speaks.
    assert.match(await run("set OPENAI_API_KEY"), /not defined|pas définie/i);
    assert.doesNotMatch(await run("set"), /sk-server-secret/);
  });
});
