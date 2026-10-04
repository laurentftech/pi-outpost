/**
 * Targeted changes to a planning.
 *
 * An update is a list of small operations naming what they change by identifier, so a
 * model moving one milestone says so, rather than re-emitting the whole document and
 * drifting on everything it did not mean to touch. Operations apply in order to a
 * copy; the first that cannot apply stops the update, and nothing is stored — the
 * caller is told which one and why. What the operations produce is then judged as a
 * creation is, so an update cannot store what a creation would refuse.
 *
 * Separators carry no identifier in the contract, so they are addressed by their row
 * position, as get_planning shows the rows.
 */
import type {
  StructuredTimelineData,
  StructuredTimelineDependency,
  StructuredTimelineItem,
  StructuredTimelinePeriod,
  StructuredTimelineReference,
  StructuredTimelineRow,
  StructuredTimelineTask,
} from "@pi-outpost/shared/structured-exchange";
import { declaredIdentifiers, nameEveryItem, type TimelineDocument } from "./planning.ts";

type Position = { before: string } | { after: string } | { index: number };

export type PlanningOperation =
  | { op: "set_title"; title: string | null }
  | { op: "set_time"; start?: string; end?: string; scale?: string }
  | { op: "set_periods"; periods: StructuredTimelinePeriod[] }
  | { op: "set_references"; references: StructuredTimelineReference[] }
  | ({ op: "add_task"; task: StructuredTimelineTask } & Partial<Position>)
  | { op: "change_task"; id: string; label?: string; new_id?: string }
  | ({ op: "move_task"; id: string } & Position)
  | { op: "remove_task"; id: string }
  | { op: "add_item"; task: string; item: StructuredTimelineItem }
  | { op: "change_item"; id: string; changes: Partial<StructuredTimelineItem> & { task?: string } }
  | { op: "remove_item"; id: string }
  | ({ op: "add_separator"; label?: string } & Partial<Position>)
  | { op: "remove_separator"; row: number }
  | { op: "add_dependency"; dependency: StructuredTimelineDependency }
  | { op: "remove_dependency"; from: string; to: string };

export const OPERATION_NAMES = [
  "set_title",
  "set_time",
  "set_periods",
  "set_references",
  "add_task",
  "change_task",
  "move_task",
  "remove_task",
  "add_item",
  "change_item",
  "remove_item",
  "add_separator",
  "remove_separator",
  "add_dependency",
  "remove_dependency",
] as const;

/** Why one operation could not apply. */
export class OperationError extends Error {}

function taskIndex(rows: StructuredTimelineRow[], id: string): number {
  const index = rows.findIndex((row) => row.type === "task" && row.id === id);
  if (index < 0) throw new OperationError(`no task "${id}"`);
  return index;
}

function findItem(rows: StructuredTimelineRow[], id: string): { task: StructuredTimelineTask; index: number } {
  for (const row of rows) {
    if (row.type !== "task") continue;
    const index = row.items.findIndex((item) => item.id === id);
    if (index >= 0) return { task: row, index };
  }
  throw new OperationError(`no item "${id}"`);
}

function insertionIndex(rows: StructuredTimelineRow[], position: Partial<Position>): number {
  if ("before" in position && position.before !== undefined) return taskIndex(rows, position.before);
  if ("after" in position && position.after !== undefined) return taskIndex(rows, position.after) + 1;
  if ("index" in position && position.index !== undefined) {
    if (!Number.isInteger(position.index) || position.index < 0 || position.index > rows.length) {
      throw new OperationError(`index ${position.index} is outside the ${rows.length} rows`);
    }
    return position.index;
  }
  return rows.length;
}

function requireFresh(data: StructuredTimelineData, id: unknown, what: string): void {
  if (typeof id !== "string" || id.length === 0) throw new OperationError(`${what} needs an id`);
  if (declaredIdentifiers(data).has(id)) throw new OperationError(`"${id}" is already used in this planning`);
}

/** Every dependency touching `id` goes with it: a link to nothing is not a link. */
function dropDependenciesOn(data: StructuredTimelineData, ids: Set<string>): void {
  if (!data.dependencies) return;
  data.dependencies = data.dependencies.filter((link) => !ids.has(link.from) && !ids.has(link.to));
  if (data.dependencies.length === 0) delete data.dependencies;
}

function rename(data: StructuredTimelineData, from: string, to: string): void {
  for (const link of data.dependencies ?? []) {
    if (link.from === from) link.from = to;
    if (link.to === from) link.to = to;
  }
}

function apply(data: StructuredTimelineData, operation: PlanningOperation): void {
  const rows = data.rows;
  switch (operation.op) {
    case "set_title":
      if (operation.title === null || operation.title === "") delete data.title;
      else data.title = operation.title;
      return;
    case "set_time":
      data.time = {
        ...data.time,
        ...(operation.start !== undefined ? { start: operation.start } : {}),
        ...(operation.end !== undefined ? { end: operation.end } : {}),
        ...(operation.scale !== undefined ? { scale: operation.scale as StructuredTimelineData["time"]["scale"] } : {}),
      };
      return;
    case "set_periods":
      if (!Array.isArray(operation.periods)) throw new OperationError("periods must be a list");
      if (operation.periods.length === 0) delete data.periods;
      else data.periods = operation.periods;
      return;
    case "set_references":
      if (!Array.isArray(operation.references)) throw new OperationError("references must be a list");
      if (operation.references.length === 0) delete data.references;
      else data.references = operation.references;
      return;
    case "add_task": {
      const task = operation.task;
      if (!task || typeof task !== "object") throw new OperationError("add_task needs a task");
      requireFresh(data, task.id, "a task");
      const added = { ...task, type: "task", items: Array.isArray(task.items) ? task.items : [] } as StructuredTimelineTask;
      for (const item of added.items) if (item.id !== undefined) requireFresh(data, item.id, "an item");
      rows.splice(insertionIndex(rows, operation), 0, added);
      return;
    }
    case "change_task": {
      const task = rows[taskIndex(rows, operation.id)] as StructuredTimelineTask;
      if (operation.label !== undefined) task.label = operation.label;
      if (operation.new_id !== undefined && operation.new_id !== task.id) {
        requireFresh(data, operation.new_id, "a task");
        rename(data, task.id, operation.new_id);
        task.id = operation.new_id;
      }
      return;
    }
    case "move_task": {
      const [task] = rows.splice(taskIndex(rows, operation.id), 1);
      try {
        rows.splice(insertionIndex(rows, operation), 0, task!);
      } catch (error) {
        throw error instanceof OperationError ? new OperationError(`cannot move "${operation.id}": ${error.message}`) : error;
      }
      return;
    }
    case "remove_task": {
      const [task] = rows.splice(taskIndex(rows, operation.id), 1) as StructuredTimelineTask[];
      dropDependenciesOn(data, new Set([task!.id, ...task!.items.flatMap((item) => (item.id ? [item.id] : []))]));
      return;
    }
    case "add_item": {
      const task = rows[taskIndex(rows, operation.task)] as StructuredTimelineTask;
      if (!operation.item || typeof operation.item !== "object") throw new OperationError("add_item needs an item");
      if (operation.item.id !== undefined) requireFresh(data, operation.item.id, "an item");
      task.items.push({ ...operation.item });
      return;
    }
    case "change_item": {
      const { task, index } = findItem(rows, operation.id);
      const { task: destination, ...changes } = operation.changes ?? {};
      const item = { ...task.items[index]!, ...changes } as StructuredTimelineItem & Record<string, unknown>;
      // A field set to null is a field removed.
      for (const [key, value] of Object.entries(changes)) if (value === null) delete item[key];
      if (changes.id !== undefined && changes.id !== operation.id) {
        requireFresh(data, changes.id, "an item");
        rename(data, operation.id, changes.id as string);
      }
      if (destination !== undefined && destination !== task.id) {
        const target = rows[taskIndex(rows, destination)] as StructuredTimelineTask;
        task.items.splice(index, 1);
        target.items.push(item);
      } else {
        task.items[index] = item;
      }
      return;
    }
    case "remove_item": {
      const { task, index } = findItem(rows, operation.id);
      task.items.splice(index, 1);
      dropDependenciesOn(data, new Set([operation.id]));
      return;
    }
    case "add_separator":
      rows.splice(insertionIndex(rows, operation), 0, operation.label ? { type: "separator", label: operation.label } : { type: "separator" });
      return;
    case "remove_separator": {
      const row = rows[operation.row];
      if (!Number.isInteger(operation.row) || row?.type !== "separator") {
        throw new OperationError(`row ${operation.row} is not a separator`);
      }
      rows.splice(operation.row, 1);
      return;
    }
    case "add_dependency": {
      const link = operation.dependency;
      if (!link || typeof link.from !== "string" || typeof link.to !== "string") {
        throw new OperationError("add_dependency needs a dependency with from and to");
      }
      const known = declaredIdentifiers(data);
      for (const end of [link.from, link.to]) if (!known.has(end)) throw new OperationError(`no task or item "${end}"`);
      if ((data.dependencies ?? []).some((existing) => existing.from === link.from && existing.to === link.to)) {
        throw new OperationError(`"${link.from}" → "${link.to}" is already a dependency`);
      }
      data.dependencies = [...(data.dependencies ?? []), { ...link }];
      return;
    }
    case "remove_dependency": {
      const before = data.dependencies?.length ?? 0;
      data.dependencies = (data.dependencies ?? []).filter((link) => !(link.from === operation.from && link.to === operation.to));
      if (data.dependencies.length === before) throw new OperationError(`no dependency "${operation.from}" → "${operation.to}"`);
      if (data.dependencies.length === 0) delete data.dependencies;
      return;
    }
    default:
      throw new OperationError(`unknown operation "${(operation as { op?: unknown }).op}"; known: ${OPERATION_NAMES.join(", ")}`);
  }
}

/**
 * The document after every operation, in order, or the refusal of the first that
 * cannot apply. The input is not modified. Items added without an id are named, as
 * at creation.
 */
export function applyOperations(document: TimelineDocument, operations: unknown): TimelineDocument {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new OperationError("operations must be a non-empty list");
  }
  const next = structuredClone(document);
  operations.forEach((operation, index) => {
    try {
      if (!operation || typeof operation !== "object") throw new OperationError("an operation is an object with an op");
      apply(next.data, operation as PlanningOperation);
    } catch (error) {
      if (error instanceof OperationError) {
        throw new OperationError(`operation ${index} (${String((operation as { op?: unknown })?.op)}): ${error.message}`);
      }
      throw error;
    }
  });
  return nameEveryItem(next) as TimelineDocument;
}
