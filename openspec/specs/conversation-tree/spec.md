# Conversation Tree Specification

## Purpose

How the UI exposes pi's branching sessions: the branch graph, what a turn's navigation targets are
(the turn itself vs the tip of its reply), and the rewind / restore / fork / edit actions built on them.

## Requirements

### Requirement: BranchGraphRendering

The conversation tree SHALL render as a branch graph: one rail per branch, the current path on the first lane in a color reserved for it, fork points visibly leaving their parent's rail, and per-turn chips for the branch count at a fork, the current turn, and any SDK-generated branch label. The header SHALL state the number of turns and branch points, and a search box SHALL filter turns by message text or label.

#### Scenario: CurrentBranchIsIdentifiable
- **GIVEN** a session with an abandoned branch and a current branch
- **WHEN** the user opens the tree
- **THEN** the current path is on the first lane in the reserved color, and no abandoned branch uses that color

#### Scenario: ForkIsVisible
- **GIVEN** a turn whose replies branch in two directions
- **WHEN** the tree renders
- **THEN** that turn shows a "2 branches" chip and the second branch leaves the rail at that row

#### Scenario: SearchMatchesLabels
- **GIVEN** an abandoned branch carrying an SDK branch-summary label
- **WHEN** the user types part of that label into the tree search box
- **THEN** the turn is listed

### Requirement: RestoreTurnState

Each answered turn SHALL advertise the entry id of its reply (`tipId`), and selecting a turn in the tree SHALL restore the conversation **after** that exchange — the reply included, the composer left empty. A turn with no reply yet SHALL fall back to rewinding to before it.

#### Scenario: RestoreAbandonedBranch
- **GIVEN** the user branched away from an earlier exchange
- **WHEN** they select that exchange's turn in the tree
- **THEN** the transcript shows the user message *and* its original reply, and the composer is empty

#### Scenario: TurnWithoutReply
- **GIVEN** a turn whose reply was aborted before any assistant message was persisted
- **WHEN** the user selects it
- **THEN** the conversation rewinds to before the message and its text returns to the composer

### Requirement: RewindAndFork

The tree SHALL keep, as secondary actions on every turn, a rewind ("redo") that returns to just before the message with its text back in the composer, and a fork that starts a new session file from that point. Rewind and restore SHALL be refused while the agent is running.

#### Scenario: RedoRewinds
- **WHEN** the user triggers "redo" on a turn
- **THEN** the conversation rewinds to before that message and its text appears in the composer

#### Scenario: RefusedWhileStreaming
- **GIVEN** the agent is running
- **WHEN** the user tries to restore or rewind a turn
- **THEN** the action is unavailable (the server refuses navigation while streaming)

### Requirement: EditPromptBranches

A user message in the transcript SHALL be editable once persisted: submitting an edited version rewinds to just before it and asks again, so the new answer forms a sibling branch while the original exchange stays reachable in the tree. Editing SHALL be unavailable while the agent is running or the connection is down, and a message the server has not confirmed as a session entry SHALL NOT be editable.

#### Scenario: EditCreatesBranch
- **GIVEN** an answered exchange
- **WHEN** the user edits that prompt and sends it
- **THEN** the agent answers the edited prompt, and the tree shows two branches from that point — the original exchange preserved

#### Scenario: UnconfirmedBubbleNotEditable
- **GIVEN** a chat bubble the server never persisted as an entry (an extension slash command, or a steer aborted before delivery)
- **WHEN** the transcript renders
- **THEN** that bubble offers no edit action, and no other bubble's edit targets the wrong entry

#### Scenario: EditRefusedWhileRunning
- **GIVEN** the agent is running
- **WHEN** the user has an editor open
- **THEN** submitting is disabled and the draft is kept (never silently dropped)

## Technical Notes

- **Implementation**: `server/src/index.ts` (buildTree, replyTip, navigateTree, editPrompt), `web/src/components/TreeMenu.tsx`, `web/src/components/UserMessage.tsx`
