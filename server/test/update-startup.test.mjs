/**
 * The two properties of the startup update check that only exist at process level.
 *
 * Everything else about the notice is a pure decision, unit-tested next door. These
 * two are not decisions — they are consequences of how the check is scheduled, and
 * both fail silently in the one situation nobody reproduces by hand: a registry that
 * accepts the connection and then says nothing at all.
 *
 * That registry is a real socket here, not an unroutable address. The obvious choice
 * is a reserved one like 192.0.2.1, and it is wrong: on a host with no route to it
 * the connection is refused in about 150 ms, so nothing is ever pending and both
 * tests pass whatever the code does. A listener that accepts and never replies hangs
 * for the full timeout, on every machine, which is the only version of this that can
 * fail.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import { startServer } from "./harness.mjs";

const SERVER_SRC = fileURLToPath(new URL("../src", import.meta.url));

/**
 * The parent's environment with the coverage sink blanked. Blanked, not removed: node's
 * child_process puts a removed NODE_V8_COVERAGE straight back (see childEnv.mjs).
 */
function envWithoutCoverageSink() {
  return { ...process.env, NODE_V8_COVERAGE: "" };
}

/**
 * A registry that accepts and never answers, for the duration of one test.
 *
 * Per test, and torn down by the test that made it — not a module-level listener with
 * an `after` hook. That version hung the whole run on Linux: both tests passed, the
 * file's process then never exited, and a file that never exits never reports, so the
 * output simply stopped with no failure to point at.
 *
 * Two things make this one safe. Everything it owns is unref'd, so the fixture cannot
 * keep the process alive. And `close` is never awaited — it settles only once every
 * connection has ended, and a socket whose peer was killed mid-request may never
 * deliver that.
 */
async function withBlackHole(body) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    socket.unref();
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await body(url);
  } finally {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    server.close();
  }
}

// openlore: {"domain":"update","requirement":"StartupNoticeIsNonBlocking","scenario":"StartupIsNotDelayedByTheCheck","specFile":"openspec/changes/add-cli-update-command/specs/update/spec.md"}
describe("a registry that never answers", () => {
  test("does not delay the server accepting connections", async () => {
    await withBlackHole(async (BLACK_HOLE) => {
      const root = await mkdtemp(
        path.join(tmpdir(), "pi-outpost-update-startup-"),
      );
      let server;
      try {
        const began = Date.now();
        server = await startServer(root, {
          updateCheck: true,
          updateRegistry: BLACK_HOLE,
        });
        // startServer resolves on the first /health answer, so this interval contains
        // the whole startup. The registry timeout is 10s; anything near it means the
        // check was awaited somewhere on the startup path.
        const elapsed = Date.now() - began;
        assert.ok(
          elapsed < 10_000,
          `startup took ${elapsed} ms with an unresponsive registry`,
        );

        const health = await fetch(`${server.base}/health`);
        assert.equal(health.status, 200);
      } finally {
        if (server) await server.stop();
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});

// openlore: {"domain":"update","requirement":"StartupNoticeIsNonBlocking","scenario":"PendingCheckDoesNotHoldTheProcessOpen","specFile":"openspec/changes/add-cli-update-command/specs/update/spec.md"}
describe("a check still in flight", () => {
  test("does not keep the process alive", async () => {
    // Not the server: it holds a listening socket open by design, so it could never
    // show this either way. A process whose *only* pending work is the check exits
    // immediately when that work cannot hold the loop, and waits out the full
    // registry timeout when it can — which is the regression this guards.
    //
    // The module is named as a file:// URL, not a path. A Windows path is not a valid
    // ESM specifier — `D:\a\...` fails to resolve — so the child exited 1 in under
    // 200 ms and the timing assertion below happily agreed the process had not lingered.
    await withBlackHole(async (BLACK_HOLE) => {
      const agentDir = await mkdtemp(path.join(tmpdir(), "pi-outpost-unref-"));
      const script = `
      import { runStartupUpdateNotice } from ${JSON.stringify(pathToFileURL(path.join(SERVER_SRC, "update.ts")).href)};
      void runStartupUpdateNotice({
        version: "0.8.0",
        agentDir: ${JSON.stringify(agentDir)},
        settings: { updateCheck: true },
        channel: "global",
        registry: ${JSON.stringify(BLACK_HOLE)},
        log: () => {},
      });
    `;

      const began = Date.now();
      try {
        const code = await new Promise((resolve, reject) => {
          const child = execFile(
            process.execPath,
            ["--import", "tsx/esm", "--input-type=module", "--eval", script],
            // NODE_V8_COVERAGE dropped for the reason harness.mjs drops it: a child
            // that inherits it writes a coverage file the parent's reporter then has
            // to parse, and a child killed partway through writing one fails the job
            // with every test passing. This file is not in the coverage glob today;
            // the guard is here so that stops being load-bearing.
            { cwd: path.dirname(SERVER_SRC), timeout: 9_000, env: envWithoutCoverageSink() },
            (error) => {
              if (error && error.killed)
                reject(
                  new Error(
                    "the process was still alive with a check in flight",
                  ),
                );
              else resolve(error?.code ?? 0);
            },
          );
          child.on("error", reject);
        });

        const elapsed = Date.now() - began;
        // Checked before the timing, and with the child's own output when it fails: a
        // process that died on its own error also "did not linger", so the exit code is
        // what separates the property under test from a broken fixture.
        assert.equal(code, 0, `the probe process exited ${code}`);
        // Generous, because it starts a runtime and a TypeScript loader. What it has
        // to separate from is a full 10s registry timeout.
        assert.ok(
          elapsed < 8_000,
          `the process lingered ${elapsed} ms for a pending check`,
        );
      } finally {
        await rm(agentDir, { recursive: true, force: true });
      }
    });
  });
});
