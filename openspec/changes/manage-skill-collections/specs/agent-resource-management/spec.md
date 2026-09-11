## ADDED Requirements

### Requirement: Skill collection catalogue

When a Git repository is enrolled through **Add Git repository**, the system SHALL build a catalogue
of the skills that repository carries: every directory in the worktree that contains a `SKILL.md`,
wherever it sits, rather than only the repository root, `skills/` and `.agents/skills`. Each entry
SHALL report the skill's name as its frontmatter declares it (its directory name when none is
declared), its description when declared, its path relative to the repository root, and the folder
group it belongs to.

Skills SHALL be grouped by the folder that contains the skill's directory, and each group SHALL be
named by that folder's path relative to the repository root; a skill whose directory sits at the
repository root belongs to a group named after the repository. The grouping SHALL come from the
repository's own folder tree alone: the system SHALL NOT read a repository-specific index,
manifest or marketplace file to decide it. Skills SHALL be listed as the repository lays them out:
two directories carrying the same or equivalent skill under different names SHALL both appear, each
in its own group, and neither SHALL be merged into or hidden behind the other.

Building the catalogue SHALL NOT import or execute any code from the repository, SHALL stay inside
the canonical worktree, SHALL NOT follow symbolic links, and SHALL skip `.git` and `node_modules`.
It SHALL be bounded in directory depth, in the number of skills listed and in the bytes read from
each `SKILL.md`; a repository that exceeds a bound SHALL be reported as such, naming the bound,
rather than presented as if the listed skills were all it contains.

#### Scenario: Category folders become groups
- **GIVEN** a repository whose skills live under `dev-skills/<skill>/SKILL.md`, `agent-skills/<skill>/SKILL.md` and `skills/<prefixed-skill>/SKILL.md`
- **WHEN** the repository is enrolled
- **THEN** the catalogue lists every one of those skills, grouped under `dev-skills`, `agent-skills` and `skills`

#### Scenario: Duplicates are listed as shipped
- **GIVEN** a repository carrying the same skill as `agent-skills/a2a-protocol-guide` and as `skills/agent-a2a-protocol-guide`
- **WHEN** its catalogue is built
- **THEN** both entries appear, each in its own group under its own name

#### Scenario: No manifest decides the grouping
- **GIVEN** a repository shipping an index or marketplace file whose categories differ from its folders
- **WHEN** its catalogue is built
- **THEN** the groups follow the folders and the file has no effect on them

#### Scenario: Cataloguing runs no repository code
- **WHEN** a repository whose extension module has an observable top-level side effect is catalogued
- **THEN** that side effect does not occur

#### Scenario: A symlinked skill is not followed
- **GIVEN** a directory in the repository that is a symbolic link to a folder containing `SKILL.md`, inside or outside the worktree
- **WHEN** the catalogue is built
- **THEN** that link contributes no entry

#### Scenario: A catalogue that reaches its bound says so
- **GIVEN** a repository carrying more skills than the catalogue bound
- **WHEN** its catalogue is built
- **THEN** the result states that the bound was reached and names it

### Requirement: Selective skill enablement

Every skill in the catalogue of a repository enrolled through **Add Git repository** SHALL be off
when the repository is enrolled. The system SHALL let the user turn each skill on or off
individually, turn every skill of the repository on or off at once, and turn every skill of one
folder group on or off at once. Only skills that are on SHALL be loaded into the agent session; a
skill that is off SHALL NOT appear in the agent's skills or system prompt.

The selection SHALL be addressed by the repository's server-issued identifier and SHALL be
validated against a freshly built catalogue of that repository: a skill path the catalogue does
not contain, a path outside the worktree, or an identifier the server does not know SHALL be
refused without changing anything. A change of selection SHALL take effect through a session
replacement with the same rollback guarantees as an enrollment: a replacement refused before
handoff leaves the previous selection persisted and the previous session active, and the client is
told it failed. The change SHALL be refused while any started workspace loading that repository is
streaming a turn or replacing its session, and on a runtime that cannot rebuild its resources.

A skill that first appears in the repository after enrollment — through an update or an external
change to the worktree — SHALL be off until the user turns it on. A skill that is on but whose
directory no longer exists or no longer contains `SKILL.md` SHALL NOT be passed to the runtime, and
the inventory SHALL show it as missing rather than as loaded. A skill that is on but that the
runtime did not load — a name another skill already claimed, frontmatter the runtime rejects —
SHALL be shown as on and not loaded, with the reason when the runtime reports one.

Repositories enrolled before this requirement, through skill roots, SHALL keep loading every skill
under those roots; this requirement does not change them.

#### Scenario: A newly enrolled collection loads nothing
- **WHEN** a repository carrying skills is enrolled through Add Git repository without turning any skill on
- **THEN** the repository and its catalogue appear in the inventory
- **AND** none of its skills is loaded into the agent session

#### Scenario: Turning one skill on loads that skill alone
- **GIVEN** an enrolled collection with every skill off
- **WHEN** the user turns on one skill and the change is applied
- **THEN** the replacement session loads that skill and no other skill from the repository

#### Scenario: All on and all off for the repository
- **GIVEN** an enrolled collection
- **WHEN** the user turns every skill of the repository on, then every skill off
- **THEN** after the first change every catalogued skill is loaded, and after the second none is

#### Scenario: All on for one folder group
- **GIVEN** an enrolled collection with skills in the groups `dev-skills` and `agent-skills`, all off
- **WHEN** the user turns on every skill of `dev-skills`
- **THEN** every skill of `dev-skills` is loaded and no skill of `agent-skills` is

#### Scenario: A selection outside the catalogue is refused
- **WHEN** a client sends a selection naming a path the repository's catalogue does not contain, a path outside the worktree, or an unknown repository identifier
- **THEN** the request is refused, nothing is persisted, and the session is not replaced

#### Scenario: A refused replacement keeps the previous selection
- **GIVEN** a selection change that requires replacing the session
- **WHEN** replacement is refused before the new session takes over
- **THEN** the previous selection stays persisted and the previous session stays active
- **AND** the client receives a failure

#### Scenario: A busy workspace blocks a selection change
- **WHEN** a started workspace loading the repository is streaming a turn or replacing its session
- **THEN** the selection change is refused, naming the busy workspace, and nothing changes

#### Scenario: A skill added by an update stays off
- **GIVEN** an enrolled collection with some skills on
- **WHEN** a repository update adds a new skill directory
- **THEN** the new skill appears in the catalogue as off and is not loaded
- **AND** the skills that were on stay on

#### Scenario: A skill that is on but gone is reported missing
- **GIVEN** a skill that is on
- **WHEN** its directory is removed from the worktree and the resources are rebuilt
- **THEN** the runtime is not given its path and the inventory shows it as missing

#### Scenario: A skill that is on but not loaded says so
- **GIVEN** two skills that are on and declare the same name
- **WHEN** the session loads its skills
- **THEN** the skill the runtime did not load is shown as on and not loaded

#### Scenario: A root-enrolled repository keeps loading everything
- **GIVEN** a repository enrolled before this change through a skill root
- **WHEN** the server starts with this change
- **THEN** every skill under that root is still loaded and no selection is imposed on it

### Requirement: Whole-repository removal

The system SHALL let the user remove an enrolled repository as a whole, addressed by its
server-issued identifier. Removal SHALL unregister every user skill root, user extension root and
skill selection belonging to that repository, and SHALL then delete the repository's clone from
disk when pi-outpost manages that clone — it created the clone, or the clone lies inside
pi-outpost-managed resource storage. A repository the user pointed at outside managed storage
SHALL be unregistered and its files SHALL be kept, and the result SHALL say that they were kept and
where.

Removal SHALL be refused, with nothing unregistered or deleted, when the repository supplies a path
declared in the configuration file, when its identifier is unknown, when any started workspace
loading it is streaming a turn or replacing its session, and on a runtime that cannot rebuild its
resources. Deletion SHALL be confined to the repository's canonical worktree: it SHALL NOT follow a
symbolic link out of it, SHALL NOT delete a filesystem root, the managed-storage folder itself, or a
path that is not the top-level folder of the enrolled repository.

Unregistering SHALL take effect through a session replacement with the enrollment rollback
guarantees, and the clone SHALL be deleted only after the replacement session has taken over, so no
session still loads resources from files being deleted. A replacement refused before handoff SHALL
leave the registration and the files as they were. A deletion that fails after unregistering SHALL
be reported as such — the repository is no longer loaded, its files remain at a named path — and
MUST NOT be reported as a complete removal.

#### Scenario: Removing a managed collection deletes its clone
- **GIVEN** a repository cloned by pi-outpost into managed storage, with some skills on
- **WHEN** the user removes the repository
- **THEN** none of its skills or extensions is loaded, no settings entry refers to it, and its clone no longer exists on disk

#### Scenario: A repository outside managed storage keeps its files
- **GIVEN** a repository enrolled from a folder outside managed storage that pi-outpost did not create
- **WHEN** the user removes the repository
- **THEN** it is unregistered and no longer loaded
- **AND** its files are left in place and the result says so, naming the path

#### Scenario: A configuration-file path blocks removal
- **GIVEN** a repository that supplies a skill or extension path declared in the configuration file
- **WHEN** the user asks to remove it
- **THEN** the removal is refused and nothing is unregistered or deleted

#### Scenario: Removal is refused while a consumer is busy
- **WHEN** a started workspace loading the repository is streaming a turn or replacing its session
- **THEN** the removal is refused, naming the busy workspace, and nothing is unregistered or deleted

#### Scenario: A refused replacement keeps the repository
- **WHEN** the session replacement that unregistering requires is refused before handoff
- **THEN** the repository stays registered, its files stay on disk, and the client receives a failure

#### Scenario: Deletion never leaves the worktree
- **GIVEN** a managed clone containing a symbolic link to a directory outside it
- **WHEN** the repository is removed
- **THEN** the linked directory and its contents are untouched

#### Scenario: A failed deletion is reported as partial
- **GIVEN** a managed clone whose files cannot all be deleted
- **WHEN** the repository is removed
- **THEN** the result states that the repository is no longer loaded and that files remain at the named path

#### Scenario: An unknown repository is refused
- **WHEN** a client asks to remove an identifier the server does not know
- **THEN** the request is refused and no file is deleted

### Requirement: Repository display name

The system SHALL name a repository, in its preview and its inventory group, after the repository
its `origin` remote points to — the last segment of that address without a `.git` suffix, query or
fragment — rather than after the local folder it was cloned into. A worktree without an `origin`
SHALL be named after its folder. The name SHALL NOT carry credentials from the address.

#### Scenario: A repository is named after its origin
- **GIVEN** a clone of `https://github.com/khalilbenaz/claude-skills-collection.git` in a local folder named `resources-3f9a1c2b7e`
- **WHEN** it is previewed and enrolled
- **THEN** the preview and the inventory name it `claude-skills-collection`

#### Scenario: A repository without an origin keeps its folder name
- **GIVEN** a worktree with no `origin` remote
- **WHEN** it is inventoried
- **THEN** it is named after its folder

## MODIFIED Requirements

### Requirement: Repository enrollment

The Agent resources dialog SHALL expose two distinct enrollment operations. **Add local folder** SHALL let the user select an existing server-side directory and identify it as a skill or extension root, preserving the existing user-path behavior whether or not that folder belongs to Git. **Add Git repository** SHALL require both a repository address and a local server-side clone folder. The interface SHALL suggest a collision-resistant folder under pi-outpost-managed resource storage and SHALL let the user replace it or choose its parent with the server-directory picker.

The server SHALL accept only a non-empty repository address in a supported HTTPS, SSH, Git, file, or SCP-like Git form, SHALL pass it to Git as data rather than as an option or shell input, and SHALL redact embedded credentials from errors returned to clients. It SHALL resolve the requested clone folder through a canonical existing parent, refuse a filesystem root, an invalid basename, symlink ambiguity, or an occupied destination that is not the same origin, and SHALL NOT overwrite or empty existing content. Re-adding the same address and folder SHALL reuse its existing clone after verifying its origin rather than creating a duplicate. Clone operations SHALL disable repository hooks, decline recursive submodule initialization, and report a failed clone without registering resource paths.

After a clone, and before changing runtime settings, the system SHALL inspect that worktree without importing or executing extension code and SHALL present a preview of the repository's skill catalogue, as described under Skill collection catalogue, and of the extension roots it can register. The user SHALL explicitly select which extension roots to activate; every skill in the catalogue SHALL start off, and the preview SHALL let the user turn skills on before confirming. Confirming with no skill turned on and no extension root selected SHALL still enroll the repository and its catalogue, loading nothing from it.

Confirmed skill selections SHALL be persisted as that repository's collection selection, and confirmed extension roots SHALL be persisted using the existing user extension-path setting. Existing deployment-configured paths SHALL remain unchanged. Extension roots SHALL require the same executable-code warning as any other extension-path addition, and `extensionLock` SHALL prevent selecting or confirming extension roots while still permitting skill-only enrollment.

After an activated root or selection is persisted, the replacement session SHALL be created from the same effective sandbox and resource configuration that produced the rebuilt inventory. Every configured skill root, enabled collection skill, prompt root, extension directory, and extension script SHALL remain a read-only sandbox exception even when it is outside `sandbox.root`; those exceptions MUST NOT widen write access. The system SHALL acknowledge the activation only after the replacement session has taken over with that configuration.

If session replacement is refused before handoff to the new session, the system SHALL restore the previous persisted settings, workspace resources, runtime factory, and file-browser boundary, SHALL keep the prior session active, and SHALL report failure instead of acknowledging the activation. This pre-handoff rollback is distinct from a Git update whose worktree has already advanced: the latter retains its explicit partial-failure semantics under Affected runtime reload.

A preview SHALL be bound to the repository revision, catalogue and root set it observed, SHALL expire, and SHALL be usable once: a confirmation arriving after expiry, after a second use, or after the observed catalogue or roots changed SHALL be refused and SHALL require a fresh preview. A cloned worktree with neither a catalogued skill nor a recognizable extension root, or a selected skill or root that changes before confirmation, SHALL be refused without changing settings. Re-enrolling a canonical worktree already represented as a collection SHALL merge newly confirmed extension roots and skills into its existing group without duplicating paths, selections or repositories, and SHALL leave skills already on as they were. Re-enrolling a canonical worktree already represented through user skill roots SHALL keep those roots and their load-everything behaviour. Removing a repository is governed by Whole-repository removal.

#### Scenario: Add a local skill folder
- **WHEN** the user selects Add local folder, chooses an existing directory, and identifies it as a skill root
- **THEN** that directory is persisted once in the user skill paths and rebuilt into the active runtime

#### Scenario: Add a local extension folder
- **WHEN** the user selects Add local folder and chooses to add an extension root
- **THEN** the executable-code warning is shown before the directory is persisted
- **AND** an extension-locked deployment refuses the addition

#### Scenario: Activated external resources remain readable
- **GIVEN** a skill or extension root, or an enabled collection skill, is outside the current sandbox root
- **WHEN** the user activates it through Add local folder or a Git repository preview or selection
- **THEN** the replacement session discovers or loads the resource
- **AND** its read, list, search, and find tools can access that configured location without granting write access there

#### Scenario: Refused replacement rolls enrollment back
- **GIVEN** activating a resource root or selection requires replacing the current session
- **WHEN** an extension or lifecycle hook refuses replacement before the new session takes over
- **THEN** the persisted settings, workspace resources, runtime tool factory, file-browser boundary, and active session remain as they were before the request
- **AND** the client receives a failure rather than a successful settings acknowledgement

#### Scenario: Add a repository containing skills and extensions
- **WHEN** the user selects a Git worktree containing catalogued skills and recognizable extension roots, turns on some skills and confirms the extension roots from the preview
- **THEN** the skill selection and the user extension paths are persisted and the rebuilt inventory shows one mixed repository group
- **AND** only the skills turned on are loaded

#### Scenario: Enrollment does not execute extensions during preview
- **WHEN** the selected repository contains an extension whose module has an observable top-level side effect
- **THEN** previewing the repository does not trigger that side effect

#### Scenario: Extension lock permits skill-only enrollment
- **WHEN** extension paths are locked and the selected repository contains both catalogued skills and extension roots
- **THEN** the preview permits confirming the skill selection but disables extension roots with the lock reason

#### Scenario: Clone address is required and confined
- **WHEN** the repository address is invalid or the local folder is a filesystem root, has no canonical parent, uses an invalid final segment, or is occupied by different content
- **THEN** enrollment is refused before Git starts and no existing content is overwritten
- **AND** neither value is interpreted through a shell

#### Scenario: Clone has no recognizable resources
- **WHEN** a repository is cloned successfully but contains neither a catalogued skill nor a recognizable extension root
- **THEN** no runtime path or selection is registered and the dialog explains that the clone has nothing it can activate

#### Scenario: Re-add the same repository address
- **WHEN** the user submits an address and local folder already holding a clone with the same canonical origin
- **THEN** the server verifies and reuses that clone and presents a fresh resource preview without creating a second clone

#### Scenario: Re-enroll an existing repository
- **WHEN** a selected worktree is already represented as a collection and the user confirms a newly discovered extension root or turns on another skill
- **THEN** the path or skill is added once to the existing repository group, skills already on stay on, and no duplicate repository is created

#### Scenario: Enroll with nothing turned on
- **WHEN** the user confirms a collection preview without turning any skill on and without selecting an extension root
- **THEN** the repository is enrolled with its catalogue and nothing from it is loaded
