/**
 * The local store: plannings in the chosen folder, history hidden beside them, nothing
 * written anywhere else, and files edited by hand judged when read.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { applyOperations } from "@pi-outpost/apps-core/operations";
import { CREATION_EXAMPLE } from "@pi-outpost/apps-core/descriptions";
import { ConfigError, planningsDirFrom } from "../src/config.ts";
import { HISTORY_DIR, LocalPlanningStore, PlanningRefusal, fileStemOf } from "../src/store.ts";

const temporary: string[] = [];
after(async () => {
  for (const dir of temporary) await fs.rm(dir, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-mcp-store-"));
  temporary.push(dir);
  return dir;
}

function planning(title: string) {
  return { ...structuredClone(CREATION_EXAMPLE), data: { ...structuredClone(CREATION_EXAMPLE.data), title } };
}

/** Every file under `dir`, relative, recursively. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));
}

test("TheFolderIsCreatedWhenMissing", async () => {
  const folder = path.join(await scratch(), "Documents", "Plannings");
  const store = await LocalPlanningStore.open(folder);
  assert.ok((await fs.stat(folder)).isDirectory());
  const created = await store.create(planning("Travaux maison"));
  assert.equal(created.file, "Travaux maison.planning.json");
  assert.ok((await fs.stat(path.join(folder, created.file))).isFile());
});

test("NoFolderNoStart: the setting is required and absolute", () => {
  assert.throws(() => planningsDirFrom({}), (error: unknown) => error instanceof ConfigError && /PLANNINGS_DIR/.test(error.message));
  assert.throws(() => planningsDirFrom({ PLANNINGS_DIR: "  " }), /PLANNINGS_DIR/);
  assert.throws(() => planningsDirFrom({ PLANNINGS_DIR: path.join("relative", "plannings") }), /PLANNINGS_DIR must be an absolute path/);
  const absolute = path.resolve(os.tmpdir(), "plannings");
  assert.equal(planningsDirFrom({ PLANNINGS_DIR: absolute }), absolute);
});

test("NoFolderNoStart: the server exits naming PLANNINGS_DIR", () => {
  const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const env = { ...process.env };
  delete env.PLANNINGS_DIR;
  const run = spawnSync(process.execPath, ["--import", "tsx", main, "--stdio"], { env, encoding: "utf8", input: "" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /PLANNINGS_DIR is not set/);
  assert.equal(run.stdout, "");
});

test("APlanningIsOneReadableFile", async () => {
  const folder = await scratch();
  const store = await LocalPlanningStore.open(folder);
  const created = await store.create(planning("Travaux maison"));
  const visible = (await fs.readdir(folder)).filter((name) => !name.startsWith("."));
  assert.deepEqual(visible, ["Travaux maison.planning.json"]);
  const text = await fs.readFile(path.join(folder, visible[0]!), "utf8");
  // Indented, one value per line: a person can read it.
  assert.ok(text.split(/\r?\n/).length > 20);
  const verdict = parseSerializedStructuredExchange(text, checkStructuredExchangeSchema);
  assert.equal(verdict.valid, true);
  assert.deepEqual(JSON.parse(text), created.document);
  assert.equal(created.id, "travaux-maison");
});

test("HistoryIsKeptBesideAndHidden", async () => {
  const folder = await scratch();
  const store = await LocalPlanningStore.open(folder);
  const first = await store.create(planning("Travaux maison"));
  const firstText = await fs.readFile(path.join(folder, first.file), "utf8");
  const second = await store.revise(first.id, 1, (current) => applyOperations(current, [{ op: "change_item", id: "inspection", changes: { date: "2031-05-28" } }]));
  const secondText = await fs.readFile(path.join(folder, first.file), "utf8");
  const third = await store.revise(first.id, 2, (current) => applyOperations(current, [{ op: "set_title", title: "Travaux maison 2031" }]));
  assert.equal(third.revision, 3);

  const fileNow = await fs.readFile(path.join(folder, first.file), "utf8");
  assert.deepEqual(JSON.parse(fileNow), third.document);
  const history = path.join(folder, HISTORY_DIR, first.id);
  assert.equal(await fs.readFile(path.join(history, "1.json"), "utf8"), firstText);
  assert.equal(await fs.readFile(path.join(history, "2.json"), "utf8"), secondText);
  assert.deepEqual(JSON.parse(secondText), second.document);
  assert.deepEqual((await store.get(first.id, 1)).document, first.document);

  // A casual listing (Finder, ls) hides dot-names: only the planning file shows.
  assert.deepEqual((await fs.readdir(folder)).filter((name) => !name.startsWith(".")), [first.file]);
  assert.ok(HISTORY_DIR.startsWith("."));
});

test("NothingIsWrittenOutsideTheFolder", async () => {
  const parent = await scratch();
  const folder = path.join(parent, "plannings");
  await fs.mkdir(folder);
  const store = await LocalPlanningStore.open(folder);
  const titles = ["../../escape", "a/b\\c", "..", "../", "CON", "x".repeat(300), ".hidden", "Été: «plan» ?"];
  for (const title of titles) {
    const created = await store.create(planning(title));
    await store.revise(created.id, 1, (current) => applyOperations(current, [{ op: "change_item", id: "frame", changes: { label: "Frame" } }]));
    await store.get(created.id);
    assert.equal(path.dirname(path.resolve(folder, created.file)), folder, created.file);
  }
  // The only thing in the parent is the folder itself.
  assert.deepEqual(await fs.readdir(parent), ["plannings"]);
  const visible = (await fs.readdir(folder)).filter((name) => !name.startsWith(HISTORY_DIR));
  assert.equal(visible.length, titles.length);
  for (const name of visible) assert.ok(name.endsWith(".planning.json") && !name.includes("/") && !name.includes("\\") && !name.startsWith("."), name);
  assert.equal(fileStemOf("../../escape"), "escape");
  assert.equal(fileStemOf(".."), "Planning");
  assert.equal(fileStemOf("CON"), "Planning CON");
  // Ids that would leave the history folder are not found, never joined to a path.
  for (const id of ["../x", "..", "a/b", "A"]) await assert.rejects(store.get(id), PlanningRefusal);
  // And every file written is under the folder.
  for (const file of await filesUnder(parent)) assert.ok(file.startsWith(`plannings${path.sep}`), file);
});

test("Titles that collide get distinct ids and files", async () => {
  const folder = await scratch();
  const store = await LocalPlanningStore.open(folder);
  const a = await store.create(planning("Travaux maison"));
  const b = await store.create(planning("Travaux Maison"));
  assert.notEqual(a.id, b.id);
  assert.equal(b.id, "travaux-maison-2");
  assert.notEqual(a.file.toLowerCase(), b.file.toLowerCase());
});

test("AFileEditedByHandIsJudgedOnRead", async () => {
  const folder = await scratch();
  const store = await LocalPlanningStore.open(folder);
  const created = await store.create(planning("Travaux maison"));
  const file = path.join(folder, created.file);

  // A valid edit is the current document.
  const edited = structuredClone(created.document);
  edited.data.title = "Travaux maison (edited)";
  await fs.writeFile(file, JSON.stringify(edited, null, 2));
  const read = await store.get(created.id);
  assert.equal(read.editedOutside, true);
  assert.equal(read.title, "Travaux maison (edited)");

  // An invalid one is reported with the gate's diagnostics, and still listed.
  const broken = structuredClone(created.document) as { data: { rows: Array<{ type: string; items?: Array<{ id?: string; start?: string; end?: string }> }> } };
  const earthworks = broken.data.rows.flatMap((row) => row.items ?? []).find((item) => item.id === "earthworks")!;
  earthworks.start = "2031-05-16";
  earthworks.end = "2031-04-07";
  const brokenText = JSON.stringify(broken, null, 2);
  await fs.writeFile(file, brokenText);
  const gate = parseSerializedStructuredExchange(brokenText, checkStructuredExchangeSchema);
  assert.equal(gate.valid, false);
  const judged = await store.get(created.id);
  assert.deepEqual(judged.invalidFile, gate.valid ? [] : gate.issues);
  assert.deepEqual(judged.document, created.document, "the last valid revision is what is answered");
  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0]!.unreadable, gate.valid ? [] : gate.issues);

  // Not JSON at all: judged too.
  await fs.writeFile(file, "{ not json");
  assert.equal((await store.get(created.id)).invalidFile?.[0]?.rule, "not-json");

  // An update starts from the last revision and keeps the edited file in history.
  const revised = await store.revise(created.id, 1, (current) => applyOperations(current, [{ op: "set_title", title: "Repaired" }]));
  assert.equal(revised.revision, 2);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).data.title, "Repaired");
  const kept = (await fs.readdir(path.join(folder, HISTORY_DIR, created.id))).filter((name) => name.startsWith("edited-before-2-"));
  assert.equal(kept.length, 1);
  assert.equal(await fs.readFile(path.join(folder, HISTORY_DIR, created.id, kept[0]!), "utf8"), "{ not json");
});

test("A planning file deleted from the folder leaves the listing", async () => {
  const folder = await scratch();
  const store = await LocalPlanningStore.open(folder);
  const created = await store.create(planning("Travaux maison"));
  await fs.rm(path.join(folder, created.file));
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.get(created.id), /no longer in the plannings folder/);
  await assert.rejects(store.revise(created.id, 1, (current) => current), /no longer in the plannings folder/);
});

test("Concurrent updates are serialised: one wins, the other is told to read again", async () => {
  const folder = await scratch();
  const store = await LocalPlanningStore.open(folder);
  const created = await store.create(planning("Travaux maison"));
  const results = await Promise.allSettled(
    ["A", "B", "C"].map((title) => store.revise(created.id, 1, (current) => applyOperations(current, [{ op: "set_title", title }]))),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.match(String(result.reason), /is at revision 2, not 1/);
});

test("ARenamedFileKeepsItsHistory", async () => {
  const folder = await scratch();
  const store = await LocalPlanningStore.open(folder);
  const created = await store.create(planning("Travaux maison"));
  await store.revise(created.id, 1, (current) => applyOperations(current, [{ op: "set_title", title: "Travaux maison" }, { op: "change_item", id: "inspection", changes: { date: "2031-05-28" } }]));
  // Renamed in the Finder, content unchanged.
  await fs.rename(path.join(folder, created.file), path.join(folder, "Maison 2031.json"));

  const listed = await store.list();
  assert.deepEqual(listed.map(({ id, revision, file }) => ({ id, revision, file })), [{ id: created.id, revision: 2, file: "Maison 2031.json" }]);
  const revised = await store.revise(created.id, 2, (current) => applyOperations(current, [{ op: "change_item", id: "frame", changes: { label: "Frame" } }]));
  assert.equal(revised.revision, 3);
  assert.equal(revised.file, "Maison 2031.json");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, "Maison 2031.json"), "utf8")), revised.document);
  assert.deepEqual((await fs.readdir(folder)).filter((name) => !name.startsWith(".")), ["Maison 2031.json"]);

  // Found by a read too, without listing first.
  await fs.rename(path.join(folder, "Maison 2031.json"), path.join(folder, "Maison.json"));
  assert.equal((await store.get(created.id)).file, "Maison.json");
});

test("ATimelineFileInTheFolderIsAPlanning", async () => {
  const folder = await scratch();
  const store = await LocalPlanningStore.open(folder);
  const text = JSON.stringify(planning("Planning projet 2027"));
  await fs.writeFile(path.join(folder, "planning-projet-2027.json"), text);
  // Not plannings: other JSON, broken JSON, and anything not .json.
  await fs.writeFile(path.join(folder, "settings.json"), '{"theme":"dark"}');
  await fs.writeFile(path.join(folder, "broken.json"), "{ nope");
  await fs.writeFile(path.join(folder, "notes.txt"), "hello");

  const listed = await store.list();
  assert.deepEqual(listed.map(({ id, title, revision, file }) => ({ id, title, revision, file })), [
    { id: "planning-projet-2027", title: "Planning projet 2027", revision: 1, file: "planning-projet-2027.json" },
  ]);
  assert.equal(await fs.readFile(path.join(folder, "planning-projet-2027.json"), "utf8"), text, "the file is left as it was");
  // Listing again adopts nothing twice.
  assert.equal((await store.list()).length, 1);

  const read = await store.get("planning-projet-2027");
  assert.deepEqual(read.document, JSON.parse(text));
  assert.equal(read.editedOutside, undefined);
  const revised = await store.revise("planning-projet-2027", 1, (current) => applyOperations(current, [{ op: "change_item", id: "inspection", changes: { date: "2031-05-28" } }]));
  assert.equal(revised.revision, 2);
  assert.equal(JSON.parse(await fs.readFile(path.join(folder, "planning-projet-2027.json"), "utf8")).data.rows[1].items[1].date, "2031-05-28");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, HISTORY_DIR, "planning-projet-2027", "1.json"), "utf8")), JSON.parse(text));

  // A copy of an adopted file is a planning of its own.
  await fs.copyFile(path.join(folder, "planning-projet-2027.json"), path.join(folder, "planning-projet-2027-1.json"));
  assert.deepEqual((await store.list()).map((listing) => listing.id).sort(), ["planning-projet-2027", "planning-projet-2027-2"]);
});
