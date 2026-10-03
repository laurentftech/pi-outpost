/**
 * A timeline as a figure: the same shapes on screen and in a file.
 *
 * The layout decides where everything goes; this decides what it looks like, once,
 * in the figure model graphs and sequences already use. The reader draws the header
 * and rows from these parts and adds pointing and selection on top; the writer
 * concatenates the same parts with a label column and a key into one SVG. Two
 * renderings of one decision cannot disagree about where a bar is.
 */
import type { StructuredTimelineData } from "./structuredExchange.ts";
import {
  FIGURE_FONT,
  markerId,
  type Figure,
  type FigureGroup,
  type FigureMarker,
  type Primitive,
} from "./structuredExchangeFigure.ts";
import { assignTints, INK, MUTED, sharedDeclaredColours, type Tint } from "./structuredExchangePalette.ts";
import type { ProjectAppearance } from "./structuredExchangeProfile.ts";
import { CHAR_WIDTH } from "./structuredExchangeText.ts";
import { withoutComparison } from "./structuredExchangeTimelineComparison.ts";
import {
  calendarDate,
  dayNumber,
  dependencyText,
  layoutTimeline,
  monthLabelFor,
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_PX_PER_DAY,
  TIMELINE_STAR_RADIUS,
  TIMELINE_TODAY_BAND,
  TIMELINE_YEAR_BAND,
  timelineLabelColumnWidth,
  type TimelineDependencyLayout,
  type TimelineItemLayout,
  type TimelineLayout,
} from "./structuredExchangeTimeline.ts";

const RULE = "#e4e4e7";
const TODAY = "#ea580c";
const UNSATISFIED = "#dc2626";
const EMPHASIS = "#2563eb";
const NEUTRAL: Tint = { fill: "#e4e4e7", stroke: "#52525b" };
/** A kinded bar is its kind's colour, lightened enough for a label inside it. */
export const TIMELINE_BAR_FILL_OPACITY = 0.35;
/** Below this the plan is too long for the width asked: the figure is wider, and says so. */
export const TIMELINE_MIN_PX_PER_DAY = 0.25;
const MARGIN = 8;
const TITLE_HEIGHT = 24;
const LEGEND_ROW = 18;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How the current date is drawn: the reader's "Today", a file's dated line, or not at all. */
export type ReferenceLine = "today" | "dated" | "none";

export interface TimelineFigureOptions {
  /** The current date as a day number; required unless the reference line is omitted. */
  today: number;
  compact?: boolean;
  showDependencies?: boolean;
  /** Fit the whole figure, label column included, into this many pixels. */
  width?: number;
  appearance?: ProjectAppearance | null;
  referenceLine?: ReferenceLine;
  /** The reader's selection, by task row and optionally item: emphasised, never saved. */
  selection?: { row: number; item?: number };
  /** For a compared timeline: the comparison (default), or the new version as a plain plan. */
  comparison?: "compare" | "new";
  /** For a compared timeline: only the tasks holding a change. */
  onlyChanged?: boolean;
}

export interface TimelineFigureParts {
  layout: TimelineLayout;
  pxPerDay: number;
  /** True when the plan could not be fitted into the width asked. */
  overWidth: boolean;
  labelWidth: number;
  tints: ReadonlyMap<string, Tint>;
  markers: FigureMarker[];
  header: FigureGroup[];
  rows: FigureGroup[];
  labels: FigureGroup[];
  legend: { groups: FigureGroup[]; height: number };
}

/** A star's five points round a centre. */
export function starPath(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index++) {
    const r = index % 2 === 0 ? radius : radius * 0.45;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}

/**
 * Diagonal lines inside a box, each cut to it. `1` rises, `2` falls, `3` crosses;
 * the neutral period's hatch, and a kind's second channel once its colours are spent.
 */
export function hatch(
  x: number,
  y: number,
  width: number,
  height: number,
  variant: 1 | 2 | 3 = 1,
  stroke = "#a1a1aa",
  spacing = 6,
  opacity = 0.5,
): Primitive[] {
  const lines: Primitive[] = [];
  const rising = (mirror: boolean) => {
    for (let k = spacing; k < width + height; k += spacing) {
      // The line x' + y' = k in box coordinates, cut to the box.
      const ax = Math.min(k, width);
      const ay = Math.max(0, k - width);
      const bx = Math.max(0, k - height);
      const by = Math.min(k, height);
      lines.push({
        shape: "line",
        x1: x + (mirror ? width - ax : ax),
        y1: y + ay,
        x2: x + (mirror ? width - bx : bx),
        y2: y + by,
        stroke,
        strokeWidth: 0.6,
        opacity,
      });
    }
  };
  if (variant === 1 || variant === 3) rising(false);
  if (variant === 2 || variant === 3) rising(true);
  return lines;
}

/** `3 Oct 2026`: the date a written figure's reference line stands for. */
export function writtenDate(day: number): string {
  const [year, month, date] = calendarDate(day).split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** A label cut to fit a width, by the same count every figure uses. */
function fitText(text: string, width: number): string {
  const room = Math.floor(width / CHAR_WIDTH);
  return text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`;
}

/** The accessible account of an item, as a pointer or a screen reader gets it. */
export function timelineItemName(data: StructuredTimelineData, layout: TimelineLayout, item: TimelineItemLayout): string {
  const task = data.rows[item.row];
  if (task?.type !== "task") return "";
  const declared = task.items[item.item];
  const dates = declared.type === "activity" ? `${declared.start} to ${declared.end}` : declared.date;
  const linked = declared.id === undefined ? [] : layout.dependencies.filter((arrow) => arrow.from === declared.id || arrow.to === declared.id);
  const unsatisfied = linked.filter((arrow) => !arrow.satisfied).length;
  return [
    `${declared.type} ${dates}`,
    declared.label,
    declared.kind === undefined ? undefined : `kind ${declared.kind}`,
    `task "${task.label}" (${task.id})`,
    linked.length === 0
      ? undefined
      : `${linked.length} ${linked.length === 1 ? "dependency" : "dependencies"}${unsatisfied > 0 ? `, ${unsatisfied} not satisfied` : ""}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

export function timelineFigureParts(document: StructuredTimelineData, options: TimelineFigureOptions): TimelineFigureParts {
  // "New version only" is the plan with its comparison taken out — exactly what the
  // current plan would draw as, so the two cannot differ.
  const data = options.comparison === "new" ? withoutComparison(document) : document;
  const labelWidth = timelineLabelColumnWidth(data);
  const span = (() => {
    const probe = layoutTimeline(data, options.today, { compact: options.compact, pxPerDay: 1, onlyChanged: options.onlyChanged });
    return probe.end - probe.start + 1;
  })();
  let pxPerDay = TIMELINE_PX_PER_DAY;
  let overWidth = false;
  if (options.width !== undefined) {
    const fitted = (options.width - labelWidth - 2 * MARGIN) / span;
    pxPerDay = Math.max(TIMELINE_MIN_PX_PER_DAY, fitted);
    overWidth = fitted < TIMELINE_MIN_PX_PER_DAY;
  }
  const layout = layoutTimeline(data, options.today, { compact: options.compact, pxPerDay, onlyChanged: options.onlyChanged });
  // Colour alone: in a timeline a dashed outline means a previous position, and a type
  // drawn dashed would read as a change that never happened.
  const tints = assignTints(layout.kinds, options.appearance?.kinds, { dashes: false });
  const tintOf = (kind: string | undefined) => (kind === undefined ? NEUTRAL : (tints.get(kind) ?? NEUTRAL));
  const reference = options.referenceLine ?? "today";
  const showDependencies = options.showDependencies ?? true;
  const markers: FigureMarker[] = [MUTED, UNSATISFIED, EMPHASIS].map((paint) => ({ id: markerId("tl", paint), paint }));

  // ── Header ──────────────────────────────────────────────────────────────────
  const header: FigureGroup[] = [
    {
      id: "header-ground",
      primitives: [
        { shape: "rect", x: 0, y: 0, width: layout.width, height: TIMELINE_HEADER_HEIGHT, fill: "#ffffff" },
        ...layout.monthLines.map(
          (x): Primitive => ({ shape: "line", x1: x, x2: x, y1: TIMELINE_TODAY_BAND + TIMELINE_YEAR_BAND, y2: TIMELINE_HEADER_HEIGHT, stroke: RULE }),
        ),
        {
          shape: "line",
          x1: 0,
          x2: layout.width,
          y1: TIMELINE_HEADER_HEIGHT - 0.5,
          y2: TIMELINE_HEADER_HEIGHT - 0.5,
          stroke: MUTED,
        },
      ],
    },
    ...layout.years.map(
      (year): FigureGroup => ({
        id: `year-${year.x}`,
        testId: "timeline-year",
        primitives: [
          { shape: "line", x1: year.x, x2: year.x, y1: TIMELINE_TODAY_BAND, y2: TIMELINE_HEADER_HEIGHT, stroke: MUTED },
          { shape: "text", x: year.x + 4, y: TIMELINE_TODAY_BAND + 14, text: year.label, fontSize: 11, fontWeight: 600, fill: INK, fontFamily: FIGURE_FONT },
        ],
      }),
    ),
    {
      id: "year-repeats",
      // The year again at each quarter that opens no year band: scrolled or fitted
      // past January, a reader would otherwise see months with no year at all.
      primitives: layout.months
        .filter((month, index) => index > 0 && month.month % 3 === 0 && month.month !== 0)
        .map((month): Primitive => ({
          shape: "text",
          x: month.x + 4,
          y: TIMELINE_TODAY_BAND + 14,
          text: String(month.year),
          fontSize: 11,
          fill: MUTED,
          fontFamily: FIGURE_FONT,
          testId: "timeline-year-repeat",
        })),
    },
    {
      id: "months",
      primitives: layout.months.map((month): Primitive => ({
        shape: "text",
        x: month.x + month.width / 2,
        y: TIMELINE_TODAY_BAND + TIMELINE_YEAR_BAND + 14,
        text: monthLabelFor(month),
        fontSize: 10,
        textAnchor: "middle",
        fill: MUTED,
        fontFamily: FIGURE_FONT,
        testId: "timeline-month",
      })),
    },
  ];
  // Each period carried up into the calendar's year and month bands, so where it falls
  // reads against the dates and not only against the rows.
  if (layout.periods.length > 0) {
    header.push({
      id: "calendar-bands",
      primitives: layout.periods.map((period): Primitive => ({
        shape: "rect",
        x: period.x,
        y: TIMELINE_TODAY_BAND,
        width: period.width,
        height: TIMELINE_HEADER_HEIGHT - TIMELINE_TODAY_BAND,
        fill: period.kind === undefined ? "#a1a1aa" : tintOf(period.kind).stroke,
        fillOpacity: period.kind === undefined ? 0.1 : 0.12,
      })),
    });
  }
  // Period and reference names, in the top band; the Today tag is drawn over them.
  if (layout.headerLabels.length > 0) {
    header.push({
      id: "calendar-names",
      primitives: layout.headerLabels.map((label): Primitive => {
        const kind = label.of === "period" ? layout.periods.find((p) => p.index === label.index)?.kind : layout.references.find((r) => r.index === label.index)?.kind;
        return {
          shape: "text",
          x: label.x,
          y: 12,
          text: label.text,
          fontSize: 10,
          fill: kind === undefined ? MUTED : tintOf(kind).stroke,
          fontFamily: FIGURE_FONT,
          testId: `timeline-${label.of}-name`,
        };
      }),
    });
  }
  const tagText = reference === "dated" ? writtenDate(options.today) : "Today";
  if (reference !== "none" && "x" in layout.today) {
    const x = layout.today.x;
    const tagWidth = Math.max(44, tagText.length * 6 + 10);
    header.push({
      id: "today-tag",
      testId: "timeline-today-tag",
      primitives: [
        { shape: "rect", x: x - tagWidth / 2, y: 1, width: tagWidth, height: TIMELINE_TODAY_BAND - 3, rx: 3, fill: TODAY },
        { shape: "text", x, y: 12, text: tagText, fontSize: 10, fontWeight: 600, textAnchor: "middle", fill: "#ffffff", fontFamily: FIGURE_FONT },
        { shape: "line", x1: x, x2: x, y1: TIMELINE_TODAY_BAND - 2, y2: TIMELINE_HEADER_HEIGHT, stroke: TODAY, strokeWidth: 2 },
      ],
    });
  }
  if (reference !== "none" && "outside" in layout.today) {
    const before = layout.today.outside === "before";
    const named = reference === "dated" ? writtenDate(layout.today.day) : `Today (${calendarDate(layout.today.day)})`;
    header.push({
      id: "today-outside",
      primitives: [
        {
          shape: "text",
          x: before ? 4 : layout.width - 4,
          y: 12,
          text: before ? `◂ ${named} is before this range` : `${named} is after this range ▸`,
          fontSize: 10,
          fontWeight: 600,
          textAnchor: before ? "start" : "end",
          fill: TODAY,
          fontFamily: FIGURE_FONT,
          testId: "timeline-today-outside",
          data: { side: layout.today.outside },
        },
      ],
    });
  }

  // ── Rows ────────────────────────────────────────────────────────────────────
  const selectedId = (() => {
    if (options.selection === undefined) return undefined;
    const row = data.rows[options.selection.row];
    if (row?.type !== "task") return undefined;
    return options.selection.item === undefined ? row.id : row.items[options.selection.item]?.id;
  })();
  const involves = (arrow: TimelineDependencyLayout) => selectedId !== undefined && (arrow.from === selectedId || arrow.to === selectedId);

  const rows: FigureGroup[] = [
    {
      id: "rows-ground",
      primitives: [
        { shape: "rect", x: 0, y: 0, width: layout.width, height: layout.height, fill: "#ffffff" },
        ...layout.monthLines.map((x): Primitive => ({ shape: "line", x1: x, x2: x, y1: 0, y2: layout.height, stroke: RULE })),
      ],
    },
    ...layout.rows.map(
      (row): FigureGroup =>
        row.type === "separator"
          ? {
              id: `separator-${row.row}`,
              testId: "timeline-separator",
              primitives: [
                { shape: "rect", x: 0, y: row.y, width: layout.width, height: row.height, fill: "#f4f4f5" },
                { shape: "line", x1: 0, x2: layout.width, y1: row.y + 0.5, y2: row.y + 0.5, stroke: "#a1a1aa", strokeWidth: 1.5 },
              ],
            }
          : row.type === "section"
            ? {
                id: `section-${row.row}`,
                testId: "timeline-section",
                primitives: [{ shape: "line", x1: 0, x2: layout.width, y1: row.y + 0.5, y2: row.y + 0.5, stroke: "#a1a1aa", strokeWidth: 1.5 }],
              }
            : {
                id: `row-${row.row}`,
                primitives: [{ shape: "line", x1: 0, x2: layout.width, y1: row.y + 0.5, y2: row.y + 0.5, stroke: "#f4f4f5" }],
              },
    ),
  ];

  // Calendar periods: translucent bands across every row, separators included, under
  // the work. A kind gives a colour; no kind is neutral and hatched, so an unnamed
  // closure is still told apart from a coloured one.
  for (const period of layout.periods) {
    const declared = data.periods![period.index];
    const name = `${declared.label ?? "Period"}: ${writtenDate(dayNumber(declared.start)!)} – ${writtenDate(dayNumber(declared.end)!)}`;
    const primitives: Primitive[] = [
      {
        shape: "rect",
        x: period.x,
        y: 0,
        width: period.width,
        height: layout.height,
        fill: period.kind === undefined ? "#a1a1aa" : tintOf(period.kind).stroke,
        fillOpacity: period.kind === undefined ? 0.1 : 0.12,
      },
    ];
    if (period.kind === undefined) primitives.push(...hatch(period.x, 0, period.width, layout.height));
    rows.push({ id: `period-${period.index}`, testId: "timeline-period", title: name, data: { ...(period.kind ? { kind: period.kind } : {}) }, primitives });
  }
  for (const marked of layout.references) {
    const paint = marked.kind === undefined ? "#3f3f46" : tintOf(marked.kind).stroke;
    rows.push({
      id: `reference-${marked.index}`,
      testId: "timeline-reference",
      title: `${marked.label}: ${writtenDate(dayNumber(marked.date)!)}`,
      data: { ...(marked.kind ? { kind: marked.kind } : {}) },
      primitives: [{ shape: "line", x1: marked.x, x2: marked.x, y1: 0, y2: layout.height, stroke: paint, strokeWidth: 1.5, strokeDasharray: "6 3" }],
    });
  }

  // Arrows before glyphs and annotations, so no annotation is ever under one.
  if (showDependencies) {
    for (const arrow of layout.dependencies) {
      const emphasised = involves(arrow);
      const paint = emphasised ? EMPHASIS : arrow.satisfied ? MUTED : UNSATISFIED;
      const dependency = data.dependencies![arrow.index];
      rows.push({
        id: `dependency-${arrow.index}`,
        testId: "timeline-dependency",
        title: dependencyText(data, dependency, arrow.satisfied),
        data: {
          from: arrow.from,
          to: arrow.to,
          type: arrow.type,
          satisfied: String(arrow.satisfied),
          emphasised: String(emphasised),
        },
        primitives: [
          {
            shape: "path",
            d: `M${arrow.points.map((point) => `${point.x},${point.y}`).join(" L")}`,
            stroke: paint,
            strokeWidth: emphasised ? 2.25 : 1.25,
            ...(arrow.satisfied ? {} : { strokeDasharray: "4 3" }),
            markerEnd: markerId("tl", paint),
          },
        ],
      });
    }
  }

  for (const item of layout.items) {
    const tint = tintOf(item.kind);
    const selected = options.selection?.row === item.row && options.selection.item === item.item;
    const primitives: Primitive[] = [];
    const removed = item.change === "removed";
    // The previous position first, dashed and unfilled, under the current one.
    if (item.ghost !== undefined) {
      if (item.type === "activity") {
        primitives.push({
          shape: "rect",
          x: item.ghost.x,
          y: item.ghost.y,
          width: item.ghost.width,
          height: item.ghost.height,
          rx: 3,
          fill: "none",
          stroke: tint.stroke,
          strokeWidth: 1.25,
          strokeDasharray: "4 3",
          data: { previous: "true" },
        });
      } else if (item.ghostCenter !== undefined) {
        if (item.ghostCenter.y === item.center!.y) {
          primitives.push({
            shape: "line",
            x1: item.ghostCenter.x,
            x2: item.center!.x,
            y1: item.center!.y,
            y2: item.center!.y,
            stroke: MUTED,
            strokeWidth: 1,
            strokeDasharray: "2 2",
          });
        }
        primitives.push({
          shape: "path",
          d: starPath(item.ghostCenter.x, item.ghostCenter.y, TIMELINE_STAR_RADIUS),
          fill: "none",
          stroke: tint.stroke,
          strokeWidth: 1,
          strokeDasharray: "2 2",
          data: { previous: "true" },
        });
      }
    }
    if (removed) {
      // Dropped from the plan: drawn where it was, outline only.
      primitives.push(
        item.type === "activity"
          ? { shape: "rect", x: item.glyph.x, y: item.glyph.y, width: item.glyph.width, height: item.glyph.height, rx: 3, fill: "none", stroke: tint.stroke, strokeWidth: 1.25, strokeDasharray: "4 3" }
          : { shape: "path", d: starPath(item.center!.x, item.center!.y, TIMELINE_STAR_RADIUS), fill: "none", stroke: tint.stroke, strokeWidth: 1, strokeDasharray: "2 2" },
      );
    } else if (item.type === "activity") {
      const kinded = item.kind !== undefined;
      primitives.push({
        shape: "rect",
        x: item.glyph.x,
        y: item.glyph.y,
        width: item.glyph.width,
        height: item.glyph.height,
        rx: 3,
        fill: kinded ? tint.stroke : tint.fill,
        ...(kinded ? { fillOpacity: TIMELINE_BAR_FILL_OPACITY } : {}),
        stroke: selected ? EMPHASIS : tint.stroke,
        strokeWidth: selected ? 2.5 : 1.25,
      });
      if (tint.hatch !== undefined) {
        primitives.push(...hatch(item.glyph.x, item.glyph.y, item.glyph.width, item.glyph.height, tint.hatch, tint.stroke, 4, 0.8));
      }
    } else {
      primitives.push({
        shape: "path",
        d: starPath(item.center!.x, item.center!.y, TIMELINE_STAR_RADIUS),
        fill: tint.stroke,
        stroke: selected ? EMPHASIS : "#ffffff",
        strokeWidth: selected ? 2 : 0.75,
      });
    }
    if (item.label !== undefined) {
      primitives.push({
        shape: "text",
        x: item.label.x,
        y: item.label.y + 12,
        text: item.label.text,
        fontSize: 11,
        fill: INK,
        fontFamily: FIGURE_FONT,
        testId: "timeline-annotation",
        ...(item.label.struck ? { textDecoration: "line-through" as const } : {}),
        // A halo, so a label stays legible where a reference line or an arrow passes behind it.
        ...(item.label.inside ? {} : { stroke: "#ffffff", strokeWidth: 3, paintOrder: "stroke" as const }),
      });
    }
    rows.push({
      id: `item-${item.row}-${item.item}`,
      testId: `timeline-${item.type}`,
      title: timelineItemName(data, layout, item),
      data: {
        row: String(item.row),
        item: String(item.item),
        ...(item.kind === undefined ? {} : { kind: item.kind }),
        ...(item.change === undefined ? {} : { change: item.change }),
        selected: String(selected),
      },
      primitives,
    });
  }

  if (reference !== "none" && "x" in layout.today) {
    rows.push({
      id: "today",
      testId: "timeline-today",
      primitives: [{ shape: "line", x1: layout.today.x, x2: layout.today.x, y1: 0, y2: layout.height, stroke: TODAY, strokeWidth: 2, opacity: 0.85 }],
    });
  }

  // ── Labels (for a file; the reader draws its own, as buttons) ───────────────
  const labels: FigureGroup[] = layout.rows.map((row): FigureGroup => {
    const y = TIMELINE_HEADER_HEIGHT + row.y;
    const text =
      row.type === "section"
        ? `${row.label ?? ""} (${row.tasks.length})`.trim()
        : row.type === "separator"
          ? (row.label ?? "")
          : row.label;
    const bold = row.type !== "task";
    return {
      id: `label-${row.row}`,
      primitives: [
        ...(bold ? [{ shape: "line" as const, x1: 0, x2: labelWidth, y1: y + 0.5, y2: y + 0.5, stroke: "#a1a1aa", strokeWidth: 1 }] : []),
        {
          shape: "text",
          x: 8,
          y: row.type === "separator" ? y + row.height - 6 : y + row.height / 2 + 4,
          text: fitText(text, labelWidth - 12),
          fontSize: 11,
          ...(bold ? { fontWeight: 600 } : {}),
          fill: bold ? MUTED : INK,
          fontFamily: FIGURE_FONT,
        },
      ],
    };
  });

  // ── Legend (for a file; the reader's is HTML) ────────────────────────────────
  const shapes = new Map<string, { activity: boolean; milestone: boolean }>();
  for (const row of data.rows) {
    if (row.type !== "task") continue;
    for (const item of row.items) {
      if (item.kind === undefined) continue;
      const shape = shapes.get(item.kind) ?? { activity: false, milestone: false };
      shape[item.type] = true;
      shapes.set(item.kind, shape);
    }
  }
  const shared = sharedDeclaredColours(layout.kinds, tints);
  const legendGroups: FigureGroup[] = [];
  let x = 0;
  let line = 0;
  const legendWidth = labelWidth + layout.width;
  for (const kind of layout.kinds) {
    const tint = tintOf(kind);
    // A kind only periods or references carry is named on their own line below.
    const shape = shapes.get(kind);
    if (shape === undefined) continue;
    const label = shared.has(kind) ? `${kind} (same colour as ${shared.get(kind)!.join(", ")})` : kind;
    const entryWidth = (shape.activity ? 22 : 0) + (shape.milestone ? 16 : 0) + label.length * CHAR_WIDTH + 18;
    if (x > 0 && x + entryWidth > legendWidth) {
      x = 0;
      line += 1;
    }
    const top = line * LEGEND_ROW;
    const primitives: Primitive[] = [];
    let at = x;
    if (shape.activity) {
      primitives.push({
        shape: "rect",
        x: at,
        y: top + 4,
        width: 16,
        height: 8,
        rx: 2,
        fill: tint.stroke,
        stroke: tint.stroke,
        fillOpacity: TIMELINE_BAR_FILL_OPACITY,
      });
      if (tint.hatch !== undefined) primitives.push(...hatch(at, top + 4, 16, 8, tint.hatch, tint.stroke, 4, 0.8));
      at += 22;
    }
    if (shape.milestone) {
      primitives.push({ shape: "path", d: starPath(at + 6, top + 8, 6), fill: tint.stroke });
      at += 16;
    }
    primitives.push({ shape: "text", x: at, y: top + 12, text: label, fontSize: 10, fill: MUTED, fontFamily: FIGURE_FONT });
    legendGroups.push({
      id: `legend-${kind}`,
      ...(tint.declared === true ? { title: `${kind} — project colour`, data: { kind, "colour-source": "project" } } : { data: { kind } }),
      primitives,
    });
    x += entryWidth;
  }
  // Periods and reference dates, each named with its dates: whatever the header could not fit.
  const calendar = [
    ...layout.periods.map((period) => {
      const declared = data.periods![period.index];
      return { kind: period.kind, line: false, text: `${declared.label ?? "Period"} ${writtenDate(dayNumber(declared.start)!)} – ${writtenDate(dayNumber(declared.end)!)}` };
    }),
    ...layout.references.map((marked) => ({ kind: marked.kind, line: true, text: `${marked.label} ${writtenDate(dayNumber(marked.date)!)}` })),
  ];
  if (calendar.length > 0) {
    if (x > 0) {
      x = 0;
      line += 1;
    }
    calendar.forEach((entry, position) => {
      const entryWidth = 22 + entry.text.length * CHAR_WIDTH + 18;
      if (x > 0 && x + entryWidth > legendWidth) {
        x = 0;
        line += 1;
      }
      const top = line * LEGEND_ROW;
      const paint = entry.kind === undefined ? (entry.line ? "#3f3f46" : "#a1a1aa") : tintOf(entry.kind).stroke;
      legendGroups.push({
        id: `legend-calendar-${position}`,
        testId: "timeline-calendar-legend",
        primitives: [
          entry.line
            ? { shape: "line", x1: x + 8, x2: x + 8, y1: top + 2, y2: top + 14, stroke: paint, strokeWidth: 1.5, strokeDasharray: "3 2" }
            : { shape: "rect", x, y: top + 3, width: 16, height: 10, fill: paint, fillOpacity: 0.25 },
          { shape: "text", x: x + 22, y: top + 12, text: entry.text, fontSize: 10, fill: MUTED, fontFamily: FIGURE_FONT },
        ],
      });
      x += entryWidth;
    });
  }

  // A comparison's marks, on a line of their own: what dashed, "new" and struck mean.
  if (data.comparedTo !== undefined) {
    if (x > 0) {
      x = 0;
      line += 1;
    }
    const top = line * LEGEND_ROW;
    const marks: Primitive[] = [
      { shape: "rect", x: 0, y: top + 4, width: 16, height: 8, rx: 2, fill: "none", stroke: MUTED, strokeDasharray: "4 3" },
      { shape: "text", x: 22, y: top + 12, text: `previous dates (${data.comparedTo.label})`, fontSize: 10, fill: MUTED, fontFamily: FIGURE_FONT },
    ];
    const afterPrevious = 22 + (`previous dates (${data.comparedTo.label})`.length + 3) * CHAR_WIDTH;
    marks.push(
      { shape: "text", x: afterPrevious, y: top + 12, text: "· new: added since", fontSize: 10, fill: MUTED, fontFamily: FIGURE_FONT },
      {
        shape: "text",
        x: afterPrevious + 20 * CHAR_WIDTH,
        y: top + 12,
        text: "removed",
        fontSize: 10,
        fill: MUTED,
        fontFamily: FIGURE_FONT,
        textDecoration: "line-through",
      },
      { shape: "text", x: afterPrevious + 28 * CHAR_WIDTH, y: top + 12, text: ": dropped since", fontSize: 10, fill: MUTED, fontFamily: FIGURE_FONT },
    );
    legendGroups.push({ id: "legend-comparison", testId: "timeline-comparison-legend", primitives: marks });
  }
  const legendHeight = legendGroups.length === 0 ? 0 : (line + 1) * LEGEND_ROW + 6;

  return { layout, pxPerDay, overWidth, labelWidth, tints, markers, header, rows, labels, legend: { groups: legendGroups, height: legendHeight } };
}

/** Shifts a group and everything under it, for assembling parts into one picture. */
function translated(group: FigureGroup, dx: number, dy: number): FigureGroup {
  const move = (primitive: Primitive): Primitive => {
    switch (primitive.shape) {
      case "rect":
      case "text":
        return { ...primitive, x: primitive.x + dx, y: primitive.y + dy };
      case "line":
        return { ...primitive, x1: primitive.x1 + dx, x2: primitive.x2 + dx, y1: primitive.y1 + dy, y2: primitive.y2 + dy };
      case "path":
        return { ...primitive, d: translatePath(primitive.d, dx, dy) };
    }
  };
  return { ...group, primitives: group.primitives.map(move), ...(group.groups ? { groups: group.groups.map((inner) => translated(inner, dx, dy)) } : {}) };
}

/** Moves an absolute M/L/Z path — the only kind this module writes. */
function translatePath(d: string, dx: number, dy: number): string {
  return d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${+(Number(x) + dx).toFixed(2)},${+(Number(y) + dy).toFixed(2)}`);
}

/**
 * The whole timeline as one figure: title, label column, header, rows, and the key
 * under them. What the writer saves and the reader's download hands over.
 */
export function timelineFigure(data: StructuredTimelineData, options: TimelineFigureOptions): Figure & { overWidth: boolean } {
  const parts = timelineFigureParts(data, { ...options, selection: undefined });
  const comparedTo = options.comparison === "new" ? undefined : data.comparedTo;
  const top = MARGIN + (data.title ? TITLE_HEIGHT : 0) + (comparedTo ? 18 : 0);
  const left = MARGIN;
  const plotX = left + parts.labelWidth;
  const groups: FigureGroup[] = [];
  if (data.title) {
    groups.push({
      id: "title",
      primitives: [{ shape: "text", x: left, y: MARGIN + 15, text: data.title, fontSize: 13, fontWeight: 600, fill: INK, fontFamily: FIGURE_FONT }],
    });
  }
  if (comparedTo) {
    const by = MARGIN + (data.title ? TITLE_HEIGHT : 0) + 12;
    groups.push({
      id: "compared-to",
      testId: "timeline-compared-to",
      primitives: [
        {
          shape: "text",
          x: left,
          y: by,
          text: `Compared with ${comparedTo.label}${comparedTo.date ? ` (${writtenDate(dayNumber(comparedTo.date) ?? 0)})` : ""}`,
          fontSize: 11,
          fill: MUTED,
          fontFamily: FIGURE_FONT,
        },
      ],
    });
  }
  groups.push(...parts.header.map((group) => translated(group, plotX, top)));
  groups.push(...parts.rows.map((group) => translated(group, plotX, top + TIMELINE_HEADER_HEIGHT)));
  groups.push(...parts.labels.map((group) => translated(group, left, top)));
  const legendTop = top + TIMELINE_HEADER_HEIGHT + parts.layout.height + 10;
  groups.push(...parts.legend.groups.map((group) => translated(group, left, legendTop)));
  const width = Math.ceil(plotX + parts.layout.width + MARGIN);
  const height = Math.ceil(legendTop + parts.legend.height + MARGIN);
  return {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    ariaLabel: `Timeline${data.title ? ` "${data.title}"` : ""} from ${data.time.start} to ${data.time.end}`,
    background: "#ffffff",
    markers: parts.markers,
    groups,
    overWidth: parts.overWidth,
  };
}
