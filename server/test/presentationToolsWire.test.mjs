/**
 * The presentation tools over a real server and a real embedded session: withheld
 * until a template is named or the skill is loaded, and then used end to end — the
 * agent lists the layouts, builds a deck into the workspace, and renders it.
 *
 * The "model" is scripted (fixtures/presentation-tools-provider.mjs). What is asserted
 * is what reached it: the tool lists it was sent, and the results it was handed back.
 */
import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/presentation-tools-provider.mjs", import.meta.url));
const TEMPLATE = fileURLToPath(new URL("./fixtures/pptx-template.potx", import.meta.url));
const SKILL_DIR = fileURLToPath(new URL("../../skills/pptx-from-template", import.meta.url));
const PRESENTATION = ["pptx_layouts", "pptx_create", "pptx_render"];

async function lines(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** The nth request that carried tools — a session-naming call carries none. */
async function nthRequest(file, index, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = (await lines(file)).filter((tools) => tools.length > 0);
    if (all.length > index) return all[index];
    if (Date.now() > deadline) throw new Error(`request ${index} never reached the model (${all.length} so far)`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function results(file, count, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await lines(file);
    if (all.length >= count) return all;
    if (Date.now() > deadline) throw new Error(`only ${all.length} of ${count} tool results arrived`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function start() {
  const root = await makeWorkspace({
    "diagram.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#2563EB"/></svg>',
  });
  await copyFile(TEMPLATE, path.join(root, "brand.potx"));
  const toolsLog = path.join(root, "tools.jsonl");
  const resultsLog = path.join(root, "results.jsonl");
  const server = await startServer(
    root,
    {
      extensionPaths: [PROVIDER],
      skillPaths: [SKILL_DIR],
      allowedModels: [{ provider: "presentation-tools-test", id: "presentation-tools-test" }],
    },
    { env: { DOCUMENT_TOOLS_LOG: toolsLog, PRESENTATION_RESULTS_LOG: resultsLog } },
  );
  const client = connect(server.wsUrl());
  const hello = await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", provider: "presentation-tools-test", id: "presentation-tools-test" });
  await client.waitFor((message) => message.type === "model_changed");
  return { root, toolsLog, resultsLog, server, client, hello };
}

test("the presentation tools are withheld until a template is named, then offered for that turn", async () => {
  const { toolsLog, server, client, hello } = await start();
  try {
    const published = hello.tools.filter((tool) => tool.active).map((tool) => tool.name);
    for (const tool of PRESENTATION) assert.ok(!published.includes(tool), `${tool} is withheld from a fresh session`);
    // Registered: this sandbox allows writing, so the builder exists to be published.
    for (const tool of PRESENTATION) assert.ok(hello.tools.some((entry) => entry.name === tool), `${tool} is registered`);

    client.send({ type: "prompt", text: "Just say ok." });
    const plain = await nthRequest(toolsLog, 0);
    for (const tool of PRESENTATION) assert.ok(!plain.includes(tool), `${tool} not sent for a prompt naming no template`);

    client.send({ type: "prompt", text: "Make a deck from brand.potx about our quarter." });
    const named = await nthRequest(toolsLog, 1);
    for (const tool of PRESENTATION) assert.ok(named.includes(tool), `${tool} reached the model on the turn that named the template`);
    // A template is not a deck to read.
    assert.ok(!named.includes("pptx_extract"), "naming a .potx does not publish the extractor");
  } finally {
    client.close();
    await server.stop();
  }
});

test("loading the skill publishes the tools inside the same turn", async () => {
  const { toolsLog, server, client } = await start();
  try {
    client.send({ type: "prompt", text: `READ THE SKILL ${path.join(SKILL_DIR, "SKILL.md")}` });
    const before = await nthRequest(toolsLog, 0);
    for (const tool of PRESENTATION) assert.ok(!before.includes(tool), `${tool} not there before the skill is read`);
    const after = await nthRequest(toolsLog, 1);
    for (const tool of PRESENTATION) assert.ok(after.includes(tool), `${tool} offered on the request after the agent read the skill`);
  } finally {
    client.close();
    await server.stop();
  }
});

test("the agent lists the layouts, builds a deck with a picture, a table and a chart, and renders it", async () => {
  const { root, resultsLog, server, client } = await start();
  try {
    client.send({ type: "prompt", text: "BUILD THE DECK from brand.potx" });
    const [layouts, created, rendered] = await results(resultsLog, 3);

    assert.equal(layouts.tool, "pptx_layouts");
    assert.equal(layouts.isError, false);
    assert.match(layouts.text, /\| 3 \| Two Content \| twoObj \| title, content, content \|/);

    assert.equal(created.tool, "pptx_create");
    assert.equal(created.isError, false, created.text);
    assert.match(created.text, /Wrote 4 slide\(s\) to `deck\.pptx`/);
    const deck = await readFile(path.join(root, "deck.pptx"));
    assert.equal(deck.subarray(0, 2).toString("latin1"), "PK");

    assert.equal(rendered.tool, "pptx_render");
    // An office application is what this step needs, and CI runners have none: there the
    // result must say so and name what to install; where one exists, the agent gets
    // a picture of every slide and a clean text check.
    if (rendered.isError) {
      assert.match(rendered.text, /No office application could render the presentation[\s\S]*Install LibreOffice/);
    } else {
      assert.match(rendered.text, /^Rendered `deck\.pptx` with (PowerPoint|LibreOffice|ONLYOFFICE): 4 page\(s\) for 4 slide\(s\)\./);
      // The table's cells are checked too: they are paragraphs of the slide.
      assert.match(rendered.text, /Text check: every paragraph of slides 1-4 is visible/);
      assert.equal(rendered.images, 4);
    }
  } finally {
    client.close();
    await server.stop();
  }
});
