## ADDED Requirements

### Requirement: AShownPosterFollowsItsFile

A poster open in the editor SHALL show its file's new version when the file changes on disk,
unless the editor holds unsaved touch-ups: those SHALL be kept, and once the editor holds none
(it says it is clean, or they are discarded) it SHALL show the file as it is then. The person's
own save SHALL NOT reopen the editor.

#### Scenario: AnAgentRewriteIsShown
- **GIVEN** a poster open in the editor with no unsaved touch-ups
- **WHEN** the agent rewrites the file
- **THEN** the editor shows the new version, and a save is checked against its time

#### Scenario: UnsavedTouchUpsAreKeptOverARewrite
- **GIVEN** a poster open in the editor with unsaved touch-ups
- **WHEN** the agent rewrites the file
- **THEN** the editor keeps the touch-ups and is not reopened, and saving them is refused
- **AND** once the editor holds no touch-ups any more, it shows the agent's version

#### Scenario: OwnSaveDoesNotReopen
- **WHEN** the person saves and the file is read back as written
- **THEN** the editor is not reopened

### Requirement: ASaveIsCheckedAgainstTheVersionShown

A save SHALL be checked against the modification time of the version the editor shows, never a
later one, so that a write landing after that version was read refuses the save instead of being
overwritten by it.

#### Scenario: ASaveIsCheckedAgainstTheShownVersion
- **GIVEN** the file was rewritten after the version shown was read, and before the editor opened
- **WHEN** the person saves
- **THEN** the save is checked against the shown version's time, and so refused
