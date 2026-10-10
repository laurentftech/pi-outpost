## MODIFIED Requirements

### Requirement: OpenAProjectByBrowsing

A client SHALL be able to open a project by walking the server's filesystem and choosing a directory, using the same directory picker the sandbox root already uses. The chosen directory becomes a workspace, is added to the set of open projects, and SHALL be usable immediately without restarting the server. A directory that is already open SHALL NOT be opened twice; the existing workspace is used instead.

The set of open projects SHALL persist across restarts, and SHALL be written before the workspace is opened, so that a project the user watched appear is still there at the next start.

In multi-user mode the set of open projects SHALL be kept per account: a project SHALL be opened only inside the signed-in account's root, SHALL be listed only to that account, and an account that has never opened a project SHALL be served a single workspace rooted at its account root rather than at `cwd`.

#### Scenario: OpeningADirectoryFromThePicker
- **GIVEN** a server with one open project
- **WHEN** the user browses to another directory and opens it
- **THEN** it becomes a second open project, listed alongside the first
- **AND** it can be switched to without restarting

#### Scenario: OpenProjectsSurviveARestart
- **GIVEN** three projects opened during a run
- **WHEN** the server is restarted
- **THEN** all three are listed as open projects

#### Scenario: OpeningAnAlreadyOpenDirectory
- **GIVEN** a project already open at a directory
- **WHEN** the user opens the same directory again
- **THEN** no second workspace is created and the existing one is used

#### Scenario: OpeningAnUnusableDirectory
- **WHEN** the user opens a path the server cannot read
- **THEN** the request fails with an error naming that path
- **AND** the set of open projects is unchanged

#### Scenario: FirstRunWithNoProjectsOpened
- **GIVEN** a server that has never had a project opened
- **WHEN** a client connects
- **THEN** it is served a single workspace rooted at `cwd`

#### Scenario: EachAccountHasItsOwnOpenProjects
- **GIVEN** multi-user mode, `alice` with two open projects and `bob` with one
- **WHEN** each lists the open projects
- **THEN** `alice` sees her two and `bob` sees his one

#### Scenario: OpeningOutsideTheAccountRootIsRefused
- **GIVEN** multi-user mode and `alice` signed in
- **WHEN** she asks to open a directory outside `<accounts.root>/alice/`
- **THEN** the request is refused and her open projects are unchanged

#### Scenario: AFirstSignInIsServedTheAccountRoot
- **GIVEN** multi-user mode and `alice` who has never opened a project
- **WHEN** she signs in
- **THEN** she is served a single workspace rooted at `<accounts.root>/alice/`

### Requirement: ReportWorkspaceActivity

The server SHALL report, for every open project, whether its workspace is stopped, starting, idle, working, waiting for the user, or ready for review. Waiting for an answer SHALL take precedence over ready for review, and a running turn SHALL be reported as working. An inactive workspace SHALL be ready for review only when its authoritative Work Plan satisfies the review-readiness conditions. A client SHALL receive updates to this state for workspaces it is not subscribed to, so background work is visible without switching.

In multi-user mode these updates SHALL reach only the clients of the account that owns the project: a client SHALL never be told that another account's project exists, nor its state.

#### Scenario: BackgroundProgressIsVisible
- **GIVEN** a client subscribed to workspace A
- **WHEN** an agent in workspace B starts and then finishes a turn without producing a review-ready Work Plan
- **THEN** the client is told B moved to working and then to idle
- **AND** it receives none of B's message content

#### Scenario: BackgroundResultIsVisible
- **GIVEN** a client subscribed to workspace A
- **WHEN** workspace B changes from working to an authoritative review-ready Work Plan and becomes inactive
- **THEN** the client is told B moved from working to ready for review
- **AND** it receives no Work Plan, task, artifact, conversation, or result content from B

#### Scenario: WaitingTakesPrecedence
- **GIVEN** a workspace whose Work Plan satisfies the review-readiness conditions
- **WHEN** its running turn is blocked on a question only the user can answer
- **THEN** its reported activity is waiting for the user rather than ready for review

#### Scenario: SeveralWorkspacesAreReady
- **GIVEN** several workspaces with independently authoritative review-ready Work Plans
- **WHEN** workspace activity is reported
- **THEN** every one of those workspaces is simultaneously reported as ready for review

#### Scenario: ActivityStaysWithinTheAccount
- **GIVEN** multi-user mode, `alice` and `bob` connected
- **WHEN** an agent in one of `bob`'s projects starts a turn
- **THEN** `bob`'s clients are told it is working
- **AND** `alice`'s clients receive no activity update about it
