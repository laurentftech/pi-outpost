/**
 * Terminal session manager for pi-outpost.
 *
 * Spawns and manages interactive pseudo-terminals (PTY) via node-pty,
 * piping input/output through the WebSocket protocol.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { createRequire } from "node:module";
import { execFile, spawnSync } from "node:child_process";
import { confinedEnvironment, prepareConfinedTerminal, type MxcTerminalConfig, type RunnerKind, type TerminalPolicy } from "./terminalSandbox.ts";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import type * as pty from "node-pty";
import type { WebSocket } from "ws";

const execFileAsync = promisify(execFile);

let ptyModule: typeof pty | null = null;
let ptyLoadError: Error | null = null;

function ensureSpawnHelperExecutable(): void {
  if (process.platform === "win32") return;
  try {
    const req = createRequire(import.meta.url);
    const ptyPath = req.resolve("node-pty");
    const baseDir = path.dirname(ptyPath);
    const candidates = [
      path.join(baseDir, `../prebuilds/${process.platform}-${process.arch}/spawn-helper`),
      path.join(baseDir, `prebuilds/${process.platform}-${process.arch}/spawn-helper`),
      path.join(baseDir, "../build/Release/spawn-helper"),
      path.join(baseDir, "build/Release/spawn-helper"),
      path.join(baseDir, "../build/Debug/spawn-helper"),
      path.join(baseDir, "build/Debug/spawn-helper"),
    ];
    for (const helper of candidates) {
      if (fsSync.existsSync(helper)) {
        try {
          const stat = fsSync.statSync(helper);
          if ((stat.mode & 0o111) === 0) {
            fsSync.chmodSync(helper, 0o755);
          }
        } catch {
          // Best effort
        }
      }
    }
  } catch {
    // node-pty might not be resolvable (e.g. bundled)
  }
}

/**
 * Whether the optional PTY binding can be loaded in this installation.
 *
 * `doctor` asks this rather than importing `node-pty` itself, so what it reports is
 * the same load the terminal actually performs — helper permissions included. A
 * separate `import()` there would succeed in cases this one fails.
 */
export async function probePty(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getPty();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getPty(): Promise<typeof pty> {
  if (ptyModule) return ptyModule;
  if (ptyLoadError) throw ptyLoadError;
  try {
    ensureSpawnHelperExecutable();
    const mod = await import("node-pty");
    ptyModule = ((mod as any).default || mod) as typeof pty;
    return ptyModule;
  } catch (err) {
    ptyLoadError = err instanceof Error ? err : new Error(String(err));
    throw ptyLoadError;
  }
}

function answersAsBash(candidate: string): boolean {
  try {
    const res = spawnSync(candidate, ["--version"], {
      timeout: 3000,
      encoding: "utf8",
      env: { ...process.env, NODE_V8_COVERAGE: "" },
      windowsHide: true,
    });
    return !res.error && typeof res.stdout === "string" && /GNU bash/i.test(res.stdout);
  } catch {
    return false;
  }
}

const gitBashCache = new Map<string, string | undefined>();

export function resetGitBashCache(): void {
  gitBashCache.clear();
}

export function findWindowsGitBash(configuredGitPath?: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  const cacheKey = configuredGitPath ?? "";
  if (gitBashCache.has(cacheKey)) {
    return gitBashCache.get(cacheKey);
  }

  const candidates: string[] = [];

  if (configuredGitPath) {
    const gitDir = path.dirname(configuredGitPath);
    candidates.push(
      path.join(gitDir, "..", "bin", "bash.exe"),
      path.join(gitDir, "..", "usr", "bin", "bash.exe"),
      path.join(gitDir, "bash.exe"),
      path.join(configuredGitPath, "bin", "bash.exe"),
      path.join(configuredGitPath, "usr", "bin", "bash.exe"),
    );
  }

  const env = (name: string) => process.env[name];
  const bases = [env("ProgramFiles"), env("ProgramW6432"), env("ProgramFiles(x86)")].filter(
    (b): b is string => !!b,
  );
  if (env("LOCALAPPDATA")) {
    bases.push(path.join(env("LOCALAPPDATA")!, "Programs"));
  }
  for (const base of bases) {
    candidates.push(
      path.join(base, "Git", "bin", "bash.exe"),
      path.join(base, "Git", "usr", "bin", "bash.exe"),
    );
  }
  candidates.push("bash.exe");

  let result: string | undefined;
  for (const candidate of candidates) {
    if (candidate === "bash.exe" || fsSync.existsSync(candidate)) {
      if (answersAsBash(candidate)) {
        result = candidate;
        break;
      }
    }
  }
  gitBashCache.set(cacheKey, result);
  return result;
}

export interface TerminalSession {
  terminalId: string;
  ptyProcess: pty.IPty;
  socket: WebSocket;
  cwd: string;
  /**
   * The `onData` and `onExit` subscriptions, so closing can take them off.
   *
   * `kill()` only *starts* a shutdown — on Windows ConPTY it drains for a while
   * afterwards, with a helper process of its own. A listener still attached is a
   * listener still calling back, into a socket the caller has by then given up on:
   * that is `write EAGAIN`, and, in a test, "asynchronous activity after the test
   * ended". Detaching first makes the shutdown silent, whatever it takes.
   */
  listeners: pty.IDisposable[];
  /**
   * Set when the shell runs inside a sandbox runner. The runner stays alive as the
   * shell's supervisor, so the pty's pid is the runner's, not the shell's: what the
   * user's shell is doing has to be read from the runner's child.
   */
  confined?: boolean;
  /** Removes the confined terminal's private directory (its temp files and policy). */
  dispose?: () => Promise<void>;
}

/**
 * Detach, then kill — in that order, and never the other way.
 *
 * A killed pty goes on producing for a while: ConPTY drains asynchronously and keeps a
 * helper process alive to do it. Killing first and detaching later leaves a window in
 * which `onData` fires into a socket nobody is reading, which surfaces as `write EAGAIN`
 * and, under `node:test`, as activity outliving the test that started it.
 */
function endSession(session: TerminalSession): void {
  for (const listener of session.listeners.splice(0)) {
    try {
      listener.dispose();
    } catch {
      // A subscription the pty has already torn down on its own side.
    }
  }
  try {
    session.ptyProcess.kill();
  } catch {
    // Process might already be dead
  }
  killIfStillAlive(session.ptyProcess);
  void session.dispose?.().catch(() => {});
}

/** How long a shell gets to act on SIGHUP before it is killed outright. */
export const TERMINAL_KILL_GRACE_MS = 2_000;

/**
 * Make sure a closed terminal's shell is really gone.
 *
 * `kill()` sends SIGHUP, which a shell may ignore — `trap '' HUP`, a `nohup` wrapper,
 * or one caught while it is still starting. A survivor keeps the pty open, and the
 * process that spawned it can never exit: the suspected cause of the CI check job that
 * hangs after `terminalManager.test.ts` with an orphaned `bash` left behind. So after a
 * grace period, a process that still answers is sent SIGKILL.
 *
 * By polling the pid rather than adding an `onExit` listener: closing detaches every
 * listener on purpose (see `TerminalSession.listeners`), and this must not undo that.
 * The timer is unref'd, so it never holds a process open either. Not on Windows, where
 * ConPTY takes no signals and ends its own helper.
 */
function killIfStillAlive(ptyProcess: pty.IPty): void {
  if (process.platform === "win32") return;
  const pid = ptyProcess.pid;
  if (!(pid > 0)) return;
  const timer = setTimeout(() => {
    try {
      process.kill(pid, 0);
    } catch {
      return; // Gone, as it should be.
    }
    try {
      ptyProcess.kill("SIGKILL");
    } catch {
      // Exited between the probe and the kill.
    }
  }, TERMINAL_KILL_GRACE_MS);
  timer.unref?.();
}

/**
 * Swap the pty implementation, for tests that have no business spawning a shell.
 *
 * `node-pty` is an optional dependency carrying a native build, so a checkout that
 * skipped its install script has no terminal tests at all — and the ones that do run
 * spawn real shells whose teardown is exactly the thing being tested. Pass `null` to
 * restore the real module.
 */
export function setPtyModuleForTesting(module: typeof pty | null): void {
  ptyModule = module;
  ptyLoadError = null;
}

/**
 * A terminal's environment: the server's, with a terminal's own settings, and the
 * overrides that put back what the user started the server with (undefined removes).
 */
export function terminalEnvironment(
  serverEnv: NodeJS.ProcessEnv,
  overrides: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...serverEnv,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    NODE_V8_COVERAGE: "",
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

export class TerminalManager {
  /**
   * @param envOverrides Variables a terminal gets instead of the server's own — undefined
   * removes one. The terminal is the user's shell, not the agent's: what the server
   * set for its extensions (PI_CODING_AGENT_DIR) is put back as the user started it.
   */
  constructor(private readonly envOverrides: Record<string, string | undefined> = {}) {}

  /**
   * Sessions keyed by WebSocket connection, mapping terminalId -> TerminalSession.
   * Ensures absolute isolation across multiple connected clients.
   */
  private socketSessions = new Map<WebSocket, Map<string, TerminalSession>>();

  /**
   * In-flight opens serialized per (socket, terminalId) to avoid race conditions.
   */
  private inFlightOpens = new Map<WebSocket, Map<string, Promise<TerminalSession>>>();

  /**
   * Check if PTY support is available on this host.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await getPty();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Determine the default shell for the host platform.
   * On Windows: Git Bash -> PowerShell -> cmd.
   * On Unix: $SHELL (or /bin/zsh on macOS, /bin/bash on Linux) with login shell args ["-l"].
   */
  getDefaultShell(options?: { shell?: string; shellArgs?: string[]; gitPath?: string; confined?: boolean }): { shell: string; args: string[] } {
    if (options?.shell) {
      return {
        shell: options.shell,
        args: options.shellArgs ?? (process.platform === "win32" ? [] : ["-l"]),
      };
    }

    if (process.platform === "win32") {
      // Git Bash cannot start inside the sandbox runner's AppContainer: MSYS2 creates
      // global named objects (\\BaseNamedObjects) a container may not. PowerShell can.
      const gitBash = options?.confined ? undefined : findWindowsGitBash(options?.gitPath);
      if (gitBash) {
        return { shell: gitBash, args: ["-l"] };
      }

      // 2. PowerShell: check standard Windows installation
      const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
      const powershellPath = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (fsSync.existsSync(powershellPath)) {
        return { shell: powershellPath, args: [] };
      }

      // 3. cmd as last resort
      const comspec = process.env.COMSPEC || path.join(systemRoot, "System32", "cmd.exe");
      return { shell: comspec, args: [] };
    }

    const shell = process.env.SHELL || (os.platform() === "darwin" ? "/bin/zsh" : "/bin/bash");
    // Login shell on Unix to source .zprofile / .bash_profile
    return { shell, args: ["-l"] };
  }

  /**
   * Open a new interactive terminal session for a specific socket.
   */
  async open(
    socket: WebSocket,
    terminalId: string,
    cwd: string,
    cols = 80,
    rows = 24,
    onData: (terminalId: string, data: string) => void,
    onExit: (terminalId: string, exitCode?: number) => void,
    shellOptions?: { shell?: string; shellArgs?: string[]; gitPath?: string },
    confine?: TerminalConfinement,
  ): Promise<TerminalSession> {
    let socketInFlight = this.inFlightOpens.get(socket);
    if (!socketInFlight) {
      socketInFlight = new Map();
      this.inFlightOpens.set(socket, socketInFlight);
    }

    // If an open for the exact same socket + terminalId is already pending, wait for it first
    const pending = socketInFlight.get(terminalId);
    if (pending) {
      try {
        await pending;
      } catch {
        // Ignore previous failure
      }
    }

    const openPromise = (async () => {
      const pty = await getPty();

      // If an existing session with this ID exists for this socket, close it first
      if (this.socketSessions.get(socket)?.has(terminalId)) {
        this.close(socket, terminalId);
      }

      let userSessions = this.socketSessions.get(socket);
      if (!userSessions) {
        userSessions = new Map();
        this.socketSessions.set(socket, userSessions);
      }

      const { shell, args: shellArgs } = this.getDefaultShell({ ...shellOptions, confined: confine !== undefined });
      let resolvedCwd = path.resolve(cwd);
      let file = shell;
      let args = shellArgs;
      let env: NodeJS.ProcessEnv = terminalEnvironment(process.env, this.envOverrides);
      let files: Awaited<ReturnType<typeof prepareConfinedTerminal>> | undefined;
      if (confine) {
        // The runner, not the shell, is what the pty spawns; the shell runs inside it
        // with a policy written for this terminal alone and an environment built from
        // nothing, so no key the server holds reaches it.
        // A starting directory outside the root could not be entered from inside.
        if (!isInside(resolvedCwd, confine.root)) resolvedCwd = confine.root;
        const startIn = resolvedCwd;
        let shellEnv: Record<string, string> = {};
        files = await prepareConfinedTerminal((tmp) => {
          shellEnv = confinedEnvironment(process.env, { root: confine.root, tmp, shell });
          return confine.policy({ tmp, shell, shellArgs, cwd: startIn, env: shellEnv });
        });
        file = confine.runner;
        // MXC's request carries the command line and the environment itself: its
        // executor hands the child none of its own.
        args = confine.kind === "mxc" ? [files.policyFile] : ["run", "-p", files.policyFile, "--", shell, ...shellArgs];
        env = shellEnv;
      }

      ensureSpawnHelperExecutable();

      let ptyProcess: pty.IPty;
      try {
        ptyProcess = pty.spawn(file, args, {
          name: "xterm-256color",
          cols: Math.max(10, cols),
          rows: Math.max(5, rows),
          cwd: resolvedCwd,
          env,
        });
      } catch (err) {
        ensureSpawnHelperExecutable();
        try {
          ptyProcess = pty.spawn(file, args, {
            name: "xterm-256color",
            cols: Math.max(10, cols),
            rows: Math.max(5, rows),
            cwd: resolvedCwd,
            env,
          });
        } catch (retryErr) {
          void files?.dispose().catch(() => {});
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          if (msg.includes("posix_spawnp")) {
            throw new Error(
              `posix_spawnp failed: node-pty spawn-helper binary is missing execute permissions. Run "npm install-scripts approve node-pty" or "chmod +x node_modules/node-pty/prebuilds/.../spawn-helper".`,
            );
          }
          throw retryErr;
        }
      }

      const session: TerminalSession = {
        terminalId,
        ptyProcess,
        socket,
        cwd: resolvedCwd,
        listeners: [],
        ...(files ? { confined: true, dispose: files.dispose } : {}),
      };

      userSessions.set(terminalId, session);

      session.listeners.push(ptyProcess.onData((data: string) => {
        onData(terminalId, data);
      }));

      session.listeners.push(ptyProcess.onExit(({ exitCode }) => {
        // Guard against sequential reopen: only clean up if this session is still the active registered one!
        const currentMap = this.socketSessions.get(socket);
        if (currentMap && currentMap.get(terminalId) === session) {
          currentMap.delete(terminalId);
          if (currentMap.size === 0) {
            this.socketSessions.delete(socket);
          }
        }
        void session.dispose?.().catch(() => {});
        onExit(terminalId, exitCode);
      }));

      return session;
    })();

    socketInFlight.set(terminalId, openPromise);

    try {
      return await openPromise;
    } finally {
      socketInFlight.delete(terminalId);
      if (socketInFlight.size === 0) {
        this.inFlightOpens.delete(socket);
      }
    }
  }

  /**
   * Send input characters / keystrokes to a terminal owned by this socket.
   */
  write(socket: WebSocket, terminalId: string, data: string): boolean {
    const session = this.socketSessions.get(socket)?.get(terminalId);
    if (!session) return false;
    session.ptyProcess.write(data);
    return true;
  }

  /**
   * Resize a terminal session owned by this socket (SIGWINCH).
   */
  resize(socket: WebSocket, terminalId: string, cols: number, rows: number): boolean {
    const session = this.socketSessions.get(socket)?.get(terminalId);
    if (!session) return false;
    const safeCols = Math.max(10, cols);
    const safeRows = Math.max(5, rows);
    try {
      session.ptyProcess.resize(safeCols, safeRows);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Query the current working directory of a terminal process owned by this socket.
   */
  async getCwd(socket: WebSocket, terminalId: string): Promise<string | undefined> {
    const session = this.socketSessions.get(socket)?.get(terminalId);
    if (!session) return undefined;
    const pid = session.confined ? ((await childOf(session.ptyProcess.pid)) ?? session.ptyProcess.pid) : session.ptyProcess.pid;

    if (process.platform === "linux") {
      try {
        const link = await fs.readlink(`/proc/${pid}/cwd`);
        return link;
      } catch {
        return session.cwd;
      }
    }

    if (process.platform === "darwin") {
      try {
        const { stdout } = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
        const match = stdout.split("\n").find((line) => line.startsWith("n"));
        if (match) {
          return match.slice(1);
        }
      } catch {
        return session.cwd;
      }
    }

    return session.cwd;
  }

  /**
   * Close a specific terminal session owned by this socket.
   */
  close(socket: WebSocket, terminalId: string): boolean {
    const userSessions = this.socketSessions.get(socket);
    if (!userSessions) return false;
    const session = userSessions.get(terminalId);
    if (!session) return false;
    endSession(session);
    userSessions.delete(terminalId);
    if (userSessions.size === 0) {
      this.socketSessions.delete(socket);
    }
    return true;
  }

  /**
   * Clean up all terminal sessions associated with a disconnected socket.
   */
  closeAllForSocket(socket: WebSocket): void {
    const userSessions = this.socketSessions.get(socket);
    if (!userSessions) return;
    for (const session of userSessions.values()) endSession(session);
    this.socketSessions.delete(socket);
  }

  /**
   * Close all terminal sessions across all sockets (e.g. on server shutdown).
   */
  closeAll(): void {
    for (const userSessions of this.socketSessions.values()) {
      for (const session of userSessions.values()) endSession(session);
    }
    this.socketSessions.clear();
  }
}

/** How a terminal is confined: the runner to spawn, and what its policy allows. */
export interface TerminalConfinement {
  /** The sandbox runner: landstrip's binary, or MXC's executor (`wxc-exec.exe`). */
  runner: string;
  /** Which one: they take their policy, and the shell, differently. Default: landstrip. */
  kind?: RunnerKind;
  /** The root the shell starts in and calls home. */
  root: string;
  /** The policy for this terminal, given its private temporary directory and what it runs. */
  policy: (terminal: ConfinedShell) => TerminalPolicy | MxcTerminalConfig;
}

/** What a confined terminal runs, for a policy that has to carry it (MXC's). */
export interface ConfinedShell {
  tmp: string;
  shell: string;
  shellArgs: string[];
  cwd: string;
  env: Record<string, string>;
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The first child of a process, on Linux: a sandbox runner's shell.
 *
 * `/proc/<pid>/task/<pid>/children` when the kernel exposes it, else a scan of
 * `/proc/<n>/stat` for the parent pid. Undefined anywhere else, or once it is gone.
 */
async function childOf(pid: number): Promise<number | undefined> {
  if (process.platform !== "linux") return undefined;
  try {
    const listed = (await fs.readFile(`/proc/${pid}/task/${pid}/children`, "utf8")).trim().split(/\s+/)[0];
    if (listed) return Number(listed);
  } catch {
    // Not exposed by this kernel: fall back to the scan.
  }
  try {
    for (const entry of await fs.readdir("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const stat = await fs.readFile(`/proc/${entry}/stat`, "utf8").catch(() => "");
      // The command name sits in parentheses and may hold spaces: read after the last ")".
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (ppid === pid) return Number(entry);
    }
  } catch {
    // /proc unreadable: the caller falls back to the runner's own pid.
  }
  return undefined;
}
