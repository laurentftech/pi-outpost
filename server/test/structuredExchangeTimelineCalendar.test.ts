/**
 * The calendar a plan runs in: periods as bands across every row, reference dates
 * as named lines — laid out, drawn, named, and carried wherever a timeline goes.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";
import { serializeFigure } from "@pi-outpost/shared/structured-exchange/figure";
import { dayNumber, layoutTimeline, timelineFacts, timelineTextLines, TIMELINE_PX_PER_DAY } from "@pi-outpost/shared/structured-exchange/timeline";
import { timelineFigure, timelineFigureParts } from "@pi-outpost/shared/structured-exchange/timeline-figure";
import { compareTimelines } from "@pi-outpost/shared/structured-exchange/timeline-comparison";

const day = (date: string) => dayNumber(date)!;
const today = day("2027-01-20");
const plan = (): StructuredTimelineData => ({
  title: "Programme X",
  time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
  rows: [
    { type: "separator", label: "System A" },
    { type: "task", id: "T1", label: "Study", items: [{ type: "activity", id: "s", start: "2027-01-10", end: "2027-06-30", label: "Study" }] },
    { type: "task", id: "T2", label: "Build", items: [{ type: "milestone", id: "m", date: "2027-09-01", kind: "SRR" }] },
  ],
  periods: [
    { start: "2026-12-21", end: "2027-01-03", label: "Year-end closure", kind: "closure" },
    { start: "2027-08-02", end: "2027-08-22", label: "Summer holidays", kind: "holidays" },
    { start: "2027-04-12", end: "2027-04-18", label: "Inventory" },
  ],
  references: [{ date: "2027-06-30", label: "Contractual delivery", kind: "contract" }],
});
const x = (date: string) => (day(date) - day("2027-01-01")) * TIMELINE_PX_PER_DAY;

describe("PeriodsAreDrawnAcrossEveryRow", () => {
  test("AClosureIsABandAcrossTheRows", () => {
    const laid = layoutTimeline(plan(), today);
    const holidays = laid.periods.find((period) => period.index === 1)!;
    assert.equal(holidays.x, x("2027-08-02"));
    assert.equal(holidays.width, 21 * TIMELINE_PX_PER_DAY);
    const parts = timelineFigureParts(plan(), { today });
    const band = parts.rows.find((group) => group.id === "period-1")!;
    const rect = band.primitives[0] as { y: number; height: number };
    assert.equal(rect.y, 0);
    assert.equal(rect.height, laid.height);
    // Under the work: every period group comes before every item and arrow.
    const order = parts.rows.map((group) => group.testId ?? "");
    const lastBand = order.lastIndexOf("timeline-period");
    for (const later of ["timeline-activity", "timeline-milestone", "timeline-dependency"]) {
      const first = order.indexOf(later);
      if (first !== -1) assert.ok(lastBand < first, `${later} drawn under a band`);
    }
    assert.match(band.title!, /Summer holidays: 2 Aug 2027 – 22 Aug 2027/);
  });

  test("AClippedPeriodIsDrawnInsideTheRange", () => {
    const closure = layoutTimeline(plan(), today).periods.find((period) => period.index === 0)!;
    assert.equal(closure.x, 0);
    assert.equal(closure.width, 3 * TIMELINE_PX_PER_DAY);
  });

  test("PeriodKindsLookDifferent, with project colours", () => {
    const svg = serializeFigure(timelineFigure(plan(), { today, appearance: { kinds: { holidays: { color: "#0ea5e9" } } } }));
    const fill = (index: number) => new RegExp(`data-testid="timeline-period"><title>[^<]*</title><rect [^>]*fill="([^"]+)"`, "g");
    const fills = [...svg.matchAll(fill(0))].map((match) => match[1]);
    assert.equal(fills.length, 3);
    assert.equal(fills[1], "#0ea5e9");
    assert.notEqual(fills[0], fills[1]);
  });

  test("AnUnkindedPeriodIsNeutral", () => {
    const parts = timelineFigureParts(plan(), { today });
    const inventory = parts.rows.find((group) => group.id === "period-2")!;
    assert.equal((inventory.primitives[0] as { fill: string }).fill, "#a1a1aa");
    assert.ok(inventory.primitives.filter((primitive) => primitive.shape === "line").length > 3, "no hatch");
    const kinded = parts.rows.find((group) => group.id === "period-1")!;
    assert.equal(kinded.primitives.filter((primitive) => primitive.shape === "line").length, 0);
  });

  test("the legend names every period and reference, and leaves their dates to the axis and hover", () => {
    const parts = timelineFigureParts(plan(), { today });
    const legend = parts.legend.groups.filter((group) => group.testId === "timeline-calendar-legend").flatMap((group) => group.primitives);
    const texts = legend.filter((primitive) => primitive.shape === "text").map((primitive) => (primitive as { text: string }).text);
    assert.deepEqual(texts, ["Year-end closure", "Summer holidays", "Inventory", "Contractual delivery"]);
    // Dated where a pointer finds them.
    assert.match(parts.rows.find((group) => group.id === "period-0")!.title!, /Year-end closure: 21 Dec 2026 – 3 Jan 2027/);
    assert.match(parts.rows.find((group) => group.testId === "timeline-reference")!.title!, /Contractual delivery: 30 Jun 2027/);
    const svg = serializeFigure(timelineFigure(plan(), { today }));
    // Kinds only periods or references carry are not listed among item kinds.
    assert.doesNotMatch(svg, /data-kind="closure"><path/);
  });

  test("header names never overlap one another or the Today tag", () => {
    const crowded = plan();
    crowded.periods!.push({ start: "2027-01-15", end: "2027-03-31", label: "A long period whose name fits its band" });
    crowded.references!.push({ date: "2027-02-01", label: "Close to today" });
    const laid = layoutTimeline(crowded, today);
    const spans = laid.headerLabels.map((label) => [label.x, label.x + label.width]);
    const todayX = (day("2027-01-20") - day("2027-01-01") + 0.5) * TIMELINE_PX_PER_DAY;
    for (const [a0, a1] of spans) {
      assert.ok(a1 <= todayX - 22 || a0 >= todayX + 22, "a name sits under the Today tag");
      for (const [b0, b1] of spans) if (a0 !== b0) assert.ok(a1 <= b0 || b1 <= a0, "two names overlap");
    }
  });
});

describe("ReferenceDatesAreNamedLines", () => {
  test("AContractDateIsANamedLine", () => {
    const laid = layoutTimeline(plan(), today);
    assert.equal(laid.references[0].x, x("2027-06-30") + TIMELINE_PX_PER_DAY / 2);
    const name = laid.headerLabels.find((label) => label.of === "reference")!;
    assert.equal(name.text, "Contractual delivery");
    // Centred over its line, not beside it.
    assert.ok(Math.abs(name.x + name.width / 2 - laid.references[0].x) < 0.01, `${name.x} + ${name.width}/2 ≠ ${laid.references[0].x}`);
    const parts = timelineFigureParts(plan(), { today });
    const line = parts.rows.find((group) => group.testId === "timeline-reference")!.primitives[0] as { strokeDasharray?: string; y2: number; stroke: string };
    assert.equal(line.strokeDasharray, "6 3");
    assert.equal(line.y2, laid.height);
    const todayLine = parts.rows.find((group) => group.testId === "timeline-today")!.primitives[0] as { strokeDasharray?: string; stroke: string };
    assert.equal(todayLine.strokeDasharray, undefined);
    assert.notEqual(todayLine.stroke, line.stroke);
  });
});

test("a reference's name near an edge is pulled inside the drawing", () => {
  const data = plan();
  data.references = [{ date: "2027-12-30", label: "Contractual delivery" }];
  const laid = layoutTimeline(data, today);
  const name = laid.headerLabels.find((label) => label.of === "reference")!;
  assert.ok(name.x + name.width <= laid.width);
});

describe("PeriodsAndReferencesTravelWithTheTimeline", () => {
  test("TheTextListsPeriodsAndReferences", () => {
    const text = timelineTextLines(plan()).join("\n");
    assert.match(text, /period 2026-12-21 to 2027-01-03: Year-end closure \[closure\]/);
    assert.match(text, /period 2027-04-12 to 2027-04-18: Inventory/);
    assert.match(text, /reference 2027-06-30: Contractual delivery \[contract\]/);
  });

  test("the digest counts them", () => {
    const facts = timelineFacts(plan());
    assert.equal(facts.periods, 3);
    assert.equal(facts.references, 1);
  });

  test("AComparisonCarriesTheCurrentPeriods", () => {
    const previous = { ...plan(), periods: [{ start: "2027-03-01", end: "2027-03-05", label: "Old" }], references: [] };
    const compared = compareTimelines(previous, plan()).data;
    assert.deepEqual(compared.periods, plan().periods);
    assert.deepEqual(compared.references, plan().references);
  });
});
