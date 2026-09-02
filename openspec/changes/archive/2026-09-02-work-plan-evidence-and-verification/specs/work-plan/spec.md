## ADDED Requirements

### Requirement: Generic structured task evidence
Every Work Plan task SHALL contain an evidence collection with zero or more agent-owned records. Each evidence record SHALL have an identifier that is unique within its task, a non-empty free-form `type` identifying the kind or source of evidence, and one `result` from `passed`, `failed`, `inconclusive`, or `informational`. Each record SHALL also contain at least one of a concise non-empty `summary` or a generic resource `reference`; a reference SHALL use the same provider-neutral URI and optional label shape as other Work Plan resources. The model SHALL NOT contain provider-specific fields.

#### Scenario: Attach successful verification
- **WHEN** the agent supplies evidence for a task with result `passed`
- **THEN** the accepted Work Plan contains that structured evidence record on the named task

#### Scenario: Retain unsuccessful verification
- **WHEN** the agent supplies evidence with result `failed` or `inconclusive`
- **THEN** the accepted Work Plan retains that record rather than filtering, converting, or discarding it

#### Scenario: Reference supporting information
- **WHEN** an evidence record supplies a generic resource reference instead of a summary
- **THEN** the record is accepted when the reference contains a valid URI

#### Scenario: Reject an uninformative evidence record atomically
- **WHEN** an evidence record contains neither a non-empty summary nor a valid reference
- **THEN** the operation is rejected and no partial Work Plan mutation becomes visible or persisted

#### Scenario: Reject duplicate evidence identity atomically
- **WHEN** one task's evidence collection contains the same evidence identifier more than once
- **THEN** the operation is rejected and the Work Plan remains unchanged

### Requirement: Evidence and task status are independent
Evidence SHALL remain separate from task status. Adding, replacing, or removing evidence SHALL NOT change the task's status or status reason. Changing a task's status or status reason SHALL NOT add, remove, or fabricate evidence. Tool activity, evidence contents, and evidence results SHALL NOT be interpreted as task completion.

#### Scenario: Passing evidence does not complete a task
- **GIVEN** a task is `in_progress`
- **WHEN** the agent attaches evidence whose result is `passed`
- **THEN** the task remains `in_progress` with its existing status reason

#### Scenario: Failed evidence does not block a task automatically
- **GIVEN** a task has any status
- **WHEN** the agent attaches evidence whose result is `failed`
- **THEN** the task keeps that status until the agent explicitly changes it

#### Scenario: Completion does not fabricate evidence
- **GIVEN** a task has no evidence
- **WHEN** the agent explicitly marks the task `done`
- **THEN** its evidence collection remains empty

#### Scenario: Status edits preserve recorded failures
- **GIVEN** a task has failed or inconclusive evidence
- **WHEN** the agent changes the task's status or status reason
- **THEN** the existing evidence remains unchanged

### Requirement: Evidence-aware creation and compatibility
The ergonomic creation shape, normalized task addition shape, and full-plan replacement shape SHALL declare and validate task evidence wherever they accept complete task state. Creation inputs MAY omit evidence; normalization SHALL then produce an empty evidence collection. Existing version-1 Work Plans and normalized task inputs that omit evidence SHALL remain valid and SHALL normalize missing evidence to an empty collection without requiring a version migration. Evidence collections and their fields SHALL be bounded, and the existing 500-task and 64 KiB complete-plan limits SHALL remain authoritative.

#### Scenario: Create a task with evidence
- **WHEN** a creation task supplies valid evidence records
- **THEN** normalization preserves those records on the created task

#### Scenario: Create a task without evidence
- **WHEN** a creation task omits evidence
- **THEN** normalization creates the task with an empty evidence collection

#### Scenario: Restore a legacy version-1 plan
- **GIVEN** a valid version-1 Work Plan persisted before evidence existed
- **WHEN** the system loads or replaces that plan
- **THEN** the plan remains valid and every task that omitted evidence is normalized to an empty evidence collection

#### Scenario: Evidence limits are discoverable and atomic
- **WHEN** the agent inspects or submits an evidence-bearing task input
- **THEN** the schema declares the evidence collection and field bounds
- **AND** input exceeding a declared or complete-plan limit is rejected without changing persisted state

### Requirement: Atomic evidence management
The structured Work Plan interface SHALL expose a `set_evidence` operation that atomically replaces the complete evidence collection of one named task, including with an empty collection to remove all evidence. The operation SHALL require both the task identifier and evidence collection, SHALL validate every record before committing, and SHALL return and synchronize the complete authoritative Work Plan through the existing contract. The tool description and prompt guidance SHALL explain the evidence shape, accepted results, replacement semantics, and independence from task status.

#### Scenario: Replace a task's evidence
- **GIVEN** a task has existing evidence
- **WHEN** the agent submits `set_evidence` with a valid replacement collection
- **THEN** the task contains exactly the submitted records and its other fields remain unchanged

#### Scenario: Remove all task evidence
- **GIVEN** a task has existing evidence
- **WHEN** the agent submits `set_evidence` with an empty collection
- **THEN** the evidence collection becomes empty and the task status remains unchanged

#### Scenario: Missing evidence arguments are refused by name
- **WHEN** `set_evidence` omits the task identifier or evidence collection
- **THEN** the operation is rejected, the diagnosis names the missing argument, and the persisted Work Plan is unchanged

#### Scenario: Invalid replacement does not discard prior evidence
- **GIVEN** a task has existing evidence
- **WHEN** any record in a replacement evidence collection is invalid
- **THEN** the complete operation is rejected and the prior evidence remains unchanged

## MODIFIED Requirements

### Requirement: Agent-owned hierarchical Work Plan
The system SHALL represent an optional Work Plan for a session as a title and a hierarchy of tasks. Every task SHALL have a stable identifier, a human-readable title, one of `todo`, `in_progress`, `done`, `blocked`, or `needs_review`, an evidence collection, and optional description, parent, dependencies, generic resource references, and status reason. The hierarchy SHALL allow arbitrary depth; task identity SHALL survive renaming and moving. Evidence SHALL be agent-owned task state and SHALL use the generic structured evidence contract.

#### Scenario: Progressive decomposition
- **WHEN** the agent adds children to an existing task
- **THEN** the plan shows the parent and its newly decomposed children without changing the parent's identity

#### Scenario: Blocked work is explained
- **WHEN** the agent marks a task `blocked` with a reason
- **THEN** the plan distinguishes it from `needs_review` and shows the reason during inspection

#### Scenario: Tasks may have no evidence
- **WHEN** a task has not been given supporting or verification evidence
- **THEN** the task remains valid with an empty evidence collection regardless of status

### Requirement: Structured agent management
The system SHALL expose structured operations for the agent to create a plan, add, edit, move, remove, and reopen tasks, set status and status reason, add or remove dependencies and resource references, set task evidence, and replace the plan. Each accepted operation SHALL be atomic. The system SHALL describe the Work Plan to the agent as explicit working state for systematic decomposition, execution tracking, and verification, not merely progress reporting. For non-trivial work, it SHALL guide the agent to maintain and reconcile that state before declaring completion; trivial interactions SHALL NOT require a plan. The system SHALL NOT infer task state, completion, or evidence from tool calls, messages, Structured Exchange artifacts, or other activity.

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

### Requirement: Session-scoped persistence and restoration
The system SHALL persist the Work Plan with its owning session and restore it when that session is reopened. A restored plan SHALL preserve task hierarchy, identities, statuses, dependencies, resources, reasons, and evidence, and SHALL be available to the resumed agent as compact operational context. A session fork SHALL copy the source Work Plan evidence into an independent target-side Work Plan, and subsequent evidence mutations on either branch SHALL NOT alter the other.

#### Scenario: Resume interrupted work
- **GIVEN** a saved session with a task in progress and remaining tasks
- **WHEN** the session is reopened
- **THEN** the same Work Plan, including all task evidence, is shown and supplied to the agent

#### Scenario: Fork preserves independent evidence
- **GIVEN** a saved session whose Work Plan contains successful and unsuccessful evidence
- **WHEN** the session is forked
- **THEN** the fork begins with the same evidence
- **AND** subsequent evidence mutations in the fork do not change the source session's Work Plan

### Requirement: Compatible fine-grained mutations
After creation, the Work Plan interface SHALL retain its existing operations to read and clear the plan; add, update, move, and remove tasks; set dependencies, resources, and evidence; and replace the complete normalized plan. Each operation SHALL expose its complete typed input without changing its accepted mutation semantics. Full replacement SHALL continue accepting the version-1 persisted Work Plan representation, including valid plans created before evidence fields existed.

#### Scenario: Existing task addition remains accepted
- **GIVEN** a fully specified task input accepted before this change
- **WHEN** the agent submits it through the task-addition operation
- **THEN** the system accepts it without requiring an evidence field
- **AND** the normalized task has an empty evidence collection

#### Scenario: Duplicate task identity is rejected atomically
- **GIVEN** an existing plan contains a task identifier
- **WHEN** the agent submits a fully specified task with the same identifier through the task-addition operation
- **THEN** the operation is rejected without changing the plan

#### Scenario: Existing full replacement remains accepted
- **GIVEN** a valid normalized version-1 Work Plan accepted before this change
- **WHEN** the agent submits it through the full replacement operation
- **THEN** the system accepts it without requiring evidence or migration to another version
- **AND** its normalized representation remains version `1` with empty evidence for tasks that omitted it

#### Scenario: Typed update preserves unspecified fields
- **GIVEN** an existing task with evidence
- **WHEN** the agent updates one schema-declared mutable field other than evidence
- **THEN** every unspecified task field, including evidence, keeps its current value

#### Scenario: Evidence synchronizes as authoritative task state
- **WHEN** an evidence mutation is accepted
- **THEN** reconnect, restoration, compaction-independent reads, and connected-client synchronization expose the complete updated evidence collection through the existing Work Plan snapshots
