/**
 * A reviewed PDF's comments, over a real server and a real embedded session: what the
 * model is sent when it reads the document.
 *
 * The assertions read the tool result the *provider* received — the extraction after
 * the tool's own wrapping and the session around it, which is what the model can
 * answer from.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/pdf-comments-provider.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/pdf-comments.pdf", import.meta.url));

/** The first request that carried a tool result, once it exists. */
async function firstResult(logFile, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await readFile(logFile, "utf8").catch(() => "");
    const found = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((request) => request.results.length > 0);
    if (found !== undefined) return found.results[0];
    if (Date.now() > deadline) throw new Error("no tool result ever reached the model");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("the model reading a reviewed PDF is sent its comments, announced before the text", async () => {
  const root = await makeWorkspace({ "reviewed.pdf": await readFile(FIXTURE) });
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(
    root,
    {
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "pdf-comments-test", id: "pdf-comments-test" }],
    },
    { env: { PDF_COMMENTS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello", 30_000);
    client.send({ type: "set_model", provider: "pdf-comments-test", id: "pdf-comments-test" });
    await client.waitFor((message) => message.type === "model_changed");

    client.send({ type: "prompt", text: "What did the reviewers say about reviewed.pdf?" });
    const result = await firstResult(log);

    assert.match(result, /^> This document carries 9 review comments/, "the notice leads what the model reads");
    assert.ok(result.indexOf("review comments") < result.indexOf("## Page 1"));
    assert.match(result, /- \*\*Highlight\*\* — Marie Dupont, 2026-09-12, on "the delivery date":\n {2}> To confirm with the client\./);
    assert.match(result, / {2}- State: \*\*Accepted\*\* — Paul Martin, 2026-09-14/);
    assert.match(result, /- \*\*Suggested deletion\*\* — Marie Dupont, 2026-09-12, on "in any event"/);
    assert.doesNotMatch(result, /^## Page 9/m, "a remark does not reach the model as a page of its own");
  } finally {
    client.close();
    await server.stop();
  }
});
