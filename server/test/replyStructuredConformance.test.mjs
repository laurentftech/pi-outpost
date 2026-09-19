/**
 * The profile statement for a structured-exchange document written straight into a
 * reply, over the socket, restored and live.
 *
 * A scripted RPC child supplies the replies. The statement names its block by content
 * (`replyBlockKey`), the key the browser computes from the block it drew.
 */
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { replyBlockKey } from "@pi-outpost/shared/structured-exchange/reply-blocks";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { wait } from "./multiProjectHarness.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

const profile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    { kind: "requirement", attributes: [{ name: "status", type: "enumeration", values: ["draft", "approved"], closed: true, required: true }] },
  ],
};

const table = (status) =>
  JSON.stringify({
    schema: "urn:structured-exchange:2",
    kind: "table",
    profile: "acme/requirements",
    data: { columns: ["id"], rows: [{ id: "r1", kind: "requirement", cells: ["R1"], attributes: { status } }] },
  });

const reply = (body) => ({ role: "assistant", content: [{ type: "text", text: `Here it is:\n\n\`\`\`json\n${body}\n\`\`\`\n` }], timestamp: 1 });

async function server(t, root, { messages = [], live } = {}) {
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(
    fakeConfig,
    JSON.stringify({
      stateByCwd: { [root]: { sessionId: "reply-conformance" } },
      messages,
      ...(live
        ? { commands_: { prompt: { after: [{ type: "agent_start" }, { type: "message_end", message: live }, { type: "agent_end" }] } } }
        : {}),
    }),
  );
  const started = await startServer(
    root,
    { sandbox: undefined, agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 } },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  t.after(() => started.stop());
  const client = connect(started.wsUrl());
  t.after(() => client.close());
  return client;
}

const statementAbout = (body) => (message) => message.type === "reply_structured_conformance" && message.key === replyBlockKey(body);

test("a block in a restored reply, and one in a live reply, are each told whether they conform", async (t) => {
  // ARestoredReplyIsDrawnToo, AConformingBlockSaysSo, AStrayingBlockSaysSo
  const root = await realpath(await makeWorkspace({}));
  await mkdir(path.join(root, ".pi-outpost"), { recursive: true });
  await writeFile(
    path.join(root, ".pi-outpost/structured-exchange.json"),
    JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["requirements.json"] }),
  );
  await writeFile(path.join(root, "requirements.json"), JSON.stringify(profile));

  const conforming = table("draft");
  const straying = table("rejected");
  const client = await server(t, root, { messages: [reply(conforming)], live: reply(straying) });

  // Restored: the reply travels in the hello, with its block as written; the statement follows.
  const hello = await client.waitFor("hello");
  const restored = hello.items.find((item) => item.kind === "assistant");
  assert.ok(JSON.stringify(restored).includes(JSON.stringify(conforming).slice(1, -1)), "the restored reply carries its block");
  const first = await client.waitFor(statementAbout(conforming), 10_000);
  assert.deepEqual(first.conformance, { profile: "acme/requirements", state: "conforms", openValues: 0 });

  // Live: the reply ends, the statement follows — and says it does not conform.
  client.send({ type: "prompt", text: "show me" });
  await client.waitFor((m) => m.type === "assistant_end", 10_000);
  const second = await client.waitFor(statementAbout(straying), 10_000);
  assert.equal(second.conformance.state, "strays");
  assert.equal(second.conformance.profile, "acme/requirements");
});

test("a project that registers no profile says nothing about a block", async (t) => {
  // AProjectWithoutProfilesSaysNothing
  const root = await realpath(await makeWorkspace({}));
  const client = await server(t, root, { messages: [reply(table("draft"))] });
  await client.waitFor("hello");
  await wait(1_500);
  assert.equal(client.received.filter((m) => m.type === "reply_structured_conformance").length, 0);
});
