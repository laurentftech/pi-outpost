## MODIFIED Requirements

### Requirement: Structured agent management
The system SHALL expose structured operations for the agent to create a plan, add, edit, move, remove, and reopen tasks, set status and status reason, add or remove dependencies and resource references, set task evidence, and replace the plan. Each accepted operation SHALL be atomic. The system SHALL describe the Work Plan to the agent as explicit working state for systematic decomposition, execution tracking, and verification, not merely progress reporting. For non-trivial work, it SHALL guide the agent to maintain and reconcile that state before declaring completion; trivial interactions SHALL NOT require a plan. The system SHALL NOT infer task state, completion, or evidence from tool calls, messages, Structured Exchange artifacts, or other activity.

When work has reached a result that requires human review, the agent SHALL explicitly reconcile the plan so every task is `done` or `needs_review` and at least one task is `needs_review`. That authoritative plan state SHALL mean the owning workspace is ready for review whenever it is otherwise inactive. Acknowledgement SHALL be represented by explicit Work Plan mutations that resolve the applicable `needs_review` tasks; resumed work SHALL be represented by moving the applicable tasks out of `done` or `needs_review`. The system SHALL NOT mutate the plan or acknowledge review merely because a turn ends, a tool completes, or the user selects the workspace.

#### Scenario: Atomic task update
- **WHEN** an agent operation is invalid
- **THEN** no partial Work Plan mutation becomes visible or persisted

#### Scenario: Activity does not complete work
- **WHEN** the agent performs tools while a task remains `in_progress`
- **THEN** the task remains `in_progress` until the agent explicitly changes it

#### Scenario: Reconcile before completion
- **GIVEN** the agent used a Work Plan for non-trivial work
- **WHEN** the agent is preparing to declare that work complete
- **THEN** its Work Plan guidance requires the agent to reconcile the plan with execution and verification outcomes first

#### Scenario: Activity does not fabricate evidence
- **WHEN** the agent runs a test, command, tool, or external check without recording evidence
- **THEN** the Work Plan evidence remains unchanged

#### Scenario: Review readiness comes from the plan
- **GIVEN** an inactive workspace whose Work Plan has at least one `needs_review` task
- **AND** every task in the plan is either `done` or `needs_review`
- **WHEN** the authoritative plan is synchronized
- **THEN** the workspace is ready for review

#### Scenario: Unfinished work is not ready for review
- **GIVEN** a Work Plan that contains `needs_review`
- **AND** at least one task remains `todo`, `in_progress`, or `blocked`
- **WHEN** the workspace becomes inactive
- **THEN** the plan does not make the workspace ready for review

#### Scenario: Turn completion does not infer review readiness
- **GIVEN** a Work Plan that does not satisfy the review-readiness conditions
- **WHEN** an agent turn or tool execution ends
- **THEN** the system does not mark the workspace ready for review

#### Scenario: Review acknowledgement is explicit
- **GIVEN** a workspace ready for review
- **WHEN** the applicable `needs_review` tasks are explicitly transitioned to `done`
- **THEN** the workspace is no longer ready for review

#### Scenario: Meaningful work resumes
- **GIVEN** a workspace ready for review
- **WHEN** its authoritative Work Plan moves an applicable task to `todo`, `in_progress`, or `blocked`
- **THEN** the workspace is no longer ready for review

#### Scenario: Navigation does not acknowledge review
- **GIVEN** a workspace ready for review
- **WHEN** the user selects or leaves that workspace without changing its Work Plan
- **THEN** it remains ready for review
