## MODIFIED Requirements

### Requirement: IsolateWorkspacesFromEachOther

Each workspace SHALL own its agent session, sandbox, browser and writable roots, its set of
git repositories, file watcher, toolset, session manager, work plan and Outcome source state. A server message
produced by one workspace SHALL reach only the clients subscribed to that workspace. A tool
call in one workspace SHALL be confined to that workspace's sandbox. A git command served
for one workspace SHALL run only against a repository in that workspace's own set, whichever
repositories another open workspace holds. An Outcome request SHALL be composed only from the
current session and repositories of the workspace to which the requesting client is bound; its
updates and navigation targets SHALL NOT expose or act on another workspace's state.

#### Scenario: EventsDoNotCrossWorkspaces
- **GIVEN** turns running concurrently in workspace A and workspace B
- **WHEN** each emits streaming events
- **THEN** a client subscribed to A receives only A's events

#### Scenario: SandboxIsPerWorkspace
- **GIVEN** workspace A rooted at one directory and workspace B at another
- **WHEN** an agent tool in A tries to read a file under B's root
- **THEN** the tool call fails, unless that path is within A's own sandbox

#### Scenario: RepositoriesArePerWorkspace
- **GIVEN** workspace A and workspace B, each holding repositories under its own root
- **WHEN** a git request is served for a client subscribed to A
- **THEN** it is answered from A's repository set only, and none of B's repositories is consulted

#### Scenario: OutcomeIsPerWorkspace
- **GIVEN** workspace A and workspace B have different Work Plans, evidence, and changed files
- **WHEN** a client subscribed to A requests or refreshes Outcome
- **THEN** the response contains only A's current-session plan, evidence, and repository results
- **AND** no Outcome content from B reaches that client

#### Scenario: Workspace switch rejects stale Outcome
- **GIVEN** an Outcome request for workspace A is still in flight
- **WHEN** the client switches to workspace B before the response arrives
- **THEN** A's response is not rendered in B's Outcome view
- **AND** navigation offered in B remains confined to B
