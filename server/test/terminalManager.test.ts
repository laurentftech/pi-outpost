import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { TERMINAL_KILL_GRACE_MS, TerminalManager as RealTerminalManager, findWindowsGitBash, terminalEnvironment } from "../src/terminalManager.ts";
import type { WebSocket } from "ws";

/**
 * Every manager a test makes, closed after it whatever the test did.
 *
 * These tests spawn real shells. One left running keeps its pty open, and the test
 * file's process then never exits — a CI job that hangs with nothing failing.
 */
const managers: RealTerminalManager[] = [];
class TerminalManager extends RealTerminalManager {
  constructor() {
    super();
    managers.push(this);
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("TerminalManager", () => {
  afterEach(() => {
    for (const manager of managers.splice(0)) manager.closeAll();
  });

  test("getDefaultShell returns a valid shell path and args", () => {
    const manager = new TerminalManager();
    const { shell, args } = manager.getDefaultShell();

    assert.ok(typeof shell === "string" && shell.length > 0);
    assert.ok(Array.isArray(args));
    if (process.platform !== "win32") {
      assert.deepEqual(args, ["-l"]);
    }
  });

  test("getDefaultShell respects explicit shell and shellArgs options", () => {
    const manager = new TerminalManager();
    const custom = manager.getDefaultShell({ shell: "/bin/sh", shellArgs: ["-e"] });
    assert.equal(custom.shell, "/bin/sh");
    assert.deepEqual(custom.args, ["-e"]);
  });

  // openlore: scenario=OnWindowsTheConfinedShellIsPowerShell spec=terminal
  test("a confined terminal on Windows opens PowerShell, not Git Bash", { skip: process.platform !== "win32" && "Windows shell selection" }, () => {
    const manager = new TerminalManager();
    const confined = manager.getDefaultShell({ confined: true });
    assert.match(confined.shell, /powershell\.exe$|cmd\.exe$/i, `a confined shell must not be Git Bash: ${confined.shell}`);
    assert.doesNotMatch(confined.shell, /bash\.exe$/i);
    // An explicit choice still wins, confined or not.
    assert.equal(manager.getDefaultShell({ confined: true, shell: "C:\\tools\\sh.exe" }).shell, "C:\\tools\\sh.exe");
  });

  test("outside Windows, confinement does not change the shell", () => {
    const manager = new TerminalManager();
    if (process.platform === "win32") return;
    assert.deepEqual(manager.getDefaultShell({ confined: true }), manager.getDefaultShell());
  });

  test("findWindowsGitBash and Windows shell fallback resolution", () => {
    const manager = new TerminalManager();
    if (process.platform !== "win32") {
      assert.equal(findWindowsGitBash(), undefined);
      assert.equal(findWindowsGitBash("/nonexistent/git"), undefined);
    } else {
      const defaultShell = manager.getDefaultShell();
      assert.ok(typeof defaultShell.shell === "string" && defaultShell.shell.length > 0);
      assert.ok(
        defaultShell.shell.toLowerCase().endsWith("bash.exe") ||
        defaultShell.shell.toLowerCase().endsWith("powershell.exe") ||
        defaultShell.shell.toLowerCase().endsWith("cmd.exe"),
      );
      const bash = findWindowsGitBash("C:\\nonexistent\\path\\to\\git.exe");
      assert.ok(bash === undefined || typeof bash === "string");
    }
  });

  test("open, write, resize, and close terminal lifecycle", async () => {
    const manager = new TerminalManager();
    const fakeSocket = {} as WebSocket;

    let receivedData = "";
    const onData = (_id: string, data: string) => {
      receivedData += data;
    };

    let exitCodeReported: number | undefined;
    const onExit = (_id: string, code?: number) => {
      exitCodeReported = code;
    };

    const session = await manager.open(
      fakeSocket,
      "test-term-1",
      process.cwd(),
      80,
      24,
      onData,
      onExit,
    );

    assert.equal(session.terminalId, "test-term-1");
    assert.equal(session.socket, fakeSocket);
    assert.ok(session.ptyProcess);

    // Test resize
    const resized = manager.resize(fakeSocket, "test-term-1", 100, 30);
    assert.equal(resized, true);

    // Test write echo
    const wrote = manager.write(fakeSocket, "test-term-1", "echo hello-terminal-test\n");
    assert.equal(wrote, true);

    // Wait a bit for output
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(receivedData.length > 0);

    // Test getCwd
    const cwd = await manager.getCwd(fakeSocket, "test-term-1");
    assert.ok(typeof cwd === "string" && cwd.length > 0);

    // Close
    const closed = manager.close(fakeSocket, "test-term-1");
    assert.equal(closed, true);

    // Writing to closed session returns false
    const wroteAfterClose = manager.write(fakeSocket, "test-term-1", "echo after\n");
    assert.equal(wroteAfterClose, false);
  });

  test("isolates terminals strictly per socket", async () => {
    const manager = new TerminalManager();
    const socketA = { id: "a" } as unknown as WebSocket;
    const socketB = { id: "b" } as unknown as WebSocket;

    await manager.open(socketA, "term-1", process.cwd(), 80, 24, () => {}, () => {});
    await manager.open(socketB, "term-1", process.cwd(), 80, 24, () => {}, () => {});

    // Socket A cannot write to or inspect socket B's terminal, and vice-versa
    assert.equal(manager.write(socketA, "term-1", "echo a\n"), true);
    assert.equal(manager.write(socketB, "term-1", "echo b\n"), true);

    // Socket A cannot close a nonexistent or other socket's terminal
    const socketC = { id: "c" } as unknown as WebSocket;
    assert.equal(manager.write(socketC, "term-1", "hi"), false);
    assert.equal(manager.close(socketC, "term-1"), false);

    manager.closeAllForSocket(socketA);

    assert.equal(manager.write(socketA, "term-1", "hi"), false);
    assert.equal(manager.write(socketB, "term-1", "hi"), true);

    manager.closeAll();
  });

  test("sequential reopen preserves reachability and does not leak orphan sessions", async () => {
    const manager = new TerminalManager();
    const socket = {} as WebSocket;

    await manager.open(socket, "reopen-id", process.cwd(), 80, 24, () => {}, () => {});
    const session2 = await manager.open(socket, "reopen-id", process.cwd(), 80, 24, () => {}, () => {});

    // Wait for previous session to terminate and trigger its exit callback
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Second session must remain active and reachable
    assert.equal(manager.write(socket, "reopen-id", "echo alive\n"), true);
    assert.equal(manager.close(socket, "reopen-id"), true);
  });

  test("concurrent same-tick opens serialize cleanly without leaking orphan processes", async () => {
    const manager = new TerminalManager();
    const socket = {} as WebSocket;

    // Dispatch two opens in the exact same event loop tick (React StrictMode scenario)
    await Promise.all([
      manager.open(socket, "tick-id", process.cwd(), 80, 24, () => {}, () => {}),
      manager.open(socket, "tick-id", process.cwd(), 80, 24, () => {}, () => {}),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 200));

    // The final session must be reachable and clean up without issue
    assert.equal(manager.write(socket, "tick-id", "echo same-tick\n"), true);
    assert.equal(manager.close(socket, "tick-id"), true);
  });

  test("a shell that ignores SIGHUP is killed outright after the grace period", { skip: process.platform === "win32" && "ConPTY takes no signals" }, async () => {
    const manager = new TerminalManager();
    const socket = {} as WebSocket;
    const session = await manager.open(socket, "hup", process.cwd(), 80, 24, () => {}, () => {}, {
      shell: "/bin/bash",
      shellArgs: ["-c", "trap '' HUP; while :; do sleep 1; done"],
    });
    const pid = session.ptyProcess.pid;
    // Long enough for bash to have installed the trap before it is sent SIGHUP.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(manager.close(socket, "hup"), true);

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(alive(pid), "the shell survived SIGHUP, so this exercises the escalation");

    const deadline = Date.now() + TERMINAL_KILL_GRACE_MS + 3_000;
    while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(!alive(pid), "and it is gone once the grace period has passed");
  });
});

describe("terminalEnvironment", () => {
  // openlore: scenario=TheTerminalKeepsTheUsersAgentDirectory spec=sandbox-delegated-bash
  test("puts back what the user started the server with, and drops what they did not set", () => {
    const server = { PATH: "/usr/bin", PI_CODING_AGENT_DIR: "/srv/outpost-agent" };
    assert.equal(terminalEnvironment(server, { PI_CODING_AGENT_DIR: "/home/me/.pi/agent" }).PI_CODING_AGENT_DIR, "/home/me/.pi/agent");
    const unset = terminalEnvironment(server, { PI_CODING_AGENT_DIR: undefined });
    assert.equal("PI_CODING_AGENT_DIR" in unset, false);
    assert.equal(unset.PATH, "/usr/bin");
    assert.equal(unset.TERM, "xterm-256color");
  });
});
