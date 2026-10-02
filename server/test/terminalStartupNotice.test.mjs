/**
 * A terminal enabled in the configuration that cannot run on this machine is said at
 * startup, in the console, rather than first discovered as a button that fails.
 */
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { makeWorkspace, startServer } from "./harness.mjs";

const NO_NODE_PTY = pathToFileURL(fileURLToPath(new URL("./fixtures/no-node-pty.mjs", import.meta.url))).href;

async function logAfterStart(config, env = {}) {
  const root = await makeWorkspace();
  const server = await startServer(root, config, { env });
  try {
    // The probe runs after the address line, unawaited: give it the moment it needs.
    const deadline = Date.now() + 10_000;
    while (!/\[terminal\]/.test(server.log()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    return server.log();
  } finally {
    await server.stop();
  }
}

test("a terminal enabled without node-pty is announced at startup, with the remedy", async () => {
  const log = await logAfterStart({ terminal: { enabled: true } }, { NODE_OPTIONS: `--import ${NO_NODE_PTY}` });
  assert.match(log, /\[terminal\] enabled in the configuration, but node-pty could not be loaded/);
  assert.match(log, /Cannot find module 'node-pty'/);
  assert.match(log, /pi-outpost doctor/);
});

test("nothing is said when the terminal is off, even without node-pty", async () => {
  const log = await logAfterStart({}, { NODE_OPTIONS: `--import ${NO_NODE_PTY}` });
  assert.doesNotMatch(log, /\[terminal\]/);
});

test("nothing is said when node-pty loads", async () => {
  const log = await logAfterStart({ terminal: { enabled: true } });
  assert.doesNotMatch(log, /\[terminal\]/);
});
