## MODIFIED Requirements

### Requirement: ExtensionLock

Configuration SHALL be able to forbid interface-driven changes to extension paths and interface-driven Git updates that could change applicable extension code. The setting follows the existing lock convention: when set, the server refuses those requests and clients offer no affordance for them. Because a Git update operates on a repository as a unit, a locked repository that supplies both skills and extensions MUST NOT be updated through the interface.

Loading code is not the same act as pointing the agent at more text to read, so this lock is independent of any sandbox lock and of skill-path editing, which stays available under it. The lock does not prohibit read-only inventory or repository checks.

#### Scenario: ALockedServerRefusesTheChange
- **GIVEN** a configuration that locks extension paths
- **WHEN** a client requests a settings update that adds or removes one
- **THEN** the server refuses it and the configuration file is unchanged

#### Scenario: TheLockIsReportedToClients
- **GIVEN** a configuration that locks extension paths
- **WHEN** a client connects
- **THEN** the snapshot says extension paths are locked, so the interface can offer no control for them or for updating repositories that supply extensions

#### Scenario: TheLockLeavesSkillPathsAlone
- **GIVEN** a configuration that locks extension paths and does not lock anything else
- **WHEN** the user adds a skill path and applies settings
- **THEN** the skill path is accepted and persisted

#### Scenario: Locked extension repository cannot be updated
- **GIVEN** extension paths are locked and a known resource repository supplies an applicable extension
- **WHEN** a client requests that repository's update, including a direct request that bypasses the visible controls
- **THEN** the server refuses the update before changing the repository

#### Scenario: Lock still permits repository inspection
- **GIVEN** extension paths are locked and a known resource repository supplies an applicable extension
- **WHEN** a client opens the inventory or refreshes repository status
- **THEN** the inventory and read-only assessment remain available while update is reported as locked
