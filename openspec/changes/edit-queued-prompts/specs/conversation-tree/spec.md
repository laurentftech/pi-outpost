## MODIFIED Requirements

### Requirement: EditPromptBranches

A user message in the transcript SHALL be editable once persisted: submitting an edited version rewinds to just before it and asks again, so the new answer forms a sibling branch while the original exchange stays reachable in the tree. Editing SHALL be unavailable while the agent is running or the connection is down, and a message the server has not confirmed as a session entry SHALL NOT be editable. A prompt still waiting in the agent's queue is not in the transcript; it is edited in the queue, as the `queued-prompts` capability describes.

#### Scenario: EditCreatesBranch
- **GIVEN** an answered exchange
- **WHEN** the user edits that prompt and sends it
- **THEN** the agent answers the edited prompt, and the tree shows two branches from that point — the original exchange preserved

#### Scenario: UnconfirmedBubbleNotEditable
- **GIVEN** a chat bubble the server never persisted as an entry (an extension slash command)
- **WHEN** the transcript renders
- **THEN** that bubble offers no edit action, and no other bubble's edit targets the wrong entry

#### Scenario: EditRefusedWhileRunning
- **GIVEN** the agent is running
- **WHEN** the user has an editor open
- **THEN** submitting is disabled and the draft is kept (never silently dropped)
