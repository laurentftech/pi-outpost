/**
 * Calls a codemode script makes are the script's, not the model's.
 *
 * The SDK runs them through `ctx.executeTool()` and reports each with `tool_execution_*`
 * events carrying `parentToolCallId`; it records them on the codemode result as
 * `nestedCalls`, and persists no result of their own. pi-outpost forwarded those events
 * as ordinary tool calls: every call a script made appeared as a card of its own after
 * the codemode one, as if the model had made it — and disappeared on reload, where only
 * the persisted codemode result remains.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const CODEMODE_PROVIDER = fileURLToPath(new URL("./fixtures/codemode-provider.mjs", import.meta.url));

async function codemodeTurn(t) {
  const root = await makeWorkspace({ "inside.txt": "INSIDE-MARKER" });
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), "codemode nested-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  const outside = path.join(elsewhere, "secret.txt");
  await writeFile(outside, "OUTSIDE-MARKER");
  const agentDir = path.join(root, ".pi-agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ defaultTools: ["+codemode"] }));
  const log = path.join(elsewhere, "codemode-result.txt");
  const server = await startServer(
    root,
    { extensionPaths: [CODEMODE_PROVIDER], allowedModels: [{ provider: "codemode-test", id: "codemode-test" }] },
    { env: { CODEMODE_LOG: log } },
  );
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", provider: "codemode-test", id: "codemode-test" });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: `RUN CODEMODE ${outside}` });
  try {
    await client.waitFor("agent_end", 60_000);
  } catch (error) {
    throw new Error(`${error.message}\n${server.log()}\n${JSON.stringify(client.received)}`);
  }
  return { server, client, log, outside };
}

const toolMessages = (client) => client.received.filter((m) => m.type === "tool_start" || m.type === "tool_update" || m.type === "tool_end");
/** The script's two calls, as codemode's renderer lists them: name and arguments. */
const listsBothReads = (html) => typeof html === "string" && (html.match(/>read</g) ?? []).length === 2 && html.includes("inside.txt");

// openlore: scenario=AScriptsCallsAreNotTheModels spec=tool-result-presentations
test("AScriptsCallsAreNotTheModels: one card for the codemode call, which lists the script's calls", async (t) => {
  const { client } = await codemodeTurn(t);
  const starts = client.received.filter((m) => m.type === "tool_start");
  assert.deepEqual(starts.map((m) => m.toolName), ["codemode"], "only the call the model made is a card");
  const id = starts[0].toolCallId;
  assert.deepEqual(
    [...new Set(toolMessages(client).map((m) => m.toolCallId))],
    [id],
    "no message about the script's own calls reaches the client as a tool of its own",
  );
  const end = client.received.find((m) => m.type === "tool_end" && m.toolCallId === id);
  assert.ok(listsBothReads(end.outputHtml), "the codemode card lists both calls of the script");
  assert.ok(end.outputHtml.includes("secret.txt"), "the refused call stays visible");
  assert.equal(end.outputHtml.includes("OUTSIDE-MARKER"), false, "no outside content leaks into the card");
});

// openlore: scenario=AScriptsCallsShowWhileItRuns spec=tool-result-presentations
test("AScriptsCallsShowWhileItRuns: the codemode card lists the calls before the script has finished", async (t) => {
  const { client } = await codemodeTurn(t);
  const endAt = client.received.findIndex((m) => m.type === "tool_end");
  const live = client.received.slice(0, endAt).filter((m) => m.type === "tool_update" && typeof m.outputHtml === "string");
  assert.ok(live.length > 0, "a partial result drawn by codemode's renderer arrives before the end");
  assert.ok(live.some((m) => m.outputHtml.includes(">read<")), "and names the call being made");
});

// openlore: scenario=AScriptsCallsReadTheSameAfterAReload spec=tool-result-presentations
test("AScriptsCallsReadTheSameAfterAReload: a client connecting afterwards sees the same single card", async (t) => {
  const { server, client } = await codemodeTurn(t);
  const live = client.received.find((m) => m.type === "tool_end");
  const later = connect(server.wsUrl());
  t.after(() => later.close());
  const hello = await later.waitFor("hello", 30_000);
  const tools = hello.items.filter((item) => item.kind === "tool");
  assert.deepEqual(tools.map((item) => item.toolName), ["codemode"]);
  assert.ok(listsBothReads(tools[0].outputHtml), "the list is rebuilt from the persisted result");
  assert.equal(tools[0].outputHtml, live.outputHtml, "and reads exactly as it did live");
});
