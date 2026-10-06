/**
 * Creating, listing and reading plannings: the same contract as pi-outpost, personal
 * to each user, every write a revision, and the ceilings enforced before anything is
 * written.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { filesUnder, samplePlanning, testApp } from "./helpers.ts";

const CONFORMANCE = fileURLToPath(new URL("../../shared/conformance/", import.meta.url));
const conformance = async (name: string) => JSON.parse(await fs.readFile(path.join(CONFORMANCE, name), "utf8"));

// openlore: scenario=AValidTimelineIsCreated spec=openwebui-planning-server
test("AValidTimelineIsCreated: stored, answered with its id, first revision and title", async (t) => {
  const { call } = await testApp(t);
  const created = await call("create_planning", { planning: samplePlanning("Programme X") });
  assert.equal(created.statusCode, 201);
  const body = created.json();
  assert.match(body.id, /^pl_[A-Za-z0-9_-]{16}$/);
  assert.equal(body.revision, 1);
  assert.equal(body.current_revision, 1);
  assert.equal(body.title, "Programme X");
  assert.deepEqual(body.planning, samplePlanning("Programme X"));

  const read = await call("get_planning", { id: body.id });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json().planning, samplePlanning("Programme X"));
});

// openlore: scenario=AnInvalidTimelineIsRefusedWithDiagnostics spec=openwebui-planning-server
test("AnInvalidTimelineIsRefusedWithDiagnostics: the diagnostics pi-outpost gives, and nothing stored", async (t) => {
  const { call, config } = await testApp(t);
  const inverted = samplePlanning();
  (inverted.data.rows[2] as { items: Array<{ start: string; end: string }> }).items[0]!.start = "2027-10-30";
  const response = await call("create_planning", { planning: inverted });
  assert.equal(response.statusCode, 422);
  const expected = parseSerializedStructuredExchange(JSON.stringify(inverted), checkStructuredExchangeSchema);
  assert.equal(expected.valid, false);
  assert.deepEqual(response.json().issues, expected.issues);
  assert.ok(response.json().issues.length > 0);
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

// openlore: scenario=AnotherKindIsRefused spec=openwebui-planning-server
test("AnotherKindIsRefused: a valid version 3 document that is not a timeline", async (t) => {
  const { call, config } = await testApp(t);
  // Version 3 accepts every version 2 document with the same meaning, so a version 2
  // fixture re-declared as version 3 is a valid version 3 document of another kind.
  const valid = await fs.readdir(path.join(CONFORMANCE, "valid"));
  const other = valid.find((name) => name.startsWith("v2-"));
  assert.ok(other, "a version 2 fixture");
  const document = { ...(await conformance(`valid/${other}`)), schema: "urn:structured-exchange:3" };
  assert.equal(parseSerializedStructuredExchange(JSON.stringify(document), checkStructuredExchangeSchema).valid, true);
  assert.notEqual(document.kind, "timeline");
  const response = await call("create_planning", { planning: document });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().issues[0].rule, "planning-is-a-timeline");
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

/** A planning with `schema` and `kind` inside `data`, as a model sent one. */
function misplacedEnvelope(planning: ReturnType<typeof samplePlanning>) {
  const { schema, kind, data } = planning;
  return { data: { ...data, schema, kind } };
}

/** The other forms `data` can take, which a planning's diagnostics must never send the model to. */
const OTHER_FORMS = /nodes|edges|participants|messages|columns/;

// openlore: scenario=AMisplacedEnvelopeIsNamedWithTheRest spec=openwebui-planning-server
test("AMisplacedEnvelopeIsNamedWithTheRest: schema and kind inside data, and an activity without an end", async (t) => {
  const { call, config } = await testApp(t);
  const broken = samplePlanning();
  delete (broken.data.rows[1] as { items: Array<{ end?: string }> }).items[0]!.end;
  const response = await call("create_planning", { planning: misplacedEnvelope(broken) });
  assert.equal(response.statusCode, 422);
  const issues = response.json().issues as Array<{ rule: string; path: string; message: string }>;
  // What the contract says of the same planning with its envelope where it belongs.
  const expected = parseSerializedStructuredExchange(JSON.stringify(broken), checkStructuredExchangeSchema);
  assert.equal(expected.valid, false);
  assert.deepEqual(issues.slice(2), expected.issues);
  assert.deepEqual(issues.slice(0, 2).map(({ rule, path: at }) => ({ rule, path: at })), [
    { rule: "envelope-inside-data", path: "/data/schema" },
    { rule: "envelope-inside-data", path: "/data/kind" },
  ]);
  for (const issue of issues.slice(0, 2)) {
    assert.match(issue.message, /beside "data"/);
    assert.ok(issue.message.includes('{"schema":"urn:structured-exchange:3","kind":"timeline","data":{…}}'), issue.message);
  }
  assert.ok(issues.every((issue) => !OTHER_FORMS.test(issue.message)), JSON.stringify(issues));
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

// openlore: scenario=AMisplacedEnvelopeIsRefusedEvenWhenTheRestIsValid spec=openwebui-planning-server
test("AMisplacedEnvelopeIsRefusedEvenWhenTheRestIsValid: only the envelope is named", async (t) => {
  const { call, config } = await testApp(t);
  const response = await call("create_planning", { planning: misplacedEnvelope(samplePlanning()) });
  assert.equal(response.statusCode, 422);
  const issues = response.json().issues as Array<{ rule: string; path: string }>;
  assert.deepEqual(issues.map(({ rule, path: at }) => ({ rule, path: at })), [
    { rule: "envelope-inside-data", path: "/data/schema" },
    { rule: "envelope-inside-data", path: "/data/kind" },
  ]);
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

// openlore: scenario=AWrongEnvelopeIsAnsweredWithTheEnvelopeAlone spec=openwebui-planning-server
test("AWrongEnvelopeIsAnsweredWithTheEnvelopeAlone: a missing or foreign kind or schema, whatever data holds", async (t) => {
  const { call, config } = await testApp(t);
  const { schema, data } = samplePlanning();
  // Each also carries an activity without an end, which only the timeline form would see.
  delete (data.rows[1] as { items: Array<{ end?: string }> }).items[0]!.end;
  const cases: Array<[Record<string, unknown>, Array<{ path: string; says: RegExp }>]> = [
    [{ schema, data }, [{ path: "/kind", says: /"kind" is missing/ }]],
    [{ schema, kind: "graph", data }, [{ path: "/kind", says: /not "graph"/ }]],
    [{ kind: "timeline", data }, [{ path: "/schema", says: /"schema" is missing/ }]],
    [{ schema: "urn:structured-exchange:2", kind: "timeline", data }, [{ path: "/schema", says: /not "urn:structured-exchange:2"/ }]],
    [{ data }, [{ path: "/kind", says: /"kind" is missing/ }, { path: "/schema", says: /"schema" is missing/ }]],
    // Moved from data, and still not a timeline's: named where it was found.
    [{ data: { ...data, schema, kind: "table" } }, [{ path: "/data/kind", says: /not "table"/ }]],
  ];
  for (const [planning, want] of cases) {
    const response = await call("create_planning", { planning });
    assert.equal(response.statusCode, 422, JSON.stringify(planning).slice(0, 80));
    const issues = response.json().issues as Array<{ rule: string; path: string; message: string }>;
    const timeline = issues.filter((issue) => issue.rule === "planning-is-a-timeline");
    assert.equal(timeline.length, want.length, JSON.stringify(issues));
    want.forEach(({ path: at, says }, index) => {
      assert.equal(timeline[index]!.path, at);
      assert.match(timeline[index]!.message, says);
      assert.ok(timeline[index]!.message.includes('"kind":"timeline"'), "the message shows the envelope to write");
    });
    assert.ok(issues.every((issue) => issue.rule === "planning-is-a-timeline" || issue.rule === "envelope-inside-data"), JSON.stringify(issues));
    assert.ok(issues.every((issue) => !OTHER_FORMS.test(issue.message)), JSON.stringify(issues));
  }
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

// openlore: scenario=AComparisonIsNotAPlanning spec=openwebui-planning-server
test("AComparisonIsNotAPlanning: a compared timeline is refused, pointing at show_planning", async (t) => {
  const { call, config } = await testApp(t);
  const compared = await conformance("valid/v3-timeline-compared.json");
  assert.equal(parseSerializedStructuredExchange(JSON.stringify(compared), checkStructuredExchangeSchema).valid, true);
  const response = await call("create_planning", { planning: compared });
  assert.equal(response.statusCode, 422);
  const issues = response.json().issues as Array<{ rule: string; message: string }>;
  assert.ok(issues.length > 0);
  assert.ok(issues.every((issue) => issue.rule === "planning-is-a-plan" && /show_planning/.test(issue.message)));
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

// openlore: scenario=AStoredPlanningOpensInPiOutpost spec=openwebui-planning-server
test("AStoredPlanningOpensInPiOutpost: every revision file passes pi-outpost's own gate", async (t) => {
  const { call, config } = await testApp(t);
  const programme = await conformance("valid/v3-timeline-programme.json");
  const created = await call("create_planning", { planning: programme });
  assert.equal(created.statusCode, 201);
  const files = (await filesUnder(config.dataDir)).filter((file) => /\d+\.json$/.test(file));
  assert.equal(files.length, 1);
  const stored = await fs.readFile(path.join(config.dataDir, files[0]!), "utf8");
  const verdict = parseSerializedStructuredExchange(stored, checkStructuredExchangeSchema);
  assert.equal(verdict.valid, true);
  assert.deepEqual(JSON.parse(stored), created.json().planning);
});

// openlore: scenario=ItemsWithoutIdentifiersCanBeNamedAfterCreation spec=openwebui-planning-server
test("ItemsWithoutIdentifiersCanBeNamedAfterCreation: anonymous items get unique ids", async (t) => {
  const { call } = await testApp(t);
  const planning = samplePlanning();
  const items = (planning.data.rows[1] as { items: Array<{ id?: string }> }).items;
  delete items[1]!.id;
  // An existing id that looks like a generated one must not be reused.
  (planning.data.rows[2] as { items: Array<{ id?: string }> }).items[0]!.id = "T1.1";
  planning.data.dependencies = [];
  const created = await call("create_planning", { planning });
  assert.equal(created.statusCode, 201);
  const milestone = created.json().planning.data.rows[1].items[1];
  assert.equal(milestone.type, "milestone");
  assert.equal(milestone.id, "T1.2");
  const read = await call("get_planning", { id: created.json().id });
  assert.equal(read.json().planning.data.rows[1].items[1].id, "T1.2");
});

// openlore: scenario=AUserListsOnlyTheirOwnPlannings spec=openwebui-planning-server
test("AUserListsOnlyTheirOwnPlannings: two users, two lists", async (t) => {
  const { call } = await testApp(t);
  const alices = await call("create_planning", { planning: samplePlanning("Alice's") }, "alice");
  const bobs = await call("create_planning", { planning: samplePlanning("Bob's") }, "bob");
  const aliceList = (await call("list_plannings", {}, "alice")).json().plannings;
  const bobList = (await call("list_plannings", {}, "bob")).json().plannings;
  assert.deepEqual(aliceList.map((p: { id: string; title: string }) => [p.id, p.title]), [[alices.json().id, "Alice's"]]);
  assert.deepEqual(bobList.map((p: { id: string; title: string }) => [p.id, p.title]), [[bobs.json().id, "Bob's"]]);
});

// openlore: scenario=AnotherUsersPlanningIsNotFound spec=openwebui-planning-server
test("AnotherUsersPlanningIsNotFound: answered exactly as an unknown id, and unchanged", async (t) => {
  const { call, config } = await testApp(t);
  const bobs = await call("create_planning", { planning: samplePlanning("Bob's") }, "bob");
  const id = bobs.json().id as string;
  const before = await filesUnder(config.dataDir);
  const unknown = "pl_AAAAAAAAAAAAAAAA";
  for (const tool of ["get_planning", "show_planning"]) {
    const theirs = await call(tool, { id }, "alice");
    const missing = await call(tool, { id: unknown }, "alice");
    assert.equal(theirs.statusCode, 404, tool);
    assert.equal(missing.statusCode, 404, tool);
    assert.equal(theirs.json().error.replace(id, "<id>"), missing.json().error.replace(unknown, "<id>"), tool);
  }
  assert.deepEqual(await filesUnder(config.dataDir), before);
  // Said to the model, which once told the user a planning it never showed was on screen.
  const unknownAnswer = (await call("show_planning", { id: "pl_…" }, "alice")).json().error as string;
  assert.match(unknownAnswer, /Nothing was shown — do not tell the user it was/);
  assert.match(unknownAnswer, /create_planning or list_plannings/);
  // A path in place of an id names nothing either.
  assert.equal((await call("get_planning", { id: "../x" }, "alice")).statusCode, 404);
});

// openlore: scenario=AnUnknownRevisionIsNotFound spec=openwebui-planning-server
test("AnUnknownRevisionIsNotFound: names the current revision", async (t) => {
  const { call } = await testApp(t);
  const created = await call("create_planning", { planning: samplePlanning() });
  for (const revision of [0, 2, 99]) {
    const response = await call("get_planning", { id: created.json().id, revision });
    assert.equal(response.statusCode, 404, String(revision));
    assert.equal(response.json().current, 1);
    assert.match(response.json().error, /current revision is 1/);
  }
  assert.equal((await call("get_planning", { id: created.json().id, revision: 1 })).statusCode, 200);
});

// openlore: scenario=APlanningTooLargeIsRefused spec=openwebui-planning-server
test("APlanningTooLargeIsRefused: names the ceiling, stores nothing", async (t) => {
  const { call, config } = await testApp(t, { maxPlanningBytes: 2_000 });
  const big = samplePlanning("x".repeat(100));
  (big.data.rows[1] as { label: string }).label = "y".repeat(1_900);
  const response = await call("create_planning", { planning: big });
  assert.equal(response.statusCode, 413);
  assert.match(response.json().error, /ceiling of 2000 bytes/);
  assert.equal(response.json().issues[0].limit, 2_000);
  assert.deepEqual(await filesUnder(config.dataDir), []);
});

test("the plannings-per-user ceiling refuses the next creation and names it", async (t) => {
  const { call } = await testApp(t, { maxPlanningsPerUser: 2 });
  assert.equal((await call("create_planning", { planning: samplePlanning("1") })).statusCode, 201);
  assert.equal((await call("create_planning", { planning: samplePlanning("2") })).statusCode, 201);
  const third = await call("create_planning", { planning: samplePlanning("3") });
  assert.equal(third.statusCode, 422);
  assert.equal(third.json().limit, 2);
  assert.equal((await call("list_plannings")).json().plannings.length, 2);
  // Another user is not affected.
  assert.equal((await call("create_planning", { planning: samplePlanning("b") }, "bob")).statusCode, 201);
});
