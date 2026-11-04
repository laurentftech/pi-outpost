import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
const PROVIDER = fileURLToPath(
  new URL("./fixtures/scripted-tools-provider.mjs", import.meta.url),
);
const DECK = fileURLToPath(
  new URL("./fixtures/pptx-order.pptx", import.meta.url),
);
const call = 'STEPS:[{"tool":"pptx_extract","args":{"path":"deck"}}]';
test("a resumed PowerPoint tool survives four quiet turns and a direct call reactivates an expired tool", async () => {
  const root = await makeWorkspace();
  await copyFile(DECK, path.join(root, "deck"));
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(
    root,
    {
      extensionPaths: [PROVIDER],
      allowedModels: [
        { provider: "scripted-tools-test", id: "scripted-tools-test" },
      ],
    },
    { env: { SCRIPTED_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  const next = (seen, type) =>
    client.waitFor(
      (m) => client.received.indexOf(m) >= seen && m.type === type,
      30_000,
    );
  const run = async (text) => {
    const seen = client.received.length;
    client.send({ type: "prompt", text });
    await next(seen, "agent_end");
  };
  const requests = async () =>
    (await readFile(log, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map(JSON.parse)
      .filter((r) => r.tools.length);
  try {
    await client.waitFor("hello", 30_000);
    client.send({
      type: "set_model",
      provider: "scripted-tools-test",
      id: "scripted-tools-test",
    });
    await client.waitFor("model_changed");
    await run(`Read presentation.pptx. ${call}`);
    for (let i = 0; i < 4; i++) await run(`Quiet ${i}`);
    let seen = client.received.length;
    client.send({ type: "list_sessions" });
    const listed = await next(seen, "sessions");
    const saved = listed.sessions[0];
    assert.ok(saved?.path);
    seen = client.received.length;
    client.send({ type: "switch_session", path: saved.path });
    await next(seen, "session_replaced");
    let before = (await requests()).length;
    await run(`Reuse the tool. ${call}`);
    const reused = (await requests()).slice(before);
    assert.ok(
      reused[0].tools.includes("pptx_extract"),
      "resumed tool declared before request",
    );
    assert.match(reused.at(-1).results[0], /Third in the file/);
    assert.doesNotMatch(
      reused.at(-1).results[0],
      /not found|Error reading|does not exist/i,
    );
    for (let i = 0; i < 5; i++) await run(`Unrelated ${i}`);
    before = (await requests()).length;
    await run(call);
    const direct = (await requests()).slice(before);
    assert.ok(
      !direct[0].tools.includes("pptx_extract"),
      "expired schema hidden",
    );
    assert.match(direct.at(-1).results[0], /Third in the file/);
    assert.doesNotMatch(
      direct.at(-1).results[0],
      /not found|Error reading|does not exist/i,
    );
    assert.ok(
      direct.at(-1).tools.includes("pptx_extract"),
      "direct call republishes tool",
    );
    await run('STEPS:[{"tool":"invented_extract","args":{}}]');
    assert.match((await requests()).at(-1).results[0], /not found/i);
    await run('STEPS:[{"tool":"pptx_extract","args":{"path":"../outside"}}]');
    assert.match(
      (await requests()).at(-1).results[0],
      /outside|denied|sandbox/i,
    );
  } finally {
    client.close();
    await server.stop();
  }
});

test("direct reuse cannot revive a tool excluded by the configured allowlist", async () => {
  const root = await makeWorkspace();
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(
    root,
    {
      sandbox: false,
      tools: ["read"],
      extensionPaths: [PROVIDER],
      allowedModels: [
        { provider: "scripted-tools-test", id: "scripted-tools-test" },
      ],
    },
    { env: { SCRIPTED_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello", 30_000);
    client.send({
      type: "set_model",
      provider: "scripted-tools-test",
      id: "scripted-tools-test",
    });
    await client.waitFor("model_changed");
    client.send({ type: "prompt", text: call });
    await client.waitFor("agent_end", 30_000);
    const requests = (await readFile(log, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map(JSON.parse)
      .filter((r) => r.tools.length);
    assert.match(requests.at(-1).results[0], /Tool pptx_extract not found/);
    assert.ok(requests.every((r) => !r.tools.includes("pptx_extract")));
  } finally {
    client.close();
    await server.stop();
  }
});
