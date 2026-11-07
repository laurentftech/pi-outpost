/**
 * A host question through the real server and a real POSIX runner (host-questions-on-posix-runners).
 *
 * `sandboxGrantsReal.test.ts` drives the confined bash operations directly; this drives what wires
 * them — `asksAboutHosts`, the broker, the `connection` grant request a client answers — under the
 * runner the environment names: Seatbelt (`SEATBELT_EXEC`) or MXC on macOS (`MXC_MAC_EXEC`) in CI's
 * `mxc-macos` job, MXC on Linux (`MXC_LXC_EXEC` with `MXC_LINUX_EXPECT=confined`) in `mxc-linux`.
 * A provider makes the agent run `curl` against a host `sandbox.allowedHosts` does not list.
 */
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/bash-call-provider.mjs", import.meta.url));
const MODEL = { provider: "bash-call-test", id: "bash-call-test" };

const RUNNER =
  process.env.SEATBELT_EXEC ??
  process.env.MXC_MAC_EXEC ??
  (process.env.MXC_LINUX_EXPECT === "confined" ? process.env.MXC_LXC_EXEC : undefined);
const skip = !RUNNER ? "SEATBELT_EXEC, MXC_MAC_EXEC or MXC_LXC_EXEC (with MXC_LINUX_EXPECT=confined) names no runner" : false;

async function waitForFile(file, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await readFile(file, "utf8").catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${path.basename(file)} never written`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function ask(t, decision) {
  // Over HTTPS, not only by name: DNS may answer where outbound HTTPS is blocked.
  const online = await fetch("https://example.com/", { method: "HEAD", signal: AbortSignal.timeout(5_000) }).then(() => true, () => false);
  if (!online) return t.skip("this host does not reach https://example.com");
  const root = await realpath(await makeWorkspace());
  const log = path.join(path.dirname(root), `${path.basename(root)}-calls.json`);
  const command = `echo "fetched=$(curl -s -o /dev/null -m 30 -w '%{http_code}' https://example.com/)"`;
  const server = await startServer(
    root,
    {
      sandbox: { root, allowWrite: true, allowBash: true, bashRunner: RUNNER, allowedHosts: ["registry.npmjs.org"] },
      extensionPaths: [PROVIDER],
      allowedModels: [MODEL],
    },
    { env: { BASH_CALL_LOG: log, BASH_CALL_COMMANDS: JSON.stringify([command]) } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "Fetch it." });

  const { request } = await client.waitFor("sandbox_grant_request", 90_000).catch((error) => {
    throw new Error(`${error.message}\n--- server log ---\n${server.log()}`);
  });
  client.send({ type: "sandbox_grant_response", id: request.id, decision });
  await client.waitFor((message) => message.type === "sandbox_grant_resolved" && message.id === request.id);
  const [result] = JSON.parse(await waitForFile(log)).map((content) => content.map((part) => part.text ?? "").join(""));
  return { request, result, log: server.log() };
}

// openlore: scenario=APosixRunnerAsksAboutAnUnlistedHost spec=sandbox-approved-grants
test(`the server asks about an unlisted host under ${RUNNER ? path.basename(RUNNER) : "a POSIX runner"}, and an approval lets the command through`, { skip, timeout: 180_000 }, async (t) => {
  const outcome = await ask(t, "once");
  if (!outcome) return;
  const { request, result, log } = outcome;
  assert.equal(request.kind, "connection");
  assert.deepEqual(request.grant.hosts, ["example.com"]);
  assert.match(request.command, /curl/);
  assert.match(result, /fetched=200/, result);
  assert.match(result, /\[pi-outpost\] network: the user allowed example\.com for this command\./, result);
  assert.match(log, /\[sandbox\] grant approved once: host example\.com/, log);
});

// openlore: scenario=APosixRunnerAppliesARefusal spec=sandbox-approved-grants
test(`a refusal through the server leaves the connection refused under ${RUNNER ? path.basename(RUNNER) : "a POSIX runner"}`, { skip, timeout: 180_000 }, async (t) => {
  const outcome = await ask(t, "refuse");
  if (!outcome) return;
  const { result, log } = outcome;
  assert.doesNotMatch(result, /fetched=200/, result);
  assert.match(result, /\[pi-outpost\] network: the user refused example\.com\./, result);
  assert.match(log, /\[sandbox\] grant refused: host example\.com/, log);
});
