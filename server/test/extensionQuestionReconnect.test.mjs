import assert from "node:assert/strict";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const blocking = message => message.type === "extension_ui_request" && message.method === "select";

async function eventually(read, check) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (check(value)) return value;
    if (Date.now() > deadline) assert.fail(`expected answer not observed: ${JSON.stringify(value)}`);
    await sleep(25);
  }
}

for (const mode of ["embedded", "rpc"]) {
  // openlore: scenario=AnUnansweredQuestionSurvivesBrowserReconnection spec=extension-question-reconnect
  // openlore: scenario=AWaitingProjectOutlivesItsIdleTimeout spec=extension-question-reconnect
  test(`${mode}: the last client can leave past the idle timeout and answer the same question on return`, async t => {
    const root = await realpath(await makeWorkspace());
    const beta = await realpath(await makeWorkspace());
    const answers = path.join(root, "answers.jsonl");
    const extension = path.join(root, "question.mjs");
    await writeFile(extension, `import { appendFile } from "node:fs/promises";
export default pi => pi.registerCommand("ask", {handler: async (_args, ctx) => {
 const value = await ctx.ui.select("Awaiting your decision", ["Keep", "Change"]);
 await appendFile(${JSON.stringify(answers)}, JSON.stringify({value: value ?? "cancelled"}) + "\\n");
}});`);
    const fakeConfig = path.join(root, "rpc.json");
    await writeFile(fakeConfig, JSON.stringify({
      commandLog: answers,
      dialogBlocksCommand: "prompt",
      commands_: {
        prompt: { before: [{ type: "extension_ui_request", id: "waiting-question", method: "select", title: "Awaiting your decision", options: ["Keep", "Change"] }] },
        new_session: { replacement: { state: { sessionId: "new-session", isStreaming: false } } },
      },
    }));
    const server = await startServer(root, {
      openProjects: [beta], workspaceIdleTimeoutMs: 1_000,
      ...(mode === "rpc"
        ? { sandbox: false, agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE], startupTimeoutMs: 20_000 } }
        : { noExtensions: false, extensionPaths: [extension] }),
    }, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key", FAKE_PI_RPC_CONFIG: fakeConfig } });
    let client = connect(server.wsUrl());
    t.after(async () => {
      client.close();
      await server.stop();
      await rm(beta, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    });
    const records = async () => (await readFile(answers, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    await client.waitFor("hello");
    client.send({ type: "switch_workspace", root: beta });
    const original = await client.waitFor("workspace_switched");
    client.send({ type: "prompt", text: "/ask" });
    const first = await client.waitFor(blocking);
    assert.equal(first.timeout, undefined, "the extension did not request an expiry");
    client.close();
    await client.waitForClose();
    // At least three idle sweeps, with no other test socket keeping the server watched.
    await sleep(3_100);
    assert.ok(!(await records()).some(r => r.cancelled || r.value === "cancelled"), "disconnect was sent to the agent as a refusal");
    client = connect(server.wsUrl());
    await client.waitFor("hello");
    client.send({ type: "switch_workspace", root: beta });
    const restored = await client.waitFor("workspace_switched");
    const pending = await client.waitFor(blocking, 10_000);
    assert.equal(restored.sessionId, original.sessionId);
    assert.equal(pending.id, first.id, "the original question, not a replacement, is replayed");
    client.send({ type: "extension_ui_response", id: pending.id, value: "Keep" });
    await eventually(records, entries => entries.some(r => r.value === "Keep"));

    // openlore: scenario=DeliberateSessionReplacementCanAbandonAQuestion spec=extension-question-reconnect
    const seen = client.received.length;
    client.send({ type: "prompt", text: "/ask" });
    await client.waitFor(m => client.received.indexOf(m) >= seen && blocking(m));
    client.send({ type: "new_session" });
    await client.waitFor(m => client.received.indexOf(m) >= seen && m.type === "session_replaced", 20_000);
    await eventually(records, entries => entries.some(r => r.cancelled === true || r.value === "cancelled"));
    const afterReplacement = client.received.length;
    client.send({ type: "set_thinking", level: "off" });
    const changed = await client.waitFor(m => client.received.indexOf(m) >= afterReplacement && m.type === "thinking_changed", 10_000);
    assert.equal(changed.level, "off");
  });
}
