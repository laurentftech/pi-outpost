/**
 * The host's loopback under MXC's real executor (Windows 11, tier 1), with Python.
 *
 * Windows blocks a contained process's connection to its own listener unless the host's
 * loopback is open, and CPython builds `socket.socketpair()` — every asyncio loop — from such
 * a connection (microsoft/mxc#1261). So the agent's shell and a confined terminal run with the
 * loopback open (`sandbox.hostLoopback`, default true), and the server answers a command only
 * with its token. Checked from the command's side, with a real server beside it.
 *
 * The first test watches MXC itself: if a Windows update lets a process reach its own loopback
 * with the loopback closed, it fails, and the default can be reconsidered.
 *
 * Only where `MXC_EXEC` names the executor and a Python is on the search path: no CI runner has
 * MXC tier 1.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { WebSocket } from "ws";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { buildTerminalConfinement } from "../src/confinementStatus.ts";
import { TerminalManager } from "../src/terminalManager.ts";
import { checkRunner } from "../src/terminalSandbox.ts";
import { makeWorkspace, startServer } from "./harness.mjs";

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const CMD = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");

/** A real Python on the search path — not the Store's alias, which opens the Store. */
function pythonOnPath(): string | undefined {
  try {
    return execFileSync("where.exe", ["python"], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/\\WindowsApps\\/i.test(line));
  } catch {
    return undefined;
  }
}

const python = process.platform === "win32" ? pythonOnPath() : undefined;
const skip =
  process.platform !== "win32"
    ? "MXC confines on Windows only"
    : !RUNNER
      ? "MXC_EXEC (wxc-exec.exe) is not set"
      : !python
        ? "no Python on the search path"
        : false;

/** Python's asyncio, started and stopped; a hang ends in a traceback after 10 s. */
const ASYNCIO = `import faulthandler, asyncio
faulthandler.dump_traceback_later(10, exit=True)
asyncio.run(asyncio.sleep(0))
print("asyncio-ok")
`;

/** A TCP connection to a port of the host's loopback: REACHED and what it answered, or REFUSED. */
const CONNECT = `import socket, sys
s = socket.socket(); s.settimeout(4)
try:
    s.connect(("127.0.0.1", int(sys.argv[1]))); s.sendall(b"GET / HTTP/1.0\\r\\n\\r\\n"); print("REACHED", s.recv(200))
except Exception as e:
    print("REFUSED", type(e).__name__)
`;

/** The server's WebSocket, opened without a token: the close code, and whether data came first. */
const WS = `import socket, sys
s = socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=10)
s.sendall(("GET /ws HTTP/1.1\\r\\nHost: 127.0.0.1:%s\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n"
           "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n" % sys.argv[1]).encode())
buf = b""
while b"\\r\\n\\r\\n" not in buf:
    buf += s.recv(4096)
head, rest = buf.split(b"\\r\\n\\r\\n", 1)
print(head.split(b"\\r\\n")[0].decode())
data = 0
while True:
    while len(rest) < 2:
        chunk = s.recv(4096)
        if not chunk: print("ended"); sys.exit(0)
        rest += chunk
    opcode, length = rest[0] & 0x0F, rest[1] & 0x7F
    while len(rest) < 2 + length:
        rest += s.recv(4096)
    payload, rest = rest[2:2 + length], rest[2 + length:]
    if opcode == 8:
        print("data-frames", data); print("close", int.from_bytes(payload[:2], "big")); break
    data += 1
`;

describe("the host's loopback under MXC's real executor", { skip }, () => {
  let base: string;
  let root: string;
  let hostService: Server;
  let hostPort: number;
  let server: Awaited<ReturnType<typeof startServer>>;
  const manager = new TerminalManager();
  const socket = {} as WebSocket;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "confined-loopback-mxc-"));
    root = path.join(base, "app");
    await mkdir(root);
    await writeFile(path.join(root, "asyncio_probe.py"), ASYNCIO);
    await writeFile(path.join(root, "connect_probe.py"), CONNECT);
    await writeFile(path.join(root, "ws_probe.py"), WS);
    // A service of the host's own, listening on its loopback.
    hostService = createServer((_req, res) => res.end("host-local-service"));
    await new Promise<void>((resolve) => hostService.listen(0, "127.0.0.1", resolve));
    hostPort = (hostService.address() as { port: number }).port;
    // A real pi-outpost server with a generated token, its agent directory beside it.
    server = await startServer(await makeWorkspace({ "README.md": "# x\n" }));
  });

  after(async () => {
    manager.closeAllForSocket(socket);
    await server?.stop();
    await new Promise((resolve) => (hostService ? hostService.close(resolve) : resolve(undefined)));
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const serverAgentDir = () => path.join(server.root, ".pi-agent");

  async function ps(command: string, hostLoopback?: boolean) {
    const ops = confinedBashOperations({
      runner: RUNNER!,
      shell: POWERSHELL,
      root,
      allowWrite: true,
      agentDir: serverAgentDir(),
      ...(hostLoopback === undefined ? {} : { hostLoopback }),
    });
    let output = "";
    const { exitCode } = await ops.exec(command, root, { onData: (data) => (output += data.toString()), timeout: 60 });
    return { output, exitCode };
  }

  test("MXC itself: with the loopback closed a process cannot reach its own listener (microsoft/mxc#1261)", async () => {
    const closed = await ps("python asyncio_probe.py", false);
    assert.doesNotMatch(
      closed.output,
      /asyncio-ok/,
      "Windows now lets a contained process reach its own loopback: reconsider sandbox.hostLoopback's default (docs/sandboxing.md)",
    );
    assert.match(closed.output, /_fallback_socketpair|accept/, "the hang is socketpair's accept, as measured");
  });

  // openlore: scenario=OnWindowsPythonAsyncioRunsConfined spec=sandbox-runner-bash
  test("OnWindowsPythonAsyncioRunsConfined: asyncio starts in the agent's shell, in seconds", async () => {
    const started = Date.now();
    const result = await ps("python asyncio_probe.py");
    assert.match(result.output, /asyncio-ok/, result.output);
    assert.ok(Date.now() - started < 9_000, `took ${Date.now() - started} ms`);
  });

  // openlore: scenario=OnWindowsTheServerRefusesAConfinedCommand spec=sandbox-runner-bash
  test("OnWindowsTheServerRefusesAConfinedCommand: the server's WebSocket closes 4401 and sends nothing", async () => {
    const result = await ps(`python ws_probe.py ${server.port}`);
    assert.match(result.output, /HTTP\/1\.1 101/, `the command reached the server: ${result.output}`);
    assert.match(result.output, /data-frames 0/);
    assert.match(result.output, /close 4401/);
  });

  // openlore: scenario=AClosedLoopbackKeepsHostServicesOut spec=sandbox-runner-bash
  test("AClosedLoopbackKeepsHostServicesOut: with hostLoopback false a host service is out of reach; open, it is reached", async () => {
    assert.match((await ps(`python connect_probe.py ${hostPort}`, false)).output, /REFUSED/);
    assert.match((await ps(`python connect_probe.py ${hostPort}`)).output, /REACHED.*host-local-service/s);
  });

  // openlore: scenario=GeneratedTokenOutOfTheSandbox spec=auth
  test("GeneratedTokenOutOfTheSandbox: the token is neither in a command's environment nor readable", async () => {
    const env = await ps("Get-ChildItem env: | Format-Table -HideTableHeaders -AutoSize | Out-String -Width 4096");
    assert.ok(env.output.length > 50, `the environment was listed: ${env.output}`);
    assert.ok(!env.output.includes(server.token), "the token is in the command's environment");
    const file = await ps(`Get-Content -Raw "${path.join(serverAgentDir(), "outpost-token")}"`);
    assert.notEqual(file.exitCode, 0, file.output);
    assert.ok(!file.output.includes(server.token), "the token file was read");
  });

  /** One terminal confined as the server confines it, running `line` in cmd; what it printed. */
  async function inTerminal(id: string, line: string, hostLoopback?: boolean): Promise<string> {
    let output = "";
    let exitCode: number | undefined;
    await manager.open(
      socket,
      id,
      root,
      160,
      40,
      (_id, data) => {
        output += data;
      },
      (_id, code) => {
        exitCode = code ?? -1;
      },
      { shell: CMD, shellArgs: [] },
      buildTerminalConfinement({ runner: RUNNER!, root, allowWrite: true, agentDir: serverAgentDir(), ...(hostLoopback === undefined ? {} : { hostLoopback }) }),
    );
    const tag = `M${Math.random().toString(36).slice(2, 8)}`;
    manager.write(socket, id, `${line} & echo ${tag}-E\r`);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (exitCode !== undefined) throw new Error(`the confined shell exited (${exitCode}): ${output}`);
      const seen = output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
      const end = seen.lastIndexOf(`${tag}-E`);
      if (end !== -1 && seen.length > end + tag.length + 2 && seen.indexOf(`${tag}-E`) !== end) return seen;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`no answer to ${line}: ${output}`);
  }

  // openlore: scenario=OnWindowsAsyncioRunsInTheTerminal spec=terminal
  test("OnWindowsAsyncioRunsInTheTerminal: asyncio starts in a confined terminal", async () => {
    assert.match(await inTerminal("open", "python asyncio_probe.py"), /asyncio-ok/);
  });

  // openlore: scenario=OnWindowsAClosedLoopbackAlsoClosesTheTerminal spec=terminal
  test("OnWindowsAClosedLoopbackAlsoClosesTheTerminal: with hostLoopback false a host service is out of reach", async () => {
    const seen = await inTerminal("closed", `python connect_probe.py ${hostPort}`, false);
    assert.match(seen, /REFUSED/);
    assert.doesNotMatch(seen, /host-local-service/);
  });
});
