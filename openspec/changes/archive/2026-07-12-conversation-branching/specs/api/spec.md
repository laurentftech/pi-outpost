# Delta: api — conversation-branching

## ADDED Requirements

### Requirement: TreeNavigationTargets

The server SHALL accept a navigation target only if it is one of the entry ids the tree itself advertised — a user turn, or that turn's reply tip. A reply tip SHALL be a plain assistant/tool `message` entry: the SDK treats a `custom_message` target like a user message (leaf moves to its parent and its content is returned as composer prefill), so an extension's internal message must never be offered as a tip.

#### Scenario: TipRestoresExchange
- **GIVEN** an answered turn whose reply tip the tree advertised
- **WHEN** the client navigates to that tip
- **THEN** the session leaf moves to the reply, the snapshot contains the exchange in full, and no composer prefill is sent

#### Scenario: UnknownTargetRefused
- **WHEN** the client sends navigate_tree with an entry id the tree never advertised (a compaction, label, or fabricated id)
- **THEN** the server answers with an error and the session is unchanged

### Requirement: SessionChangeSerialization

While a session change is in flight (tree navigation, prompt editing, fork, session switch), the server SHALL refuse prompts and further session changes with an explicit error. A prompt landing during a navigation would be appended under the old leaf and then have its run's message state overwritten when the navigation completes.

#### Scenario: PromptDuringNavigation
- **GIVEN** a tree navigation in progress (its extension hooks are still awaiting)
- **WHEN** any client sends a prompt
- **THEN** the server refuses it with an error and the running navigation completes intact

#### Scenario: ConcurrentEdits
- **GIVEN** two clients editing a past prompt at the same time
- **WHEN** the second edit arrives while the first is rewinding
- **THEN** the second is refused with "Session change already in progress"

### Requirement: EditPromptOperation

`edit_prompt` SHALL be a single server-side operation: rewind to just before the target user message, broadcast the replacement snapshot, then prompt with the edited text. It SHALL be refused while the agent is running, and an extension veto of the rewind (`session_before_tree` cancelling) SHALL be reported to the client as an error rather than silently dropped.

#### Scenario: EditBranches
- **GIVEN** an answered exchange
- **WHEN** a client sends edit_prompt for that message with new text
- **THEN** the agent answers the edited text and the tree shows the original exchange as a sibling branch

#### Scenario: EditRefusedWhileStreaming
- **GIVEN** the agent is running
- **WHEN** a client sends edit_prompt
- **THEN** the server refuses it with an error and the session is unchanged

#### Scenario: VetoReported
- **GIVEN** an extension that cancels the rewind
- **WHEN** a client sends edit_prompt
- **THEN** the client receives an error saying the conversation was not rewound
