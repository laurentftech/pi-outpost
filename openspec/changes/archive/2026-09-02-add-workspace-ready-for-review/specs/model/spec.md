## ADDED Requirements

### Requirement: Workspace review-readiness protocol state

The typed server protocol SHALL represent `ready-for-review` as a workspace activity distinct from `working`, `waiting`, and `idle`. Each server-wide workspace summary SHALL carry only workspace identity, generic activity, and generic attention metadata; review readiness SHALL NOT cause the Work Plan, tasks, artifacts, results, conversation, or other workspace-scoped content to cross the existing subscription boundary. Existing protocol states SHALL retain their meanings.

#### Scenario: Workspace summary carries review readiness
- **GIVEN** an open workspace whose authoritative Work Plan makes it ready for review
- **WHEN** the server sends an initial workspace summary or a workspace activity update
- **THEN** that workspace is typed as `ready-for-review`
- **AND** its generic attention metadata indicates that user attention is required

#### Scenario: Workspace summary preserves isolation
- **GIVEN** a client subscribed to workspace A and workspace B is ready for review
- **WHEN** the client receives the server-wide workspace summary
- **THEN** the summary identifies B and its generic review-ready activity
- **AND** it contains no Work Plan, task, artifact, result, conversation, or other workspace-scoped content from B

#### Scenario: Existing activity meanings remain compatible
- **WHEN** a workspace is stopped, starting, actively running a turn, blocked on a user answer, or inactive without a review-ready plan
- **THEN** it remains represented by the existing `stopped`, `starting`, `working`, `waiting`, or `idle` activity respectively
