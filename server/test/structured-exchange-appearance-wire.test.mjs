/**
 * The project's kind colours, over the socket.
 *
 * A real server with a scripted RPC child: the appearance follows the hello, follows a
 * document presented live, takes an edited registry into account without a restart,
 * and goes back to none when the registry breaks.
 */
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

const timeline = {
  schema: "urn:structured-exchange:3",
  kind: "timeline",
  data: {
    time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
    rows: [{ type: "task", id: "T1", label: "Reviews", items: [{ type: "milestone", date: "2027-03-01", kind: "SRR" }] }],
  },
};

const registry = (color) => JSON.stringify({ schema: "urn:structured-exchange-profile-registry:2", appearance: { kinds: { SRR: { color } } } });
const isAppearance = (color) => (message) =>
  message.type === "structured_appearance" && message.appearance?.kinds?.SRR?.color === color;

test("the project's appearance follows snapshots and documents, as the registry is now", async () => {
  const root = await realpath(await makeWorkspace({}));
  await mkdir(path.join(root, ".pi-outpost"), { recursive: true });
  const registryFile = path.join(root, ".pi-outpost/structured-exchange.json");
  await writeFile(registryFile, registry("#dc2626"));

  const sessionFile = path.join(root, "appearance.jsonl");
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(sessionFile, "");
  await writeFile(
    fakeConfig,
    JSON.stringify({
      stateByCwd: { [root]: { sessionId: "appearance-session", sessionFile } },
      messages: [],
      commands_: {
        prompt: {
          after: [
            { type: "agent_start" },
            { type: "tool_execution_start", toolCallId: "live-1", toolName: "present_structure", args: {} },
            {
              type: "tool_execution_end",
              toolCallId: "live-1",
              toolName: "present_structure",
              result: { content: [{ type: "text", text: "presented" }], details: timeline },
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
    const reader = connect(server.wsUrl());
    clients.push(reader);
    await reader.waitFor("hello");
    await reader.waitFor(isAppearance("#dc2626"), 10_000);

    // AnEditedRegistryRecoloursTheNextDocument: no restart, the next document carries the new colour.
    await writeFile(registryFile, registry("#16a34a"));
    reader.send({ type: "prompt", text: "present the plan" });
    const toolEnd = await reader.waitFor((message) => message.type === "tool_end" && message.toolCallId === "live-1", 10_000);
    // TheDocumentIsUntouched: the document is the one presented, with no colour in it.
    assert.deepEqual(JSON.parse(toolEnd.structured), timeline);
    assert.doesNotMatch(toolEnd.structured, /#16a34a|#dc2626/);
    await reader.waitFor(isAppearance("#16a34a"), 10_000);

    // ARegistrySavedInTheViewerRecoloursAtOnce: the save itself announces it.
    reader.send({
      type: "write_file",
      path: ".pi-outpost/structured-exchange.json",
      content: registry("#2563eb"),
      expectedMtimeMs: 0,
      force: true,
      requestId: "save-1",
    });
    await reader.waitFor((message) => message.type === "file_written" && message.requestId === "save-1", 10_000);
    await reader.waitFor(isAppearance("#2563eb"), 10_000);

    // AnUnusableRegistrySendsNoAppearance.
    await writeFile(registryFile, registry("green"));
    const latecomer = connect(server.wsUrl());
    clients.push(latecomer);
    await latecomer.waitFor("hello");
    const none = await latecomer.waitFor((message) => message.type === "structured_appearance", 10_000);
    assert.equal(none.appearance, null);
  } finally {
    for (const client of clients) client.close();
    await server.stop();
  }
});
