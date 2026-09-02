## MODIFIED Requirements

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
