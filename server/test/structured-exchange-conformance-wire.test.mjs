/**
 * The conformance statement, over the socket, live and on replay.
 *
 * A real server with a scripted RPC child, because both halves of the promise are
 * about what reaches a client and when: a document replayed in a `hello` is followed
 * by a statement about it, a document arriving live in a `tool_end` is followed by one
 * too, and a reader who reconnects after the profile changed is told what is true now.
 */
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

const profile = (statuses) => ({
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "status", type: "enumeration", values: statuses, closed: true, required: true },
        { name: "priority", type: "enumeration", values: ["must", "should"], closed: false },
      ],
    },
  ],
});

const table = (attributes) => ({
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  data: { columns: ["id"], rows: [{ id: "r1", kind: "requirement", cells: ["R1"], attributes }] },
});

const isStatementAbout = (toolCallId) => (message) => message.type === "structured_conformance" && message.toolCallId === toolCallId;

test("a presented document is followed by what is true of it against the project's profile", async () => {
  const root = await realpath(await makeWorkspace({}));
  await mkdir(path.join(root, ".pi-outpost"), { recursive: true });
  await mkdir(path.join(root, "profiles"), { recursive: true });
  const registryFile = path.join(root, ".pi-outpost/structured-exchange.json");
  const profileFile = path.join(root, "profiles/requirements.json");
  await writeFile(registryFile, JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["profiles/requirements.json"] }));
  await writeFile(profileFile, JSON.stringify(profile(["draft", "approved", "in review"])));

  const sessionFile = path.join(root, "conformance.jsonl");
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(sessionFile, "");
  await writeFile(
    fakeConfig,
    JSON.stringify({
      stateByCwd: { [root]: { sessionId: "conformance-session", sessionFile } },
      // A proposal presented in an earlier turn, as the transcript holds it.
      messages: [
        {
          role: "toolResult",
          toolCallId: "replayed-1",
          toolName: "present_structure",
          content: [{ type: "text", text: "presented" }],
          details: table({ status: "in review" }),
          isError: false,
          timestamp: 1,
        },
      ],
      // And one presented now, with a value outside an open enumeration.
      commands_: {
        prompt: {
          after: [
            { type: "agent_start" },
            { type: "tool_execution_start", toolCallId: "live-1", toolName: "present_structure", args: {} },
            {
              type: "tool_execution_end",
              toolCallId: "live-1",
              toolName: "present_structure",
              result: { content: [{ type: "text", text: "presented" }], details: table({ status: "approved", priority: "urgent" }) },
              isError: false,
            },
            { type: "agent_end" },
          ],
        },
      },
    }),
  );

  const server = await startServer(
    root,
    { sandbox: undefined, agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 } },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  const clients = [];
  try {
    // Replay: the document travels in the hello, the statement follows it.
    const reader = connect(server.wsUrl());
    clients.push(reader);
    const hello = await reader.waitFor("hello");
    const replayed = hello.items.find((item) => item.kind === "tool" && item.toolCallId === "replayed-1");
    assert.ok(replayed?.structured, "the replayed document did not reach the client");
    assert.equal(replayed.structuredConformance, undefined, "the statement was put inside the snapshot");
    const replayStatement = await reader.waitFor(isStatementAbout("replayed-1"), 10_000);
    assert.deepEqual(replayStatement.conformance, { profile: "acme/requirements", state: "conforms", openValues: 0 });

    // Live: the document travels in the tool_end, the statement follows it.
    reader.send({ type: "prompt", text: "present the requirements" });
    const toolEnd = await reader.waitFor((message) => message.type === "tool_end" && message.toolCallId === "live-1", 10_000);
    assert.ok(toolEnd.structured, "the live document did not reach the client");
    assert.equal(toolEnd.structuredConformance, undefined, "the statement was put inside the tool_end");
    const liveStatement = await reader.waitFor(isStatementAbout("live-1"), 10_000);
    assert.deepEqual(liveStatement.conformance, { profile: "acme/requirements", state: "conforms", openValues: 1 });
    // The document is exactly what the tool produced — the statement changed nothing in it.
    assert.deepEqual(JSON.parse(toolEnd.structured), table({ status: "approved", priority: "urgent" }));

    // The profile is tightened. A reader arriving now is told the proposal no longer conforms.
    await writeFile(profileFile, JSON.stringify(profile(["draft", "approved"])));
    const latecomer = connect(server.wsUrl());
    clients.push(latecomer);
    await latecomer.waitFor("hello");
    const restored = await latecomer.waitFor(isStatementAbout("replayed-1"), 10_000);
    assert.deepEqual(restored.conformance, { profile: "acme/requirements", state: "strays", openValues: 0 });

    // The registry breaks. A reader arriving now is told it could not be checked.
    await writeFile(registryFile, "{ not json");
    const third = connect(server.wsUrl());
    clients.push(third);
    await third.waitFor("hello");
    const unchecked = await third.waitFor(isStatementAbout("replayed-1"), 10_000);
    assert.equal(unchecked.conformance.state, "unchecked");
  } finally {
    for (const client of clients) client.close();
    await server.stop();
  }
});
