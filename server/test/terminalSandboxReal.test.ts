/**
 * A confined terminal under the real sandbox runner.
 *
 * Every other terminal-sandbox test fakes the runner, which proves pi-outpost asks for
 * the right thing; only this one proves the thing asked for holds. It drives a real pty
 * through `TerminalManager` with landstrip's runner and checks, from inside the shell,
 * what the scenarios promise: reads stop at the root, writes at the writable zone, the
 * shell stays interactive, and the server cannot be signalled.
 *
 * Linux only, and only where `LANDSTRIP_BIN` names the runner: CI's Linux job fetches
 * it. Skipped elsewhere with the reason, never silently passed.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { WebSocket } from "ws";
import { TerminalManager } from "../src/terminalManager.ts";
import { checkRunner, terminalPolicy } from "../src/terminalSandbox.ts";

const RUNNER = process.env.LANDSTRIP_BIN;
const skip =
  process.platform !== "linux"
    ? "confinement is supported on Linux only"
    : !RUNNER
      ? "LANDSTRIP_BIN is not set (CI's Linux job sets it)"
      : false;

describe("a confined terminal under the real runner", { skip }, () => {
  let base: string;
  let root: string;
  let out: string;
  let agentDir: string;
  const manager = new TerminalManager();
  const socket = {} as WebSocket;
  let output = "";

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `the runner cannot sandbox on this host: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "confined-terminal-"));
    root = path.join(base, "app");
    out = path.join(root, "out");
    agentDir = path.join(base, "agent");
    await mkdir(out, { recursive: true });
    await mkdir(path.join(base, "other"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(base, "other", "secret.txt"), "other-secret");
    await writeFile(path.join(agentDir, "auth.json"), '{"key":"sk-agent-secret"}');
    await manager.open(
      socket,
      "t1",
      root,
      120,
      40,
      (_id, data) => {
        output += data;
      },
      () => {},
      { shell: "/bin/bash", shellArgs: ["--norc", "--noprofile", "-i"] },
      {
        runner: RUNNER!,
        root,
        policy: ({ tmp }) =>
          terminalPolicy({ root, writableRoot: out, allowWrite: true, agentDir, tmp, searchPath: process.env.PATH }),
      },
    );
  });

  after(async () => {
    manager.closeAllForSocket(socket);
    if (base) await rm(base, { recursive: true, force: true });
  });

  /** Run one line in the shell and return what it printed between two markers. */
  async function run(command: string): Promise<string> {
    const tag = `M${Math.random().toString(36).slice(2, 8)}`;
    const start = output.length;
    manager.write(socket, "t1", `echo ${tag}-B; ${command} 2>&1; echo ${tag}-E\r`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const seen = output.slice(start).replace(/\r/g, "");
      // The echoed command line also contains the markers: take the last begin/end pair.
      const b = seen.lastIndexOf(`${tag}-B\n`);
      const e = seen.lastIndexOf(`${tag}-E`);
      if (b !== -1 && e > b && seen.slice(e).includes("\n")) return seen.slice(b + tag.length + 3, e).trim();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no answer to ${command}: ${output.slice(start)}`);
  }

  // openlore: scenario=ReadsStayInsideTheRoot spec=terminal
  test("reads stop at the root: a sibling project, the agent's keys, a /proc escape", async () => {
    assert.match(await run(`cat ${path.join(base, "other", "secret.txt")}`), /Permission denied/);
    assert.match(await run(`cat ${path.join(agentDir, "auth.json")}`), /Permission denied/);
    assert.match(await run(`cat /proc/1/root${path.join(base, "other", "secret.txt")}`), /Permission denied|No such file/);
    assert.doesNotMatch(await run(`ls ${base}`), /other/);
  });

  // openlore: scenario=WritesStayInsideTheWritableZone spec=terminal
  test("writes succeed in the writable zone and are refused elsewhere in the root", async () => {
    await run(`echo inside > ${path.join(out, "a.txt")}`);
    assert.equal(await readFile(path.join(out, "a.txt"), "utf8"), "inside\n");
    assert.match(await run(`echo outside > ${path.join(root, "b.txt")}`), /Permission denied/);
    await assert.rejects(readFile(path.join(root, "b.txt")));
  });

  // openlore: scenario=TheConfinedTerminalStaysInteractive spec=terminal
  test("git, a background job and its listing work as in any terminal", async () => {
    assert.match(await run(`git -C ${out} init -q && echo git-ok`), /git-ok/);
    await run("sleep 30 &");
    assert.match(await run("jobs"), /Running\s+sleep 30/);
  });

  // openlore: scenario=TheServerCannotBeSignalled spec=terminal
  test("the server cannot be signalled from inside", async () => {
    assert.match(await run(`kill -TERM ${process.pid}; echo exit=$?`), /not permitted|exit=1/);
    // Still here to read this: the signal never arrived.
    assert.ok(process.pid > 0);
  });
});
