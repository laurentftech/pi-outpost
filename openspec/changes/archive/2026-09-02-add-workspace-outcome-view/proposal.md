## Why

When an agent finishes workspace work, the user currently has to reconstruct the result from the conversation, Work Plan, evidence records, and file changes. Pi-Outpost already holds authoritative structured state for these facts, so it can present a concise, deterministic review surface without asking a model to reinterpret the work.

## What Changes

- Add a workspace Outcome view that composes available structured result sources into a stable review summary.
- Show Work Plan completion and non-completion, verification evidence and its status, changed files, and other available results without turning missing, failed, blocked, or unverified state into success.
- Make Outcome entries navigate to their source task, evidence reference, file, diff, or other existing detail view when Pi-Outpost can resolve the target.
- Define an extensible contributor contract so later artifact, OpenLore, or external-system result sources can add sections without changing the Outcome view's core model.
- Preserve workspace isolation and support sessions or Work Plans that predate structured evidence.
- Exclude LLM-generated summaries, automatic review or approval, artifact management, OpenLore runtime dependencies, and cross-workspace aggregation.

## Capabilities

### New Capabilities

- `workspace-outcome`: Define deterministic outcome composition, conservative status semantics, presentation, navigation, legacy empty states, and extensible structured contributors.

### Modified Capabilities

- `multi-project-workspaces`: Require Outcome data, requests, updates, and navigation to remain confined to the workspace currently bound to the client.

## Impact

- Shared outcome types and typed WebSocket messages for requesting or receiving a workspace-scoped snapshot.
- Server-side composition of Work Plan state, evidence records, and repository working-tree status already owned by the workspace.
- Client state and a new review surface integrated with the existing ready-for-review, Work Plan, file, and diff affordances.
- Focused shared/server/UI tests, running-app interaction checks, OpenSpec scenario coverage, and documentation for the new user flow.
- No persisted summary, new model call, new external dependency, or migration of existing Work Plans.
