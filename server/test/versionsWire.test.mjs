/**
 * What the snapshot says is answering prompts.
 *
 * One line in the settings panel, and the only place an operator learns which SDK is
 * actually running. It used to read `pi SDK: dev` for every server not built into an
 * executable — which is most of them while anyone is working on this — because the
 * version was a bundle-time substitution with a literal fallback. These drive real
 * servers and read the field off the wire, in both shapes it can take.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { UNKNOWN_VERSION, readInstalledPiSdkVersion } from "../src/piSdkVersion.ts";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

/** The `versions` bag from a connection's snapshot. */
async function versionsFrom(server) {
  const client = connect(server.wsUrl());
  await client.open();
  const hello = await client.waitFor("hello");
  client.close();
  return (hello.state ?? hello).versions;
}

// openlore: scenario=ARunFromSourceNamesItToo spec=api
test("a server run from source names the SDK it has installed, not a placeholder", async () => {
  const server = await startServer(await makeWorkspace());
  try {
    const versions = await versionsFrom(server);
    assert.ok(versions, "the snapshot carries a versions bag");
    assert.notEqual(
      versions.piSdk,
      UNKNOWN_VERSION,
      "a source run with the SDK installed must name its version, not stand in for it",
    );
    assert.match(versions.piSdk, /^\d+\.\d+\.\d+/, `unexpected version: ${versions.piSdk}`);
    // Exactly what the module returns, with nothing substituted on the way to the wire:
    // this is what a second fallback bolted on at the call site would fail.
    assert.equal(versions.piSdk, readInstalledPiSdkVersion());
    assert.equal(versions.agent, undefined, "the embedded runtime names an SDK, not a child");
  } finally {
    await server.stop();
  }
});

// openlore: scenario=AChildIsNamedInsteadOfTheSdk spec=api
test("a supervised child is named instead of the SDK, and never alongside it", async () => {
  const root = await makeWorkspace();
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(fakeConfig, JSON.stringify({}));
  const server = await startServer(
    root,
    {
      // RPC refuses to be paired with a sandbox: the child builds its own toolset.
      sandbox: false,
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 },
    },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  try {
    const versions = await versionsFrom(server);
    assert.ok(versions.agent, "an RPC server names the child that answers prompts");
    assert.equal(
      versions.piSdk,
      undefined,
      "naming both would tell the operator two different things answer their prompts",
    );
  } finally {
    await server.stop();
  }
});
