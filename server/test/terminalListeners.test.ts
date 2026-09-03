/**
 * What happens to a terminal's listeners when it is closed.
 *
 * `kill()` starts a shutdown, it does not finish one: ConPTY drains afterwards, with a
 * helper process of its own. A subscription still attached during that drain calls back
 * into a socket the caller has already given up on — `write EAGAIN` on Windows CI, and
 * "asynchronous activity after the test ended" under `node:test`, which is how three of
 * today's red runs presented.
 *
 * These drive a stand-in pty rather than a shell: the behaviour under test is our
 * teardown, and spawning a real terminal to observe it is what made the observation
 * flaky in the first place.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { WebSocket } from "ws";
import { setPtyModuleForTesting, TerminalManager } from "../src/terminalManager.ts";

/** A pty that keeps producing after `kill()`, exactly as ConPTY does. */
function fakePty() {
  const data: Array<(chunk: string) => void> = [];
  const exit: Array<(event: { exitCode: number }) => void> = [];
  const process = {
    killed: false,
    pid: 4242,
    onData(listener: (chunk: string) => void) {
      data.push(listener);
      return { dispose: () => void data.splice(data.indexOf(listener), 1) };
    },
    onExit(listener: (event: { exitCode: number }) => void) {
      exit.push(listener);
      return { dispose: () => void exit.splice(exit.indexOf(listener), 1) };
    },
    write() {},
    resize() {},
    kill() {
      this.killed = true;
    },
    /** Output, as a live pty produces it — and as a killed one goes on producing. */
    emit(chunk: string) {
      for (const listener of [...data]) listener(chunk);
    },
    /** The exit, which a real pty reports once its shutdown finishes. */
    finish(exitCode = 0) {
      for (const listener of [...exit]) listener({ exitCode });
    },
    attached: () => data.length + exit.length,
  };
  return process;
}

function managerWith(process: ReturnType<typeof fakePty>) {
  setPtyModuleForTesting({ spawn: () => process } as never);
  return new TerminalManager();
}

describe("closing a terminal", () => {
  afterEach(() => setPtyModuleForTesting(null));

  it("detaches every listener before killing the process", async () => {
    const process = fakePty();
    const manager = managerWith(process);
    const socket = {} as WebSocket;
    const seen: string[] = [];
    let exited = 0;

    await manager.open(socket, "t1", "/tmp", 80, 24, (_id, chunk) => seen.push(chunk), () => (exited += 1));
    process.emit("hello");
    assert.deepEqual(seen, ["hello"], "an open terminal is heard");

    assert.equal(manager.close(socket, "t1"), true);
    assert.equal(process.killed, true, "the process is killed");
    assert.equal(process.attached(), 0, "and nothing is still listening to it");

    // The drain a killed ConPTY performs, then its late exit. Before this fix both
    // reached the caller — the first as a write to a socket nobody was reading.
    process.emit("goodbye");
    process.finish();
    assert.deepEqual(seen, ["hello"], "nothing from the shutdown reaches the caller");
    assert.equal(exited, 0, "and the exit of a terminal the caller already closed is not reported");
  });

  it("detaches when a socket goes away, and when the server shuts down", async () => {
    for (const closer of ["closeAllForSocket", "closeAll"] as const) {
      const process = fakePty();
      const manager = managerWith(process);
      const socket = {} as WebSocket;
      const seen: string[] = [];

      await manager.open(socket, "t1", "/tmp", 80, 24, (_id, chunk) => seen.push(chunk), () => {});
      if (closer === "closeAllForSocket") manager.closeAllForSocket(socket);
      else manager.closeAll();

      assert.equal(process.killed, true, `${closer} kills the process`);
      assert.equal(process.attached(), 0, `${closer} detaches its listeners`);
      process.emit("after");
      process.finish();
      assert.deepEqual(seen, [], `${closer} leaves nothing to call back`);
    }
  });
});
