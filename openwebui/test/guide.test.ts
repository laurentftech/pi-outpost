/**
 * The structured-exchange guide: pi-outpost's skill reference pages, served to Open
 * WebUI's models without their pi-only passages, and named by refusals.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GUIDE_TOPICS, withoutPiOnlyPassages } from "../src/guide.ts";
import { SECRET, filesUnder, mintToken, testApp } from "./helpers.ts";

const REFERENCES = fileURLToPath(new URL("../../skills/structured-exchange/references/", import.meta.url));
const CONFORMANCE = fileURLToPath(new URL("../../shared/conformance/invalid/", import.meta.url));
const source = (file: string) => fs.readFile(path.join(REFERENCES, file), "utf8");
const PI_ONLY_TOOLS = ["write_structure_figure", "write_structure_table", "compare_timelines", "present_structure", "present_project_model"];

// openlore: scenario=TheIndexListsEveryTopic spec=openwebui-structure-guide
test("TheIndexListsEveryTopic: every topic, each with what it is for", async (t) => {
  const { call } = await testApp(t);
  const response = await call("read_structure_guide", {});
  assert.equal(response.statusCode, 200);
  const topics = response.json().topics as Array<{ topic: string; purpose: string }>;
  assert.deepEqual(topics.map((entry) => entry.topic), GUIDE_TOPICS.map((entry) => entry.topic));
  for (const entry of topics) assert.ok(entry.purpose.length > 20, entry.topic);
  assert.match(response.json().how, /with one topic/);
});

// openlore: scenario=ATopicReturnsItsPage spec=openwebui-structure-guide
// openlore: scenario=AServedPageIsTheSourceWithoutPiOnlyPassages spec=openwebui-structure-guide
test("ATopicReturnsItsPage and AServedPageIsTheSourceWithoutPiOnlyPassages: the source, marked passages cut, nothing else", async (t) => {
  const { call } = await testApp(t);
  for (const entry of GUIDE_TOPICS) {
    const response = await call("read_structure_guide", { topic: entry.topic });
    assert.equal(response.statusCode, 200, entry.topic);
    const text = await source(entry.file);
    // `\r?\n`: Windows checks these files out with CRLF.
    const expected = text.replace(/^[ \t]*<!-- only: pi-outpost -->[ \t]*\r?\n[\s\S]*?^[ \t]*<!-- end -->[ \t]*\r?\n/gm, "");
    assert.equal(response.json().page, expected, entry.topic);
    assert.equal(response.json().topic, entry.topic);
  }
});

test("withoutPiOnlyPassages keeps every other byte, line endings included, and refuses an unclosed passage", () => {
  const crlf = "a\r\n<!-- only: pi-outpost -->\r\nsecret\r\n<!-- end -->\r\nb\r\n";
  assert.equal(withoutPiOnlyPassages(crlf), "a\r\nb\r\n");
  assert.equal(withoutPiOnlyPassages("no markers\n"), "no markers\n");
  assert.throws(() => withoutPiOnlyPassages("<!-- only: pi-outpost -->\nforever\n"), /never closed/);
});

// openlore: scenario=NoServedPageNamesAPiOnlyTool spec=openwebui-structure-guide
test("NoServedPageNamesAPiOnlyTool: no page names a tool Open WebUI's models do not have", async (t) => {
  const { call } = await testApp(t);
  for (const entry of GUIDE_TOPICS) {
    const page: string = (await call("read_structure_guide", { topic: entry.topic })).json().page;
    for (const tool of PI_ONLY_TOOLS) assert.ok(!page.includes(tool), `${entry.topic} names ${tool}`);
  }
});

// openlore: scenario=PiOutpostStillReadsTheWholePage spec=openwebui-structure-guide
test("PiOutpostStillReadsTheWholePage: the source keeps each pi-only passage, between its markers", async () => {
  const passages: Array<[string, string]> = [
    ["enriched-contract.md", "What a project's profile refuses"],
    ["graphs-and-tables.md", "`write_structure_figure` with `viewpoint"],
    ["timelines.md", "`write_structure_table` refuses it."],
    ["timelines.md", "call `compare_timelines` with the previous and the current one"],
    ["timelines.md", "- **To put a timeline in a report**"],
  ];
  for (const [file, text] of passages) {
    const content = await source(file);
    const at = content.indexOf(text);
    assert.ok(at >= 0, `${file} still holds "${text}"`);
    const begin = content.lastIndexOf("<!-- only: pi-outpost -->", at);
    const end = content.indexOf("<!-- end -->", at);
    assert.ok(begin >= 0 && end > at, `${file}: "${text}" sits between markers`);
    assert.ok(content.lastIndexOf("<!-- end -->", at) < begin, `${file}: no passage closed between the marker and "${text}"`);
  }
});

// openlore: scenario=AnUnknownTopicListsTheTopics spec=openwebui-structure-guide
test("AnUnknownTopicListsTheTopics: says so, lists what there is", async (t) => {
  const { call } = await testApp(t);
  for (const topic of ["mindmaps", "figures", 42]) {
    const response = await call("read_structure_guide", { topic });
    assert.equal(response.statusCode, 404, String(topic));
    assert.match(response.json().error, /no guide topic/);
    assert.equal(response.json().topics.length, GUIDE_TOPICS.length);
  }
});

// openlore: scenario=ReadingTheGuideNeedsTheSecret spec=openwebui-structure-guide
test("ReadingTheGuideNeedsTheSecret: refused like every other tool, and nothing written", async (t) => {
  const { app, config } = await testApp(t);
  for (const headers of [
    { "x-openwebui-user-jwt": mintToken("alice") },
    { authorization: "Bearer wrong", "x-openwebui-user-jwt": mintToken("alice") },
    { authorization: `Bearer ${SECRET}` },
  ]) {
    const response = await app.inject({ method: "POST", url: "/read_structure_guide", headers, payload: { topic: "proposals" } });
    assert.equal(response.statusCode, 401);
    assert.doesNotMatch(response.body, /target/);
  }
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

async function refusalOf(t: test.TestContext, fixture: string) {
  const { call } = await testApp(t);
  const document = JSON.parse(await fs.readFile(path.join(CONFORMANCE, fixture), "utf8"));
  const response = await call("show_structure", { document });
  assert.equal(response.statusCode, 422, fixture);
  return response.json() as { guide: string; error: string; issues: unknown[] };
}

// openlore: scenario=AProposalRefusalPointsToProposals spec=openwebui-structure-guide
test("AProposalRefusalPointsToProposals: change without a target, removal without one, a table proposed", async (t) => {
  for (const fixture of ["change-without-target.json", "removal-without-target.json", "change-without-reference.json"]) {
    const refusal = await refusalOf(t, fixture);
    assert.equal(refusal.guide, "proposals", fixture);
    assert.match(refusal.error, /read_structure_guide with topic "proposals"/);
  }
});

// openlore: scenario=ATimelineRefusalPointsToTimelines spec=openwebui-structure-guide
test("ATimelineRefusalPointsToTimelines: an inverted activity, a timeline with a target", async (t) => {
  for (const fixture of ["v3-timeline-inverted-activity.json", "v3-timeline-with-target.json"]) {
    assert.equal((await refusalOf(t, fixture)).guide, "timelines", fixture);
  }
});

// openlore: scenario=ATableProposalPointsToRowRoles spec=openwebui-structure-guide
test("ATableProposalPointsToRowRoles: a table with a target, or with removals, goes to the page on row roles", async (t) => {
  for (const fixture of ["table-with-target.json", "table-with-removal.json"]) {
    assert.equal((await refusalOf(t, fixture)).guide, "graphs-and-tables", fixture);
  }
  const page = await fs.readFile(path.join(REFERENCES, "graphs-and-tables.md"), "utf8");
  assert.match(page, /role/, "the page it points to does teach row roles");
});

test("other refusals point to the enriched contract for version 2, to graphs and tables otherwise", async (t) => {
  assert.equal((await refusalOf(t, "v2-viewpoint-retaining-nothing.json")).guide, "enriched");
  assert.equal((await refusalOf(t, "unresolved-endpoint.json")).guide, "graphs-and-tables");
  assert.equal((await refusalOf(t, "row-column-mismatch.json")).guide, "graphs-and-tables");
});
