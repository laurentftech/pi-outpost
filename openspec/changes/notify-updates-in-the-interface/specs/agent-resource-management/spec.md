## ADDED Requirements

### Requirement: ExtensionCodeRunsAfterARestart

A running server cannot load an extension's new code: a module it has already imported is what a second import returns. After updating a repository that supplies at least one extension, each rebuilt runtime SHALL therefore be reported as needing a restart, naming the repository, rather than as reloaded, and the repository SHALL join what waits on a restart to run. A repository that supplies skills alone SHALL still be reported as reloaded, because a rebuilt session reads skills again from disk.

#### Scenario: AnUpdatedExtensionRepositoryAsksForARestart
- **WHEN** a repository supplying an extension is updated and its runtimes are rebuilt
- **THEN** each rebuild is reported as needing a restart, naming the repository, and the repository is listed as waiting on one
- **AND** the agent still runs the previous extension code until pi-outpost restarts, and the new code after it

#### Scenario: ASkillsOnlyRepositoryIsReallyReloaded
- **WHEN** a repository supplying only skills is updated
- **THEN** its runtimes are reported as reloaded, nothing waits on a restart, and the agent has the new skill text
