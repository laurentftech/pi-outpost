/**
 * Integration-test harness: boots a real server against a throwaway workspace and
 * talks to it over HTTP/WebSocket, the way a browser would. No mocks — the point
 * of these tests is the wiring (confinement, auth, session bookkeeping) that unit
 * tests of the pure functions cannot see.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SERVER_DIR, "src", "index.ts");
// The binary itself, not `npx tsx`: one less process between us and the server, and
// one less wrapper that swallows the signal meant for it.
const TSX = path.join(SERVER_DIR, "..", "node_modules", ".bin", "tsx");

/** Ports are per-suite so suites can run in parallel without colliding with a dev server. */
let nextPort = 3400 + Math.floor(Math.random() * 200);
export function freePort() {
  return nextPort++;
}

/**
 * Workspace the server is confined to. `files` maps relative paths to string or
 * Buffer content; parent directories are created as needed.
 */
export async function makeWorkspace(files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

/**
 * Start a server on `config.server.port` with the given config (paths already
 * absolute). Resolves once /health answers. Always `await server.stop()`.
 */
export async function startServer(root, config = {}) {
  const port = config.server?.port ?? freePort();
  const full = {
    cwd: root,
    // Sessions, settings and extensions live inside the throwaway workspace: without
    // this the agent would load the *developer's* ~/.pi/agent — their extensions can
    // pop dialogs and stall session creation, and tests would write to real sessions.
    agentDir: path.join(root, ".pi-agent"),
    sandbox: { root, allowWrite: true, writableRoot: root, allowBash: false },
    noSkills: true,
    noPromptTemplates: true,
    webContext: false,
    ...config,
    server: { host: "127.0.0.1", ...config.server, port },
  };
  const configPath = path.join(root, "pi-outpost.test.json");
  await writeFile(configPath, JSON.stringify(full, null, 2));

  // `detached` gives the server its own process group, so stop() can take the whole
  // thing down. Without it, killing the child leaves the real node process alive,
  // still holding this file's stdout pipe — the test file then never exits, and the
  // CI job hangs until it is cancelled. (macOS happened to reap it; Linux does not.)
  const child = spawn(TSX, [ENTRY], {
    cwd: SERVER_DIR,
    env: { ...process.env, PI_OUTPOST_CONFIG: configPath },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}):\n${log}`);
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    port,
    base,
    root,
    wsUrl: (token) => `ws://127.0.0.1:${port}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    log: () => log,
    async stop() {
      // Signal the *group* (negative pid): tsx does not forward signals to the node
      // process it spawns, so killing the child alone would orphan the server.
      const killGroup = (signal) => {
        try {
          process.kill(-child.pid, signal);
        } catch {
          // already gone
        }
      };
      killGroup("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      killGroup("SIGKILL");
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Connect and collect server messages; `waitFor` resolves on the first matching one. */
export function connect(url) {
  const ws = new WebSocket(url);
  const received = [];
  const waiters = [];
  let closeInfo = null;

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    received.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.matches(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  ws.on("close", (code) => {
    closeInfo = { code };
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`socket closed (${code})`));
  });

  return {
    ws,
    received,
    closed: () => closeInfo,
    send: (message) => ws.send(JSON.stringify(message)),
    /** First message matching `match` (a type string or predicate), or reject on timeout. */
    waitFor(match, timeoutMs = 60_000) {
      const predicate = typeof match === "string" ? (m) => m.type === match : match;
      const existing = received.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { matches: predicate, resolve, reject };
        waiters.push(waiter);
        setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error(`timed out waiting for ${typeof match === "string" ? match : "predicate"}`));
          }
        }, timeoutMs);
      });
    },
    /** Resolves with the close code (never rejects) — for auth rejection tests. */
    waitForClose(timeoutMs = 10_000) {
      if (closeInfo) return Promise.resolve(closeInfo.code);
      return new Promise((resolve, reject) => {
        ws.on("close", (code) => resolve(code));
        setTimeout(() => reject(new Error("socket did not close")), timeoutMs);
      });
    },
    open() {
      if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
      return new Promise((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
      });
    },
    close: () => ws.close(),
  };
}

/** A 4×4 PNG — enough to exercise the image content-type path. */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAB9BqOAAAAF0lEQVR4nGP8z8DAwMDAxMDAwMDAwAAABgwBAdN7CzsAAAAASUVORK5CYII=",
  "base64",
);
