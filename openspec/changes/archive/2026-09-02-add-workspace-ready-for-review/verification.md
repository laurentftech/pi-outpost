# Verification

## Scenario inventory

The applicable main-spec scenarios are the scenarios under the three requirements
modified by this change:

- `work-plan`: `Atomic task update`, `Activity does not complete work`, and
  `Reconcile before completion`;
- `multi-project-workspaces`: `WorkingWorkspacesAreNeverRetired`,
  `ReopeningARetiredWorkspace`, `BackgroundProgressIsVisible`,
  `APendingQuestionIsNotDiscarded`, `AnsweringAfterSwitchingBack`,
  `NotificationOnlyWhenUnattended`, `NothingInterruptsTheCurrentWorkspace`, and
  `TwoWorkspacesWaitingAtOnce`.

The delta repeats those scenarios where their requirements change and adds sixteen
new scenarios. The following matrix covers all 27 delta scenarios and, through the
repeated rows marked `main + delta`, every applicable main scenario. Inventory was
checked with:

```bash
rg '^#### Scenario:' openspec/specs/work-plan/spec.md \
  openspec/specs/model/spec.md \
  openspec/specs/multi-project-workspaces/spec.md \
  openspec/changes/add-workspace-ready-for-review/specs
```

## Scenario-to-test matrix

Every row is `covered`: the named assertions exercise the observable GIVEN/WHEN/THEN
boundary and would fail if that contract regressed.

| Spec source | Scenario | Test evidence |
|---|---|---|
| delta `model` | Workspace summary carries review readiness | `server/test/work-plan-server.test.mjs` — **workspace review readiness follows only persisted Work Plan transitions** asserts `ready-for-review`, `needsAttention: true`, and the bounded summary shape after persisted synchronization. |
| delta `model` | Workspace summary preserves isolation | `server/test/multiProjectWorkspaces.test.mjs` — **a background result moves from working to review-ready without exposing its content** asserts only the four generic summary keys cross to the other workspace and rejects private plan/result strings. |
| delta `model` | Existing activity meanings remain compatible | `server/test/workspace-boundaries.test.ts` — **applies lifecycle and attention precedence before review readiness** asserts stopped, starting, waiting, working, ready, and idle projections independently. |
| main + delta `work-plan` | Atomic task update | `server/test/work-plan.test.ts` — **returns authoritative details and refuses a partial invalid mutation** asserts an invalid multi-field operation leaves the authoritative plan unchanged. |
| main + delta `work-plan` | Activity does not complete work | `server/test/work-plan.test.ts` — **keeps status unchanged when an explicit Work Plan operation only reads it** asserts activity without an explicit status mutation preserves `in_progress`. |
| main + delta `work-plan` | Reconcile before completion | `server/test/system-prompt.test.ts` — **adds Work Plan behavior once before unchanged operator entries when the tool is available** asserts the product guidance requires reconciliation, review statuses, explicit acknowledgement, and resumed-work transitions. |
| delta `work-plan` | Review readiness comes from the plan | `server/test/work-plan.test.ts` — **derives review readiness only from a fully reconciled authoritative plan** asserts `needs_review` alone and mixed `done`/`needs_review` plans are ready; `server/test/work-plan-server.test.mjs` proves the synchronized plan changes workspace activity. |
| delta `work-plan` | Unfinished work is not ready for review | `server/test/work-plan.test.ts` — the same predicate test separately asserts `todo`, `in_progress`, and `blocked` each prevent readiness even alongside `needs_review`. |
| delta `work-plan` | Turn completion does not infer review readiness | `server/test/work-plan-server.test.mjs` — **workspace review readiness follows only persisted Work Plan transitions** asserts initial and post-turn activity remain idle when the plan is absent or active. |
| delta `work-plan` | Review acknowledgement is explicit | The same server test transitions the persisted task from `needs_review` to `done` and asserts activity becomes idle with no attention metadata. |
| delta `work-plan` | Meaningful work resumes | The same server test transitions a review-ready task to `in_progress`, observes working during the turn, then idle rather than ready. |
| delta `work-plan` | Navigation does not acknowledge review | `server/test/multiProjectWorkspaces.test.mjs` — **several review-ready workspaces stay marked across selection without leaking plan content** switches away and back and asserts readiness persists; `e2e/review-ready.spec.ts` proves the same in the built app. |
| main + delta `multi-project-workspaces` | WorkingWorkspacesAreNeverRetired | `server/test/multiProjectLifecycle.test.mjs` — **a project whose agent is streaming outlives any idle period** waits beyond multiple sweeps and asserts the workspace remains working. |
| delta `multi-project-workspaces` | ReviewReadyWorkspacesAreNeverRetired | `server/test/multiProjectLifecycle.test.mjs` — **a review-ready project outlives any idle period** waits beyond multiple sweeps and asserts the workspace remains ready and available. |
| main + delta `multi-project-workspaces` | ReopeningARetiredWorkspace | `server/test/multiProjectLifecycle.test.mjs` — **an unwatched project is retired, stays listed, and comes back with its history** asserts stopped state, transparent rebuild, and the same session identity. |
| main + delta `multi-project-workspaces` | BackgroundProgressIsVisible | `server/test/multiProjectWorkspaces.test.mjs` — **a streaming turn reaches its own project's clients and no others** asserts background working with no turn frames crossing; **a turn started before a switch finishes in the project it belongs to** asserts the later idle transition. |
| delta `multi-project-workspaces` | BackgroundResultIsVisible | `server/test/multiProjectWorkspaces.test.mjs` — **a background result moves from working to review-ready without exposing its content** observes both activity states from workspace A and rejects B's plan and result content. |
| delta `multi-project-workspaces` | WaitingTakesPrecedence | `server/test/workspace-boundaries.test.ts` — **applies lifecycle and attention precedence before review readiness** asserts waiting wins when waiting, busy, and review-ready are all true. |
| delta `multi-project-workspaces` | SeveralWorkspacesAreReady | `server/test/multiProjectWorkspaces.test.mjs` — **several review-ready workspaces stay marked across selection without leaking plan content** asserts two independently started workspaces are simultaneously ready; the Playwright test asserts two selector rows. |
| main + delta `multi-project-workspaces` | APendingQuestionIsNotDiscarded | `server/test/multiProjectWorkspaces.test.mjs` — **a question raised in a background project waits there, and can be answered on return** asserts waiting activity while the prompt itself remains scoped to B. |
| main + delta `multi-project-workspaces` | AnsweringAfterSwitchingBack | The same integration test switches back, asserts the pending dialog is re-presented, answers it, and observes attention clear as the turn resumes. |
| delta `multi-project-workspaces` | ReviewReadySelectorStatePersistsAcrossSelection | `e2e/review-ready.spec.ts` — **review-ready workspaces remain visible and content-isolated across real switches** drives both directions and asserts both ready labels and the attention count remain. |
| main + delta `multi-project-workspaces` | NotificationOnlyWhenUnattended | `ui/src/useWorkspaceNotifications.test.ts` — **stays silent while the document is in the foreground** supplies both waiting and review-ready background workspaces and asserts zero notifications; `ProjectMenu` tests assert both still contribute to attention. |
| delta `multi-project-workspaces` | ReviewNotificationContainsNoWorkspaceContent | `ui/src/useWorkspaceNotifications.test.ts` — **distinguishes ready workspaces without including plan content** asserts the exact generic title/body/tag and rejects task, artifact, and result wording. |
| main + delta `multi-project-workspaces` | NothingInterruptsTheCurrentWorkspace | `ui/src/components/ProjectMenu.test.tsx` — **counts actionable projects without interrupting focus** supplies waiting and review-ready attention, then asserts it renders no dialog or menu and preserves the focused element; foreground notification tests assert no system notification. |
| delta `multi-project-workspaces` | TwoWorkspacesNeedAttentionAtOnce | `ui/src/useWorkspaceNotifications.test.ts` — **distinguishes ready workspaces without including plan content** asserts separate, correctly typed notifications for one ready and one waiting workspace; `ProjectMenu` asserts the mixed total. |
| main + delta `multi-project-workspaces` | TwoWorkspacesWaitingAtOnce | `ui/src/useWorkspaceNotifications.test.ts` — **names each waiting project when two ask at once** asserts two project-specific titles and tags. |

## Gate results

- `npm run test --workspace server`: 1,679 passed before the additional
  assertion-only coverage test; the new targeted server test also passes.
- `npm run test --workspace ui`: 1,403 passed before the final assertion-only
  strengthening; focused modified UI tests pass afterward.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run test:e2e`: 58 passed.
- `openspec validate add-workspace-ready-for-review --strict`: passed.
