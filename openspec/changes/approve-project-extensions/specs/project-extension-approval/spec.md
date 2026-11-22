# Spec Delta

## ADDED Requirements

### Requirement: AnUnapprovedProjectExtensionIsNotLoaded

Before creating a session's services, pi-outpost SHALL list the project's extensions and packages and SHALL keep from pi every one not approved for its current content, so that its code does not run.

#### Scenario: AnExtensionTheAgentWroteDoesNotRunUntilAllowed
- **GIVEN** a confined command wrote `.pi/extensions/x.ts`, a directory extension `.pi/extensions/d/index.ts`, and `.pi/settings.json` naming `../elsewhere.ts`
- **WHEN** a new conversation starts in that project
- **THEN** none of them is imported or run, and the session starts without them

#### Scenario: AChangedExtensionAsksAgain
- **GIVEN** an extension allowed for its content
- **WHEN** its file changes and a new conversation starts
- **THEN** it is not loaded until allowed again

### Requirement: TheUserIsAskedPerExtension

The interface SHALL ask about each unapproved extension, saying it will run outside the sandbox with every right of the user's account, with its code one click away. Allowing SHALL rebuild the session with it when the agent is idle, and otherwise load it with the next session, saying which; refusing SHALL be remembered for that content.

#### Scenario: AllowingLoadsIt
- **GIVEN** the question for `.pi/extensions/x.ts`
- **WHEN** the user allows it
- **THEN** the session is rebuilt with it, the user is told it is loaded, and a later conversation loads it without asking

#### Scenario: RefusingIsRemembered
- **GIVEN** the question for `.pi/extensions/x.ts`
- **WHEN** the user refuses it
- **THEN** it is not loaded, and later conversations do not ask again while its content is unchanged

### Requirement: ApprovalsAreOutOfTheAgentsReach

Approvals and refusals SHALL be kept by the server outside the project, the configuration file and every directory a confined command may read or write, and SHALL be listed in Settings, where each can be withdrawn.

#### Scenario: AConfinedCommandCannotApprove
- **GIVEN** the agent's shell confined by the runner
- **WHEN** a command tries to read or write the approvals
- **THEN** it is refused

### Requirement: InstallingFromSettingsIsAllowing

A package the user installs into the project from Settings SHALL be allowed by that act, before the session that loads it is built, and SHALL NOT be asked about.

#### Scenario: APackageInstalledFromSettingsIsNotAskedAbout
- **GIVEN** the user installs a pi package into the project's settings from Settings
- **WHEN** the next session is built
- **THEN** that package is loaded, and no question is asked about it

### Requirement: NoOneToAskMeansNotLoaded

In print mode, an unapproved extension SHALL NOT be loaded, and stderr SHALL name it and how to allow it.

#### Scenario: PrintModeLeavesItOut
- **GIVEN** an unapproved `.pi/extensions/x.ts`
- **WHEN** `pi-outpost -p "…"` runs in that project
- **THEN** it is not loaded, and stderr names it
