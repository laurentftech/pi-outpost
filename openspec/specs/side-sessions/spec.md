# side-sessions Specification

## Purpose
Lets a user run a second agent on a project that is already open — a side session — at the same time as the first, for small side actions that should not wait for, or replace, the conversation that is working.

## Requirements

### Requirement: StartASideSession

A client SHALL be able to start a side session on an open project. A side session SHALL be a separate agent with its own conversation, started fresh, running in the same project directory with the same sandbox, tools, skills and extensions as the project, and on the model and thinking level the project's main session is using when it has started. Starting it SHALL NOT interrupt, replace or pause any other session of the project, including one running a turn, and the client that started it SHALL be moved to it.

#### Scenario: ASideSessionStartsWhileTheProjectWorks
- **GIVEN** an open project whose agent is running a turn
- **WHEN** the user starts a side session on it
- **THEN** the client is shown a new, empty conversation on the same project
- **AND** the project's other agent keeps running its turn, and its output is kept

#### Scenario: ASideSessionStartsOnTheProjectsModel
- **GIVEN** a project whose main session was switched from the default model to another, with a thinking level set
- **WHEN** a side session is started on it
- **THEN** the side session is on that model and that thinking level, not the default

#### Scenario: BothSessionsWorkAtTheSameTime
- **GIVEN** a project and a side session on it
- **WHEN** a prompt is sent in each
- **THEN** both agents run their turns concurrently, and each conversation receives only its own agent's output

#### Scenario: ASideSessionWorksInTheProjectDirectory
- **GIVEN** a side session on a project
- **WHEN** its agent lists or writes files
- **THEN** it does so in the project's directory, under the project's sandbox permissions, and a file it writes is visible from the project's other sessions

### Requirement: ShowSideSessionsWithTheirProject

Every open side session SHALL be listed among the open projects, attached to its project, and SHALL report activity and attention exactly as an open project does. It SHALL be labelled by its conversation's name once it has one, and by a generic side-session label until then. A client SHALL be able to switch to a side session, and back to the project's main session, as it switches between projects, and a conversation SHALL continue while no client watches it.

#### Scenario: ASideSessionIsListedUnderItsProject
- **GIVEN** a project with one side session
- **WHEN** a client receives the list of open projects
- **THEN** the side session is in it, attached to that project, with its own activity

#### Scenario: ASideSessionIsLabelledByItsConversation
- **GIVEN** a new side session, listed with a generic label
- **WHEN** its conversation is named after the first exchange
- **THEN** it is listed under that name

#### Scenario: SwitchingAwayLeavesTheSideSessionRunning
- **GIVEN** a side session whose agent is running a turn
- **WHEN** the client switches to the project's main session and later back
- **THEN** it is shown the side conversation, including what the agent produced while it was away

#### Scenario: AWaitingSideSessionAsksForAttention
- **GIVEN** a side session no client is watching
- **WHEN** its turn blocks on a question for the user
- **THEN** it is reported as needing attention, as a background project would be

### Requirement: AConversationIsLiveInOnePlace

A conversation SHALL be live in at most one session of a project at a time. Opening, in one session, a saved conversation that is live in another session of the same project SHALL be refused, with an error naming the session where it is live, and SHALL leave both sessions as they were. The session list SHALL mark a conversation that is live in another session of the project. A conversation started in a side session SHALL be saved in the project's session history like any other.

#### Scenario: OpeningAConversationLiveElsewhereIsRefused
- **GIVEN** a project whose main session is showing conversation A, and a side session
- **WHEN** the side session asks to open conversation A
- **THEN** the request is refused with an error naming the main session
- **AND** both sessions keep their conversations

#### Scenario: TheListShowsWhereAConversationIsLive
- **GIVEN** a side session showing conversation B
- **WHEN** the project's main session lists its sessions
- **THEN** conversation B is listed, marked as live in the side session

#### Scenario: ASideConversationIsKeptInHistory
- **GIVEN** a side session with at least one exchange
- **WHEN** the side session is closed
- **THEN** its conversation is listed in the project's session history and can be opened from the main session

### Requirement: CloseASideSession

A client SHALL be able to close a side session. Closing SHALL stop its agent and remove it from the open projects, and clients watching it SHALL be moved to the project's main session; its conversation SHALL be kept in history. Closing a side session whose agent is running a turn SHALL be refused, with an error saying so. Closing a project SHALL close its side sessions, and SHALL be refused while any of them is running a turn, naming it. Side sessions SHALL NOT be reopened when the server restarts. Where the server retires idle projects, an idle side session that no client is watching SHALL be closed after the same period instead of retired, under the same conditions: never while its agent runs a turn or while its Work Plan is ready for review.

#### Scenario: ClosingASideSessionMovesItsClientsToTheProject
- **GIVEN** an idle side session with a client watching it
- **WHEN** the user closes it
- **THEN** it is no longer listed, and the client is shown the project's main session

#### Scenario: ClosingAWorkingSideSessionIsRefused
- **GIVEN** a side session whose agent is running a turn
- **WHEN** the user closes it
- **THEN** the request is refused with an error naming the running turn, and the session keeps running

#### Scenario: ClosingAProjectClosesItsSideSessions
- **GIVEN** an idle project with an idle side session
- **WHEN** the user closes the project
- **THEN** neither the project nor its side session is listed any more

#### Scenario: AProjectWithAWorkingSideSessionCannotBeClosed
- **GIVEN** an idle project whose side session is running a turn
- **WHEN** the user closes the project
- **THEN** the request is refused with an error naming the side session, and both keep running

#### Scenario: AnIdleSideSessionIsClosedNotRetired
- **GIVEN** a server that retires idle projects, and an idle side session no client has watched for longer than that period
- **WHEN** the retirement sweep runs
- **THEN** the side session is no longer listed, and its conversation is in the project's history

#### Scenario: SideSessionsDoNotSurviveARestart
- **GIVEN** a project with a side session
- **WHEN** the server restarts
- **THEN** the project is open again without the side session, and the side conversation is in its history

### Requirement: SettingsApplyToEverySessionOfAProject

Settings applied from any session of a project SHALL apply to the project, and every one of its sessions SHALL be rebuilt with them. The session they are applied from SHALL restart as it does today; each of the project's other sessions SHALL be put back on the conversation it was showing. Settings applied while another session of the same project is running a turn SHALL be refused, with an error naming that session, and nothing SHALL be changed. The sandbox roots SHALL be editable only where they are editable for the project's main session.

#### Scenario: APermissionChangeReachesTheSideSession
- **GIVEN** a read-only project with an idle side session
- **WHEN** write is allowed in Settings from the main session
- **THEN** the side session's agent can write in the project's directory, and its conversation is unchanged

#### Scenario: SettingsWaitForAWorkingSideSession
- **GIVEN** a project whose side session is running a turn
- **WHEN** Settings are applied from the main session
- **THEN** the request is refused with an error naming the side session, and neither session is rebuilt

### Requirement: SideSessionsAreOfferedWhereProjectsAre

Starting a side session SHALL be offered wherever the controls to open and switch projects are offered: the standalone app, and an embedded widget whose policy offers projects. It SHALL be offered as a control on each open project's entry in the project list, always visible rather than revealed on hover, so that it can be found and used without a pointer; it SHALL start the side session on that project, whether or not it is the project being shown. A side session's entry SHALL NOT carry it. It SHALL NOT be offered, and the server SHALL refuse it, on a server whose workspaces are locked by configuration. An embedded widget bound to one project SHALL NOT offer it.

#### Scenario: TheProjectControlsOfferASideSession
- **GIVEN** the standalone app with a project open
- **WHEN** the user opens the project list
- **THEN** that project's entry carries a visible control to start a side session, and a side session's entry carries none

#### Scenario: TheProjectRowStartsASideSession
- **GIVEN** the standalone app showing project `alpha`, with project `beta` also open
- **WHEN** the user activates the side-session control on `beta`'s entry
- **THEN** a side session starts on `beta`, the client is moved to it, and it is listed under `beta`

#### Scenario: ALockedServerRefusesSideSessions
- **GIVEN** a server with workspaces locked by configuration
- **WHEN** a client asks to start a side session
- **THEN** the request is refused, and the interface offered no such action

#### Scenario: AWidgetBoundToOneProjectOffersNoSideSession
- **GIVEN** an embedded widget in `settings` mode
- **WHEN** its header and Settings are opened
- **THEN** no side-session action is offered
