/**
 * Two plans compared, as data: pairing by identifier, the shifts and their words,
 * what is new, what was dropped, and what could not be compared.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StructuredTimelineData, StructuredTimelineTask } from "@pi-outpost/shared/structured-exchange";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import {
  compareTimelines,
  describeDays,
  shiftText,
  taskChanged,
  withoutComparison,
} from "@pi-outpost/shared/structured-exchange/timeline-comparison";

const plan = (rows: StructuredTimelineData["rows"], extra: Partial<StructuredTimelineData> = {}): StructuredTimelineData => ({
  title: "Programme X",
  time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
  rows,
  ...extra,
});

const previous = plan([
  { type: "separator", label: "System A" },
  {
    type: "task",
    id: "T1",
    label: "Studies",
    items: [
      { type: "activity", id: "study", start: "2027-03-01", end: "2027-06-30", label: "Study" },
      { type: "milestone", id: "srr", date: "2027-03-01", kind: "SRR" },
      { type: "milestone", id: "pdr", date: "2027-05-15", kind: "PDR" },
      { type: "activity", id: "audit", start: "2027-07-01", end: "2027-07-15", label: "Audit" },
      { type: "milestone", date: "2027-08-01", label: "No id" },
    ],
  },
  { type: "task", id: "T2", label: "Prototype", items: [{ type: "activity", id: "proto", start: "2027-02-01", end: "2027-04-30" }] },
  { type: "task", id: "T3", label: "Tests", items: [{ type: "activity", id: "tests", start: "2027-09-01", end: "2027-10-31" }] },
]);

const current = plan(
  [
    { type: "separator", label: "System A" },
    {
      type: "task",
      id: "T1",
      label: "Studies",
      items: [
        { type: "activity", id: "study", start: "2027-03-22", end: "2027-07-21", label: "Study" },
        { type: "milestone", id: "srr", date: "2027-03-22", kind: "SRR" },
        { type: "milestone", id: "pdr", date: "2027-05-15", kind: "PDR" },
        { type: "milestone", id: "cdr", date: "2027-09-01", kind: "CDR" },
        { type: "milestone", date: "2027-08-15", label: "Still no id" },
        { type: "activity", start: "2027-10-01", end: "2027-10-02" },
      ],
    },
    { type: "task", id: "T3", label: "Tests", items: [{ type: "activity", id: "tests", start: "2027-09-01", end: "2027-11-30" }] },
    { type: "task", id: "T4", label: "Delivery", items: [{ type: "milestone", id: "qr", date: "2028-01-15" }] },
  ],
  { time: { start: "2027-01-01", end: "2028-01-31", scale: "month" } },
);

const result = compareTimelines(previous, current, "Plan of 1 September");
const task = (id: string) => result.data.rows.find((row) => row.type === "task" && row.id === id) as StructuredTimelineTask;
const item = (taskId: string, id: string) => task(taskId).items.find((candidate) => candidate.id === id)!;

describe("compareTimelines", () => {
  test("TheToolPairsByIdentifier", () => {
    assert.deepEqual(item("T1", "srr").previous, { date: "2027-03-01" });
    assert.deepEqual(item("T1", "study").previous, { start: "2027-03-01", end: "2027-06-30" });
    // Unmoved: no previous dates at all.
    assert.equal(item("T1", "pdr").previous, undefined);
    assert.equal(item("T1", "pdr").role, undefined);
  });

  test("new items and tasks are marked added", () => {
    assert.equal(item("T1", "cdr").role, "added");
    assert.equal(task("T4").role, "added");
    // An item of an added task is new with it; it does not repeat the mark.
    assert.equal(item("T4", "qr").role, undefined);
  });

  test("TheToolCarriesRemovedItems", () => {
    const audit = item("T1", "audit");
    assert.equal(audit.role, "removed");
    assert.equal(audit.type === "activity" && audit.start, "2027-07-01");
    // A dropped task keeps its place after the previous plan's earlier task.
    const order = result.data.rows.map((row) => (row.type === "task" ? `${row.id}${row.role ? `:${row.role}` : ""}` : "—"));
    assert.deepEqual(order, ["—", "T1", "T2:removed", "T3", "T4:added"]);
  });

  test("TheToolSaysWhatItCouldNotCompare", () => {
    assert.deepEqual(result.uncompared, { previous: 1, current: 2 });
    const unpaired = task("T1").items.filter((candidate) => candidate.id === undefined);
    assert.equal(unpaired.length, 2);
    for (const candidate of unpaired) {
      assert.equal(candidate.role, undefined);
      assert.equal(candidate.previous, undefined);
    }
  });

  test("the reference plan is named, the range covers both, and the inputs are untouched", () => {
    assert.deepEqual(result.data.comparedTo, { label: "Plan of 1 September" });
    assert.deepEqual(result.data.time, { start: "2027-01-01", end: "2028-01-31", scale: "month" });
    assert.equal(compareTimelines(previous, current).data.comparedTo?.label, "Programme X");
    assert.equal((previous.rows[1] as StructuredTimelineTask).items.length, 5);
    assert.equal((current.rows[1] as StructuredTimelineTask).items.some((candidate) => candidate.role !== undefined), false);
  });

  test("the comparison is a valid version 3 timeline", () => {
    const verdict = parseStructuredExchange(
      { schema: "urn:structured-exchange:3", kind: "timeline", data: result.data },
      checkStructuredExchangeSchema,
    );
    assert.equal(verdict.valid, true, verdict.valid ? "" : JSON.stringify(verdict.issues));
  });

  test("an identifier that changed type is new, not moved", () => {
    const changed = compareTimelines(
      plan([{ type: "task", id: "T", label: "T", items: [{ type: "activity", id: "x", start: "2027-01-01", end: "2027-01-31" }] }]),
      plan([{ type: "task", id: "T", label: "T", items: [{ type: "milestone", id: "x", date: "2027-02-01" }] }]),
    );
    const only = (changed.data.rows[0] as StructuredTimelineTask).items;
    assert.equal(only.length, 1);
    assert.equal(only[0].role, "added");
    assert.equal(only[0].previous, undefined);
  });

  test("the new version alone is the current plan", () => {
    assert.deepEqual(withoutComparison(result.data).rows, current.rows);
  });
});

describe("shifts in words", () => {
  test("units follow the size, and carry a sign", () => {
    assert.equal(describeDays(0), "");
    assert.equal(describeDays(3), "+3d");
    assert.equal(describeDays(-10), "−10d");
    assert.equal(describeDays(21), "+3w");
    assert.equal(describeDays(-63), "−9w");
    assert.equal(describeDays(91), "+3mo");
  });

  test("the start's shift then the end's; a lone end named", () => {
    const moved = (start: string, end: string, before: { start: string; end: string }) =>
      shiftText({ type: "activity", start, end, previous: before });
    const before = { start: "2027-03-01", end: "2027-03-29" };
    assert.equal(moved("2027-03-15", "2027-04-26", before), "+2w, end+4w");
    assert.equal(moved("2027-03-01", "2027-04-26", before), "end+4w");
    assert.equal(moved("2027-03-15", "2027-03-29", before), "start+2w");
    assert.equal(moved("2027-03-15", "2027-04-12", before), "+2w");
    assert.equal(moved("2027-03-04", "2027-04-01", before), "+3d");
  });

  test("ASlippedActivityShowsBothPositions (text)", () => {
    assert.equal(shiftText(item("T1", "study")), "+3w");
  });

  test("AStretchedActivityShowsBothEnds (text)", () => {
    assert.equal(shiftText(item("T3", "tests")), "end+4w");
  });

  test("AMovedMilestoneShowsWhereItWas (text)", () => {
    assert.equal(shiftText(item("T1", "srr")), "+3w");
    assert.equal(shiftText(item("T1", "pdr")), "");
  });

  test("a task holds a change when it or one of its items does", () => {
    assert.equal(taskChanged(task("T1")), true);
    assert.equal(taskChanged(task("T4")), true);
    const unchanged = compareTimelines(previous, previous).data.rows.find((row) => row.type === "task" && row.id === "T2") as StructuredTimelineTask;
    assert.equal(taskChanged(unchanged), false);
  });
});
