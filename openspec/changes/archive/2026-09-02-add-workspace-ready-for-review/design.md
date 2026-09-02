## Context

See `proposal.md` for motivation. Workspace activity is currently a server-derived, non-persisted projection over runtime lifecycle and pending blocking dialogs. The projection is broadcast server-wide as content-free workspace summaries; conversation and session snapshots remain scoped to clients bound to that workspace. Browser notifications and selector attention currently consume `needsAttention`, which means only “a blocking dialog is pending.”

The Work Plan is session-scoped, persisted beside the session, synchronized from the persisted sidecar after accepted tool mutations, and already supports `needs_review`. Existing contracts explicitly forbid inferring plan completion from runtime or tool completion. The plan UI is read-only, so acknowledgement must continue through conversation-driven, agent-owned plan mutation rather than a new review control.

## Goals / Non-Goals

**Goals:**

- Make one authoritative projection map Work Plan state and runtime state to workspace activity.
- Preserve server-side derivation so every client applies the same precedence and isolation rules.
- Reuse the selector attention count and browser-notification lifecycle while distinguishing review readiness from a blocking question.
- Leave a stable protocol seam for future evidence, verification, and Outcome summaries without adding those payloads now.

**Non-Goals:**

- Persist a second review-readiness flag or acknowledgement record.
- Let the client derive readiness from a subscribed Work Plan.
- Make review-ready tasks editable or add a review/Outcome surface.
- Infer that output is acceptable, inspect artifacts, or perform automated review.
- Add OpenLore to runtime behavior.

## Decisions

### Derive readiness from the complete authoritative Work Plan

Define a pure predicate: a plan is review-ready when it has at least one task, at least one task is `needs_review`, and every task is either `done` or `needs_review`. Evaluate it only against the server's authoritative, session-matched Work Plan after persistence synchronization.

This avoids treating a lone review task as readiness while sibling work remains `todo`, `in_progress`, or `blocked`. It also makes parent/child inconsistencies conservative: an unreconciled parent prevents readiness. The alternative—“any `needs_review` task”—would announce completion while executable or blocked work remains. A persisted readiness latch was rejected because it would duplicate and eventually drift from the plan.

### Use activity precedence, not independent client booleans

Extend workspace activity with `ready-for-review` and calculate states in this order: `starting`, `stopped`, blocking `waiting`, active `working`, derived `ready-for-review`, then `idle`. In normal operation review-ready workspaces are kept from retirement, so `stopped` cannot mask an outstanding review state. Blocking questions outrank review because they prevent the active turn from proceeding; running work outranks a stale review-ready plan because the current observable fact is that work is underway.

The generic attention bit becomes true for both `waiting` and `ready-for-review`; consumers distinguish the reason using activity. A second `readyForReview` boolean was rejected because invalid combinations such as `working + readyForReview` would force every client to reproduce precedence rules.

### Clear only through authoritative plan transitions

There is no selector-side clear. Review acknowledgement is the agent's explicit transition of the applicable `needs_review` tasks to `done`; resumed work moves an applicable task to `todo`, `in_progress`, or `blocked`. Starting a turn temporarily reports `working`, and when it ends the current synchronized plan is evaluated again. If a turn fails to reconcile the plan, the workspace conservatively returns to ready for review.

This preserves agent ownership and provides an audit trail in existing Work Plan persistence. A click-to-acknowledge endpoint was rejected because no review UI is in scope and it would create acknowledgement state outside the plan.

### Broadcast only the generic summary and reuse notification deduplication

Work Plan synchronization triggers the existing server-wide workspace-activity announcement after the persisted plan has been reloaded. The summary carries root, display name, activity, and generic attention only. It never carries task titles, reasons, resources, output, or plan contents for a background workspace.

The selector counts both waiting and ready workspaces and renders activity-specific wording and non-colour-only marks. Browser notifications remain limited to background workspaces when the document is not visible and permission is already granted. Deduplication remains per workspace and activity episode: a transition out of an attention state resets eligibility, while switching workspace does not.

Coalescing all ready projects into one notification was rejected because the existing interaction promises one actionable project name per notification and multiple workspaces may become ready independently.

### Protect outstanding review readiness from idle retirement

The retirement sweep treats a review-ready plan as an outstanding attention condition and keeps the workspace alive until the plan changes. This preserves a single truthful activity state and avoids needing a second lightweight process to load plan sidecars for stopped workspaces.

The trade-off is that an unacknowledged review-ready workspace retains runtime resources. Reconstructing review readiness for stopped workspaces was rejected for this change because it complicates session ownership and creates another restoration path; that optimization can be revisited without changing the observable contract.

## Risks / Trade-offs

- [Agent fails to reconcile parent or sibling statuses] → The conservative predicate leaves the workspace idle rather than producing a false ready signal; strengthen product-owned Work Plan guidance and test realistic plans.
- [Agent leaves a review-ready plan unchanged after follow-up work] → Activity is `working` during the turn and returns to ready afterward, making the missing reconciliation visible instead of silently clearing user attention.
- [Ready workspace retains resources indefinitely] → Treat this as the cost of persistent attention for now; a future implementation may stop it only if the server can still reconstruct and report readiness authoritatively.
- [Existing consumers assume `needsAttention` always means a dialog exists] → Update typed comments, selector logic, notifications, and tests together; dialog replay continues to use the pending-dialog collection, not the generic attention bit.
- [Notification text leaks sensitive work] → Include only the configured project name and generic attention category, with no plan-derived strings.

## Migration Plan

1. Add the new protocol enum member and update exhaustive consumers in one compatible server/client release.
2. Add and test the pure Work Plan review-readiness predicate and server activity precedence.
3. Trigger workspace summary broadcasts after authoritative Work Plan synchronization and exempt ready workspaces from retirement.
4. Update selector and browser-notification consumers with activity-specific, accessible presentation.
5. Update Work Plan guidance and documentation, then run focused protocol, server, UI, notification, and running-app checks.

Rollback removes the derived activity and UI treatment; persisted Work Plans remain version 1 and require no data migration because no readiness field is stored.
