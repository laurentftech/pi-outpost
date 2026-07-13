/**
 * Automatic session naming, end to end. LIVE: this drives a real agent turn, so it
 * needs model auth configured (the same credentials `npm run dev` uses) and costs
 * tokens. Run with `npm run test:live --workspace server`.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "../harness.mjs";

describe("session title", () => {
  let server;
  let client;

  before(async () => {
    server = await startServer(await makeWorkspace());
    client = connect(server.wsUrl());
    await client.open();
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
  });

  test("the first exchange titles the session", async () => {
    client.send({ type: "prompt", text: "In one sentence: why is the sky blue?" });
    await client.waitFor("agent_end", 120_000);

    // The title is generated off the prompt path — it lands as a `sessions` broadcast
    const { sessions } = await client.waitFor(
      (m) => m.type === "sessions" && m.sessions.some((s) => s.name),
      120_000,
    );
    const named = sessions.find((s) => s.name);
    assert.ok(named.name.length > 0 && named.name.length <= 80, `unexpected title: ${named.name}`);
    assert.equal(named.name.split("\n").length, 1);
    assert.doesNotMatch(named.name, /^["'`]/);
  });
});
