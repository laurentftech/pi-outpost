## ADDED Requirements

### Requirement: SessionSearch

The session menu SHALL offer a search field, like the conversation tree's. A query SHALL match a session on its name, its first message, or anywhere in its transcript, case-insensitively. Matching SHALL happen server-side; full transcripts SHALL NOT be sent to the client. Results SHALL be the matching sessions, most recently modified first, capped at the same limit as the plain session list.

#### Scenario: FindByWordSaidMidConversation
- **GIVEN** a saved session whose only mention of "reconnect" is in a message halfway through
- **WHEN** the user searches for "reconnect" in the session menu
- **THEN** that session is listed among the results

#### Scenario: FindByName
- **GIVEN** a session named "Fix WebSocket reconnect loop"
- **WHEN** the user searches for "websocket"
- **THEN** the session is listed, regardless of what its first message says

#### Scenario: NoMatches
- **WHEN** the query matches no session
- **THEN** the menu shows an explicit "no matches" state, not an empty dropdown

#### Scenario: EmptyQueryRestoresList
- **GIVEN** an active search
- **WHEN** the user clears the query
- **THEN** the menu shows the full session list again

### Requirement: SearchResultSnippet

Each search result SHALL carry a short excerpt of the transcript around the first occurrence of the query (whitespace-collapsed, ellipsized), and the menu SHALL display it under the session's name, so the user sees why the session matched.

#### Scenario: SnippetShowsMatch
- **GIVEN** a query that matches a message in the middle of a session
- **WHEN** the results are displayed
- **THEN** the row shows an excerpt containing the matched text

### Requirement: StaleSearchResultsDiscarded

Search requests SHALL be correlated by request id, and the client SHALL ignore any result whose id is not that of the latest request, so results arriving out of order while the user types never overwrite newer ones.

#### Scenario: OutOfOrderResponses
- **GIVEN** the user types quickly and two searches are in flight
- **WHEN** the answer to the earlier one arrives last
- **THEN** the menu still shows the results of the latest query
