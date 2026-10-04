/**
 * Under a sandbox, Pi's own unconfined built-ins are not in the session at all.
 *
 * The SDK's `noTools: "builtin"` only starts them inactive: they stay registered, so
 * an extension calling `setActiveTools([..., "bash"])` — or a setting naming them —
 * brought the unconfined `bash` back into a sandbox configured without it. The
 * sandbox's confinement has to be what is registered, not what happens to be active.
 */
import assert from "node:assert/strict";

import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const ACTIVATE_BASH = fileURLToPath(new URL("./fixtures/activate-bash-extension.mjs", import.meta.url));

async function toolsOf(root, config) {
  const server = await startServer(root, config);
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 30_000);
    return {
      active: hello.tools.filter((tool) => tool.active).map((tool) => tool.name),
      all: hello.tools.map((tool) => tool.name),
      // For the failure message: this test has failed intermittently on CI runners
      // and never locally, so a failure has to carry what the server saw and said.
      diagnostics: () =>
        `active: ${hello.tools.filter((tool) => tool.active).map((tool) => tool.name).join(", ") || "(none)"}\n` +
        `registered: ${hello.tools.map((tool) => tool.name).join(", ") || "(none)"}\n` +
        `agentStarting: ${hello.agentStarting === true}\n` +
        `server log:\n${server.log()}`,
    };
  } finally {
    client.close();
    await server.stop();
  }
}

test("UnconfinedBuiltInsAreNotRegistered: an extension cannot activate bash in a sandbox without it", async () => {
  const root = await makeWorkspace();
  const { active, all } = await toolsOf(root, { extensionPaths: [ACTIVATE_BASH] });
  assert.ok(!active.includes("bash"), `bash stays off: ${active.join(", ")}`);
  assert.ok(!all.includes("bash"), "Pi's bash is not registered at all");
  assert.ok(!all.includes("powershell"), "nor its powershell");
  // What the sandbox does supply is untouched, and active.
  for (const name of ["read", "write", "edit", "grep", "find", "ls"]) assert.ok(active.includes(name), `${name} active`);
});

test("UnconfinedBuiltInsAreNotRegistered: a read-only sandbox registers no write or edit", async () => {
  const root = await makeWorkspace();
  const { active, all } = await toolsOf(root, {
    extensionPaths: [ACTIVATE_BASH],
    sandbox: { root, allowWrite: false, allowBash: false },
  });
  for (const name of ["write", "edit", "bash"]) {
    assert.ok(!all.includes(name), `${name} is not registered: ${all.join(", ")}`);
    assert.ok(!active.includes(name), `${name} is not active`);
  }
  assert.ok(active.includes("read"), "the sandboxed read is still there");
});

test("UnconfinedBuiltInsAreNotRegistered: allowBash supplies the sandbox's own bash", async () => {
  const root = await makeWorkspace();
  const { active, diagnostics } = await toolsOf(root, { sandbox: { root, allowWrite: true, writableRoot: root, allowBash: true } });
  assert.ok(active.includes("bash"), `the sandboxed bash is the one present\n${diagnostics()}`);
});


