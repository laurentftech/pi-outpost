/**
 * Targeted updates: one change touches what it names, all or nothing, judged like a
 * creation, and never applied to a revision its author has not seen.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { filesUnder, samplePlanning, testApp } from "./helpers.ts";

async function created(t: test.TestContext, overrides = {}) {
  const harness = await testApp(t, overrides);
  const response = await harness.call("create_planning", { planning: samplePlanning() });
  assert.equal(response.statusCode, 201);
  return { ...harness, id: response.json().id as string };
}

/** Every path where two JSON values differ. */
function differences(a: unknown, b: unknown, path = ""): string[] {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Object.is(a, b) ? [] : [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((key) => differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`));
}

// openlore: scenario=MovingOneMilestoneChangesOnlyThatMilestone spec=openwebui-planning-server
test("MovingOneMilestoneChangesOnlyThatMilestone: the new revision differs in that date only", async (t) => {
  const { call, id } = await created(t);
  const before = (await call("get_planning", { id })).json().planning;
  const response = await call("update_planning", { id, base_revision: 1, operations: [{ op: "change_item", id: "srr", changes: { date: "2027-04-22" } }] });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().revision, 2);
  assert.deepEqual(differences(before, response.json().planning), ["/data/rows/1/items/1/date"]);
  assert.equal(response.json().planning.data.rows[1].items[1].date, "2027-04-22");
});

// openlore: scenario=AnUpdateKeepsThePreviousRevision spec=openwebui-planning-server
test("AnUpdateKeepsThePreviousRevision: revision 1 still reads as it was", async (t) => {
  const { call, id } = await created(t);
  await call("update_planning", { id, base_revision: 1, operations: [{ op: "set_title", title: "Renamed" }] });
  const first = await call("get_planning", { id, revision: 1 });
  const current = await call("get_planning", { id });
  assert.deepEqual(first.json().planning, samplePlanning());
  assert.equal(first.json().current_revision, 2);
  assert.equal(current.json().revision, 2);
  assert.equal(current.json().title, "Renamed");
  assert.equal((await call("list_plannings")).json().plannings[0].title, "Renamed");
});

// openlore: scenario=AnOperationOnAMissingIdentifierRefusesTheWholeUpdate spec=openwebui-planning-server
test("AnOperationOnAMissingIdentifierRefusesTheWholeUpdate: nothing applies, the failing one is named", async (t) => {
  const { call, config, id } = await created(t);
  const files = await filesUnder(config.dataDir);
  const response = await call("update_planning", {
    id,
    base_revision: 1,
    operations: [
      { op: "set_title", title: "Should not stick" },
      { op: "change_task", id: "NOPE", label: "x" },
    ],
  });
  assert.equal(response.statusCode, 422);
  assert.match(response.json().error, /operation 1 \(change_task\): no task "NOPE"/);
  assert.deepEqual(await filesUnder(config.dataDir), files);
  const current = await call("get_planning", { id });
  assert.equal(current.json().revision, 1);
  assert.equal(current.json().title, "Programme X");
});

// openlore: scenario=AnUpdateThatBreaksTheContractIsRefused spec=openwebui-planning-server
test("AnUpdateThatBreaksTheContractIsRefused: an end before its start, with the contract's diagnostic", async (t) => {
  const { call, id } = await created(t);
  const response = await call("update_planning", { id, base_revision: 1, operations: [{ op: "change_item", id: "build", changes: { end: "2027-04-01" } }] });
  assert.equal(response.statusCode, 422);
  assert.match(response.json().error, /nothing was changed/);
  assert.ok(Array.isArray(response.json().issues) && response.json().issues.length > 0);
  assert.equal((await call("get_planning", { id })).json().revision, 1);
});

// openlore: scenario=AStaleUpdateIsRefused spec=openwebui-planning-server
test("AStaleUpdateIsRefused: names the current revision, changes nothing", async (t) => {
  const { call, id } = await created(t);
  assert.equal((await call("update_planning", { id, base_revision: 1, operations: [{ op: "set_title", title: "Two" }] })).statusCode, 200);
  const stale = await call("update_planning", { id, base_revision: 1, operations: [{ op: "set_title", title: "Stale" }] });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().current, 2);
  assert.match(stale.json().error, /revision 2/);
  assert.equal((await call("get_planning", { id })).json().title, "Two");
});

test("two updates against the same revision at once: one lands, one is told it is stale", async (t) => {
  const { call, id } = await created(t);
  const results = await Promise.all(
    ["A", "B"].map((title) => call("update_planning", { id, base_revision: 1, operations: [{ op: "set_title", title }] })),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const current = await call("get_planning", { id });
  assert.equal(current.json().revision, 2);
  assert.equal(current.json().title, results.find((r) => r.statusCode === 200)!.json().title);
  assert.equal((await call("get_planning", { id, revision: 3 })).statusCode, 404);
});

// openlore: scenario=TheOldestRevisionsAreNotSilentlyLost spec=openwebui-planning-server
test("TheOldestRevisionsAreNotSilentlyLost: past the ceiling the update is refused, history intact", async (t) => {
  const { call, config, id } = await created(t, { maxRevisions: 2 });
  assert.equal((await call("update_planning", { id, base_revision: 1, operations: [{ op: "set_title", title: "Two" }] })).statusCode, 200);
  const files = await filesUnder(config.dataDir);
  const third = await call("update_planning", { id, base_revision: 2, operations: [{ op: "set_title", title: "Three" }] });
  assert.equal(third.statusCode, 422);
  assert.equal(third.json().limit, 2);
  assert.deepEqual(await filesUnder(config.dataDir), files);
  assert.deepEqual((await call("get_planning", { id, revision: 1 })).json().planning, samplePlanning());
});

test("operations cover the planning's parts and keep dependencies consistent", async (t) => {
  const { call, id } = await created(t);
  const response = await call("update_planning", {
    id,
    base_revision: 1,
    operations: [
      { op: "add_task", task: { id: "T3", label: "Test", items: [{ type: "activity", start: "2027-10-01", end: "2027-11-15", label: "Tests" }] }, after: "T2" },
      { op: "add_dependency", dependency: { from: "build", to: "T3" } },
      { op: "add_separator", label: "System B", before: "T3" },
      { op: "change_task", id: "T2", new_id: "T2b", label: "Build it" },
      { op: "move_task", id: "T1", after: "T2b" },
      { op: "set_periods", periods: [{ start: "2027-08-01", end: "2027-08-20", label: "Closure" }] },
      { op: "set_references", references: [{ date: "2027-12-15", label: "Delivery" }] },
      { op: "set_time", end: "2027-12-31", scale: "quarter" },
    ],
  });
  assert.equal(response.statusCode, 200, response.body);
  const data = response.json().planning.data;
  assert.deepEqual(
    data.rows.map((row: { type: string; id?: string; label?: string }) => row.id ?? `[${row.label ?? ""}]`),
    ["[System A]", "T2b", "T1", "[System B]", "T3"],
  );
  assert.equal(data.rows[4].items[0].id, "T3.1", "an added item without an id is named");
  assert.equal(data.time.scale, "quarter");
  // Renaming a task renamed the links to it; nothing points at "T2" any more.
  assert.ok(!JSON.stringify(data.dependencies).includes('"T2"'));

  // Removing a task takes its links with it.
  const removed = await call("update_planning", { id, base_revision: 2, operations: [{ op: "remove_task", id: "T3" }, { op: "remove_separator", row: 3 }] });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.ok(!(removed.json().planning.data.dependencies ?? []).some((link: { to: string }) => link.to === "T3"));
  assert.equal(removed.json().planning.data.rows.length, 3);

  const bad = await call("update_planning", { id, base_revision: 3, operations: [{ op: "remove_separator", row: 1 }] });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.json().error, /row 1 is not a separator/);
  const unknown = await call("update_planning", { id, base_revision: 3, operations: [{ op: "rewrite_everything" }] });
  assert.match(unknown.json().error, /unknown operation "rewrite_everything"; known: set_title/);
});

// openlore: scenario=ShowingAComparisonDrawsWhatMoved spec=openwebui-planning-server
test("ShowingAComparisonDrawsWhatMoved: the embedded data carries the previous and current position", async (t) => {
  const { call, id } = await created(t);
  await call("update_planning", { id, base_revision: 1, operations: [{ op: "change_item", id: "srr", changes: { date: "2027-05-03" } }] });
  const shown = await call("show_planning", { id, compare_to: 1 });
  assert.equal(shown.statusCode, 200);
  const match = /data-planning="([A-Za-z0-9+/=]*)"/.exec(shown.body);
  const embedded = JSON.parse(gunzipSync(Buffer.from(match![1]!, "base64")).toString("utf8"));
  assert.equal(embedded.comparedWith, 1);
  assert.ok(embedded.data.comparedTo, "a comparison");
  const srr = embedded.data.rows[1].items[1];
  assert.equal(srr.date, "2027-05-03");
  assert.deepEqual(srr.previous, { date: "2027-04-15" });
  // The stored planning stays a plan.
  assert.equal((await call("get_planning", { id })).json().planning.data.comparedTo, undefined);
  assert.equal((await call("show_planning", { id, compare_to: 7 })).statusCode, 404);
});
