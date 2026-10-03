/**
 * A timeline as a figure: what a file holds, how it is dated, and how it fits a page.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";
import { serializeFigure, type FigureGroup } from "@pi-outpost/shared/structured-exchange/figure";
import { dayNumber, layoutTimeline, monthLabelFor, TIMELINE_PX_PER_DAY } from "@pi-outpost/shared/structured-exchange/timeline";
import { timelineFigure, timelineFigureParts, writtenDate } from "@pi-outpost/shared/structured-exchange/timeline-figure";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const programme = (): StructuredTimelineData =>
  JSON.parse(readFileSync(path.resolve(HERE, "../../shared/conformance/valid/v3-timeline-programme.json"), "utf8")).data;
const day = (date: string) => dayNumber(date)!;

/** Every box a figure's groups draw for text and glyphs, in figure coordinates. */
function boxes(groups: FigureGroup[]) {
  const labels: { text: string; x: number; y: number; width: number; height: number; group: string }[] = [];
  const glyphs: { x: number; y: number; width: number; height: number; group: string }[] = [];
  for (const group of groups) {
    for (const primitive of group.primitives) {
      if (primitive.shape === "text" && primitive.testId === "timeline-annotation") {
        labels.push({ text: primitive.text, x: primitive.x, y: primitive.y - 12, width: primitive.text.length * 6.6, height: 16, group: group.id });
      }
      if (primitive.shape === "rect" && group.testId?.startsWith("timeline-a")) {
        glyphs.push({ x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height, group: group.id });
      }
    }
  }
  return { labels, glyphs };
}
const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("the layout takes a scale", () => {
  test("the reader's scale is unchanged by default", () => {
    const laid = layoutTimeline(programme(), day("2027-01-15"));
    assert.equal(laid.width, (day("2028-03-31") - day("2026-10-01") + 1) * TIMELINE_PX_PER_DAY);
  });

  test("ProportionsSurviveScaling", () => {
    const data: StructuredTimelineData = {
      time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
      rows: [
        {
          type: "task",
          id: "T",
          label: "Work",
          items: [
            { type: "activity", start: "2027-01-01", end: "2027-03-31" },
            { type: "activity", start: "2027-04-01", end: "2027-09-27" },
          ],
        },
      ],
    };
    const parts = timelineFigureParts(data, { today: day("2027-06-01"), width: 600 });
    const [short, long] = parts.layout.items.map((item) => item.glyph.width);
    assert.ok(parts.pxPerDay < TIMELINE_PX_PER_DAY);
    assert.ok(Math.abs(long / short - 2) < 1e-9, `${long / short}`);
  });

  test("a month label is shortened, then omitted, as its band narrows", () => {
    assert.equal(monthLabelFor({ label: "Mar", x: 0, width: 30 }), "Mar");
    assert.equal(monthLabelFor({ label: "Mar", x: 0, width: 12 }), "M");
    assert.equal(monthLabelFor({ label: "Mar", x: 0, width: 5 }), "");
  });
});

describe("ATimelineFigureIsTheReadersPicture", () => {
  test("AFigureHoldsEverythingTheReaderShows", () => {
    const svg = serializeFigure(timelineFigure(programme(), { today: day("2027-01-15") }));
    assert.ok(svg.startsWith("<svg "));
    for (const text of ["Programme X", "Système A", "Système B", "Études système", "Développement", "Recette", "Étude préliminaire", "System Requirements Review", "2026", "2027", "2028"]) {
      assert.ok(svg.includes(text), `missing ${text}`);
    }
    assert.equal(svg.match(/data-testid="timeline-dependency"/g)?.length, 4);
    assert.equal(svg.match(/data-testid="timeline-milestone"/g)?.length, 3);
    assert.equal(svg.match(/data-testid="timeline-activity"/g)?.length, 4);
    // The key, and the arrowheads it needs to stand on its own.
    for (const kind of ["SRR", "PDR", "CDR"]) assert.match(svg, new RegExp(`data-kind="${kind}"`));
    assert.match(svg, /<marker /);
  });

  test("AFigureUsesProjectColours", () => {
    const svg = serializeFigure(
      timelineFigure(programme(), { today: day("2027-01-15"), appearance: { kinds: { SRR: { color: "#dc2626" } } } }),
    );
    assert.match(svg, /fill="#dc2626"/);
    assert.match(svg, /data-colour-source="project"/);
  });

  test("the figure carries no selection, whatever the parts were asked for", () => {
    const svg = serializeFigure(timelineFigure(programme(), { today: day("2027-01-15"), selection: { row: 1, item: 1 } }));
    assert.doesNotMatch(svg, /data-selected="true"/);
    assert.doesNotMatch(svg, /data-emphasised="true"/);
  });
});

describe("AWrittenFigureDatesItsReferenceLine", () => {
  test("AWrittenFigureNamesItsDate", () => {
    const svg = serializeFigure(timelineFigure(programme(), { today: day("2026-10-03"), referenceLine: "dated" }));
    assert.equal(writtenDate(day("2026-10-03")), "3 Oct 2026");
    assert.match(svg, />3 Oct 2026</);
    assert.doesNotMatch(svg, /Today/);
  });

  test("outside the range, the date and the side are said in the header", () => {
    const svg = serializeFigure(timelineFigure(programme(), { today: day("2026-09-01"), referenceLine: "dated" }));
    assert.match(svg, /1 Sep 2026 is before this range/);
    assert.doesNotMatch(svg, /data-testid="timeline-today"/);
  });

  test("TheReferenceLineCanBeOmitted", () => {
    const inside = serializeFigure(timelineFigure(programme(), { today: day("2027-01-15"), referenceLine: "none" }));
    const outside = serializeFigure(timelineFigure(programme(), { today: day("2030-01-01"), referenceLine: "none" }));
    for (const svg of [inside, outside]) {
      assert.doesNotMatch(svg, /timeline-today/);
      assert.doesNotMatch(svg, /this range/);
    }
  });
});

describe("AFigureFitsAWidth", () => {
  test("ALongPlanFitsAPage", () => {
    const figure = timelineFigure(programme(), { today: day("2027-01-15"), width: 900 });
    assert.ok(figure.width <= 900, `${figure.width}`);
    assert.equal(figure.overWidth, false);
    const svg = serializeFigure(figure);
    for (const year of ["2026", "2027", "2028"]) assert.ok(svg.includes(`>${year}<`), `year ${year} unlabelled`);
    // No annotation overlaps another, or another item's glyph.
    const { labels, glyphs } = boxes(timelineFigureParts(programme(), { today: day("2027-01-15"), width: 900 }).rows);
    for (const mine of labels) {
      for (const theirs of labels) if (theirs !== mine) assert.ok(!intersects(mine, theirs), `"${mine.text}" overlaps "${theirs.text}"`);
      for (const glyph of glyphs) if (glyph.group !== mine.group) assert.ok(!intersects(mine, glyph), `"${mine.text}" overlaps ${glyph.group}`);
    }
  });

  test("a label with room on neither side stays inside the figure", () => {
    const data: StructuredTimelineData = {
      time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
      rows: [
        {
          type: "task",
          id: "T",
          label: "Work",
          items: [{ type: "activity", start: "2027-03-01", end: "2027-09-30", label: "A label too long to sit beside this bar on either side" }],
        },
      ],
    };
    const parts = timelineFigureParts(data, { today: day("2027-01-15"), width: 600 });
    const label = parts.layout.items[0].label!;
    assert.equal(label.inside, false);
    assert.ok(label.x >= 0 && label.x + label.width <= parts.layout.width, `${label.x}+${label.width} > ${parts.layout.width}`);
  });

  test("a plan too long for the width is drawn at the floor scale and says so", () => {
    const decade = { ...programme(), time: { start: "2020-01-01", end: "2039-12-31", scale: "month" as const } };
    const figure = timelineFigure(decade, { today: day("2027-01-15"), width: 400 });
    assert.equal(figure.overWidth, true);
    assert.ok(figure.width > 400);
  });
});
