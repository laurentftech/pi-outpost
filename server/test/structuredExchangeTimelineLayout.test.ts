/**
 * The timeline's geometry: dates to coordinates, without a browser.
 *
 * Asserted on the layout rather than on pixels in a page, because the layout is
 * the whole of what the reader is shown — the view only paints it. Each test names
 * the scenario it holds the renderer to.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";
import {
  annotationOf,
  dayNumber,
  layoutTimeline,
  localToday,
  TIMELINE_PX_PER_DAY,
  type TimelineBox,
  type TimelineLayout,
} from "@pi-outpost/shared/structured-exchange/timeline";
import { assignTints } from "@pi-outpost/shared/structured-exchange/palette";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PROGRAMME = path.join(ROOT, "shared/conformance/valid/v3-timeline-programme.json");

const programme = (): StructuredTimelineData => JSON.parse(readFileSync(PROGRAMME, "utf8")).data;
const day = (date: string) => dayNumber(date)!;
const layout = (data: StructuredTimelineData, today = "2027-01-15") => layoutTimeline(data, day(today));

const plan = (rows: StructuredTimelineData["rows"], extra: Partial<StructuredTimelineData> = {}): StructuredTimelineData => ({
  time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
  rows,
  ...extra,
});

const itemAt = (laid: TimelineLayout, row: number, item: number) => {
  const found = laid.items.find((candidate) => candidate.row === row && candidate.item === item);
  assert.ok(found, `no item at row ${row}, item ${item}`);
  return found;
};

const intersects = (a: TimelineBox, b: TimelineBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("TheTimeAxisIsProportionalToCalendarTime", () => {
  test("EqualDurationsHaveEqualWidths", () => {
    const laid = layout(
      plan([
        {
          type: "task",
          id: "T",
          label: "Work",
          items: [
            { type: "activity", start: "2027-01-01", end: "2027-03-31" }, // 90 days
            { type: "activity", start: "2027-04-01", end: "2027-09-27" }, // 180 days
          ],
        },
      ]),
    );
    const short = itemAt(laid, 0, 0).glyph.width;
    const long = itemAt(laid, 0, 1).glyph.width;
    assert.equal(short, 90 * TIMELINE_PX_PER_DAY);
    assert.equal(long, 2 * short);
  });

  test("MonthsAreNotEqualColumns", () => {
    const laid = layout(plan([]));
    const february = laid.months.find((month) => month.label === "Feb")!;
    const march = laid.months.find((month) => month.label === "Mar")!;
    assert.equal(march.width / february.width, 31 / 28);
    // Positions come from days, not from month indices.
    assert.equal(march.x, (31 + 28) * TIMELINE_PX_PER_DAY);
  });

  test("YearsAndMonthsAreLabelled", () => {
    const laid = layout(programme());
    assert.deepEqual(
      laid.years.map((year) => year.label),
      ["2026", "2027", "2028"],
    );
    assert.deepEqual(
      laid.months.map((month) => month.label),
      ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"],
    );
    // Each year band spans exactly its months, and the bands tile the axis.
    assert.equal(
      laid.years.reduce((sum, year) => sum + year.width, 0),
      laid.width,
    );
    assert.equal(laid.monthLines.length, 17);
  });

  test("the drawing grows with the range rather than squeezing it", () => {
    const decade = { ...plan([]), time: { start: "2020-01-01", end: "2029-12-31", scale: "month" as const } };
    assert.equal(layout(decade, "2025-01-01").width, (day("2029-12-31") - day("2020-01-01") + 1) * TIMELINE_PX_PER_DAY);
  });

  test("TimeZoneDoesNotMovePositions", () => {
    const script = `
      import { layoutTimeline, dayNumber } from "@pi-outpost/shared/structured-exchange/timeline";
      import { readFileSync } from "node:fs";
      const data = JSON.parse(readFileSync(${JSON.stringify(PROGRAMME)}, "utf8")).data;
      process.stdout.write(JSON.stringify(layoutTimeline(data, dayNumber("2027-01-15"))));
    `;
    const run = (zone: string) =>
      execFileSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
        cwd: ROOT,
        env: { ...process.env, TZ: zone, NODE_V8_COVERAGE: "" },
        encoding: "utf8",
      });
    const auckland = run("Pacific/Auckland");
    const losAngeles = run("America/Los_Angeles");
    assert.ok(auckland.length > 100);
    assert.equal(auckland, losAngeles);
  });
});

describe("TasksAndSeparatorsAreDrawnAsRows", () => {
  test("RowsKeepDeclarationOrder", () => {
    const laid = layout(programme());
    assert.deepEqual(
      laid.rows.map((row) => `${row.type}:${row.row}`),
      ["separator:0", "task:1", "task:2", "separator:3", "task:4", "separator:5", "task:6"],
    );
    for (let index = 1; index < laid.rows.length; index++) {
      assert.equal(laid.rows[index].y, laid.rows[index - 1].y + laid.rows[index - 1].height);
    }
  });

  test("ActivitiesAreBarsAndMilestonesAreStars", () => {
    const laid = layout(programme());
    const bar = itemAt(laid, 1, 0);
    const star = itemAt(laid, 1, 1);
    assert.equal(bar.type, "activity");
    assert.equal(bar.center, undefined);
    assert.ok(bar.glyph.width > bar.glyph.height, "a bar is horizontal");
    assert.equal(star.type, "milestone");
    assert.ok(star.center, "a star is drawn round a centre");
    assert.equal(star.center!.x, (day("2027-03-01") - day("2026-10-01") + 0.5) * TIMELINE_PX_PER_DAY);
  });

  test("SeparatorsDoNotMoveTheAxis", () => {
    const without = programme();
    without.rows = without.rows.filter((row) => row.type !== "separator");
    const before = layout(without);
    const after = layout(programme());
    assert.equal(after.width, before.width);
    const xs = (laid: TimelineLayout) => laid.items.map((item) => item.glyph.x).sort((a, b) => a - b);
    assert.deepEqual(xs(after), xs(before));
  });

  test("ASingleDayActivityIsValid (drawn with a visible width)", () => {
    const laid = layout(plan([{ type: "task", id: "T", label: "Audit", items: [{ type: "activity", start: "2027-06-15", end: "2027-06-15" }] }]));
    assert.equal(itemAt(laid, 0, 0).glyph.width, TIMELINE_PX_PER_DAY);
  });
});

describe("ItemsAreAnnotatedWithTheirMeaning", () => {
  test("AnActivityShowsItsLabel", () => {
    const laid = layout(programme());
    assert.equal(itemAt(laid, 1, 0).label?.text, "Étude préliminaire");
  });

  test("AMilestoneFallsBackToItsKind", () => {
    const laid = layout(plan([{ type: "task", id: "T", label: "Reviews", items: [{ type: "milestone", date: "2027-03-01", kind: "SRR" }] }]));
    assert.equal(itemAt(laid, 0, 0).label?.text, "SRR");
  });

  test("AnUnlabelledItemIsNotAnnotated", () => {
    const laid = layout(
      plan([
        {
          type: "task",
          id: "T",
          label: "Work",
          items: [
            { type: "activity", start: "2027-01-01", end: "2027-02-01", kind: "build" },
            { type: "milestone", date: "2027-05-01" },
          ],
        },
      ]),
    );
    assert.equal(itemAt(laid, 0, 0).label, undefined);
    assert.equal(itemAt(laid, 0, 1).label, undefined);
    assert.equal(annotationOf({ type: "activity", start: "2027-01-01", end: "2027-01-02", kind: "build" }), undefined);
  });

  test("CrowdedAnnotationsDoNotOverlap", () => {
    const laid = layout(
      plan([
        {
          type: "task",
          id: "T",
          label: "Reviews",
          items: [
            { type: "activity", start: "2027-02-01", end: "2027-04-30", label: "Detailed design" },
            { type: "milestone", date: "2027-03-01", kind: "SRR", label: "System Requirements Review" },
            { type: "milestone", date: "2027-03-03", kind: "PDR", label: "Preliminary Design Review" },
            { type: "milestone", date: "2027-03-06", kind: "CDR", label: "Critical Design Review" },
          ],
        },
      ]),
    );
    const placed = laid.items.filter((item) => item.row === 0);
    for (const mine of placed) {
      if (mine.label === undefined) continue;
      for (const theirs of placed) {
        if (theirs === mine) continue;
        assert.ok(!intersects(mine.label, theirs.glyph), `"${mine.label.text}" overlaps item ${theirs.item}`);
        if (theirs.label !== undefined) {
          assert.ok(!intersects(mine.label, theirs.label), `"${mine.label.text}" overlaps "${theirs.label.text}"`);
        }
      }
    }
    // The row grew lanes to make the room, and every annotation is still drawn.
    assert.ok(laid.rows[0].type === "task" && laid.rows[0].lanes >= 3);
    assert.equal(placed.filter((item) => item.label !== undefined).length, 4);
  });

  test("a milestone sits on its activity's line or below it, never above", () => {
    // SRR falls before the detailed study starts, and its label runs into that bar.
    const laid = layout(programme());
    const lane = (item: number) => itemAt(laid, 1, item).lane;
    const activities = [lane(0), lane(2)];
    const milestones = [lane(1), lane(3), lane(4)];
    assert.deepEqual(activities, [0, 0]);
    for (const milestoneLane of milestones) assert.ok(milestoneLane >= Math.min(...activities));
    // Room on the activities' line: the review closing the preliminary study stays on it.
    assert.ok(milestones.includes(0));
  });

  test("a label that would run off the end goes before its glyph", () => {
    const laid = layout(plan([{ type: "task", id: "T", label: "Close", items: [{ type: "milestone", date: "2027-12-30", label: "Final acceptance review" }] }]));
    const item = itemAt(laid, 0, 0);
    assert.ok(item.label!.x + item.label!.width <= item.glyph.x);
    assert.ok(item.label!.x >= 0);
  });
});

describe("ItemKindsAreDistinguishable", () => {
  test("DifferentMilestoneKindsLookDifferent and TheSameKindLooksTheSameEverywhere", () => {
    const data = programme();
    data.rows.push({ type: "task", id: "T9", label: "Second system", items: [{ type: "milestone", date: "2027-06-01", kind: "PDR" }] });
    const laid = layout(data);
    assert.deepEqual(laid.kinds, ["SRR", "PDR", "CDR"]);
    const tints = assignTints(laid.kinds);
    const look = (kind: string) => JSON.stringify(tints.get(kind));
    assert.equal(new Set(laid.kinds.map(look)).size, 3);
    const pdrs = laid.items.filter((item) => item.kind === "PDR");
    assert.equal(pdrs.length, 2);
    assert.equal(look(pdrs[0].kind!), look(pdrs[1].kind!));
  });
});

describe("TheCurrentDateIsShownFromTheRenderingContext", () => {
  test("TodayInsideTheRange", () => {
    const laid = layout(programme(), "2027-01-15");
    assert.ok("x" in laid.today);
    assert.equal(laid.today.x, (day("2027-01-15") - day("2026-10-01") + 0.5) * TIMELINE_PX_PER_DAY);
  });

  test("TheSameDocumentShowsANewToday", () => {
    const first = layout(programme(), "2027-01-15").today;
    const later = layout(programme(), "2027-06-15").today;
    assert.ok("x" in first && "x" in later);
    assert.ok(later.x > first.x);
  });

  test("TodayBeforeTheRange", () => {
    const data = { ...programme(), time: { start: "2027-01-01", end: "2028-03-31", scale: "month" as const } };
    assert.deepEqual(layout(data, "2026-10-03").today, { outside: "before", day: day("2026-10-03") });
  });

  test("TodayAfterTheRange", () => {
    const data = plan([], { time: { start: "2026-01-01", end: "2026-06-30", scale: "month" } });
    assert.deepEqual(layout(data, "2026-10-03").today, { outside: "after", day: day("2026-10-03") });
  });

  test("today is the reader's calendar day, not UTC's", () => {
    // 23:30 on 31 December in the reader's zone is still 31 December for them.
    const lateEvening = new Date(2026, 11, 31, 23, 30);
    assert.equal(localToday(lateEvening), day("2026-12-31"));
  });
});

describe("DependenciesAreDrawnBetweenTheEndsTheyLink", () => {
  const twoActivities = (bStart: string, type?: "finish-to-start" | "start-to-start") =>
    plan(
      [
        { type: "task", id: "TA", label: "A", items: [{ type: "activity", id: "A", start: "2027-01-01", end: "2027-02-28" }] },
        { type: "task", id: "TB", label: "B", items: [{ type: "activity", id: "B", start: bStart, end: "2027-06-30" }] },
      ],
      { dependencies: [{ from: "A", to: "B", ...(type ? { type } : {}) }] },
    );

  test("AFinishToStartArrow", () => {
    const laid = layout(twoActivities("2027-03-01"));
    const [arrow] = laid.dependencies;
    const a = itemAt(laid, 0, 0).glyph;
    const b = itemAt(laid, 1, 0).glyph;
    assert.equal(arrow.type, "finish-to-start");
    assert.equal(arrow.satisfied, true);
    assert.deepEqual(arrow.points[0], { x: a.x + a.width, y: a.y + a.height / 2 });
    assert.deepEqual(arrow.points.at(-1), { x: b.x, y: b.y + b.height / 2 });
    // Orthogonal: every segment is horizontal or vertical.
    for (let index = 1; index < arrow.points.length; index++) {
      const [p, q] = [arrow.points[index - 1], arrow.points[index]];
      assert.ok(p.x === q.x || p.y === q.y, `segment ${index} is diagonal`);
    }
  });

  test("AStartToStartArrow", () => {
    const laid = layout(twoActivities("2027-02-01", "start-to-start"));
    const [arrow] = laid.dependencies;
    const a = itemAt(laid, 0, 0).glyph;
    const b = itemAt(laid, 1, 0).glyph;
    assert.equal(arrow.points[0].x, a.x);
    assert.equal(arrow.points.at(-1)!.x, b.x);
    // It leaves A's start going left, away from the bar.
    assert.ok(arrow.points[1].x < a.x);
  });

  test("AnUnsatisfiedDependencyIsShownNotRefused", () => {
    const laid = layout(twoActivities("2027-02-15"));
    assert.equal(laid.dependencies.length, 1);
    assert.equal(laid.dependencies[0].satisfied, false);
  });

  test("SameDayCountsAsSatisfied", () => {
    const data = plan(
      [
        { type: "task", id: "TM", label: "Review", items: [{ type: "milestone", id: "M", date: "2027-03-01" }] },
        { type: "task", id: "TB", label: "B", items: [{ type: "activity", id: "B", start: "2027-03-01", end: "2027-06-30" }] },
      ],
      { dependencies: [{ from: "M", to: "B" }] },
    );
    assert.equal(layout(data).dependencies[0].satisfied, true);
  });

  test("neighbours on one lane are joined by a straight line", () => {
    const laid = layout(
      plan(
        [
          {
            type: "task",
            id: "T",
            label: "Study",
            items: [
              { type: "activity", id: "study", start: "2027-01-01", end: "2027-02-28", label: "Study" },
              { type: "milestone", id: "srr", date: "2027-03-01", kind: "SRR" },
            ],
          },
        ],
        { dependencies: [{ from: "study", to: "srr" }] },
      ),
    );
    assert.equal(itemAt(laid, 0, 0).lane, itemAt(laid, 0, 1).lane);
    const toSrr = laid.dependencies.find((arrow) => arrow.to === "srr")!;
    assert.equal(toSrr.points.length, 2);
    assert.equal(toSrr.points[0].y, toSrr.points[1].y);
    // The star sits on the day after the bar ends, overlapping its end by a few pixels.
    assert.ok(Math.abs(toSrr.points[1].x - toSrr.points[0].x) <= 14);
  });

  test("a task endpoint attaches at the task's span", () => {
    const laid = layout(programme());
    const toTask = laid.dependencies.find((arrow) => arrow.to === "T2")!;
    const devStart = itemAt(laid, 2, 0).glyph.x;
    assert.equal(toTask.points.at(-1)!.x, devStart);
  });
});

describe("TheReaderMayCompactSections", () => {
  /** Two tasks ahead of any section, then two sections of two tasks each. */
  const sectioned = (): StructuredTimelineData =>
    plan(
      [
        { type: "task", id: "K", label: "Kick-off", items: [{ type: "milestone", id: "ko", date: "2027-01-04", kind: "KO" }] },
        { type: "separator", label: "System A" },
        {
          type: "task",
          id: "A1",
          label: "Requirements",
          items: [
            { type: "activity", id: "a1", start: "2027-01-01", end: "2027-03-31", label: "Requirements study" },
            { type: "milestone", id: "srr", date: "2027-04-01", kind: "SRR", label: "System Requirements Review" },
          ],
        },
        {
          type: "task",
          id: "A2",
          label: "Design",
          items: [
            { type: "activity", id: "a2", start: "2027-03-01", end: "2027-06-30" },
            { type: "milestone", id: "pdr", date: "2027-04-03", kind: "PDR", label: "Preliminary Design Review" },
          ],
        },
        { type: "separator", label: "System B" },
        { type: "task", id: "B1", label: "Build", items: [{ type: "activity", id: "b1", start: "2027-05-01", end: "2027-09-30", label: "Build" }] },
        { type: "task", id: "B2", label: "Test", items: [{ type: "activity", id: "b2", start: "2027-10-01", end: "2027-12-15", label: "Test" }] },
      ],
      { dependencies: [{ from: "srr", to: "a2", type: "start-to-start" }, { from: "b1", to: "b2" }, { from: "ko", to: "A1" }] },
    );

  test("CompactingDrawsOneRowPerSection", () => {
    const laid = layoutTimeline(sectioned(), day("2027-06-01"), { compact: true });
    assert.deepEqual(
      laid.rows.map((row) => `${row.type}:${"label" in row ? (row.label ?? "") : ""}`),
      ["task:Kick-off", "section:System A", "section:System B"],
    );
    const systemA = laid.rows[1];
    assert.ok(systemA.type === "section");
    assert.deepEqual(systemA.tasks, ["A1", "A2"]);
    // Every item of both tasks is drawn inside the section's row.
    const inA = laid.items.filter((item) => item.row === 2 || item.row === 3);
    assert.equal(inA.length, 4);
    for (const item of inA) {
      assert.ok(item.glyph.y >= systemA.y && item.glyph.y + item.glyph.height <= systemA.y + systemA.height);
    }
    // The same overlap rule as a task row.
    for (const mine of inA) {
      if (mine.label === undefined) continue;
      for (const theirs of inA) {
        if (theirs === mine) continue;
        assert.ok(!intersects(mine.label, theirs.glyph), `"${mine.label.text}" overlaps item ${theirs.row}:${theirs.item}`);
        if (theirs.label) assert.ok(!intersects(mine.label, theirs.label), `"${mine.label.text}" overlaps "${theirs.label.text}"`);
      }
    }
    // System B's two tasks do not overlap in time, so they share one lane.
    assert.ok(laid.rows[2].type === "section" && laid.rows[2].lanes === 1);
  });

  test("CompactingChangesOnlyTheDrawing (geometry half)", () => {
    const expanded = layoutTimeline(sectioned(), day("2027-06-01"));
    const compacted = layoutTimeline(sectioned(), day("2027-06-01"), { compact: true });
    // The same dependencies, between the same ends, with the same verdicts.
    const ends = (laid: TimelineLayout) => laid.dependencies.map((arrow) => `${arrow.from}>${arrow.to}:${arrow.type}:${arrow.satisfied}`);
    assert.deepEqual(ends(compacted), ends(expanded));
    // Items keep their task (row) and their horizontal place; only heights change.
    const where = (laid: TimelineLayout) => laid.items.map((item) => `${item.row}:${item.item}@${item.glyph.x}`).sort();
    assert.deepEqual(where(compacted), where(expanded));
    assert.ok(compacted.height < expanded.height);
    // A task endpoint folded into a section still anchors at its span: KO → A1 ends at A1's start.
    const toA1 = compacted.dependencies.find((arrow) => arrow.to === "A1")!;
    assert.equal(toA1.points.at(-1)!.x, (day("2027-01-01") - day("2027-01-01")) * TIMELINE_PX_PER_DAY);
  });

  test("AnUnlabelledActivityIsNamedByItsTaskWhenCompacted", () => {
    const compacted = layoutTimeline(sectioned(), day("2027-06-01"), { compact: true });
    const a2 = compacted.items.find((item) => item.row === 3 && item.item === 0)!;
    assert.equal(a2.label?.text, "Design");
    // Only there: expanded, its own row names it and it carries no text.
    const expanded = layoutTimeline(sectioned(), day("2027-06-01"));
    assert.equal(expanded.items.find((item) => item.row === 3 && item.item === 0)!.label, undefined);
  });

  test("TasksBeforeTheFirstSeparatorKeepTheirRows", () => {
    const compacted = layoutTimeline(sectioned(), day("2027-06-01"), { compact: true });
    assert.deepEqual(compacted.rows[0], { ...compacted.rows[0], type: "task", id: "K", row: 0 });
  });

  test("an empty section stays a plain separator", () => {
    const data = sectioned();
    data.rows.push({ type: "separator", label: "Later" });
    const compacted = layoutTimeline(data, day("2027-06-01"), { compact: true });
    assert.equal(compacted.rows.at(-1)!.type, "separator");
  });
});
