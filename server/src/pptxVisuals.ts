/**
 * Native PowerPoint tables and charts for the presentation builder.
 *
 * Native, not pictures: a table is an `a:tbl` the audience can edit and the
 * template's table style colours; a chart is a DrawingML chart part whose data lives
 * in an embedded workbook, so PowerPoint's "Edit Data" opens it, and whose series take
 * the theme's accent colours — the same deck on another theme recolours itself.
 *
 * The markup follows the ECMA-376 element orders (they are sequences: a child out of
 * place is a file PowerPoint repairs or refuses), checked against python-pptx's chart
 * writer, which PowerPoint has opened for a decade.
 */
import { escapeXml, PptxBuildError, type Box } from "./pptxBuild.ts";
import { writeZip } from "./zipWriter.ts";

/* ── Specifications ─────────────────────────────────────────────────────────── */

export interface SlideTable {
  /** Rows of cells, the first being the header unless `header` is false. */
  rows: string[][];
  /** Whether the first row is a header (styled as one). Default true. */
  header?: boolean;
}

export type ChartType = "column" | "bar" | "line" | "pie";
export const CHART_TYPES: ChartType[] = ["column", "bar", "line", "pie"];

export interface SlideChart {
  type: ChartType;
  title?: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  /** Stack the series (column and bar only). */
  stacked?: boolean;
  /** Excel number format for values and their labels, e.g. `0%`, `#,##0`, `0.0`. */
  numberFormat?: string;
  /** Write each value on the chart. */
  showValues?: boolean;
}

export const MAX_TABLE_ROWS = 20;
export const MAX_TABLE_COLUMNS = 10;
export const MAX_CELL_CHARS = 500;
export const MAX_CHART_CATEGORIES = 50;
export const MAX_CHART_SERIES = 10;

export function validateTable(table: SlideTable, where: string): void {
  if (table.rows.length === 0) throw new PptxBuildError(`${where}: the table has no rows`);
  if (table.rows.length > MAX_TABLE_ROWS) {
    throw new PptxBuildError(`${where}: the table has ${table.rows.length} rows; at most ${MAX_TABLE_ROWS} can be read on a slide — split it across slides`);
  }
  const columns = table.rows[0].length;
  if (columns === 0) throw new PptxBuildError(`${where}: the table has no columns`);
  if (columns > MAX_TABLE_COLUMNS) {
    throw new PptxBuildError(`${where}: the table has ${columns} columns; at most ${MAX_TABLE_COLUMNS} can be read on a slide`);
  }
  table.rows.forEach((row, index) => {
    if (row.length !== columns) {
      throw new PptxBuildError(`${where}: table row ${index + 1} has ${row.length} cells, the first row has ${columns}`);
    }
    if (row.some((cell) => cell.length > MAX_CELL_CHARS)) {
      throw new PptxBuildError(`${where}: a table cell in row ${index + 1} is longer than ${MAX_CELL_CHARS} characters`);
    }
  });
}

export function validateChart(chart: SlideChart, where: string): void {
  if (!CHART_TYPES.includes(chart.type)) throw new PptxBuildError(`${where}: unknown chart type "${chart.type}"; use ${CHART_TYPES.join(", ")}`);
  const count = chart.categories.length;
  if (count === 0) throw new PptxBuildError(`${where}: the chart has no categories`);
  if (count > MAX_CHART_CATEGORIES) throw new PptxBuildError(`${where}: the chart has ${count} categories; at most ${MAX_CHART_CATEGORIES}`);
  if (chart.series.length === 0) throw new PptxBuildError(`${where}: the chart has no series`);
  if (chart.series.length > MAX_CHART_SERIES) throw new PptxBuildError(`${where}: the chart has ${chart.series.length} series; at most ${MAX_CHART_SERIES}`);
  if (chart.type === "pie" && chart.series.length !== 1) throw new PptxBuildError(`${where}: a pie chart shows exactly one series (got ${chart.series.length})`);
  if (chart.stacked && (chart.type === "pie" || chart.type === "line")) throw new PptxBuildError(`${where}: only column and bar charts can be stacked`);
  for (const series of chart.series) {
    if (series.values.length !== count) {
      throw new PptxBuildError(`${where}: series "${series.name}" has ${series.values.length} values for ${count} categories`);
    }
    if (series.values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new PptxBuildError(`${where}: series "${series.name}" holds a value that is not a finite number`);
    }
    if (chart.type === "pie" && series.values.some((value) => value < 0)) {
      throw new PptxBuildError(`${where}: a pie chart cannot show negative values`);
    }
  }
  if (chart.numberFormat !== undefined && (chart.numberFormat.trim() === "" || chart.numberFormat.length > 64)) {
    throw new PptxBuildError(`${where}: the number format must be a short Excel format such as "0%" or "#,##0"`);
  }
}

/* ── Tables ─────────────────────────────────────────────────────────────────── */

/** PowerPoint's default table style ("Medium Style 2 – Accent 1"), which follows the theme. */
const DEFAULT_TABLE_STYLE = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
const TABLE_URI = "http://schemas.openxmlformats.org/drawingml/2006/table";

const NUMERIC = /^[-+(]?[$€£¥]?\s?[-+]?\d[\d\s,.']*\s?(%|[$€£¥]|[kKmMbB])?\)?$/;

/** A font size a table of this many rows can still be read at, in hundredths of a point. */
function tableFontSize(rows: number): number {
  if (rows <= 5) return 1800;
  if (rows <= 8) return 1600;
  if (rows <= 12) return 1400;
  return 1200;
}

/**
 * A table filling the area's width, its rows as tall as the text needs. Numeric cells
 * are right-aligned, so figures line up by their last digit.
 */
export function tableFrame(id: number, table: SlideTable, area: Box): string {
  const columns = table.rows[0].length;
  const size = tableFontSize(table.rows.length);
  // A row a line of that size fits in, with the cell's own margins: never taller than
  // the area divided among the rows.
  const rowHeight = Math.min(Math.floor(area.cy / table.rows.length), Math.round((size / 100) * 12700 * 2.1));
  const columnWidth = Math.floor(area.cx / columns);
  const grid = Array.from({ length: columns }, (_, index) =>
    `<a:gridCol w="${index === columns - 1 ? area.cx - columnWidth * (columns - 1) : columnWidth}"/>`,
  ).join("");
  const header = table.header !== false;
  const rows = table.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell) => {
          const right = !(header && rowIndex === 0) && NUMERIC.test(cell.trim());
          const text = cell === "" ? "" : `<a:r><a:rPr lang="en-US" sz="${size}" dirty="0"/><a:t>${escapeXml(cell)}</a:t></a:r>`;
          return (
            `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${right ? '<a:pPr algn="r"/>' : ""}${text}` +
            `<a:endParaRPr lang="en-US" sz="${size}" dirty="0"/></a:p></a:txBody><a:tcPr anchor="ctr"/></a:tc>`
          );
        })
        .join("");
      return `<a:tr h="${rowHeight}">${cells}</a:tr>`;
    })
    .join("");
  const height = rowHeight * table.rows.length;
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id - 1}"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${Math.round(area.x)}" y="${Math.round(area.y)}"/><a:ext cx="${Math.round(area.cx)}" cy="${height}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${TABLE_URI}"><a:tbl>` +
    `<a:tblPr${header ? ' firstRow="1"' : ""} bandRow="1"><a:tableStyleId>${DEFAULT_TABLE_STYLE}</a:tableStyleId></a:tblPr>` +
    `<a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

/* ── Charts ─────────────────────────────────────────────────────────────────── */

const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const CHART_URI = NS_C;
export const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
export const CT_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const REL_CHART = `${NS_R}/chart`;
export const REL_PACKAGE = `${NS_R}/package`;

const CATEGORY_AXIS = 111_111_111;
const VALUE_AXIS = 222_222_222;

/** Excel's column letters: A…Z, AA… */
function column(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** A number as a chart cache or a cell writes it: plain, no exponent surprises for integers. */
function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
}

/** The theme accent a series (or a pie slice) takes, cycling through the six. */
function accentFill(index: number, line = false): string {
  const fill = `<a:solidFill><a:schemeClr val="accent${(index % 6) + 1}"/></a:solidFill>`;
  return line ? `<c:spPr><a:ln w="28575" cap="rnd">${fill}<a:round/></a:ln></c:spPr>` : `<c:spPr>${fill}</c:spPr>`;
}

function stringCache(reference: string, values: string[]): string {
  return (
    `<c:strRef><c:f>${reference}</c:f><c:strCache><c:ptCount val="${values.length}"/>` +
    values.map((value, index) => `<c:pt idx="${index}"><c:v>${escapeXml(value)}</c:v></c:pt>`).join("") +
    `</c:strCache></c:strRef>`
  );
}

function numberCache(reference: string, values: number[], format: string): string {
  return (
    `<c:numRef><c:f>${reference}</c:f><c:numCache><c:formatCode>${escapeXml(format)}</c:formatCode><c:ptCount val="${values.length}"/>` +
    values.map((value, index) => `<c:pt idx="${index}"><c:v>${numberText(value)}</c:v></c:pt>`).join("") +
    `</c:numCache></c:numRef>`
  );
}

function dataLabels(chart: SlideChart): string {
  if (!chart.showValues) return "";
  const format = chart.numberFormat ? `<c:numFmt formatCode="${escapeXml(chart.numberFormat)}" sourceLinked="0"/>` : "";
  // No dLblPos: "outEnd" is refused on stacked bars, and every chart type has a default.
  return (
    `<c:dLbls>${format}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>` +
    `<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
  );
}

function richTitle(text: string): string {
  const lines = text.split(/\r?\n/);
  return (
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>` +
    lines.map((line) => `<a:p><a:pPr><a:defRPr sz="2000" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="2000" b="1"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join("") +
    `</c:rich></c:tx><c:overlay val="0"/></c:title>`
  );
}

function axes(chart: SlideChart): string {
  const horizontal = chart.type === "bar";
  const format = chart.numberFormat ? `<c:numFmt formatCode="${escapeXml(chart.numberFormat)}" sourceLinked="0"/>` : `<c:numFmt formatCode="General" sourceLinked="1"/>`;
  return (
    `<c:catAx><c:axId val="${CATEGORY_AXIS}"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${VALUE_AXIS}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="${VALUE_AXIS}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/>` +
    `<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill></a:ln></c:spPr></c:majorGridlines>` +
    `${format}<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    // A bar chart's categories run top to bottom (maxMin), so its value axis crosses at the far end.
    `<c:crossAx val="${CATEGORY_AXIS}"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>`
  );
}

/** The chart part: a `c:chartSpace` whose caches carry every value, linked to its workbook as rId1. */
export function chartPartXml(chart: SlideChart): string {
  const format = chart.numberFormat ?? "General";
  const count = chart.categories.length;
  const categoryRef = `Sheet1!$A$2:$A$${count + 1}`;
  const series = chart.series
    .map((entry, index) => {
      const col = column(index + 1);
      const tx = `<c:tx>${stringCache(`Sheet1!$${col}$1`, [entry.name])}</c:tx>`;
      const cat = `<c:cat>${stringCache(categoryRef, chart.categories)}</c:cat>`;
      const val = `<c:val>${numberCache(`Sheet1!$${col}$2:$${col}$${count + 1}`, entry.values, format)}</c:val>`;
      const head = `<c:idx val="${index}"/><c:order val="${index}"/>${tx}`;
      if (chart.type === "pie") {
        const points = chart.categories.map((_, point) => `<c:dPt><c:idx val="${point}"/><c:bubble3D val="0"/>${accentFill(point)}</c:dPt>`).join("");
        return `<c:ser>${head}${points}${cat}${val}</c:ser>`;
      }
      if (chart.type === "line") {
        return `<c:ser>${head}${accentFill(index, true)}<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
      }
      return `<c:ser>${head}${accentFill(index)}<c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
    })
    .join("");

  let plot: string;
  if (chart.type === "pie") {
    plot = `<c:pieChart><c:varyColors val="1"/>${series}${dataLabels(chart)}<c:firstSliceAng val="0"/></c:pieChart>`;
  } else if (chart.type === "line") {
    plot =
      `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}${dataLabels(chart)}` +
      `<c:marker val="1"/><c:axId val="${CATEGORY_AXIS}"/><c:axId val="${VALUE_AXIS}"/></c:lineChart>${axes(chart)}`;
  } else {
    plot =
      `<c:barChart><c:barDir val="${chart.type === "bar" ? "bar" : "col"}"/><c:grouping val="${chart.stacked ? "stacked" : "clustered"}"/>` +
      `<c:varyColors val="0"/>${series}${dataLabels(chart)}<c:gapWidth val="${chart.stacked ? 60 : 100}"/>` +
      `${chart.stacked ? '<c:overlap val="100"/>' : ""}<c:axId val="${CATEGORY_AXIS}"/><c:axId val="${VALUE_AXIS}"/></c:barChart>${axes(chart)}`;
  }

  // One series needs no legend, except a pie, whose legend names the slices.
  const legend = chart.series.length > 1 || chart.type === "pie" ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
    `<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>` +
    `<c:chart>${chart.title ? richTitle(chart.title) : '<c:autoTitleDeleted val="1"/>'}` +
    `<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    // Chart text in the theme's body font, at a size read from across a room.
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"><a:latin typeface="+mn-lt"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
    `<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>` +
    `</c:chartSpace>`
  );
}

/** The slide's frame holding the chart part related as `relationshipId`. */
export function chartFrame(id: number, relationshipId: string, area: Box): string {
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id - 1}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${Math.round(area.x)}" y="${Math.round(area.y)}"/><a:ext cx="${Math.round(area.cx)}" cy="${Math.round(area.cy)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${CHART_URI}"><c:chart xmlns:c="${NS_C}" r:id="${relationshipId}"/></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

/**
 * The workbook behind the chart: categories down column A, one series per column from
 * B, names in row 1 — the layout the chart's cell references point at, and the one
 * PowerPoint's "Edit Data" opens. Strings are inline, so no shared-string part is needed.
 */
export function chartWorkbook(chart: SlideChart): Buffer {
  const cell = (ref: string, value: string | number) =>
    typeof value === "number"
      ? `<c r="${ref}"><v>${numberText(value)}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const rows = [
    `<row r="1">${cell("A1", "")}${chart.series.map((series, index) => cell(`${column(index + 1)}1`, series.name)).join("")}</row>`,
    ...chart.categories.map(
      (category, row) =>
        `<row r="${row + 2}">${cell(`A${row + 2}`, category)}${chart.series
          .map((series, index) => cell(`${column(index + 1)}${row + 2}`, series.values[row]))
          .join("")}</row>`,
    ),
  ];
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rels = "http://schemas.openxmlformats.org/package/2006/relationships";
  return writeZip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(`${header}<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(`${header}<workbook xmlns="${main}" xmlns:r="${NS_R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`${header}<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: Buffer.from(`${header}<worksheet xmlns="${main}"><sheetData>${rows.join("")}</sheetData></worksheet>`),
    },
  ]);
}
