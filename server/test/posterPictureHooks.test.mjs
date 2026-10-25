/**
 * The agent reads a poster's pictures as markers and writes them back as pictures
 * (poster-elements: TheAgentReadsAPosterFileWithPictures, TheAgentEditsAPosterFileWithPictures).
 *
 * The real server and agent, the agent driven by a scripted provider that makes the tool calls a
 * test lists and records each result the model receives: what crosses into the model's context
 * is what these check, and the file on disk after the agent's writes.
 */
import assert from "node:assert/strict";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/scripted-calls-provider.mjs", import.meta.url));
const MODEL = { provider: "scripted-calls-test", id: "scripted-calls-test" };

const BREAD = `data:image/png;base64,${"iVBOR".repeat(60_000)}`;
const SUN = `data:image/jpeg;base64,${"/9j/4".repeat(40_000)}`;
const POSTER = [
  "<!doctype html>",
  '<html><head><meta charset="utf-8"><meta name="poster-format" content="A4-portrait"><title>Menu</title>',
  '<style data-poster>.slot { width: 260px; }</style></head>',
  `<body><div class="poster-page"><div class="poster"><h1>Our menu</h1><img class="slot" data-poster-picture="bread" alt="bread" src="${BREAD}"><img alt="sun" src="${SUN}"></div></div></body></html>`,
  "",
].join("\n");

/** Runs the agent through `calls` on a project holding `files`; returns what the model read, and the project. */
async function agentRuns(t, files, calls) {
  const project = await realpath(await makeWorkspace());
  t.after(() => rm(project, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(project, name), content);
  const log = path.join(project, ".calls.jsonl");
  const script = path.join(project, ".calls.json");
  await writeFile(script, JSON.stringify(calls));
  const server = await startServer(project, { extensionPaths: [PROVIDER], allowedModels: [MODEL] }, { env: { SCRIPTED_LOG: log, SCRIPTED_CALLS_FILE: script } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "go" });
  await client.waitFor((message) => message.type === "agent_end", 60_000);
  const results = (await readFile(log, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  return { project, results };
}

// openlore: scenario=TheAgentReadsAPosterFileWithPictures spec=poster-elements
test("TheAgentReadsAPosterFileWithPictures: markers and their inventory in place of the data, the rest of the file as it is", async (t) => {
  const { results } = await agentRuns(t, { "menu.poster.html": POSTER }, [
    { name: "read", arguments: { path: "menu.poster.html" } },
    { name: "read", arguments: { path: "menu.poster.html", offset: 2, limit: 1 } },
  ]);
  const [whole, slice] = results;
  assert.equal(whole.isError, false);
  assert.ok(!whole.text.includes("base64"), "no picture data reaches the model");
  assert.match(whole.text, /<!-- poster pictures: poster-picture:1 \(bread\) 225 kB; poster-picture:2 \(sun\) 150 kB\./);
  assert.ok(whole.text.includes('data-poster-picture="bread" alt="bread" src="poster-picture:1"'));
  assert.ok(whole.text.includes('<img alt="sun" src="poster-picture:2">'));
  assert.ok(whole.text.includes('<meta name="poster-format" content="A4-portrait"><title>Menu</title>'));
  // Offset and limit cut the file as read cuts it, counted on the marked file the agent read
  // whole: the inventory is its line 1.
  assert.match(slice.text, /^<!doctype html>\n/);
  assert.match(slice.text, /\[\d+ more lines in file\. Use offset=3 to continue\.\]$/);
});

test("A poster without pictures, and a file that is not a poster, read exactly as read reads them", async (t) => {
  const plain = POSTER.replace(` src="${BREAD}"`, "").replace(`<img alt="sun" src="${SUN}">`, "");
  const page = `<p>A page</p><img src="${SUN.slice(0, 200)}">\n`;
  const { results } = await agentRuns(t, { "plain.poster.html": plain, "page.html": page }, [
    { name: "read", arguments: { path: "plain.poster.html" } },
    { name: "read", arguments: { path: "page.html" } },
  ]);
  assert.equal(results[0].text, plain);
  assert.equal(results[1].text, page);
});

// openlore: scenario=TheAgentEditsAPosterFileWithPictures spec=poster-elements
test("TheAgentEditsAPosterFileWithPictures: an edit and a whole write with markers keep both pictures on disk", async (t) => {
  const marked = POSTER.replace(BREAD, "poster-picture:1").replace(SUN, "poster-picture:2");
  const { project, results } = await agentRuns(t, { "menu.poster.html": POSTER }, [
    { name: "edit", arguments: { path: "menu.poster.html", edits: [{ oldText: 'alt="bread" src="poster-picture:1"', newText: 'alt="fresh bread" src="poster-picture:1"' }] } },
    { name: "write", arguments: { path: "menu.poster.html", content: marked.replace("Our menu", "Today's menu").replace('alt="bread"', 'alt="fresh bread"') } },
  ]);
  assert.deepEqual(results.map((result) => result.isError), [false, false], JSON.stringify(results));
  const file = await readFile(path.join(project, "menu.poster.html"), "utf8");
  assert.equal(file, POSTER.replace("Our menu", "Today's menu").replace('alt="bread"', 'alt="fresh bread"'));
});

// openlore: scenario=AnUnknownMarkerIsRefused spec=poster-elements
test("A marker naming no picture of the file blocks the write, and the file is unchanged", async (t) => {
  const { project, results } = await agentRuns(t, { "menu.poster.html": POSTER }, [
    { name: "write", arguments: { path: "menu.poster.html", content: '<img src="poster-picture:9">' } },
  ]);
  assert.equal(results[0].isError, true);
  assert.match(results[0].text, /poster-picture:9 names no picture of this poster \(it has poster-picture:1 to poster-picture:2\)/);
  assert.equal(await readFile(path.join(project, "menu.poster.html"), "utf8"), POSTER);
});
