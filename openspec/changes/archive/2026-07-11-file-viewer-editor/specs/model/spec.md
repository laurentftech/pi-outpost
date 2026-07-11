# Delta: model — file-viewer-editor

## MODIFIED Requirements

### Requirement: ClientMessageValidation

The system SHALL validate ClientMessage according to these rules:
- type must be one of: prompt, abort, set_model, set_thinking, new_session, switch_session, delete_session, list_sessions, compact, list_directory, read_file, write_file, search_files, list_tree, navigate_tree, fork_session, extension_ui_response
- When type is 'prompt', text is required (images optional)
- When type is 'set_model', provider and id are required
- When type is 'set_thinking', level is required
- When type is 'switch_session' or 'delete_session', path is required
- When type is 'list_directory' or 'read_file', path and requestId are required
- When type is 'write_file', path, content, expectedMtimeMs, and requestId are required
- When type is 'search_files', query and requestId are required
- When type is 'navigate_tree' or 'fork_session', entryId is required
- Malformed or non-object frames are ignored without crashing the server

#### Scenario: SendPromptMessage
- **GIVEN** Client has text to send
- **WHEN** Client sends message with type 'prompt'
- **THEN** Server receives prompt message with text content and optional images

#### Scenario: AbortOperation
- **GIVEN** Client has ongoing operation
- **WHEN** Client sends message with type 'abort'
- **THEN** Server aborts the ongoing operation

#### Scenario: SetModel
- **GIVEN** Client knows provider and model id
- **WHEN** Client sends message with type 'set_model'
- **THEN** Server sets the model for subsequent operations

#### Scenario: SetThinkingLevel
- **GIVEN** Client knows desired thinking level
- **WHEN** Client sends message with type 'set_thinking'
- **THEN** Server sets the thinking level for processing

#### Scenario: CreateNewSession
<!-- openlore-test: tags=smoke (auto) -->
- **GIVEN** Client wants to start a new session
- **WHEN** Client sends message with type 'new_session'
- **THEN** Server creates a new session

#### Scenario: SwitchSession
- **GIVEN** Client knows path of session to switch to (from the server's session listing)
- **WHEN** Client sends message with type 'switch_session'
- **THEN** Server switches to the specified session

#### Scenario: DeleteSession
- **GIVEN** Client knows path of session to delete
- **WHEN** Client sends message with type 'delete_session'
- **THEN** Server deletes the specified session

#### Scenario: ListSessions
- **GIVEN** Client wants to see available sessions
- **WHEN** Client sends message with type 'list_sessions'
- **THEN** Server returns list of available sessions

#### Scenario: CompactSession
- **GIVEN** Client wants to compact the conversation context
- **WHEN** Client sends message with type 'compact'
- **THEN** Server compacts the current session

#### Scenario: ListDirectory
- **GIVEN** Client knows path to directory
- **WHEN** Client sends message with type 'list_directory'
- **THEN** Server returns contents of the specified directory

#### Scenario: ReadFile
- **GIVEN** Client knows path to file
- **WHEN** Client sends message with type 'read_file'
- **THEN** Server returns contents of the specified file with size and mtimeMs

#### Scenario: WriteFile
- **GIVEN** Client has edited content for an open file
- **WHEN** Client sends message with type 'write_file'
- **THEN** Server writes the file if permitted and unchanged on disk, answering with 'file_written' (new size and mtimeMs) or 'file_browser_error'

#### Scenario: SearchFiles
- **GIVEN** Client has search query
- **WHEN** Client sends message with type 'search_files'
- **THEN** Server returns files matching the search query

#### Scenario: ListTree
- **GIVEN** Client wants to see the conversation tree of the current session
- **WHEN** Client sends message with type 'list_tree'
- **THEN** Server returns the tree of user-message entry points (with the active path marked)

#### Scenario: NavigateTree
- **GIVEN** Client knows entryId of a user message to rewind to
- **WHEN** Client sends message with type 'navigate_tree'
- **THEN** Server rewinds the session to just before that entry and prefills the composer with its text

#### Scenario: ForkSession
<!-- openlore-test: tags=smoke (auto) -->
- **GIVEN** Client knows entryId of a user message to fork from
- **WHEN** Client sends message with type 'fork_session'
- **THEN** Server creates a new session file forked from that entry
