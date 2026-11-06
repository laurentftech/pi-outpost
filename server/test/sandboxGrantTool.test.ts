import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRunWithGrantToolDefinition } from "../src/sandboxGrantTool.ts";

const askOutcomes = [
  ["refused", "The user refused the grant. The command did not run."],
  ["expired", "Nobody answered the grant request in time. The command did not run."],
  ["aborted", "The grant request was cancelled with the turn or the session. The command did not run."],
  ["unattended", "No one was connected to approve the grant. The command did not run."],
] as const;

async function fixture(ask: (request: unknown) => Promise<string> = async () => "approved-once") {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-grant-tool-"));
  const outside = path.join(root, "..", "outside");
  const resolvedOutside = path.join(await realpath(path.dirname(root)), "outside");
  const requests: unknown[] = [];
  const logs: string[] = [];
  const runs: unknown[][] = [];
  const options = {
    broker: {
      ask: async (request: unknown) => {
        requests.push(request);
        return ask(request);
      },
      log: (line: string) => logs.push(line),
    },
    context: () => ({ root, allowWrite: false, home: path.join(root, "home") }),
    shellTool: "bash",
    run: async (...args: unknown[]) => {
      runs.push(args);
      return { content: [{ type: "text", text: "result" }], details: { code: 0 } };
    },
  };
  const definition = createRunWithGrantToolDefinition(options as never);
  const execute = definition.execute as unknown as (...args: unknown[]) => Promise<{ content: Array<{ text?: string }>; details?: unknown }>;
  return { root, outside, resolvedOutside, requests, logs, runs, execute, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("createRunWithGrantToolDefinition", () => {
  it("runs without asking when the sandbox already gives every requested path", async () => {
    const f = await fixture();
    try {
      const signal = new AbortController().signal;
      const update = () => {};
      const context = { cwd: f.root };
      const result = await f.execute("call-1", { command: "pwd", directories: [{ path: f.root, access: "read" }] }, signal, update, context);
      assert.equal(f.requests.length, 0);
      assert.equal(f.runs.length, 1);
      assert.equal(f.runs[0]?.[0] && (f.runs[0][0] as { directories: unknown[] }).directories.length, 0);
      assert.deepEqual(f.runs[0]?.slice(1), [{ command: "pwd", timeout: undefined }, "call-1", signal, update, context]);
      assert.deepEqual(result.content.map((part) => part.text), ["The sandbox already gives what was asked: ran without a grant.", "result"]);
      assert.deepEqual(result.details, { code: 0 });
    } finally {
      await f.cleanup();
    }
  });

  it("asks once, passes the exact approved grant to the runner and describes the result", async () => {
    const f = await fixture(async () => "approved-once");
    try {
      const signal = new AbortController().signal;
      const result = await f.execute("call-2", { command: "make output", reason: "write the build output", directories: [{ path: f.outside, access: "write" }], timeout: 12 }, signal, undefined, {});
      assert.equal(f.requests.length, 1);
      assert.deepEqual(f.requests[0], {
        kind: "command",
        command: "make output",
        grant: { hosts: [], directories: [{ path: f.resolvedOutside, access: "write" }] },
        reason: "write the build output",
        overridesReadOnly: true,
        signal,
      });
      assert.equal(f.runs.length, 1);
      assert.deepEqual(f.runs[0]?.[1], { command: "make output", timeout: 12 });
      assert.match(result.content[0]?.text ?? "", /for this command: read-write/);
    } finally {
      await f.cleanup();
    }
  });

  it("records a forbidden target and refuses it before asking or running", async () => {
    const f = await fixture();
    try {
      await assert.rejects(
        f.execute("call-3", { command: "cat secrets", reason: "read policy", directories: [{ path: path.join(f.root, ".pi"), access: "read" }] }),
        /Not asked: .*\.pi directory may hold an extension's policy.*The command did not run\./,
      );
      assert.equal(f.requests.length, 0);
      assert.equal(f.runs.length, 0);
      assert.match(f.logs[0] ?? "", /grant forbidden/);
      assert.match(f.logs[0] ?? "", /cat secrets/);
    } finally {
      await f.cleanup();
    }
  });

  for (const [outcome, message] of askOutcomes) {
    it(`does not run when the broker returns ${outcome}`, async () => {
      const f = await fixture(async () => outcome);
      try {
        await assert.rejects(
          f.execute("call-4", { command: "write file", reason: "save output", directories: [{ path: f.outside, access: "write" }] }),
          new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
        assert.equal(f.requests.length, 1);
        assert.equal(f.runs.length, 0);
      } finally {
        await f.cleanup();
      }
    });
  }

  it("uses the session wording after session approval", async () => {
    const f = await fixture(async () => "approved-session");
    try {
      const result = await f.execute("call-5", { command: "read file", reason: "inspect output", directories: [{ path: f.outside, access: "read" }] });
      assert.match(result.content[0]?.text ?? "", /for the rest of the session: read/);
      assert.equal(f.runs.length, 1);
    } finally {
      await f.cleanup();
    }
  });
});
