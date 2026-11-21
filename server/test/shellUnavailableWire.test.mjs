/**
 * A Windows 11 without the August 2026 update (sandbox-defaults): the shell the server chose
 * (`"auto"`) cannot be confined, and the client is told what is missing and what to do — the
 * remedy as data, for the dialog — while the console says the shell is refused, not that a check
 * "could not" run.
 *
 * MXC's probe and the build are told through PI_OUTPOST_TEST_MXC_TIER and
 * PI_OUTPOST_TEST_WINDOWS_BUILD, which can only make the check fail. Windows only: elsewhere
 * MXC confines through other backends.
 */
import assert from "node:assert/strict";
import { realpath, rm } from "node:fs/promises";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const skip = process.platform !== "win32" ? "MXC's process container is Windows'" : false;

// openlore: scenario=AMachineThatCannotConfineIsSaidOnce spec=sandbox-defaults
test("a Windows without the August update: the shell is unavailable, with the update to install, and the console says so", { skip }, async (t) => {
  const root = await realpath(await makeWorkspace({ "readme.md": "# old windows\n" }));
  const server = await startServer(
    root,
    { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "auto" } },
    { env: { PI_OUTPOST_TEST_MXC_TIER: "appcontainer-dacl", PI_OUTPOST_TEST_WINDOWS_BUILD: "26100.6584" } },
  );
  const client = connect(server.wsUrl());
  t.after(async () => {
    client.close();
    await server.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  await client.waitFor("hello", 30_000);
  const settled = await client.waitFor(
    (message) => (message.type === "hello" || message.type === "confinement") && message.confinement?.bash?.state === "unavailable",
    90_000,
  );
  const bash = settled.confinement.bash;
  assert.deepEqual(bash.remedy, { kind: "windows-update", build: "26100.6584", needed: "26100.9278", update: "the August 2026 cumulative update (KB5120998)" });
  assert.match(bash.reason, /^The agent's shell is unavailable on this machine: this Windows \(build 26100\.6584\) lacks the August 2026 cumulative update \(KB5120998\)/);
  assert.match(bash.reason, /Install it with Windows Update, then restart pi-outpost\./);
  assert.match(bash.reason, /"sandbox\.bashRunner": "none".*every right of your account/);
  assert.doesNotMatch(bash.reason, /terminals/, "the shell's refusal speaks of the shell");

  // Written just before the verdict is sent, but a pipe on Windows may deliver it after.
  const deadline = Date.now() + 10_000;
  while (!/\[sandbox\] /.test(server.log()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  const log = server.log();
  assert.match(log, /\[pi\] sandbox .*powershell \(checking mxc, chosen automatically: no command runs until it shows it confines/);
  assert.doesNotMatch(log, /confined by mxc/, "the startup line does not claim a confinement not yet shown");
  assert.match(log, /\[sandbox\] The agent's shell is unavailable on this machine: this Windows \(build 26100\.6584\)/);
  assert.doesNotMatch(log, /could not check mxc's confinement/, "a refusal, not a hiccup");
});
