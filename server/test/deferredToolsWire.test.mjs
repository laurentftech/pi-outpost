/**
 * The deferred on-demand tools, over a real server and a real embedded session: not declared
 * until published or searched for, reachable all along, and aged once loaded.
 *
 * The assertions read what the provider was sent — the declared tools, the system prompt —
 * and the tool results it was handed back, not the server's account of either.
 */
import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { DEFERRED_TOOLS } from "../src/documentTools.ts";

const PROVIDER = fileURLToPath(new URL("./fixtures/scripted-tools-provider.mjs", import.meta.url));
const REACH_XLSX = fileURLToPath(new URL("./fixtures/reach-xlsx-extension.mjs", import.meta.url));
const WORKBOOK = fileURLToPath(new URL("./fixtures/xlsx-grid.xlsx", import.meta.url));

/** Each request the provider recorded that declared any tool, in order. */
async function requests(log) {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((request) => request.tools.length > 0);
}

async function nthRequest(log, index, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const all = await requests(log);
    if (all.length > index) return all[index];
    if (Date.now() > deadline) throw new Error(`request ${index} never reached the model (${all.length} so far)`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const declaredOnDemand = (request) => request.tools.filter((tool) => DEFERRED_TOOLS.includes(tool));
const steps = (...list) => `STEPS:${JSON.stringify(list)}`;
const DIAGRAM_POSTER_STRUCTURE_SEARCHES = [
  ["check a draw.io diagram for errors", "drawio_check"],
  ["check a poster for errors", "poster_check"],
  ["look at the pictures inside a poster", "poster_pictures"],
  ["compare two planning timelines", "compare_timelines"],
  ["draw a structured exchange graph as an SVG figure", "write_structure_figure"],
  ["write a structured exchange table as Markdown", "write_structure_table"],
];

function searchSteps() {
  return DIAGRAM_POSTER_STRUCTURE_SEARCHES.map(([query]) => ({ tool: "tool_search", args: { query } }));
}

async function assertSearchesLoadedInOrder(log) {
  const first = await nthRequest(log, 0);
  assert.deepEqual(declaredOnDemand(first), [], "none of the six is declared before a search");
  for (const [index, [, expected]] of DIAGRAM_POSTER_STRUCTURE_SEARCHES.entries()) {
    const loaded = await nthRequest(log, index + 1);
    assert.ok(loaded.tools.includes(expected), `${expected} is declared after its search; got ${loaded.tools.join(", ")}`);
  }
}

async function scriptedServer(config = {}, extensionPaths = [PROVIDER]) {
  const root = await makeWorkspace({});
  await copyFile(WORKBOOK, path.join(root, "book.xlsx"));
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(
    root,
    { extensionPaths, allowedModels: [{ provider: "scripted-tools-test", id: "scripted-tools-test" }], ...config },
    { env: { SCRIPTED_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", provider: "scripted-tools-test", id: "scripted-tools-test" });
  await client.waitFor((message) => message.type === "model_changed");
  return { server, client, log };
}

test("A code session declares none, and can still reach them", async () => {
  const { server, client, log } = await scriptedServer({}, [PROVIDER, REACH_XLSX]);
  try {
    client.send({ type: "prompt", text: `Read the workbook. ${steps({ tool: "reach_xlsx" })}` });
    const first = await nthRequest(log, 0);
    assert.deepEqual(declaredOnDemand(first), [], "no on-demand tool is declared to a session that named no document");
    // The scenarios "The system prompt says where the tools are" too: both, on every request.
    assert.ok(first.tools.includes("tool_search"), "tool_search is declared");
    assert.equal(first.hint, true, "the system prompt says the deferred tools load with tool_search");
    const second = await nthRequest(log, 1);
    assert.equal(second.results.length, 1);
    assert.match(second.results[0], /^isError=false /, "xlsx_extract ran, though it was never declared");
    assert.match(second.results[0], /\| *A *\|/, "and returned the workbook as a table");
  } finally {
    client.close();
    await server.stop();
  }
});

test("Searching loads the tool for the next call", async () => {
  const { server, client, log } = await scriptedServer();
  try {
    client.send({ type: "prompt", text: steps({ tool: "tool_search", args: { query: "read an Excel spreadsheet" } }) });
    assert.ok(!(await nthRequest(log, 0)).tools.includes("xlsx_extract"), "not declared before the search");
    assert.ok((await nthRequest(log, 1)).tools.includes("xlsx_extract"), "declared on the next request of the same turn");
  } finally {
    client.close();
    await server.stop();
  }
});

test("The embedded runtime loads each diagram, poster and structure tool on demand", async () => {
  const { server, client, log } = await scriptedServer();
  try {
    client.send({ type: "prompt", text: steps(...searchSteps()) });
    await assertSearchesLoadedInOrder(log);
  } finally {
    client.close();
    await server.stop();
  }
});

test("A loaded tool survives the turn that loaded it", async () => {
  const { server, client, log } = await scriptedServer();
  try {
    // Called on a path that does not exist: an error result is still a call.
    client.send({
      type: "prompt",
      text: steps({ tool: "tool_search", args: { query: "Excel" } }, { tool: "xlsx_extract", args: { path: "nothing-here" } }),
    });
    await nthRequest(log, 2);
    client.send({ type: "prompt", text: "Next." });
    assert.ok((await nthRequest(log, 3)).tools.includes("xlsx_extract"), "a searched tool that was called is still declared on the next turn");
  } finally {
    client.close();
    await server.stop();
  }
});

test("A loaded tool nobody calls is withdrawn", async () => {
  const { server, client, log } = await scriptedServer();
  try {
    client.send({ type: "prompt", text: steps({ tool: "tool_search", args: { query: "PDF document" } }) });
    const loaded = declaredOnDemand(await nthRequest(log, 1));
    assert.ok(loaded.includes("pdf_extract"), "the search loaded the PDF extractor");
    client.send({ type: "prompt", text: "Next." });
    assert.deepEqual(declaredOnDemand(await nthRequest(log, 2)), [], "every tool the search loaded and nobody called is withdrawn");
  } finally {
    client.close();
    await server.stop();
  }
});

test("Without extensions nothing is added", async () => {
  const { server, client, log } = await scriptedServer({ noExtensions: true });
  try {
    client.send({ type: "prompt", text: "Hello." });
    const first = await nthRequest(log, 0);
    assert.ok(!first.tools.includes("tool_search"), "tool_search is not declared");
    assert.equal(first.hint, false, "the system prompt says nothing about it");
    assert.deepEqual(declaredOnDemand(first), []);
  } finally {
    client.close();
    await server.stop();
  }
});

const REAL_PI = fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url));

/**
 * The RPC child cannot be told to publish or withdraw anything. It used to declare every
 * on-demand tool on every request; deferred, it declares none until the agent searches,
 * and keeps what it loaded, as vanilla pi does.
 */
test("The RPC child loads and keeps a searched tool, and declares none before", async () => {
  const root = await makeWorkspace({});
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(
    root,
    {
      sandbox: false,
      agentRuntime: {
        mode: "rpc",
        executable: process.execPath,
        args: [REAL_PI, "--provider", "scripted-tools-test", "--model", "scripted-tools-test", "--api-key", "test", "--extension", PROVIDER, "--no-approve"],
        startupTimeoutMs: 15_000,
      },
    },
    { env: { SCRIPTED_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello", 30_000);
    client.send({ type: "prompt", text: steps({ tool: "tool_search", args: { query: "Excel" } }) });
    // "A runtime that cannot gate publishes them all", as it now reads: it declares none.
    const first = await nthRequest(log, 0);
    assert.deepEqual(declaredOnDemand(first), [], "the child declares no on-demand tool before a search");
    assert.ok(first.tools.includes("tool_search"), "and declares tool_search");
    assert.equal(first.hint, true, "and its system prompt says so");
    assert.ok((await nthRequest(log, 1)).tools.includes("xlsx_extract"), "the search loads xlsx_extract for the next call");
    await client.waitFor("agent_end", 30_000);
    client.send({ type: "prompt", text: "Next." });
    assert.ok((await nthRequest(log, 2)).tools.includes("xlsx_extract"), "the child keeps it declared on that branch");
  } finally {
    client.close();
    await server.stop();
  }
});

test("The RPC child loads each diagram, poster and structure tool on demand", async () => {
  const root = await makeWorkspace({});
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(
    root,
    {
      sandbox: false,
      agentRuntime: {
        mode: "rpc",
        executable: process.execPath,
        args: [REAL_PI, "--provider", "scripted-tools-test", "--model", "scripted-tools-test", "--api-key", "test", "--extension", PROVIDER, "--no-approve"],
        startupTimeoutMs: 15_000,
      },
    },
    { env: { SCRIPTED_TOOLS_LOG: log } },
  );
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello", 30_000);
    client.send({ type: "prompt", text: steps(...searchSteps()) });
    await assertSearchesLoadedInOrder(log);
  } finally {
    client.close();
    await server.stop();
  }
});
