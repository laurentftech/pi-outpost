## ADDED Requirements

### Requirement: AQuestionAskedWhileASessionStartsIsShown

A question an extension asks while a new session starts SHALL reach every client of the project
after the snapshot announcing that session, whatever the order in which the binding and the
announcement happen. Questions of the replaced session, cancelled with it, SHALL NOT be shown again.

#### Scenario: ANewSessionsStartQuestionReachesTheClient
- **GIVEN** an extension asking a question in every `session_start`, and the first session's question answered
- **WHEN** the client starts a new session
- **THEN** the new session's question arrives after `session_replaced`, the answered one is not sent again, and once it is answered the client is told the extensions have started
