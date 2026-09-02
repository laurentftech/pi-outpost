## Context

See `proposal.md` for motivation, `specs/work-plan/spec.md` for the behavioral contract, and `specs/model/spec.md` for the authoritative protocol contract. The current Work Plan is a version-1 flat task graph in `shared/src/workPlan.ts`; the same shared value is validated into a session sidecar, copied on fork, restored on session selection, carried in initial/session snapshots, and broadcast in full after accepted mutations. The agent reaches it through one self-describing `work_plan` object schema whose action-specific requirements are enforced by the shared mutator.

The OpenLore orientation identified the shared task validator/normalizer, `createWorkPlanToolDefinition`, the sidecar store, and the session/fork synchronization paths as the relevant surface. Its index was refreshing several Work Plan files, so the design also checked those source files and the current `work-plan` spec directly rather than relying on cached cross-module details.

## Goals / Non-Goals

**Goals:**

- Extend the canonical task value with bounded, provider-neutral evidence that can represent positive, negative, inconclusive, and informational results.
- Keep one validation and normalization path for creation, replacement, mutation, restore, fork, and synchronization.
- Give the agent an explicit atomic mutation for the complete evidence collection while retaining the current single-object tool-schema pattern and legible refusals.
- Preserve version-1 compatibility and the 64 KiB recovery-context ceiling.
- Prove behavior at shared-model, persistence, protocol synchronization, real provider, and running-app agent boundaries.

**Non-Goals:**

- Rendering an evidence or Outcome/Review interface, making evidence user-editable, or adding navigation beyond the existing generic resource resolver.
- Running checks automatically, scraping tool results, linking evidence to transcript events, or changing a task status based on evidence.
- An append-only audit log, evidence history, provider adapters, or an OpenLore integration.

## Decisions

### Evidence is embedded in each canonical task

Add a `WorkPlanEvidence` value and an `evidence: WorkPlanEvidence[]` collection to `WorkPlanTask`. A record has:

- `id`: non-empty bounded identity, unique within the owning task;
- `type`: non-empty bounded free-form kind/source, rather than a provider enum;
- `result`: `passed`, `failed`, `inconclusive`, or `informational`;
- optional `summary`: bounded concise text;
- optional `reference`: the existing `{ uri, label? }` generic resource shape.

Validation requires at least one of `summary` or `reference`. The implementation should add explicit limits of 100 records per task, 100 characters for `type`, and 2,000 characters for `summary`; identifiers and references reuse existing Work Plan bounds. The complete serialized-plan limit remains the final authority.

Embedding was chosen because evidence belongs to a task and all lifecycle paths already move the complete Work Plan. A separate evidence sidecar was rejected because it would introduce cross-file atomicity, fork coordination, and synchronization ordering for no independent lifecycle benefit. Provider-specific unions were rejected because every producer can map to the common type/result/summary/reference shape.

### Preserve version 1 with read-time defaulting

Keep `WorkPlan.version` at `1`. Every task parser and draft normalizer treats an omitted evidence property as `[]`, and canonical values returned from validation contain the array. New creation, normalized task-addition, and replacement schemas expose evidence as optional so calls and sidecars accepted before this change continue to validate. The next mutation naturally writes the canonical evidence-bearing form; no eager sidecar rewrite is needed.

This is an additive compatible extension rather than a semantic replacement of the plan document, so a version-2 migration would add branching and rollback burden without protecting a changed invariant. Requiring evidence on serialized legacy tasks was rejected because it would make existing sessions unloadable.

### One `set_evidence` action owns evidence mutation

Extend `WORK_PLAN_ACTIONS` and `WorkPlanMutation` with `set_evidence`, requiring `taskId` and an `evidence` array. It replaces that task's complete collection, like `set_resources`; an empty array clears it. The mutator clones nested task state, validates every replacement record, preserves all other task fields, and commits only after `validateWorkPlan` accepts the complete next plan.

One replacement action was chosen over provider-flavored actions and over separate add/update/remove operations. It keeps the already-large single tool schema small, gives deterministic correction/removal semantics, and makes atomicity obvious. Stable record IDs still let an agent read-modify-write a collection without confusing repeated checks. The system never filters failed records; removing or replacing them requires an explicit agent mutation.

### Evidence and status have no coupling code path

Evidence parsing and `set_evidence` update only the evidence collection. Existing status mutations continue to rebuild a task while carrying its evidence forward. No validator, store hook, tool-result listener, or prompt logic derives status from evidence or evidence from tool activity. Prompt guidance tells the agent to record verification deliberately and separately reconcile task status.

Keeping independence structural, rather than relying only on prompt wording, prevents a passing check from silently completing work and prevents `done` from becoming a false assertion that verification occurred.

### Reuse the existing full-plan lifecycle and synchronization contract

The sidecar remains the only persisted artifact. Once evidence is part of the validated `WorkPlan`, existing load, atomic persist, copy-on-fork, compaction-independent `get`, initial/session snapshots, and `work_plan_changed` broadcasts carry it without a parallel channel. Protocol exports add the evidence/result types for downstream consumers, while UI components may ignore the new task field in this change.

Lifecycle code should change only if tests reveal a path that reconstructs or narrows tasks. Focused tests must assert actual evidence values—including failed evidence—after restore, fork, reconnect, and multi-client synchronization, rather than only asserting task counts or statuses.

### Keep the agent-facing schema finite and self-describing

Add reusable TypeBox schemas for evidence result, reference, record, and collection. Expose the optional evidence collection in complete task shapes and creation tasks, plus the top-level `evidence` argument used by `set_evidence`. Continue using the single object schema with `additionalProperties: false`; runtime required-argument checks must name `taskId` or `evidence` when absent, and validation errors must retain paths into individual records.

Update the tool description/guidelines with one literal valid `set_evidence` call and an explicit statement that evidence does not alter status. Do not add automatic producers. Because these descriptions influence agent behavior, verification includes a real running-app walkthrough in which an agent is asked to record both a successful and unsuccessful check, followed by reading the authoritative Work Plan. A second adversarial pass should rapidly issue evidence/status changes and switch or fork sessions while checking the DOM/session state for stale or cross-session evidence.

## Risks / Trade-offs

- [Replacement semantics can accidentally omit an older failure] → Describe `set_evidence` as complete replacement, return a legible refusal for malformed lists, and include prompt/test examples that preserve prior records when appending a new result.
- [Evidence inflates the compact operational context returned after resume] → Bound records and fields while preserving the existing 64 KiB serialized-plan ceiling; test rejection at both collection and whole-plan limits.
- [Legacy normalization can drop evidence during unrelated task mutation if nested copies are incomplete] → Centralize evidence parsing/cloning in the shared model and assert that status, move, dependency, resource, and task-update mutations preserve evidence.
- [A failed result could be mistaken for task status] → Use the field name `result`, distinct enums, no coupling logic, explicit prompt language, and bidirectional independence tests.
- [A generic type string is less analytically uniform than a fixed provider taxonomy] → Prefer forward compatibility and keep the four result semantics stable; future producers may establish conventions without changing the persisted schema.
- [Older binaries ignore the additive field and may erase it on a subsequent write after rollback] → No data migration is required, but deployment rollback guidance should preserve sidecars or avoid mutating evidence-bearing sessions until the evidence-capable build is restored.

## Migration Plan

1. Add shared evidence types, bounds, validation/defaulting, deep-copy preservation, and `set_evidence` mutation while retaining version `1`.
2. Extend the typed tool schema, required-argument diagnostics, prompt guidance, and shared protocol exports.
3. Add focused compatibility, atomicity, independence, lifecycle, provider, and synchronization tests; then exercise the tool through the running application and its actual agent boundary.
4. Update Work Plan user/developer documentation to describe evidence and its independence from completion.
5. Deploy without rewriting sidecars. Existing plans gain empty evidence arrays when read and are persisted canonically on their next accepted mutation.

Rollback requires no schema downgrade or database operation. Restore the prior build; preserve evidence-bearing sidecars if evidence must survive the rollback window, because an older build may ignore and later overwrite the additive fields.
