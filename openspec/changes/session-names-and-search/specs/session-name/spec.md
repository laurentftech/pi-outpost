## ADDED Requirements

### Requirement: AutoTitleAfterFirstExchange

Once the first exchange of a session has completed (a user message and its reply), the server SHALL generate a short display name (3–6 words) for that session from that exchange and persist it on the session file. Generation SHALL happen only when the session has no name yet, SHALL run off the prompt path (after the turn ends), and SHALL NOT block or delay any reply.

#### Scenario: TitleAppearsAfterFirstReply
- **GIVEN** a new session whose first prompt has just been answered
- **WHEN** the client opens the session menu
- **THEN** the session is listed under a short generated title instead of its first message

#### Scenario: GeneratedOnlyOnce
- **GIVEN** a session that already has a name (generated or user-given)
- **WHEN** further turns complete
- **THEN** the server does not generate a new title and the existing name is unchanged

#### Scenario: NamePersistsAcrossRestart
- **GIVEN** a session that was named
- **WHEN** the server restarts and the session list is requested again
- **THEN** the session is still listed under that name

### Requirement: TitleGenerationIsBestEffort

Title generation SHALL be best-effort: if no API key is available for the current model, or the model call fails, times out, or returns nothing usable, the server SHALL leave the session unnamed and SHALL NOT send an error to clients. An unnamed session SHALL continue to be displayed by its first message.

#### Scenario: NoCredentials
- **GIVEN** no API key is available for the session's model
- **WHEN** the first exchange completes
- **THEN** no title is generated, no error is shown, and the session lists under its first message

#### Scenario: ModelFailure
- **GIVEN** the title generation call fails
- **WHEN** the first exchange completes
- **THEN** the conversation is unaffected, no error frame is sent, and the session stays unnamed

### Requirement: TitleSanitization

A generated title SHALL be stored as a single line of plain text: first line only, trimmed, surrounding quotes removed, capped at 80 characters.

#### Scenario: VerboseModelAnswer
- **GIVEN** the model answers with several lines or a quoted sentence
- **WHEN** the title is persisted
- **THEN** the stored name is a single unquoted line of at most 80 characters

### Requirement: ManualRename

The user SHALL be able to rename any listed session — the live one or an idle one — from the session menu. The new name SHALL be persisted on that session's file and SHALL immediately replace the displayed name for every connected client. A rename SHALL take precedence over automatic naming: a named session is never re-titled.

#### Scenario: RenameIdleSession
- **GIVEN** a saved session that is not the active one
- **WHEN** the user renames it in the session menu
- **THEN** the session lists under the new name, and still does after a reload

#### Scenario: RenameLiveSession
- **GIVEN** the active session
- **WHEN** the user renames it
- **THEN** the running session and its file agree on the new name, and other connected clients see it without reopening the menu

#### Scenario: ClearName
- **GIVEN** a named session
- **WHEN** the user submits an empty name
- **THEN** the name is cleared and the session lists under its first message again

### Requirement: RenameTargetsAreAllowlisted

The server SHALL accept a rename only for a session path that `SessionManager.list` returns for the current working directory — the same allowlist that guards session switching and deletion. An unknown path SHALL be refused with an error and SHALL NOT write to any file.

#### Scenario: UnknownPathRefused
- **WHEN** a client sends a rename for a path the session list never advertised
- **THEN** the server answers with an error and no file is written
