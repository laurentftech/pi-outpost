# workspace-outcome Specification

## Purpose
Provide a concise, deterministic, workspace-scoped review of recorded accomplishments, verification state, and file changes while preserving every incomplete or adverse result.

## Requirements

### Requirement: Deterministic workspace outcome
The system SHALL provide an Outcome view composed exclusively from authoritative structured state associated with the workspace's current session and repositories. The initial contributors SHALL cover the current Work Plan, its task evidence, and current repository working-tree status. The system SHALL NOT invoke a language model, infer claims from conversation text, or persist a separately authored outcome summary.

Every displayed item SHALL identify its source category and preserve the source's identity and status. Reopening the view without a source-state change SHALL produce the same ordered outcome content.

#### Scenario: Outcome uses recorded structured state
- **GIVEN** a workspace with a Work Plan, task evidence, and changed files
- **WHEN** the user opens its Outcome view
- **THEN** the view reports those recorded tasks, evidence results, and file states
- **AND** no language-model summary is requested or displayed

#### Scenario: Conversation claims do not become outcome facts
- **GIVEN** an assistant message says that work passed verification
- **AND** the workspace contains no structured verification evidence recording that result
- **WHEN** the user opens the Outcome view
- **THEN** the message claim is not presented as verification evidence

#### Scenario: Stable ordering
- **GIVEN** the authoritative outcome sources do not change
- **WHEN** the same workspace Outcome is requested more than once
- **THEN** its sections and entries appear in the same deterministic order

### Requirement: Conservative completion and verification presentation
The Outcome view SHALL present Work Plan progress separately from verification status. It SHALL preserve every task status, status reason, and evidence result needed to distinguish completed, review-ready, active, blocked, failed, inconclusive, informational, and unverified work.

Plan progress SHALL be based only on recorded task statuses. Verification SHALL be reported as failed when any applicable evidence is `failed`, inconclusive when none failed and any is `inconclusive`, passed when at least one is `passed` and none is failed or inconclusive, and not recorded when no passed, failed, or inconclusive evidence exists. Informational evidence SHALL remain visible but SHALL NOT by itself make work verified. The interface SHALL NOT present an overall successful-completion claim that hides a non-terminal or `needs_review` task, failed or inconclusive evidence, or absent verification evidence.

#### Scenario: Blocked and failed work remains prominent
- **GIVEN** a Work Plan containing a blocked task with a status reason
- **AND** another task contains failed evidence
- **WHEN** the Outcome is displayed
- **THEN** the blocked task and its reason remain visible
- **AND** verification is reported as failed rather than successful

#### Scenario: Incomplete work is not completed
- **GIVEN** a Work Plan with a task in `todo` or `in_progress`
- **WHEN** the Outcome is displayed
- **THEN** the task retains its recorded status
- **AND** the Outcome does not describe the plan as completed

#### Scenario: Review-ready work still needs review
- **GIVEN** every Work Plan task is `done` or `needs_review`
- **AND** at least one task is `needs_review`
- **WHEN** the Outcome is displayed
- **THEN** it distinguishes the review-ready tasks from completed tasks
- **AND** it does not present human review as already approved

#### Scenario: Informational evidence does not verify work
- **GIVEN** a task whose only evidence result is `informational`
- **WHEN** the Outcome is displayed
- **THEN** the informational evidence remains visible
- **AND** verification is reported as not recorded

#### Scenario: Mixed verification has conservative precedence
- **GIVEN** evidence records containing both passed and inconclusive results and no failed result
- **WHEN** the Outcome is displayed
- **THEN** verification is reported as inconclusive

### Requirement: Changed-file result section
The Outcome view SHALL list current changed files across every repository belonging to the workspace, preserving each repository identity, workspace-relative path, and git state. Repository or status failures SHALL be visible as unavailable or partial result state rather than being represented as a clean workspace. A clean repository SHALL be distinguished from an unavailable repository and from a workspace with no repository.

#### Scenario: Changes from multiple repositories are visible
- **GIVEN** a workspace containing two repositories with changed files
- **WHEN** the Outcome is displayed
- **THEN** changed files from both repositories are listed under their owning repositories
- **AND** each file retains its modified, added, deleted, untracked, or conflicted state

#### Scenario: Partial repository result is not clean
- **GIVEN** one workspace repository returns status and another cannot be inspected
- **WHEN** the Outcome is displayed
- **THEN** available changes are shown
- **AND** the unavailable repository is identified
- **AND** the view does not claim that the workspace is clean

### Requirement: Source navigation
When an Outcome entry has a target that Pi-Outpost can safely resolve, the view SHALL offer navigation to the existing source detail: a Work Plan task, a workspace file or its available diff, or a supported evidence resource. Navigation SHALL reuse the workspace path confinement and external-link safety rules of the corresponding existing surface. Entries without a supported target SHALL remain readable without presenting a non-functional control.

#### Scenario: Open a task from Outcome
- **GIVEN** an Outcome task entry
- **WHEN** the user activates it
- **THEN** the Work Plan opens with that task selected and its recorded details visible

#### Scenario: Open a changed file from Outcome
- **GIVEN** a changed-file entry with an available working-tree diff
- **WHEN** the user activates it
- **THEN** the existing file view opens for that path with its diff visible

#### Scenario: Unsupported evidence reference remains legible
- **GIVEN** an evidence entry whose reference scheme has no registered navigator
- **WHEN** the Outcome is displayed
- **THEN** its summary and reference remain visible
- **AND** the reference is not presented as an actionable navigation control

### Requirement: Explicit legacy and empty states
The Outcome view SHALL remain available for existing sessions with no Work Plan and for Work Plans with no evidence. It SHALL distinguish absence of a plan, absence of verification evidence, a clean repository, unavailable repository status, and absence of repositories. None of these empty states SHALL be described as proof that work completed or passed.

#### Scenario: Existing session has no Work Plan
- **GIVEN** an existing session with no persisted Work Plan
- **WHEN** the Outcome is displayed
- **THEN** it states that no Work Plan is recorded
- **AND** any available changed-file results remain visible

#### Scenario: Existing Work Plan has no evidence
- **GIVEN** a Work Plan created before evidence records were available
- **WHEN** the Outcome is displayed
- **THEN** its task progress remains visible
- **AND** verification is reported as not recorded rather than passed or failed

### Requirement: Extensible structured contributors
Outcome composition SHALL accept independently registered structured contributors through a common section contract containing a stable contributor identifier, display order, availability state, entries, statuses, and optional navigation targets. One contributor's absence or failure SHALL NOT suppress successful sections from other contributors, and unknown contributor identifiers SHALL NOT be interpreted as trusted HTML or executable actions.

Adding future artifact, OpenLore, or external engineering-system contributors SHALL NOT require changing the semantics of the Work Plan, evidence, or changed-file contributors. Such contributors SHALL require their own authoritative integration and are not introduced by this capability.

#### Scenario: One contributor is unavailable
- **GIVEN** Work Plan and file-change contributors return results
- **AND** another registered contributor is unavailable
- **WHEN** the Outcome is displayed
- **THEN** the available sections remain visible
- **AND** the unavailable contributor is represented without converting the whole Outcome to success or failure

#### Scenario: Future contributor preserves existing sections
- **GIVEN** a later release registers another structured Outcome contributor
- **WHEN** the Outcome is displayed
- **THEN** the contributor appears according to the common section contract
- **AND** existing Work Plan, verification, and changed-file behavior remains unchanged
