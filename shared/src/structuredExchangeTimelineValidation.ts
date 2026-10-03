/**
 * The timeline's relational rules: what its schema can shape and cannot judge.
 *
 * A pattern admits `2027-02-30`; only a calendar refuses it. A schema cannot
 * compare two dates, find an identifier, or follow dependencies round a loop.
 * These rules do, and like every other relational rule they name what is wrong and
 * where, and repair nothing: a timeline drawn from a date this stage had guessed at
 * is a plan nobody wrote.
 *
 * Deliberately absent: a dependency the dates do not honour. That is a plan that
 * has slipped, which is what a reader most needs to see, so it is drawn and
 * reported rather than refused.
 */
import { STRUCTURED_EXCHANGE_CEILINGS, type StructuredTimelineData } from "./structuredExchange.ts";
import {
  dayNumber,
  dependencyType,
  timelineEndpoints,
  type TimelineEndpoint,
} from "./structuredExchangeTimeline.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";

export function timelineIssues(data: StructuredTimelineData): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];

  const day = (value: string, at: string): number | undefined => {
    const found = dayNumber(value);
    if (found === undefined) {
      issues.push({ rule: "invalid-date", path: at, message: `"${value}" is not a day of the calendar` });
    }
    return found;
  };

  const rangeStart = day(data.time.start, "/data/time/start");
  const rangeEnd = day(data.time.end, "/data/time/end");
  // Items are held to the range only once the range itself is a range.
  const range =
    rangeStart !== undefined && rangeEnd !== undefined && rangeStart <= rangeEnd
      ? { start: rangeStart, end: rangeEnd }
      : undefined;
  if (rangeStart !== undefined && rangeEnd !== undefined && rangeStart > rangeEnd) {
    issues.push({
      rule: "inverted-range",
      path: "/data/time",
      message: `the timeline starts on ${data.time.start}, after it ends on ${data.time.end}`,
    });
  }
  const declaredRange = `${data.time.start} to ${data.time.end}`;

  // Tasks and items share one namespace: a dependency names either, and an
  // identifier meaning two things would make it name both.
  const seen = new Map<string, string>();
  const identify = (id: string | undefined, at: string) => {
    if (id === undefined) return;
    const first = seen.get(id);
    if (first === undefined) seen.set(id, at);
    else {
      issues.push({
        rule: "duplicate-identifier",
        path: `${at}/id`,
        message: `identifier "${id}" is already declared at ${first}`,
      });
    }
  };

  // A comparison states what it is compared with; without that, previous dates and
  // roles would be claims about an unnamed plan.
  const compared = data.comparedTo !== undefined;
  if (data.comparedTo?.date !== undefined) day(data.comparedTo.date, "/data/comparedTo/date");
  const withoutReference = (at: string) =>
    issues.push({
      rule: "comparison-without-reference",
      path: at,
      message: "previous dates and change roles describe a comparison; declare `comparedTo` naming the plan they compare with",
    });

  const kinds = new Set<string>();
  data.rows.forEach((row, rowIndex) => {
    if (row.type !== "task") return;
    const rowAt = `/data/rows/${rowIndex}`;
    identify(row.id, rowAt);
    if (row.role !== undefined && !compared) withoutReference(`${rowAt}/role`);
    row.items.forEach((item, itemIndex) => {
      const at = `${rowAt}/items/${itemIndex}`;
      identify(item.id, at);
      if (item.kind !== undefined) kinds.add(item.kind);
      if (item.role !== undefined && !compared) withoutReference(`${at}/role`);
      if (item.previous !== undefined) {
        if (!compared) withoutReference(`${at}/previous`);
        // An added or removed thing has no previous position to show: it was not in
        // one plan or the other.
        if (item.role !== undefined || row.role !== undefined) {
          issues.push({
            rule: "contradictory-change",
            path: `${at}/previous`,
            message: `an item that is ${item.role ?? `in a task that is ${row.role}`} has no previous dates; it is new or dropped, not moved`,
          });
        }
        const previous = item.previous as { start?: string; end?: string; date?: string };
        const before =
          item.type === "activity"
            ? { first: day(previous.start!, `${at}/previous/start`), last: day(previous.end!, `${at}/previous/end`) }
            : (() => {
                const only = day(previous.date!, `${at}/previous/date`);
                return { first: only, last: only };
              })();
        if (before.first !== undefined && before.last !== undefined) {
          if (before.first > before.last) {
            issues.push({ rule: "inverted-range", path: `${at}/previous`, message: `the previous dates start on ${previous.start}, after they end on ${previous.end}` });
          } else if (range !== undefined && (before.first < range.start || before.last > range.end)) {
            issues.push({
              rule: "item-outside-range",
              path: `${at}/previous`,
              message: `the previous dates fall outside the timeline's range ${declaredRange}; the range covers both plans, so widen \`time\``,
            });
          }
        }
      }
      if (item.role !== undefined && row.role !== undefined && item.role !== row.role) {
        issues.push({
          rule: "contradictory-change",
          path: `${at}/role`,
          message: `an item ${item.role} in a task that is ${row.role}`,
        });
      }
      let first: number | undefined;
      let last: number | undefined;
      if (item.type === "activity") {
        first = day(item.start, `${at}/start`);
        last = day(item.end, `${at}/end`);
        if (first !== undefined && last !== undefined && first > last) {
          issues.push({
            rule: "inverted-range",
            path: at,
            message: `the activity starts on ${item.start}, after it ends on ${item.end}`,
          });
          return;
        }
      } else {
        first = last = day(item.date, `${at}/date`);
      }
      if (range === undefined || first === undefined || last === undefined) return;
      if (first < range.start || last > range.end) {
        issues.push({
          rule: "item-outside-range",
          path: at,
          message:
            item.type === "activity"
              ? `the activity runs ${item.start} to ${item.end}, outside the timeline's range ${declaredRange}; widen \`time\` or move the activity`
              : `the milestone falls on ${item.date}, outside the timeline's range ${declaredRange}; widen \`time\` or move the milestone`,
        });
      }
    });
  });

  // Periods may straddle the range's edge — a closure over the plan's first week is
  // ordinary — and are drawn clipped; one wholly outside would draw nothing at all.
  (data.periods ?? []).forEach((period, index) => {
    const at = `/data/periods/${index}`;
    if (period.kind !== undefined) kinds.add(period.kind);
    const first = day(period.start, `${at}/start`);
    const last = day(period.end, `${at}/end`);
    if (first === undefined || last === undefined) return;
    if (first > last) {
      issues.push({ rule: "inverted-range", path: at, message: `the period starts on ${period.start}, after it ends on ${period.end}` });
    } else if (range !== undefined && (last < range.start || first > range.end)) {
      issues.push({
        rule: "period-outside-range",
        path: at,
        message: `the period ${period.start} to ${period.end} lies wholly outside the timeline's range ${declaredRange}, so nothing of it could be drawn`,
      });
    }
  });
  // A reference is a single day, held to the range like a milestone.
  (data.references ?? []).forEach((reference, index) => {
    const at = `/data/references/${index}`;
    if (reference.kind !== undefined) kinds.add(reference.kind);
    const only = day(reference.date, `${at}/date`);
    if (only !== undefined && range !== undefined && (only < range.start || only > range.end)) {
      issues.push({
        rule: "item-outside-range",
        path: at,
        message: `the reference date ${reference.date} is outside the timeline's range ${declaredRange}; widen \`time\` or move it`,
      });
    }
  });

  if (kinds.size > STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary) {
    issues.push({
      rule: "too-many-kinds",
      path: "/data/rows",
      message: `${kinds.size} distinct item types, and no more than ${STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary} can be told apart in a rendering`,
      observed: kinds.size,
      limit: STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary,
    });
  }

  issues.push(...dependencyIssues(data, timelineEndpoints(data)));
  issues.push(...removedDependencyIssues(data));
  return issues;
}

/** A dependency on something the plan dropped: it no longer constrains anything. */
function removedDependencyIssues(data: StructuredTimelineData): StructuredExchangeIssue[] {
  const removed = new Set<string>();
  for (const row of data.rows) {
    if (row.type !== "task") continue;
    if (row.role === "removed") removed.add(row.id);
    for (const item of row.items) {
      if (item.id !== undefined && (item.role === "removed" || row.role === "removed")) removed.add(item.id);
    }
  }
  const issues: StructuredExchangeIssue[] = [];
  (data.dependencies ?? []).forEach((dependency, index) => {
    for (const side of ["from", "to"] as const) {
      if (removed.has(dependency[side])) {
        issues.push({
          rule: "dependency-on-removed",
          path: `/data/dependencies/${index}/${side}`,
          message: `"${dependency[side]}" was dropped from the plan, so nothing can depend on it any more; remove the dependency`,
        });
      }
    }
  });
  return issues;
}

function dependencyIssues(data: StructuredTimelineData, endpoints: Map<string, TimelineEndpoint>): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];
  const dependencies = data.dependencies ?? [];
  const usable: { from: string; to: string; index: number }[] = [];
  const declared = new Map<string, number>();

  dependencies.forEach((dependency, index) => {
    const at = `/data/dependencies/${index}`;
    let resolved = true;
    for (const side of ["from", "to"] as const) {
      const named = dependency[side];
      const endpoint = endpoints.get(named);
      if (endpoint === undefined) {
        resolved = false;
        issues.push({
          rule: "unresolved-endpoint",
          path: `${at}/${side}`,
          message: `"${named}" is not the identifier of any task or item this timeline declares`,
        });
      } else if (endpoint.type === "task" && endpoint.days === undefined) {
        resolved = false;
        // A task whose items all carry impossible dates has no span either, and
        // those dates are already refused: saying the task is empty would be false.
        const task = data.rows[endpoint.row];
        if (task.type === "task" && task.items.length > 0) continue;
        issues.push({
          rule: "empty-task-endpoint",
          path: `${at}/${side}`,
          message: `task "${named}" holds no item, so it has no start or finish for a dependency to link`,
        });
      }
    }
    if (!resolved) return;

    const from = endpoints.get(dependency.from)!;
    const to = endpoints.get(dependency.to)!;
    // A task stands for its items, so linking it to one of them links a thing to
    // part of itself: whichever end the type names, it can only be honoured by
    // accident.
    const contains = (outer: TimelineEndpoint, inner: TimelineEndpoint) =>
      outer.type === "task" && inner.type !== "task" && inner.row === outer.row;
    if (from.id === to.id || contains(from, to) || contains(to, from)) {
      issues.push({
        rule: "self-dependency",
        path: at,
        message:
          from.id === to.id
            ? `"${from.id}" cannot depend on itself`
            : `a task and one of its own items cannot depend on each other: the task's span is made of its items`,
      });
      return;
    }

    const key = JSON.stringify([dependency.from, dependency.to, dependencyType(dependency)]);
    const first = declared.get(key);
    if (first !== undefined) {
      issues.push({
        rule: "duplicate-dependency",
        path: at,
        message: `the same dependency is already declared at /data/dependencies/${first}`,
      });
      return;
    }
    declared.set(key, index);
    usable.push({ from: dependency.from, to: dependency.to, index });
  });

  const cycle = findCycle(usable);
  if (cycle !== undefined) {
    issues.push({
      rule: "dependency-cycle",
      path: `/data/dependencies/${cycle.index}`,
      message: `dependencies form a cycle, which no dates can honour: ${cycle.ids.join(" → ")}`,
    });
  }
  return issues;
}

/**
 * One cycle among the dependencies, if there is any: the identifiers round it,
 * first repeated last, and a dependency on it to point at. One is enough to refuse
 * the document; naming every cycle in a tangled plan would bury the first.
 */
function findCycle(edges: { from: string; to: string; index: number }[]): { ids: string[]; index: number } | undefined {
  const outgoing = new Map<string, { to: string; index: number }[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push({ to: edge.to, index: edge.index });
    outgoing.set(edge.from, list);
  }
  const state = new Map<string, "open" | "done">();
  const path: { id: string; index: number }[] = [];

  // Iterative, so a long chain of dependencies cannot exhaust the stack.
  for (const root of outgoing.keys()) {
    if (state.has(root)) continue;
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
    state.set(root, "open");
    path.push({ id: root, index: -1 });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const edgesOut = outgoing.get(frame.id) ?? [];
      if (frame.next >= edgesOut.length) {
        state.set(frame.id, "done");
        stack.pop();
        path.pop();
        continue;
      }
      const edge = edgesOut[frame.next++];
      const seen = state.get(edge.to);
      if (seen === "open") {
        const start = path.findIndex((step) => step.id === edge.to);
        const ids = [...path.slice(start).map((step) => step.id), edge.to];
        return { ids, index: edge.index };
      }
      if (seen === undefined) {
        state.set(edge.to, "open");
        stack.push({ id: edge.to, next: 0 });
        path.push({ id: edge.to, index: edge.index });
      }
    }
  }
  return undefined;
}
