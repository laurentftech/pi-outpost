# Work Plan Specification

## Purpose

Provides an agent-owned, human-readable account of the current work that survives session interruption without becoming a workflow engine.

## Requirements

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

### Requirement: Compaction-independent working state
Work Plan persistence SHALL be independent from Pi conversation compaction. Compaction of conversational context SHALL NOT remove, summarize, alter, or invalidate the persisted Work Plan. Following compaction, the current Work Plan state SHALL remain directly accessible to the agent through the structured Work Plan interface without reconstructing it from the compacted conversation summary.

#### Scenario: Compaction preserves the plan
- **GIVEN** a session with a persisted Work Plan
- **WHEN** Pi compacts the session's conversational context
- **THEN** the complete persisted Work Plan remains unchanged and valid

#### Scenario: Agent reads the plan after compaction
- **GIVEN** Pi has compacted a session that has a Work Plan
- **WHEN** the agent reads the current Work Plan through the structured interface
- **THEN** it receives the authoritative current state without using or reconstructing information from the conversation summary

### Requirement: Work Plan view and inspection
The system SHALL provide a persistent or readily accessible Work Plan view alongside the conversation. It SHALL make task status, hierarchy, current focus, and aggregate progress understandable without reading the transcript. Selecting a task SHALL reveal its description, children, dependencies, reason, resources, and associated activity or outputs when available.

#### Scenario: Readable overview
- **WHEN** a session has completed, active, blocked, and review tasks
- **THEN** the overview makes every state and the current focus distinguishable

#### Scenario: Preview a collapsed plan
- **GIVEN** the Work Plan detail panel is collapsed
- **WHEN** the user hovers or focuses its progress control
- **THEN** a compact summary shows task lines and completion boxes, and selecting the control opens the full detail panel

#### Scenario: Navigate a resource
- **GIVEN** a task references a resource the system can resolve
- **WHEN** the user selects that resource
- **THEN** the system navigates to it using the existing applicable UI

### Requirement: Self-describing Work Plan tool contract
The structured Work Plan interface SHALL expose object schemas whose `action` property enumerates the operations that schema carries and whose remaining properties are optional, individually typed, and documented with the actions that use them. Every nested input field, accepted status, and nullable clearing value SHALL be declared. An agent SHALL be able to construct a valid call from the tool name, description, schema, and prompt guidelines without learning required fields from rejected mutations. A refused call SHALL be answered with a diagnosis that names the refused field, and SHALL NOT enumerate the failures of operations the call did not request.

The interface SHALL be published as two tools, described under **The Work Plan contract is split by what an operation needs**. Each SHALL be self-describing on its own terms: an agent reading either SHALL be able to call every action that tool carries, and SHALL be told where the others live. The prompt guidelines that accompany an operation SHALL follow the tool that carries it, so what an agent is told matches what it is currently able to call.
#### Scenario: Creation schema declares its complete input
- **WHEN** an agent inspects the Work Plan tool schema
- **THEN** the schema declares the plan title and the recursively nested task shape, including the task dependency list
- **AND** no creation field is hidden behind an unconstrained schema object

#### Scenario: Mutation branches require their own arguments
- **WHEN** an agent inspects any operation-specific argument
- **THEN** the schema declares which actions require it
- **AND** it is not presented as a requirement of unrelated actions

#### Scenario: A refusal names the field it refuses
- **WHEN** a call carries a property the requested action does not accept
- **THEN** the diagnosis names that property and its path within the call
- **AND** it does not report the requirements of operations the call did not request

#### Scenario: Clearing optional values is discoverable
- **WHEN** an operation can clear an optional parent, description, or status reason
- **THEN** its schema declares the accepted JSON `null` value for that field

#### Scenario: The tool carries a worked example
- **WHEN** the agent's prompt is composed
- **THEN** the Work Plan tool contributes guidelines containing a literal, valid creation call with dependencies and one level of subtasks

### Requirement: Normalized hierarchical creation
The Work Plan interface SHALL provide a creation operation that accepts a human-readable plan title, top-level tasks, and at most one level of direct subtasks. Each task collection SHALL declare a maximum of 500 items, while the existing limit of 500 total tasks and 64 KiB for the complete serialized plan SHALL remain authoritative. Each input task SHALL require only a human-readable title; description, status, status reason, resources, dependencies, and direct subtasks SHALL be optional. Subtasks SHALL NOT themselves accept subtasks. Each input task MAY carry its own identifier; the operation SHALL adopt a supplied identifier as the task's stable identity, SHALL reject a collection whose supplied identifiers are not unique, and SHALL generate an identifier for every task that omits one. A supplied dependency list SHALL be resolved against the identifiers of the complete draft, in any declaration order, and a dependency naming no task in the draft SHALL be refused by name. The ergonomic input SHALL NOT accept a parent identifier or any other persistence field: nesting is how creation expresses hierarchy. The server SHALL atomically normalize accepted input into the persisted Work Plan representation by generating the unique stable plan identifier and the omitted task identifiers, setting the unchanged plan version `1` and update timestamp, defaulting omitted statuses to `todo`, initializing omitted dependency and resource collections, and translating nesting into parent relationships.

#### Scenario: Create a minimal plan
- **WHEN** the agent creates a plan with a title and tasks that contain only titles
- **THEN** the operation persists a valid versioned plan whose tasks have stable identifiers, `todo` status, and empty dependency and resource collections

#### Scenario: Create direct subtasks
- **WHEN** a creation input contains direct subtasks under top-level tasks
- **THEN** the persisted plan preserves that two-level hierarchy with generated parent relationships

#### Scenario: A plan is created with its dependencies
- **WHEN** a creation task supplies a dependency list naming other tasks in the same call
- **THEN** the persisted plan carries those dependencies without any further operation

#### Scenario: A dependency may name a task declared later
- **WHEN** a creation task depends on a task that appears further down the same input
- **THEN** the dependency resolves and the plan is persisted

#### Scenario: An unresolvable dependency is refused by name
- **WHEN** a creation task depends on an identifier no task in the input carries
- **THEN** the operation is rejected, the diagnosis names that identifier, and no plan becomes persisted

#### Scenario: The agent names its own tasks
- **WHEN** a creation input supplies an identifier for some of its tasks
- **THEN** each supplied identifier becomes that task's stable identity, addressable by a later task operation without an intervening read
- **AND** every task that omitted an identifier receives a generated one

#### Scenario: Duplicate supplied identity is rejected atomically
- **WHEN** a creation input supplies the same identifier for two tasks
- **THEN** the operation is rejected and no plan becomes persisted

#### Scenario: Creation limits are discoverable and atomic
- **WHEN** the agent inspects or submits a creation input
- **THEN** the schema declares the two-level nesting and per-collection ceilings
- **AND** input exceeding a declared or whole-plan limit is rejected without changing persisted state

#### Scenario: Explicit task fields survive normalization
- **WHEN** a creation task supplies an allowed status, description, status reason, or resources
- **THEN** the normalized task preserves those values and generates only the omitted technical fields

#### Scenario: Persistence mechanics stay out of the creation input
- **WHEN** a creation task supplies a parent identifier or another persistence field
- **THEN** the operation is rejected and the diagnosis names that field

#### Scenario: Creation returns usable task identities
- **WHEN** a creation operation succeeds
- **THEN** its result supplies the normalized authoritative plan, including generated task identifiers, so later task-level operations need no additional discovery call
- **AND** the complete returned plan is bounded by the existing 64 KiB serialized-plan limit

#### Scenario: Creation does not overwrite an existing plan
- **GIVEN** the session already has a persisted Work Plan
- **WHEN** the agent submits a creation operation
- **THEN** the operation is rejected without changing the existing plan
- **AND** the full replacement operation remains the explicit overwrite path

#### Scenario: Invalid nested creation is atomic
- **WHEN** any task in a nested creation input is invalid or would exceed a Work Plan limit
- **THEN** no part of the new plan becomes visible or persisted

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

### Requirement: Missing operation arguments are refused by name
Because the schema declares every operation-specific argument as optional, the server SHALL check each operation's own requirements and SHALL refuse a call that omits one, naming the action and the missing argument. An operation that names a task SHALL refuse a call carrying no task identifier rather than resolving no task and reporting success. An update SHALL refuse a call that changes nothing.

#### Scenario: An operation that names a task refuses to run without one
- **WHEN** a task update, move, removal, dependency assignment, or resource assignment is submitted with no task identifier
- **THEN** the operation is rejected, the diagnosis names the action and the missing argument, and the persisted plan is unchanged
- **AND** the caller is not told the operation succeeded

#### Scenario: A payload-carrying operation refuses to run empty
- **WHEN** a creation, replacement, or task addition is submitted without its plan, title, tasks, or task argument
- **THEN** the operation is rejected and the diagnosis names the missing argument

#### Scenario: An update that changes nothing is refused
- **WHEN** a task update names a task but carries no changed field, in `changes` or beside the identifier
- **THEN** the operation is rejected rather than persisting an unchanged plan

### Requirement: Forgiving task update shape
The task update operation SHALL accept its changed fields either inside a `changes` object or directly alongside the task identifier. When no `changes` object is supplied, the server SHALL treat the task fields present at the top level of the call as the requested changes. A call that supplies both SHALL use `changes`. Task identity SHALL remain unchangeable through either shape.

#### Scenario: Changed fields are accepted beside the task identifier
- **WHEN** an update names a task identifier and a status with no `changes` object
- **THEN** the operation applies that status to the named task

#### Scenario: An explicit changes object still wins
- **WHEN** an update supplies both a `changes` object and top-level task fields
- **THEN** the operation applies the `changes` object

#### Scenario: Identity cannot be changed through either shape
- **WHEN** an update supplies a task identifier as a changed field
- **THEN** the operation is rejected

### Requirement: The Work Plan contract is split by what an operation needs

The Work Plan interface SHALL be published as two tools. The first SHALL carry the operations
that need nothing to exist first — inspecting, creating, adding, updating, moving and removing
tasks, and clearing the plan — and SHALL be published to every session. The second SHALL carry
the operations that act on tasks that must already exist: whole-plan replacement, dependency
sets, resource sets and evidence collections. It SHALL be published only while the session has
a Work Plan.

The schema is sent on every request of every conversation. The withheld operations are both
the expensive ones — they carry complete plans, evidence records and resource lists — and the
impossible ones, since none of them can be called against a session with no plan. A tool that
cannot be called is one no conversation should be charged for reading.

The task shapes the first tool accepts — at creation and when adding a task — SHALL NOT
advertise evidence or resource collections; those are set on tasks that exist, through the
second tool. The persisted representation SHALL be unchanged: a draft carrying those
collections SHALL still normalise, so stored plans, forks and every non-tool caller keep
working. Withdrawing them from the schema is nonetheless a narrowing for an agent, since a
tool call is validated against the published schema before it reaches the handler.

Publication SHALL be derived from the persisted plan rather than from separately held state,
and a change SHALL take effect within the turn that causes it: an agent that creates a plan
SHALL be able to record evidence against it without waiting for the next turn.

Each tool SHALL name the other and say what it carries, in its description and its prompt
guidelines, so an agent that reaches for an operation the tool it is holding does not have
is told where to find it **before** it calls.

A call naming an action the tool does not carry SHALL be refused. For a model that reaches
the tool through the runtime, the refusal comes from the published schema, whose `action`
enumerates only that tool's operations — the runtime validates against it before the tool
runs, so the tool's own guard never sees such a call. That guard SHALL nevertheless answer
by name for the callers that bypass validation.

Where a runtime cannot change its published toolset — the RPC dialect has no command for it —
that runtime SHALL publish both tools at all times rather than emulate the gating. The
embedded SDK runtime is the supported target for this behaviour.

#### Scenario: A session with no plan publishes only the common operations
- **GIVEN** a session whose workspace holds no Work Plan
- **WHEN** the agent's toolset is composed
- **THEN** the tool carrying creation and task updates is published
- **AND** the tool carrying evidence, resources, dependencies and replacement is not

#### Scenario: Creating a plan publishes the rest within the same turn
- **GIVEN** a session with no Work Plan
- **WHEN** the agent creates one
- **THEN** the second tool is published
- **AND** the agent can record evidence against a task in its next call of that same turn

#### Scenario: A session that already has a plan publishes both
- **GIVEN** a session whose workspace holds a Work Plan
- **WHEN** the session is bound, resumed, switched to, or forked
- **THEN** both tools are published

#### Scenario: Clearing a plan withdraws the extended operations
- **GIVEN** a session publishing both tools
- **WHEN** the plan is cleared
- **THEN** only the tool carrying the common operations remains published

#### Scenario: Every action belongs to exactly one tool
- **WHEN** the published tools are compared against the enumerated Work Plan actions
- **THEN** each action appears in exactly one of them
- **AND** none is absent from both

#### Scenario: An action asked of the wrong tool is refused
- **WHEN** a model asks one tool for an action the other carries
- **THEN** the call is refused before the tool runs, by the schema that does not enumerate it

#### Scenario: Each tool says where the other operations live
- **WHEN** an agent reads either tool's description and guidelines
- **THEN** it is told which tool carries the operations this one does not

#### Scenario: Creation no longer advertises evidence, and the store still accepts it
- **WHEN** an agent inspects the creation task shape
- **THEN** it declares no evidence or resource collection
- **AND** a creation draft that carries them is still normalised into the persisted plan

#### Scenario: A runtime that cannot gate says so rather than pretending
- **GIVEN** a workspace served by the RPC runtime
- **WHEN** the agent's toolset is composed for a session with no plan
- **THEN** both tools are published, as that dialect cannot change its active toolset
