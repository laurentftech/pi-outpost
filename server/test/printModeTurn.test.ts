/**
 * The turn's client, against a server that plays the protocol: what it answers to a grant request
 * and to an extension's dialog, and what it prints where.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WebSocketServer } from "ws";
import type { PrintGrants } from "../src/cli.ts";
import { runPrintTurn } from "../src/printMode.ts";

/** A server that greets, starts a session, then plays `turn` and ends; it records what the client sent. */
async function play(turn: Array<Record<string, unknown>>, grants: PrintGrants) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  const sent: Array<Record<string, unknown>> = [];
  server.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "hello" }));
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      sent.push(message);
      if (message.type === "new_session") socket.send(JSON.stringify({ type: "session_replaced" }));
      if (message.type === "prompt") {
        for (const event of [{ type: "agent_start" }, ...turn]) socket.send(JSON.stringify(event));
        // The end comes once the client had a moment to answer what it was asked.
        setTimeout(() => socket.send(JSON.stringify({ type: "agent_end" })), 200);
      }
    });
  });
  const port = (server.address() as { port: number }).port;
  let out = "";
  let err = "";
  const code = await runPrintTurn({ url: `ws://127.0.0.1:${port}/ws`, prompt: "go", json: false, grants, out: (text) => (out += text), err: (text) => (err += text) });
  await new Promise((resolve) => server.close(resolve));
  return { code, out, err, sent };
}

const grantRequest = {
  type: "sandbox_grant_request",
  request: { id: "g1", kind: "connection", command: "curl https://example.com/", grant: { hosts: ["example.com"], directories: [] }, reason: "r", overridesReadOnly: false, expiresAt: 0 },
};

// openlore: scenario=GrantsAreRefusedUnlessAllowed spec=cli
describe("PrintModeAnswersQuestionsByPolicy", () => {
  test("GrantsAreRefusedUnlessAllowed: refused by default, allowed once or for the session when asked to, each said on stderr", async () => {
    for (const [grants, decision, said] of [
      ["refuse", "refuse", /\[grant\] host example\.com for "curl https:\/\/example\.com\/": refused by --grants refuse/],
      ["once", "once", /allowed \(once\) by --grants once/],
      ["session", "session", /allowed \(session\) by --grants session/],
    ] as const) {
      const { code, err, sent } = await play([grantRequest], grants);
      assert.equal(code, 0);
      assert.deepEqual(sent.find((message) => message.type === "sandbox_grant_response"), { type: "sandbox_grant_response", id: "g1", decision });
      assert.match(err, said);
    }
  });

  test("an extension's dialog is declined, nobody being there to answer it", async () => {
    const { err, sent } = await play([{ type: "extension_ui_request", id: "d1", method: "confirm", title: "Proceed?", message: "m" }], "once");
    assert.deepEqual(sent.find((message) => message.type === "extension_ui_response"), { type: "extension_ui_response", id: "d1", cancelled: true });
    assert.match(err, /\[extension\] declined, nobody to answer: Proceed\?/);
  });

  test("the text streamed goes to stdout, the tools to stderr; the turn starts in a session of its own", async () => {
    const { out, err, sent } = await play(
      [
        { type: "assistant_start" },
        { type: "block_delta", block: "thinking", contentIndex: 0, delta: "hmm" },
        { type: "block_delta", block: "text", contentIndex: 1, delta: "Hello" },
        { type: "tool_start", toolCallId: "t", toolName: "powershell", args: {} },
        { type: "assistant_end", item: { kind: "assistant", blocks: [{ type: "text", text: "Hello" }] } },
      ],
      "refuse",
    );
    assert.equal(out, "Hello\n", "the text once, the thinking not at all");
    assert.match(err, /\[tool\] powershell/);
    assert.deepEqual(sent.slice(0, 2).map((message) => message.type), ["new_session", "prompt"]);
  });
});
