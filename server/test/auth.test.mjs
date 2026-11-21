/**
 * Shared-token auth: the WebSocket, /branding and /health. No model auth needed —
 * a rejected socket is closed before the session ever sees it.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const TOKEN = "test-token-auth";
/** App close code the client keys on to show the token screen instead of retrying. */
const WS_CLOSE_UNAUTHORIZED = 4401;

describe("auth", () => {
  let guarded;
  let open;

  before(async () => {
    guarded = await startServer(await makeWorkspace({ "README.md": "# x\n" }), {
      server: { token: TOKEN },
    });
    open = await startServer(await makeWorkspace({ "README.md": "# x\n" }));
  });
  after(async () => {
    await guarded?.stop();
    await open?.stop();
  });

  test("a valid token connects and gets the snapshot", async () => {
    const client = connect(guarded.wsUrl(TOKEN));
    await client.open();
    const hello = await client.waitFor("hello", 15_000);
    assert.ok(hello.sessionId);
    client.close();
  });

  test("a missing or wrong token is closed with 4401 and gets no data", async () => {
    for (const url of [guarded.wsUrl(null), guarded.wsUrl("wrong")]) {
      const client = connect(url);
      const code = await client.waitForClose();
      assert.equal(code, WS_CLOSE_UNAUTHORIZED);
      assert.deepEqual(client.received, [], "a rejected socket must receive nothing");
    }
  });

  test("/branding needs a Bearer token; /health hides the session id", async () => {
    assert.equal((await fetch(`${guarded.base}/branding`)).status, 401);
    const ok = await fetch(`${guarded.base}/branding`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(ok.status, 200);

    const health = await (await fetch(`${guarded.base}/health`)).json();
    assert.equal(health.sessionId, undefined, "the public probe must not leak the session id");
  });

  // openlore: scenario=NoTokenConfigured spec=auth
  test("NoTokenConfigured: a server with no token configured requires the one it generated", async () => {
    const generated = path.join(open.root, ".pi-agent", "outpost-token");
    assert.ok(existsSync(generated), "the generated token is kept in the agent directory");
    assert.match(open.token, /^[0-9a-f]{64}$/);

    const refused = connect(open.wsUrl(null));
    assert.equal(await refused.waitForClose(), WS_CLOSE_UNAUTHORIZED);
    assert.deepEqual(refused.received, []);

    const client = connect(open.wsUrl());
    await client.open();
    await client.waitFor("hello", 15_000);
    client.close();

    assert.equal((await fetch(`${open.base}/branding`)).status, 401);
    assert.equal((await fetch(`${open.base}/branding`, { headers: open.authHeaders })).status, 200);
  });

  // openlore: scenario=NoTokenConfigured spec=auth
  test("NoTokenConfigured: the next start requires the same generated token", async () => {
    // The agent directory outlives each server's throwaway workspace, as a real one does.
    const agentDir = await makeWorkspace();
    const first = await startServer(await makeWorkspace({ "README.md": "# x\n" }), { agentDir });
    const token = first.token;
    await first.stop();
    const second = await startServer(await makeWorkspace({ "README.md": "# x\n" }), { agentDir });
    try {
      assert.equal(second.token, token);
      const client = connect(second.wsUrl(token));
      await client.open();
      await client.waitFor("hello", 15_000);
      client.close();
    } finally {
      await second.stop();
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  // openlore: scenario=WsWithoutOriginNeedsTheToken spec=auth
  test("WsWithoutOriginNeedsTheToken: a native client without Origin is not trusted for being local", async () => {
    // ws sends no Origin unless told to: this is curl's or a script's connection.
    const client = connect(open.wsUrl(null));
    assert.equal(await client.waitForClose(), WS_CLOSE_UNAUTHORIZED);
    assert.deepEqual(client.received, []);
  });

  // openlore: scenario=HealthRedacted spec=auth
  test("HealthRedacted: /health never reports the session id", async () => {
    for (const server of [open, guarded]) {
      const health = await (await fetch(`${server.base}/health`)).json();
      assert.equal(health.ok, true);
      assert.equal(health.sessionId, undefined);
    }
  });

  test("a configured token is never written to the agent directory", () => {
    assert.equal(guarded.token, TOKEN);
    assert.equal(existsSync(path.join(guarded.root, ".pi-agent", "outpost-token")), false);
  });

  // openlore: scenario=AConfiguredTokenIsNeverPrinted spec=auth
  test("AConfiguredTokenIsNeverPrinted: a configured token stays out of the log; a generated one is in the printed address", () => {
    const printed = guarded.log().match(/\[server\] (https?:\/\/\S+)/)?.[1];
    assert.ok(printed, guarded.log());
    assert.equal(new URL(printed).searchParams.has("token"), false);
    assert.ok(!guarded.log().includes(TOKEN), "the configured token appears in the server's output");
    const generated = open.log().match(/\[server\] (https?:\/\/\S+)/)?.[1];
    assert.equal(new URL(generated).searchParams.get("token"), open.token);
  });
});
