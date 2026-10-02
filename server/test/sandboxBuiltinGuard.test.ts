/**
 * The two halves of keeping Pi's unconfined built-ins out of a sandboxed session:
 * which names to exclude, and refusing the session when one gets through anyway.
 * `sandboxBuiltins.test.mjs` proves the wiring over a real server; this proves the
 * guard fires, which a real server only shows once Pi grows a built-in.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { assertNoUnconfinedBuiltIns, createSandboxedTools, unsuppliedBuiltIns } from "../src/sandbox.ts";

const root = mkdtempSync(path.join(tmpdir(), "sandbox-builtin-guard-"));
after(() => rmSync(root, { recursive: true, force: true }));

const tool = (name: string, source: string) => ({ name, sourceInfo: { source } });
const session = (tools: ReturnType<typeof tool>[]) => ({ getAllTools: () => tools }) as never;

test("a sandbox without bash excludes Pi's bash and powershell, not what it supplies", async () => {
  const tools = await createSandboxedTools({ root, allowWrite: true, writableRoot: root, allowBash: false, readExceptions: [] });
  const excluded = unsuppliedBuiltIns(tools);
  assert.ok(excluded.includes("bash") && excluded.includes("powershell"));
  for (const name of ["read", "write", "edit", "grep", "find", "ls"]) assert.ok(!excluded.includes(name), name);
});

test("a read-only sandbox excludes Pi's write and edit too", async () => {
  const tools = await createSandboxedTools({ root, allowWrite: false, allowBash: false, readExceptions: [] });
  const excluded = unsuppliedBuiltIns(tools);
  for (const name of ["write", "edit", "bash", "powershell"]) assert.ok(excluded.includes(name), name);
  assert.ok(!excluded.includes("read"));
});

test("a session whose tools all come from the sandbox or extensions passes", () => {
  assert.doesNotThrow(() => assertNoUnconfinedBuiltIns(session([tool("read", "sdk"), tool("codemode", "extension")])));
});

test("a built-in Pi registers that the sandbox does not know about refuses the session", () => {
  assert.throws(
    () => assertNoUnconfinedBuiltIns(session([tool("read", "sdk"), tool("new_shell", "builtin")])),
    /unconfined built-in tools: new_shell/,
  );
});
