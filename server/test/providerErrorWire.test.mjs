/**
 * A provider failure, as it reaches the browser.
 *
 * The unit test next door fixes what `describeProviderError` returns. This one
 * answers the question that decides what the user actually reads: does a real
 * server, handed the real event a runtime emits when a turn fails, put the
 * cleaned line on the wire — or the web page the proxy sent?
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

/** Verbatim from the report: a gateway timeout, as a whole HTML document. */
const GATEWAY_TIMEOUT =
  "504 <html><body><h1>504 Gateway Time-out</h1> The server didn't respond in time. </body></html>";

test("a turn that failed on the provider reads as a sentence, not as a web page", async () => {
  const root = await makeWorkspace();
  const fakeConfig = path.join(root, "fake-rpc.json");
  await writeFile(
    fakeConfig,
    JSON.stringify({
      commands_: {
        prompt: {
          after: [
            {
              type: "message_end",
              message: { role: "assistant", content: [], errorMessage: GATEWAY_TIMEOUT },
            },
          ],
        },
      },
    }),
  );

  const server = await startServer(
    root,
    {
      sandbox: false,
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 5_000 },
    },
    { env: { FAKE_PI_RPC_CONFIG: fakeConfig } },
  );
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello");
    client.send({ type: "prompt", text: "anything" });

    const ended = await client.waitFor((message) => message.type === "assistant_end");
    assert.equal(ended.item.errorMessage, "504 Gateway Time-out The server didn't respond in time.");
    // The markup must be gone from the wire, not merely hidden by the renderer:
    // the same string is what a reopened session replays.
    assert.ok(!/<[a-z]/i.test(ended.item.errorMessage), `markup survived: ${ended.item.errorMessage}`);

    const reconnected = connect(server.wsUrl());
    try {
      const hello = await reconnected.waitFor("hello");
      const replayed = hello.items.find((item) => item.kind === "assistant" && item.errorMessage);
      assert.ok(replayed, `no assistant item carried the failure; saw ${JSON.stringify(hello.items.map((i) => i.kind))}`);
      assert.equal(replayed.errorMessage, "504 Gateway Time-out The server didn't respond in time.");
    } finally {
      reconnected.close();
    }
  } finally {
    client.close();
    await server.stop();
  }
});
