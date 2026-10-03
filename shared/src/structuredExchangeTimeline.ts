/**
 * The timeline's arithmetic: calendar days, what a dependency links, and whether
 * the dates honour it.
 *
 * Everything here works in day numbers — days since 1970-01-01, read from the
 * `YYYY-MM-DD` the document carries and never through a local `Date`. A plan says
 * "1 March", not "1 March at midnight in Paris", and reading it as an instant is
 * how a bar moves by a day for a reader in another time zone.
 *
 * Shared by validation, the reader's layout and the digest the agent is sent, so
 * that "this dependency is not satisfied" means the same thing in all three.
 */
import { CHAR_WIDTH } from "./structuredExchangeText.ts";
import type {
  StructuredDependencyType,
  StructuredTimelineData,
  StructuredTimelineDependency,
  StructuredTimelineItem,
  StructuredTimelineTask,
} from "./structuredExchange.ts";

const MS_PER_DAY = 86_400_000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The day number of a calendar date, or undefined when it names no real day.
 *
 * The schema's pattern admits `2027-02-30`; only the calendar knows February has
 * no thirtieth, and `Date.UTC` would quietly roll it over to 2 March.
 */
export function dayNumber(date: string): number | undefined {
  const match = CALENDAR_DATE.exec(date);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const instant = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` maps years 0–99 onto 1900–1999; set the full year explicitly.
  instant.setUTCFullYear(year, month - 1, day);
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) {
    return undefined;
  }
  return Math.round(instant.getTime() / MS_PER_DAY);
}

/** The calendar date of a day number, `YYYY-MM-DD`. */
export function calendarDate(day: number): string {
  const instant = new Date(day * MS_PER_DAY);
  const year = String(instant.getUTCFullYear()).padStart(4, "0");
  const month = String(instant.getUTCMonth() + 1).padStart(2, "0");
  const date = String(instant.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

/**
 * Today, as the reader's own calendar has it.
 *
 * Local on purpose, and the only local reading in this module: "today" is the day
 * on the reader's wall, and a reader in Nouméa at 08:00 is a day ahead of UTC.
 */
export function localToday(now: Date = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);
}

/** The first and last day an item occupies. A milestone occupies one. */
export function itemDays(item: StructuredTimelineItem): { start: number; end: number } | undefined {
  const start = dayNumber(item.type === "activity" ? item.start : item.date);
  const end = dayNumber(item.type === "activity" ? item.end : item.date);
  return start === undefined || end === undefined ? undefined : { start, end };
}

/** What a dependency endpoint names, located in the document. */
export interface TimelineEndpoint {
  id: string;
  type: "task" | "activity" | "milestone";
  /** Index of the row holding it: the task itself, or the task the item belongs to. */
  row: number;
  /** Index of the item within its task; absent for a task. */
  item?: number;
  /** First and last day; a task spans its items. Absent for a task with no items. */
  days?: { start: number; end: number };
}

/** Every task and identified item, by identifier. The first declaration wins; duplicates are refused elsewhere. */
export function timelineEndpoints(data: StructuredTimelineData): Map<string, TimelineEndpoint> {
  const endpoints = new Map<string, TimelineEndpoint>();
  data.rows.forEach((row, rowIndex) => {
    if (row.type !== "task") return;
    if (!endpoints.has(row.id)) endpoints.set(row.id, { id: row.id, type: "task", row: rowIndex, days: taskDays(row) });
    row.items.forEach((item, itemIndex) => {
      if (item.id === undefined || endpoints.has(item.id)) return;
      endpoints.set(item.id, { id: item.id, type: item.type, row: rowIndex, item: itemIndex, days: itemDays(item) });
    });
  });
  return endpoints;
}

/** A task's span: from its earliest item to its latest. */
export function taskDays(task: StructuredTimelineTask): { start: number; end: number } | undefined {
  let span: { start: number; end: number } | undefined;
  for (const item of task.items) {
    const days = itemDays(item);
    if (days === undefined) continue;
    span = span === undefined ? { ...days } : { start: Math.min(span.start, days.start), end: Math.max(span.end, days.end) };
  }
  return span;
}

/** The type a dependency declares, or the one its absence means. */
export function dependencyType(dependency: StructuredTimelineDependency): StructuredDependencyType {
  return dependency.type ?? "finish-to-start";
}

/** Which end of each endpoint a dependency type links. */
export function linkedEnds(type: StructuredDependencyType): { from: "start" | "end"; to: "start" | "end" } {
  return {
    from: type.startsWith("finish") ? "end" : "start",
    to: type.endsWith("finish") ? "end" : "start",
  };
}

/**
 * Whether the dates honour a dependency.
 *
 * Not satisfied only when the successor's linked day is strictly before the
 * predecessor's: the same day counts, so "review on 1 March, next phase from
 * 1 March" reads as the plan meant it. Undefined when an end cannot be resolved.
 */
export function dependencySatisfied(
  dependency: StructuredTimelineDependency,
  endpoints: Map<string, TimelineEndpoint>,
): boolean | undefined {
  const from = endpoints.get(dependency.from)?.days;
  const to = endpoints.get(dependency.to)?.days;
  if (from === undefined || to === undefined) return undefined;
  const ends = linkedEnds(dependencyType(dependency));
  return to[ends.to] >= from[ends.from];
}

/* ── Layout ─────────────────────────────────────────────────────────────────
 *
 * Dates to coordinates, and nothing else: a pure function of the document, the
 * reader's today and a handful of constants, so the picture can be asserted on
 * without a browser and comes out the same under Node as in one.
 */

/** Horizontal scale of the month view: about 120 pixels a month. */
export const TIMELINE_PX_PER_DAY = 4;
/** Where "Today" is written: above the years, so it never covers a date. */
export const TIMELINE_TODAY_BAND = 18;
export const TIMELINE_YEAR_BAND = 20;
export const TIMELINE_MONTH_BAND = 20;
export const TIMELINE_HEADER_HEIGHT = TIMELINE_TODAY_BAND + TIMELINE_YEAR_BAND + TIMELINE_MONTH_BAND;
export const TIMELINE_LANE_HEIGHT = 24;
export const TIMELINE_ROW_PADDING = 4;
export const TIMELINE_BAR_HEIGHT = 12;
export const TIMELINE_STAR_RADIUS = 7;
export const TIMELINE_SEPARATOR_HEIGHT = 26;
export const TIMELINE_ANONYMOUS_SEPARATOR_HEIGHT = 10;
/** Space between a glyph and the label beside it, and inside a bar around its label. */
export const TIMELINE_LABEL_GAP = 4;
export const TIMELINE_LABEL_PADDING = 6;
/** How far an arrow leaves its anchor before it turns. */
export const TIMELINE_ARROW_STUB = 8;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface TimelineBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimelineHeaderBand {
  label: string;
  x: number;
  width: number;
}

/** A month band, with the calendar month and year it stands for. */
export interface TimelineMonthBand extends TimelineHeaderBand {
  year: number;
  /** Zero-based, January is 0. */
  month: number;
}

export interface TimelineLabel extends TimelineBox {
  text: string;
  /** Inside the bar it belongs to, or beside its glyph. */
  inside: boolean;
}

export interface TimelineItemLayout {
  /** Position in the document, which is the item's identity for selection. */
  row: number;
  item: number;
  type: "activity" | "milestone";
  lane: number;
  /** The bar, or the star's bounding square. */
  glyph: TimelineBox;
  /** The star's centre; undefined for a bar. */
  center?: { x: number; y: number };
  label?: TimelineLabel;
  kind?: string;
  days: { start: number; end: number };
}

export type TimelineRowLayout =
  | { type: "task"; row: number; y: number; height: number; lanes: number; label: string; id: string }
  | { type: "separator"; row: number; y: number; height: number; label?: string }
  /** A compacted section: the separator at `row` and the tasks under it, on one row. */
  | { type: "section"; row: number; y: number; height: number; lanes: number; label?: string; tasks: string[] };

export interface TimelineDependencyLayout {
  index: number;
  from: string;
  to: string;
  type: StructuredDependencyType;
  satisfied: boolean;
  /** An orthogonal polyline, from the predecessor's anchor to the successor's. */
  points: { x: number; y: number }[];
}

export interface TimelineLayout {
  width: number;
  /** Height of the rows area, below the header. */
  height: number;
  start: number;
  end: number;
  years: TimelineHeaderBand[];
  months: TimelineMonthBand[];
  /** Month boundaries inside the range, for reference lines. */
  monthLines: number[];
  rows: TimelineRowLayout[];
  items: TimelineItemLayout[];
  dependencies: TimelineDependencyLayout[];
  /** Where today is: a position inside the range, or which side of it. */
  today: { x: number; day: number } | { outside: "before" | "after"; day: number };
  /** Item kinds in order of first appearance, for the legend and the tints. */
  kinds: string[];
}

/** What an item is annotated with: its label, or a milestone's kind. Never invented. */
export function annotationOf(item: StructuredTimelineItem): string | undefined {
  if (item.label !== undefined && item.label !== "") return item.label;
  if (item.type === "milestone" && item.kind !== undefined && item.kind !== "") return item.kind;
  return undefined;
}

/** Width of a line of label text, by the same count every other figure uses. */
function textWidth(text: string): number {
  return text.length * CHAR_WIDTH;
}

/** The first day of each month that starts after `start` and on or before `end`. */
function monthStarts(start: number, end: number): { day: number; year: number; month: number }[] {
  const first = new Date(start * MS_PER_DAY);
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  const starts: { day: number; year: number; month: number }[] = [];
  for (;;) {
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
    const day = monthDay(year, month);
    if (day > end) return starts;
    starts.push({ day, year, month });
  }
}

function monthDay(year: number, month: number): number {
  const instant = new Date(0);
  instant.setUTCFullYear(year, month, 1);
  return Math.round(instant.getTime() / MS_PER_DAY);
}

type Occupant = { kind: "bar" | "star" | "label"; x0: number; x1: number };

/**
 * Whether two things may share a lane where they overlap.
 *
 * A star on a bar is the Gantt idiom — the review at the end of the phase — and
 * stays. Everything else that overlaps would hide something: a label over anything,
 * two bars, two stars.
 */
function compatible(a: Occupant["kind"], b: Occupant["kind"]): boolean {
  return (a === "bar" && b === "star") || (a === "star" && b === "bar");
}

function overlaps(a: Occupant, b: Occupant): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1;
}

/** How the reader asked for the timeline to be drawn. Never part of the document. */
export interface TimelineLayoutOptions {
  /** One row per section — a separator and the tasks under it — instead of one per task. */
  compact?: boolean;
}

export function layoutTimeline(data: StructuredTimelineData, today: number, options: TimelineLayoutOptions = {}): TimelineLayout {
  const start = dayNumber(data.time.start) ?? 0;
  const end = dayNumber(data.time.end) ?? start;
  const px = TIMELINE_PX_PER_DAY;
  const width = (end - start + 1) * px;
  const xOf = (day: number) => (day - start) * px;

  // Header: year and month bands, clipped to the range.
  const boundaries = monthStarts(start, end);
  const firstDate = new Date(start * MS_PER_DAY);
  const segments = [
    { day: start, year: firstDate.getUTCFullYear(), month: firstDate.getUTCMonth() },
    ...boundaries,
  ];
  const months: TimelineMonthBand[] = segments.map((segment, index) => {
    const next = index + 1 < segments.length ? segments[index + 1].day : end + 1;
    return {
      label: MONTHS[segment.month],
      x: xOf(segment.day),
      width: (next - segment.day) * px,
      year: segment.year,
      month: segment.month,
    };
  });
  const years: TimelineHeaderBand[] = [];
  segments.forEach((segment, index) => {
    const band = months[index];
    const last = years[years.length - 1];
    if (last !== undefined && last.label === String(segment.year)) last.width += band.width;
    else years.push({ label: String(segment.year), x: band.x, width: band.width });
  });

  // Rows, and the items on them, lane by lane.
  const rows: TimelineRowLayout[] = [];
  const items: TimelineItemLayout[] = [];
  let y = 0;

  /**
   * Places a set of items on lanes starting at `top`, and returns how many lanes
   * they took. Activities first, then milestones, each in date order: a milestone
   * sits on the line of the work it closes when there is room, and otherwise below
   * it — never above. Placed purely by date, a review falling before the next phase
   * took the top line and pushed that phase underneath it, which reads upside down.
   */
  const place = (entries: { row: number; index: number; item: StructuredTimelineItem; text?: string }[], top: number) => {
    const lanes: Occupant[][] = [];
    const placed: Omit<TimelineItemLayout, "glyph" | "center" | "label">[] = [];
    const geometry: { label?: Omit<TimelineLabel, "y" | "height">; x0: number; x1: number; cx?: number }[] = [];
    const order = entries
      .map((entry) => ({ ...entry, days: itemDays(entry.item) }))
      .filter((entry): entry is typeof entry & { days: { start: number; end: number } } => entry.days !== undefined)
      .sort(
        (a, b) =>
          Number(a.item.type === "milestone") - Number(b.item.type === "milestone") ||
          a.days.start - b.days.start ||
          a.row - b.row ||
          a.index - b.index,
      );
    for (const { item, index, row, days, text } of order) {
      const occupants: Occupant[] = [];
      let label: Omit<TimelineLabel, "y" | "height"> | undefined;
      let x0: number;
      let x1: number;
      let cx: number | undefined;
      if (item.type === "activity") {
        x0 = xOf(days.start);
        x1 = xOf(days.end + 1);
        occupants.push({ kind: "bar", x0, x1 });
        if (text !== undefined) {
          const textW = textWidth(text);
          if (textW + 2 * TIMELINE_LABEL_PADDING <= x1 - x0) {
            label = { text, inside: true, x: x0 + TIMELINE_LABEL_PADDING, width: textW };
          } else {
            label = besideLabel(text, x0, x1, width);
          }
          // Inside its own bar or beside it, text a later glyph must not land on.
          occupants.push({ kind: "label", x0: label.x, x1: label.x + label.width });
        }
      } else {
        cx = xOf(days.start) + px / 2;
        x0 = cx - TIMELINE_STAR_RADIUS;
        x1 = cx + TIMELINE_STAR_RADIUS;
        occupants.push({ kind: "star", x0, x1 });
        if (text !== undefined) {
          label = besideLabel(text, x0, x1, width);
          occupants.push({ kind: "label", x0: label.x, x1: label.x + label.width });
        }
      }
      let lane = lanes.findIndex((taken) =>
        occupants.every((mine) => taken.every((theirs) => compatible(mine.kind, theirs.kind) || !overlaps(mine, theirs))),
      );
      if (lane === -1) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane].push(...occupants);
      placed.push({ row, item: index, type: item.type, lane, days, ...(item.kind ? { kind: item.kind } : {}) });
      geometry.push({ label, x0, x1, cx });
    }
    placed.forEach((entry, position) => {
      const shape = geometry[position];
      const middle = top + TIMELINE_ROW_PADDING + entry.lane * TIMELINE_LANE_HEIGHT + TIMELINE_LANE_HEIGHT / 2;
      const glyph =
        entry.type === "activity"
          ? { x: shape.x0, y: middle - TIMELINE_BAR_HEIGHT / 2, width: shape.x1 - shape.x0, height: TIMELINE_BAR_HEIGHT }
          : { x: shape.x0, y: middle - TIMELINE_STAR_RADIUS, width: 2 * TIMELINE_STAR_RADIUS, height: 2 * TIMELINE_STAR_RADIUS };
      items.push({
        ...entry,
        glyph,
        ...(shape.cx !== undefined ? { center: { x: shape.cx, y: middle } } : {}),
        ...(shape.label !== undefined ? { label: { ...shape.label, y: middle - 8, height: 16 } } : {}),
      });
    });
    return Math.max(1, lanes.length);
  };
  const heightOf = (lanes: number) => lanes * TIMELINE_LANE_HEIGHT + 2 * TIMELINE_ROW_PADDING;

  const taskRow = (task: StructuredTimelineTask, rowIndex: number) => {
    const lanes = place(
      task.items.map((item, index) => ({ row: rowIndex, index, item, text: annotationOf(item) })),
      y,
    );
    const height = heightOf(lanes);
    rows.push({ type: "task", row: rowIndex, y, height, lanes, label: task.label, id: task.id });
    y += height;
  };

  // Compact: a separator and the tasks under it share one row, titled by the
  // separator. Presentation only — each item keeps its task, and the tasks before
  // the first separator, having no section, keep their rows. An unlabelled activity
  // takes its task's name there, since the row that named it is gone.
  let section: { row: number; label?: string; tasks: { task: StructuredTimelineTask; row: number }[] } | undefined;
  const flush = () => {
    if (section === undefined) return;
    if (section.tasks.length === 0) {
      const height = section.label ? TIMELINE_SEPARATOR_HEIGHT : TIMELINE_ANONYMOUS_SEPARATOR_HEIGHT;
      rows.push({ type: "separator", row: section.row, y, height, ...(section.label ? { label: section.label } : {}) });
      y += height;
    } else {
      const lanes = place(
        section.tasks.flatMap(({ task, row }) =>
          task.items.map((item, index) => ({
            row,
            index,
            item,
            text: annotationOf(item) ?? (item.type === "activity" ? task.label : undefined),
          })),
        ),
        y,
      );
      const height = heightOf(lanes);
      rows.push({
        type: "section",
        row: section.row,
        y,
        height,
        lanes,
        ...(section.label ? { label: section.label } : {}),
        tasks: section.tasks.map(({ task }) => task.id),
      });
      y += height;
    }
    section = undefined;
  };

  data.rows.forEach((row, rowIndex) => {
    if (row.type === "separator") {
      if (options.compact) {
        flush();
        section = { row: rowIndex, ...(row.label ? { label: row.label } : {}), tasks: [] };
        return;
      }
      const height = row.label ? TIMELINE_SEPARATOR_HEIGHT : TIMELINE_ANONYMOUS_SEPARATOR_HEIGHT;
      rows.push({ type: "separator", row: rowIndex, y, height, ...(row.label ? { label: row.label } : {}) });
      y += height;
      return;
    }
    if (section !== undefined) section.tasks.push({ task: row, row: rowIndex });
    else taskRow(row, rowIndex);
  });
  flush();

  const kinds: string[] = [];
  for (const row of data.rows) {
    if (row.type !== "task") continue;
    for (const item of row.items) if (item.kind && !kinds.includes(item.kind)) kinds.push(item.kind);
  }

  return {
    width,
    height: y,
    start,
    end,
    years,
    months,
    monthLines: boundaries.map((boundary) => xOf(boundary.day)),
    rows,
    items,
    dependencies: layoutDependencies(data, rows, items, xOf),
    today:
      today < start
        ? { outside: "before", day: today }
        : today > end
          ? { outside: "after", day: today }
          : { x: xOf(today) + px / 2, day: today },
    kinds,
  };
}

/** A label to the right of its glyph, or to its left when the right would run off the end. */
function besideLabel(text: string, x0: number, x1: number, width: number): Omit<TimelineLabel, "y" | "height"> {
  const textW = textWidth(text);
  const right = x1 + TIMELINE_LABEL_GAP;
  if (right + textW <= width || x0 - TIMELINE_LABEL_GAP - textW < 0) {
    return { text, inside: false, x: right, width: textW };
  }
  return { text, inside: false, x: x0 - TIMELINE_LABEL_GAP - textW, width: textW };
}

function layoutDependencies(
  data: StructuredTimelineData,
  rows: TimelineRowLayout[],
  items: TimelineItemLayout[],
  xOf: (day: number) => number,
): TimelineDependencyLayout[] {
  const endpoints = timelineEndpoints(data);
  const laid = new Map(items.map((item) => [`${item.row}:${item.item}`, item]));
  const rowAt = new Map(rows.map((row) => [row.row, row]));

  const anchor = (id: string, end: "start" | "end"): { x: number; y: number } | undefined => {
    const endpoint = endpoints.get(id);
    if (endpoint?.days === undefined) return undefined;
    if (endpoint.item !== undefined) {
      const item = laid.get(`${endpoint.row}:${endpoint.item}`);
      if (item === undefined) return undefined;
      const middle = item.glyph.y + item.glyph.height / 2;
      // A star is met at its edge, so the arrowhead is not hidden under it.
      if (item.center !== undefined) {
        return { x: item.center.x + (end === "start" ? -TIMELINE_STAR_RADIUS : TIMELINE_STAR_RADIUS), y: middle };
      }
      return { x: end === "start" ? item.glyph.x : item.glyph.x + item.glyph.width, y: middle };
    }
    // A task stands for its span, on its first lane — or, compacted into a section,
    // on the lane of its own first item, since it has no row of its own.
    const x = end === "start" ? xOf(endpoint.days.start) : xOf(endpoint.days.end + 1);
    const row = rowAt.get(endpoint.row);
    if (row !== undefined && row.type === "task") return { x, y: row.y + TIMELINE_ROW_PADDING + TIMELINE_LANE_HEIGHT / 2 };
    const own = items
      .filter((item) => item.row === endpoint.row)
      .sort((a, b) => (end === "start" ? a.glyph.x - b.glyph.x : b.glyph.x + b.glyph.width - (a.glyph.x + a.glyph.width)));
    if (own.length === 0) return undefined;
    return { x, y: own[0].glyph.y + own[0].glyph.height / 2 };
  };

  const laidOut: TimelineDependencyLayout[] = [];
  (data.dependencies ?? []).forEach((dependency, index) => {
    const type = dependencyType(dependency);
    const ends = linkedEnds(type);
    const from = anchor(dependency.from, ends.from);
    const to = anchor(dependency.to, ends.to);
    const satisfied = dependencySatisfied(dependency, endpoints);
    if (from === undefined || to === undefined || satisfied === undefined) return;
    const leave = { x: from.x + (ends.from === "end" ? TIMELINE_ARROW_STUB : -TIMELINE_ARROW_STUB), y: from.y };
    const enter = { x: to.x + (ends.to === "start" ? -TIMELINE_ARROW_STUB : TIMELINE_ARROW_STUB), y: to.y };
    // Neighbours on one lane, the successor ahead: a straight line. Routed like the
    // rest it would loop under the bar and back, for a link the eye reads at once.
    // A star on the very day after a bar overlaps its end by a few pixels; still neighbours.
    if (from.y === to.y && ends.from === "end" && ends.to === "start" && to.x >= from.x - 2 * TIMELINE_STAR_RADIUS) {
      laidOut.push({ index, from: dependency.from, to: dependency.to, type, satisfied, points: [from, to] });
      return;
    }
    // The horizontal run sits on the edge of the successor's lane, between lanes,
    // rather than along the lane's middle where its bars and labels are.
    const half = TIMELINE_LANE_HEIGHT / 2;
    const runY = to.y > from.y ? to.y - half : to.y < from.y ? to.y + half : to.y + half;
    laidOut.push({
      index,
      from: dependency.from,
      to: dependency.to,
      type,
      satisfied,
      points: [from, leave, { x: leave.x, y: runY }, { x: enter.x, y: runY }, enter, to],
    });
  });
  return laidOut;
}

/** The longest row title, as a width for the label column. */
export function timelineLabelColumnWidth(data: StructuredTimelineData): number {
  const longest = data.rows.reduce((widest, row) => Math.max(widest, (row.label ?? "").length), 0);
  return Math.min(Math.max(longest * CHAR_WIDTH + 24, 120), 280);
}

/* ── Words ──────────────────────────────────────────────────────────────────
 *
 * The timeline as text: what the reader's text equivalent says, and what the
 * agent is told about the timeline it presented. Both name the same facts the
 * picture shows, from the same resolution, so neither can disagree with it.
 */

/** How an endpoint is named to a reader: its label and identifier, or the identifier alone. */
export function endpointName(data: StructuredTimelineData, id: string): string {
  for (const row of data.rows) {
    if (row.type !== "task") continue;
    if (row.id === id) return `"${row.label}" (${id})`;
    const item = row.items.find((candidate) => candidate.id === id);
    if (item !== undefined) {
      const text = annotationOf(item);
      return text === undefined ? id : `"${text}" (${id})`;
    }
  }
  return id;
}

/** One dependency, in words. */
export function dependencyText(
  data: StructuredTimelineData,
  dependency: StructuredTimelineDependency,
  satisfied: boolean | undefined,
): string {
  const verdict = satisfied === false ? " — not satisfied by the dates" : "";
  return `${endpointName(data, dependency.to)} waits on ${endpointName(data, dependency.from)} (${dependencyType(dependency)})${verdict}`;
}

/** Counts and the dependencies the dates do not honour, for the agent's digest. */
export function timelineFacts(data: StructuredTimelineData): {
  tasks: number;
  activities: number;
  milestones: number;
  dependencies: number;
  unsatisfied: StructuredTimelineDependency[];
} {
  let tasks = 0;
  let activities = 0;
  let milestones = 0;
  for (const row of data.rows) {
    if (row.type !== "task") continue;
    tasks += 1;
    for (const item of row.items) {
      if (item.type === "activity") activities += 1;
      else milestones += 1;
    }
  }
  const endpoints = timelineEndpoints(data);
  const dependencies = data.dependencies ?? [];
  return {
    tasks,
    activities,
    milestones,
    dependencies: dependencies.length,
    unsatisfied: dependencies.filter((dependency) => dependencySatisfied(dependency, endpoints) === false),
  };
}

/**
 * The textual equivalent: every row in order, every item with its type, dates,
 * label and kind, then every dependency with its type and whether the dates honour
 * it. Today is not part of it — it is not in the document.
 */
export function timelineTextLines(data: StructuredTimelineData): string[] {
  const lines: string[] = [];
  if (data.title !== undefined && data.title !== "") lines.push(data.title);
  lines.push(`From ${data.time.start} to ${data.time.end}, by ${data.time.scale}`);
  for (const row of data.rows) {
    lines.push("");
    if (row.type === "separator") {
      lines.push(row.label ? `— ${row.label} —` : "———");
      continue;
    }
    lines.push(`${row.label} [${row.id}]${row.items.length === 0 ? " — no items" : ""}`);
    for (const item of row.items) {
      const when = item.type === "activity" ? `${item.start} to ${item.end}` : item.date;
      const label = item.label === undefined ? "" : `: ${item.label}`;
      const kind = item.kind === undefined ? "" : ` [${item.kind}]`;
      const id = item.id === undefined ? "" : ` (${item.id})`;
      lines.push(`  ${item.type} ${when}${label}${kind}${id}`);
    }
  }
  const dependencies = data.dependencies ?? [];
  if (dependencies.length > 0) {
    const endpoints = timelineEndpoints(data);
    lines.push("", "Dependencies");
    for (const dependency of dependencies) {
      lines.push(`  ${dependencyText(data, dependency, dependencySatisfied(dependency, endpoints))}`);
    }
  }
  return lines;
}
