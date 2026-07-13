## ADDED Requirements

### Requirement: SessionRenameMessage

The protocol SHALL carry `rename_session { path, name }` (client → server). The server SHALL accept it only for an allowlisted session path (`SessionManager.list` for the current cwd), SHALL persist the name on that session — through the live `AgentSession` when the path is the active session, through `SessionManager.open(path).appendSessionInfo(name)` otherwise — and SHALL then broadcast the refreshed `sessions` frame to every connected client. An empty name SHALL clear the session's name.

#### Scenario: RenameBroadcast
- **GIVEN** two connected clients
- **WHEN** one renames a session
- **THEN** both receive an updated `sessions` frame carrying the new name

#### Scenario: RenameUnknownPath
- **WHEN** a client sends `rename_session` for a path the session list never advertised
- **THEN** the server answers `error: "Unknown session"` and writes nothing

### Requirement: SessionSearchMessages

The protocol SHALL carry `search_sessions { query, requestId }` (client → server) and `session_search_results { requestId, query, sessions }` (server → client). The server SHALL match the query case-insensitively against each session's name, first message and full transcript text (`SessionInfo.allMessagesText`), and SHALL answer only to the requesting socket. Results SHALL reuse `SessionSummary`, whose `snippet` field SHALL carry the matched excerpt and SHALL be absent outside search results.

#### Scenario: SearchAnswersRequester
- **GIVEN** two connected clients
- **WHEN** one searches sessions
- **THEN** only that client receives `session_search_results`, echoing its `requestId` and query

#### Scenario: TranscriptsStayServerSide
- **WHEN** the server answers a session search
- **THEN** each result carries at most a short snippet, never the session's full transcript text
