/**
 * Native tables and charts: the markup PowerPoint reads, in the order its schema
 * demands, and the refusals that keep a slide readable.
 *
 * The element orders asserted here are sequences in ECMA-376 — a child out of place is
 * a file PowerPoint repairs or refuses — so they are asserted as orders, not presence.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  chartFrame,
  chartPartXml,
  chartWorkbook,
  MAX_TABLE_ROWS,
  tableFrame,
  validateChart,
  validateTable,
  type SlideChart,
} from "../src/pptxVisuals.ts";
import { extractXlsx } from "../src/xlsx.ts";

const AREA = { x: 838200, y: 1825625, cx: 10515600, cy: 4351338 };
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

/** Each needle's position in the haystack, asserting they appear in this order. */
function assertOrder(xml: string, needles: string[]): void {
  let at = -1;
  for (const needle of needles) {
    const found = xml.indexOf(needle, at + 1);
    assert.ok(found > at, `"${needle}" comes after the previous element (found at ${found}, previous at ${at})`);
    at = found;
  }
}

describe("tables", () => {
  test("are a native table in the template's default style, with a header row", () => {
    const xml = tableFrame(4, { rows: [["Region", "Revenue"], ["EMEA", "€4.2M"]] }, AREA);
    assert.match(xml, /<a:graphicData uri="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/table"><a:tbl>/);
    assert.match(xml, /<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>\{5C22544A-7EE6-4342-B048-85BDC9FD1C3A\}<\/a:tableStyleId><\/a:tblPr>/);
    assert.match(xml, /<a:graphicFrameLocks noGrp="1"\/>/);
    assertOrder(xml, ["<p:nvGraphicFramePr>", "<p:xfrm>", "<a:graphic>", "<a:tblPr", "<a:tblGrid>", "<a:tr "]);
    // Each cell: text body, then cell properties.
    assertOrder(xml, ["<a:tc><a:txBody>", "</a:txBody><a:tcPr"]);
  });

  test("fill the area's width exactly, and are no taller than it", () => {
    const xml = tableFrame(4, { rows: [["a", "b", "c"], ["1", "2", "3"]] }, AREA);
    const widths = [...xml.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((match) => Number(match[1]));
    assert.equal(widths.length, 3);
    assert.equal(widths.reduce((sum, width) => sum + width, 0), AREA.cx);
    const rows = [...xml.matchAll(/<a:tr h="(\d+)">/g)].map((match) => Number(match[1]));
    const height = Number(/<p:xfrm><a:off [^>]*\/><a:ext cx="\d+" cy="(\d+)"\/>/.exec(xml)![1]);
    assert.equal(height, rows.reduce((sum, row) => sum + row, 0));
    assert.ok(height <= AREA.cy);
    const tall = tableFrame(4, { rows: Array.from({ length: MAX_TABLE_ROWS }, () => ["x"]) }, AREA);
    assert.ok(Number(/<a:ext cx="\d+" cy="(\d+)"\/>/.exec(tall)![1]) <= AREA.cy, "a full table still fits its area");
  });

  test("shrink their text as rows are added, down to a size still read on a screen", () => {
    const size = (rows: number) => Number(/sz="(\d+)"/.exec(tableFrame(4, { rows: Array.from({ length: rows }, () => ["x"]) }, AREA))![1]);
    assert.deepEqual([size(3), size(7), size(10), size(20)], [1800, 1600, 1400, 1200]);
  });

  test("right-align figures so they line up, but not the header or words", () => {
    const xml = tableFrame(4, { rows: [["Name", "Amount"], ["Rent", "1,200"], ["Growth", "-2.5%"], ["Note", "n/a"]] }, AREA);
    const cells = [...xml.matchAll(/<a:p>(<a:pPr algn="r"\/>)?<a:r>[^]*?<a:t>([^<]*)<\/a:t>/g)].map((match) => [match[2], match[1] !== undefined]);
    assert.deepEqual(cells, [
      ["Name", false],
      ["Amount", false],
      ["Rent", false],
      ["1,200", true],
      ["Growth", false],
      ["-2.5%", true],
      ["Note", false],
      ["n/a", false],
    ]);
  });

  test("without a header, no row is styled as one and every figure aligns", () => {
    const xml = tableFrame(4, { rows: [["1", "2"]], header: false }, AREA);
    assert.match(xml, /<a:tblPr bandRow="1">/);
    assert.equal((xml.match(/algn="r"/g) ?? []).length, 2);
  });

  test("escape what they hold", () => {
    assert.match(tableFrame(4, { rows: [["A & B", "<x>"]] }, AREA), /<a:t>A &amp; B<\/a:t>.*<a:t>&lt;x&gt;<\/a:t>/);
  });

  test("refuse what cannot be read on a slide, saying so", () => {
    assert.throws(() => validateTable({ rows: [] }, "slide 2"), /slide 2: the table has no rows/);
    assert.throws(() => validateTable({ rows: Array.from({ length: 21 }, () => ["x"]) }, "slide 2"), /21 rows; at most 20 .* split it across slides/);
    assert.throws(() => validateTable({ rows: [Array.from({ length: 11 }, () => "x")] }, "slide 2"), /11 columns; at most 10/);
    assert.throws(() => validateTable({ rows: [["a", "b"], ["c"]] }, "slide 2"), /table row 2 has 1 cells, the first row has 2/);
    assert.throws(() => validateTable({ rows: [["x".repeat(501)]] }, "slide 2"), /longer than 500 characters/);
  });
});

describe("charts", () => {
  const column: SlideChart = {
    type: "column",
    title: "Revenue (€M)",
    categories: QUARTERS,
    series: [
      { name: "2025", values: [1.8, 2.1, 2.3, 2.6] },
      { name: "2026", values: [2, 2.2, 2.4, 2.4] },
    ],
    showValues: true,
    numberFormat: "0.0",
  };

  test("a column chart: clustered bars, both axes, a legend for two series, the data cached", () => {
    const xml = chartPartXml(column);
    assertOrder(xml, ["<c:date1904", "<c:lang", "<c:roundedCorners", "<c:chart>", "<c:title>", "<c:plotArea>", "</c:plotArea>", "<c:legend>", "<c:plotVisOnly", "<c:dispBlanksAs", "</c:chart>", "<c:txPr>", "<c:externalData"]);
    assertOrder(xml, ['<c:barDir val="col"/>', '<c:grouping val="clustered"/>', '<c:varyColors val="0"/>', "<c:ser>", "<c:dLbls>", "<c:gapWidth", "<c:axId", "</c:barChart>", "<c:catAx>", "<c:valAx>"]);
    // Series children, in the schema's order.
    assertOrder(xml, ['<c:idx val="0"/>', '<c:order val="0"/>', "<c:tx>", "<c:spPr>", '<c:invertIfNegative val="0"/>', "<c:cat>", "<c:val>"]);
    assert.match(xml, /<c:f>Sheet1!\$B\$1<\/c:f><c:strCache><c:ptCount val="1"\/><c:pt idx="0"><c:v>2025<\/c:v>/);
    assert.match(xml, /<c:f>Sheet1!\$C\$2:\$C\$5<\/c:f><c:numCache><c:formatCode>0\.0<\/c:formatCode><c:ptCount val="4"\/><c:pt idx="0"><c:v>2<\/c:v>/);
    assert.match(xml, /<c:f>Sheet1!\$A\$2:\$A\$5<\/c:f>/);
    assert.match(xml, /<c:title><c:tx><c:rich>.*Revenue \(€M\)/);
    assert.match(xml, /<c:externalData r:id="rId1"><c:autoUpdate val="0"\/><\/c:externalData>/);
    assert.doesNotMatch(xml, /<c:overlap/);
  });

  test("takes the theme's accent colours, so the template decides them", () => {
    const xml = chartPartXml(column);
    assert.match(xml, /<c:spPr><a:solidFill><a:schemeClr val="accent1"\/><\/a:solidFill><\/c:spPr>/);
    assert.match(xml, /<a:schemeClr val="accent2"\/>/);
    assert.doesNotMatch(xml, /srgbClr/);
    assert.match(xml, /<a:latin typeface="\+mn-lt"\/>/, "chart text in the theme's body font");
  });

  test("labels values with the number format, and never names a label position", () => {
    const xml = chartPartXml(column);
    assert.match(xml, /<c:dLbls><c:numFmt formatCode="0\.0" sourceLinked="0"\/><c:showLegendKey val="0"\/><c:showVal val="1"\/>/);
    // outEnd is refused by PowerPoint on stacked bars; the default is right for every type.
    assert.doesNotMatch(xml, /dLblPos/);
    assert.doesNotMatch(chartPartXml({ ...column, showValues: false }), /<c:dLbls>/);
  });

  test("a stacked horizontal bar chart overlaps its series and lists categories top to bottom", () => {
    const xml = chartPartXml({ ...column, type: "bar", stacked: true });
    assert.match(xml, /<c:barDir val="bar"\/><c:grouping val="stacked"\/>/);
    assertOrder(xml, ["<c:gapWidth", '<c:overlap val="100"/>', "<c:axId"]);
    assert.match(xml, /<c:catAx>.*<c:orientation val="maxMin"\/>.*<c:axPos val="l"\/>/);
    assert.match(xml, /<c:valAx>.*<c:axPos val="b"\/>.*<c:crosses val="max"\/>/);
  });

  test("a line chart has markers and no smoothing, in the series' own order", () => {
    const xml = chartPartXml({ type: "line", categories: QUARTERS, series: [{ name: "Customers", values: [560, 590, 620, 645] }] });
    assertOrder(xml, ["<c:lineChart>", '<c:grouping val="standard"/>', '<c:varyColors val="0"/>', "<c:ser>", "<c:spPr><a:ln", "<c:marker>", "<c:cat>", "<c:val>", '<c:smooth val="0"/>', "</c:ser>", '<c:marker val="1"/>', "<c:axId"]);
    // One series, no title: nothing to name in a legend or a heading.
    assert.doesNotMatch(xml, /<c:legend>/);
    assert.match(xml, /<c:autoTitleDeleted val="1"\/>/);
  });

  test("a pie chart colours each slice from the theme, has no axes, and a legend naming the slices", () => {
    const xml = chartPartXml({ type: "pie", categories: ["EMEA", "Americas", "APAC"], series: [{ name: "Share", values: [0.47, 0.34, 0.19] }], numberFormat: "0%", showValues: true });
    assertOrder(xml, ["<c:pieChart>", '<c:varyColors val="1"/>', "<c:ser>", "<c:tx>", "<c:dPt>", "<c:cat>", "<c:val>", "</c:ser>", "<c:dLbls>", "<c:firstSliceAng"]);
    assert.equal((xml.match(/<c:dPt>/g) ?? []).length, 3);
    assert.match(xml, /<c:dPt><c:idx val="2"\/><c:bubble3D val="0"\/><c:spPr><a:solidFill><a:schemeClr val="accent3"\/>/);
    assert.doesNotMatch(xml, /<c:catAx>|<c:valAx>/);
    assert.match(xml, /<c:legend>/);
  });

  test("the slide's frame points at the chart part it is related to", () => {
    assert.match(
      chartFrame(5, "rId2", AREA),
      /<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Chart 4"\/><p:cNvGraphicFramePr\/><p:nvPr\/><\/p:nvGraphicFramePr><p:xfrm><a:off x="838200" y="1825625"\/><a:ext cx="10515600" cy="4351338"\/><\/p:xfrm><a:graphic><a:graphicData uri="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/chart"><c:chart xmlns:c="[^"]+" r:id="rId2"\/>/,
    );
  });

  test("the embedded workbook holds the data where the chart's references point", async () => {
    const workbook = chartWorkbook(column);
    const markdown = (await extractXlsx(new Uint8Array(workbook))).markdown;
    assert.match(markdown, /\| 1 \|  \| 2025 \| 2026 \|/);
    assert.match(markdown, /\| 2 \| Q1 \| 1\.8 \| 2 \|/);
    assert.match(markdown, /\| 5 \| Q4 \| 2\.6 \| 2\.4 \|/);
  });

  test("refuse data that cannot be charted, saying so", () => {
    const base = { type: "column" as const, categories: ["a", "b"], series: [{ name: "s", values: [1, 2] }] };
    assert.throws(() => validateChart({ ...base, type: "radar" as never }, "slide 3"), /unknown chart type "radar"; use column, bar, line, pie/);
    assert.throws(() => validateChart({ ...base, categories: [] }, "slide 3"), /no categories/);
    assert.throws(() => validateChart({ ...base, series: [] }, "slide 3"), /no series/);
    assert.throws(() => validateChart({ ...base, series: [{ name: "s", values: [1] }] }, "slide 3"), /series "s" has 1 values for 2 categories/);
    assert.throws(() => validateChart({ ...base, series: [{ name: "s", values: [1, Number.NaN] }] }, "slide 3"), /not a finite number/);
    assert.throws(() => validateChart({ ...base, type: "pie", series: [...base.series, { name: "t", values: [1, 2] }] }, "slide 3"), /exactly one series/);
    assert.throws(() => validateChart({ ...base, type: "pie", series: [{ name: "s", values: [1, -2] }] }, "slide 3"), /negative values/);
    assert.throws(() => validateChart({ ...base, type: "line", stacked: true }, "slide 3"), /only column and bar charts can be stacked/);
    assert.throws(() => validateChart({ ...base, numberFormat: " " }, "slide 3"), /number format/);
    assert.throws(() => validateChart({ ...base, series: Array.from({ length: 11 }, (_, i) => ({ name: `s${i}`, values: [1, 2] })) }, "slide 3"), /11 series; at most 10/);
  });
});
