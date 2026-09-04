## ADDED Requirements

### Requirement: AgentResourceMessages

The protocol SHALL carry the agent-resource operations as correlated request/response
pairs: `suggest_agent_resource_clone_path { repositoryUrl, requestId }`,
`clone_agent_resource_repository { repositoryUrl, destinationPath, requestId }`,
`enroll_agent_resource_repository { previewToken, skillRoots, extensionRoots, requestId }`,
`refresh_agent_resource_repositories { repositoryId?, requestId }` and
`update_agent_resource_repository { repositoryId, assessmentToken, allowExecutableChanges?, requestId }`
(client → server), answered by `agent_resource_clone_path`, `agent_resource_preview`,
`agent_resource_enrolled`, `agent_resource_assessments`, `agent_resource_update_result`
or `agent_resource_error` (server → client).

Every answer SHALL echo the `requestId` it answers and SHALL be sent only to the socket
that asked. A request SHALL be served against the workspace its socket is bound to, and
its answer SHALL NOT be delivered to a client bound elsewhere. A client MUST NOT be able
to name a repository by path or a revision by name: `repositoryId`, `previewToken` and
`assessmentToken` are opaque server-issued values, and the server SHALL refuse a value it
did not issue or that no longer matches the state it was issued for.

A failed operation SHALL answer `agent_resource_error` carrying a display-safe message
with any embedded credentials removed, and SHALL NOT be reported through the shared error
banner reserved for session errors. An answer that carries an inventory SHALL carry the
inventory the operation produced, so a client never has to infer the new state from the
request it sent.

#### Scenario: AnAnswerReachesOnlyItsRequester
- **GIVEN** two connected clients
- **WHEN** one refreshes agent resource repositories
- **THEN** only that client receives `agent_resource_assessments`, echoing its `requestId`

#### Scenario: AResourceRequestIsServedForItsOwnWorkspace
- **GIVEN** two clients bound to different workspaces
- **WHEN** one requests an inventory-changing agent-resource operation
- **THEN** it is composed from the requesting client's workspace and no answer reaches the other

#### Scenario: AnUnissuedIdentifierIsRefused
- **WHEN** a client sends `update_agent_resource_repository` with a `repositoryId` or
  `assessmentToken` the server never issued
- **THEN** the server answers `agent_resource_error` and starts no git process

#### Scenario: AFailureDoesNotLeakCredentials
- **WHEN** an operation fails on an address carrying userinfo
- **THEN** `agent_resource_error` names the failure without the credentials it was given
