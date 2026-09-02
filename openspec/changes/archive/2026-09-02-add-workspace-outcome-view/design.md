## Context

See `proposal.md` for motivation. Pi-Outpost already keeps the current session's authoritative Work Plan in each server `Workspace`, receives synchronized Work Plan mutations, exposes task evidence through the shared Work Plan model, and can query every repository in that workspace for current file status. The client already has read-only Work Plan task details and file/diff navigators, but these facts are separate and there is no durable review surface.

Workspace content travels only on the WebSocket bound to that workspace. Cross-workspace summaries deliberately contain activity only. Any Outcome protocol must preserve that boundary and must reject a late response after a workspace or session switch. Repository status is asynchronous and may be partially unavailable, while Work Plans and legacy sessions may contain no evidence at all.

## Goals / Non-Goals

**Goals:**

- Build one immutable Outcome snapshot from the current workspace's authoritative structured sources.
- Give each source a common, typed section shape while retaining domain-specific statuses and navigation targets.
- Keep completion, review readiness, and verification as distinct facts with conservative aggregation.
- Reuse the existing Work Plan, file-viewer, and diff interactions for drill-down.
- Make partial source failure and legacy absence first-class states.

**Non-Goals:**

- Cache or persist an Outcome document independently of its sources.
- Interpret transcript prose, rank the quality of work, or approve it.
- Introduce a generic artifact store, arbitrary contributor code loading, OpenLore runtime calls, or external-system adapters.
- Put Outcome content into cross-workspace activity summaries.

## Decisions

### Compose the snapshot on the server when Outcome is requested

Add a workspace-bound `get_outcome` request and a correlated `workspace_outcome` response. Before composition, the server waits for the existing Work Plan synchronization queue, captures the current session identity and plan, and obtains repository status from the workspace's own repository set. The response echoes the request id, workspace root, and session identity. The client accepts it only while all three still match the active request and current snapshot.

The server is the composition boundary because it owns the authoritative plan and repository set and already enforces per-workspace routing. Client-only composition was rejected: it would couple the view to whichever lazy UI requests happened to have completed and would make partial repository failures indistinguishable from empty state. Persisting a generated snapshot was rejected because it would create a second source of truth and a migration problem.

The view requests a fresh snapshot when opened and while open after Work Plan, session, repository-set, or watched file changes. Repeated invalidations are coalesced so a burst of filesystem events produces at most one active refresh followed by one latest-state refresh. The existing content-free `workspace_activity` broadcast remains unchanged.

### Use a closed shared section contract and a server-side contributor registry

Define shared `WorkspaceOutcome`, `OutcomeSection`, and `OutcomeEntry` types. A section carries a stable contributor id, title, numeric display order, one of `available`, `empty`, `partial`, or `unavailable`, and deterministically ordered entries. Entries carry stable ids, source labels, semantic statuses, display fields, and an optional target from a closed union:

- `work-plan-task` with a task id;
- `workspace-file` with a confined relative path;
- `workspace-diff` with a confined relative path;
- `external-url` with an HTTP(S) URL.

The server composer invokes registered contributors in configured order, normalizes their output, and turns a contributor failure into an unavailable section without dropping other sections. Initial contributors are:

1. Work Plan progress, including every task status and status reason;
2. verification evidence, grouped by task and retaining every record;
3. repository changes, grouped by repository with partial failures preserved.

Future sources extend the registry and shared typed contract; they do not inject components, HTML, URLs with arbitrary schemes, or executable action names. A fully open render payload was rejected because it would turn future integrations into a remote UI/action surface and weaken confinement.

### Keep plan progress and verification as separate aggregates

The Work Plan section counts and lists the recorded `todo`, `in_progress`, `done`, `blocked`, and `needs_review` states; it does not infer task completion. Review readiness reuses the existing authoritative predicate and remains distinct from approval.

The evidence contributor computes one verification label using the specification's precedence: `failed`, then `inconclusive`, then `passed`, otherwise `not-recorded`. `informational` records are displayed but do not change `not-recorded` to `passed`. The UI renders these labels directly rather than mapping them to one optimistic overall badge.

A single “successful outcome” boolean was rejected because plan completion, human review, verification, and changed-file state answer different questions. Combining them would either hide adverse evidence or invent policy about what counts as success.

### Represent repository absence and failure explicitly

The repository contributor uses the existing multi-repository status implementation and attributes each file by repository. It returns `empty` only after all known repositories answer with no changes. `no-repository`, global git unavailability, and per-repository failures remain distinct unavailable or partial records. File order is repository then normalized path, with a stable status tie-breaker.

Reusing the existing git status result avoids a second git parser. Treating any empty file array as “clean” was rejected because current partial status behavior can omit a repository that failed.

### Add an Outcome drawer alongside the existing detail drawers

Add a persistent Outcome control in the workspace header. It opens a right-side `OutcomePanel` and is visually marked when the workspace activity is `ready-for-review`, but Outcome remains available for idle, active, and legacy sessions. Outcome, Work Plan, and session analysis drawers are mutually exclusive so they do not overlap.

Activating a task entry closes Outcome and opens the Work Plan drawer with that task selected. Activating a file or diff entry uses the existing confined file/diff route. Supported evidence resources use the same workspace-path and HTTP(S) handling as Work Plan resources. Unsupported references render as text without a button.

Automatically opening Outcome when a turn ends was rejected because background readiness already has an attention treatment and forced navigation would disrupt the user's current workspace. Hiding Outcome when there is no Work Plan was rejected because repository results and explicit legacy states are still useful.

### Derive Outcome every time; do not mutate source state

Opening, refreshing, or navigating from Outcome is read-only. It does not change Work Plan task statuses, acknowledge `needs_review`, mark evidence reviewed, or modify files. The response contains no generated timestamp that would make equal source state appear different; request correlation provides transport freshness.

This maintains the existing rule that review acknowledgement happens only through authoritative Work Plan mutations. A view-specific acknowledgement flag was rejected as duplicate state outside the agent-owned plan.

## Risks / Trade-offs

- [A large plan or repository set makes refresh expensive] → Reuse existing Work Plan limits and bounded-concurrency git status, coalesce invalidations, and render sections progressively from one completed snapshot rather than issuing per-row requests.
- [A filesystem burst returns an already stale snapshot] → Correlate by workspace, session, and request id; queue one latest-state refresh when invalidated during an active request.
- [Generic sections flatten important domain meaning] → Keep semantic status values and a closed target union; the common layer supplies layout and availability, not interpretation.
- [A future contributor failure obscures current results] → Isolate contributor errors into their own unavailable section and retain every successful section.
- [A task disappears between Outcome and navigation] → Open the current Work Plan and show a non-destructive “task no longer exists” state rather than selecting another task.
- [Existing git partial failure lacks enough display detail] → Extend the internal/result payload to retain repository-specific failure identity and safe diagnostic text; never downgrade it to an empty list.

## Migration Plan

1. Add shared Outcome types and compatible request/response protocol members.
2. Add pure contributor composition and aggregation tests, then bind it to the current workspace request handler.
3. Add client state, refresh correlation, and the mutually exclusive Outcome drawer with navigation reuse.
4. Add server isolation, partial-failure, UI interaction, accessibility, and stale-response tests; exercise the running app on happy and adversarial paths.
5. Update user and developer documentation and complete the scenario-to-test matrix before release.

Rollback removes the request/response and UI entry point. No persisted state or Work Plan schema changes need reversal.
