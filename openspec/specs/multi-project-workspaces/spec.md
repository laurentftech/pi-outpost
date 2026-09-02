# Multi-Project Workspaces Specification

## Purpose

Lets one pi-outpost server hold several projects at once, each with its own agent session, sandbox and history, so a user can switch the view between them while work continues in the projects they are not watching.

## Requirements

### Requirement: OpenAProjectByBrowsing

A client SHALL be able to open a project by walking the server's filesystem and choosing a directory, using the same directory picker the sandbox root already uses. The chosen directory becomes a workspace, is added to the set of open projects, and SHALL be usable immediately without restarting the server. A directory that is already open SHALL NOT be opened twice; the existing workspace is used instead.

The set of open projects SHALL persist across restarts, and SHALL be written before the workspace is opened, so that a project the user watched appear is still there at the next start.

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

### Requirement: CloseAProject

A client SHALL be able to close an open project. Closing SHALL stop its workspace, release its resources, and remove it from the set of open projects; the project's session history on disk SHALL be left untouched, so reopening the same directory finds it again.

Closing a workspace whose agent is running a turn SHALL be refused, with an error saying so. The last remaining open project SHALL NOT be closable.

#### Scenario: ClosingReleasesTheWorkspace
- **GIVEN** an idle open project
- **WHEN** the user closes it
- **THEN** its workspace is stopped and it is no longer listed
- **AND** clients bound to it are moved to another open project

#### Scenario: ReopeningFindsTheHistory
- **GIVEN** a project closed after several sessions
- **WHEN** the same directory is opened again
- **THEN** its earlier sessions are listed

#### Scenario: ClosingAWorkingProjectIsRefused
- **GIVEN** an open project whose agent is streaming a turn
- **WHEN** the user closes it
- **THEN** the request is refused with an error naming the running turn
- **AND** the workspace keeps running

### Requirement: OpenAWorkspaceLazily

A workspace's agent session SHALL be created the first time that workspace is opened, not when the server starts. Server startup time SHALL NOT grow with the number of open projects.

#### Scenario: StartupDoesNotBuildEveryWorkspace
- **GIVEN** five projects open from a previous run
- **WHEN** the server starts
- **THEN** no agent session is created, and the server begins listening

#### Scenario: FirstOpenBuildsTheSession
- **GIVEN** an open project whose workspace has not been used in this run
- **WHEN** a client opens it
- **THEN** its agent session, sandbox, roots, toolset, watcher and session manager are created
- **AND** the client is told the workspace is starting until it is ready

### Requirement: SwitchWithoutDisturbingOtherWorkspaces

Switching a client from one workspace to another SHALL change only what that client is subscribed to. It SHALL NOT cancel, pause or rebuild any other workspace, and a turn running in the workspace being left SHALL continue to completion.

#### Scenario: TheAgentKeepsWorkingAfterASwitch
- **GIVEN** an agent streaming a turn in workspace A
- **WHEN** the client switches to workspace B
- **THEN** the turn in A runs to completion
- **AND** its result is available in A when the client returns

#### Scenario: OtherClientsAreUnaffected
- **GIVEN** two clients, one on workspace A and one on workspace B
- **WHEN** the first switches to workspace C
- **THEN** the second continues to receive workspace B's messages and no others

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

### Requirement: PerWorkspaceSessionHistory

Session listing, opening, renaming and searching SHALL be scoped to the workspace the client is subscribed to. Returning to a workspace SHALL show the sessions belonging to that project, including the conversation that was live when the client left it.

#### Scenario: HistoryFollowsTheProject
- **GIVEN** workspace A with three past sessions and workspace B with one
- **WHEN** a client subscribed to A lists sessions
- **THEN** it receives A's three, and none of B's

#### Scenario: TheLiveConversationSurvivesASwitch
- **GIVEN** a conversation in progress in workspace A
- **WHEN** the client switches to B and later back to A
- **THEN** it is shown the same conversation, including anything the agent produced while it was away

### Requirement: ForgetTheViewButKeepTheDraft

Switching SHALL restore the destination workspace's conversation and nothing else of the screen: the open file, the scroll position and any diff pane are not preserved across a switch. Text the user has typed into the composer and not sent SHALL be kept per workspace and restored on return, since losing it would destroy work rather than reset a view.

#### Scenario: TheOpenFileIsNotRestored
- **GIVEN** a client viewing workspace A with a file open
- **WHEN** it switches to workspace B and later back to A
- **THEN** no file is open, and the conversation is shown

#### Scenario: TheUnsentDraftIsRestored
- **GIVEN** an unsent message typed in workspace A's composer
- **WHEN** the client switches to workspace B and later back to A
- **THEN** the composer holds that text again

#### Scenario: DraftsDoNotFollowTheClient
- **GIVEN** an unsent message typed in workspace A's composer
- **WHEN** the client switches to workspace B
- **THEN** B's composer holds B's own draft, or nothing — never A's

### Requirement: RetireIdleWorkspaces

A workspace with no client subscribed and no turn running MAY be stopped after a configured period of inactivity, releasing its watcher and session. A workspace SHALL NOT be stopped while a turn is running or while its authoritative Work Plan makes it ready for review, however long it has been unattended, and a stopped workspace SHALL be rebuilt transparently when it is next opened.

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

### Requirement: ReportWorkspaceActivity

The server SHALL report, for every open project, whether its workspace is stopped, starting, idle, working, waiting for the user, or ready for review. Waiting for an answer SHALL take precedence over ready for review, and a running turn SHALL be reported as working. An inactive workspace SHALL be ready for review only when its authoritative Work Plan satisfies the review-readiness conditions. A client SHALL receive updates to this state for workspaces it is not subscribed to, so background work is visible without switching.

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

### Requirement: RaiseAttentionFromABackgroundWorkspace

When a workspace that no client is currently viewing needs the user — because a permission prompt, extension question, or other request blocks its turn, or because its authoritative Work Plan makes it ready for review — the client SHALL surface that workspace through the existing project-selector attention mechanism. The selector SHALL distinguish `ready for review` from `waiting for you` with explicit accessible wording and a distinguishable state mark.

A blocking request SHALL remain pending rather than being cancelled. When the document is not in the foreground and the user has granted permission, the client SHALL additionally raise one browser notification per newly waiting or newly review-ready background workspace. Each notification SHALL name only the project and the kind of attention required; it SHALL NOT include conversation, Work Plan, task, artifact, result, or other workspace content.

Attention raised in one workspace SHALL NOT interrupt another: no modal, dialog or focus change is imposed on the workspace the client is currently viewing. Selecting or leaving a review-ready workspace SHALL NOT acknowledge it; the selector and notification deduplication SHALL follow subsequent authoritative activity updates.

#### Scenario: APendingQuestionIsNotDiscarded
- **GIVEN** a turn in workspace B blocked on a permission prompt and no client viewing B
- **WHEN** the user is subscribed to workspace A
- **THEN** the prompt stays pending
- **AND** B is reported as waiting for the user

#### Scenario: AnsweringAfterSwitchingBack
- **GIVEN** workspace B waiting for the user
- **WHEN** the client switches to B
- **THEN** the pending request is shown and can be answered
- **AND** the turn resumes

#### Scenario: ReviewReadySelectorStatePersistsAcrossSelection
- **GIVEN** workspace B is ready for review
- **WHEN** the user selects B and later switches away without an authoritative Work Plan change
- **THEN** B remains marked ready for review in the selector

#### Scenario: NotificationOnlyWhenUnattended
- **GIVEN** a background workspace that starts waiting for the user or becomes ready for review
- **WHEN** the document is in the foreground
- **THEN** the selector raises the appropriate attention indicator and no browser notification is sent

#### Scenario: ReviewNotificationContainsNoWorkspaceContent
- **GIVEN** workspace B becomes ready for review while the user is viewing workspace A and the document is unattended
- **WHEN** the browser notification is raised
- **THEN** it names B and says that review is ready
- **AND** it contains no Work Plan, task, artifact, result, or conversation content from B

#### Scenario: NothingInterruptsTheCurrentWorkspace
- **GIVEN** a client viewing workspace A
- **WHEN** workspace B starts waiting for the user or becomes ready for review
- **THEN** no dialog opens over A and the focus is unchanged
- **AND** the only change to A's screen is the selector's attention indication

#### Scenario: TwoWorkspacesNeedAttentionAtOnce
- **GIVEN** two workspaces independently start waiting for the user or become ready for review while the document is unattended
- **WHEN** the notifications are raised
- **THEN** each notification names its own project and its kind of attention

#### Scenario: TwoWorkspacesWaitingAtOnce
- **GIVEN** two workspaces that start waiting for the user while the document is unattended
- **WHEN** the notifications are raised
- **THEN** each names its own project

### Requirement: PinAWorkspaceByConfiguration

Configuration SHALL be able to bind a server to a single workspace and forbid opening, closing and switching. When pinned, the server SHALL refuse those requests, and clients SHALL offer no affordance for them.

#### Scenario: PinnedServerRefusesASwitch
- **GIVEN** a configuration pinning the server to one workspace
- **WHEN** a client asks to switch to another open project
- **THEN** the request is refused with an error and the subscription is unchanged

#### Scenario: PinnedServerRefusesAnOpen
- **GIVEN** a configuration pinning the server to one workspace
- **WHEN** a client asks to open a directory as a new project
- **THEN** the request is refused and no workspace is created

### Requirement: AlwaysNameTheProjectOnScreen

The interface SHALL always name the project it is showing, in the same control and the
same place, whatever the number of projects open — one included. The server SHALL
therefore describe the bound project and list the open projects on every snapshot,
without a threshold.

A selector's first job is to say where the user is; choosing is its second. With one
project open only the first remains, and it is the one that matters most — a user who
cannot see which project they are in cannot trust anything else on the screen.

Opening a second project SHALL add a choice to that control, not replace it with a
different one: the interface SHALL NOT change shape as the number of open projects
crosses any threshold.

Where a control is not offered at all — a pinned server, or a mounted widget whose
policy withholds it — this requirement adds nothing: it governs what the control says
when there is one, never whether there is one.

#### Scenario: OneProjectIsStillNamed
- **GIVEN** a server with exactly one open project
- **WHEN** a client connects
- **THEN** the interface names that project, with its state, in the workspace control

#### Scenario: TheControlDoesNotChangeShape
- **GIVEN** a client showing one open project
- **WHEN** a second project is opened
- **THEN** the same control, in the same place, now offers the choice between them
- **AND** nothing about naming the current project has changed

#### Scenario: OpeningStaysReachableFromTheControl
- **GIVEN** a server with exactly one open project
- **WHEN** the user looks for a way to open another
- **THEN** the workspace control offers it

#### Scenario: APinnedServerStillOffersNothing
- **GIVEN** a configuration that pins the server to one project
- **WHEN** a client connects
- **THEN** no workspace control is offered, and no project is named by one
