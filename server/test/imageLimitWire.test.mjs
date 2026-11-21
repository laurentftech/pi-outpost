/**
 * #526: a model that accepts at most 4 images per request, behind a gateway that refuses
 * more, given a PDF to look at. The provider plays the gateway (see
 * fixtures/image-limit-provider.mjs) and logs, for every request, how many images it
 * carried and the tool result it answers.
 */
import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/image-limit-provider.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const MODEL = { provider: "image-limit-test", id: "four-images" };

/** Every request logged so far, once `count` of them answer a tool result. */
async function untilResults(log, count, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = (await readFile(log, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    if (lines.filter((line) => line.result !== null).length >= count) return lines;
    if (Date.now() > deadline) throw new Error(`${count} tool results expected: ${JSON.stringify(lines)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// openlore: scenario=AToolNeverReturnsMoreImagesThanTheModelTakes spec=pdf-documents
// openlore: scenario=ARequestKeepsItsNewestImagesWithinTheLimit spec=pdf-documents
test("a model taking 4 images per request: pdf_render draws 4, and two renders never send more than 4", async (t) => {
  const root = await makeWorkspace();
  await copyFile(path.join(FIXTURES, "pdf-long.pdf"), path.join(root, "long.pdf"));
  const log = path.join(root, "images.jsonl");
  const server = await startServer(root, { extensionPaths: [PROVIDER], allowedModels: [MODEL] }, { env: { IMAGE_LIMIT_LOG: log } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");

  // Ten pages asked for. Eight used to come back, in one result the gateway refused.
  client.send({ type: "prompt", text: "Look at long.pdf: RENDER 1-10" });
  const first = (await untilResults(log, 1)).find((line) => line.result !== null).result;
  assert.equal(first.images, 4, `the tool draws no more pages than the model takes: ${first.text}`);
  assert.match(first.text, /at most 4 per call: the active model accepts at most 4 images per request/);
  assert.match(first.text, /pages="5-10"/, "and says how to ask for the rest");
  await client.waitFor((message) => message.type === "agent_end", 60_000);

  // A second render in the same conversation: 8 images in the history, 4 allowed.
  client.send({ type: "prompt", text: "Now long.pdf: RENDER 5-8" });
  const sent = await untilResults(log, 2);
  for (const [index, request] of sent.entries()) {
    assert.ok(request.images <= 4, `request ${index} carried ${request.images} images, past the model's 4: ${JSON.stringify(request.roles)}`);
  }
  const second = sent.filter((line) => line.result !== null)[1];
  assert.equal(second.result.images, 4, "the new pages reached the model whole");
  assert.equal(second.images, 4, "the older pages gave way to the newest four");
  // The older pages' places say why they are gone, rather than vanishing.
  assert.ok(second.roles.some((role) => role.startsWith("toolResult:") && !role.includes("image")), JSON.stringify(second.roles));
  // The gateway would have answered with an error otherwise: nothing on the wire says so.
  assert.ok(!client.received.some((message) => /At most 4 image/.test(JSON.stringify(message))), "the gateway refused nothing");
});
