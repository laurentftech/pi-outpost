/**
 * The posters extension's tools as a host sees them: the SDK's client over an in-memory
 * transport, against a real store in a temporary folder. The scenarios are mcp-poster-app's.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { CREATION_EXAMPLE } from "@pi-outpost/apps-core/descriptions";
import { readPage } from "@pi-outpost/posters/format";
import { POSTER_EXAMPLE, POSTER_GUIDE } from "@pi-outpost/posters/guide";
import { posterDocx } from "@pi-outpost/posters/office";
import { createPosterServer, viewUriFor } from "../src/posters/server.ts";
import { LocalPosterStore } from "../src/posters/store.ts";
import { createServer } from "../src/server.ts";
import { LocalPlanningStore } from "../src/store.ts";

const VIEW_HTML = "<!doctype html><title>poster editor</title>";
const temporary: string[] = [];
after(async () => {
  for (const dir of temporary) await fs.rm(dir, { recursive: true, force: true });
});

type Result = { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown> };

async function connect(folder?: string) {
  const root = folder ?? (await fs.mkdtemp(path.join(os.tmpdir(), "outpost-posters-")));
  if (!folder) temporary.push(root);
  const server = createPosterServer({ store: await LocalPosterStore.open(root), viewHtml: VIEW_HTML });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-host", version: "1" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as Result;
    const text = result.content.map((block) => block.text ?? "").join("");
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A plain sentence.
    }
    return { ...result, text, json };
  };
  return { client, folder: root, call };
}

const poster = (title = "Class rules") => ({ title, html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format });

// openlore: scenario=EveryRevisionIsKept spec=mcp-poster-app
test("EveryRevisionIsKept: the file holds the latest version, and revisions 1 to 3 can each be read", async () => {
  const { call, folder } = await connect();
  const created = await call("create_poster", poster());
  assert.equal(created.isError, undefined);
  const id = created.json.id as string;
  await call("update_poster", { id, base_revision: 1, html: POSTER_EXAMPLE.html.replace("Our class rules", "Version two"), css: POSTER_EXAMPLE.css, format: "A4-portrait" });
  await call("update_poster", { id, base_revision: 2, html: POSTER_EXAMPLE.html.replace("Our class rules", "Version three"), css: POSTER_EXAMPLE.css, format: "A4-portrait" });
  const file = await fs.readFile(path.join(folder, "Class rules.poster.html"), "utf8");
  assert.match(readPage(file).html, /Version three/);
  for (const [revision, title] of [[1, "Our class rules"], [2, "Version two"], [3, "Version three"]] as const) {
    const read = await call("get_poster", { id, revision });
    assert.equal(read.json.revision, revision);
    assert.equal(read.json.current_revision, 3);
    assert.match(read.json.html as string, new RegExp(title));
  }
});

// openlore: scenario=AnUpdateFromAnOldRevisionIsRefused spec=mcp-poster-app
test("AnUpdateFromAnOldRevisionIsRefused: the refusal says revision 2 was made by the user, and nothing changes", async () => {
  const { call } = await connect();
  const id = (await call("create_poster", poster())).json.id as string;
  const saved = await call("save_poster", { id, base_revision: 1, html: POSTER_EXAMPLE.html.replace("I listen", "I listen carefully"), css: POSTER_EXAMPLE.css });
  assert.equal(saved.structuredContent?.revision, 2);
  const stale = await call("update_poster", { id, base_revision: 1, html: "<p>model</p>", css: "", format: "A4-portrait" });
  assert.equal(stale.isError, true);
  assert.match(stale.json.error as string, /revision 2 was made by the user in the editor\. Read it with get_poster/);
  const read = await call("get_poster", { id });
  assert.equal(read.json.revision, 2);
  assert.equal(read.json.last_changed_by, "the user, in the editor");
  assert.match(read.json.html as string, /I listen carefully/);
});

test("A save from the editor over a newer revision is refused, and the newer one is kept", async () => {
  const { call } = await connect();
  const id = (await call("create_poster", poster())).json.id as string;
  await call("update_poster", { id, base_revision: 1, html: "<p>the model's revision 2</p>", css: "", format: "A4-portrait" });
  const stale = await call("save_poster", { id, base_revision: 1, html: "<p>the user's edit of revision 1</p>", css: "" });
  assert.equal(stale.isError, true);
  assert.match(stale.json.error as string, /is at revision 2, not 1; revision 2 was made by the model/);
  assert.match((await call("get_poster", { id })).json.html as string, /the model's revision 2/);
});

test("ModelTools: the descriptions carry the shared guide, and create/update refuse what the format refuses", async () => {
  const { client, call } = await connect();
  const { tools } = await client.listTools();
  for (const name of ["create_poster", "update_poster"]) assert.ok(tools.find((tool) => tool.name === name)!.description!.includes(POSTER_GUIDE), name);
  const script = await call("create_poster", { ...poster(), html: "<p>x</p><script>alert(1)</script>" });
  assert.equal(script.isError, true);
  assert.match(script.json.error as string, /holds no script/);
  const format = await call("create_poster", { ...poster(), format: "Letter" });
  assert.equal(format.isError, true);
});

// openlore: scenario=ThePosterIsShownInTheConversation spec=mcp-poster-app
test("ThePosterIsShownInTheConversation: show_poster declares the editor and hands it the poster", async () => {
  const { client, call } = await connect();
  const id = (await call("create_poster", poster())).json.id as string;
  const { tools } = await client.listTools();
  const show = tools.find((tool) => tool.name === "show_poster")!;
  assert.equal((show._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri, viewUriFor(VIEW_HTML));
  const { contents } = await client.readResource({ uri: viewUriFor(VIEW_HTML) });
  assert.equal(contents[0]!.mimeType, RESOURCE_MIME_TYPE);
  assert.equal((contents[0] as { text: string }).text, VIEW_HTML);
  const shown = await call("show_poster", { id });
  assert.equal(shown.structuredContent?.id, id);
  assert.equal(shown.structuredContent?.html, POSTER_EXAMPLE.html);
  assert.equal(shown.structuredContent?.format, "A4-portrait");
  assert.match(shown.text, /You do not see it\. If the user retouches it and saves, get_poster returns their version\./);
});

// openlore: scenario=TheModelIsNotOfferedSaving spec=mcp-poster-app
test("TheModelIsNotOfferedSaving: saving and exporting are tools only the view can call, and name no view", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  for (const name of ["save_poster", "save_export"]) {
    const ui = (tools.find((tool) => tool.name === name)!._meta as { ui?: { visibility?: string[]; resourceUri?: string } }).ui;
    assert.deepEqual(ui?.visibility, ["app"], name);
    assert.equal(ui?.resourceUri, undefined, name);
  }
  const forModel = tools.filter((tool) => !(tool._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility?.every((who) => who === "app")).map((tool) => tool.name);
  assert.deepEqual(forModel.sort(), ["create_poster", "get_poster", "list_posters", "show_poster", "update_poster"]);
});

// openlore: scenario=AWordExportIsDownloaded spec=mcp-poster-app
// openlore: scenario=ASecondExportIsNumbered spec=poster-documents
test("Exports are kept beside the poster under its name, spaces kept, never over an earlier one", async () => {
  const { call, folder } = await connect();
  const id = (await call("create_poster", poster("Prepositions of Place"))).json.id as string;
  const docx = posterDocx("Prepositions of Place", "A4-portrait", { png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), width: 10, height: 14 });
  const bytes = Buffer.from(docx).toString("base64");
  const first = await call("save_export", { id, kind: "docx", bytes });
  assert.equal(first.structuredContent?.file, "Prepositions of Place.docx");
  const second = await call("save_export", { id, kind: "docx", bytes });
  assert.equal(second.structuredContent?.file, "Prepositions of Place (2).docx");
  assert.deepEqual(new Uint8Array(await fs.readFile(path.join(folder, "Prepositions of Place.docx"))), docx);
  const notZip = await call("save_export", { id, kind: "pptx", bytes: Buffer.from("not a zip").toString("base64") });
  assert.equal(notZip.isError, true);
  assert.equal((await fs.readdir(folder)).filter((name) => name.endsWith(".pptx")).length, 0);
});

// openlore: scenario=PlanningsAndPostersShareAFolder spec=mcp-poster-app
test("PlanningsAndPostersShareAFolder: neither lists the other's files nor reports them broken", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-shared-"));
  temporary.push(folder);
  const posters = await connect(folder);
  await posters.call("create_poster", poster());
  const planningServer = createServer({ store: await LocalPlanningStore.open(folder), viewHtml: "<!doctype html>" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await planningServer.connect(serverSide);
  const plannings = new Client({ name: "test-host", version: "1" });
  await plannings.connect(clientSide);
  const planning = { ...structuredClone(CREATION_EXAMPLE), data: { ...structuredClone(CREATION_EXAMPLE.data), title: "Works" } };
  await plannings.callTool({ name: "create_planning", arguments: { planning } });
  const listedPlannings = JSON.parse(((await plannings.callTool({ name: "list_plannings", arguments: {} })) as Result).content[0]!.text!) as { plannings: Array<{ title: string; unreadable?: unknown }> };
  assert.deepEqual(listedPlannings.plannings.map((entry) => [entry.title, entry.unreadable]), [["Works", undefined]]);
  const listedPosters = (await posters.call("list_posters")).json as { posters: Array<{ title: string }> };
  assert.deepEqual(listedPosters.posters.map((entry) => entry.title), ["Class rules"]);
});

// openlore: scenario=AReinstalledEditorIsANewView spec=mcp-poster-app
test("AReinstalledEditorIsANewView: a changed editor page is a new resource name", () => {
  assert.notEqual(viewUriFor("<p>editor 1</p>"), viewUriFor("<p>editor 2</p>"));
  assert.equal(viewUriFor("<p>same</p>"), viewUriFor("<p>same</p>"));
});
