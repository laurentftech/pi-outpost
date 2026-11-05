## ADDED Requirements

### Requirement: UnansweredQuestionsSurviveTransportLoss
Losing every browser connection SHALL NOT answer or cancel an extension question. A question without
an extension-defined deadline SHALL remain pending and be shown again on reconnection. Reading or
clicking elsewhere SHALL NOT refuse it. Explicit answers and extension-defined expiry/abort remain authoritative.

#### Scenario: AnUnansweredQuestionSurvivesBrowserReconnection
- **GIVEN** a pending extension question without a timeout and only one browser connection
- **WHEN** that connection is lost and the user reconnects, then clicks elsewhere in the conversation
- **THEN** the same question remains answerable and no refusal is sent to the agent
- **AND** the user's eventual choice reaches the original request

### Requirement: AQuestionKeepsItsWorkspaceAlive
A workspace waiting for a user answer SHALL NOT be retired for inactivity, including when an
extension command waits without the model streaming and no client watches the server.

#### Scenario: AWaitingProjectOutlivesItsIdleTimeout
- **GIVEN** an unwatched non-default workspace with a question pending
- **WHEN** multiple retirement sweeps run past its configured idle timeout
- **THEN** the workspace and its original question remain available on return

### Requirement: DeliberateReplacementCanEndWaiting
Explicit session replacement SHALL release blocked questions before asking the runtime to replace
the session. Keeping a question through a transport interruption SHALL NOT deadlock a later new session.

#### Scenario: DeliberateSessionReplacementCanAbandonAQuestion
- **GIVEN** a pending question in an embedded or RPC runtime
- **WHEN** the user deliberately starts a new session
- **THEN** the old question is cancelled and the replacement completes
- **AND** the replacement runtime accepts subsequent commands
