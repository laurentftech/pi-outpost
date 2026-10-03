/**
 * Scales: the density time is drawn at, and the header unit that density leaves room
 * to label — weeks, months or quarters — in the layout and in the figure.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StructuredTimelineData, StructuredTimelineScale } from "@pi-outpost/shared/structured-exchange";
import { serializeFigure } from "@pi-outpost/shared/structured-exchange/figure";
import {
  dayNumber,
  isoWeek,
  layoutTimeline,
  timelineOpeningScroll,
  TIMELINE_SCALE_PX_PER_DAY,
  timelineHeaderUnit,
} from "@pi-outpost/shared/structured-exchange/timeline";
import { timelineFigure, timelineFigureParts } from "@pi-outpost/shared/structured-exchange/timeline-figure";

const day = (date: string) => dayNumber(date)!;
const plan = (start: string, end: string, scale: StructuredTimelineScale = "month"): StructuredTimelineData => ({
  time: { start, end, scale },
  rows: [
    {
      type: "task",
      id: "T",
      label: "Work",
      items: [
        { type: "activity", id: "a", start: "2027-03-08", end: "2027-03-21" }, // 14 days
        { type: "activity", id: "b", start: "2027-03-22", end: "2027-04-18" }, // 28 days
      ],
    },
  ],
});
const glyph = (laid: ReturnType<typeof layoutTimeline>, id: "a" | "b") => laid.items.find((item) => item.row === 0 && item.item === (id === "a" ? 0 : 1))!.glyph;
const textsOf = (parts: ReturnType<typeof timelineFigureParts>, testId: string) =>
  parts.header.flatMap((group) => group.primitives).filter((primitive) => primitive.testId === testId && primitive.shape === "text").map((primitive) => (primitive as { text: string }).text);

describe("ScalesSetTheDensity", () => {
  test("a timeline is laid out at its declared scale's density", () => {
    for (const scale of ["week", "month", "quarter"] as const) {
      const laid = layoutTimeline(plan("2027-03-01", "2027-04-30", scale), day("2027-03-15"));
      assert.equal(laid.width, 61 * TIMELINE_SCALE_PX_PER_DAY[scale], scale);
    }
  });

  test("AQuarterIsNarrowerThanAMonth, and proportions hold at every scale", () => {
    const at = (scale: StructuredTimelineScale) => layoutTimeline(plan("2027-01-01", "2027-12-31", scale), day("2027-03-15"));
    const ratio = TIMELINE_SCALE_PX_PER_DAY.quarter / TIMELINE_SCALE_PX_PER_DAY.month;
    assert.equal(glyph(at("quarter"), "a").width, glyph(at("month"), "a").width * ratio);
    for (const scale of ["week", "month", "quarter"] as const) {
      assert.equal(glyph(at(scale), "b").width, 2 * glyph(at(scale), "a").width, scale);
    }
  });
});

describe("TheHeaderFollowsTheDensity", () => {
  test("the unit is the finest the density can label", () => {
    assert.equal(timelineHeaderUnit(TIMELINE_SCALE_PX_PER_DAY.week), "week");
    assert.equal(timelineHeaderUnit(TIMELINE_SCALE_PX_PER_DAY.month), "month");
    assert.equal(timelineHeaderUnit(TIMELINE_SCALE_PX_PER_DAY.quarter), "quarter");
  });

  test("ISO weeks: week 1 holds the year's first Thursday", () => {
    assert.equal(isoWeek(day("2027-01-01")), 53); // a Friday: still 2026's last week
    assert.equal(isoWeek(day("2027-01-04")), 1);
    assert.equal(isoWeek(day("2027-03-01")), 9);
    assert.equal(isoWeek(day("2026-12-31")), 53);
    assert.equal(isoWeek(day("2025-12-29")), 1); // a Monday in 2025, in 2026's first week
  });

  test("WeeksAreNumbered", () => {
    const laid = layoutTimeline(plan("2027-03-01", "2027-04-30", "week"), day("2027-03-15"));
    assert.equal(laid.unit, "week");
    assert.deepEqual(laid.upper.map((band) => band.label), ["Mar 2027", "Apr 2027"]);
    assert.deepEqual(laid.lower.map((band) => band.label), ["W9", "W10", "W11", "W12", "W13", "W14", "W15", "W16", "W17"]);
    // A line at each Monday inside the range; the first Monday is the range's edge.
    const mondays = ["2027-03-08", "2027-03-15", "2027-03-22", "2027-03-29", "2027-04-05", "2027-04-12", "2027-04-19", "2027-04-26"];
    assert.deepEqual(laid.unitLines, mondays.map((date) => (day(date) - day("2027-03-01")) * TIMELINE_SCALE_PX_PER_DAY.week));
    // The last week is cut by the range's end: five days wide.
    assert.equal(laid.lower.at(-1)!.width, 5 * TIMELINE_SCALE_PX_PER_DAY.week);
  });

  test("QuartersAreLabelled", () => {
    const laid = layoutTimeline(plan("2026-01-01", "2028-12-31", "quarter"), day("2027-03-15"));
    assert.equal(laid.unit, "quarter");
    assert.deepEqual(laid.upper.map((band) => band.label), ["2026", "2027", "2028"]);
    assert.deepEqual(laid.lower.map((band) => band.label), ["Q1", "Q2", "Q3", "Q4", "Q1", "Q2", "Q3", "Q4", "Q1", "Q2", "Q3", "Q4"]);
    const px = TIMELINE_SCALE_PX_PER_DAY.quarter;
    assert.deepEqual(laid.unitLines.slice(0, 4), ["2026-04-01", "2026-07-01", "2026-10-01", "2027-01-01"].map((date) => (day(date) - day("2026-01-01")) * px));
  });

  test("a range starting mid-quarter labels that quarter first", () => {
    const laid = layoutTimeline(plan("2026-11-15", "2027-12-31", "quarter"), day("2027-03-15"));
    assert.deepEqual(laid.lower.slice(0, 2).map((band) => band.label), ["Q4", "Q1"]);
  });

  test("the month unit is unchanged", () => {
    const laid = layoutTimeline(plan("2027-01-01", "2027-12-31"), day("2027-03-15"));
    assert.equal(laid.unit, "month");
    assert.deepEqual(laid.upper, laid.years);
    assert.deepEqual(laid.lower, laid.months);
    assert.deepEqual(laid.unitLines, laid.monthLines);
  });

  test("a chosen unit is never made finer by a stretched density", () => {
    const data = plan("2026-01-01", "2027-06-30", "quarter");
    // Stretched to 1.6 px a day, room enough for months: the chosen quarters stay.
    const laid = layoutTimeline(data, day("2027-03-15"), { pxPerDay: 1.6, unit: "quarter" });
    assert.equal(laid.unit, "quarter");
    assert.equal(laid.lower[0].label, "Q1");
    // A coarser density still wins: weeks asked at a quarter's density are not drawn.
    assert.equal(layoutTimeline(data, day("2027-03-15"), { pxPerDay: 0.5, unit: "week" }).unit, "quarter");
    assert.equal(timelineHeaderUnit(12, "month"), "month");
  });

  test("a scale asked with a width sets the coarsest the header may be finer than", () => {
    const short = plan("2027-03-01", "2027-04-30");
    // Fitted into 900 px a two-month plan has room for weeks; asked by month, it stays by month.
    assert.equal(timelineFigureParts(short, { today: day("2027-03-15"), width: 900 }).layout.unit, "week");
    assert.equal(timelineFigureParts(short, { today: day("2027-03-15"), width: 900, scale: "month" }).layout.unit, "month");
  });

  test("TheHeaderFollowsAFittedDensity", () => {
    const parts = timelineFigureParts(plan("2026-01-01", "2028-12-31", "week"), { today: day("2027-03-15"), width: 900 });
    assert.notEqual(parts.layout.unit, "week");
    assert.ok(parts.pxPerDay < TIMELINE_SCALE_PX_PER_DAY.week);
    const years = textsOf(parts, "timeline-upper");
    assert.deepEqual(years, ["2026", "2027", "2028"]);
    assert.ok(!textsOf(parts, "timeline-unit").some((text) => /^W\d/.test(text)), "weeks labelled at a fitted density");
  });
});

describe("AFigureFitsAWidth", () => {
  test("AFigureAtTheQuarterScale", () => {
    const data = plan("2026-01-01", "2028-12-31");
    const today = day("2027-03-15");
    const parts = timelineFigureParts(data, { today, scale: "quarter" });
    assert.equal(parts.pxPerDay, TIMELINE_SCALE_PX_PER_DAY.quarter);
    assert.equal(parts.layout.unit, "quarter");
    assert.ok(textsOf(parts, "timeline-unit").includes("Q3"));
    // The same picture the reader draws for that timeline at the quarter scale.
    const declared = timelineFigureParts({ ...data, time: { ...data.time, scale: "quarter" } }, { today });
    assert.deepEqual(parts.rows, declared.rows);
    assert.deepEqual(parts.header, declared.header);
  });

  test("without a scale or width the figure uses the declared scale", () => {
    const parts = timelineFigureParts(plan("2027-03-01", "2027-04-30", "week"), { today: day("2027-03-15") });
    assert.equal(parts.pxPerDay, TIMELINE_SCALE_PX_PER_DAY.week);
    assert.ok(textsOf(parts, "timeline-unit").includes("W12"));
  });

  test("a width wins over a scale", () => {
    const parts = timelineFigureParts(plan("2026-01-01", "2028-12-31"), { today: day("2027-03-15"), scale: "week", width: 900 });
    assert.ok(parts.pxPerDay < 1);
    const svg = serializeFigure(timelineFigure(plan("2026-01-01", "2028-12-31"), { today: day("2027-03-15"), scale: "week", width: 900 }));
    assert.ok(Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)![1]) <= 900);
  });
});

describe("TheViewOpensOnWhatItIsAbout", () => {
  const programme = (): StructuredTimelineData => ({
    time: { start: "2026-01-01", end: "2027-12-31", scale: "month" },
    rows: [
      {
        type: "task",
        id: "T",
        label: "Work",
        items: [
          { type: "activity", id: "early", start: "2026-02-01", end: "2026-03-31" },
          { type: "activity", id: "late", start: "2027-03-01", end: "2027-05-31" },
        ],
      },
    ],
  });
  const compared = (): StructuredTimelineData => {
    const data = programme();
    data.comparedTo = { label: "Plan of March" };
    const task = data.rows[0] as Extract<StructuredTimelineData["rows"][number], { type: "task" }>;
    task.items[1] = { ...task.items[1], previous: { start: "2027-02-01", end: "2027-04-30" } } as never;
    return data;
  };
  const x = (date: string) => (day(date) - day("2026-01-01")) * TIMELINE_SCALE_PX_PER_DAY.month;

  test("AComparisonOpensOnItsFirstChange", () => {
    // Today is at the start; the only change, a shift, lies a year later.
    const laid = layoutTimeline(compared(), day("2026-01-10"));
    const scroll = timelineOpeningScroll(laid, 600)!;
    assert.ok(scroll > 0);
    // The earlier of its two positions, the previous one, is in view, with a lead-in.
    assert.ok(x("2027-02-01") >= scroll && x("2027-02-01") < scroll + 600);
    assert.equal(scroll, x("2027-02-01") - 100);
  });

  test("an addition or a removal counts as a change", () => {
    const data = programme();
    data.comparedTo = { label: "Plan of March" };
    const task = data.rows[0] as Extract<StructuredTimelineData["rows"][number], { type: "task" }>;
    task.items.push({ type: "milestone", id: "gone", date: "2027-08-01", role: "removed" } as never);
    const scroll = timelineOpeningScroll(layoutTimeline(data, day("2026-01-10")), 600)!;
    assert.ok(x("2027-08-01") >= scroll && x("2027-08-01") < scroll + 600);
  });

  test("APlainPlanOpensOnToday", () => {
    const laid = layoutTimeline(programme(), day("2027-06-01"));
    const scroll = timelineOpeningScroll(laid, 600)!;
    const today = (laid.today as { x: number }).x;
    assert.ok(today >= scroll && today < scroll + 600);
  });

  test("a comparison with its changes already in view, or a plan that fits, stays at its start", () => {
    const data = compared();
    const task = data.rows[0] as Extract<StructuredTimelineData["rows"][number], { type: "task" }>;
    task.items[1] = { type: "activity", id: "late", start: "2027-03-01", end: "2027-05-31" };
    task.items[0] = { ...task.items[0], previous: { start: "2026-01-15", end: "2026-03-15" } } as never;
    assert.equal(timelineOpeningScroll(layoutTimeline(data, day("2027-06-01")), 600), undefined);
    assert.equal(timelineOpeningScroll(layoutTimeline(programme(), day("2027-06-01")), 10_000), undefined);
  });
});
