/**
 * Probe (poster-insert task 1.1): can pi-outpost keep picture data out of what the agent reads
 * of a `.poster.html` and put it back in what the agent writes, with pi's extension events?
 *
 * Runs the real server with the agent driven by a scripted provider and the stand-in hiding
 * extension (poster-agent-hooks-ext.mjs), on a poster whose picture is one line of 200 kB:
 *
 *   1. `read` of the poster returns the marker, not the data (pi's own read refuses the line);
 *   2. `write` of the poster with the marker writes the picture back;
 *   3. `edit` whose oldText holds the marker matches the file and keeps the picture.
 *
 * Run: node --import tsx scripts/probes/poster-agent-hooks.mts
 */
import assert from "node:assert/strict";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- the test harness is plain JavaScript
import { connect, makeWorkspace, startServer } from "../../server/test/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER = path.resolve(here, "../../server/test/fixtures/scripted-calls-provider.mjs");
const HOOKS = path.resolve(here, "poster-agent-hooks-ext.mjs");
const MODEL = { provider: "scripted-calls-test", id: "scripted-calls-test" };

const project = await realpath(await makeWorkspace());
const picture = `data:image/png;base64,${"A".repeat(200_000)}`;
const poster = `<!doctype html>\n<html><body><div class="poster-page"><h1>Bread</h1><img class="slot" src="${picture}"></div></body></html>\n`;
await writeFile(path.join(project, "menu.poster.html"), poster);

const calls = [
  { name: "read", arguments: { path: "menu.poster.html" } },
  { name: "write", arguments: { path: "menu.poster.html", content: poster.replace(picture, "poster-picture:1").replace("Bread", "Fresh bread") } },
  { name: "edit", arguments: { path: "menu.poster.html", edits: [{ oldText: '<img class="slot" src="poster-picture:1">', newText: '<img class="slot wide" src="poster-picture:1">' }] } },
];
const log = path.join(project, "calls.jsonl");
const callsFile = path.join(project, "calls.json");
await writeFile(callsFile, JSON.stringify(calls));
const server = await startServer(project, { extensionPaths: [PROVIDER, HOOKS], allowedModels: [MODEL] }, { env: { SCRIPTED_LOG: log, SCRIPTED_CALLS_FILE: callsFile } });
const client = connect(server.wsUrl());
try {
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "go" });
  await client.waitFor((message: { type: string }) => message.type === "agent_end", 60_000);
  const results = (await readFile(log, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { name: string; isError: boolean; text: string });
  console.log(results.map((result) => `${result.name}: error=${result.isError} ${result.text.slice(0, 160)}`).join("\n"));
  const after = await readFile(path.join(project, "menu.poster.html"), "utf8");
  console.log(`file: ${after.length} chars, picture kept: ${after.includes(picture)}, "Fresh bread": ${after.includes("Fresh bread")}, slot wide: ${after.includes('class="slot wide"')}, marker left: ${after.includes("poster-picture:")}`);
  assert.match(results[0]!.text, /poster-picture:1/);
  assert.ok(!results[0]!.text.includes("AAAA"), "the read holds no picture data");
  assert.ok(after.includes(picture) && after.includes("Fresh bread") && after.includes('class="slot wide"') && !after.includes("poster-picture:"));
  console.log("probe: hooks can hide on read and restore on write and edit");
} finally {
  client.close();
  await server.stop();
  await rm(project, { recursive: true, force: true });
}
