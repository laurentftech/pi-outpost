## MODIFIED Requirements

### Requirement: IsolateWorkspacesFromEachOther

Each workspace SHALL own its agent session, sandbox, browser and writable roots, its set of
git repositories, file watcher, toolset, session manager, work plan, Outcome source state and
code-intelligence runtime. A server message
produced by one workspace SHALL reach only the clients subscribed to that workspace. A tool
call in one workspace SHALL be confined to that workspace's sandbox. A git command served
for one workspace SHALL run only against a repository in that workspace's own set, whichever
repositories another open workspace holds. An Outcome request SHALL be composed only from the
current session and repositories of the workspace to which the requesting client is bound; its
updates and navigation targets SHALL NOT expose or act on another workspace's state.

A workspace's code-intelligence runtime SHALL analyse that workspace's working tree and no other, and SHALL share no index, cache or mutable analysis state with another workspace — including a workspace open on another git worktree of the same repository.

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

#### Scenario: CodeIntelligenceIsPerWorkspace
- **GIVEN** workspace A and workspace B open on two git worktrees of one repository
- **WHEN** each builds or updates its code-intelligence index
- **THEN** each index describes only its own working tree, and neither workspace reads or writes the other's analysis state

### Requirement: RetireIdleWorkspaces

A workspace with no client subscribed and no turn running MAY be stopped after a configured period of inactivity, releasing its watcher, session and code-intelligence runtime. A workspace SHALL NOT be stopped while a turn is running or while its authoritative Work Plan makes it ready for review, however long it has been unattended, and a stopped workspace SHALL be rebuilt transparently when it is next opened — its code intelligence included, started or resumed as part of that rebuild.

Releasing or suspending one workspace's code-intelligence resources SHALL leave every other workspace's running.

#### Scenario: WorkingWorkspacesAreNeverRetired
- **GIVEN** a workspace with no client subscribed whose agent has been streaming past the inactivity period
- **WHEN** the retirement sweep runs
- **THEN** the workspace is left running

#### Scenario: ReviewReadyWorkspacesAreNeverRetired
- **GIVEN** an unattended workspace whose authoritative Work Plan makes it ready for review
- **WHEN** the retirement sweep runs
- **THEN** the workspace is left available and remains reported as ready for review

#### Scenario: ReopeningARetiredWorkspace
- **GIVEN** a workspace stopped after inactivity
- **WHEN** a client opens it again
- **THEN** it is rebuilt and its session history is intact
- **AND** its code intelligence is started or resumed for it

#### Scenario: RetiringOneLeavesTheOthersAnalysing
- **GIVEN** three workspaces with code-intelligence runtimes, one of them idle past the inactivity period
- **WHEN** the retirement sweep stops the idle one
- **THEN** its analysis resources are released
- **AND** the other two keep theirs, indexing or ready as they were
