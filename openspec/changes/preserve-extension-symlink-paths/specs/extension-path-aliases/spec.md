## ADDED Requirements

### Requirement: StableExtensionDirectoryAliases
Local extension enrollment SHALL validate that a chosen path resolves to an existing directory,
while persisting its normalized absolute spelling without replacing symlinks. The UI SHALL show
the configured folder and use it for removal. Canonical identities and repository checks SHALL
continue to use actual targets. Changing an alias SHALL take effect on a fresh server start.

#### Scenario: PreservesTheChosenExtensionAlias
- **GIVEN** a directory alias pointing at an extension version
- **WHEN** the user adds it through the resource manager
- **THEN** the stored settings, server acknowledgement and displayed configured folder retain the alias
- **AND** the real extension loads and repeated identical paths are stored only once

#### Scenario: RetargetedAliasLoadsAfterRestart
- **GIVEN** an enrolled alias is repointed to a new extension directory and the old target is removed
- **WHEN** a new server process loads the saved extension settings
- **THEN** the new extension's command is present and the old command is absent without editing settings

#### Scenario: RemovesTheAliasWithoutRemovingItsTarget
- **GIVEN** an enrolled directory alias whose inventory describes its canonical target
- **WHEN** the user removes the resource
- **THEN** the alias is unregistered and its commands are no longer loaded
- **AND** the alias and target files still exist

#### Scenario: RefusesInvalidExtensionAliases
- **WHEN** an extension update names a dangling directory alias or a file instead of a directory
- **THEN** the request fails without persisting the invalid path or replacing the active session
