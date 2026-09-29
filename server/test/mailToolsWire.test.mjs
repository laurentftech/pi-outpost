/**
 * Publishing an extractor for an attachment, over a real server and a real embedded
 * session.
 *
 * The rule this guards is a deliberate exception: an extractor is otherwise the user's
 * to bring back by naming a document, and nothing the agent does republishes one. An
 * unpacked attachment is the one case where this system writes the document itself, so
 * the extractor for it is published inside the turn that wrote it — without this, an
 * agent that has just unpacked an emailed deck holds a path it cannot open and no way to
 * ask for the tool.
 *
 * The assertions read the tool list the *provider* was sent, as documentToolsWire does:
 * what the snapshot says is a second-hand account, and what reached the model is what
 * can be called.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/mail-tools-provider.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/mail-outlook.msg", import.meta.url));

/** The tool names sent with each request that carried any, in order. */
async function requests(logFile) {
  const text = await readFile(logFile, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((tools) => tools.length > 0);
}

async function nthRequest(logFile, index, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await requests(logFile);
    if (all.length > index) return all[index];
    if (Date.now() > deadline) throw new Error(`request ${index} never reached the model (${all.length} so far)`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("unpacking an attachment publishes its extractor inside the turn", async () => {
  // The committed fixture carries a .pptx, a .pdf and a .txt.
  const root = await makeWorkspace({ "uploads/dossier.msg": await readFile(FIXTURE) });
  const log = path.join(root, "tools.jsonl");
  const server = await startServer(
    root,
    {
      extensionPaths: [PROVIDER],
      allowedModels: [{ provider: "mail-tools-test", id: "mail-tools-test" }],
    },
    { env: { MAIL_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 30_000);
    const published = hello.tools.filter((tool) => tool.active).map((tool) => tool.name);
    // A workspace holding a message is not a conversation about one.
    assert.ok(!published.includes("mail_extract"), "mail_extract is withheld until a message is named");
    assert.ok(!published.includes("pptx_extract"), "and so is every extractor");

    client.send({ type: "set_model", provider: "mail-tools-test", id: "mail-tools-test" });
    await client.waitFor((message) => message.type === "model_changed");

    // Naming the message publishes the mail extractor, and only that one: a `.msg`
    // says nothing about what it carries.
    client.send({ type: "prompt", text: "Read uploads/dossier.msg and open the deck inside — UNPACK IT." });
    const first = await nthRequest(log, 0);
    assert.ok(first.includes("mail_extract"), "mail_extract reached the model on the turn that named the message");
    for (const tool of ["pptx_extract", "pdf_extract", "docx_extract", "xlsx_extract"]) {
      assert.ok(!first.includes(tool), `${tool} is not published by naming a message`);
    }

    // The provider called the tool, which unpacked the attachments. The next request of
    // the same turn must carry the readers for what was written.
    const afterUnpack = await nthRequest(log, 1);
    assert.ok(afterUnpack.includes("pptx_extract"), "the deck's extractor reached the model in the same turn");
    assert.ok(afterUnpack.includes("pdf_extract"), "and the report's");
    assert.ok(afterUnpack.includes("mail_extract"), "the mail extractor is still there");
    // Nothing was published for the kinds the message does not carry.
    assert.ok(!afterUnpack.includes("xlsx_extract"), "no extractor for a kind the message never held");
    // Reading a deck is not a reason to start writing one.
    for (const tool of ["pptx_create", "pptx_update", "pptx_layouts", "docx_create"]) {
      assert.ok(!afterUnpack.includes(tool), `${tool} is not published by a write`);
    }

    // The files are really there, which is what the published tools are for.
    const written = await readFile(path.join(root, "uploads", "dossier.msg.attachments", "1-présentation.pptx"));
    assert.ok(written.length > 0, "the deck was written where the answer said it was");

    // The withdrawal rules are unchanged for a tool published this way: the turn
    // published the deck's extractor and never called it, so the guess is paid back.
    client.send({ type: "prompt", text: "Thanks, nothing else." });
    const later = await nthRequest(log, 2);
    for (const tool of ["pptx_extract", "pdf_extract"]) {
      assert.ok(!later.includes(tool), `${tool}, published and never called, is withdrawn at the end of the turn`);
    }
    // `mail_extract` was called, so it keeps the five idle turns a used tool gets —
    // the ageing rules apply to a tool published by a write exactly as they do to one
    // published by a prompt, and neither is special-cased.
    assert.ok(later.includes("mail_extract"), "the tool that was actually used survives the quiet turn after it");
  } finally {
    client.close();
    await server.stop();
  }
});
