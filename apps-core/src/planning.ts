/**
 * What a planning is, and the gate every planning passes before it is stored.
 *
 * A planning is a structured-exchange version 3 timeline, judged by exactly the gate
 * pi-outpost applies — `parseSerializedStructuredExchange` with the committed schema —
 * so a planning refused here is refused there for the same reason, and one stored here
 * opens there as it is. Two things are added on top, and both only narrow:
 *
 * - **A planning is a plan.** A compared timeline (one declaring `comparedTo`, or
 *   carrying `previous` positions or change roles) is a picture of two plans, not a
 *   plan; storing one would make every later comparison compare a comparison.
 *   Comparisons are drawn when a planning is shown.
 * - **Every item can be named.** Updates address what they change by identifier, and
 *   the contract lets an item go without one. Creation gives each anonymous item an
 *   identifier, unique in the planning, so the model can name it afterwards.
 *
 * The envelope is settled before the contract is asked, and only the diagnostics change
 * for it, never the verdict. Without a `kind` saying which form `data` takes, the schema
 * tries every form and reports every failure — a planning refused for lacking `nodes` and
 * `participants` — and a model reading that rewrites its planning into the wrong form.
 * A planning can only be a timeline, so a wrong envelope is answered with the one fix.
 */
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { StructuredExchangeIssue } from "@pi-outpost/shared/structured-exchange/parse";
import { STRUCTURED_EXCHANGE_SCHEMA_V3, type StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";

export interface TimelineDocument {
  schema: typeof STRUCTURED_EXCHANGE_SCHEMA_V3;
  kind: "timeline";
  data: StructuredTimelineData;
}

export type PlanningVerdict = { valid: true; document: TimelineDocument; serialized: string } | { valid: false; issues: StructuredExchangeIssue[] };

function comparisonIssues(data: StructuredTimelineData): StructuredExchangeIssue[] {
  const refusal = (path: string): StructuredExchangeIssue => ({
    rule: "planning-is-a-plan",
    path,
    message: "a planning holds the plan only; comparisons with an earlier revision are drawn by show_planning",
  });
  const issues: StructuredExchangeIssue[] = [];
  if (data.comparedTo !== undefined) issues.push(refusal("/data/comparedTo"));
  data.rows.forEach((row, r) => {
    if (row.type !== "task") return;
    if (row.role !== undefined) issues.push(refusal(`/data/rows/${r}/role`));
    row.items.forEach((item, i) => {
      if (item.previous !== undefined) issues.push(refusal(`/data/rows/${r}/items/${i}/previous`));
      if (item.role !== undefined) issues.push(refusal(`/data/rows/${r}/items/${i}/role`));
    });
  });
  return issues;
}

const ENVELOPE = `{"schema":"${STRUCTURED_EXCHANGE_SCHEMA_V3}","kind":"timeline","data":{…}}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The envelope a planning must have, judged before the contract is.
 *
 * `issues` names what is wrong with `schema` and `kind`; when they are only misplaced
 * inside `data`, `lifted` is the document with them put back where they belong, so the
 * rest of it can be judged in the same answer. A document that is not an object is left
 * to the contract, which says so.
 */
function envelopeIssues(document: unknown): { issues: StructuredExchangeIssue[]; lifted: unknown } {
  if (!isRecord(document)) return { issues: [], lifted: document };
  const issues: StructuredExchangeIssue[] = [];
  const moved = new Set<string>();
  let lifted: Record<string, unknown> = document;
  if (isRecord(document.data)) {
    const data = { ...document.data };
    for (const field of ["schema", "kind"] as const) {
      if (document[field] !== undefined || data[field] === undefined) continue;
      issues.push({
        rule: "planning-envelope",
        path: `/data/${field}`,
        message: `"${field}" belongs beside "data", at the top of the planning, not inside it: ${ENVELOPE}`,
      });
      moved.add(field);
      lifted = { ...lifted, [field]: data[field] };
      delete data[field];
    }
    if (moved.size > 0) lifted = { ...lifted, data };
  }
  const where = (field: string) => (moved.has(field) ? `/data/${field}` : `/${field}`);
  if (lifted.kind !== "timeline") {
    issues.push({
      rule: "planning-is-a-timeline",
      path: where("kind"),
      message: lifted.kind === undefined
        ? `a planning is a version 3 timeline, and "kind" is missing: ${ENVELOPE}`
        : `a planning is a version 3 timeline (kind "timeline"), not ${JSON.stringify(lifted.kind)}: ${ENVELOPE}`,
    });
  }
  if (lifted.schema !== STRUCTURED_EXCHANGE_SCHEMA_V3) {
    issues.push({
      rule: "planning-is-a-timeline",
      path: where("schema"),
      message: lifted.schema === undefined
        ? `a planning is a version 3 timeline, and "schema" is missing: ${ENVELOPE}`
        : `a planning is a version 3 timeline (schema "${STRUCTURED_EXCHANGE_SCHEMA_V3}"), not ${JSON.stringify(lifted.schema)}: ${ENVELOPE}`,
    });
  }
  return { issues, lifted };
}

/**
 * The verdict on a candidate planning document.
 *
 * `maxBytes` is this deployment's own ceiling on a planning, applied to the document
 * as it will be stored, before anything else is read.
 *
 * A document whose envelope is not a timeline's is always refused. When `schema` and
 * `kind` are right but sit inside `data`, the refusal says so first, then lists what the
 * contract finds once they are moved, so every fix arrives in one answer; any other
 * wrong envelope is answered with the envelope alone, since the contract's diagnostics
 * for another form say nothing useful about a planning.
 */
export function judgePlanning(document: unknown, maxBytes: number): PlanningVerdict {
  const serialized = JSON.stringify(document);
  if (serialized === undefined) {
    return { valid: false, issues: [{ rule: "not-json", path: "", message: "document is not JSON" }] };
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxBytes) {
    return {
      valid: false,
      issues: [{
        rule: "planning-too-large",
        path: "",
        message: `planning is ${bytes} bytes, above this server's ceiling of ${maxBytes} bytes`,
        limit: maxBytes,
        observed: bytes,
        level: "deployment",
      }],
    };
  }
  const envelope = envelopeIssues(document);
  if (envelope.issues.some((issue) => issue.rule === "planning-is-a-timeline")) return { valid: false, issues: envelope.issues };
  const judged = envelope.issues.length > 0 ? JSON.stringify(envelope.lifted) : serialized;
  const verdict = parseSerializedStructuredExchange(judged, checkStructuredExchangeSchema);
  if (!verdict.valid) return { valid: false, issues: [...envelope.issues, ...verdict.issues] };
  const data = verdict.envelope.data as StructuredTimelineData;
  const issues = [...envelope.issues, ...comparisonIssues(data)];
  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, document: verdict.envelope as unknown as TimelineDocument, serialized };
}

/** Every identifier a timeline declares: tasks and items. */
export function declaredIdentifiers(data: StructuredTimelineData): Set<string> {
  const ids = new Set<string>();
  for (const row of data.rows) {
    if (row.type !== "task") continue;
    ids.add(row.id);
    for (const item of row.items) if (item.id !== undefined) ids.add(item.id);
  }
  return ids;
}

/**
 * The same document, with an identifier on every item that had none.
 *
 * Names are `<task id>.<n>`, the first free `n` from 1, so they read as belonging to
 * their task and never collide with a name the author chose. Items that already have
 * one keep it. The input is not modified.
 */
export function nameEveryItem(document: unknown): unknown {
  const candidate = document as { data?: { rows?: unknown } } | null;
  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.data?.rows)) return document;
  const copy = structuredClone(candidate) as { data: StructuredTimelineData };
  const taken = new Set<string>();
  for (const row of copy.data.rows as Array<Partial<StructuredTimelineData["rows"][number]>>) {
    if (row?.type !== "task") continue;
    if (typeof row.id === "string") taken.add(row.id);
    for (const item of Array.isArray(row.items) ? row.items : []) if (typeof item?.id === "string") taken.add(item.id);
  }
  for (const row of copy.data.rows as Array<Partial<StructuredTimelineData["rows"][number]>>) {
    if (row?.type !== "task" || typeof row.id !== "string" || !Array.isArray(row.items)) continue;
    let n = 1;
    for (const item of row.items) {
      if (!item || typeof item !== "object" || item.id !== undefined) continue;
      while (taken.has(`${row.id}.${n}`)) n += 1;
      item.id = `${row.id}.${n}`;
      taken.add(item.id);
    }
  }
  return copy;
}
