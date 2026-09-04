## Purpose

Provide a safe, repository-aware view and update workflow for skills and extensions loaded from local Git working trees.

## ADDED Requirements

### Requirement: Repository enrollment

The Agent resources dialog SHALL expose two distinct enrollment operations. **Add local folder** SHALL let the user select an existing server-side directory and identify it as a skill or extension root, preserving the existing user-path behavior whether or not that folder belongs to Git. **Add Git repository** SHALL require both a repository address and a local server-side clone folder. The interface SHALL suggest a collision-resistant folder under pi-outpost-managed resource storage and SHALL let the user replace it or choose its parent with the server-directory picker.

The server SHALL accept only a non-empty repository address in a supported HTTPS, SSH, Git, file, or SCP-like Git form, SHALL pass it to Git as data rather than as an option or shell input, and SHALL redact embedded credentials from errors returned to clients. It SHALL resolve the requested clone folder through a canonical existing parent, refuse a filesystem root, an invalid basename, symlink ambiguity, or an occupied destination that is not the same origin, and SHALL NOT overwrite or empty existing content. Re-adding the same address and folder SHALL reuse its existing clone after verifying its origin rather than creating a duplicate. Clone operations SHALL disable repository hooks, decline recursive submodule initialization, and report a failed clone without registering resource paths.

After a clone, and before changing runtime settings, the system SHALL inspect that worktree for recognizable skill and extension roots without importing or executing extension code and SHALL present a preview of the roots and resource kinds it can register. The user SHALL explicitly select which discovered roots to activate.

Confirmed skill roots SHALL be persisted using the existing user skill-path setting and confirmed extension roots using the existing user extension-path setting. Existing deployment-configured paths SHALL remain unchanged. Extension roots SHALL require the same executable-code warning as any other extension-path addition, and `extensionLock` SHALL prevent selecting or confirming extension roots while still permitting skill-only enrollment.

After an activated root is persisted, the replacement session SHALL be created from the same effective sandbox and resource configuration that produced the rebuilt inventory. Every configured skill root, prompt root, extension directory, and extension script SHALL remain a read-only sandbox exception even when it is outside `sandbox.root`; those exceptions MUST NOT widen write access. The system SHALL acknowledge the activation only after the replacement session has taken over with that configuration.

If session replacement is refused before handoff to the new session, the system SHALL restore the previous persisted settings, workspace resources, runtime factory, and file-browser boundary, SHALL keep the prior session active, and SHALL report failure instead of acknowledging the activation. This pre-handoff rollback is distinct from a Git update whose worktree has already advanced: the latter retains its explicit partial-failure semantics under Affected runtime reload.

A preview SHALL be bound to the repository revision and root set it observed, SHALL expire, and SHALL be usable once: a confirmation arriving after expiry, after a second use, or after the observed roots changed SHALL be refused and SHALL require a fresh preview. A cloned worktree with no recognizable resource roots or a selected root that changes before confirmation SHALL be refused without changing settings. Re-enrolling an already represented canonical worktree SHALL merge newly confirmed roots into its existing group without duplicating paths or repositories. Removing its last activated path SHALL stop loading its resources but SHALL NOT delete the managed clone from disk.

#### Scenario: Add a local skill folder
- **WHEN** the user selects Add local folder, chooses an existing directory, and identifies it as a skill root
- **THEN** that directory is persisted once in the user skill paths and rebuilt into the active runtime

#### Scenario: Add a local extension folder
- **WHEN** the user selects Add local folder and chooses to add an extension root
- **THEN** the executable-code warning is shown before the directory is persisted
- **AND** an extension-locked deployment refuses the addition

#### Scenario: Activated external resources remain readable
- **GIVEN** a skill or extension root is outside the current sandbox root
- **WHEN** the user activates that root through Add local folder or a Git repository preview
- **THEN** the replacement session discovers or loads the resource
- **AND** its read, list, search, and find tools can access that configured root without granting write access there

#### Scenario: Refused replacement rolls enrollment back
- **GIVEN** activating a resource root requires replacing the current session
- **WHEN** an extension or lifecycle hook refuses replacement before the new session takes over
- **THEN** the persisted settings, workspace resources, runtime tool factory, file-browser boundary, and active session remain as they were before the request
- **AND** the client receives a failure rather than a successful settings acknowledgement

#### Scenario: Add a repository containing skills and extensions
- **WHEN** the user selects a Git worktree containing recognizable skill and extension roots and confirms both kinds from the preview
- **THEN** the corresponding user skill and extension paths are persisted and the rebuilt inventory shows one mixed repository group

#### Scenario: Enrollment does not execute extensions during preview
- **WHEN** the selected repository contains an extension whose module has an observable top-level side effect
- **THEN** previewing the repository does not trigger that side effect

#### Scenario: Extension lock permits skill-only enrollment
- **WHEN** extension paths are locked and the selected repository contains both skill and extension roots
- **THEN** the preview permits confirming the skill roots but disables extension roots with the lock reason

#### Scenario: Clone address is required and confined
- **WHEN** the repository address is invalid or the local folder is a filesystem root, has no canonical parent, uses an invalid final segment, or is occupied by different content
- **THEN** enrollment is refused before Git starts and no existing content is overwritten
- **AND** neither value is interpreted through a shell

#### Scenario: Clone has no recognizable resources
- **WHEN** a repository is cloned successfully but contains no recognizable skill or extension root
- **THEN** no runtime path is registered and the dialog explains that the clone has nothing it can activate

#### Scenario: Re-add the same repository address
- **WHEN** the user submits an address and local folder already holding a clone with the same canonical origin
- **THEN** the server verifies and reuses that clone and presents a fresh resource preview without creating a second clone

#### Scenario: Re-enroll an existing repository
- **WHEN** a selected worktree is already represented and the user confirms a newly discovered root
- **THEN** the path is added once to the existing repository group and no duplicate repository is created

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

### Requirement: Non-interactive git execution

Every git process this capability spawns SHALL run non-interactively: it SHALL NOT be able
to prompt for a passphrase or password, on its own terminal or through an askpass helper,
and SHALL NOT inherit an interactive terminal from the server process. A repository whose
address requires credentials the deployment has not already provided SHALL fail with a
display-safe reason within the bounded execution time rather than waiting for input.

Credentials the deployment has configured for git itself — a credential helper storing
them without prompting, an SSH agent, a key without a passphrase — SHALL keep working, so
the operator's existing authentication is neither duplicated nor stored by this system.
Credentials embedded in an address SHALL NOT be persisted, logged, or returned to a client.

#### Scenario: A repository needing credentials fails instead of waiting
- **WHEN** a clone or fetch reaches a repository that would prompt for a password or passphrase
- **THEN** the operation fails with a display-safe reason and no prompt is issued
- **AND** the server does not block until its command timeout waiting for input

#### Scenario: Configured git authentication still works
- **GIVEN** a deployment whose git authentication answers without prompting
- **WHEN** a repository is cloned or refreshed
- **THEN** the operation succeeds without this system asking for or storing credentials

### Requirement: Repository update assessment

The system SHALL let a client refresh the remote state of one known resource repository or all known resource repositories. It SHALL classify each repository as unchecked, checking, current, updateable, dirty, detached, ahead, diverged, without an upstream, locked, unavailable, busy, or failed, and SHALL include a user-readable reason for every non-updateable state. Unchecked and checking are transient states carrying no verdict: neither SHALL be presented as a repository that is up to date. A repository SHALL be updateable only when its current branch tracks an upstream, its worktree and index contain no changes or untracked files, and its local commit is an ancestor of and behind the fetched upstream commit.

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

#### Scenario: A repository that is no longer there
- **WHEN** a known repository's working tree has been removed, replaced by a non-repository, or become unreadable since it was inventoried
- **THEN** it is classified as unavailable with that reason and remains listed rather than disappearing silently
- **AND** its resources are reported as non-updateable rather than as up to date

#### Scenario: One refresh fails among several
- **WHEN** refreshing one known repository fails while another succeeds
- **THEN** the failed repository reports its own failure and the successful repository retains its assessment

### Requirement: Confined fast-forward update

The system SHALL update only a repository discovered from server-known resource provenance and selected by its opaque server-issued identifier. It SHALL serialize checks and updates for the same canonical repository, fetch and revalidate every eligibility condition immediately before mutation, and integrate only the exact fetched upstream by fast-forward. The update request MUST carry the revisions observed by the confirmation UI, and the server SHALL reject it if the repository or upstream changed since that observation.

Resource update Git processes SHALL be spawned without a shell, with fixed argument shapes, a bounded duration and output size, their working directory set to the validated canonical repository root, and repository hooks disabled for the integrating operation. The updater SHALL NOT commit, stash, discard, rebase, perform a non-fast-forward merge, push, switch branches, or accept an arbitrary client-supplied path or revision. It SHALL NOT initialize or advance submodules: a repository whose resources come from a submodule SHALL say that its submodule content was not updated rather than report the repository as fully up to date.

#### Scenario: Eligible repository is updated
- **WHEN** a client updates an assessed repository and its clean branch and upstream revisions still match the assessment
- **THEN** the checked-out branch advances to exactly the fetched upstream commit by fast-forward
- **AND** the result reports the before and after revisions

#### Scenario: Submodule content is not silently claimed
- **GIVEN** an updateable repository that carries at least one submodule
- **WHEN** its branch is fast-forwarded
- **THEN** submodule working trees are left untouched
- **AND** the result states that submodule content was not updated

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

Before changing a repository, the system SHALL identify every started workspace whose configured roots or loaded resource provenance overlap that repository. It SHALL refuse the update while any such workspace is streaming a turn or replacing its session. After a successful fast-forward, it SHALL rebuild the resources for every affected started workspace whose runtime is idle and broadcast the resulting inventories. Workspaces that are not started SHALL discover the new resources when they next start.

An update that succeeds on disk but whose runtime rebuild fails SHALL be reported as an updated-reload-failed outcome, including the affected workspace failures. A session replacement that is refused rather than thrown — an extension vetoing the fresh session — SHALL count as such a failure and name that refusal: the worktree has advanced while the retained session still holds the previous revision's resources. The system MUST NOT claim that Git was rolled back or that all runtimes use the new resources.

#### Scenario: Affected workspace is busy
- **WHEN** any started workspace affected by a repository is streaming a turn or replacing its session
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
