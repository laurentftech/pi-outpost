/**
 * A confined terminal under MXC's real macOS executor (`mxc-exec-mac`, Seatbelt).
 *
 * The Linux twin is `terminalSandboxMxcLinux.test.ts`. This one drives a real pty through
 * `TerminalManager` with the policy pi-outpost builds (`mxcMacConfig`), and checks from inside
 * bash: git runs in a writable root, the agent's keys cannot be read, the size and a resize
 * reach the shell, Ctrl-C interrupts a command without ending the shell, and the shell's
 * working directory is found under the executor. Where `MXC_MAC_EXEC` is set, on macOS.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { WebSocket } from "ws";
import { TerminalManager } from "../src/terminalManager.ts";
import { checkRunner, mxcMacConfig } from "../src/terminalSandbox.ts";

const RUNNER = process.env.MXC_MAC_EXEC;
const skip = process.platform !== "darwin" ? "MXC's mxc-exec-mac runs on macOS" : !RUNNER ? "MXC_MAC_EXEC is not set (the path of mxc-exec-mac)" : false;

describe("a confined terminal under MXC's real macOS executor", { skip }, () => {
  let base: string;
  let root: string;
  let agentDir: string;
  const manager = new TerminalManager();
  const socket = {} as WebSocket;
  let output = "";
  let exited: number | undefined;
  const savedKey = process.env.OPENAI_API_KEY;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine a terminal here: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "confined-terminal-mxc-mac-"));
    root = path.join(base, "app");
    agentDir = path.join(base, "agent");
    await mkdir(path.join(root, "sub"), { recursive: true });
    await mkdir(agentDir);
    await writeFile(path.join(agentDir, "auth.json"), '{"key":"sk-agent-secret"}');
    execFileSync("git", ["init", "-q", root]);
    process.env.OPENAI_API_KEY = "sk-server-secret";
    await manager.open(
      socket,
      "t",
      root,
      120,
      40,
      (_id, data) => (output += data),
      (_id, code) => (exited = code ?? -1),
      { shell: "/bin/bash", shellArgs: ["--norc", "-i"] },
      { runner: RUNNER!, kind: "mxc", root, policy: (terminal) => mxcMacConfig({ root, allowWrite: true, agentDir, ...terminal, searchPath: terminal.env.PATH }) },
    );
  });

  after(async () => {
    manager.closeAllForSocket(socket);
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    // The shell gets up to TERMINAL_KILL_GRACE_MS to act on SIGHUP, and an interactive
    // one writes its history into HOME — the root — as it goes: a delete that does not
    // wait for it meets a directory that is no longer empty (ENOTEMPTY).
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  /** Run one line in the terminal's bash and return what it printed between two markers. */
  async function run(command: string): Promise<string> {
    const tag = `M${Math.random().toString(36).slice(2, 8)}`;
    const start = output.length;
    manager.write(socket, "t", `echo ${tag}-B; ${command} 2>&1; echo ${tag}-E\r`);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (exited !== undefined) throw new Error(`the confined shell exited (${exited}): ${output}`);
      const seen = output.slice(start).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
      const b = seen.lastIndexOf(`${tag}-B\n`);
      const e = seen.lastIndexOf(`${tag}-E\n`);
      if (b !== -1 && e > b) return seen.slice(b + tag.length + 3, e).trim();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no answer to ${command}: ${output.slice(start)}`);
  }

  // openlore: scenario=OnMacOsWithMxcGitRunsInTheTerminal spec=terminal
  test("OnMacOsWithMxcGitRunsInTheTerminal: git answers, the agent's keys cannot be read", async () => {
    assert.match(await run("git rev-parse --is-inside-work-tree"), /^true$/m);
    assert.match(await run("git status --short --branch"), /^## /m);
    const keys = await run(`cat ${agentDir}/auth.json; echo "exit=$?"`);
    assert.doesNotMatch(keys, /sk-agent-secret/);
    assert.match(keys, /exit=1/);
    assert.doesNotMatch(await run("env"), /sk-server-secret|OPENAI_API_KEY/);
  });

  // openlore: scenario=OnMacOsTheConfinedTerminalBehavesAsATerminal spec=terminal
  test("OnMacOsTheConfinedTerminalBehavesAsATerminal: size, resize, Ctrl-C, working directory", async () => {
    assert.match(await run("stty size"), /^40 120$/m);
    assert.ok(manager.resize(socket, "t", 150, 50));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.match(await run("stty size"), /^50 150$/m);
    manager.write(socket, "t", "sleep 30\r");
    await new Promise((resolve) => setTimeout(resolve, 500));
    manager.write(socket, "t", "\x03");
    // Kept before run(), whose own marker echo would reset $?.
    manager.write(socket, "t", "interrupted=$?\r");
    assert.match(await run("echo status=$interrupted"), /status=130/);
    assert.equal(exited, undefined, "Ctrl-C ended the shell");
    await run("cd sub");
    // lsof answers the real path: /var/folders is /private/var/folders.
    assert.equal(await manager.getCwd(socket, "t"), path.join(realpathSync(root), "sub"));
  });
});

describe("a confined terminal under MXC's real macOS executor, in zsh as the default shell", { skip }, () => {
  let base: string;
  let root: string;
  const manager = new TerminalManager();
  const socket = {} as WebSocket;
  let output = "";

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "confined-terminal-mxc-mac-zsh-"));
    root = path.join(base, "app");
    await mkdir(root);
    execFileSync("git", ["init", "-q", root]);
    // No shellArgs: the arguments pi-outpost picks for a confined shell on macOS.
    await manager.open(socket, "z", root, 120, 40, (_id, data) => (output += data), () => {}, { shell: "/bin/zsh" }, {
      runner: RUNNER!,
      kind: "mxc",
      root,
      policy: (terminal) => mxcMacConfig({ root, allowWrite: true, ...terminal, searchPath: terminal.env.PATH }),
    });
  });
  after(async () => {
    manager.closeAllForSocket(socket);
    // The shell gets up to TERMINAL_KILL_GRACE_MS to act on SIGHUP, and an interactive
    // one writes its history into HOME — the root — as it goes: a delete that does not
    // wait for it meets a directory that is no longer empty (ENOTEMPTY).
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // openlore: scenario=OnMacOsWithMxcGitRunsInTheTerminal spec=terminal
  test("OnMacOsWithMxcGitRunsInTheTerminal: in zsh, git is the developer tools' own, quiet, and leaves nothing in the root", async () => {
    // The marker is computed, so the terminal's echo of the typed line does not end the wait.
    manager.write(socket, "z", "git status --short --branch; echo GIT-$((40+2))-DONE\r");
    const deadline = Date.now() + 20_000;
    while (!/GIT-42-DONE/.test(output) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const seen = output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "");
    assert.match(seen, /## No commits yet/, seen);
    assert.doesNotMatch(seen, /DARWIN_USER|xcrun|xcodebuild/, "Apple's git shim ran");
    assert.deepEqual((await readdir(root)).sort(), [".git"], "something appeared in the root");
  });
});
