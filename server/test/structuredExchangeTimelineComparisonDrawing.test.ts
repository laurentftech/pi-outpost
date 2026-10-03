/**
 * A compared timeline, drawn: previous positions dashed, shifts in words, new and
 * dropped things marked, both views, and only what moved.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StructuredTimelineData, StructuredTimelineTask } from "@pi-outpost/shared/structured-exchange";
import { serializeFigure, type FigureGroup } from "@pi-outpost/shared/structured-exchange/figure";
import { dayNumber, layoutTimeline, TIMELINE_PX_PER_DAY } from "@pi-outpost/shared/structured-exchange/timeline";
import { compareTimelines, withoutComparison } from "@pi-outpost/shared/structured-exchange/timeline-comparison";
import { timelineFigure, timelineFigureParts } from "@pi-outpost/shared/structured-exchange/timeline-figure";

const today = dayNumber("2027-01-15")!;
const plan = (rows: StructuredTimelineData["rows"]): StructuredTimelineData => ({
  title: "Programme X",
  time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
  rows,
});
const previous = plan([
  { type: "separator", label: "System A" },
  {
    type: "task",
    id: "T1",
    label: "Studies",
    items: [
      { type: "activity", id: "study", start: "2027-03-01", end: "2027-06-30", label: "Study" },
      { type: "activity", id: "design", start: "2027-07-01", end: "2027-08-31", label: "Design" },
      { type: "milestone", id: "pdr", date: "2027-05-15", kind: "PDR" },
      { type: "milestone", id: "audit", date: "2027-06-01", label: "Audit" },
    ],
  },
  { type: "task", id: "T2", label: "Stable", items: [{ type: "activity", id: "stable", start: "2027-02-01", end: "2027-04-30", label: "Stable" }] },
  { type: "separator", label: "System B" },
  { type: "task", id: "T3", label: "Also stable", items: [{ type: "milestone", id: "b", date: "2027-09-01", kind: "QR" }] },
]);
const current = plan([
  { type: "separator", label: "System A" },
  {
    type: "task",
    id: "T1",
    label: "Studies",
    items: [
      { type: "activity", id: "study", start: "2027-03-22", end: "2027-07-21", label: "Study" },
      { type: "activity", id: "design", start: "2027-07-01", end: "2027-09-28", label: "Design" },
      { type: "milestone", id: "pdr", date: "2027-06-01", kind: "PDR" },
      { type: "milestone", id: "trr", date: "2027-10-15", label: "Test Readiness Review" },
    ],
  },
  { type: "task", id: "T2", label: "Stable", items: [{ type: "activity", id: "stable", start: "2027-02-01", end: "2027-04-30", label: "Stable" }] },
  { type: "separator", label: "System B" },
  { type: "task", id: "T3", label: "Also stable", items: [{ type: "milestone", id: "b", date: "2027-09-01", kind: "QR" }] },
]);
const compared = compareTimelines(previous, current, "Plan of 1 September").data;
const x = (date: string) => (dayNumber(date)! - dayNumber("2027-01-01")!) * TIMELINE_PX_PER_DAY;

const laid = layoutTimeline(compared, today);
const itemNamed = (id: string) => {
  const task = compared.rows[1] as StructuredTimelineTask;
  const index = task.items.findIndex((item) => item.id === id);
  return laid.items.find((item) => item.row === 1 && item.item === index)!;
};

describe("TheComparisonShowsWhatMoved", () => {
  test("ASlippedActivityShowsBothPositions", () => {
    const study = itemNamed("study");
    assert.equal(study.change, "moved");
    assert.equal(study.ghost!.x, x("2027-03-01"));
    assert.equal(study.ghost!.width, x("2027-07-01") - x("2027-03-01"));
    assert.equal(study.glyph.x, x("2027-03-22"));
    assert.equal(study.label!.text, "Study +3 wk");
  });

  test("AStretchedActivityShowsBothEnds", () => {
    assert.equal(itemNamed("design").label!.text, "Design end +4 wk");
  });

  test("AMovedMilestoneShowsWhereItWas", () => {
    const pdr = itemNamed("pdr");
    assert.equal(pdr.ghostCenter!.x, x("2027-05-15") + TIMELINE_PX_PER_DAY / 2);
    assert.equal(pdr.center!.x, x("2027-06-01") + TIMELINE_PX_PER_DAY / 2);
    assert.equal(pdr.label!.text, "PDR +2 wk");
    const svg = serializeFigure(timelineFigure(compared, { today, referenceLine: "none" }));
    // A hollow dashed star for the previous date.
    assert.match(svg, /<path [^>]*fill="none"[^>]*stroke-dasharray="2 2" data-previous="true"/);
  });

  test("AddedAndRemovedAreMarked", () => {
    const trr = itemNamed("trr");
    assert.equal(trr.change, "added");
    assert.equal(trr.label!.text, "Test Readiness Review · new");
    const audit = itemNamed("audit");
    assert.equal(audit.change, "removed");
    assert.equal(audit.label!.struck, true);
    const svg = serializeFigure(timelineFigure(compared, { today, referenceLine: "none" }));
    assert.match(svg, /text-decoration="line-through"[^>]*>Audit</);
    assert.match(svg, /data-testid="timeline-comparison-legend"/);
  });

  test("TheReferencePlanIsNamed", () => {
    const svg = serializeFigure(timelineFigure(compared, { today, referenceLine: "none" }));
    assert.match(svg, />Compared with Plan of 1 September</);
  });

  test("no annotation overlaps a previous position, another annotation, or a glyph", () => {
    const boxes = laid.items.flatMap((item) => [
      { owner: item, box: item.glyph },
      ...(item.ghost ? [{ owner: item, box: item.ghost }] : []),
    ]);
    const hits = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const item of laid.items) {
      if (item.label === undefined) continue;
      for (const other of boxes) {
        if (other.owner === item) continue;
        assert.ok(!hits(item.label, other.box), `"${item.label.text}" overlaps item ${other.owner.item}`);
      }
      for (const other of laid.items) {
        if (other !== item && other.label) assert.ok(!hits(item.label, other.label), `"${item.label.text}" overlaps "${other.label.text}"`);
      }
    }
  });
});

describe("TheReaderSwitchesBetweenComparisonAndNewVersion", () => {
  test("TheNewVersionOnlyLooksLikeAPlainPlan", () => {
    const options = { today, referenceLine: "none" as const };
    assert.equal(
      serializeFigure(timelineFigure(compared, { ...options, comparison: "new" })),
      serializeFigure(timelineFigure(withoutComparison(compared), options)),
    );
    assert.equal(serializeFigure(timelineFigure(withoutComparison(compared), options)), serializeFigure(timelineFigure(current, options)));
  });

  test("BackToTheComparison (figure level)", () => {
    const svg = serializeFigure(timelineFigure(compared, { today, comparison: "compare" }));
    assert.match(svg, /data-previous="true"/);
    assert.match(svg, /Compared with/);
  });
});

describe("TheReaderCanShowOnlyWhatMoved", () => {
  test("OnlyWhatMovedHidesUnchangedTasks", () => {
    const only = layoutTimeline(compared, today, { onlyChanged: true });
    assert.deepEqual(
      only.rows.map((row) => (row.type === "task" ? row.id : `— ${(row as { label?: string }).label}`)),
      ["— System A", "T1"],
    );
    assert.equal(only.hiddenTasks, 2);
    const parts = timelineFigureParts(compared, { today, onlyChanged: true });
    assert.ok(!parts.rows.some((group: FigureGroup) => group.data?.row === "2"));
  });

  test("a plain timeline ignores the filter", () => {
    assert.equal(layoutTimeline(current, today, { onlyChanged: true }).hiddenTasks, 0);
  });
});
