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
}

export class TerminalManager {
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
  getDefaultShell(options?: { shell?: string; shellArgs?: string[]; gitPath?: string }): { shell: string; args: string[] } {
    if (options?.shell) {
      return {
        shell: options.shell,
        args: options.shellArgs ?? (process.platform === "win32" ? [] : ["-l"]),
      };
    }

    if (process.platform === "win32") {
      const gitBash = findWindowsGitBash(options?.gitPath);
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

      const { shell, args } = this.getDefaultShell(shellOptions);
      const resolvedCwd = path.resolve(cwd);

      const env = {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        NODE_V8_COVERAGE: "",
      };

      ensureSpawnHelperExecutable();

      let ptyProcess: pty.IPty;
      try {
        ptyProcess = pty.spawn(shell, args, {
          name: "xterm-256color",
          cols: Math.max(10, cols),
          rows: Math.max(5, rows),
          cwd: resolvedCwd,
          env,
        });
      } catch (err) {
        ensureSpawnHelperExecutable();
        try {
          ptyProcess = pty.spawn(shell, args, {
            name: "xterm-256color",
            cols: Math.max(10, cols),
            rows: Math.max(5, rows),
            cwd: resolvedCwd,
            env,
          });
        } catch (retryErr) {
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
      };

      userSessions.set(terminalId, session);

      ptyProcess.onData((data: string) => {
        onData(terminalId, data);
      });

      ptyProcess.onExit(({ exitCode }) => {
        // Guard against sequential reopen: only clean up if this session is still the active registered one!
        const currentMap = this.socketSessions.get(socket);
        if (currentMap && currentMap.get(terminalId) === session) {
          currentMap.delete(terminalId);
          if (currentMap.size === 0) {
            this.socketSessions.delete(socket);
          }
        }
        onExit(terminalId, exitCode);
      });

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
    const pid = session.ptyProcess.pid;

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
    try {
      session.ptyProcess.kill();
    } catch {
      // Process might already be dead
    }
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
    for (const session of userSessions.values()) {
      try {
        session.ptyProcess.kill();
      } catch {
        // Ignore
      }
    }
    this.socketSessions.delete(socket);
  }

  /**
   * Close all terminal sessions across all sockets (e.g. on server shutdown).
   */
  closeAll(): void {
    for (const userSessions of this.socketSessions.values()) {
      for (const session of userSessions.values()) {
        try {
          session.ptyProcess.kill();
        } catch {
          // Ignore
        }
      }
    }
    this.socketSessions.clear();
  }
}
