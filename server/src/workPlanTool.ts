import { Type, type TSchema } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  WORK_PLAN_ACTIONS,
  WORK_PLAN_CREATE_MAX_DEPTH,
  WORK_PLAN_EVIDENCE_RESULTS,
  WORK_PLAN_LIMITS,
  WORK_PLAN_STATUSES,
  type WorkPlanAction,
} from "@pi-outpost/shared/work-plan";
import { applyWorkPlanMutation } from "./workPlanStore.ts";

const objectOptions = { additionalProperties: false } as const;
/**
 * A non-empty string with a ceiling. `minLength` carries the empty case; the
 * whitespace-only case is left to `requireNonEmptyString` in the shared
 * normaliser, which every mutation already passes through and which names the
 * offending field.
 *
 * It used to carry an anchored `pattern` for that second case. On this schema
 * that is 73 copies of the same regex — 2.5k characters, ~640 tokens on every
 * turn of every conversation — to reject a string the handler rejects anyway,
 * with a message the model can act on rather than a schema error it cannot.
 */
const boundedText = (maxLength: number, description?: string) => Type.String({
  minLength: 1,
  maxLength,
  ...(description === undefined ? {} : { description }),
});
const identifierSchema = boundedText(WORK_PLAN_LIMITS.title);
const titleSchema = boundedText(WORK_PLAN_LIMITS.title);
const descriptionSchema = boundedText(WORK_PLAN_LIMITS.description);
const reasonSchema = boundedText(WORK_PLAN_LIMITS.reason);
/**
 * One `enum` node, not a union of literal branches.
 *
 * `Type.Union([...Type.Literal])` emits `anyOf`, and pi reports a failed call by
 * listing every branch that rejected it: a mistyped status came back as "must be
 * equal to constant" once per accepted value, none of them naming the accepted
 * values. An `enum` fails once and carries them.
 */
const stringEnum = <T extends string>(values: readonly T[], description?: string) =>
  Type.Unsafe<T>({ type: "string", enum: [...values], ...(description === undefined ? {} : { description }) });
const statusSchema = stringEnum(WORK_PLAN_STATUSES);
const resourceSchema = Type.Object({
  uri: boundedText(WORK_PLAN_LIMITS.uri),
  label: Type.Optional(boundedText(WORK_PLAN_LIMITS.title)),
}, objectOptions);
const resourcesSchema = Type.Array(resourceSchema, { maxItems: WORK_PLAN_LIMITS.resourcesPerTask });
const dependenciesSchema = Type.Array(identifierSchema, { maxItems: WORK_PLAN_LIMITS.tasks, uniqueItems: true });
const evidenceResultSchema = stringEnum(WORK_PLAN_EVIDENCE_RESULTS);
const evidenceSchema = Type.Object({
  id: identifierSchema,
  type: boundedText(WORK_PLAN_LIMITS.evidenceType, "Free-form evidence kind or source, such as test, command, file, or external-check."),
  result: evidenceResultSchema,
  summary: Type.Optional(boundedText(WORK_PLAN_LIMITS.evidenceSummary)),
  reference: Type.Optional(resourceSchema),
}, {
  ...objectOptions,
  anyOf: [{ required: ["summary"] }, { required: ["reference"] }],
  description: "One evidence record. Supply at least a summary or reference.",
});
const evidenceCollectionSchema = Type.Array(evidenceSchema, { maxItems: WORK_PLAN_LIMITS.evidencePerTask });

const normalizedTaskSchema = Type.Object({
  id: identifierSchema,
  title: titleSchema,
  description: Type.Optional(descriptionSchema),
  status: statusSchema,
  parentId: Type.Optional(identifierSchema),
  dependsOn: Type.Optional(dependenciesSchema),
  resources: Type.Optional(resourcesSchema),
  evidence: Type.Optional(evidenceCollectionSchema),
  statusReason: Type.Optional(reasonSchema),
}, objectOptions);

const normalizedPlanSchema = Type.Object({
  version: Type.Literal(1),
  id: identifierSchema,
  title: titleSchema,
  tasks: Type.Array(normalizedTaskSchema, { maxItems: WORK_PLAN_LIMITS.tasks }),
  updatedAt: boundedText(WORK_PLAN_LIMITS.title),
}, objectOptions);

const creationTaskSchema = (depth: number): TSchema => Type.Object({
  id: Type.Optional(boundedText(
    WORK_PLAN_LIMITS.title,
    "Optional identifier, unique across the plan; one is generated when omitted.",
  )),
  title: titleSchema,
  description: Type.Optional(descriptionSchema),
  status: Type.Optional(statusSchema),
  statusReason: Type.Optional(reasonSchema),
  // No `resources` or `evidence` here. Both are collections whose shapes are the
  // expensive part of this schema, and both are inlined once per nesting level —
  // 1 009 characters twice over, to describe something a task acquires *after* it
  // has been worked on rather than while the plan is being drawn. They are set
  // through `work_plan_extended`, on a task that exists. `mutateWorkPlan` still
  // accepts them in a draft, so a client written against the old contract keeps
  // working; only the advertisement is gone.
  dependsOn: Type.Optional(Type.Array(identifierSchema, {
    maxItems: WORK_PLAN_LIMITS.tasks,
    uniqueItems: true,
    description: "Ids of other tasks in this same call that must finish first. Give those tasks an explicit id.",
  })),
  ...(depth < WORK_PLAN_CREATE_MAX_DEPTH
    ? { subtasks: Type.Optional(Type.Array(creationTaskSchema(depth + 1), {
        maxItems: WORK_PLAN_LIMITS.tasks,
        description: `Direct subtasks only; the complete plan may contain at most ${WORK_PLAN_LIMITS.tasks} tasks.`,
      })) }
    : {}),
}, objectOptions);

/**
 * `update_task` used to advertise a `changes` object beside the flat fields, with
 * exactly the same seven properties. Two ways to say one thing, the second costing
 * 1.2k characters of schema on every turn.
 *
 * The normaliser still reads `changes` (`loosenedChanges`), so a caller reaching
 * `mutateWorkPlan` directly keeps working. A *model* does not: pi validates a tool
 * call against the published schema before the handler runs, and this schema refuses
 * properties it does not declare. Withdrawing an advertisement is therefore a real
 * narrowing for anything calling through pi — the work-plan provider fixture sent
 * `changes` and was refused, which is how this was established rather than assumed.
 */

/**
 * One object, not a union of ten.
 *
 * A `Type.Union` emits a bare top-level `anyOf`, and pi validates a tool call
 * against the whole schema: every branch that fails contributes its own errors,
 * so a single wrong property comes back as "action: must be equal to constant"
 * repeated once per action the model did not ask for, and the one line that
 * names the real problem is buried and says only "must not have additional
 * properties". A model then repairs by guessing. Here `action` is an enum and
 * the per-action requirements are checked by `mutateWorkPlan`, which names the
 * offending field ("tasks[2].dependsOn is not accepted").
 */
/**
 * Which tool carries which action.
 *
 * The line is prerequisite, not frequency: every extended action operates on a task
 * that must already exist, so none of them can be called against a session with no
 * plan — and the extended tool is published only where they can. That they are also
 * the four rarest operations, and the four carrying the expensive collection shapes,
 * is what makes withholding them worth the second name.
 */
export const WORK_PLAN_COMMON_ACTIONS = [
  "get",
  "create",
  "add_task",
  "update_task",
  "move_task",
  "remove_task",
  "clear",
] as const satisfies readonly WorkPlanAction[];

export const WORK_PLAN_EXTENDED_ACTIONS = [
  "replace",
  "set_dependencies",
  "set_resources",
  "set_evidence",
] as const satisfies readonly WorkPlanAction[];

export const WORK_PLAN_TOOL = "work_plan";
export const WORK_PLAN_EXTENDED_TOOL = "work_plan_extended";

/** Which tool an action belongs to, so a refusal can say where to find it. */
export function workPlanToolFor(action: string): string | undefined {
  if ((WORK_PLAN_COMMON_ACTIONS as readonly string[]).includes(action)) return WORK_PLAN_TOOL;
  if ((WORK_PLAN_EXTENDED_ACTIONS as readonly string[]).includes(action)) return WORK_PLAN_EXTENDED_TOOL;
  return undefined;
}

/** The common tool's payload: a plan of titles, and per-task edits that carry no collection. */
export const workPlanParameters = Type.Object({
  action: stringEnum(
    WORK_PLAN_COMMON_ACTIONS,
    "What to do. Every property below is required by some actions and ignored by the rest.",
  ),
  title: Type.Optional(Type.String({ ...titleSchema, description: "Plan title (create), or the task's new title (update_task)." })),
  tasks: Type.Optional(Type.Array(creationTaskSchema(1), {
    maxItems: WORK_PLAN_LIMITS.tasks,
    description: `Top-level tasks (create); each may carry subtasks. At most ${WORK_PLAN_LIMITS.tasks} tasks total and ${WORK_PLAN_LIMITS.serializedBytes} serialized bytes across the complete plan.`,
  })),
  task: Type.Optional(Type.Object({
    // The normalized task shape minus its collections, for the same reason creation
    // drops them: `resources` and `evidence` are what a task acquires once it is
    // being worked on, they are the largest shapes in this schema, and they have a
    // tool of their own. `mutateWorkPlan` defaults both to empty, so an added task is
    // complete without them. A call that carries them anyway is refused by pi's own
    // validation, before the handler — the schema is the contract, not a hint.
    id: normalizedTaskSchema.properties.id,
    title: normalizedTaskSchema.properties.title,
    description: normalizedTaskSchema.properties.description,
    status: normalizedTaskSchema.properties.status,
    parentId: normalizedTaskSchema.properties.parentId,
    statusReason: normalizedTaskSchema.properties.statusReason,
    dependsOn: normalizedTaskSchema.properties.dependsOn,
  }, { ...objectOptions, description: "One complete task, id and status included (add_task)." })),
  taskId: Type.Optional(Type.String({ ...identifierSchema, description: "Which task to act on (update_task, move_task, remove_task)." })),
  status: Type.Optional(stringEnum(WORK_PLAN_STATUSES, "New status (update_task).")),
  description: Type.Optional(Type.Union([descriptionSchema, Type.Null()], { description: "New description, or null to clear it (update_task)." })),
  statusReason: Type.Optional(Type.Union([reasonSchema, Type.Null()], { description: "Why the task sits in its status, or null to clear it (update_task)." })),
  parentId: Type.Optional(Type.Union([identifierSchema, Type.Null()], { description: "New parent, or null for top level (move_task)." })),
}, objectOptions);

/**
 * The extended tool's payload: the whole-plan document and the three collections.
 *
 * Every action here needs a task that already exists, which is why this schema is
 * published only to a session that has a plan — and why it is the half worth
 * withholding: these four properties carried most of the characters.
 */
export const workPlanExtendedParameters = Type.Object({
  action: stringEnum(
    WORK_PLAN_EXTENDED_ACTIONS,
    "What to do. Every property below is required by some actions and ignored by the rest.",
  ),
  plan: Type.Optional(Type.Object({ ...normalizedPlanSchema.properties }, { ...objectOptions, description: "A complete normalized plan (replace)." })),
  taskId: Type.Optional(Type.String({ ...identifierSchema, description: "Which task to act on (set_dependencies, set_resources, set_evidence)." })),
  dependsOn: Type.Optional(Type.Array(identifierSchema, { maxItems: WORK_PLAN_LIMITS.tasks, uniqueItems: true, description: "Complete dependency set for taskId (set_dependencies)." })),
  resources: Type.Optional(Type.Array(resourceSchema, { maxItems: WORK_PLAN_LIMITS.resourcesPerTask, description: "Complete resource set for taskId (set_resources)." })),
  evidence: Type.Optional(Type.Array(evidenceSchema, {
    maxItems: WORK_PLAN_LIMITS.evidencePerTask,
    description: "Complete evidence set for taskId (set_evidence). Replaces the prior collection; [] clears it and never changes task status.",
  })),
}, objectOptions);

/**
 * One executor for both tools: the split is in what is published, never in what is
 * validated or stored. Everything still funnels through `applyWorkPlanMutation`.
 */
function executeWorkPlan(tool: string): ToolDefinition["execute"] {
  return async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    const action = (params as { action?: unknown }).action;
    const home = typeof action === "string" ? workPlanToolFor(action) : undefined;
    if (home !== undefined && home !== tool) {
      // The one failure a split invents: an action asked of the wrong half. Answer it
      // the way every other refusal here is answered — name the thing and say where it
      // is — rather than letting the schema report an unknown enum value.
      return {
        content: [{ type: "text", text: `Work Plan update refused: action=${action} belongs to the ${home} tool.` }],
        details: undefined,
        isError: true,
      };
    }
    try {
      const sessionFile = ctx.sessionManager.getSessionFile();
      const plan = await applyWorkPlanMutation(sessionFile, params as never);
      const summary = plan === null
        ? "This session has no Work Plan."
        : `Work Plan "${plan.title}": ${plan.tasks.length} tasks (${plan.tasks.filter((task) => task.status === "done").length} done).`;
      return {
        // `details` drives authoritative UI synchronization but is not model
        // context. A resumed agent must receive the complete working state in
        // content; otherwise post-compaction `get` would expose only a counter.
        content: [{ type: "text", text: (action === "get" || action === "create") && plan !== null ? `${summary}\n${JSON.stringify(plan)}` : summary }],
        details: { type: "work_plan", sessionFile, plan, changed: action !== "get" },
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Work Plan update refused: ${error instanceof Error ? error.message : String(error)}` }], details: undefined, isError: true };
    }
  };
}

export function createWorkPlanToolDefinition(): ToolDefinition {
  return {
    name: WORK_PLAN_TOOL,
    label: "Work Plan",
    description: `Read or atomically update the persistent Work Plan for this session. Use create for a compact two-level task hierarchy (${WORK_PLAN_LIMITS.tasks} tasks total, 64 KiB normalized plan) whose tasks need only a title, and the other task operations for precise later mutations. Dependencies, resources, evidence and whole-plan replacement live in ${WORK_PLAN_EXTENDED_TOOL}, which is available once this session has a plan.`,
    promptSnippet: "Create, inspect, and update the session's persistent Work Plan",
    // A worked call, because the schema alone left models repairing by guess. The
    // titles are deliberately meaningless: an example that reads like real work
    // gets copied into real plans (a live model lifted "Add the theme tokens"
    // verbatim from an earlier draft of this list).
    promptGuidelines: [
      'Create the whole plan in one call, dependencies included: {"action":"create","title":"<plan title>","tasks":[{"id":"a","title":"<first task>"},{"id":"b","title":"<second task>","dependsOn":["a"],"subtasks":[{"title":"<a step of the second task>"}]}]}',
      "Give a task an explicit short id whenever something references it; ids are generated for the rest.",
      'Update one task with {"action":"update_task","taskId":"b","status":"in_progress"}. Statuses are todo, in_progress, done, blocked, needs_review.',
      `Dependencies, resources, evidence and whole-plan replacement are in ${WORK_PLAN_EXTENDED_TOOL}. It appears as soon as this session has a plan.`,
      // Pointing a small model at `replace` for this was a trap: that action wants
      // a complete normalized document, down to a plan id and an updatedAt it
      // would have to invent. `clear` then `create` reaches the same state through
      // the compact form it already knows.
      "A session holds one plan: to start a different one, clear it and create the new one.",
    ],
    parameters: workPlanParameters,
    executionMode: "sequential",
    execute: executeWorkPlan(WORK_PLAN_TOOL),
  };
}

/**
 * The half a session without a plan is never shown. Every action it carries acts on a
 * task that must already exist, so publishing it earlier would describe calls nobody
 * could make — at the price of the largest shapes in the whole schema.
 */
export function createWorkPlanExtendedToolDefinition(): ToolDefinition {
  return {
    name: WORK_PLAN_EXTENDED_TOOL,
    label: "Work Plan (extended)",
    description: "Set the collections of one task in this session's Work Plan — dependencies, resources, verification evidence — or replace the whole plan with a complete normalized version-1 document. Create the plan with work_plan first; every action here acts on a task that already exists.",
    promptSnippet: "Set dependencies, resources and evidence on the session's Work Plan",
    promptGuidelines: [
      'Record verification explicitly with {"action":"set_evidence","taskId":"b","evidence":[{"id":"tests","type":"test","result":"passed","summary":"Focused tests passed"},{"id":"probe","type":"external-check","result":"failed","summary":"The external probe failed"}]}. Results are passed, failed, inconclusive, informational.',
      "set_evidence replaces the complete evidence collection: include prior failures when appending a result, or use [] to clear it. Evidence never changes task status, and status changes never create evidence.",
      'Declare order with {"action":"set_dependencies","taskId":"b","dependsOn":["a"]} — the complete set for that task, replacing what it had.',
      "replace is for handing back a complete normalized document you already have; to start a different plan, clear it with work_plan and create the new one.",
    ],
    parameters: workPlanExtendedParameters,
    executionMode: "sequential",
    execute: executeWorkPlan(WORK_PLAN_EXTENDED_TOOL),
  };
}
