## Why

Background work currently falls back to `idle` when a turn ends, so users cannot distinguish an inactive workspace from completed work that is waiting for their review. Pi-Outpost already has an authoritative Work Plan and a multi-workspace attention channel; connecting those two surfaces review readiness without treating runtime completion as task completion.

## What Changes

- Define a workspace-level `ready-for-review` activity derived from the authoritative session Work Plan, distinct from working, waiting for the user, and idle.
- Define the Work Plan conditions that enter and leave review readiness, including explicit plan-based acknowledgement and meaningful resumed work; navigation alone does not clear it.
- Carry review readiness in workspace activity snapshots and updates without carrying Work Plan or conversation content across workspace boundaries.
- Surface one or more ready workspaces in the existing selector attention treatment and unattended browser-notification mechanism, with review-specific accessible wording.
- Keep the state and protocol extensible for later Work Plan evidence, verification, and Outcome views without introducing those models or a review interface now.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-plan`: Define the authoritative plan predicate and explicit task transitions that establish, acknowledge, or resume work from review readiness.
- `multi-project-workspaces`: Add ready-for-review to reported workspace activity and the existing cross-workspace attention and notification behavior.
- `model`: Extend the typed workspace summary protocol with the new activity while preserving content isolation.

## Impact

- Shared WebSocket protocol types and workspace summary state.
- Server-side Work Plan synchronization and workspace activity derivation/broadcasting.
- Workspace selector marks, labels, attention counts, and browser notifications.
- Agent-owned Work Plan guidance and focused server/UI/protocol tests.
- User and developer documentation describing Work Plan states and multi-workspace activity.
- No new dependency, persisted review record, review UI, evidence model, artifact model, automatic review, or OpenLore runtime integration.
