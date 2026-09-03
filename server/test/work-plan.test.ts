import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Compile } from "typebox/compile";
import { isWorkPlanReadyForReview, mutateWorkPlan, normalizeWorkPlanDraft, validateWorkPlan, WORK_PLAN_ACTIONS, WORK_PLAN_LIMITS, type WorkPlan } from "@pi-outpost/shared/work-plan";
import { applyWorkPlanMutation, copyWorkPlan, deleteWorkPlan, loadWorkPlan, sameSessionFile, workPlanPath } from "../src/workPlanStore.ts";
import { EmbeddedRuntime } from "../src/embeddedRuntime.ts";
import { WORK_PLAN_SYSTEM_GUIDANCE } from "../src/systemPrompt.ts";
import {
  createWorkPlanExtendedToolDefinition,
  createWorkPlanToolDefinition,
  WORK_PLAN_COMMON_ACTIONS,
  WORK_PLAN_EXTENDED_ACTIONS,
} from "../src/workPlanTool.ts";

const base = (): WorkPlan => ({
  version: 1,
  id: "delivery",
  title: "Deliver the change",
  updatedAt: "2026-08-23T00:00:00.000Z",
  tasks: [
    { id: "analyse", title: "Analyse", status: "done", dependsOn: [], resources: [], evidence: [] },
    { id: "build", title: "Build", status: "in_progress", dependsOn: ["analyse"], resources: [{ uri: "workspace:src/index.ts" }], evidence: [] },
  ],
});

const legacyBase = (): Record<string, unknown> => ({
  ...base(),
  tasks: base().tasks.map(({ evidence: _evidence, ...task }) => task),
});

const verificationEvidence = () => [
  { id: "tests", type: "test", result: "failed" as const, summary: "One regression remains" },
  { id: "report", type: "file", result: "informational" as const, reference: { uri: "workspace:reports/check.json" } },
];

describe("Work Plan contract", () => {
  it("derives review readiness only from a fully reconciled authoritative plan", () => {
    const withStatuses = (...statuses: WorkPlan["tasks"][number]["status"][]): WorkPlan => ({
      ...base(),
      tasks: statuses.map((status, index) => ({
        id: `task-${index}`,
        title: `Task ${index}`,
        status,
        dependsOn: [],
        resources: [],
      })),
    });

    assert.equal(isWorkPlanReadyForReview(null), false);
    assert.equal(isWorkPlanReadyForReview(withStatuses()), false);
    assert.equal(isWorkPlanReadyForReview(withStatuses("done")), false);
    assert.equal(isWorkPlanReadyForReview(withStatuses("needs_review")), true);
    assert.equal(isWorkPlanReadyForReview(withStatuses("done", "needs_review", "done")), true);
    for (const unfinished of ["todo", "in_progress", "blocked"] as const) {
      assert.equal(
        isWorkPlanReadyForReview(withStatuses("done", "needs_review", unfinished)),
        false,
        `${unfinished} prevents review readiness`,
      );
    }
  });

  it("normalizes a minimal creation draft into a canonical version-1 plan", () => {
    const generated = ["plan-generated", "task-one", "task-two"];
    const plan = normalizeWorkPlanDraft(
      { title: "Ship safely", tasks: [{ title: "Build" }, { title: "Verify" }] },
      { nextId: () => generated.shift()!, now: () => "2026-08-23T12:00:00.000Z" },
    );
    assert.deepEqual(plan, {
      version: 1,
      id: "plan-generated",
      title: "Ship safely",
      updatedAt: "2026-08-23T12:00:00.000Z",
      tasks: [
        { id: "task-one", title: "Build", status: "todo", dependsOn: [], resources: [], evidence: [] },
        { id: "task-two", title: "Verify", status: "todo", dependsOn: [], resources: [], evidence: [] },
      ],
    });
  });

  it("preserves explicit fields and flattens tasks plus one subtask level", () => {
    let id = 0;
    const nested = (depth: number): Record<string, unknown> => ({
      title: `Level ${depth}`,
      ...(depth === 1
        ? {
            description: "Explicit description",
            status: "blocked",
            statusReason: "Waiting for review",
            resources: [{ uri: "workspace:src/index.ts", label: "Entry point" }],
          }
        : {}),
      ...(depth < 2 ? { subtasks: [nested(depth + 1)] } : {}),
    });
    const plan = normalizeWorkPlanDraft(
      { title: "Nested", tasks: [nested(1)] },
      { nextId: () => `generated-${id++}`, now: () => "2026-08-23T12:00:00.000Z" },
    );
    assert.equal(plan.version, 1);
    assert.equal(plan.tasks.length, 2);
    assert.deepEqual(plan.tasks.map((task) => task.parentId), [undefined, "generated-1"]);
    assert.deepEqual(plan.tasks[0], {
      id: "generated-1",
      title: "Level 1",
      description: "Explicit description",
      status: "blocked",
      statusReason: "Waiting for review",
      dependsOn: [],
      resources: [{ uri: "workspace:src/index.ts", label: "Entry point" }],
      evidence: [],
    });
  });

  it("rejects depth, total-task, generated-ID, and serialized-size violations", () => {
    const nested = (depth: number): Record<string, unknown> => ({
      title: `Level ${depth}`,
      ...(depth < 3 ? { subtasks: [nested(depth + 1)] } : {}),
    });
    assert.throws(
      () => normalizeWorkPlanDraft({ title: "Too deep", tasks: [nested(1)] }),
      /at most 2 levels/,
    );
    assert.throws(
      () => normalizeWorkPlanDraft({
        title: "Too many",
        tasks: [{ title: "Root", subtasks: Array.from({ length: 500 }, (_, index) => ({ title: `Task ${index}` })) }],
      }),
      /at most 500 tasks/,
    );
    assert.throws(
      () => normalizeWorkPlanDraft(
        { title: "Collision", tasks: [{ title: "Task" }] },
        { nextId: () => "same-id" },
      ),
      /unique Work Plan identifier/,
    );
    assert.throws(
      () => normalizeWorkPlanDraft({
        title: "Too large",
        tasks: Array.from({ length: 20 }, (_, index) => ({ title: `Task ${index}`, description: "x".repeat(4_000) })),
      }),
      new RegExp(`larger than ${WORK_PLAN_LIMITS.serializedBytes} bytes`),
    );
  });

  it("rejects persistence fields in the ergonomic draft", () => {
    // Nesting is how creation expresses hierarchy; a parent id would be a second
    // way to say the same thing, and the two could disagree.
    assert.throws(
      () => normalizeWorkPlanDraft({ title: "No parents", tasks: [{ title: "Task", parentId: "other" }] }),
      /tasks\[0\]\.parentId is not accepted/,
    );
    assert.throws(
      () => normalizeWorkPlanDraft({ title: "No timestamps", tasks: [{ title: "Task", updatedAt: "now" }] }),
      /tasks\[0\]\.updatedAt is not accepted/,
    );
  });

  it("creates a plan that already carries its dependencies", () => {
    const plan = normalizeWorkPlanDraft({
      title: "Ship it",
      tasks: [
        { id: "design", title: "Design" },
        { id: "build", title: "Build" },
        { id: "ship", title: "Ship", dependsOn: ["design", "build"] },
      ],
    });
    assert.deepEqual(plan.tasks.map((task) => task.dependsOn), [[], [], ["design", "build"]]);
  });

  it("resolves a dependency on a task declared further down", () => {
    // A plan is written in the order the work reads, not in dependency order.
    const plan = normalizeWorkPlanDraft({
      title: "Backwards",
      tasks: [{ id: "ship", title: "Ship", dependsOn: ["build"] }, { id: "build", title: "Build" }],
    });
    assert.deepEqual(plan.tasks[0].dependsOn, ["build"]);
  });

  it("names the dependency it cannot resolve", () => {
    // The whole point of the change: the model must be told which identifier is
    // wrong, not that some branch of a union rejected the call.
    assert.throws(
      () => normalizeWorkPlanDraft({
        title: "Invented",
        tasks: [{ title: "First" }, { title: "Second", dependsOn: ["task_1"] }],
      }),
      /unknown dependency: task_1/,
    );
  });

  it("preserves generic successful, unsuccessful, and supporting evidence", () => {
    const plan = validateWorkPlan({
      ...base(),
      tasks: [{
        ...base().tasks[0],
        evidence: [
          { id: "unit", type: "test", result: "passed", summary: "Unit tests passed" },
          { id: "lint", type: "command", result: "failed", summary: "Lint found an error" },
          { id: "probe", type: "external-check", result: "inconclusive", summary: "Service timed out" },
          { id: "report", type: "file", result: "informational", reference: { uri: "workspace:reports/check.json", label: "Check report" } },
        ],
      }],
    });

    assert.deepEqual(plan.tasks[0].evidence, [
      { id: "unit", type: "test", result: "passed", summary: "Unit tests passed" },
      { id: "lint", type: "command", result: "failed", summary: "Lint found an error" },
      { id: "probe", type: "external-check", result: "inconclusive", summary: "Service timed out" },
      { id: "report", type: "file", result: "informational", reference: { uri: "workspace:reports/check.json", label: "Check report" } },
    ]);
  });

  it("rejects invalid or duplicate evidence atomically", () => {
    const planWith = (evidence: unknown[]) => ({
      ...base(),
      tasks: [{ ...base().tasks[0], evidence }],
    });

    for (const [evidence, message] of [
      [[{ id: "bad", type: "test", result: "unknown", summary: "No" }], /evidence\[0\]\.result must be one of/],
      [[{ id: "bad", type: " ", result: "passed", summary: "No" }], /evidence\[0\]\.type must be a non-empty string/],
      [[{ id: "bad", type: "test", result: "passed" }], /evidence\[0\] requires summary or reference/],
      [[
        { id: "same", type: "test", result: "failed", summary: "First" },
        { id: "same", type: "test", result: "passed", summary: "Second" },
      ], /duplicate evidence id: same/],
    ] as const) {
      assert.throws(() => validateWorkPlan(planWith(evidence as unknown[])), message);
    }
  });

  it("enforces evidence collection and field limits before the whole-plan limit", () => {
    const planWith = (evidence: unknown[]) => ({
      ...base(),
      tasks: [{ ...base().tasks[0], evidence }],
    });
    assert.throws(
      () => validateWorkPlan(planWith(Array.from({ length: 101 }, (_, index) => ({
        id: `e-${index}`,
        type: "test",
        result: "passed",
        summary: "ok",
      })) )),
      /at most 100 evidence records/,
    );
    assert.throws(
      () => validateWorkPlan(planWith([{ id: "type", type: "x".repeat(101), result: "passed", summary: "ok" }])),
      /evidence\[0\]\.type is longer than 100 characters/,
    );
    assert.throws(
      () => validateWorkPlan(planWith([{ id: "summary", type: "test", result: "passed", summary: "x".repeat(2_001) }])),
      /evidence\[0\]\.summary is longer than 2000 characters/,
    );
  });

  it("accepts changed fields beside the task identifier", () => {
    const plan = normalizeWorkPlanDraft({ title: "P", tasks: [{ id: "a", title: "First" }] });
    const updated = mutateWorkPlan(plan, { action: "update_task", taskId: "a", status: "in_progress" } as never);
    assert.equal(updated?.tasks[0].status, "in_progress");
    assert.equal(updated?.tasks[0].title, "First", "an absent field is not cleared");

    const explicit = mutateWorkPlan(updated, {
      action: "update_task",
      taskId: "a",
      changes: { status: "done" },
      status: "blocked",
    } as never);
    assert.equal(explicit?.tasks[0].status, "done", "an explicit changes object wins");

    assert.throws(
      () => mutateWorkPlan(plan, { action: "update_task", taskId: "a", changes: { id: "b" } }),
      /identity cannot be changed/,
    );
  });

  it("keeps legacy creation, task addition, and replacement compatible", () => {
    const legacy = validateWorkPlan(legacyBase());
    assert.deepEqual(legacy.tasks.map((task) => task.evidence), [[], []]);

    const created = normalizeWorkPlanDraft({ title: "Legacy create", tasks: [{ id: "old", title: "No evidence" }] });
    assert.deepEqual(created.tasks[0].evidence, []);

    const added = mutateWorkPlan(created, {
      action: "add_task",
      task: { id: "also-old", title: "Still no evidence", status: "todo", dependsOn: [], resources: [] },
    });
    assert.deepEqual(added?.tasks[1].evidence, []);

    const replaced = mutateWorkPlan(null, { action: "replace", plan: legacyBase() });
    assert.equal(replaced?.version, 1);
    assert.deepEqual(replaced?.tasks.map((task) => task.evidence), [[], []]);
  });

  it("replaces and clears evidence without inferring task status", () => {
    const original = base();
    const recorded = mutateWorkPlan(original, {
      action: "set_evidence",
      taskId: "build",
      evidence: verificationEvidence(),
    });
    assert.equal(recorded?.tasks[1].status, "in_progress", "failed evidence does not block the task");
    assert.deepEqual(recorded?.tasks[1].evidence, verificationEvidence());
    assert.deepEqual(original, base(), "the input plan remains immutable");

    const passed = mutateWorkPlan(recorded, {
      action: "set_evidence",
      taskId: "build",
      evidence: [{ id: "tests", type: "test", result: "passed", summary: "All tests passed" }],
    });
    assert.equal(passed?.tasks[1].status, "in_progress", "passing evidence does not complete the task");

    const cleared = mutateWorkPlan(recorded, { action: "set_evidence", taskId: "build", evidence: [] });
    assert.deepEqual(cleared?.tasks[1].evidence, []);
    assert.equal(cleared?.tasks[1].status, "in_progress");

    const completed = mutateWorkPlan(base(), {
      action: "update_task",
      taskId: "build",
      changes: { status: "done" },
    });
    assert.deepEqual(completed?.tasks[1].evidence, [], "completion does not fabricate evidence");
  });

  it("refuses missing or invalid evidence replacements without altering prior evidence", () => {
    const plan = mutateWorkPlan(base(), {
      action: "set_evidence",
      taskId: "build",
      evidence: verificationEvidence(),
    })!;
    assert.throws(
      () => mutateWorkPlan(plan, { action: "set_evidence", evidence: [] } as never),
      /action=set_evidence requires taskId/,
    );
    assert.throws(
      () => mutateWorkPlan(plan, { action: "set_evidence", taskId: "build" } as never),
      /action=set_evidence requires evidence/,
    );
    assert.throws(
      () => mutateWorkPlan(plan, {
        action: "update_task",
        taskId: "build",
        changes: { evidence: [] },
      } as never),
      /evidence cannot be changed through update_task; use action=set_evidence/,
    );
    assert.throws(
      () => mutateWorkPlan(plan, {
        action: "set_evidence",
        taskId: "build",
        evidence: [
          ...verificationEvidence(),
          { id: "invalid", type: "test", result: "failed" },
        ],
      }),
      /evidence\[2\] requires summary or reference/,
    );
    assert.deepEqual(plan.tasks[1].evidence, verificationEvidence());
  });

  it("preserves evidence through every unrelated task mutation", () => {
    const plan = mutateWorkPlan(base(), {
      action: "set_evidence",
      taskId: "build",
      evidence: verificationEvidence(),
    })!;
    const expected = JSON.stringify(plan.tasks[1].evidence);
    const mutations = [
      { action: "update_task", taskId: "build", changes: { title: "Build carefully", status: "blocked", statusReason: "Waiting" } },
      { action: "move_task", taskId: "build", parentId: "analyse" },
      { action: "set_dependencies", taskId: "build", dependsOn: [] },
      { action: "set_resources", taskId: "build", resources: [{ uri: "workspace:src/other.ts" }] },
      { action: "add_task", task: { id: "verify", title: "Verify", status: "todo", dependsOn: [], resources: [] } },
      { action: "remove_task", taskId: "analyse" },
    ] as const;
    for (const mutation of mutations) {
      const next = mutateWorkPlan(plan, mutation as never);
      assert.equal(JSON.stringify(next?.tasks.find((task) => task.id === "build")?.evidence), expected, JSON.stringify(mutation));
    }
  });

  it("refuses an action whose own argument is missing, by name", () => {
    // The published schema makes every per-action argument optional, so that a
    // wrong property is answered by naming it rather than by ten branch
    // failures. The requirement itself has to be checked here — without it a
    // remove_task with no taskId looked up index -1, changed nothing, and was
    // reported to the model as a successful removal.
    const plan = normalizeWorkPlanDraft({ title: "P", tasks: [{ id: "a", title: "A" }] });
    for (const [mutation, message] of [
      [{ action: "remove_task" }, /action=remove_task requires taskId/],
      [{ action: "move_task", parentId: "a" }, /action=move_task requires taskId/],
      [{ action: "set_dependencies", dependsOn: ["a"] }, /action=set_dependencies requires taskId/],
      [{ action: "set_resources", resources: [] }, /action=set_resources requires taskId/],
      [{ action: "set_evidence", evidence: [] }, /action=set_evidence requires taskId/],
      [{ action: "update_task", status: "done" }, /action=update_task requires taskId/],
      [{ action: "add_task" }, /action=add_task requires task/],
      [{ action: "update_task", taskId: "a" }, /requires at least one changed field/],
    ] as const) {
      assert.throws(() => mutateWorkPlan(plan, mutation as never), message, JSON.stringify(mutation));
    }
    assert.throws(() => mutateWorkPlan(null, { action: "replace" } as never), /action=replace requires plan/);
    assert.throws(
      () => mutateWorkPlan(null, { action: "create", tasks: [{ title: "A" }] } as never),
      /action=create requires title/,
    );
  });

  it("honours a task id the agent supplies and generates the rest", () => {
    let next = 0;
    const plan = normalizeWorkPlanDraft(
      {
        title: "Multi-user port",
        tasks: [
          { id: "auth", title: "Authentication", subtasks: [{ title: "Sessions" }, { id: "tokens", title: "Tokens" }] },
          { title: "Storage" },
        ],
      },
      { nextId: () => `id-${(next += 1)}`, now: () => "2026-08-23T19:00:00.000Z" },
    );
    assert.deepEqual(plan.tasks.map((task) => task.id), ["auth", "id-2", "tokens", "id-3"]);
    assert.deepEqual(plan.tasks.map((task) => task.parentId), [undefined, "auth", "auth", undefined]);
    // The identity it chose is the one later mutations address.
    const updated = mutateWorkPlan(plan, { action: "update_task", taskId: "tokens", changes: { status: "done" } });
    assert.equal(updated?.tasks.find((task) => task.id === "tokens")?.status, "done");
  });

  it("rejects a duplicate supplied id without persisting anything", () => {
    assert.throws(
      () => normalizeWorkPlanDraft({
        title: "Collision",
        tasks: [{ id: "same", title: "First" }, { id: "same", title: "Second" }],
      }),
      /duplicate task id: same/,
    );
  });

  it("keeps task identity while editing and moving", () => {
    const edited = mutateWorkPlan(base(), { action: "update_task", taskId: "build", changes: { title: "Build safely", status: "done" } });
    assert.equal(edited?.tasks[1].id, "build");
    assert.equal(edited?.tasks[1].title, "Build safely");
    const moved = mutateWorkPlan(edited, { action: "move_task", taskId: "build", parentId: "analyse" });
    assert.equal(moved?.tasks[1].parentId, "analyse");
  });

  it("keeps every unspecified field in a typed partial update", () => {
    const next = mutateWorkPlan(base(), {
      action: "update_task",
      taskId: "build",
      changes: { title: "Build carefully" },
    });
    assert.deepEqual(next?.tasks[1], {
      ...base().tasks[1],
      title: "Build carefully",
    });
  });

  it("progressively decomposes a task without changing its identity", () => {
    const next = mutateWorkPlan(base(), {
      action: "add_task",
      task: { id: "verify", title: "Verify", status: "todo", parentId: "build", dependsOn: [], resources: [] },
    });
    assert.equal(next?.tasks.find((task) => task.id === "build")?.title, "Build");
    assert.equal(next?.tasks.find((task) => task.id === "verify")?.parentId, "build");
  });

  it("keeps status unchanged when an explicit Work Plan operation only reads it", () => {
    const current = base();
    assert.deepEqual(mutateWorkPlan(current, { action: "get" }), current);
    assert.equal(current.tasks[1].status, "in_progress");
  });

  it("clears optional task text through JSON null", () => {
    const blocked = mutateWorkPlan(base(), {
      action: "update_task",
      taskId: "build",
      changes: { description: "Still working", status: "blocked", statusReason: "Waiting" },
    });
    const reopened = mutateWorkPlan(blocked, {
      action: "update_task",
      taskId: "build",
      changes: { description: null, status: "in_progress", statusReason: null },
    });
    assert.equal(reopened?.tasks[1].description, undefined);
    assert.equal(reopened?.tasks[1].statusReason, undefined);
  });

  it("promotes a task to the root when update_task clears parentId with JSON null", () => {
    const nested = mutateWorkPlan(base(), { action: "move_task", taskId: "build", parentId: "analyse" });
    const promoted = mutateWorkPlan(nested, {
      action: "update_task",
      taskId: "build",
      changes: { parentId: null },
    });
    assert.equal(promoted?.tasks[1].parentId, undefined);
  });

  it("rejects duplicate resource URIs before they reach keyed UI rows", () => {
    assert.throws(
      () => mutateWorkPlan(base(), {
        action: "set_resources",
        taskId: "build",
        resources: [{ uri: "workspace:a" }, { uri: "workspace:a", label: "duplicate" }],
      }),
      /duplicate resource URI/,
    );
  });

  it("rejects invalid hierarchy and dependency cycles without changing the input", () => {
    const plan = base();
    assert.throws(() => mutateWorkPlan(plan, { action: "move_task", taskId: "analyse", parentId: "missing" }), /unknown parent/);
    assert.throws(() => mutateWorkPlan(plan, { action: "set_dependencies", taskId: "analyse", dependsOn: ["build"] }), /dependency cycle/);
    assert.deepEqual(plan, base());
  });

  it("rejects a duplicate add_task identity without changing the plan", () => {
    const plan = base();
    assert.throws(
      () => mutateWorkPlan(plan, {
        action: "add_task",
        task: { id: "build", title: "Duplicate", status: "todo", dependsOn: [], resources: [] },
      }),
      /duplicate task id: build/,
    );
    assert.deepEqual(plan, base());
  });

  it("keeps normalized version-1 replacement compatible", () => {
    assert.deepEqual(mutateWorkPlan(null, { action: "replace", plan: base() }), base());
  });

  it("rejects a plan whose aggregate serialized state is too large", () => {
    const oversized = {
      ...base(),
      tasks: Array.from({ length: 130 }, (_, index) => ({
        id: `task-${index}`,
        title: `Task ${index}`,
        description: "x".repeat(4_000),
        status: "todo",
        dependsOn: [],
        resources: [],
      })),
    };
    assert.throws(
      () => validateWorkPlan(oversized),
      new RegExp(`larger than ${WORK_PLAN_LIMITS.serializedBytes} bytes`),
    );
    assert.ok(WORK_PLAN_LIMITS.serializedBytes <= 64 * 1024, "a get must not refill a compacted model context");
  });

  it("removes descendants and cleans dependencies atomically", () => {
    const nested = validateWorkPlan({ ...base(), tasks: [...base().tasks, { id: "verify", title: "Verify", status: "todo", parentId: "build", dependsOn: ["build"], resources: [] }] });
    const next = mutateWorkPlan(nested, { action: "remove_task", taskId: "build" });
    assert.deepEqual(next?.tasks.map((task) => task.id), ["analyse"]);
  });
});

describe("Work Plan persistence", () => {
  it("recognises equivalent relative and canonical session paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-work-plan-path-"));
    try {
      const sessionFile = path.join(root, "session.jsonl");
      await fs.writeFile(sessionFile, "");
      const relative = path.relative(process.cwd(), sessionFile);
      assert.equal(sameSessionFile(relative, await fs.realpath(sessionFile)), true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("loads a legacy version-1 sidecar with empty canonical evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-work-plan-legacy-"));
    try {
      const sessionFile = path.join(root, "legacy.jsonl");
      await fs.writeFile(workPlanPath(sessionFile), `${JSON.stringify(legacyBase(), null, 2)}\n`);
      const restored = await loadWorkPlan(sessionFile);
      assert.equal(restored?.version, 1);
      assert.deepEqual(restored?.tasks.map((task) => task.evidence), [[], []]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("loads absence, persists atomically, copies forks, and deletes with the session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-work-plan-"));
    try {
      const source = path.join(root, "source.jsonl");
      const fork = path.join(root, "fork.jsonl");
      const sourcePlan = mutateWorkPlan(base(), {
        action: "set_evidence",
        taskId: "build",
        evidence: verificationEvidence(),
      })!;
      assert.equal(await loadWorkPlan(source), null);
      await applyWorkPlanMutation(source, { action: "replace", plan: sourcePlan });
      assert.deepEqual((await loadWorkPlan(source))?.tasks[1].evidence, verificationEvidence());
      await copyWorkPlan(source, fork);
      const forkEvidence = [{ id: "probe", type: "external-check", result: "inconclusive" as const, summary: "Timed out" }];
      await applyWorkPlanMutation(fork, { action: "set_evidence", taskId: "build", evidence: forkEvidence });
      assert.deepEqual((await loadWorkPlan(source))?.tasks[1].evidence, verificationEvidence(), "fork evidence stays isolated from source");
      assert.deepEqual((await loadWorkPlan(fork))?.tasks[1].evidence, forkEvidence);

      const sourceEvidence = [{ id: "tests", type: "test", result: "passed" as const, summary: "All pass" }];
      await applyWorkPlanMutation(source, { action: "set_evidence", taskId: "build", evidence: sourceEvidence });
      assert.deepEqual((await loadWorkPlan(source))?.tasks[1].evidence, sourceEvidence);
      assert.deepEqual((await loadWorkPlan(fork))?.tasks[1].evidence, forkEvidence, "source evidence stays isolated from fork");

      const beforeRefusal = await fs.readFile(workPlanPath(source), "utf8");
      await assert.rejects(
        applyWorkPlanMutation(source, {
          action: "set_evidence",
          taskId: "build",
          evidence: [...sourceEvidence, { id: "invalid", type: "test", result: "failed" }],
        }),
        /evidence\[1\] requires summary or reference/,
      );
      assert.equal(await fs.readFile(workPlanPath(source), "utf8"), beforeRefusal, "invalid evidence does not rewrite the sidecar");
      assert.deepEqual((await loadWorkPlan(source))?.tasks[1].evidence, sourceEvidence);

      await deleteWorkPlan(source);
      assert.equal(await loadWorkPlan(source), null);
      assert.equal(await fs.stat(workPlanPath(source)).catch(() => null), null);
      assert.deepEqual((await fs.readdir(root)).filter((name) => name.includes(".tmp")), []);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not create a sidecar when any nested creation task is invalid", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-work-plan-invalid-create-"));
    try {
      const sessionFile = path.join(root, "session.jsonl");
      await assert.rejects(
        applyWorkPlanMutation(sessionFile, {
          action: "create",
          title: "Invalid",
          tasks: [{ title: "Valid" }, { title: "" }],
        }),
        /task.title must be a non-empty string/,
      );
      assert.equal(await loadWorkPlan(sessionFile), null);
      assert.equal(await fs.stat(workPlanPath(sessionFile)).catch(() => null), null);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("work_plan tool", () => {
  it("publishes bounded action-specific schemas, in both tools, with no unconstrained payload", () => {
    for (const definition of [createWorkPlanToolDefinition(), createWorkPlanExtendedToolDefinition()]) {
      const schema = definition.parameters as unknown as Record<string, unknown>;
      const emptySchemas: string[] = [];
      const walk = (value: unknown, at: string): void => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return;
        const record = value as Record<string, unknown>;
        if (Object.keys(record).length === 0) emptySchemas.push(at);
        for (const [key, child] of Object.entries(record)) {
          if (Array.isArray(child)) child.forEach((item, index) => walk(item, `${at}.${key}[${index}]`));
          else walk(child, `${at}.${key}`);
        }
      };
      walk(schema, `$${definition.name}`);
      assert.deepEqual(emptySchemas, [], `unconstrained schema nodes: ${emptySchemas.join(", ")}`);

      // One object, not a union: pi validates a call against the whole schema and
      // reports every branch that rejected it, so a union answers one wrong
      // property with one "must be equal to constant" per action the caller never
      // asked for — and never names the property. See the tool's own comment.
      assert.equal(schema.anyOf, undefined, "the root is a single object, not a union of actions");
      assert.equal(schema.type, "object");
      assert.deepEqual(schema.required, ["action"]);
      assert.equal(schema.additionalProperties, false);
    }

    const common = (createWorkPlanToolDefinition().parameters as unknown as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    const extended = (createWorkPlanExtendedToolDefinition().parameters as unknown as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(common.action.enum, [...WORK_PLAN_COMMON_ACTIONS]);
    assert.deepEqual(extended.action.enum, [...WORK_PLAN_EXTENDED_ACTIONS]);

    // Each operation-specific argument says which actions use it, since neither
    // schema separates them into branches.
    for (const [properties, field, action] of [
      [common, "title", /create/], [common, "tasks", /create/], [common, "task", /add_task/],
      [common, "taskId", /update_task/], [common, "parentId", /move_task/],
      [extended, "plan", /replace/], [extended, "dependsOn", /set_dependencies/],
      [extended, "resources", /set_resources/], [extended, "evidence", /set_evidence/],
    ] as const) {
      assert.match(String(properties[field].description), action, `${field} names the action that uses it`);
    }

    let tasks = common.tasks;
    assert.match(String(tasks.description), /500 tasks total.*65536 serialized bytes/);
    for (let depth = 1; depth <= 2; depth += 1) {
      assert.equal(tasks.maxItems, WORK_PLAN_LIMITS.tasks, `task collection at depth ${depth} exposes its ceiling`);
      const draft = tasks.items as Record<string, unknown>;
      assert.deepEqual(draft.required, ["title"]);
      const taskProperties = draft.properties as Record<string, Record<string, unknown>>;
      assert.deepEqual(taskProperties.status.enum, ["todo", "in_progress", "done", "blocked", "needs_review"]);
      // A plan that has dependencies says so where it is written, in one call.
      assert.equal(taskProperties.dependsOn.type, "array");
      assert.match(String(taskProperties.dependsOn.description), /same call/);
      // ...and what a task acquires later is not described here. The collections are
      // the largest shapes in this schema and they belong to the tool that sets them.
      assert.equal(taskProperties.evidence, undefined, `creation at depth ${depth} does not advertise evidence`);
      assert.equal(taskProperties.resources, undefined, `creation at depth ${depth} does not advertise resources`);
      if (depth < 2) tasks = taskProperties.subtasks;
      else assert.equal(taskProperties.subtasks, undefined, "subtasks cannot nest again");
    }

    // `update_task` takes its fields beside `taskId`. The `changes` wrapper said the
    // same thing a second way and is no longer advertised — the normaliser still
    // honours one that arrives, but the schema stops paying 1.2k characters for it.
    assert.equal(common.changes, undefined, "the redundant changes wrapper is not published");
    for (const field of ["description", "statusReason", "parentId"]) {
      assert.ok(
        (common[field].anyOf as Array<Record<string, unknown>>).some((candidate) => candidate.type === "null"),
        `${field} declares JSON null clearing`,
      );
    }
  });

  it("gives every action exactly one home, and says where when asked of the wrong tool", async () => {
    // Checked against the enumerated actions rather than a list written here: a new
    // action must land in one of the tools on purpose, not be forgotten by both.
    const homes = new Map<string, string[]>();
    for (const action of WORK_PLAN_ACTIONS) {
      const carriers = [
        ...(WORK_PLAN_COMMON_ACTIONS.includes(action as never) ? ["work_plan"] : []),
        ...(WORK_PLAN_EXTENDED_ACTIONS.includes(action as never) ? ["work_plan_extended"] : []),
      ];
      homes.set(action, carriers);
    }
    for (const [action, carriers] of homes) {
      assert.equal(carriers.length, 1, `${action} is carried by exactly one tool, not ${carriers.length}`);
    }

    const refused = await createWorkPlanToolDefinition().execute(
      "call-wrong-tool",
      { action: "set_evidence", taskId: "build", evidence: [] },
      undefined,
      undefined,
      { sessionManager: { getSessionFile: () => "/nowhere/session.jsonl" } } as never,
    );
    assert.equal(refused.isError, true);
    const text = (refused.content as Array<{ text: string }>)[0].text;
    assert.match(text, /set_evidence/, "the refusal names the action");
    assert.match(text, /work_plan_extended/, "and the tool that carries it");
  });

  it("keeps each published definition under its context budget", () => {
    // The schemas are sent on every request of every conversation. `work_plan` is the
    // one a session with no plan pays for, so it carries the tighter ceiling; the
    // extended tool is only published where its actions are possible. Raising either
    // is allowed, raising one silently is what this prevents. Re-measure with
    // `npx tsx server/scripts/probe-context-baseline.mts`.
    for (const [definition, budget] of [
      [createWorkPlanToolDefinition(), 5_200],
      [createWorkPlanExtendedToolDefinition(), 6_000],
    ] as const) {
      const size = JSON.stringify(definition).length;
      assert.ok(size <= budget, `${definition.name} is ${size} characters, over its ${budget} budget`);
    }
  });

  it("publishes finite evidence schemas where evidence can be set", () => {
    // Creation and addition no longer describe evidence at all; replacement and
    // set_evidence do, and both live in the extended tool. Every one of them is
    // bounded — an unbounded collection is how a plan grows past its own ceiling.
    const schema = createWorkPlanExtendedToolDefinition().parameters as unknown as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const planTasks = (properties.plan.properties as Record<string, Record<string, unknown>>).tasks;
    const replacementEvidence = ((planTasks.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>).evidence;
    for (const evidence of [replacementEvidence, properties.evidence]) {
      assert.equal(evidence.type, "array");
      assert.equal(evidence.maxItems, WORK_PLAN_LIMITS.evidencePerTask);
      const record = evidence.items as Record<string, unknown>;
      assert.equal(record.additionalProperties, false);
      assert.deepEqual(record.required, ["id", "type", "result"]);
      const recordProperties = record.properties as Record<string, Record<string, unknown>>;
      assert.deepEqual(recordProperties.result.enum, ["passed", "failed", "inconclusive", "informational"]);
      assert.equal(recordProperties.result.anyOf, undefined, "results use one enum node");
      assert.equal(recordProperties.type.maxLength, WORK_PLAN_LIMITS.evidenceType);
      assert.equal(recordProperties.summary.maxLength, WORK_PLAN_LIMITS.evidenceSummary);
      assert.equal((recordProperties.reference as Record<string, unknown>).additionalProperties, false);
    }
  });

  it("still normalises a creation draft that carries evidence, though it no longer advertises it", () => {
    // The advertisement went; the contract did not. A client written against the
    // previous schema keeps working, which is what makes this a cheaper prompt
    // rather than a breaking change.
    const plan = mutateWorkPlan(null, {
      action: "create",
      title: "Ship it",
      tasks: [{ title: "Build", evidence: [{ id: "t", type: "test", result: "passed", summary: "green" }], resources: [{ uri: "workspace:src/index.ts" }] }],
    } as never);
    assert.equal(plan?.tasks[0].evidence.length, 1);
    assert.equal(plan?.tasks[0].resources.length, 1);
  });

  it("publishes no pattern at all, so there is none to anchor", () => {
    // There used to be 48 fields carrying one anchored regex, whose only job was to
    // reject whitespace-only text. Anchoring was forced on it by providers that
    // compile a grammar from the schema for constrained decoding and refuse an
    // unanchored `pattern` outright — a 400 on every message, once per occurrence.
    //
    // The cheaper answer is not to send a regex the handler duplicates: 73 copies of
    // it in the published schema came to ~2.5k characters, ~640 tokens on every turn
    // of every conversation, plan or no plan. Blankness is checked below, where the
    // failure can name the field.
    const patterns: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      const record = value as Record<string, unknown>;
      if (typeof record.pattern === "string") patterns.push(record.pattern);
      for (const child of Object.values(record)) {
        if (Array.isArray(child)) child.forEach(walk);
        else walk(child);
      }
    };
    walk(createWorkPlanToolDefinition().parameters);
    assert.deepEqual(patterns, [], "no pattern is published, so no provider can reject one for being unanchored");
  });

  it("still refuses blank text, in the mutation rather than the schema", () => {
    // What the pattern was there for. The schema now accepts a blank string and the
    // normaliser refuses it — naming the field, which a schema error never did.
    for (const [current, mutation, field] of [
      [null, { action: "create", title: " ", tasks: [{ title: "First" }] }, /title/],
      [null, { action: "create", title: "Ship", tasks: [{ title: "\t\n" }] }, /title/],
      [base(), { action: "update_task", taskId: "build", description: "  " }, /description/],
      [base(), { action: "set_resources", taskId: "build", resources: [{ uri: " " }] }, /uri/],
      [
        base(),
        { action: "set_evidence", taskId: "build", evidence: [{ id: "t", type: " ", result: "passed", summary: "ok" }] },
        /type/,
      ],
    ] as const) {
      assert.throws(() => mutateWorkPlan(current as never, mutation as never), (error: Error) => {
        assert.match(error.message, field);
        assert.match(error.message, /non-empty/);
        return true;
      }, `blank text refused: ${JSON.stringify(mutation)}`);
    }

    // ...and the schema still rejects the empty string, which costs one keyword.
    const validator = Compile(createWorkPlanToolDefinition().parameters as never);
    assert.equal(validator.Check({ action: "create", title: "", tasks: [{ title: "First" }] }), false, "empty title");
    assert.equal(validator.Check({ action: "create", title: "Ship it", tasks: [{ title: "First" }] }), true);
  });

  it("answers a refused property by naming it, and says nothing about other actions", () => {
    // The failure this change exists for. pi validates a tool call against the
    // published schema and hands the model every error it collects, so the shape
    // of that error list *is* the repair instruction. Compiling here is what pi
    // itself does (pi-ai/utils/validation.js).
    const validator = Compile(createWorkPlanToolDefinition().parameters as never);
    const errors = [...validator.Errors({
      action: "create",
      title: "Ship it",
      tasks: [{ title: "First" }, { title: "Second", priority: "high" }],
    })].map((error) => `${error.instancePath}: ${error.message}`);

    assert.deepEqual(errors.map((error) => error.split(":")[0]), ["/tasks/1"], `one error, at the offending task: ${errors.join(" | ")}`);
    assert.ok(
      !errors.some((error) => /equal to constant/.test(error)),
      `no branch of an unrequested action reports itself: ${errors.join(" | ")}`,
    );

    // An unknown action fails once, against the enumerated list, rather than once
    // per accepted value.
    const unknown = [...validator.Errors({ action: "frobnicate" })];
    assert.equal(unknown.length, 1);
    assert.match(unknown[0].message, /one of the allowed values/);
  });

  it("refuses task identity supplied at either level of an update", () => {
    const validator = Compile(createWorkPlanToolDefinition().parameters as never);
    assert.equal(validator.Check({ action: "update_task", taskId: "a", id: "b" }), false, "identity beside the identifier");
    assert.equal(validator.Check({ action: "update_task", taskId: "a", changes: { id: "b" } }), false, "identity inside changes");
    assert.equal(validator.Check({ action: "update_task", taskId: "a", status: "done" }), true);
  });

  it("ships a worked example the model can copy", () => {
    const tool = createWorkPlanToolDefinition();
    const example = (tool.promptGuidelines ?? []).find((line) => line.includes('"action":"create"'));
    assert.ok(example, "the guidelines carry a literal creation call");
    // An example that does not survive the tool's own validator is worse than
    // none: it teaches a shape that will be refused.
    const call = JSON.parse(example.slice(example.indexOf("{"), example.lastIndexOf("}") + 1)) as {
      action: string;
      title: string;
      tasks: { id?: string; dependsOn?: string[]; subtasks?: unknown[] }[];
    };
    const plan = normalizeWorkPlanDraft({ title: call.title, tasks: call.tasks });
    assert.equal(plan.tasks.filter((task) => task.dependsOn.length > 0).length, 1, "the example shows a dependency");
    assert.equal(plan.tasks.filter((task) => task.parentId !== undefined).length, 1, "the example shows a subtask");
  });

  it("ships valid evidence guidance with explicit replacement and status independence", () => {
    // On the tool that carries evidence: guidance follows the actions it describes,
    // so a session that cannot set evidence is not told how to.
    const tool = createWorkPlanExtendedToolDefinition();
    const example = (tool.promptGuidelines ?? []).find((line) => line.includes('"action":"set_evidence"'));
    assert.ok(example, "the guidelines carry a literal evidence call");
    const call = JSON.parse(example.slice(example.indexOf("{"), example.lastIndexOf("}") + 1));
    const validator = Compile(tool.parameters as never);
    assert.equal(validator.Check(call), true, "the evidence example passes the published schema");
    assert.deepEqual(call.evidence.map((record: { result: string }) => record.result), ["passed", "failed"]);

    const guidance = (tool.promptGuidelines ?? []).join(" ");
    assert.match(guidance, /replaces the complete evidence collection/i);
    assert.match(guidance, /include prior failures/i);
    assert.match(guidance, /Evidence never changes task status/i);
    assert.match(guidance, /status changes never create evidence/i);

    assert.match(WORK_PLAN_SYSTEM_GUIDANCE, /failed or inconclusive checks/i);
    assert.match(WORK_PLAN_SYSTEM_GUIDANCE, /does not record evidence automatically/i);
    assert.match(WORK_PLAN_SYSTEM_GUIDANCE, /Evidence and task status are independent/i);
    assert.match(WORK_PLAN_SYSTEM_GUIDANCE, /completion does not fabricate evidence/i);
  });

  it("keeps behavioral selection guidance out of the mechanical tool contract", () => {
    const tool = createWorkPlanToolDefinition();
    const guidance = [tool.description, ...(tool.promptGuidelines ?? [])].join(" ");
    assert.match(guidance, /persistent Work Plan/i);
    assert.doesNotMatch(guidance, /non-trivial|resume|reconcile|before declaring|skip/i);
  });

  it("returns authoritative details and refuses a partial invalid mutation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-work-plan-tool-"));
    try {
      const sessionFile = path.join(root, "session.jsonl");
      await fs.writeFile(sessionFile, "original conversation\n");
      const tool = createWorkPlanToolDefinition();
      // `replace` is the extended tool's; both write through the same store, which is
      // the point of the split being in what is published rather than in what runs.
      const extended = createWorkPlanExtendedToolDefinition();
      const ctx = { sessionManager: { getSessionFile: () => sessionFile } } as never;
      const replaced = await extended.execute("call-1", { action: "replace", plan: base() }, undefined, undefined, ctx);
      assert.equal((replaced.details as { type: string }).type, "work_plan");
      await fs.writeFile(sessionFile, "compacted conversation summary\n");
      const restored = await tool.execute("call-resume", { action: "get" }, undefined, undefined, ctx);
      assert.deepEqual((restored.details as { plan: WorkPlan }).plan, base());
      const modelContent = (restored.content[0] as { text: string }).text;
      assert.ok(
        Buffer.byteLength(modelContent) <= WORK_PLAN_LIMITS.serializedBytes + 512,
        "the model-facing response stays within the plan's compact context budget",
      );
      assert.match(modelContent, /\"id\":\"build\"/);
      assert.match(modelContent, /workspace:src\/index\.ts/);
      const refused = await tool.execute("call-2", { action: "move_task", taskId: "build", parentId: "missing" }, undefined, undefined, ctx);
      assert.equal(refused.isError, true);
      assert.deepEqual(await loadWorkPlan(sessionFile), base());
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates once from a compact hierarchy and returns the bounded authoritative plan", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-work-plan-create-"));
    try {
      const sessionFile = path.join(root, "session.jsonl");
      await fs.writeFile(sessionFile, "conversation\n");
      const tool = createWorkPlanToolDefinition();
      const ctx = { sessionManager: { getSessionFile: () => sessionFile } } as never;
      const created = await tool.execute("create-1", {
        action: "create",
        title: "Deliver",
        tasks: [{ title: "Build", subtasks: [{ title: "Verify", status: "needs_review" }] }],
      }, undefined, undefined, ctx);
      assert.notEqual(created.isError, true);
      const plan = (created.details as { plan: WorkPlan }).plan;
      assert.equal(plan.version, 1);
      assert.equal(plan.tasks.length, 2);
      assert.equal(plan.tasks[1].parentId, plan.tasks[0].id);
      assert.match((created.content[0] as { text: string }).text, new RegExp(`"id":"${plan.tasks[0].id}"`));
      assert.ok(Buffer.byteLength((created.content[0] as { text: string }).text) <= WORK_PLAN_LIMITS.serializedBytes + 512);

      const refused = await tool.execute("create-2", {
        action: "create",
        title: "Overwrite",
        tasks: [{ title: "Replace existing state" }],
      }, undefined, undefined, ctx);
      assert.equal(refused.isError, true);
      assert.match((refused.content[0] as { text: string }).text, /already has a Work Plan.*replace/i);
      assert.deepEqual(await loadWorkPlan(sessionFile), plan);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("publishing the extended tool", () => {
  /**
   * A stand-in for the SDK session, exposing only what publication touches. The real
   * `setActiveToolsByName` rebuilds the system prompt around the set it is given —
   * which is why withholding a tool withholds its schema, and why this is worth doing
   * at all.
   */
  function fakeSession(registered: string[], active: string[]) {
    let current = [...active];
    return {
      calls: [] as string[][],
      getToolDefinition: (name: string) => (registered.includes(name) ? ({ name } as never) : undefined),
      getActiveToolNames: () => [...current],
      setActiveToolsByName(names: string[]) {
        current = [...names];
        this.calls.push([...names]);
      },
    };
  }

  /**
   * The real method, on a real `EmbeddedRuntime`, over a stand-in session. Re-implementing
   * it here would test the copy: what has to hold is that *this* code adds and removes the
   * right name and leaves the rest of the set alone.
   */
  function setToolPublished(session: ReturnType<typeof fakeSession>, name: string, published: boolean): boolean {
    const runtime = new EmbeddedRuntime({ session } as never, "/nowhere");
    return runtime.setToolPublished(name, published);
  }

  it("adds the extended tool to the active set and takes nothing else out", () => {
    const session = fakeSession(["read", "work_plan", "work_plan_extended"], ["read", "work_plan"]);
    assert.equal(setToolPublished(session, "work_plan_extended", true), true);
    assert.deepEqual(session.calls, [["read", "work_plan", "work_plan_extended"]]);
  });

  it("withdraws it again when the plan is cleared, leaving the common tool published", () => {
    const session = fakeSession(["read", "work_plan", "work_plan_extended"], ["read", "work_plan", "work_plan_extended"]);
    assert.equal(setToolPublished(session, "work_plan_extended", false), true);
    assert.deepEqual(session.calls, [["read", "work_plan"]]);
  });

  it("does nothing when the set already says what it should", () => {
    // Publication is derived from the plan at every point the plan can change, so it
    // is asked for far more often than it changes. Rebuilding the system prompt each
    // time would invalidate the provider's prefix cache for no reason.
    const session = fakeSession(["work_plan", "work_plan_extended"], ["work_plan"]);
    assert.equal(setToolPublished(session, "work_plan_extended", false), true);
    assert.deepEqual(session.calls, [], "no toolset rebuild");
  });

  it("reports that it could not publish a tool the session never registered", () => {
    const session = fakeSession(["work_plan"], ["work_plan"]);
    assert.equal(setToolPublished(session, "work_plan_extended", true), false);
    assert.deepEqual(session.calls, []);
  });
});
