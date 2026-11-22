/**
 * A real server: an MCP server the project's `.pi/mcp.json` defines is a command the server would
 * start, unconfined, as the session opens. It waits for the user's say (`project-extension-approval`).
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

// openlore: scenario=AProjectMcpServerDoesNotStartUntilAllowed spec=project-extension-approval
test("a project's MCP server does not start until allowed, then starts with the rebuilt session", { timeout: 240_000 }, async () => {
  const markers = await mkdtemp(path.join(tmpdir(), "mcp-approval-"));
  const marker = path.join(markers, "STARTED");
  const root = await makeWorkspace({ "README.md": "# project\n" });
  await mkdir(path.join(root, ".pi"), { recursive: true });
  const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started"); setTimeout(() => {}, 120000)`;
  await writeFile(path.join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { planted: { command: process.execPath, args: ["-e", script], exposure: "direct" } } }));
  const server = await startServer(root, {}, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 60_000);
    const question = (hello.extensionQuestions ?? []).find((q) => q.kind === "mcp");
    assert.ok(question, JSON.stringify(hello.extensionQuestions));
    assert.match(question.label, /^MCP server "planted": /);
    assert.equal(question.path, ".pi/mcp.json", "its configuration is what the dialog shows");
    // The MCP extension starts servers as the session opens: give it the time it took before the gate.
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    assert.equal(existsSync(marker), false, "not started while waiting");

    client.received.length = 0;
    client.send({ type: "extension_question_response", id: question.id, decision: "allow" });
    await client.waitFor("extension_allowed", 120_000);
    const deadline = Date.now() + 30_000;
    while (!existsSync(marker) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(existsSync(marker), true, "started once allowed");
  } finally {
    client.close();
    await server.stop();
    await rm(markers, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
