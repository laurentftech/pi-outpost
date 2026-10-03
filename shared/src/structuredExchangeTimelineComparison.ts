/**
 * Two plans compared: what moved, what is new, what was dropped.
 *
 * The comparison is computed here, once, so nobody computes a slip by hand — not the
 * agent, which would get a few wrong, and not the reader, which would have to be
 * given two files. Its result is an ordinary timeline that says what it is compared
 * with, so a review report carrying it stands on its own.
 *
 * Pairing is by identifier and nothing else. Two items with the same label are not
 * the same item, and the third task is not the third task of another plan; a guess
 * presented in a review as a slip is worse than an item left uncompared, which is
 * what an item without an `id` is — and the result says how many there were.
 */
import type {
  StructuredTimelineData,
  StructuredTimelineItem,
  StructuredTimelineRow,
  StructuredTimelineTask,
} from "./structuredExchange.ts";
import { calendarDate, dayNumber, daysOf } from "./structuredExchangeTimeline.ts";
export { describeDays, itemChanged, shiftOf, shiftText, taskChanged } from "./structuredExchangeTimeline.ts";

export interface TimelineComparison {
  data: StructuredTimelineData;
  /** Items that carry no `id`, in each plan: they could not be paired, and carry no change. */
  uncompared: { previous: number; current: number };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function sameDates(a: StructuredTimelineItem, b: StructuredTimelineItem): boolean {
  const left = daysOf(a.type === "activity" ? { start: a.start, end: a.end } : { date: a.date });
  const right = daysOf(b.type === "activity" ? { start: b.start, end: b.end } : { date: b.date });
  return left.start === right.start && left.end === right.end;
}

/**
 * The current plan, compared with the previous one.
 *
 * Neither input is touched: the result is a new document. Its range covers both
 * plans, so a phase that slipped out of the old window still has its old place drawn.
 */
export function compareTimelines(
  previous: StructuredTimelineData,
  current: StructuredTimelineData,
  label?: string,
): TimelineComparison {
  const tasksOf = (data: StructuredTimelineData) =>
    data.rows.filter((row): row is StructuredTimelineTask => row.type === "task");
  const previousTasks = new Map(tasksOf(previous).map((task) => [task.id, task]));
  const currentTasks = new Map(tasksOf(current).map((task) => [task.id, task]));
  const previousItems = new Map<string, { item: StructuredTimelineItem; task: string }>();
  let uncomparedPrevious = 0;
  for (const task of tasksOf(previous)) {
    for (const item of task.items) {
      if (item.id === undefined) uncomparedPrevious += 1;
      else previousItems.set(item.id, { item, task: task.id });
    }
  }
  const currentItemIds = new Set(tasksOf(current).flatMap((task) => task.items.flatMap((item) => (item.id === undefined ? [] : [item.id]))));

  let uncomparedCurrent = 0;
  const rows: StructuredTimelineRow[] = current.rows.map((row) => {
    if (row.type !== "task") return clone(row);
    const task = clone(row);
    if (!previousTasks.has(task.id)) task.role = "added";
    task.items = task.items.map((item) => {
      if (item.id === undefined) {
        uncomparedCurrent += 1;
        return item;
      }
      const before = previousItems.get(item.id);
      if (before === undefined) return task.role === "added" ? item : { ...item, role: "added" };
      // An identifier that changed type names a different thing now: it cannot carry
      // the previous dates of an activity as a milestone, so it is shown as new.
      if (sameDates(item, before.item) && item.type === before.item.type) return item;
      if (item.type === "activity" && before.item.type === "activity") {
        return { ...item, previous: { start: before.item.start, end: before.item.end } };
      }
      if (item.type === "milestone" && before.item.type === "milestone") return { ...item, previous: { date: before.item.date } };
      return { ...item, role: "added" as const };
    });
    return task;
  });

  // Dropped items go back under their task when it still exists; the rest travel with
  // their dropped task.
  const removedUnder = new Map<string, StructuredTimelineItem[]>();
  for (const [id, { item, task }] of previousItems) {
    if (currentItemIds.has(id)) continue;
    if (currentTasks.has(task)) removedUnder.set(task, [...(removedUnder.get(task) ?? []), { ...clone(item), role: "removed" }]);
  }
  for (const row of rows) {
    if (row.type === "task" && removedUnder.has(row.id)) row.items.push(...removedUnder.get(row.id)!);
  }

  // A dropped task keeps its place: after the previous plan's nearest earlier task that
  // still exists, else at the top.
  const previousOrder = tasksOf(previous);
  previousOrder.forEach((task, index) => {
    if (currentTasks.has(task.id)) return;
    const removed: StructuredTimelineTask = {
      ...clone(task),
      role: "removed",
      items: task.items.map((item) => {
        const copy = clone(item);
        delete copy.role;
        delete copy.previous;
        return copy;
      }),
    };
    let after = -1;
    for (let back = index - 1; back >= 0 && after === -1; back--) {
      const anchor = previousOrder[back].id;
      after = rows.findIndex((row) => row.type === "task" && row.id === anchor);
    }
    rows.splice(after + 1, 0, removed);
  });

  const start = Math.min(dayNumber(previous.time.start) ?? 0, dayNumber(current.time.start) ?? 0);
  const end = Math.max(dayNumber(previous.time.end) ?? 0, dayNumber(current.time.end) ?? 0);
  const data: StructuredTimelineData = {
    ...(current.title === undefined ? {} : { title: current.title }),
    comparedTo: { label: label ?? previous.title ?? "previous plan" },
    time: { start: calendarDate(start), end: calendarDate(end), scale: current.time.scale },
    rows,
    ...(current.dependencies === undefined ? {} : { dependencies: clone(current.dependencies) }),
  };
  return { data, uncompared: { previous: uncomparedPrevious, current: uncomparedCurrent } };
}

/** The plan without its comparison: what "new version only" draws. Removed things are gone. */
export function withoutComparison(data: StructuredTimelineData): StructuredTimelineData {
  const plain = clone(data);
  delete plain.comparedTo;
  plain.rows = plain.rows
    .filter((row) => row.type !== "task" || row.role !== "removed")
    .map((row) => {
      if (row.type !== "task") return row;
      delete row.role;
      row.items = row.items
        .filter((item) => item.role !== "removed")
        .map((item) => {
          delete item.role;
          delete item.previous;
          return item;
        });
      return row;
    });
  return plain;
}
