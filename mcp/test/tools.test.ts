/**
 * The tools as a host sees them: driven through the SDK's client over an in-memory
 * transport, against a real store in a temporary folder.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { CREATE_DESCRIPTION, CREATION_EXAMPLE, SHOW_PLANNING_DESCRIPTION, UPDATE_DESCRIPTION } from "@pi-outpost/apps-core/descriptions";
import { openApiDocument } from "../../openwebui/src/openapi.ts";
import { createServer, viewUriFor } from "../src/server.ts";
import { LocalPlanningStore } from "../src/store.ts";

const VIEW_FILE = fileURLToPath(new URL("../dist/viewer/planning.html", import.meta.url));
const VIEW_HTML = await fs.readFile(VIEW_FILE, "utf8");
const VIEW_URI = viewUriFor(VIEW_HTML);
const temporary: string[] = [];
after(async () => {
  for (const dir of temporary) await fs.rm(dir, { recursive: true, force: true });
});

interface Connected {
  client: Client;
  folder: string;
  clock: { now: number };
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; text: string; json: Record<string, unknown> | undefined; structured: unknown }>;
}

async function connect(): Promise<Connected> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-mcp-tools-"));
  temporary.push(folder);
  const store = await LocalPlanningStore.open(folder);
  const clock = { now: Date.UTC(2031, 0, 1) };
  const server = createServer({ store, viewHtml: VIEW_HTML, now: () => clock.now });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-host", version: "1" });
  await client.connect(clientSide);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: unknown };
    const text = result.content.map((block) => block.text ?? "").join("");
    let json: Record<string, unknown> | undefined;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = undefined;
    }
    return { isError: result.isError === true, text, json, structured: result.structuredContent };
  }
  return { client, folder, clock, call };
}

function planning(title = "Travaux maison") {
  return { ...structuredClone(CREATION_EXAMPLE), data: { ...structuredClone(CREATION_EXAMPLE.data), title } };
}

test("CreateThenListThenGet", async () => {
  const { call } = await connect();
  const created = await call("create_planning", { planning: planning() });
  assert.equal(created.isError, false, created.text);
  assert.equal(created.json?.revision, 1);
  const id = created.json?.id as string;

  const listed = await call("list_plannings");
  // The view gets the same list, with the folder, as structured content.
  assert.deepEqual(listed.structured, listed.json);
  const plannings = listed.json?.plannings as Array<{ id: string; title: string; revision: number }>;
  assert.deepEqual(plannings.map(({ id: listedId, title, revision }) => ({ id: listedId, title, revision })), [{ id, title: "Travaux maison", revision: 1 }]);

  const read = await call("get_planning", { id });
  assert.deepEqual(read.json?.planning, planning());
  assert.equal(read.json?.revision, 1);
  assert.equal(read.json?.selected, undefined);
});

test("AnInvalidTimelineIsRefusedWithTheGatesDiagnostics", async () => {
  const { call, folder } = await connect();
  const inverted = planning();
  const task = inverted.data.rows[1] as { items: Array<{ id: string; start?: string; end?: string }> };
  task.items[0]!.start = "2031-05-16";
  task.items[0]!.end = "2031-04-07";
  const refused = await call("create_planning", { planning: inverted });
  assert.equal(refused.isError, true);
  const gate = parseSerializedStructuredExchange(JSON.stringify(inverted), checkStructuredExchangeSchema);
  assert.equal(gate.valid, false);
  assert.deepEqual(refused.json?.issues, gate.valid ? [] : gate.issues);
  assert.deepEqual(await fs.readdir(folder), [], "nothing was written");
});

test("AnUpdateIsTargetedAndRevisioned", async () => {
  const { call, folder } = await connect();
  const created = await call("create_planning", { planning: planning() });
  const id = created.json?.id as string;
  const file = path.join(folder, created.json?.file as string);
  const before = (await fs.readFile(file, "utf8")).split(/\r?\n/);

  const updated = await call("update_planning", { id, base_revision: 1, operations: [{ op: "change_item", id: "inspection", changes: { date: "2031-05-28" } }] });
  assert.equal(updated.isError, false, updated.text);
  assert.equal(updated.json?.revision, 2);
  const afterUpdate = (await fs.readFile(file, "utf8")).split(/\r?\n/);
  const changed = before.flatMap((line, index) => (line === afterUpdate[index] ? [] : [[line.trim(), afterUpdate[index]?.trim()]]));
  assert.equal(before.length, afterUpdate.length);
  assert.deepEqual(changed, [['"date": "2031-05-21",', '"date": "2031-05-28",']]);

  const stale = await call("update_planning", { id, base_revision: 1, operations: [{ op: "set_title", title: "Late" }] });
  assert.equal(stale.isError, true);
  assert.match(String(stale.json?.error), /is at revision 2, not 1/);
  assert.equal(stale.json?.current, 2);

  const broken = await call("update_planning", { id, base_revision: 2, operations: [{ op: "change_item", id: "frame", changes: { end: "2031-01-01" } }] });
  assert.equal(broken.isError, true);
  assert.match(String(broken.json?.error), /nothing was changed/);
  assert.ok(Array.isArray(broken.json?.issues));

  const unknown = await call("update_planning", { id, base_revision: 2, operations: [{ op: "remove_item", id: "nope" }] });
  assert.equal(unknown.isError, true);
  assert.match(String(unknown.json?.error), /^nothing was changed: /);
});

test("A file edited by hand into an invalid planning is reported to the model", async () => {
  const { call, folder } = await connect();
  const created = await call("create_planning", { planning: planning() });
  const id = created.json?.id as string;
  await fs.writeFile(path.join(folder, created.json?.file as string), "{ not json");
  const read = await call("get_planning", { id });
  assert.equal(read.isError, false);
  const refused = read.json?.file_refused as { note: string; issues: Array<{ rule: string }> };
  assert.match(refused.note, /edited outside and is no longer a valid planning/);
  assert.equal(refused.issues[0]?.rule, "not-json");
  assert.deepEqual(read.json?.planning, planning());
  const listed = (await call("list_plannings")).json?.plannings as Array<{ id: string; unreadable?: { issues: Array<{ rule: string }> } }>;
  assert.equal(listed[0]?.id, id);
  assert.equal(listed[0]?.unreadable?.issues[0]?.rule, "not-json");
  assert.match((await call("show_planning", { id })).text, /edited outside into an invalid planning/);
});

test("ItIsFoundWithoutNamingThePlanning", async () => {
  const { call, client, clock } = await connect();
  const { tools } = await client.listTools();
  const getSelection = tools.find((tool) => tool.name === "get_selection");
  // Callable with nothing: the model need not know which planning.
  assert.deepEqual(Object.keys((getSelection?.inputSchema as { properties?: object } | undefined)?.properties ?? {}), []);
  assert.match(String(getSelection?.description), /"it"/);

  assert.match((await call("get_selection")).text, /^Nothing is selected/);
  const first = (await call("create_planning", { planning: planning("Cuisine") })).json?.id as string;
  const second = (await call("create_planning", { planning: planning("Jardin") })).json?.id as string;
  await call("create_planning", { planning: planning("Garage") });
  await call("select_in_planning", { id: first, task: "G2" });
  clock.now += 60_000;
  await call("select_in_planning", { id: second, task: "G1", item: "inspection" });

  const found = await call("get_selection");
  assert.deepEqual(found.json?.planning, { id: second, title: "Jardin", revision: 1 });
  assert.match(String(found.json?.selected), /milestone "Soil inspection" \(inspection\) of task "Foundations" \(G1\)/);
  // The listing carries it too.
  assert.equal(((await call("list_plannings")).json?.selection as { id: string } | undefined)?.id, second);

  // Unselected there: the earlier selection, in the other planning, is the latest left.
  await call("select_in_planning", { id: second });
  assert.equal(((await call("get_selection")).json?.planning as { id: string } | undefined)?.id, first);
  await call("select_in_planning", { id: first });
  assert.match((await call("get_selection")).text, /^Nothing is selected/);
});

test("TheSelectionToolIsNotTheModels", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.deepEqual([...byName.keys()].sort(), ["create_planning", "get_planning", "get_selection", "list_plannings", "read_structure_guide", "save_figure", "select_in_planning", "show_planning", "update_planning"]);
  const ui = (name: string) => (byName.get(name)?._meta as { ui?: { visibility?: string[]; resourceUri?: string } } | undefined)?.ui;
  assert.deepEqual(ui("select_in_planning")?.visibility, ["app"]);
  assert.deepEqual(ui("save_figure")?.visibility, ["app"]);
  // The view belongs to show_planning alone: app-only tools that named it too left
  // Claude Desktop drawing nothing.
  for (const name of ["select_in_planning", "save_figure"]) assert.equal(ui(name)?.resourceUri, undefined, name);
  assert.equal(ui("show_planning")?.resourceUri, VIEW_URI);
  assert.equal(ui("list_plannings")?.resourceUri, VIEW_URI);
  // Every other tool is the model's: no visibility restriction.
  for (const name of ["create_planning", "get_planning", "get_selection", "list_plannings", "read_structure_guide", "show_planning", "update_planning"]) {
    assert.ok(ui(name)?.visibility === undefined || ui(name)?.visibility?.includes("model"), name);
  }
});

test("A selection recorded by the view is returned by get_planning, and cleared", async () => {
  const { call, clock } = await connect();
  const id = (await call("create_planning", { planning: planning() })).json?.id as string;

  assert.equal((await call("select_in_planning", { id, task: "G1", item: "inspection" })).isError, false);
  clock.now += 2 * 60_000;
  const read = await call("get_planning", { id });
  assert.equal(read.json?.selected, 'Selected in the view: milestone "Soil inspection" (inspection) of task "Foundations" (G1), on 2031-05-21, 2 minutes ago.');

  await call("select_in_planning", { id, task: "G2" });
  assert.match(String((await call("get_planning", { id })).json?.selected), /^Selected in the view: task "Frame and glazing" \(G2\)/);

  await call("select_in_planning", { id });
  assert.equal((await call("get_planning", { id })).json?.selected, undefined);

  // An update that removes the selected item clears the selection.
  await call("select_in_planning", { id, task: "G1", item: "inspection" });
  await call("update_planning", { id, base_revision: 1, operations: [{ op: "remove_item", id: "inspection" }] });
  assert.equal((await call("get_planning", { id })).json?.selected, undefined);
});

test("show_planning hands the view the planning and the model a summary", async () => {
  const { call } = await connect();
  const id = (await call("create_planning", { planning: planning() })).json?.id as string;
  const shown = await call("show_planning", { id });
  assert.equal(shown.isError, false, shown.text);
  assert.match(shown.text, /^Shown to the user: planning "Travaux maison" \(travaux-maison\), revision 1, 2 tasks, from 2031-04-01 to 2031-09-30\./);
  const structured = shown.structured as { id: string; revision: number; data: { rows: unknown[] }; comparedWith?: number };
  assert.equal(structured.id, id);
  assert.deepEqual(structured.data, planning().data);

  await call("update_planning", { id, base_revision: 1, operations: [{ op: "change_item", id: "inspection", changes: { date: "2031-05-28" } }] });
  const compared = await call("show_planning", { id, compare_to: 1 });
  assert.match(compared.text, /compared with revision 1/);
  const comparedData = compared.structured as { comparedWith: number; data: { rows: Array<{ type: string; items?: Array<{ id: string; date?: string; previous?: { date?: string } }> }> } };
  assert.equal(comparedData.comparedWith, 1);
  const inspection = comparedData.data.rows.flatMap((row) => row.items ?? []).find((item) => item.id === "inspection");
  assert.equal(inspection?.date, "2031-05-28");
  assert.equal(inspection?.previous?.date, "2031-05-21");

  const missing = await call("show_planning", { id: "nothing-here" });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /Nothing was shown/);
});

test("TheViewNeedsNoNetwork", async () => {
  const { client } = await connect();
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((resource) => [resource.uri, resource.mimeType]), [[VIEW_URI, RESOURCE_MIME_TYPE]]);
  const { contents } = await client.readResource({ uri: VIEW_URI });
  assert.equal(contents.length, 1);
  const content = contents[0] as { mimeType?: string; text?: string; _meta?: { ui?: { csp?: Record<string, unknown> } } };
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.equal(content._meta?.ui?.csp, undefined, "no external domain declared");
  const html = content.text ?? "";
  assert.ok(html.length > 10_000);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /<link[^>]+\bhref=/i);
  assert.doesNotMatch(html, /url\(\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /@import\s+(url\()?["']?(https?:)?\/\//i);
});

test("save_figure writes an SVG beside the plannings, never over a file, never anything else", async () => {
  const { call, folder } = await connect();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
  const first = await call("save_figure", { file_name: "timeline-travaux.svg", svg });
  assert.equal(first.isError, false, first.text);
  assert.equal((first.structured as { file: string }).file, "timeline-travaux.svg");
  assert.equal(await fs.readFile(path.join(folder, "timeline-travaux.svg"), "utf8"), svg);
  const second = await call("save_figure", { file_name: "timeline-travaux.svg", svg });
  assert.equal((second.structured as { file: string }).file, "timeline-travaux (2).svg");
  const escaping = await call("save_figure", { file_name: "../../evil.svg", svg });
  assert.equal((escaping.structured as { file: string }).file, "evil.svg");
  const notSvg = await call("save_figure", { file_name: "x.svg", svg: "#!/bin/sh" });
  assert.equal(notSvg.isError, true);
  assert.deepEqual((await fs.readdir(folder)).sort(), ["evil.svg", "timeline-travaux (2).svg", "timeline-travaux.svg"]);
});

test("read_structure_guide serves the shared pages", async () => {
  const { call } = await connect();
  const topics = await call("read_structure_guide");
  assert.ok(((topics.json?.topics ?? []) as Array<{ topic: string }>).some((entry) => entry.topic === "timelines"));
  const page = await call("read_structure_guide", { topic: "timelines" });
  assert.match(String(page.json?.page), /timeline/i);
  assert.doesNotMatch(String(page.json?.page), /only: pi-outpost/);
});

test("BothServersDescribeTheToolsAlike", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const mcp = new Map(tools.map((tool) => [tool.name, tool.description]));
  const paths = openApiDocument().paths as Record<string, { post: { description: string } }>;
  for (const [name, shared] of [
    ["create_planning", CREATE_DESCRIPTION],
    ["update_planning", UPDATE_DESCRIPTION],
    ["show_planning", SHOW_PLANNING_DESCRIPTION],
  ] as const) {
    assert.equal(mcp.get(name), shared, name);
    assert.equal(paths[`/${name}`]?.post.description, shared, name);
  }
});

test("A changed view is a new resource: a host's copy of the old page is never used for it", () => {
  assert.match(VIEW_URI, /^ui:\/\/pi-outpost\/planning-[0-9a-f]{12}\.html$/);
  assert.equal(viewUriFor(VIEW_HTML), VIEW_URI);
  assert.notEqual(viewUriFor(`${VIEW_HTML}<!-- changed -->`), VIEW_URI);
});
