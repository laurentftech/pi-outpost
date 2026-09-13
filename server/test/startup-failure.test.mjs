/**
 * A port already taken, at the wire.
 *
 * The unit tests beside this one prove the message and the decision. This is the
 * half that lives at the call site: that `listen` is actually guarded, that the
 * failure goes through the file's own reporting rather than an unhandled rejection,
 * and that what reaches the operator is one line and not a trace. A regression that
 * removed the guard would leave every unit test green.
 *
 * The port is bound at 0 and read back, never a fixed number: a test that hard-codes
 * 3141 fails on the machine of anyone who has the interface open, which is everyone
 * working on this.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { makeWorkspace, startServer } from "./harness.mjs";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SERVER_DIR, "src", "index.ts");

/** A listening socket, and the port it took. Kept open so the server cannot have it. */
async function occupyAPort() {
  const holder = net.createServer();
  await new Promise((resolve, reject) => {
    holder.once("error", reject);
    holder.listen(0, "127.0.0.1", resolve);
  });
  return { port: holder.address().port, release: () => new Promise((r) => holder.close(r)) };
}

/** Start a server that is expected to fail, and collect everything it said. */
async function startAndWaitForExit(root, port) {
  const configPath = path.join(root, "pi-outpost.test.json");
  await writeFile(
    configPath,
    JSON.stringify({
      cwd: root,
      agentDir: path.join(root, ".pi-agent"),
      noSkills: true,
      noPromptTemplates: true,
      webContext: false,
      openBrowser: false,
      server: { host: "127.0.0.1", port },
    }),
  );
  // Blanked, not deleted: node's child_process puts a deleted NODE_V8_COVERAGE back.
  const env = { ...process.env, PI_OUTPOST_CONFIG: configPath, PI_OFFLINE: "1", NODE_V8_COVERAGE: "" };
  const child = spawn(process.execPath, ["--import=tsx/esm", ENTRY], {
    cwd: SERVER_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  return { code, stdout, stderr };
}

// openlore: {"domain":"cli","requirement":"AFailureToStartIsSaidOutLoud","scenario":"ThePortIsAlreadyTaken","specFile":"openspec/changes/say-why-the-server-could-not-start/specs/cli/spec.md"}
describe("a port that is already taken", () => {
  test("exits non-zero with one readable line and no stack trace", async () => {
    const held = await occupyAPort();
    const root = await makeWorkspace();
    try {
      const { code, stderr } = await startAndWaitForExit(root, held.port);

      assert.notEqual(code, 0, "a server that never listened must not report success");
      assert.match(stderr, new RegExp(`127\\.0\\.0\\.1:${held.port}`), "the address refused is named");
      assert.match(stderr, /already in use/);
      assert.match(stderr, /--port/, "the way out is named");

      // The point of the change: what an operator gets is a sentence, not a trace.
      assert.doesNotMatch(stderr, /^\s+at /m, "no stack frames");
      assert.doesNotMatch(stderr, /EADDRINUSE\b[\s\S]*\n\s+at /, "no rethrown listen error");
      assert.doesNotMatch(stderr, /unhandled|UnhandledPromiseRejection/i);
      // One line about the failure, and nothing waiting to be dismissed: this is a
      // shell, and a shell's console outlives the process that printed into it.
      assert.doesNotMatch(stderr, /press any key/);
      const complaints = stderr.split(/\r?\n/).filter((line) => line.includes("cannot start"));
      assert.equal(complaints.length, 1, `expected one line, got:\n${stderr}`);
    } finally {
      await held.release();
    }
  });
});

// openlore: {"domain":"cli","requirement":"AFailureToStartIsSaidOutLoud","scenario":"NobodyElseIsMadeToWait","specFile":"openspec/changes/say-why-the-server-could-not-start/specs/cli/spec.md"}
describe("a start that fails before it ever reaches listen", () => {
  test("no configuration file: one readable line, no stack, and nothing to dismiss from a shell", async () => {
    // A launch directory with no pi-outpost.config.json, and an XDG dir with no
    // fallback config either — so the only outcome is NoConfigError, which used to
    // exit straight away and, on a double-click, take its window with it.
    const emptyLaunchDir = await mkdtemp(path.join(tmpdir(), "pi-outpost-noconfig-"));
    const emptyXdg = await mkdtemp(path.join(tmpdir(), "pi-outpost-xdg-"));
    // cwd stays SERVER_DIR so `tsx` resolves; LAUNCH_DIR is INIT_CWD, and that is
    // the directory findConfigFile() actually searches.
    const env = { ...process.env, INIT_CWD: emptyLaunchDir, XDG_CONFIG_HOME: emptyXdg, PI_OFFLINE: "1" };
    delete env.PI_OUTPOST_CONFIG;
    delete env.PI_OUTPOST_PROFILE;
    // Blanked, not deleted: node's child_process puts a deleted NODE_V8_COVERAGE back.
    env.NODE_V8_COVERAGE = "";

    const child = spawn(process.execPath, ["--import=tsx/esm", ENTRY], {
      cwd: SERVER_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    // A hang here is the failure: run from a test runner, the parent is not a file
    // manager, so holdConsoleIfOwned() must fall straight through and let it exit.
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`did not exit; stderr so far:\n${stderr}`)), 20_000);
      child.once("exit", (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });

    assert.notEqual(code, 0, "a server with no configuration must not report success");
    assert.match(stderr, /no configuration file found/, "the reason is named");
    assert.match(stderr, /pi-outpost init|--config/, "the way forward is named");
    assert.doesNotMatch(stderr, /^\s+at /m, "no stack frames");
    assert.doesNotMatch(stderr, /unhandled|UnhandledPromiseRejection/i);
    assert.doesNotMatch(stderr, /press any key/, "a shell is not made to wait");
    assert.equal(stdout.includes("[server]"), false, "it never got as far as serving");
  });
});

// openlore: {"domain":"cli","requirement":"AFailureToStartIsSaidOutLoud","scenario":"AServerThatStartsIsUnchanged","specFile":"openspec/changes/say-why-the-server-could-not-start/specs/cli/spec.md"}
describe("a server that binds", () => {
  test("says what it always said, waits for nothing, and serves", async () => {
    const root = await makeWorkspace();
    const server = await startServer(root);
    try {
      // Serving: the harness only resolves once /health answered, so reaching here
      // already proves the process did not stop to be dismissed.
      const health = await fetch(`${server.base}/health`);
      assert.equal(health.ok, true);

      const log = server.log();
      assert.match(log, new RegExp(`\\[server\\] http://127\\.0\\.0\\.1:${server.port}/`), "the address is printed as before");
      assert.doesNotMatch(log, /press any key/, "nothing to dismiss on a successful start");
      assert.doesNotMatch(log, /cannot start/);
    } finally {
      await server.stop();
    }
  });
});
