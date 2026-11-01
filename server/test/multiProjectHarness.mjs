/**
 * What both multi-project suites need: a scriptable RPC server, a second project,
 * and the session seeding that makes one project's history distinguishable from
 * another's.
 *
 * Extracted when the single file crossed the per-file test timeout on a loaded
 * runner — 26 tests, each starting a real server. Two files get two budgets, and
 * the runner executes them in parallel, so the wall clock falls as well.
 */
import assert from "node:assert/strict";
import { readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

/**
 * Seed a saved session for one project in the store the server reads.
 *
 * Both projects' sessions live in the SAME store — the server's agent directory —
 * and are told apart by the cwd recorded in them. That is precisely what makes
 * the scoping worth testing: the filter is the only thing keeping one project's
 * conversations out of another's list.
 */
export function seedSession(cwd, sessionsDir, exchanges) {
  const manager = SessionManager.create(cwd, sessionsDir);
  for (const [role, text] of exchanges) manager.appendMessage({ role, content: [{ type: "text", text }] });
  return manager.getSessionFile();
}

/** Where the harness puts the agent directory: sessions for every project land here. */
export const sessionsDirOf = (serverRoot) => path.join(serverRoot, ".pi-agent", "sessions");

/** A scriptable stand-in for `pi --mode rpc`, so a turn can actually stream here. */
export const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

/**
 * A server whose workspaces each run a scripted agent.
 *
 * One script serves both children — which is what the isolation tests need:
 * the two projects behave identically, so anything that tells them apart is the
 * routing under test rather than the fixture.
 */
export async function startScriptedServer(root, openProjects, script, extraConfig = {}) {
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(fakeConfig, JSON.stringify(script));
  return startServer(
    root,
    {
      openProjects,
      ...extraConfig,
      // A sandbox cannot be enforced on a child that builds its own tools, so the
      // pairing is refused at config load — see config.ts. Each workspace is still
      // rooted at its own directory, which is what the browser confinement below
      // actually rides on.
      sandbox: false,
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 10_000 },
    },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
}

/**
 * The NEXT frame of a type, not the first one already received.
 *
 * `waitFor` scans what has arrived as well as what is coming, so asking for
 * `sessions` twice hands back the first answer both times — which quietly turns
 * a scoping assertion into a re-read of the listing it was meant to contrast with.
 */
export function next(client, predicate) {
  const seen = client.received.filter(predicate).length;
  return client.waitFor((m) => predicate(m) && client.received.filter(predicate).length > seen);
}

/** A second project directory, alongside the server's own. */
export async function secondProject(name = "beta") {
  // Resolved: the server reports realpath'd roots (on macOS /var/… is a link to
  // /private/var/…), and a client must address a project by the root the server
  // gave it rather than one it built itself.
  return realpath(await makeWorkspace({ [`${name}.md`]: `# ${name}\n` }));
}

/** Long enough for at least two sweeps at the configured timeout. */
export const RETIREMENT_TIMEOUT_MS = 2_000;
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
