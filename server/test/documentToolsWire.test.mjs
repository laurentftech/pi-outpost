/**
 * The extractors, over a real server and a real embedded session: withheld until a
 * document is named, published before the turn that names it goes out, and kept for the
 * rest of the session.
 *
 * The assertions read the tool list the *provider* was sent. What the snapshot says the
 * server published is a second-hand account; what the model received is the thing that
 * costs tokens and the thing it can call.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/document-tools-provider.mjs", import.meta.url));
const EXTRACTORS = ["pdf_extract", "docx_extract", "xlsx_extract", "pptx_extract"];

/**
 * The tool names sent with each request that carried any, in order.
 *
 * Not every request is a turn: naming a session is a model call of its own, made with no
 * tools at all. Counting raw requests puts the assertions one behind from the first turn
 * onward.
 */
async function requests(logFile) {
  const text = await readFile(logFile, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((tools) => tools.length > 0);
}

/**
 * The nth request's tool list, once it exists.
 *
 * Counting `agent_end` frames to know which turn we are on is what the first draft did,
 * and it is a race: the harness resolves a waiter against any received message the
 * predicate accepts, so a count taken later matches an earlier frame. The log is the
 * thing being asserted, so wait on the log.
 */
async function nthRequest(logFile, index, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await requests(logFile);
    if (all.length > index) return all[index];
    if (Date.now() > deadline) throw new Error(`request ${index} never reached the model (${all.length} so far)`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("a document extractor is published when a document is named, and not before", async () => {
  const root = await makeWorkspace({ "report.docx": "not really a docx\n" });
  const log = path.join(root, "tools.jsonl");
  const server = await startServer(
    root,
    {
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "document-tools-test", id: "document-tools-test" }],
    },
    { env: { DOCUMENT_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 30_000);
    // The workspace holds a .docx that nothing has named: containing one is not using one.
    const published = hello.tools.filter((tool) => tool.active).map((tool) => tool.name);
    for (const tool of EXTRACTORS) {
      assert.ok(!published.includes(tool), `${tool} is withheld from a session that has named no document`);
    }
    assert.ok(published.includes("read"), "the rest of the toolset is untouched");

    client.send({ type: "set_model", provider: "document-tools-test", id: "document-tools-test" });
    await client.waitFor((message) => message.type === "model_changed");

    // A turn that names nothing leaves them all withheld.
    client.send({ type: "prompt", text: "Just say ok." });
    const plain = await nthRequest(log, 0);
    for (const tool of EXTRACTORS) assert.ok(!plain.includes(tool), `${tool} not sent for a prompt naming no document`);

    // Naming one publishes its extractor, for the very turn that named it.
    client.send({ type: "prompt", text: "Read report.docx and tell me what it says." });
    const named = await nthRequest(log, 1);
    assert.ok(named.includes("docx_extract"), "docx_extract reached the model on the turn that named the document");
    for (const tool of ["pdf_extract", "xlsx_extract", "pptx_extract"]) {
      assert.ok(!named.includes(tool), `${tool} stays withheld: no document of its kind was named`);
    }

    // Registered last, so a caching provider keeps everything ahead of them.
    assert.equal(named.at(-1), "docx_extract", "the extractors sit at the end of the tool list");

    // The turn named a document and never called the tool, so the guess is paid back:
    // the next request carries none of them again.
    client.send({ type: "prompt", text: "Thanks, nothing else." });
    const after = await nthRequest(log, 2);
    assert.ok(!after.includes("docx_extract"), "a tool published and never called is withdrawn at the end of the turn");

    // Named *and used*: that one stays, because extraction is rarely a single call and
    // an agent has no way to ask for a tool back.
    client.send({ type: "prompt", text: "Read report.docx — USE THE TOOL." });
    await nthRequest(log, 3);
    const afterUse = await nthRequest(log, 4);
    assert.ok(afterUse.includes("docx_extract"), "the tool is still there for the follow-up call in that turn");

    // A tool that has been used survives the quiet turns around the work it belongs to.
    // Five of them: the turn that called it is not one of its idle turns, which is a
    // distinction Codex caught — ageing it at the end of the turn that used it spent the
    // first of five on the work itself.
    let request = 5;
    for (let turn = 1; turn <= 5; turn += 1) {
      client.send({ type: "prompt", text: `Quiet turn ${turn}.` });
      const during = await nthRequest(log, request++);
      assert.ok(during.includes("docx_extract"), `a used tool survives ${turn} idle turn(s)`);
      assert.ok(!during.includes("pdf_extract"), "and stays narrow");
    }

    // ...and is forgotten once the conversation has plainly moved on.
    client.send({ type: "prompt", text: "Quiet turn 6." });
    const forgotten = await nthRequest(log, request);
    assert.ok(!forgotten.includes("docx_extract"), "five idle turns after its last call, and a used tool is forgotten");

    // Naming the document again brings it back: the only way back, and the user's to take.
    client.send({ type: "prompt", text: "Look at report.docx once more." });
    const republished = await nthRequest(log, request + 1);
    assert.ok(republished.includes("docx_extract"), "naming the document republishes its extractor");
  } finally {
    client.close();
    await server.stop();
  }
});
