## Purpose

Provide a safe, repository-aware view and update workflow for skills and extensions loaded from local Git working trees.

## ADDED Requirements

### Requirement: Resource provenance inventory

The system SHALL inventory the skills and extensions applicable to the current workspace and SHALL report each resource's kind, display name, loaded path when known, origin, and provenance availability. It SHALL group filesystem resources by their canonical nearest enclosing Git worktree, deduplicate repositories reached through multiple resource paths, and keep a resource in the nearest nested repository rather than an ancestor repository.

Resources that are built in, not Git-backed, or reported by a runtime without sufficient provenance SHALL remain visible as non-updateable inventory with an explicit reason. The system MUST NOT infer a path or repository that the active runtime did not report or that the server cannot derive from configured resource roots.

#### Scenario: Several configured roots resolve to one repository
- **WHEN** several skill or extension roots resolve to the same canonical Git worktree
- **THEN** the inventory contains one repository group with all of those resources

#### Scenario: Resources span several repositories
- **WHEN** applicable resources resolve to different canonical Git worktrees
- **THEN** the inventory contains a distinct selectable group for each repository

#### Scenario: Nested repository owns its resource
- **WHEN** a resource path is inside a Git worktree nested below another Git worktree
- **THEN** the resource is attributed only to the nearest enclosing worktree

#### Scenario: Mixed repository
- **WHEN** one repository supplies both skills and extensions
- **THEN** its group identifies both kinds and lists them separately

#### Scenario: Provenance is unavailable
- **WHEN** the active runtime reports a resource without a usable filesystem provenance
- **THEN** the resource remains visible as non-updateable and the inventory explains that its repository cannot be determined

### Requirement: Repository update assessment

The system SHALL let a client refresh the remote state of one known resource repository or all known resource repositories. It SHALL classify each repository as current, updateable, dirty, detached, ahead, diverged, without an upstream, locked, unavailable, busy, or failed, and SHALL include a user-readable reason for every non-updateable state. A repository SHALL be updateable only when its current branch tracks an upstream, its worktree and index contain no changes or untracked files, and its local commit is an ancestor of and behind the fetched upstream commit.

Checking SHALL NOT change tracked files, the current branch, or the checked-out commit. Failure to check one repository SHALL NOT suppress the inventory or results for other repositories.

#### Scenario: Clean branch is behind its upstream
- **WHEN** a clean current branch tracks an upstream whose fetched commit is ahead without divergence
- **THEN** the repository is classified as updateable with its local and upstream revisions

#### Scenario: Local changes block updating
- **WHEN** the worktree or index contains a modification, addition, deletion, conflict, or untracked file
- **THEN** the repository is classified as dirty and updating is unavailable
- **AND** the response identifies the repository path for external resolution without offering to mutate the changes

#### Scenario: Non-fast-forward states are blocked
- **WHEN** the repository is detached, ahead of its upstream, diverged from it, or has no upstream
- **THEN** the repository is non-updateable with the corresponding reason

#### Scenario: One refresh fails among several
- **WHEN** refreshing one known repository fails while another succeeds
- **THEN** the failed repository reports its own failure and the successful repository retains its assessment

### Requirement: Confined fast-forward update

The system SHALL update only a repository discovered from server-known resource provenance and selected by its opaque server-issued identifier. It SHALL serialize checks and updates for the same canonical repository, fetch and revalidate every eligibility condition immediately before mutation, and integrate only the exact fetched upstream by fast-forward. The update request MUST carry the revisions observed by the confirmation UI, and the server SHALL reject it if the repository or upstream changed since that observation.

Resource update Git processes SHALL be spawned without a shell, with fixed argument shapes, a bounded duration and output size, their working directory set to the validated canonical repository root, and repository hooks disabled for the integrating operation. The updater SHALL NOT commit, stash, discard, rebase, perform a non-fast-forward merge, push, switch branches, or accept an arbitrary client-supplied path or revision.

#### Scenario: Eligible repository is updated
- **WHEN** a client updates an assessed repository and its clean branch and upstream revisions still match the assessment
- **THEN** the checked-out branch advances to exactly the fetched upstream commit by fast-forward
- **AND** the result reports the before and after revisions

#### Scenario: Repository changes after assessment
- **WHEN** the worktree, branch, local revision, or upstream revision changes after assessment and before update
- **THEN** the update is refused before integration and the client receives a fresh blocked assessment

#### Scenario: Concurrent updates target one repository
- **WHEN** two clients request an update of the same canonical repository concurrently
- **THEN** the operations are serialized and the stale request cannot integrate a second or different revision

#### Scenario: Client supplies an unknown repository
- **WHEN** a client requests an update using an identifier not present in the server inventory
- **THEN** the request is refused and no Git process is started for a client-selected path

### Requirement: Extension update protection

A repository that supplies any applicable extension SHALL be treated as executable-code-bearing, including when it also supplies skills. Its update SHALL require an explicit executable-code confirmation tied to the assessed revisions. When extension updates are locked by configuration, the entire repository SHALL be non-updateable through the interface because a repository fast-forward cannot safely update only its skill files.

#### Scenario: Extension repository requires confirmation
- **WHEN** an unlocked repository supplies at least one extension and is otherwise updateable
- **THEN** the interface explains that the update changes code running with the agent's privileges
- **AND** no update request is sent until the user explicitly confirms the assessed revisions

#### Scenario: Mixed repository is locked as a unit
- **WHEN** extension updates are locked and one repository supplies both skills and extensions
- **THEN** the repository is classified as locked and neither its skills nor extensions can be updated through the interface

#### Scenario: Confirmation becomes stale
- **WHEN** an executable-code update request confirms revisions that no longer match the repository assessment
- **THEN** the server refuses it and requires a new assessment and confirmation

### Requirement: Affected runtime reload

Before changing a repository, the system SHALL identify every started workspace whose configured roots or loaded resource provenance overlap that repository. It SHALL refuse the update while any such workspace is processing or replacing an agent turn. After a successful fast-forward, it SHALL rebuild the resources for every affected started workspace whose runtime is idle and broadcast the resulting inventories. Workspaces that are not started SHALL discover the new resources when they next start.

An update that succeeds on disk but whose runtime rebuild fails SHALL be reported as an updated-reload-failed outcome, including the affected workspace failures. The system MUST NOT claim that Git was rolled back or that all runtimes use the new resources.

#### Scenario: Affected workspace is busy
- **WHEN** any started workspace affected by a repository is processing or replacing a turn
- **THEN** the update is refused before the repository changes and identifies the busy workspace

#### Scenario: Shared repository reloads all affected idle workspaces
- **WHEN** an updated repository supplies resources to several started idle workspaces
- **THEN** every affected workspace rebuilds its resources and broadcasts its new inventory

#### Scenario: Reload fails after Git succeeds
- **WHEN** the repository fast-forward succeeds and rebuilding one affected runtime fails
- **THEN** the result states that the repository is updated on disk but names the reload failure
- **AND** it does not report a successful rollback or a fully successful update

#### Scenario: Unstarted workspace loads later
- **WHEN** an updated repository is configured for a workspace that is not started
- **THEN** no runtime is started solely for the update and the new resources are loaded on that workspace's next start

