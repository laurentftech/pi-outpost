## ADDED Requirements

### Requirement: AskASideQuestion

A `/btw <question>` command SHALL be available in every session, in both runtimes. It SHALL answer
the question with the session's current model, from the conversation as the session holds it when
the command runs: the user's messages, the assistant's messages, the tools it called and their
results. It SHALL run whether or not a turn is running. A running turn SHALL NOT be interrupted,
steered or delayed by it, and its output SHALL be kept.

#### Scenario: ASideQuestionIsAnsweredWhileTheAgentWorks
- **GIVEN** a session whose agent is running a turn
- **WHEN** the user sends `/btw where are you at?`
- **THEN** an answer to the question is shown
- **AND** the turn goes on to its end, its output kept, and its next request carries no trace of the question

#### Scenario: TheAnswerIsMadeFromTheWorkSoFar
- **GIVEN** a running turn in which the agent has already read the file `notes.md`
- **WHEN** the user sends `/btw which files did you read?`
- **THEN** the request made for the answer contains the call that read `notes.md` and the question

#### Scenario: AnIdleSessionCanBeAsked
- **GIVEN** an idle session with at least one exchange
- **WHEN** the user sends `/btw what did we decide?`
- **THEN** an answer is shown, and no turn starts

#### Scenario: ALongConversationIsCutFromTheFront
- **GIVEN** a conversation longer than the side question's budget
- **WHEN** a side question is asked
- **THEN** the request made for it fits the budget, keeps the most recent messages whole, and says that earlier conversation was left out

### Requirement: TheSideQuestionUsesNoTools

The request made for a side question SHALL offer the model no tools, and SHALL NOT be sent through
the session's agent.

#### Scenario: NoToolIsOffered
- **GIVEN** a session with tools published
- **WHEN** a side question is asked
- **THEN** the request made for it carries no tool

### Requirement: TheSideQuestionStaysOutOfTheConversation

Neither the question nor its answer SHALL be saved in the session, shown as a message in the
conversation, or given to the agent in a later turn. More generally, a prompt that an extension
command handled SHALL NOT be shown as the user's message, in either runtime, and SHALL NOT mark the
session as running a turn.

#### Scenario: TheQuestionIsNotInTheHistory
- **GIVEN** a session in which `/btw what is left?` was answered
- **WHEN** the session's entries are read, or the conversation is reloaded
- **THEN** neither the question nor the answer is among them

#### Scenario: AHandledCommandIsNotEchoed
- **GIVEN** a connected client
- **WHEN** it sends `/btw what is left?`, or another command an extension handles
- **THEN** no user message with that text is sent to the clients

#### Scenario: AHandledCommandStartsNoTurn
- **GIVEN** an idle session in the RPC runtime
- **WHEN** the user sends `/btw what is left?` and then a plain message
- **THEN** the plain message starts a turn, rather than being sent as a steer to a turn that is not running

### Requirement: TheAnswerIsShownAboveTheComposer

The question and its answer SHALL be shown in one panel above the composer, which SHALL say that it
is a side answer, not part of the conversation, and SHALL NOT look like a message thread. It SHALL
say that the answer is coming while it is. A new side question SHALL cancel one still waiting and
take its place. A failure SHALL be shown in the panel and SHALL NOT be reported in the
conversation's error banner.

#### Scenario: TheWaitIsShown
- **GIVEN** a side question whose answer has not arrived
- **WHEN** the panel is shown
- **THEN** it says it is a side answer, holds the question, and says the answer is coming

#### Scenario: ANewQuestionReplacesTheWaitingOne
- **GIVEN** a side question still waiting for its answer
- **WHEN** another side question is asked
- **THEN** the first request is cancelled, and the panel shows the second question in its place and, later, its answer

#### Scenario: AFailureIsShownInThePanel
- **GIVEN** a session whose model has no credentials, or whose provider answers with an error
- **WHEN** a side question is asked
- **THEN** the panel says why there is no answer, and the conversation's error banner is unchanged

### Requirement: ALongPanelScrolls

The panel SHALL keep to a bounded height and scroll within it, keeping its title in view. Once the
panel has focus, the arrow and page keys SHALL scroll it. The composer SHALL keep its own use of
those keys.

#### Scenario: ALongAnswerScrollsByKeyboard
- **GIVEN** a side answer taller than the panel's height
- **WHEN** the user focuses the panel and presses the down arrow
- **THEN** the answer scrolls, the title and the composer stay in view, and the composer keeps its text and focus behaviour

### Requirement: ThePanelCanBeClosed

The panel SHALL have a close control. Activating it, or sending `/btw` with no question, SHALL
cancel a waiting question and close the panel for every connected client, without adding a message
to the conversation. Starting or switching to another conversation SHALL close the panel.

#### Scenario: BtwAloneClosesThePanel
- **GIVEN** a panel showing an answer
- **WHEN** the user sends `/btw` with no question
- **THEN** the panel is no longer shown

#### Scenario: TheCloseControlClosesThePanel
- **GIVEN** a panel showing an answer, in two connected clients
- **WHEN** the user activates the panel's close control in one of them
- **THEN** the panel is no longer shown in either, no message is added to the conversation, and no turn starts

#### Scenario: AnotherConversationClosesThePanel
- **GIVEN** a panel showing an answer
- **WHEN** a new conversation is started or another one is opened
- **THEN** the panel is no longer shown

### Requirement: AFollowUpKeepsTheSideThread

While the panel is open, a side question SHALL be asked with the panel's earlier answered side
questions and their answers, after the conversation. The panel SHALL show them, oldest first, above
the latest question, which SHALL be scrolled into view each time it changes.
Closing the panel, or another conversation, SHALL forget them. They SHALL never reach the agent or
the session, and a message sent without `/btw` SHALL go to the agent whether the panel is open or
not.

#### Scenario: AFollowUpSeesTheEarlierSideQuestions
- **GIVEN** a side question `/btw which files did you read?` that was answered
- **WHEN** the user sends `/btw and the second one?`
- **THEN** the request made for it carries the first question and its answer before the new question
- **AND** the panel shows the first question and its answer above the new question, which is in view

#### Scenario: ClosingForgetsTheThread
- **GIVEN** an answered side question
- **WHEN** the panel is closed and another side question is asked
- **THEN** the request made for it carries no earlier side question

#### Scenario: APlainMessageGoesToTheAgentWhileThePanelIsOpen
- **GIVEN** a panel showing an answer
- **WHEN** the user sends a message without `/btw`
- **THEN** it is the user's message in the conversation and starts a turn, and the side thread does not reach that turn

### Requirement: TheOperatorCanWithholdTheSideQuestion

`/btw` SHALL be subject to `blockedCommands` and `allowedCommands` like any other command.

#### Scenario: ABlockedBtwIsNeitherOfferedNorRun
- **GIVEN** `blockedCommands: ["btw"]`
- **WHEN** a client connects and sends `/btw where are you at?`
- **THEN** its command list holds no `btw`, the prompt is refused, and no model request is made
